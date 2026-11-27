import { requireLogin, fetchProtectedText } from './firebase-guard.js?v=20261122-cut';
import { renderCharts } from './leo-charts.js?v=20261127';
/* ===== ตั้งค่าการเชื่อม Google Sheets API ===== */
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbyWoNoFrTC1Ep3j395aio1ZP9E9qrTwubtUei2uydmoHnsIigYk7V8jN29wvl32t84W/exec',
  SHEET_ID: '',          
  API_KEY: '',           
  RANGE: 'Sheet1!A:Q',   
  REFRESH_SEC: 60        
};
const COLS = [
 ['case','Case No'],['code','รหัสคนขับ'],['driver','ชื่อคนขับ'],['plate','ทะเบียนรถ'],['start','วัน/เวลาเริ่ม'],['end','วัน/เวลาสิ้นสุด'],
 ['dur','รวมเวลา'],['status','สถานะรถ'],['place','สถานที่'],['do','เลข DO'],['req','ขอปลด'],['appr','อนุมัติ/ไม่อนุมัติ'],
 ['imp','ความสำคัญ'],['unlockAt','วันที่ปลด'],['unlocker','ผู้ปลด'],['reason','สาเหตุที่ปลดล็อค'],['gps','จำนวน GPS/CCTV']
];
/* ---------- ประเภทการจอด (จากสาเหตุที่ปลดล็อค) ----------
 * มาจากสูตร IFS ใน "สูตรไว้แยก ประเภทการจอด ตาม Keyword ใน cell.txt" (occ share/z BANKเล็ก/BCP)
 * ไล่จากบนลงล่าง เจอคำแรกที่ตรงก็ได้ประเภทนั้น (ไม่สนตัวพิมพ์เล็ก/ใหญ่และช่องว่าง เหมือน SEARCH)
 * เพิ่มคำที่สะกดต่าง (สัญญาน, หน่อยงาน, การจารจร…) และประเภทใหม่จากข้อมูลจริง 955 เคส (1 ต.ค.–23 พ.ย. 69)
 * แก้คำ/เพิ่มประเภท: แก้ที่รายการนี้ได้เลย ลำดับมีผล — กลุ่มที่อยู่บนกว่าชนะ */
const STOP_TYPES = [
  ['ติดไฟแดง/สัญญาณไฟ', ['ไฟแดง','สัญญาณไฟ','สัญญานไฟ','ติดไฟแยก','แยกไฟ','รอไฟ','รอสัญญาณ','รอสัญญาน','ทางรถไฟ','รางรถไฟ']],
  ['การจราจรติดขัด', ['จราจร','รถติด','ติดขัด','เคลื่อนตัวช้า','ชะลอ','ชลอ','หนาแน่น','อุบัติเหตุ']],
  ['เปลี่ยนขับ', ['เปลี่ยนขับ','เปลี่ยนคนขับ','เปลี่ยนมือขับ','เปลี่ยนพขร','เปลี่ยนพนักงาน']],
  ['อยู่ลูกค้า', ['ลูกค้า','ลงน้ำมัน','ส่งน้ำมัน','ลงสินค้า']],
  ['เติมน้ำมัน', ['เติมน้ำมัน','เติมน้ำ','ฟลีตการ์ด','ฟลีทการ์ด','fleetcard']],
  ['เข้าห้องน้ำ/ส่วนตัว', ['ห้องน้ำ','ปัสสาวะ','ปัสวะ','ปวดท้อง','ล้างหน้า','ธุระ']],
  ['เรือข้ามฟาก', ['เรือ']],
  ['จอดหน่วยงาน/คลัง', ['หน่วยงาน','หน่อยงาน','คลัง','ฟลีท','hub']],
  ['จุดลงเวลา/ด่าน/ทางด่วน', ['ลงเวลา','ตัดเวลา','ด่าน','ค่าผ่านทาง','ทางด่วน','stopwork']],
  ['พักรถ/ทานข้าว', ['พักรถ','จุดพัก','จอดพัก','ขอพัก','กินข้าว','ทานข้าว','ซื้อข้าว','ทานอาหาร']],
  ['ซ่อมบำรุง/ยาง', ['รถเสีย','ช่าง','hino','scania','สแกนเนีย','ฮีโน่','pm','ศูนย์','ยาง','ซ่อม','อู่','อู๋','ความร้อน','ลมรั่ว','เสียงดัง','ตรวจสอบรถ','เช็ครถ']],
  ['โทรศัพท์/ติดต่อ', ['โทรศัพท์','เส้นทาง','ติดต่อ','หัวหน้างาน']],
  ['GPS/ระบบ', ['gps','ออฟไลน์','สัญญาณผิดปกติ','ไม่ได้จอด','ไม่มีการจอด','ไม่พบการจอด']],
  ['รถไม่ได้วิ่งงาน', ['ไม่ได้วิ่ง','ไม่มีวิ่งงาน','ไม่ได้ใช้วิ่งงาน','ไม่มีงาน']],
].map(([name, words]) => [name, words.map(w => w.toLowerCase().replace(/\s+/g,''))]);
const OTHER_TYPE = 'อื่นๆ';
function stopType(reason){
  const t = String(reason == null ? '' : reason).toLowerCase().replace(/\s+/g,'');
  if(!t) return OTHER_TYPE;
  for(const [name, words] of STOP_TYPES) if(words.some(w => t.includes(w))) return name;
  return OTHER_TYPE;
}
// คอลัมน์ที่แสดง (ตาราง / รายละเอียด / CSV) = คอลัมน์จากชีต + ประเภทการจอดต่อจากสาเหตุ
const VIEW_COLS = COLS.flatMap(c => c[0] === 'reason' ? [c, ['cat','ประเภทการจอด']] : [c]);

