/**
 * ที่เก็บข้อมูลหน้า "บันทึก BBS" (bbs.html) ลง Google ชีต — รับเฉพาะคนที่ล็อกอินเว็บแล้ว (ตรวจ Firebase token)
 *
 * แท็บ reports : 1 แถวต่อ 1 วัน/กะ (ข้อมูลทั้งรายงาน ใช้โหลดกลับขึ้นเว็บ)
 * แท็บ rounds  : 1 แถวต่อ 1 รอบตรวจ (อ่าน/กรอง/ทำสถิติได้ในชีต)
 * ทั้งสองแท็บสร้างให้เองครั้งแรกที่บันทึก
 * ฟอร์มต้นแบบที่อัปจากหน้าเว็บ เก็บเป็นไฟล์ส่วนตัวใน Google Drive ของคุณ
 *
 * วิธีติดตั้ง: สร้าง Google ชีตใหม่ → ส่วนขยาย → Apps Script → วางโค้ดนี้ทับ → บันทึก
 * → เลือกฟังก์ชัน authorize แล้วกด "เรียกใช้" → การทำให้ใช้งานได้ → เว็บแอป
 *   (เรียกใช้ในฐานะ: ฉัน, ผู้มีสิทธิ์เข้าถึง: ทุกคน) → คัดลอก URL /exec ไปใส่ API_URL ใน bbs.js
 */

// Firebase โปรเจกต์ที่ยอมรับ: projectId → Web API key (ค่าจาก firebaseConfig ใน firebase-guard.js ไม่ใช่ความลับ — แยกเป็น 2 ท่อนเพื่อไม่ให้ถูกซ่อนเป็น ••• ตอนคัดลอก)
const FIREBASE_PROJECTS = {
  'my-login-project-26857': ['AIzaSyD7HPOh', 'loICyxEyDTfR8yRiH2rT--q4fVo'].join('') // my-website-pm
};

// ===== เว็บเรียกผ่าน POST พร้อม token เท่านั้น =====
function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
  const user = verifyFirebaseToken_(body.idToken);
  if (!user) {
    return json_({ status: 'error', error: 'unauthorized', reason: FAIL_REASON_, message: 'เซสชันหมดอายุหรือไม่มีสิทธิ์ กรุณาล็อกอินใหม่' });
  }
  try {
    if (body.action === 'loadTemplate') return json_(loadTemplate_(Number(body.have) || 0));
    if (body.action === 'saveTemplate') return locked_(function () { saveTemplate_(body); });
    if (!/^\d{4}-\d{2}-\d{2}_(day|night)$/.test(body.key)) throw new Error('key ไม่ถูกต้อง');
    if (body.action === 'load') return json_({ status: 'success', doc: load_(body.key) });
    if (body.action === 'save') return locked_(function () { save_(body.key, String(body.doc), user.email); });
    throw new Error('ไม่รู้จักคำสั่ง');
  } catch (err) {
    return json_({ status: 'error', error: 'failed', message: String(err.message || err) });
  }
}

function locked_(run) {
  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try { run(); } finally { lock.releaseLock(); }
  return json_({ status: 'success' });
}

// ===== ฟอร์มต้นแบบ: เก็บเป็นไฟล์ส่วนตัวใน Google Drive ของเจ้าของสคริปต์ =====
function saveTemplate_(body) {
  const data = String(body.data || '');
  if (!data || data.length > 4000000) throw new Error('ไฟล์ฟอร์มว่างหรือใหญ่เกินไป');
  const props = PropertiesService.getScriptProperties();
  const old = props.getProperty('templateId');
  const blob = Utilities.newBlob(Utilities.base64Decode(data),
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', String(body.name || 'bbs-template.xlsx'));
  const file = DriveApp.createFile(blob);
  props.setProperties({ templateId: file.getId(), templateUpdated: String(Number(body.updatedAt) || Date.now()) });
  // ฟอร์มเก่าย้ายลงถังขยะ (กู้คืนได้ 30 วัน)
  if (old) { try { DriveApp.getFileById(old).setTrashed(true); } catch (err) {} }
}

// have = เวลาของฟอร์มที่เครื่องนั้นมีอยู่แล้ว ถ้าไม่เก่ากว่าก็ไม่ต้องส่งไฟล์
function loadTemplate_(have) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('templateId');
  const updatedAt = Number(props.getProperty('templateUpdated')) || 0;
  if (!id || updatedAt <= have) return { status: 'success' };
  const file = DriveApp.getFileById(id);
  return { status: 'success', name: file.getName(), updatedAt: updatedAt,
    data: Utilities.base64Encode(file.getBlob().getBytes()) };
}

