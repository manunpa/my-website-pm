/**
 * ตัวนับโควตา Google Maps / Street View รายเดือน — ใช้ร่วมกัน 2 เว็บ (key Google ตัวเดียวกัน):
 *   - my-website-pm  (หน้า access-maps.html)  Firebase โปรเจกต์ my-login-project-26857
 *   - my-web-p3      (หน้า Maps)              Firebase โปรเจกต์ my-web-p3
 *
 * เว็บเรียกก่อน "สร้างแผนที่ Google" และก่อน "เปิดภาพ Street View" ทุกครั้ง:
 *   POST {idToken, kind:'map'|'sv'} → {status:'ok', ok:true|false, used, limit}
 *   ok:false = เดือนนี้ครบแล้ว เว็บจะไม่โหลด Google (ใช้ OpenStreetMap / ลิงก์ Google Maps แทน)
 * ตัวเลขเก็บใน Script Properties (map_YYYYMM / sv_YYYYMM เวลาไทย) ไม่ต้องใช้ชีต
 *
 * Google ให้ฟรีต่อเดือน: Maps JavaScript 10,000 ครั้ง, Dynamic Street View 5,000 ภาพ → ตั้งเพดานต่ำกว่าไว้กันพลาด
 * แก้ตัวเลขที่นี่แล้วต้องแก้ MAPS_MONTHLY_LIMIT / SV_MONTHLY_LIMIT ในเว็บให้ตรงกัน (ใช้แสดงข้อความเท่านั้น)
 *
 * วิธีติดตั้ง (โปรเจกต์ Apps Script ใหม่ แบบสแตนด์อโลน ไม่ต้องผูกชีต):
 *   1) script.google.com → โปรเจกต์ใหม่ → วางโค้ดนี้ทับทั้งไฟล์ → บันทึก
 *   2) เลือกฟังก์ชัน authorize → เรียกใช้ → อนุญาต (ให้สคริปต์ติดต่อ Firebase เพื่อตรวจ token ได้)
 *   3) การทำให้ใช้งานได้ → การทำให้ใช้งานได้รายการใหม่ → ประเภท "เว็บแอป"
 *      เรียกใช้ในฐานะ: ฉัน · ผู้ที่มีสิทธิ์เข้าถึง: ทุกคน → ทำให้ใช้งานได้ → คัดลอก URL /exec
 */

const LIMITS = { map: 9000, sv: 4500 };

// Firebase โปรเจกต์ที่ยอมรับ: projectId → Web API key (ค่าจาก firebaseConfig ของแต่ละเว็บ ไม่ใช่ความลับ — แยกเป็น 2 ท่อนเพื่อไม่ให้ถูกซ่อนเป็น ••• ตอนคัดลอก)
const FIREBASE_PROJECTS = {
  'my-login-project-26857': ['AIzaSyD7HPOh', 'loICyxEyDTfR8yRiH2rT--q4fVo'].join(''), // my-website-pm (firebase-guard.js)
  'my-web-p3':              ['AIzaSyA5OM2o', 'm_4CnwTuFAixQGwxhtyUUmDjv7Y'].join('')  // my-web-p3 (src/firebase.js)
};

function doPost(e) {
  let body = {};
  try { body = JSON.parse((e && e.postData && e.postData.contents) || '{}'); } catch (err) {}
  if (!verifyFirebaseToken_(body.idToken)) {
    return json_({ status: 'error', error: 'unauthorized', reason: FAIL_REASON_, message: 'เซสชันหมดอายุหรือไม่มีสิทธิ์ กรุณาล็อกอินใหม่' });
  }
  const kind = String(body.kind || '');
  if (!Object.prototype.hasOwnProperty.call(LIMITS, kind)) {
    return json_({ status: 'error', error: 'bad-kind', message: 'ไม่รู้จักประเภทการนับ' });
  }
  return json_(take_(kind));
}

function doGet() {
  return json_({ status: 'error', error: 'unauthorized', message: 'ต้องเข้าสู่ระบบผ่านเว็บก่อน' });
}

// นับเพิ่ม 1 ถ้ายังไม่ครบ (ล็อกไว้ไม่ให้ 2 คนนับพร้อมกันแล้วเกิน)
function take_(kind) {
  const limit = LIMITS[kind];
  const key = kind + '_' + Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMM');
  const lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    const props = PropertiesService.getScriptProperties();
    const used = Number(props.getProperty(key) || 0);
    if (used >= limit) return { status: 'ok', ok: false, used: used, limit: limit };
    props.setProperty(key, String(used + 1));
    return { status: 'ok', ok: true, used: used + 1, limit: limit };
  } finally {
    lock.releaseLock();
  }
}

// ดูยอดเดือนนี้ (เลือกฟังก์ชันนี้แล้วกด "เรียกใช้" → ดูใน "บันทึกการดำเนินการ")
function showUsage() {
  const ym = Utilities.formatDate(new Date(), 'Asia/Bangkok', 'yyyyMM');
  const props = PropertiesService.getScriptProperties();
  Object.keys(LIMITS).forEach(k => Logger.log(k + ' ' + ym + ': ' + (props.getProperty(k + '_' + ym) || 0) + ' / ' + LIMITS[k]));
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
  PropertiesService.getScriptProperties().getKeys();
}
