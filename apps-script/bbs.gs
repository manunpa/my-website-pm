/**
 * หลังบ้านหน้า "บันทึก BBS" (bbs.html) — รับเฉพาะคนที่ล็อกอินเว็บแล้ว (ตรวจ Firebase token)
 *
 * ฟอร์มต้นแบบ : ไฟล์ .xlsx ในโฟลเดอร์ Drive ตาม FOLDER_PATH (อ่านอย่างเดียว ไม่แก้ไฟล์)
 * แท็บ reports : 1 แถวต่อ ฟอร์ม/วัน/กะ (ข้อมูลทั้งรายงาน ใช้โหลดกลับขึ้นเว็บ)
 * แท็บ rounds  : 1 แถวต่อ 1 รอบตรวจ (อ่าน/กรอง/ทำสถิติได้ในชีต)
 * ทั้งสองแท็บสร้างให้เองครั้งแรกที่บันทึก
 *
 * วิธีติดตั้ง: สร้าง Google ชีตใหม่ → ส่วนขยาย → Apps Script → วางโค้ดนี้ทับ → บันทึก
 * → เลือกฟังก์ชัน authorize แล้วกด "เรียกใช้" → อนุญาต (บันทึกการดำเนินการจะแสดงรายชื่อฟอร์มที่เจอ)
 * → การทำให้ใช้งานได้ → เว็บแอป (เรียกใช้ในฐานะ: ฉัน, ผู้มีสิทธิ์เข้าถึง: ทุกคน)
 * → คัดลอก URL /exec ไปใส่ API_URL ใน bbs.js
 */

// โฟลเดอร์เก็บฟอร์ม: ไดรฟ์ของฉัน → Database → BBS
const FOLDER_PATH = ['Database', 'BBS'];

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
    if (body.action === 'forms') return json_({ status: 'success', forms: listForms_() });
    if (body.action === 'form') return json_(getForm_(String(body.id)));
    // key = รหัสไฟล์ฟอร์ม_วันที่_กะ
    if (!/^[\w-]{10,80}_\d{4}-\d{2}-\d{2}_(day|night)$/.test(body.key)) throw new Error('key ไม่ถูกต้อง');
    if (body.action === 'load') return json_({ status: 'success', doc: load_(body.key) });
    if (body.action === 'save') {
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try { save_(body.key, String(body.doc), user.email); } finally { lock.releaseLock(); }
      return json_({ status: 'success' });
    }
    throw new Error('ไม่รู้จักคำสั่ง');
  } catch (err) {
    return json_({ status: 'error', error: 'failed', message: String(err.message || err) });
  }
}

function doGet() {
  return json_({ status: 'error', error: 'unauthorized', message: 'ต้องเข้าสู่ระบบผ่านเว็บก่อน' });
}

// ===== ฟอร์มต้นแบบใน Drive =====
function folder_() {
  // เทียบเฉพาะตัวอักษรอังกฤษ/ตัวเลข: อักขระแฝงที่มองไม่เห็น ช่องว่าง และตัวพิมพ์เล็กใหญ่ไม่มีผล
  // ชื่อโฟลเดอร์ใน Drive ซ้ำกันได้ จึงเก็บทุกอันที่ตรง
  const plain = function (text) { return String(text).replace(/[^A-Za-z0-9]/g, '').toLowerCase(); };
  let level = [DriveApp.getRootFolder()];
  FOLDER_PATH.forEach(function (name, depth) {
    const next = [];
    level.forEach(function (parent) {
      const found = parent.getFolders();
      while (found.hasNext()) {
        const child = found.next();
        if (plain(child.getName()) === plain(name)) next.push(child);
      }
    });
    if (!next.length) {
      // บอกชื่อโฟลเดอร์ที่มองเห็นจริง ช่วยดูว่าชื่อเพี้ยนหรือคนละบัญชี
      const seen = [];
      level.forEach(function (parent) {
        const all = parent.getFolders();
        while (all.hasNext() && seen.length < 30) seen.push('"' + all.next().getName() + '"');
      });
      throw new Error('ไม่พบโฟลเดอร์ "' + name + '" (' + FOLDER_PATH.slice(0, depth + 1).join('/') +
        ') โฟลเดอร์ที่เจอตรงนั้น: ' + (seen.join(', ') || 'ไม่มีเลย'));
    }
    level = next;
  });
  return level[0];
}

function formFiles_() {
  const files = folder_().getFiles();
  const list = [];
  while (files.hasNext()) {
    const file = files.next();
    if (/\.xlsx$/i.test(file.getName())) list.push(file);
  }
  return list;
}

