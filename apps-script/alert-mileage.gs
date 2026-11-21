/**
 * API ข้อมูล Alert Mileage (Google ชีต: alert-mileage database) สำหรับหน้า alert-mileage.html
 * ส่งข้อมูลให้เฉพาะคนที่ล็อกอินเว็บแล้วเท่านั้น (ตรวจ Firebase token)
 *
 * การอ่านข้อมูลเหมือนโค้ดเดิม: อ่านแท็บ Mileage และ Alarm ด้วย getDisplayValues ข้ามแถวว่าง
 *
 * วิธีติดตั้ง: วางโค้ดนี้ทับทั้งไฟล์ รหัส.gs → บันทึก → การทำให้ใช้งานได้ → "การทำให้ใช้งานได้รายการใหม่"
 * (ได้ URL ใหม่ — URL เดิมยังทำงานด้วยโค้ดเก่าเหมือนเดิม)
 */

// ===== ตั้งค่า =====
const SHEET_ID = '1q57EFvK3afC15-hIvIa0d1r-XthNCNlcUUMXnfWR1A4';

// ชื่อแท็บที่ต้องการดึง (ต้องตรงกับชื่อในชีต)
const SHEET_NAMES = ['Mileage', 'Alarm'];

// Firebase โปรเจกต์ที่ยอมรับ: projectId → Web API key (ค่าจาก firebaseConfig ใน firebase-guard.js ไม่ใช่ความลับ — แยกเป็น 2 ท่อนเพื่อไม่ให้ถูกซ่อนเป็น ••• ตอนคัดลอก)
const FIREBASE_PROJECTS = {
  'my-login-project-26857': ['AIzaSyD7HPOh', 'loICyxEyDTfR8yRiH2rT--q4fVo'].join('') // my-website-pm
};

// ===== เว็บเรียกผ่าน POST พร้อม token เท่านั้น =====
function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
  if (!verifyFirebaseToken_(body.idToken)) {
    // reason บอกว่าติดตรงไหน (ไม่มีข้อมูลลับ) เช่น lookup:API key not valid = คีย์ในสคริปต์ผิด
    return json_({ status: 'error', error: 'unauthorized', reason: FAIL_REASON_, message: 'เซสชันหมดอายุหรือไม่มีสิทธิ์ กรุณาล็อกอินใหม่' });
  }
  return getData_();
}

// เปิด URL ตรงๆ ในเบราว์เซอร์ → ไม่ให้ข้อมูล
function doGet() {
  return json_({ status: 'error', error: 'unauthorized', message: 'ต้องเข้าสู่ระบบผ่านเว็บก่อน' });
}

// ===== อ่านข้อมูล Mileage + Alarm (เหมือนโค้ดเดิม) =====
function getData_() {
  try {
    // สคริปต์ผูกกับชีต alert-mileage database อยู่แล้ว → ใช้ชีตนั้นตรงๆ (ถ้าไม่ได้ผูก ค่อยเปิดด้วย SHEET_ID)
    const ss = SpreadsheetApp.getActiveSpreadsheet() || SpreadsheetApp.openById(SHEET_ID);
    const data = {};

    SHEET_NAMES.forEach(function (name) {
      const sheet = ss.getSheetByName(name);
      if (!sheet) throw new Error('ไม่พบแท็บชื่อ "' + name + '" ในชีต');

      const values = sheet.getDataRange().getDisplayValues();
      const headers = values.shift().map(function (h) { return String(h).trim(); });

      data[name] = values
        .filter(function (row) {
          return row.some(function (cell) { return cell !== ''; });   // ข้ามแถวว่าง
        })
        .map(function (row) {
          const obj = {};
          headers.forEach(function (h, i) {
            if (h) obj[h] = row[i];
          });
          return obj;
        });
    });

    return json_({ status: 'success', data: data });
  } catch (err) {
    return json_({ status: 'error', message: String(err) });
  }
}

// ฟังก์ชันสำหรับทดสอบในหน้า Apps Script (เลือกฟังก์ชันนี้แล้วกด "เรียกใช้")
// ผลลัพธ์จะแสดงที่ "บันทึกการดำเนินการ" ด้านล่าง — อ่านชีตตรงๆ ไม่ต้องใช้ token
function testData() {
  const out = JSON.parse(getData_().getContent());
  if (out.status !== 'success') {
    Logger.log('ผิดพลาด: ' + out.message);
    return;
  }
  SHEET_NAMES.forEach(function (name) {
    Logger.log(name + ': ' + out.data[name].length + ' แถว');
  });
  Logger.log('ตัวอย่างหัวคอลัมน์ Mileage: ' + Object.keys(out.data.Mileage[0]).join(', '));
  Logger.log('ตัวอย่างหัวคอลัมน์ Alarm: ' + Object.keys(out.data.Alarm[0]).join(', '));
}

// ===== ตรวจ Firebase ID token — ใช้ได้คืน {uid, email} ไม่ได้คืน null (จำผลไว้ไม่เกิน 5 นาที) =====
let FAIL_REASON_ = '';
function verifyFirebaseToken_(idToken) {
  FAIL_REASON_ = 'no-token';
  if (typeof idToken !== 'string' || idToken.length < 100 || idToken.length > 4096) return null;
  FAIL_REASON_ = 'claims';

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
  if (res.getResponseCode() !== 200) {
    let msg = '';
    try { msg = JSON.parse(res.getContentText()).error.message; } catch (err) {}
    FAIL_REASON_ = 'lookup:' + String(msg || res.getResponseCode()).slice(0, 80);
    return null;
  }
  FAIL_REASON_ = 'account';
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

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

// ครั้งแรกหลังวางโค้ด: เลือกฟังก์ชันนี้แล้วกด "เรียกใช้" → ตรวจสอบสิทธิ์ → อนุญาต
// (ให้สคริปต์ติดต่อ Firebase ได้ — ถ้าไม่ทำ เว็บจะโหลดข้อมูลไม่ได้แม้ล็อกอินแล้ว)
function authorize() {
  UrlFetchApp.fetch('https://www.google.com');
}
