/**
 * API ข้อมูลปั๊มน้ำมันทุกแบรนด์ สำหรับหน้า access-maps.html (Google ชีต: stations_all_brands)
 * ส่งข้อมูลให้เฉพาะคนที่ล็อกอินเว็บแล้วเท่านั้น (ตรวจ Firebase token)
 *
 * - อ่าน "ทุกแท็บ" แต่ละแท็บ = หนึ่งแบรนด์ (ชื่อแท็บ = ชื่อแบรนด์บนแผนที่)
 * - ข้ามแท็บใน SKIP_SHEETS, แท็บที่ชื่อขึ้นต้นด้วย _ และแท็บที่ซ่อน
 * - เพิ่มแบรนด์ใหม่: เพิ่มแท็บ แถวแรกเป็นหัวคอลัมน์ ต้องมีอย่างน้อย name, lat, lng — ไม่ต้อง Deploy ใหม่
 *
 * วิธีติดตั้ง: วางโค้ดนี้ทับทั้งไฟล์ → บันทึก → การทำให้ใช้งานได้ → "การทำให้ใช้งานได้รายการใหม่"
 * (ได้ URL ใหม่ไว้ใช้กับเว็บ — URL เดิมยังทำงานด้วยโค้ดเก่าเหมือนเดิม ไม่กระทบระบบอื่น)
 */

const SKIP_SHEETS = ['All'];

// ค่าเดียวกับ firebaseConfig ใน firebase-guard.js (Web API key ของ Firebase ไม่ใช่ความลับ)
const FIREBASE_API_KEY = 'AIzaSyD7HPOhloICyxEyDTfR8yRiH2rT--q4fVo';
const FIREBASE_PROJECT_ID = 'my-login-project-26857';

// ===== เว็บเรียกผ่าน POST พร้อม token เท่านั้น =====
function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
  if (!verifyFirebaseToken_(body.idToken)) {
    return json_({ status: 'error', error: 'unauthorized', message: 'เซสชันหมดอายุหรือไม่มีสิทธิ์ กรุณาล็อกอินใหม่' });
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
function verifyFirebaseToken_(idToken) {
  if (typeof idToken !== 'string' || idToken.length < 100 || idToken.length > 4096) return null;

  const claims = decodeJwtPayload_(idToken);
  const now = Math.floor(Date.now() / 1000);
  if (!claims || claims.aud !== FIREBASE_PROJECT_ID ||
      claims.iss !== 'https://securetoken.google.com/' + FIREBASE_PROJECT_ID ||
      !(claims.exp > now)) return null;

  const cache = CacheService.getScriptCache();
  const key = 'fbtok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken));
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  // ให้ Firebase ยืนยันลายเซ็นและสถานะบัญชีจริง
  const res = UrlFetchApp.fetch(
    'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + FIREBASE_API_KEY, {
      method: 'post',
      contentType: 'application/json',
      payload: JSON.stringify({ idToken: idToken }),
      muteHttpExceptions: true
    });
  if (res.getResponseCode() !== 200) return null;
  const u = (JSON.parse(res.getContentText()).users || [])[0];
  if (!u || u.disabled || u.localId !== claims.sub) return null;

  const user = { uid: u.localId, email: String(u.email || '').toLowerCase() };
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