function listForms_() {
  return formFiles_()
    .map(function (f) { return { id: f.getId(), name: f.getName(), updated: f.getLastUpdated().getTime() }; })
    .sort(function (a, b) { return a.name.localeCompare(b.name); });
}

// ส่งเฉพาะไฟล์ที่อยู่ในโฟลเดอร์ฟอร์ม (กันการขอไฟล์อื่นใน Drive ด้วยรหัสไฟล์)
function getForm_(id) {
  const file = formFiles_().filter(function (f) { return f.getId() === id; })[0];
  if (!file) throw new Error('ไม่พบฟอร์มนี้ในโฟลเดอร์');
  return { status: 'success', name: file.getName(), updated: file.getLastUpdated().getTime(),
    data: Utilities.base64Encode(file.getBlob().getBytes()) };
}

// ===== ข้อมูลที่กรอก =====
const CHUNK = 45000; // 1 ช่องในชีตเก็บได้ไม่เกิน 50,000 ตัวอักษร
const ROUND_HEADERS = ['key', 'ฟอร์ม', 'วันที่', 'กะ', 'SCC', 'ทะเบียน', 'พขร.', 'เวลา', 'สถานที่', 'ผ่าน', 'ไม่ผ่าน', 'หมายเหตุ'];

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

// หมายเลขแถวทั้งหมดที่คอลัมน์ A ตรงกับ key
function rowsOf_(sheet, key) {
  const last = sheet.getLastRow();
  if (last < 2) return [];
  const rows = [];
  sheet.getRange(2, 1, last - 1, 1).getDisplayValues().forEach(function (r, i) {
    if (r[0] === key) rows.push(i + 2);
  });
  return rows;
}

function load_(key) {
  const sheet = reports_();
  const row = rowsOf_(sheet, key)[0];
  if (!row) return '';
  return sheet.getRange(row, 4, 1, Math.max(1, sheet.getLastColumn() - 3)).getValues()[0].join('');
}

function save_(key, doc, email) {
  const report = JSON.parse(doc);
  const sheet = reports_();
  const row = rowsOf_(sheet, key)[0] || sheet.getLastRow() + 1;
  const chunks = [];
  for (let i = 0; i < doc.length; i += CHUNK) chunks.push(doc.slice(i, i + CHUNK));
  if (row <= sheet.getLastRow()) sheet.getRange(row, 1, 1, sheet.getLastColumn()).clearContent();
  sheet.getRange(row, 1, 1, 3 + chunks.length).setValues([[key, new Date(), email].concat(chunks)]);
  writeRounds_(key, report);
}

// แก้เฉพาะแถวของ ฟอร์ม/วัน/กะ นี้ ไม่แตะข้อมูลอื่น
function writeRounds_(key, report) {
  const sheet = tab_('rounds', ROUND_HEADERS);
  const rows = [];
  report.vehicles.forEach(function (v) {
    v.rounds.forEach(function (r) {
      const marks = Object.keys(r.marks || {});
      rows.push([key, report.formName || '', report.date, report.shift, v.scc, v.plate, v.driver, r.time, r.place,
        marks.filter(function (c) { return r.marks[c] === 'P'; }).join(' '),
        marks.filter(function (c) { return r.marks[c] === 'O'; }).join(' '),
        r.note || ''].map(safe_));
    });
  });
  // ลบจากล่างขึ้นบน ทีละช่วงที่ติดกัน
  const old = rowsOf_(sheet, key);
  while (old.length) {
    let start = old.pop();
    let count = 1;
    while (old.length && old[old.length - 1] === start - 1) { start = old.pop(); count++; }
    // ชีตห้ามลบจนไม่เหลือแถวนอกจากแถวตรึง
    if (sheet.getMaxRows() - count < 2) sheet.insertRowAfter(sheet.getMaxRows());
    sheet.deleteRows(start, count);
  }
  if (!rows.length) return;
  const from = sheet.getLastRow() + 1;
  const missing = from + rows.length - 1 - sheet.getMaxRows();
  if (missing > 0) sheet.insertRowsAfter(sheet.getMaxRows(), missing);
  sheet.getRange(from, 1, rows.length, ROUND_HEADERS.length).setNumberFormat('@').setValues(rows);
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
function authorize() {
  UrlFetchApp.fetch('https://www.google.com');
  SpreadsheetApp.getActiveSpreadsheet().getName();
  listForms_().forEach(function (f) { Logger.log('พบฟอร์ม: ' + f.name); });
}
