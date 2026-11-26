/**
 * หลังบ้านหน้า "ตารางวันทำงาน" (shifts.html) — รับเฉพาะบัญชีใน ALLOWED ที่ล็อกอินเว็บแล้ว
 *
 * แท็บ months : 1 แถวต่อเดือน (ตารางล่าสุดของเดือนนั้น)
 * แท็บ rounds : 1 แถวต่อการแก้ 1 ครั้ง (ใคร เมื่อไร เปลี่ยนอะไร)
 * ทั้งสองแท็บสร้างให้เองครั้งแรกที่บันทึก
 *
 * วิธีติดตั้ง: สร้าง Google ชีตใหม่ → ส่วนขยาย → Apps Script → วางโค้ดนี้ทับ → บันทึก
 * → เลือกฟังก์ชัน authorize แล้วกด "เรียกใช้" → อนุญาต
 * → การทำให้ใช้งานได้ → เว็บแอป (เรียกใช้ในฐานะ: ฉัน, ผู้มีสิทธิ์เข้าถึง: ทุกคน)
 * → คัดลอก URL /exec ไปใส่ SHIFTS_URL ใน shifts.html
 *
 * ส่งอัตโนมัติจากไดรฟ์แชร์ (shift-sync/sync.ps1): เลือกฟังก์ชัน makeSyncKey กด "เรียกใช้"
 * → คัดลอกรหัสจากบันทึกการดำเนินการไปใส่ Key ใน config.json ของเครื่องที่รัน (เรียกซ้ำ = เปลี่ยนรหัส)
 */

// บัญชีที่ดูและแก้ได้ เก็บเป็น SHA-256 ของอีเมลตัวพิมพ์เล็ก (ค่าเดียวกับ owner.js)
const ALLOWED = ['7e333d36720064279a61445480a16a08e1a52fa440b3919ae3ab46b0f4b6a958'];

// Firebase โปรเจกต์ที่ยอมรับ: projectId → Web API key (ค่าจาก firebaseConfig ใน firebase-guard.js ไม่ใช่ความลับ — แยกเป็น 2 ท่อนเพื่อไม่ให้ถูกซ่อนเป็น ••• ตอนคัดลอก)
const FIREBASE_PROJECTS = {
  'my-login-project-26857': ['AIzaSyD7HPOh', 'loICyxEyDTfR8yRiH2rT--q4fVo'].join('') // my-website-pm
};

// ===== เว็บเรียกผ่าน POST พร้อม token เท่านั้น =====
function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
  // สคริปต์ในวงแลนไม่มีล็อกอิน ใช้รหัสลับแทน และทำได้แค่ส่งตารางเข้า อ่านอะไรไม่ได้
  if (body.action === 'sync') return sync_(body);
  const user = verifyFirebaseToken_(body.idToken);
  if (!user) {
    return json_({ status: 'error', error: 'unauthorized', reason: FAIL_REASON_, message: 'เซสชันหมดอายุ กรุณาล็อกอินใหม่' });
  }
  if (ALLOWED.indexOf(hash_(user.email)) < 0) {
    return json_({ status: 'error', error: 'forbidden', message: 'บัญชีนี้ไม่มีสิทธิ์ดูตาราง' });
  }
  try {
    if (body.action === 'months') {
      return json_({ status: 'success', months: all_('months').map(function (r) { return r.key; }).sort() });
    }
    const key = String(body.key);
    if (!/^m\d{4}-\d{2}$/.test(key)) throw new Error('key ไม่ถูกต้อง');
    if (body.action === 'get') return json_(get_(key));
    if (body.action === 'save') {
      const lock = LockService.getScriptLock();
      lock.waitLock(20000);
      try { return json_(save_(key, body, user.email)); } finally { lock.releaseLock(); }
    }
    throw new Error('ไม่รู้จักคำสั่ง');
  } catch (err) {
    return json_({ status: 'error', error: 'failed', message: String(err.message || err) });
  }
}

function sync_(body) {
  const secret = PropertiesService.getScriptProperties().getProperty('SYNC_KEY');
  if (!secret || body.syncKey !== secret) return json_({ status: 'error', error: 'unauthorized', message: 'รหัส sync ไม่ถูกต้อง' });
  const lock = LockService.getScriptLock();
  try {
    lock.waitLock(20000);
    const key = String(body.key);
    if (!/^m\d{4}-\d{2}$/.test(key)) throw new Error('key ไม่ถูกต้อง');
    const next = body.data;
    if (!next || !Array.isArray(next.people) || !next.people.length) throw new Error('ไม่มีข้อมูลตาราง');
    const month = find_(key);
    const before = month ? JSON.parse(month.data) : null;
    if (before && month.data === JSON.stringify(next)) return json_({ status: 'success', changes: 0 });
    const round = before ? makeRound_(before, next) : null;
    save_(key, { data: next, round: round, version: month ? month.time : 0 }, 'sync');
    return json_({ status: 'success', changes: round ? round.list.length : 0 });
  } catch (err) {
    return json_({ status: 'error', error: 'failed', message: String(err.message || err) });
  } finally {
    lock.releaseLock();
  }
}

