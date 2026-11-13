/* ===== ตั้งค่าการเชื่อม Google Sheets API ===== */
const CONFIG = {
  API_URL: 'https://script.google.com/macros/s/AKfycbwrioeYqCEg1abXWwa-tdlLb16qPUDYLK6TSIT6N6PpmQWryOKgC8kzWGe3pXEBkH3V/exec',
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
const DEMO = `PK-261101-0001|SCC0066|นายประภาส ขาวผิว|7003035กท|31/10/2026 23:04:32|01/11/2026 00:15:24|01:10:52|จอดนอกจุด|บางนาเหนือ, บางนา, กรุงเทพมหานคร|3100128293|พิจารณาแล้ว|อนุมัติ|A|01/11/2026 03:32:08|KNM|ลงน้ำมัน บริษัท พี.เอ. บางนา จำกัด|2 (1/1)
PK-261031-0103|SCC0359|นายนิวัฒน์ แข็งการ|636228กท|31/10/2026 23:33:37|31/10/2026 23:36:17|00:02:40|จอดนอกจุด|112/1-215 ถนนบางนา-ตราด แขวงบางนา เขตบางนา กรุงเทพมหานคร 10260|3100128975,3100128982|พิจารณาแล้ว|อนุมัติ|A|01/11/2026 03:31:59|KNM|13.6668367,100.6408417 การจราจรหนาแน่น|2 (1/1)
PK-261031-0096|SCC0069|นายโชคชัย ครรัตน์|676194กท|31/10/2026 20:58:36|31/10/2026 21:01:01|00:02:25|จอดนอกจุด|ถนนลำลูกกา ตำบลลาดสวาย อำเภอลำลูกกา จังหวัดปทุมธานี 12150|3100127022|พิจารณาแล้ว|อนุมัติ|A|31/10/2026 21:32:29|KNM|จอดติดไฟแดงแยกทางเข้าออกหน่วยงาน SC LLK|2 (1/1)
PK-261031-0091|SCC0352|นายวัชรพงษ์ ชัยพรฐโรจน์|685031กท|31/10/2026 19:25:46|31/10/2026 19:28:46|00:03:00|จอดนอกจุด|ถนนลำลูกกา ตำบลลาดสวาย อำเภอลำลูกกา จังหวัดปทุมธานี 12150|3100127298,3100127302|พิจารณาแล้ว|อนุมัติ|A|31/10/2026 19:56:47|KNM|จอดติดไฟแดงแยกทางเข้าออกหน่วยงาน SC LLK|2 (1/1)
PK-261031-0090|SCC0357|นายเฉลิมชัย โพธิดา|636232กท|31/10/2026 19:09:31|31/10/2026 19:11:38|00:02:07|จอดนอกจุด|ถนนกาญจนาภิเษก ถนนบริการชั้นใน ตำบลพยอม อำเภอวังน้อย จังหวัดพระนครศรีอยุธยา 13170|3100127307,3100127309|พิจารณาแล้ว|อนุมัติ|A|31/10/2026 19:34:02|KNM|พขร ขอจอดพัก มีอาการปวดหลัง TMS คุณานน|2 (1/1)
PK-261031-0084|SCC0352|นายวัชรพงษ์ ชัยพรฐโรจน์|685031กท|31/10/2026 18:16:46|31/10/2026 18:18:48|00:02:02|จอดนอกจุด|หน้าผาถนนบางนา-ตราด ตำบลบางแก้ว อำเภอบางพลี จังหวัดสมุทรปราการ 10540|3100127298,3100127302|พิจารณาแล้ว|อนุมัติ|A|31/10/2026 18:57:05|KNM|การจราจรติดขัด|2 (1/1)
PK-261031-0077|SCC0061|นายรุ่งนิรันตร์ ชัยมงคล|677813กท|31/10/2026 15:01:56|31/10/2026 16:40:44|01:38:48|จอดนอกจุด|พืชอุดม, ลำลูกกา, ปทุมธานี|3100127301,3100127306|พิจารณาแล้ว|อนุมัติ|A|31/10/2026 18:25:42|PHU_DMD|อยู่ลูกค้า บริษัท โชคนาราวาณิชย์ จำกัด|2 (1/1)
PK-261031-0076|SCC0347|นายโยธิน อินทรปัญญา|636228กท|31/10/2026 16:30:47|31/10/2026 16:32:53|00:02:06|จอดนอกจุด|8/7 ถนนลำลูกกา ตำบลลำคูด อำเภอลำลูกกา จ.ปทุมธานี 12130|3100127304,3100127305|พิจารณาแล้ว|อนุมัติ|A|31/10/2026 17:23:32|PTK|จอดติดไฟแดง|2 (1/1)
PK-261031-0068|SCC0066|นายประภาส ขาวผิว|7003035กท|31/10/2026 15:22:35|31/10/2026 15:28:54|00:06:19|จอดนอกจุด|ลำไทร, วังน้อย, พระนครศรีอยุธยา|3100126110|พิจารณาแล้ว|อนุมัติ|A|31/10/2026 16:11:42|PTK|ไม่ได้วิ่งงานของ BFPL|2 (1/1)
PK-261031-0061|SCC0066|นายประภาส ขาวผิว|7003035กท|31/10/2026 13:22:40|31/10/2026 14:42:34|01:19:54|จอดนอกจุด|หนองปลาหมอ, หนองแค, สระบุรี|3100126110|พิจารณาแล้ว|อนุมัติ|A|31/10/2026 14:56:06|PTK|ไม่ได้วิ่งงานของ BFPL|2 (1/1)`;

const $ = id => document.getElementById(id);
let ROWS = [], sortKey = 'start', sortDir = -1, mode = 'demo', timer;

/* ---------- ธีม ---------- */
function setTheme(t){
  document.documentElement.dataset.theme = t;
  const themeBtn = $('theme');
  if(themeBtn) themeBtn.textContent = t === 'dark' ? '☀️' : '🌙';
  try{ localStorage.setItem('theme', t) }catch(e){}
}
let saved = null; try{ saved = localStorage.getItem('theme') }catch(e){}
setTheme(saved || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
const themeBtnEl = $('theme');
if(themeBtnEl) themeBtnEl.onclick = () => setTheme(document.documentElement.dataset.theme === 'dark' ? 'light' : 'dark');

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
    ['start','end','unlockAt','dur'].forEach(k => o[k] = cleanDate(o[k])); o.do = fixDO(o.do); o.startD = parseDT(o.start); o.endD = parseDT(o.end); o.unlockD = parseDT(o.unlockAt); o.sec = durSec(o.dur);
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
  if(stTextEl) stTextEl.textContent = 'กำลังอัปเดต...';
  try{
    if(CONFIG.API_URL){
      const res = await fetch(CONFIG.API_URL + (CONFIG.API_URL.includes('?') ? '&' : '?') + 't=' + Date.now());
      if(!res.ok) throw new Error('HTTP ' + res.status);
      const j = await res.json();
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
    if(stTextEl) stTextEl.textContent = mode === 'live' ? 'เชื่อมต่อ Google Sheets แล้ว' : 'ข้อมูลตัวอย่าง (ยังไม่ตั้งค่า API)';
    if(stTimeEl) stTimeEl.textContent = '· อัปเดตล่าสุด ' + new Date().toLocaleString('th-TH', {dateStyle:'medium', timeStyle:'medium'});
    fillSelects(); render();
  }catch(e){
    if(dotEl) dotEl.className = 'dot err';
    if(stTextEl) stTextEl.textContent = 'อัปเดตไม่สำเร็จ: ' + e.message;
  }
}
function fillSelects(){
  const fill = (id, vals, label) => {
    const el = $(id);
    if(!el) return;
    const cur = el.value;
    el.innerHTML = `<option value="">${label}</option>` + [...new Set(vals)].filter(Boolean).sort().map(v => `<option>${v}</option>`).join('');
    el.value = cur;
  };
  fill('fDriver', ROWS.map(r => r.driver), 'ทั้งหมด');
  fill('fUnlocker', ROWS.map(r => r.unlocker), 'ทั้งหมด');
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
function filtered(){
  const fromEl = $('from'), toEl = $('to'), qEl = $('q'), drEl = $('fDriver'), unEl = $('fUnlocker'), duEl = $('fDur');
  const f = fromEl && fromEl.value ? new Date(fromEl.value) : null;
  const t = toEl && toEl.value ? new Date(toEl.value) : null;
  const q = qEl ? qEl.value.trim().toLowerCase() : '';
  const dr = drEl ? drEl.value : '';
  const un = unEl ? unEl.value : '';
  const du = duEl ? duEl.value : '';
  return ROWS.filter(r => {
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
  el.innerHTML = top.length ? top.map(([k,v]) => `<div class="hbar"><span class="t" title="${k}">${k}</span><div class="tr"><div class="f" style="width:${v/max*100}%"></div></div><b>${v}</b></div>`).join('') : '<div class="empty">ไม่มีข้อมูล</div>';
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
    ].map(k => `<div class="panel kpi"><div class="l">${k[0]}</div><div class="v">${k[1]}</div><div class="s">${k[2]}</div></div>`).join('');
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
  renderTrend(d);

  d.sort((a,b) => {
    const k = sortKey, map = {start:'startD', end:'endD', unlockAt:'unlockD', dur:'sec'};
    const x = a[map[k]||k], y = b[map[k]||k];
    return (x > y ? 1 : x < y ? -1 : 0) * sortDir;
  });
  
  const theadEl = $('thead'), tbodyEl = $('tbody'), countEl = $('count');
  if(theadEl) theadEl.innerHTML = COLS.map(c => `<th data-k="${c[0]}">${c[1]}${sortKey===c[0]?(sortDir>0?' ▲':' ▼'):''}</th>`).join('');
  if(tbodyEl){
    tbodyEl.innerHTML = d.length ? d.map((r,i) => `<tr data-i="${ROWS.indexOf(r)}">` + COLS.map(c => {
      let v = r[c[0]];
      if(c[0]==='dur') v = `<span class="${r.sec>1800?'long':''}">${v}</span>`;
      else if(c[0]==='appr') v = `<span class="tag">${v}</span>`;
      else if(c[0]==='req') v = `<span class="tag warn">${v}</span>`;
      return `<td>${v}</td>`;
    }).join('') + '</tr>').join('') : `<tr><td colspan="${COLS.length}" class="empty">ไม่พบข้อมูลในช่วงที่เลือก</td></tr>`;
  }
  if(countEl) countEl.textContent = `แสดง ${d.length} จาก ${ROWS.length} รายการ`;
  window._d = d;
}

/* ---------- อีเวนต์ ---------- */
const presetsEl = $('presets');
if(presetsEl) presetsEl.onclick = e => e.target.dataset.p && preset(e.target.dataset.p);
['from','to'].forEach(id => {
  const el = $(id);
  if(el) el.onchange = () => { nightOnly = false; document.querySelectorAll('.chip').forEach(c=>c.classList.remove('on')); render(); };
});
['q','fDriver','fUnlocker','fDur'].forEach(id => {
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
    if(mBody) mBody.innerHTML = COLS.map(c => `<b>${c[1]}</b><span>${r[c[0]] || '-'}</span>`).join('');
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
    const rows = [COLS.map(c=>c[1])].concat((window._d||[]).map(r => COLS.map(c => r[c[0]])));
    const csv = '\ufeff' + rows.map(r => r.map(v => `"${String(v).replace(/"/g,'""')}"`).join(',')).join('\n');
    const a = document.createElement('a'); a.href = URL.createObjectURL(new Blob([csv], {type:'text/csv'})); a.download = 'unlock-cases.csv'; a.click();
  };
}

load();
if(CONFIG.REFRESH_SEC > 0) timer = setInterval(load, CONFIG.REFRESH_SEC * 1000);

// ===== Firebase: ตรวจสิทธิ์ / Logout / ตัด Session =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

const firebaseConfig = {
  apiKey: "AIzaSyD7HPOhloICyxEyDTfR8yRiH2rT--q4fVo",
  authDomain: "my-login-project-26857.firebaseapp.com",
  projectId: "my-login-project-26857",
  storageBucket: "my-login-project-26857.firebasestorage.app",
  messagingSenderId: "199741800244",
  appId: "1:199741800244:web:41b413f67038c687dc2f61"
};

const LOGIN_URL = "./index.html";
const INACTIVITY_LIMIT = 10 * 60 * 1000; // 10 นาที

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

onAuthStateChanged(auth, (user) => {
  if (user) {
    const userEmailEl = document.getElementById("user-email");
    if(userEmailEl) userEmailEl.textContent = user.email || "";
    document.documentElement.classList.add("ready");
    if (window.hubStart) window.hubStart();
    startInactivityTimer();
  } else {
    window.location.replace(LOGIN_URL);
  }
});

async function doLogout() {
  try { await signOut(auth); }
  catch (error) { console.error("Logout Error:", error); }
}

const logoutBtnEl = document.getElementById("logout-btn");
if(logoutBtnEl) logoutBtnEl.addEventListener("click", doLogout);

let inactivityStarted = false;
function startInactivityTimer() {
  if (inactivityStarted) return;
  inactivityStarted = true;
  let timer;
  function reset() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      alert("หมดเวลาการใช้งานเนื่องจากไม่มีการเคลื่อนไหว กรุณาล็อกอินใหม่อีกครั้ง");
      await doLogout();
    }, INACTIVITY_LIMIT);
  }
  ["mousemove", "keydown", "click", "scroll", "touchstart"].forEach((evt) =>
    window.addEventListener(evt, reset, { passive: true })
  );
  reset();
}