const DEMO = `DEMO-0010|CAR-01|นายสมมติ ตัวอย่างหนึ่ง|1กข1001|31/10/2026 23:04:32|01/11/2026 00:15:24|01:10:52|จอดนอกจุด|บางนา, กรุงเทพมหานคร|9000000001|พิจารณาแล้ว|อนุมัติ|A|01/11/2026 03:32:08|ADMIN|ลงสินค้าที่ลูกค้า (ข้อมูลตัวอย่าง)|2 (1/1)
DEMO-0009|CAR-02|นายทดสอบ ระบบดี|1กข1002|31/10/2026 23:33:37|31/10/2026 23:36:17|00:02:40|จอดนอกจุด|บางนา, กรุงเทพมหานคร|9000000002,9000000003|พิจารณาแล้ว|อนุมัติ|A|01/11/2026 03:31:59|ADMIN|การจราจรหนาแน่น|2 (1/1)
DEMO-0008|CAR-03|นายจำลอง ใจเย็น|1กข1003|31/10/2026 20:58:36|31/10/2026 21:01:01|00:02:25|จอดนอกจุด|ลำลูกกา, ปทุมธานี|9000000004|พิจารณาแล้ว|อนุมัติ|A|31/10/2026 21:32:29|ADMIN|จอดติดไฟแดง|2 (1/1)
DEMO-0007|CAR-04|นายตัวอย่าง ขับดี|1กข1004|31/10/2026 19:25:46|31/10/2026 19:28:46|00:03:00|จอดนอกจุด|ลำลูกกา, ปทุมธานี|9000000005,9000000006|พิจารณาแล้ว|อนุมัติ|A|31/10/2026 19:56:47|ADMIN|จอดติดไฟแดง|2 (1/1)
DEMO-0006|CAR-05|นายสาธิต ปลอดภัย|1กข1005|31/10/2026 19:09:31|31/10/2026 19:11:38|00:02:07|จอดนอกจุด|วังน้อย, พระนครศรีอยุธยา|9000000007,9000000008|พิจารณาแล้ว|อนุมัติ|A|31/10/2026 19:34:02|ADMIN|พขร ขอจอดพัก|2 (1/1)
DEMO-0005|CAR-04|นายตัวอย่าง ขับดี|1กข1004|31/10/2026 18:16:46|31/10/2026 18:18:48|00:02:02|จอดนอกจุด|บางพลี, สมุทรปราการ|9000000005,9000000006|พิจารณาแล้ว|อนุมัติ|A|31/10/2026 18:57:05|ADMIN|การจราจรติดขัด|2 (1/1)
DEMO-0004|CAR-06|นายเดโม สมมติฐาน|1กข1006|31/10/2026 15:01:56|31/10/2026 16:40:44|01:38:48|จอดนอกจุด|ลำลูกกา, ปทุมธานี|9000000009,9000000010|พิจารณาแล้ว|อนุมัติ|A|31/10/2026 18:25:42|REVIEWER|อยู่ที่ลูกค้า|2 (1/1)
DEMO-0003|CAR-07|นายทดลอง ใช้งาน|1กข1002|31/10/2026 16:30:47|31/10/2026 16:32:53|00:02:06|จอดนอกจุด|ลำลูกกา, ปทุมธานี|9000000011,9000000012|พิจารณาแล้ว|อนุมัติ|A|31/10/2026 17:23:32|REVIEWER|จอดติดไฟแดง|2 (1/1)
DEMO-0002|CAR-01|นายสมมติ ตัวอย่างหนึ่ง|1กข1001|31/10/2026 15:22:35|31/10/2026 15:28:54|00:06:19|จอดนอกจุด|วังน้อย, พระนครศรีอยุธยา|9000000013|พิจารณาแล้ว|อนุมัติ|A|31/10/2026 16:11:42|REVIEWER|ไม่ได้วิ่งงาน|2 (1/1)
DEMO-0001|CAR-01|นายสมมติ ตัวอย่างหนึ่ง|1กข1001|31/10/2026 13:22:40|31/10/2026 14:42:34|01:19:54|จอดนอกจุด|หนองแค, สระบุรี|9000000013|พิจารณาแล้ว|อนุมัติ|A|31/10/2026 14:56:06|REVIEWER|ไม่ได้วิ่งงาน|2 (1/1)`;

