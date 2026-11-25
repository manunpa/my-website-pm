/**
 * เก็บการใช้งาน Access Hub ของทีม และแสดงในหน้า room.html (Active Users)
 * - แท็บ "การเข้าใช้": แถวละหนึ่งรอบการใช้ (เริ่ม ล่าสุด นาที อีเมล หน้า ชนิดเครื่อง ระบบ บราวเซอร์) เก็บ 90 วัน
 * - แท็บ "รายวัน": จำนวนเครื่อง จำนวนคน และช่วงพีคของแต่ละวัน
 * - แท็บ "history": จำนวนเครื่องต่อหน้าทุก 5 นาที เก็บ 90 วัน
 * - แท็บ "สรุป": สูตรรวมตามคน หน้า ชั่วโมง และชนิดเครื่อง
 * - เครื่องที่ไม่ส่งสัญญาณเกิน 150 วินาทีถูกตัดออก กลับมาใหม่นับเป็นรอบใหม่
 * - ส่งสัญญาณได้เฉพาะคนที่ล็อกอินเว็บแล้ว (อีเมลมาจากการตรวจ token) ดูได้เฉพาะ ADMIN_EMAIL
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
const SESSION_HEADERS = ['เริ่ม', 'ล่าสุด', 'นาที', 'อีเมล', 'หน้า', 'ชนิดเครื่อง', 'ระบบ', 'บราวเซอร์', 'รหัสเครื่อง'];
const DAY_HEADERS = ['วันที่', 'จำนวนเครื่อง', 'จำนวนคน', 'พีค (เครื่อง)', 'เวลาพีค'];
const TZ = 'Asia/Bangkok';
const TIME_FORMAT = 'dd/mm/yyyy hh:mm';

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
    return json_(view_());
  }
  ping_(String(body.device || ''), String(body.page || ''), String(body.kind || ''),
    String(body.os || ''), String(body.browser || ''), user.email);
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

function ping_(device, page, kind, os, browser, email) {
  if (!/^[a-z0-9]{6,24}$/.test(device) || !/^[\w-]{1,40}$/.test(page)) return;
  const lock = LockService.getScriptLock();
  if (!lock.tryLock(10000)) return; // พลาดรอบนี้ได้ รอบหน้าส่งใหม่
  try {
    const map = read_();
    const key = device + '|' + page;
    if (!map[key] && Object.keys(map).length >= 300) return;
    const now = Date.now();
    const prev = map[key] && map[key].email === email ? map[key] : null;
    const entry = map[key] = {
      t: now,
      s: prev ? prev.s : now,
      row: prev ? prev.row : 0,
      email: email,
      kind: ['คอม', 'มือถือ', 'แท็บเล็ต'].indexOf(kind) >= 0 ? kind : 'คอม',
      os: clean_(os),
      br: clean_(browser)
    };
    session_(entry, device, page);
    day_(map, device, email, now);
    record_(map);
    CacheService.getScriptCache().put('presence', JSON.stringify(map), 600);
  } finally { lock.releaseLock(); }
}

function clean_(text) {
  return /^[A-Za-z ]{1,20}$/.test(text) ? text : 'Other';
}

// หนึ่งรอบการใช้ = หนึ่งแถว รอบเดิมแก้แค่ "ล่าสุด" กับ "นาที"
function session_(entry, device, page) {
  const sheet = tab_('การเข้าใช้', SESSION_HEADERS);
  const minutes = Math.max(1, Math.round((entry.t - entry.s) / 60000));
  if (entry.row > 1 && entry.row <= sheet.getLastRow()) {
    const row = sheet.getRange(entry.row, 1, 1, SESSION_HEADERS.length).getValues()[0];
    if (row[8] === device && row[4] === page && Math.abs(new Date(row[0]).getTime() - entry.s) < 2000) {
      sheet.getRange(entry.row, 2, 1, 2).setValues([[new Date(entry.t), minutes]]);
      return;
    }
  }
  entry.row = sheet.getLastRow() + 1;
  sheet.getRange(entry.row, 1, 1, SESSION_HEADERS.length).setValues(
    [[new Date(entry.s), new Date(entry.t), minutes, entry.email, page, entry.kind, entry.os, entry.br, device]]);
}

// สรุปของวันนี้: จำไว้ใน Properties แล้วเขียนลงแถวของวันนั้นเมื่อตัวเลขเปลี่ยน
function day_(map, device, email, now) {
  const props = PropertiesService.getScriptProperties();
  const date = Utilities.formatDate(new Date(now), TZ, 'yyyy-MM-dd');
  let day = JSON.parse(props.getProperty('day') || 'null');
  if (!day || day.date !== date) day = { date: date, devices: [], emails: [], peak: 0, at: '', row: 0 };
  let changed = false;
  if (day.devices.indexOf(device) < 0 && day.devices.length < 500) { day.devices.push(device); changed = true; }
  if (day.emails.indexOf(email) < 0 && day.emails.length < 200) { day.emails.push(email); changed = true; }
  const online = summary_(map).total;
  if (online > day.peak) {
    day.peak = online;
    day.at = Utilities.formatDate(new Date(now), TZ, 'HH:mm');
    changed = true;
  }
  if (!changed) return;
  const sheet = tab_('รายวัน', DAY_HEADERS);
  if (!day.row) day.row = sheet.getLastRow() + 1;
  sheet.getRange(day.row, 1, 1, DAY_HEADERS.length).setValues(
    [[day.date, day.devices.length, day.emails.length, day.peak, day.at]]);
  props.setProperty('day', JSON.stringify(day));
}

function view_() {
  const map = read_();
  const result = summary_(map);
  result.people = Object.keys(map).map(function (key) {
    const e = map[key];
    return { email: e.email || '', page: key.split('|')[1], kind: e.kind, os: e.os || '', browser: e.br || '', since: e.s || e.t };
  });
  const day = JSON.parse(PropertiesService.getScriptProperties().getProperty('day') || 'null');
  if (day && day.date === Utilities.formatDate(new Date(), TZ, 'yyyy-MM-dd')) {
    result.today = { devices: day.devices.length, people: day.emails.length, peak: day.peak, at: day.at };
  }
  result.stats = stats_();
  return result;
}

// ข้อมูลกราฟ (จำไว้ 2 นาที): คนรายชั่วโมงของวันนี้, 7 วันล่าสุด, อันดับคนและหน้าใน 7 วัน
function stats_() {
  const cache = CacheService.getScriptCache();
  const hit = cache.get('stats');
  if (hit) return JSON.parse(hit);

  const now = Date.now();
  const HOUR = 3600000;
  const local = function (t) { return t + 7 * HOUR; }; // เวลาไทย ไม่มีปรับฤดู
  const today = Math.floor(local(now) / (24 * HOUR));
  const hours = [];
  for (let h = 0; h < 24; h++) hours.push({});
  const users = {};
  const pages = {};

  const sheet = tab_('การเข้าใช้', SESSION_HEADERS);
  const last = sheet.getLastRow();
  const n = Math.min(last - 1, 3000);
  const rows = n > 0 ? sheet.getRange(last - n + 1, 1, n, SESSION_HEADERS.length).getValues() : [];
  rows.forEach(function (r) {
    const start = new Date(r[0]).getTime();
    const end = new Date(r[1]).getTime();
    if (!(end >= now - 7 * 24 * HOUR)) return;
    users[r[3]] = (users[r[3]] || 0) + Number(r[2]);
    pages[r[4]] = (pages[r[4]] || 0) + Number(r[2]);
    for (let h = Math.floor(local(start) / HOUR); h <= Math.floor(local(end) / HOUR); h++) {
      if (Math.floor(h / 24) === today) hours[h % 24][r[8]] = true;
    }
  });
  const top = function (map) {
    return Object.keys(map).map(function (name) { return { name: name, minutes: map[name] }; })
      .sort(function (a, b) { return b.minutes - a.minutes; }).slice(0, 5);
  };

  const daily = tab_('รายวัน', DAY_HEADERS);
  const end = daily.getLastRow();
  const count = Math.min(end - 1, 7);
  const days = (count > 0 ? daily.getRange(end - count + 1, 1, count, 3).getValues() : []).map(function (r) {
    const date = r[0] instanceof Date ? Utilities.formatDate(r[0], TZ, 'yyyy-MM-dd') : String(r[0]);
    return { date: date, devices: Number(r[1]), people: Number(r[2]) };
  });

  const result = {
    hours: hours.map(function (set) { return Object.keys(set).length; }),
    days: days,
    users: top(users),
    pages: top(pages)
  };
  cache.put('stats', JSON.stringify(result), 120);
  return result;
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

function tab_(name, headers) {
  const book = book_();
  let sheet = book.getSheetByName(name);
  if (!sheet) {
    sheet = book.insertSheet(name);
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
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
  const sheet = tab_('history', HEADERS);
  sheet.getRange(sheet.getLastRow() + 1, 1, rows.length, HEADERS.length).setValues(rows);
  prune_(map, now, props);
}

// วันละครั้ง ลบแถวเก่าเกินกำหนด (แถวเรียงตามเวลาเริ่ม ของเก่าอยู่บน)
function prune_(map, now, props) {
  if (now - Number(props.getProperty('lastPrune') || 0) < 86400000) return;
  props.setProperty('lastPrune', String(now));
  const limit = now - KEEP_DAYS * 86400000;
  dropOld_(tab_('history', HEADERS), limit);
  const removed = dropOld_(tab_('การเข้าใช้', SESSION_HEADERS), limit);
  if (removed) Object.keys(map).forEach(function (key) { if (map[key].row) map[key].row -= removed; });
}

function dropOld_(sheet, limit) {
  const last = sheet.getLastRow();
  if (last < 3) return 0;
  const times = sheet.getRange(2, 1, last - 1, 1).getValues();
  let old = 0;
  while (old < times.length - 1 && new Date(times[old][0]).getTime() < limit) old++;
  if (old) sheet.deleteRows(2, old);
  return old;
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

// ครั้งแรกหลังวางโค้ด (และหลังอัปเดตโค้ด): เรียกใช้ฟังก์ชันนี้แล้วกดอนุญาต
function authorize() {
  UrlFetchApp.fetch('https://www.google.com');
  const book = book_();
  book.setSpreadsheetTimeZone(TZ);
  tab_('history', HEADERS).getRange('A:A').setNumberFormat(TIME_FORMAT);
  tab_('การเข้าใช้', SESSION_HEADERS).getRange('A:B').setNumberFormat(TIME_FORMAT);
  tab_('รายวัน', DAY_HEADERS).getRange('A:A').setNumberFormat('dd/mm/yyyy');
  summaryTab_(book);
  Logger.log('ข้อมูลเก็บที่: ' + book.getUrl());
  Logger.log(ADMIN_EMAIL ? 'ผู้ดูได้: ' + ADMIN_EMAIL : 'ยังไม่ได้ใส่ ADMIN_EMAIL');
}

function summaryTab_(book) {
  const sheet = book.getSheetByName('สรุป') || book.insertSheet('สรุป');
  const query = function (cell, select) {
    sheet.getRange(cell).setFormula('=QUERY(\'การเข้าใช้\'!A:I,"' + select + '",1)');
  };
  query('A1', "select D, sum(C), count(C) where D is not null group by D order by sum(C) desc label D 'อีเมล', sum(C) 'นาทีรวม', count(C) 'ครั้ง'");
  query('E1', "select E, sum(C), count(C) where E is not null group by E order by sum(C) desc label E 'หน้า', sum(C) 'นาทีรวม', count(C) 'ครั้ง'");
  query('I1', "select hour(A), count(E) where A is not null group by hour(A) order by hour(A) label hour(A) 'ชั่วโมง', count(E) 'ครั้ง'");
  query('L1', "select F, G, H, count(E) where E is not null group by F, G, H order by count(E) desc label F 'ชนิดเครื่อง', G 'ระบบ', H 'บราวเซอร์', count(E) 'ครั้ง'");
  sheet.setFrozenRows(1);
}
