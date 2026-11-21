/**
 * API ข้อมูล LEO (Google ชีต: LEO_illegal_by_driver_report) — ใช้ร่วมกัน 2 เว็บ:
 *   - my-website-pm  (หน้า leo_dashboard.html)  Firebase โปรเจกต์ my-login-project-26857
 *   - my-web-p3      (src/fleetData.js)         Firebase โปรเจกต์ my-web-p3
 * ส่งข้อมูลให้เฉพาะคนที่ล็อกอินเว็บใดเว็บหนึ่งแล้วเท่านั้น (ตรวจ Firebase token)
 *
 * การอ่านข้อมูลเหมือนโค้ดเดิมทุกอย่าง (getDisplayValues, ข้ามแถวที่ไม่มี Case No)
 *
 * วิธีติดตั้ง: วางโค้ดนี้ทับทั้งไฟล์ รหัส.gs → บันทึก → การทำให้ใช้งานได้ → "การทำให้ใช้งานได้รายการใหม่"
 * (ได้ URL ใหม่ — URL เดิมยังทำงานด้วยโค้ดเก่า my-web-p3 จึงใช้ต่อได้จนกว่าจะย้ายมา URL ใหม่)
 */

const SHEET_NAME = '';   // ใส่ชื่อแท็บที่เก็บข้อมูล ถ้าเว้นว่างจะใช้แท็บแรกของไฟล์

// Firebase โปรเจกต์ที่ยอมรับ: projectId → Web API key (ค่าจาก firebaseConfig ของแต่ละเว็บ ไม่ใช่ความลับ — แยกเป็น 2 ท่อนเพื่อไม่ให้ถูกซ่อนเป็น ••• ตอนคัดลอก)
const FIREBASE_PROJECTS = {
  'my-login-project-26857': ['AIzaSyD7HPOh', 'loICyxEyDTfR8yRiH2rT--q4fVo'].join(''), // my-website-pm (firebase-guard.js)
  'my-web-p3':              ['AIzaSyA5OM2o', 'm_4CnwTuFAixQGwxhtyUUmDjv7Y'].join('')  // my-web-p3 (src/firebase.js)
};

// ===== เว็บเรียกผ่าน POST พร้อม token เท่านั้น =====
function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
  if (!verifyFirebaseToken_(body.idToken)) {
    return out_({ status: 'error', error: 'unauthorized', message: 'เซสชันหมดอายุหรือไม่มีสิทธิ์ กรุณาล็อกอินใหม่' });
  }
  return getData_();
}

// เปิด URL ตรงๆ ในเบราว์เซอร์ → ไม่ให้ข้อมูล
function doGet() {
  return out_({ status: 'error', error: 'unauthorized', message: 'ต้องเข้าสู่ระบบผ่านเว็บก่อน' });
}

// ===== อ่านข้อมูล LEO (เหมือนโค้ดเดิม) =====
function getData_() {
  try {
    var ss = SpreadsheetApp.getActiveSpreadsheet();
    var sheet = SHEET_NAME ? ss.getSheetByName(SHEET_NAME) : ss.getSheets()[0];
    if (!sheet) return out_({ error: 'ไม่พบแท็บชื่อ ' + SHEET_NAME });

    // getDisplayValues = ข้อความตามที่เห็นในชีต (วันที่ เวลา ภาษาไทย ตรงกับหน้าเว็บ)
    var rows = sheet.getDataRange().getDisplayValues();

    // แถวแรกเป็นหัวตาราง
    var headers = rows[0].map(function (h) { return String(h).trim(); });
    var data = [];

    for (var i = 1; i < rows.length; i++) {
      var row = rows[i];
      if (!row[0]) continue;                    // ข้ามแถวว่าง (ไม่มี Case No)
      var obj = {};
      for (var j = 0; j < headers.length; j++) {
        obj[headers[j]] = row[j];
      }
      data.push(obj);
    }
    return out_(data);
  } catch (err) {
    return out_({ error: String(err) });
  }
}

// ===== ตรวจ Firebase ID token — ใช้ได้คืน {uid, email} ไม่ได้คืน null (จำผลไว้ไม่เกิน 5 นาที) =====
function verifyFirebaseToken_(idToken) {
  if (typeof idToken !== 'string' || idToken.length < 100 || idToken.length > 4096) return null;

  const claims = decodeJwtPayload_(idToken);
  const now = Math.floor(Date.now() / 1000);
  const apiKey = claims && Object.prototype.hasOwnProperty.call(FIREBASE_PROJECTS, claims.aud)
    ? FIREBASE_PROJECTS[claims.aud] : null;
  if (!apiKey || claims.iss !== 'https://securetoken.google.com/' + claims.aud ||
      !(claims.exp > now)) return null;

  const cache = CacheService.getScriptCache();
  const key = 'fbtok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken));
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  // ให้ Firebase (โปรเจกต์ที่ออก token นี้) ยืนยันลายเซ็นและสถานะบัญชีจริง
  const res = UrlFetchApp.fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + apiKey, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ idToken: idToken }),
      muteHttpExceptions: true
    });
  if (res.getResponseCode() !== 200) return null;
  const u = (JSON.parse(res.getContentText()).users || [])[0];
  if (!u || u.disabled || u.localId !== claims.sub) return null;

  const user = { project: claims.aud, uid: u.localId, email: String(u.email || '').toLowerCase() };
  const ttl = Math.min(300, claims.exp - now);
  if (ttl > 0) cache.put(key, JSON.stringify(user), ttl);
  return user;
}

function decodeJwtPayload_(jwt) {
  try {
    const part = jwt.split('.')[1];
    const pad = part + '==='.slice((part.length + 3) % 4);
    return JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(pad)).getDataAsString());
  } catch (err) {
    return null;
  }
}

function out_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ครั้งแรกหลังวางโค้ด: เลือกฟังก์ชันนี้แล้วกด "เรียกใช้" → ตรวจสอบสิทธิ์ → อนุญาต
// (ให้สคริปต์ติดต่อ Firebase ได้ — ถ้าไม่ทำ เว็บจะโหลดข้อมูลไม่ได้แม้ล็อกอินแล้ว)
function authorize() {
  UrlFetchApp.fetch('https://www.google.com');
}