const $ = id => document.getElementById(id);
// Sheet text goes into innerHTML below: escape it so a cell like <img onerror=...> shows as text, never runs.
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
let ROWS = [], sortKey = 'start', sortDir = -1, mode = 'demo', timer;

/* ---------- ธีม ---------- */
function setTheme(t){
  document.documentElement.dataset.theme = t;
  const themeBtn = $('theme');
  // ไอคอนลายเส้น: โทนมืดแสดงดวงอาทิตย์ โทนสว่างแสดงพระจันทร์
  if(themeBtn) themeBtn.innerHTML = t === 'dark'
    ? '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>'
    : '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/></svg>';

}
// หน้านี้เริ่มที่โทนสว่างเสมอ จำเฉพาะเมื่อกดปุ่มสลับเอง (แยกคีย์จากหน้าอื่น)
let saved = null; try{ saved = localStorage.getItem('leo-theme') }catch(e){}
setTheme(saved || 'light');
const themeBtnEl = $('theme');
if(themeBtnEl) themeBtnEl.onclick = () => {
  const t = document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark';
  setTheme(t);
  try{ localStorage.setItem('leo-theme', t) }catch(e){}
};

/* ---------- ข้อมูล ---------- */
function parseDT(s){
  s = (s == null ? '' : String(s)).trim();
  let y,mo,d,hh=0,mi=0,ss=0,m;
  const t = '(?:[ T,]+(\\d{1,2}):(\\d{2})(?::(\\d{2}))?)?';
  if((m = new RegExp('(\\d{1,2})[/\\-.](\\d{1,2})[/\\-.](\\d{4})'+t).exec(s))){ d=+m[1]; mo=+m[2]; y=+m[3]; hh=+(m[4]||0); mi=+(m[5]||0); ss=+(m[6]||0); }
  else if((m = new RegExp('(\\d{4})[/\\-.](\\d{1,2})[/\\-.](\\d{1,2})'+t).exec(s))){ y=+m[1]; mo=+m[2]; d=+m[3]; hh=+(m[4]||0); mi=+(m[5]||0); ss=+(m[6]||0); }
  else return null;
  if(y > 2400) y -= 543;
  const dt = new Date(y, mo-1, d, hh, mi, ss);
  return isNaN(dt) ? null : dt;
}
const TZ_OFFSET_H = 7;
const SHEET_EPOCH = Date.UTC(1899,11,30) - (6*3600+42*60+4)*1000;
const isISO = s => /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?Z$/.test(s);
const p2 = n => String(n).padStart(2,'0');
function secToHMS(t){t=Math.max(0,Math.round(t));return `${Math.floor(t/3600)}:${p2(Math.floor(t%3600/60))}:${p2(t%60)}`}

