/**
 * นับว่าตอนนี้หน้าไหนของ Access Hub มีเครื่องใช้งานอยู่กี่เครื่อง (หน้า room.html)
 * - ไม่เก็บอีเมลหรือชื่อ: จำแค่ รหัสสุ่มของเครื่อง ชื่อหน้า ชนิดเครื่อง ไว้ในหน่วยความจำชั่วคราว
 * - ประวัติ (แท็บ history) เก็บเฉพาะจำนวนเครื่องต่อหน้า ทุก 5 นาทีที่มีคนใช้ เก็บ 90 วัน
 * - เครื่องที่ไม่ส่งสัญญาณเกิน 150 วินาทีถูกตัดออก
 * - ส่งสัญญาณได้เฉพาะคนที่ล็อกอินเว็บแล้ว ดูตัวเลขได้เฉพาะอีเมลใน ADMIN_EMAIL
 *
 * วิธีติดตั้ง: โครงการ Apps Script ใหม่ (หรือเปิดจาก Google ชีต) → วางโค้ดนี้ทับ → ใส่อีเมลที่ใช้ล็อกอินเว็บใน ADMIN_EMAIL
 * → บันทึก → เลือกฟังก์ชัน authorize แล้ว "เรียกใช้" → อนุญาต
 * → การทำให้ใช้งานได้ → เว็บแอป (เรียกใช้ในฐานะ: ฉัน, ผู้มีสิทธิ์เข้าถึง: ทุกคน)
 * → คัดลอก URL /exec ไปใส่ PRESENCE_URL ใน firebase-guard.js
 */

// อีเมลที่ใช้ล็อกอินเว็บ ของคนที่ดูหน้า room.html ได้ (พิมพ์เฉพาะในหน้า Apps Script)
const ADMIN_EMAIL = '';

const ALIVE_MS = 150000;
const SNAPSHOT_MS = 5 * 60000;
const KEEP_DAYS = 90;
const HEADERS = ['เวลา', 'หน้า', 'จำนวนเครื่อง', 'คอม', 'มือถือ', 'แท็บเล็ต'];

// Firebase โปรเจกต์ที่ยอมรับ: projectId → Web API key (ค่าจาก firebase-guard.js ไม่ใช่ความลับ)
const FIREBASE_PROJECTS = {
  'my-login-project-26857': ['AIzaSyD7HPOh', 'loICyxEyDTfR8yRiH2rT--q4fVo'].join('') // my-website-pm
};

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
  const user = verifyFirebaseToken_(body.idToken);
  if (!user) {
    return json_({ status: 'error', error: 'unauthorized', message: 'เซสชันหมดอายุหรือไม่มีสิทธิ์ กรุณาล็อกอินใหม่' });
  }
  if (body.action === 'view') {
    if (!ADMIN_EMAIL || user.email !== ADMIN_EMAIL.trim().toLowerCase()) {
      return json_({ status: 'error', error: 'forbidden', message: 'บัญชีนี้ไม่มีสิทธิ์ดูหน้านี้' });
    }
    return json_(summary_(read_()));
  }
  ping_(String(body.device || ''), String(body.page || ''), String(body.kind || ''));
  return json_({ status: 'success' });
}

function doGet() {
  return json_({ status: 'error', error: 'unauthorized', message: 'ต้องเข้าสู่ระบบผ่านเว็บก่อน' });
}

function read_() {
  const map = JSON.parse(CacheService.getScriptCache().get('presence') || '{}');
  const limit = Date.now() - ALIVE_MS;
  Object.keys(map).forEach(function (key) { if (map[key].t < limit) delete map[key]; });
  return map;
}

function ping_(device, page, kind) {
  if (!/^[a-z0-9]{6,24}$/.test(device) || !/^[\w-]{1,40}$/.test(page)) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(5000)) return; // พลาดรอบนี้ได้ รอบหน้าส่งใหม่
  try {
    const map = read_();
    if (Object.keys(map).length < 500) {
      map[device + '|' + page] = { t: Date.now(), kind: ['คอม', 'มือถือ', 'แท็บเล็ต'].indexOf(kind) >= 0 ? kind : 'คอม' };
    }
    CacheService.getScriptCache().put('presence', JSON.stringify(map), 600);
    record_(map);
  } finally { lock.releaseLock(); }
}

