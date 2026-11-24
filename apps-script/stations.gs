/**
 * API ข้อมูลปั๊มน้ำมันทุกแบรนด์ (Google ชีต: stations_all_brands) — ใช้ร่วมกัน 2 เว็บ:
 *   - my-website-pm  (หน้า access-maps.html)  Firebase โปรเจกต์ my-login-project-26857
 *   - my-web-p3      (หน้า Maps)              Firebase โปรเจกต์ my-web-p3
 * ส่งข้อมูลให้เฉพาะคนที่ล็อกอินเว็บใดเว็บหนึ่งแล้วเท่านั้น (ตรวจ Firebase token)
 *
 * - อ่าน "ทุกแท็บ" แต่ละแท็บ = หนึ่งแบรนด์ (ชื่อแท็บ = ชื่อแบรนด์บนแผนที่)
 * - ข้ามแท็บใน SKIP_SHEETS, แท็บที่ชื่อขึ้นต้นด้วย _ และแท็บที่ซ่อน
 * - เพิ่มแบรนด์ใหม่: เพิ่มแท็บ แถวแรกเป็นหัวคอลัมน์ ต้องมีอย่างน้อย name, lat, lng — ไม่ต้อง Deploy ใหม่
 *
 * วิธีติดตั้ง: วางโค้ดนี้ทับทั้งไฟล์ → บันทึก → การทำให้ใช้งานได้ → "จัดการการทำให้ใช้งานได้"
 * → แก้ไข (ดินสอ) รายการเดิม → เวอร์ชัน "เวอร์ชันใหม่" → ทำให้ใช้งานได้ (URL เดิม — pm ไม่ต้องแก้อะไร)
 */

const SKIP_SHEETS = ['All'];

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
    // reason บอกว่าติดตรงไหน (ไม่มีข้อมูลลับ) เช่น lookup:API key not valid = คีย์ในสคริปต์ผิด
    return json_({ status: 'error', error: 'unauthorized', reason: FAIL_REASON_, message: 'เซสชันหมดอายุหรือไม่มีสิทธิ์ กรุณาล็อกอินใหม่' });
  }
  return json_(getStations_());
}

// เปิด URL ตรงๆ ในเบราว์เซอร์ → ไม่ให้ข้อมูล
function doGet() {
  return json_({ status: 'error', error: 'unauthorized', message: 'ต้องเข้าสู่ระบบผ่านเว็บก่อน' });
}

// ===== อ่านข้อมูลปั๊ม (เหมือนโค้ดเดิม) =====
function getStations_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const out = [];

  ss.getSheets().forEach(sheet => {
    const brand = sheet.getName().trim();
    if (SKIP_SHEETS.indexOf(brand) !== -1 || brand.charAt(0) === '_' || sheet.isSheetHidden()) return;

    const values = sheet.getDataRange().getValues();
    if (values.length < 2) return;
    const headers = values.shift().map(h => String(h).trim());

    values.forEach(r => {
      if (!r.some(v => v !== '' && v !== null)) return;
      const o = { _sheet: brand };
      headers.forEach((h, i) => { if (h && r[i] !== '' && r[i] !== null) o[h] = r[i]; });
      out.push(o);
    });
  });

  return out;
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