function cleanDate(v){
  v = String(v == null ? '' : v).trim();
  if(!isISO(v)) return v;
  if(v.startsWith('1899') || v.startsWith('1900')) return secToHMS((Date.parse(v) - SHEET_EPOCH)/1000);
  const d = new Date(Date.parse(v) + TZ_OFFSET_H*3600e3);
  return `${p2(d.getUTCDate())}/${p2(d.getUTCMonth()+1)}/${d.getUTCFullYear()} ${p2(d.getUTCHours())}:${p2(d.getUTCMinutes())}:${p2(d.getUTCSeconds())}`;
}
function durSec(s){
  s = String(s == null ? '' : s).trim();
  if(isISO(s)) s = cleanDate(s);
  const p = s.split(':').map(Number);
  return p.length === 3 && p.every(n => !isNaN(n)) ? p[0]*3600+p[1]*60+p[2] : 0;
}
function fmtDur(sec){const h=Math.floor(sec/3600),m=Math.floor(sec%3600/60),s=Math.round(sec%60);return h?`${h} ชม. ${m} นาที`:m?`${m} นาที ${s} วิ`:`${s} วิ`}
function build(arr){
  return arr.filter(r => r[0]).map(r => {
    const o = {}; COLS.forEach((c,i) => o[c[0]] = (r[i] ?? '').toString().trim());
    ['start','end','unlockAt','dur'].forEach(k => o[k] = cleanDate(o[k])); o.do = fixDO(o.do); o.startD = parseDT(o.start); o.endD = parseDT(o.end); o.unlockD = parseDT(o.unlockAt); o.sec = durSec(o.dur); o.cat = stopType(o.reason);
    return o;
  }).filter(o => o.startD);
}

const nk = x => String(x == null ? '' : x).replace(/\s+/g,'').toLowerCase();
function normalize(j){
  const tables = [], heads = [];
  (function walk(o){
    if(Array.isArray(o)){
      if(o.length && o.every(x => x && typeof x === 'object')) tables.push(o);
      if(o.length >= 8 && o.every(x => typeof x === 'string') && o.some(x => nk(x) === 'caseno')) heads.push(o);
      o.forEach(walk);
    } else if(o && typeof o === 'object') Object.values(o).forEach(walk);
  })(j);
  if(!tables.length) throw new Error('รูปแบบข้อมูลไม่ถูกต้อง: ' + JSON.stringify(j).slice(0,140));
  let d = tables.sort((x,y) => y.length - x.length)[0];

  if(Array.isArray(d[0])){
    let header = null, rows = d;
    if(nk(d[0][0]) === 'caseno' || d[0].some(x => nk(x) === 'caseno')){ header = d[0]; rows = d.slice(1); }
    else if(heads.length){ header = heads[0]; }
    if(header){
      const hn = header.map(nk);
      const idx = COLS.map((c,i) => { let k = hn.indexOf(nk(c[1])); if(k < 0) k = hn.findIndex(h => h.startsWith(nk(c[1]).slice(0,4))); return k >= 0 ? k : i; });
      return rows.map(r => idx.map(i => r[i]));
    }
    return rows;
  }
  return d.map(o => {
    const m = {}; Object.keys(o).forEach(k => m[nk(k)] = o[k]);
    const vals = Object.values(o);
    return COLS.map((c,i) => {
      const t = nk(c[1]).slice(0,4);
      const fk = Object.keys(m).find(k => k.startsWith(t));
      return m[nk(c[1])] ?? m[nk(c[0])] ?? (fk !== undefined ? m[fk] : undefined) ?? vals[i];
    });
  });
}