// สคริปต์ที่เปิดจากชีตใช้ชีตนั้น ถ้าสร้างแยกจาก script.google.com จะสร้างชีต "PM การใช้งาน" ให้เองครั้งเดียว
function book_() {
  const active = SpreadsheetApp.getActiveSpreadsheet();
  if (active) return active;
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('sheetId');
  if (id) return SpreadsheetApp.openById(id);
  const created = SpreadsheetApp.create('PM การใช้งาน');
  props.setProperty('sheetId', created.getId());
  return created;
}

function historySheet_() {
  const book = book_();
  let sheet = book.getSheetByName('history');
  if (!sheet) {
    sheet = book.insertSheet('history');
    sheet.getRange(1, 1, 1, HEADERS.length).setValues([HEADERS]);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

// จดจำนวนลงชีตไม่เกินทุก 5 นาที (เรียกขณะถือ lock อยู่)
function record_(map) {
  const props = PropertiesService.getScriptProperties();
  const now = Date.now();
  if (now - Number(props.getProperty('lastSnapshot') || 0) < SNAPSHOT_MS) return;
  props.setProperty('lastSnapshot', String(now));
  const pages = summary_(map).pages;
  const when = new Date(now);
  const rows = Object.keys(pages).sort().map(function (page) {
    const info = pages[page];
    return [when, page, info.count, info.kinds['คอม'] || 0, info.kinds['มือถือ'] || 0, info.kinds['แท็บเล็ต'] || 0];
  });
  if (!rows.length) return;
  const sheet = historySheet_();
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
  prune_(sheet, now, props);
}

// วันละครั้ง ลบแถวเก่าเกินกำหนด (แถวเรียงตามเวลา ของเก่าอยู่บน)
function prune_(sheet, now, props) {
  if (now - Number(props.getProperty('lastPrune') || 0) < 86400000) return;
  props.setProperty('lastPrune', String(now));
  const last = sheet.getLastRow();
  if (last < 3) return;
  const limit = now - KEEP_DAYS * 86400000;
  const times = sheet.getRange(2, 1, last - 1, 1).getValues();
  let old = 0;
  while (old < times.length - 1 && new Date(times[old][0]).getTime() < limit) old++;
  if (old) sheet.deleteRows(2, old);
}

function summary_(map) {
  const pages = {};
  const devices = {};
  Object.keys(map).forEach(function (key) {
    const parts = key.split('|');
    const page = pages[parts[1]] || (pages[parts[1]] = { count: 0, kinds: {} });
    page.count++;
    page.kinds[map[key].kind] = (page.kinds[map[key].kind] || 0) + 1;
    devices[parts[0]] = true;
  });
  return { status: 'success', total: Object.keys(devices).length, pages: pages };
}

// ===== ตรวจ Firebase ID token (จำผลไว้ไม่เกิน 5 นาที) =====
function verifyFirebaseToken_(idToken) {
  if (typeof idToken !== 'string' || idToken.length < 100 || idToken.length > 4096) return null;
  const claims = decodeJwtPayload_(idToken);
  const now = Math.floor(Date.now() / 1000);
  const apiKey = claims && Object.prototype.hasOwnProperty.call(FIREBASE_PROJECTS, claims.aud)
    ? FIREBASE_PROJECTS[claims.aud] : null;
  if (!apiKey || claims.iss !== 'https://securetoken.google.com/' + claims.aud || !(claims.exp > now)) return null;

  const cache = CacheService.getScriptCache();
  const key = 'fbtok_' + Utilities.base64EncodeWebSafe(
    Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, idToken));
  const hit = cache.get(key);
  if (hit) return JSON.parse(hit);

  const res = UrlFetchApp.fetch('https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' + apiKey, {
    method: 'post', contentType: 'application/json',
    payload: JSON.stringify({ idToken: idToken }), muteHttpExceptions: true
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

// ครั้งแรกหลังวางโค้ด: เรียกใช้ฟังก์ชันนี้แล้วกดอนุญาต
function authorize() {
  UrlFetchApp.fetch('https://www.google.com');
  historySheet_();
  Logger.log('ประวัติเก็บที่: ' + book_().getUrl());
  Logger.log(ADMIN_EMAIL ? 'ผู้ดูได้: ' + ADMIN_EMAIL : 'ยังไม่ได้ใส่ ADMIN_EMAIL');
}