function doGet() {
  return json_({ status: 'error', error: 'unauthorized', message: 'ต้องเข้าสู่ระบบผ่านเว็บก่อน' });
}

const CHUNK = 45000; // 1 ช่องในชีตเก็บได้ไม่เกิน 50,000 ตัวอักษร

function tab_(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function reports_() { return tab_('reports', ['key', 'updated', 'by', 'data']); }

function findRow_(sheet, key) {
  const last = sheet.getLastRow();
  if (last < 2) return 0;
  const keys = sheet.getRange(2, 1, last - 1, 1).getDisplayValues();
  for (let i = 0; i < keys.length; i++) if (keys[i][0] === key) return i + 2;
  return 0;
}

function load_(key) {
  const sheet = reports_();
  const row = findRow_(sheet, key);
  if (!row) return '';
  return sheet.getRange(row, 4, 1, Math.max(1, sheet.getLastColumn() - 3)).getValues()[0].join('');
}

function save_(key, doc, email) {
  const report = JSON.parse(doc);
  const sheet = reports_();
  const row = findRow_(sheet, key) || sheet.getLastRow() + 1;
  const chunks = [];
  for (let i = 0; i < doc.length; i += CHUNK) chunks.push(doc.slice(i, i + CHUNK));
  sheet.getRange(row, 1, 1, sheet.getMaxColumns()).clearContent();
  sheet.getRange(row, 1, 1, 3 + chunks.length).setValues([[key, new Date(), email].concat(chunks)]);
  writeRounds_(key, report);
}

// แทนที่แถวของวัน/กะนี้ทั้งชุด
function writeRounds_(key, report) {
  const headers = ['key', 'SCC', 'ทะเบียน', 'พขร.', 'เวลา', 'สถานที่', 'ผ่าน', 'ไม่ผ่าน', 'หมายเหตุ'];
  const sheet = tab_('rounds', headers);
  const last = sheet.getLastRow();
  const old = last > 1 ? sheet.getRange(2, 1, last - 1, headers.length).getDisplayValues() : [];
  const rows = old.filter(function (r) { return r[0] !== key; });
  report.vehicles.forEach(function (v) {
    v.rounds.forEach(function (r) {
      if (!r.time && !r.place && !r.note && !Object.keys(r.marks || {}).length) return;
      const marks = Object.keys(r.marks || {});
      rows.push([key, v.scc, v.plate, v.driver, r.time, r.place,
        marks.filter(function (c) { return r.marks[c] === 'P'; }).join(' '),
        marks.filter(function (c) { return r.marks[c] === 'O'; }).join(' '),
        r.note || ''].map(safe_));
    });
  });
  if (last > 1) sheet.getRange(2, 1, last - 1, headers.length).clearContent();
  if (rows.length) sheet.getRange(2, 1, rows.length, headers.length).setNumberFormat('@').setValues(rows);
}

// ข้อความที่ขึ้นต้นเหมือนสูตรต้องเก็บเป็นข้อความ
function safe_(value) {
  const s = String(value == null ? '' : value);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
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
  DriveApp.getRootFolder();
  SpreadsheetApp.getActiveSpreadsheet().getName();
}