function fixDO(v){
  v = String(v == null ? '' : v).trim();
  if(/e\+/i.test(v) && !isNaN(Number(v))) v = Number(v).toFixed(0);
  if(/^\d{1,3}(,\d{3}){3,}$/.test(v)) v = v.replace(/,/g,'');
  if(/^\d{14,}$/.test(v)) return v.slice(0,10);
  return v;
}
function buildChecked(j){
  const raw = normalize(j);
  const rows = build(raw);
  if(!rows.length){
    const sample = raw[0] ? JSON.stringify(raw[0]).slice(0,160) : '(ไม่มีแถวข้อมูล)';
    throw new Error(`อ่านได้ ${raw.length} แถว แต่ใช้งานไม่ได้ ตัวอย่าง: ${sample}`);
  }
  return rows;
}
async function load(){
  const dotEl = $('dot'), stTextEl = $('stText'), stTimeEl = $('stTime');
  if(dotEl) dotEl.className = 'dot'; 
  if(stTextEl) stTextEl.textContent = 'กำลัง Sync...';
  try{
    if(CONFIG.API_URL){
      // แนบ Firebase ID token ไปให้ Apps Script ตรวจ (apps-script/leo.gs) — URL เดิม ...XBkH3V ยังเปิดไว้ให้ my-web-p3
      const j = JSON.parse(await fetchProtectedText(CONFIG.API_URL));
      if(j && j.error) throw new Error(j.error);
      ROWS = buildChecked(j); mode = 'live';
    } else if(CONFIG.SHEET_ID && CONFIG.API_KEY){
      const url = `https://sheets.googleapis.com/v4/spreadsheets/${CONFIG.SHEET_ID}/values/${encodeURIComponent(CONFIG.RANGE)}?key=${CONFIG.API_KEY}&valueRenderOption=FORMATTED_VALUE`;
      const res = await fetch(url);
      if(!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
      ROWS = buildChecked(j); mode = 'live';
    } else {
      ROWS = build(DEMO.split('\n').map(l => l.split('|'))); mode = 'demo';
    }
    if(dotEl) dotEl.className = 'dot ' + (mode === 'live' ? 'live' : 'demo');
    if(stTextEl) stTextEl.textContent = mode === 'live' ? 'Synced กับ Server' : 'ข้อมูลตัวอย่าง (ยังไม่ได้เชื่อม Server)';
    if(stTimeEl) stTimeEl.textContent = '· Synced ล่าสุด ' + new Date().toLocaleString('th-TH', {dateStyle:'medium', timeStyle:'medium'});
    fillSelects(); render();
  }catch(e){
    if(dotEl) dotEl.className = 'dot err';
    if(stTextEl) stTextEl.textContent = 'Sync failed: ' + e.message;
  }
}
function fillSelects(){
  const fill = (id, vals, label) => {
    const el = $(id);
    if(!el) return;
    const cur = el.value;
    el.innerHTML = `<option value="">${label}</option>` + [...new Set(vals)].filter(Boolean).sort().map(v => `<option>${esc(v)}</option>`).join('');
    el.value = cur;
  };
  fill('fDriver', ROWS.map(r => r.driver), 'ทั้งหมด');
  fill('fUnlocker', ROWS.map(r => r.unlocker), 'ทั้งหมด');
  // ประเภทการจอด: เรียงตามรายการกฎ (ไม่ใช่ตามตัวอักษร) แสดงเฉพาะที่มีในข้อมูล
  const catEl = $('fCat');
  if(catEl){
    const cur = catEl.value, have = new Set(ROWS.map(r => r.cat));
    catEl.innerHTML = '<option value="">ทั้งหมด</option>' + [...STOP_TYPES.map(t => t[0]), OTHER_TYPE].filter(n => have.has(n)).map(n => `<option>${esc(n)}</option>`).join('');
    catEl.value = have.has(cur) ? cur : '';
  }
}

/* ---------- ฟิลเตอร์ ---------- */
const pad = n => String(n).padStart(2,'0');
const toLocal = d => `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
let nightOnly = false;
function preset(p){
  const now = new Date(), sod = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  nightOnly = p === 'night';
  const fromEl = $('from'), toEl = $('to');
  if(p==='all' || p==='night'){ if(fromEl) fromEl.value = ''; if(toEl) toEl.value = ''; }
  else if(p==='today'){ if(fromEl) fromEl.value = toLocal(sod); if(toEl) toEl.value = toLocal(new Date(sod.getTime()+864e5-6e4)); }
  else if(p==='yesterday'){ const y = new Date(sod.getTime()-864e5); if(fromEl) fromEl.value = toLocal(y); if(toEl) toEl.value = toLocal(new Date(sod.getTime()-6e4)); }
  else { if(fromEl) fromEl.value = toLocal(new Date(sod.getTime()-(+p-1)*864e5)); if(toEl) toEl.value = toLocal(new Date(sod.getTime()+864e5-6e4)); }
  document.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.p === p));
  render();
}
function filtered(range){
  const fromEl = $('from'), toEl = $('to'), qEl = $('q'), drEl = $('fDriver'), unEl = $('fUnlocker'), duEl = $('fDur');
  const f = range ? range[0] : fromEl && fromEl.value ? new Date(fromEl.value) : null;
  const t = range ? range[1] : toEl && toEl.value ? new Date(toEl.value) : null;
  const q = qEl ? qEl.value.trim().toLowerCase() : '';
  const dr = drEl ? drEl.value : '';
  const un = unEl ? unEl.value : '';
  const du = duEl ? duEl.value : '';
  const catEl = $('fCat'), cat = catEl ? catEl.value : '';
  return ROWS.filter(r => {
    if(cat && r.cat !== cat) return false;
    if(f && r.startD < f) return false;
    if(t && r.startD > t) return false;
    if(nightOnly){ const h = r.startD.getHours(); if(!(h >= 22 || h < 6)) return false; }
    if(dr && r.driver !== dr) return false;
    if(un && r.unlocker !== un) return false;
    if(du === '5' && r.sec > 300) return false;
    if(du === '30' && !(r.sec > 300 && r.sec <= 1800)) return false;
    if(du === '31' && r.sec <= 1800) return false;
    if(q && !Object.values(r).join(' ').toLowerCase().includes(q)) return false;
    return true;
  });
}

/* ---------- แสดงผล ---------- */
function countBy(arr, fn){const m={};arr.forEach(r=>{const k=fn(r);if(k)m[k]=(m[k]||0)+1});return Object.entries(m).sort((a,b)=>b[1]-a[1])}
function hbars(id, data, n=6){
  const el = $(id);
  if(!el) return;
  const top = data.slice(0,n), max = top[0] ? top[0][1] : 1;
  el.innerHTML = top.length ? top.map(([k,v]) => `<div class="hbar"><span class="t" title="${esc(k)}">${esc(k)}</span><div class="tr"><div class="f" style="width:${v/max*100}%"></div></div><b>${v}</b></div>`).join('') : '<div class="empty">ไม่มีข้อมูล</div>';
}
const MTH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
function drawBars(id, items){
  const el = $(id);
  if(!el) return;
  const mx = Math.max(1, ...items.map(i => i.v));
  el.innerHTML = items.length
    ? items.map(i => `<div class="col" title="${i.t}"><span class="n">${i.v||''}</span><div class="b" style="height:${i.v/mx*100}px"></div><span class="x">${i.x||''}</span></div>`).join('')
    : '<div class="empty">ไม่มีข้อมูล</div>';
}
function renderTrend(d){
  const key = x => `${x.getFullYear()}-${x.getMonth()}-${x.getDate()}`;
  const day = {}; d.forEach(r => { const k = key(r.startD); day[k] = (day[k]||0) + 1; });
  const days = [];
  if(d.length){
    const ts = d.map(r => r.startD.getTime());
    const maxT = Math.max(...ts), minT = Math.min(...ts);
    let cur = new Date(Math.max(minT, maxT - 59*864e5)); cur.setHours(0,0,0,0);
    const last = new Date(maxT); last.setHours(0,0,0,0);
    for(; cur <= last; cur = new Date(cur.getFullYear(), cur.getMonth(), cur.getDate()+1)){
      const v = day[key(cur)] || 0;
      days.push({
        v,
        x: (cur.getDate()===1 || !days.length) ? `${cur.getDate()} ${MTH[cur.getMonth()]}` : cur.getDate(),
        t: `${cur.getDate()} ${MTH[cur.getMonth()]} ${cur.getFullYear()+543}: ${v} เคส`
      });
    }
  }
  drawBars('cDay', days);

  const mon = {}; d.forEach(r => { const k = r.startD.getFullYear()*100 + r.startD.getMonth(); mon[k] = (mon[k]||0) + 1; });
  drawBars('cMonth', Object.keys(mon).sort().map(k => {
    const y = Math.floor(k/100), m = k%100;
    return {v: mon[k], x: `${MTH[m]} ${String(y+543).slice(-2)}`, t: `${MTH[m]} ${y+543}: ${mon[k]} เคส`};
  }));
}
function render(){
  const d = filtered();
  const tot = d.reduce((a,r)=>a+r.sec,0), avg = d.length ? tot/d.length : 0;
  const longest = d.reduce((a,r)=>r.sec>(a?a.sec:-1)?r:a, null);
  const approved = d.filter(r => r.appr.includes('อนุมัติ') && !r.appr.includes('ไม่')).length;
  const lag = d.filter(r=>r.unlockD).map(r=>(r.unlockD-r.endD)/1000).filter(x=>x>=0);
  const avgLag = lag.length ? lag.reduce((a,b)=>a+b,0)/lag.length : 0;
  
  const kpisEl = $('kpis');
  if(kpisEl){
    kpisEl.innerHTML = [
      ['เคสทั้งหมด', d.length, `${new Set(d.map(r=>r.plate)).size} คัน`],
      ['อนุมัติแล้ว', approved, d.length ? Math.round(approved/d.length*100)+'% ของเคส' : '-'],
      ['เวลาจอดเฉลี่ย', fmtDur(avg), 'ต่อเคส'],
      ['เวลาจอดรวม', fmtDur(tot), ''],
      ['จอดนานสุด', longest ? longest.dur : '-', longest ? longest.case : ''],
      ['คนขับที่เกี่ยวข้อง', new Set(d.map(r=>r.driver)).size, 'คน'],
      ['เวลาปลดเฉลี่ยหลังจบเคส', fmtDur(avgLag), 'จากเวลาสิ้นสุดถึงวันที่ปลด']
    ].map(k => `<div class="panel kpi"><div class="l">${k[0]}</div><div class="v">${esc(k[1])}</div><div class="s">${esc(k[2])}</div></div>`).join('');
  }

  const hrs = Array(24).fill(0); d.forEach(r => hrs[r.startD.getHours()]++);
  const mx = Math.max(1, ...hrs);
  const cHourEl = $('cHour');
  if(cHourEl){
    cHourEl.innerHTML = hrs.map((v,h) => `<div class="col" title="${pad(h)}:00 = ${v} เคส"><span class="n">${v||''}</span><div class="b" style="height:${v/mx*100}px"></div><span class="x">${h%3===0?pad(h):''}</span></div>`).join('');
  }
  hbars('cUnlock', countBy(d, r=>r.unlocker));
  hbars('cDriver', countBy(d, r=>r.driver));
  hbars('cReason', countBy(d, r=>r.reason.replace(/[\d.,]+\s*,\s*[\d.]+\s*/,'').slice(0,40)));
  hbars('cCat', countBy(d, r=>r.cat), STOP_TYPES.length + 1);
  renderTrend(d);
  renderCharts(chartData(d));

  d.sort((a,b) => {
    const k = sortKey, map = {start:'startD', end:'endD', unlockAt:'unlockD', dur:'sec'};
    const x = a[map[k]||k], y = b[map[k]||k];
    return (x > y ? 1 : x < y ? -1 : 0) * sortDir;
  });
  
  const theadEl = $('thead'), tbodyEl = $('tbody'), countEl = $('count');
  if(theadEl) theadEl.innerHTML = VIEW_COLS.map(c => `<th data-k="${c[0]}">${c[1]}${sortKey===c[0]?(sortDir>0?' ▲':' ▼'):''}</th>`).join('');
  if(tbodyEl){
    tbodyEl.innerHTML = d.length ? d.map((r,i) => `<tr data-i="${ROWS.indexOf(r)}">` + VIEW_COLS.map(c => {
      let v = esc(r[c[0]]);
      if(c[0]==='dur') v = `<span class="${r.sec>1800?'long':''}">${v}</span>`;
      else if(c[0]==='cat') v = `<span class="tag cat${r.cat===OTHER_TYPE?' other':''}">${v}</span>`;
      else if(c[0]==='appr') v = `<span class="tag">${v}</span>`;
      else if(c[0]==='req') v = `<span class="tag warn">${v}</span>`;
      return `<td>${v}</td>`;
    }).join('') + '</tr>').join('') : `<tr><td colspan="${VIEW_COLS.length}" class="empty">ไม่พบข้อมูลในช่วงที่เลือก</td></tr>`;
  }
  if(countEl) countEl.textContent = `แสดง ${d.length} จาก ${ROWS.length} รายการ`;
  window._d = d;
}

// ช่วงวันที่ของกราฟวิเคราะห์: ตามช่องตั้งแต่/ถึง ถ้าเว้นว่างใช้ข้อมูลแรกถึงล่าสุด
// prev = ช่วงยาวเท่ากันก่อนหน้า (ตัวกรองอื่นเหมือนเดิม) มีเมื่อเลือกวันเริ่มแล้วเท่านั้น
function chartData(rows){
  const f = $('from').value ? new Date($('from').value).getTime() : null;
  const t = $('to').value ? new Date($('to').value).getTime() + 6e4 : null;
  if(!rows.length) return {rows, prev: null, range: null};
  const times = rows.map(r => r.startD.getTime());
  const day = ms => new Date(ms).setHours(0,0,0,0);
  const range = {from: f ?? day(times.reduce((a, b) => Math.min(a, b))), to: t ?? day(times.reduce((a, b) => Math.max(a, b))) + 864e5};
  const prev = f === null ? null : filtered([new Date(2*range.from - range.to), new Date(range.from - 1)]);
  return {rows, prev, range};
}

/* ---------- อีเวนต์ ---------- */
const presetsEl = $('presets');
if(presetsEl) presetsEl.onclick = e => e.target.dataset.p && preset(e.target.dataset.p);
['from','to'].forEach(id => {
  const el = $(id);
  if(el) el.onchange = () => { nightOnly = false; document.querySelectorAll('.chip').forEach(c=>c.classList.remove('on')); render(); };
});
['q','fDriver','fUnlocker','fDur','fCat'].forEach(id => {
  const el = $(id);
  if(el) el.oninput = render;
});
const theadEl = $('thead');
if(theadEl) theadEl.onclick = e => { const k = e.target.dataset.k; if(!k) return; sortDir = sortKey===k ? -sortDir : 1; sortKey = k; render(); };

const tbodyEl = $('tbody');
if(tbodyEl){
  tbodyEl.onclick = e => {
    const tr = e.target.closest('tr'); if(!tr || tr.dataset.i === undefined) return;
    const r = ROWS[+tr.dataset.i];
    const mTitle = $('mTitle'), mBody = $('mBody'), modal = $('modal');
    if(mTitle) mTitle.textContent = r.case;
    if(mBody) mBody.innerHTML = VIEW_COLS.map(c => `<b>${c[1]}</b><span>${esc(r[c[0]] || '-')}</span>`).join('');
    if(modal) modal.classList.add('show');
  };
}

const mCloseEl = $('mClose');
if(mCloseEl) mCloseEl.onclick = () => { const modal = $('modal'); if(modal) modal.classList.remove('show'); };
const modalEl = $('modal');
if(modalEl) modalEl.onclick = e => { if(e.target === modalEl) modalEl.classList.remove('show') };

const refreshEl = $('refresh');
if(refreshEl) refreshEl.onclick = load;

const csvEl = $('csv');
if(csvEl){
  csvEl.onclick = () => {
    const rows = [VIEW_COLS.map(c=>c[1])].concat((window._d||[]).map(r => VIEW_COLS.map(c => r[c[0]])));
    const csv = '\ufeff' + rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'})); a.download = 'unlock-cases.csv'; a.click();
  };
}

// ===== Firebase: ตรวจสิทธิ์ / Logout / ตัด Session (ดู firebase-guard.js) =====
// โหลดข้อมูลและเริ่มรีเฟรชอัตโนมัติหลังยืนยันตัวตนแล้วเท่านั้น
requireLogin(() => {
  load();
  if(CONFIG.REFRESH_SEC > 0) timer = setInterval(load, CONFIG.REFRESH_SEC * 1000);
});