// ต้องให้ผลแบบเดียวกับ diff() / makeRound() ใน shifts.html
function makeRound_(before, after) {
  const list = [];
  const byId = function (data, id) { return data.people.filter(function (p) { return p.id === id; })[0]; };
  after.people.forEach(function (p) {
    const old = byId(before, p.id);
    if (!old) { list.push({ id: p.id, name: p.name, text: 'เพิ่มชื่อใหม่' }); return; }
    p.codes.forEach(function (code, i) {
      const from = old.codes[i] || 'ว่าง';
      const to = code || 'ว่าง';
      if (code !== (old.codes[i] || '')) {
        list.push({ id: p.id, name: p.name, i: i, from: from, to: to, text: 'วันที่ ' + after.days[i] + ': ' + from + ' → ' + to });
      }
    });
  });
  before.people.forEach(function (o) {
    if (!byId(after, o.id)) list.push({ id: o.id, name: o.name, text: 'ถูกนำออกจากตาราง' });
  });
  const count = function (data, i, code) { return data.people.filter(function (p) { return p.codes[i] === code; }).length; };
  const days = [];
  list.forEach(function (c) { if (c.i !== undefined && days.indexOf(c.i) < 0) days.push(c.i); });
  const impact = days.sort(function (a, b) { return a - b; }).map(function (i) {
    return { i: i, d: [count(before, i, 'D'), count(after, i, 'D')], n: [count(before, i, 'N'), count(after, i, 'N')] };
  });
  return { list: list, impact: impact };
}

function makeSyncKey() {
  const key = Utilities.getUuid() + Utilities.getUuid();
  PropertiesService.getScriptProperties().setProperty('SYNC_KEY', key);
  Logger.log(key);
}

function doGet() {
  return json_({ status: 'error', error: 'unauthorized', message: 'ต้องเข้าสู่ระบบผ่านเว็บก่อน' });
}

function hash_(text) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, String(text).trim().toLowerCase(), Utilities.Charset.UTF_8)
    .map(function (b) { return ('0' + (b & 255).toString(16)).slice(-2); }).join('');
}

// ===== ชีต: key | เวลา (ms) | ผู้บันทึก | ข้อมูล JSON (ยาวเกินช่องเดียวต่อไปคอลัมน์ถัดไป) =====
const CHUNK = 45000; // 1 ช่องในชีตเก็บได้ไม่เกิน 50,000 ตัวอักษร

function tab_(name) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.getRange(1, 1, 1, 4).setValues([['key', 'time', 'by', 'data']]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function all_(name) {
  const sheet = tab_(name);
  if (sheet.getLastRow() < 2) return [];
  return sheet.getRange(2, 1, sheet.getLastRow() - 1, Math.max(4, sheet.getLastColumn())).getValues()
    .map(function (r, i) { return { row: i + 2, key: r[0], time: r[1], data: r.slice(3).join('') }; });
}

function write_(name, row, key, time, email, text) {
  const sheet = tab_(name);
  const cells = [key, time, email];
  for (let i = 0; i < text.length; i += CHUNK) cells.push(text.slice(i, i + CHUNK));
  if (!row) row = sheet.getLastRow() + 1;
  else sheet.getRange(row, 1, 1, sheet.getLastColumn()).clearContent();
  const missing = cells.length - sheet.getMaxColumns();
  if (missing > 0) sheet.insertColumnsAfter(sheet.getMaxColumns(), missing);
  sheet.getRange(row, 1, 1, cells.length).setValues([cells]);
}

function find_(key) {
  return all_('months').filter(function (r) { return r.key === key; })[0];
}

function get_(key) {
  const month = find_(key);
  const rounds = all_('rounds').filter(function (r) { return r.key === key; }).reverse().map(function (r) {
    const round = JSON.parse(r.data);
    round.when = r.time;
    return round;
  });
  return { status: 'success', data: month ? JSON.parse(month.data) : null, version: month ? month.time : 0, rounds: rounds };
}

// version = เวลาของตารางที่หน้าเว็บใช้เทียบ ถ้ามีคนอัปแทรกระหว่างนั้นจะไม่บันทึกทับ
function save_(key, body, email) {
  const month = find_(key);
  if ((month ? month.time : 0) !== body.version) throw new Error('มีการอัปตารางใหม่ระหว่างนี้ กรุณาอัปไฟล์อีกครั้ง');
  if (!body.data || !Array.isArray(body.data.people) || !body.data.people.length) throw new Error('ไม่มีข้อมูลตาราง');
  const now = Date.now();
  write_('months', month ? month.row : 0, key, now, email, JSON.stringify(body.data));
  if (body.round && body.round.list.length) write_('rounds', 0, key, now, email, JSON.stringify(body.round));
  return get_(key);
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
}
