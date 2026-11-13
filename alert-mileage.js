// ====== ตั้งค่า API และโครงสร้างข้อมูล ======
const API_URL = 'https://script.google.com/macros/s/AKfycbwW35lChBZEb8cKpt1TiAF2O9PyylzJaAnPorxloIpw5JTb515uicEETegQCPXmzH_Rsg/exec';
const COL = {
  m: {id:'Device No.', km:'Driving distance', fleet:'Fleet'},
  a: {id:'หมายเลขรถ', type:['ประเภทการเตือน','ประเภทแจ้งเตือน'], fleet:'หน่วยงาน'}
};
const STATUS = {
  high:['เตือนมากผิดปกติ'], low:['เตือนน้อยผิดปกติ'], zero:['ไม่เตือนเลย'],
  ok:['ปกติ'], short:['ระยะทางน้อย'], nokm:['ไม่มีข้อมูลระยะทาง']
};

// ====== ตัวช่วย ======
const $ = id => document.getElementById(id);
const esc = s => String(s).replace(/[&<>"]/g, c => ({'&':'&','<':'<','>':'>','"':'"'}[c]));
const num = v => { const n = parseFloat(String(v ?? '').replace(/[^\d.\-]/g,'')); return isFinite(n) ? n : 0; };
const fmt = (n,d=0) => n.toLocaleString('th-TH',{minimumFractionDigits:d,maximumFractionDigits:d});
const norm = s => String(s).trim().toLowerCase();
const normId = s => String(s ?? '').replace(/[\s\u200b\u00a0]/g,'').replace(/[‐‑–—−]/g,'-').toUpperCase();
function field(row,name){
  if(Array.isArray(name)){
    for(const n of name){ const v = field(row,n); if(v !== '') return v; }
    return '';
  }
  if(name in row) return row[name];
  let k = Object.keys(row).find(k => norm(k) === norm(name));
  if(k === undefined && /[\u0E00-\u0E7F]/.test(name)) k = Object.keys(row).find(k => norm(k).includes(norm(name)));
  return k === undefined ? '' : row[k];
}
function pickSheet(root,name){
  if(!root || typeof root !== 'object') return null;
  const k = Object.keys(root).find(k => norm(k) === norm(name));
  return k && Array.isArray(root[k]) ? root[k] : null;
}
function extract(json){
  for(const r of [json, json.data, json.result]){
    const m = pickSheet(r,'Mileage'), a = pickSheet(r,'Alarm');
    if(m && a) return {mileage:m, alarm:a};
  }
  throw new Error('รูปแบบข้อมูลจาก API ไม่ตรงกับที่คาดไว้ ต้องมีทั้งชีต Mileage และ Alarm');
}

// ====== วันที่ / เดือน ======
const mk = (y,m) => { y = +y; m = +m; if(y > 2400) y -= 543; return (m>=1 && m<=12) ? y + '-' + String(m).padStart(2,'0') : ''; };
function isoYm(s){ const m = String(s||'').match(/(\d{4})[-\/.](\d{1,2})[-\/.](\d{1,2})/); return m ? mk(m[1],m[2]) : ''; }
function slashYm(s,dmy){
  const m = String(s||'').match(/(\d{1,2})[\/.\-](\d{1,2})[\/.\-](\d{4})/); if(!m) return '';
  const a = +m[1], b = +m[2];
  const mo = a > 12 ? b : b > 12 ? a : dmy ? b : a;
  return mk(m[3],mo);
}
function monthOfAlarm(r){
  const t = (Object.entries(r).find(([k]) => norm(k).startsWith('วันและเวลา')) || [,''])[1];
  let y = isoYm(t) || slashYm(t,true);
  if(!y) for(const [k,v] of Object.entries(r)){ if(k === '__ym') continue; y = isoYm(v) || slashYm(v,true); if(y) break; }
  return y;
}
function monthOfMileage(r){
  const b = field(r,'Begin Time'), e = field(r,'End Time');
  return isoYm(b) || isoYm(e) || slashYm(b,false) || slashYm(e,false);
}
const monthLabel = k => new Date(+k.slice(0,4), +k.slice(5)-1, 1).toLocaleDateString('th-TH',{month:'long',year:'numeric'});

// ====== โหลดข้อมูล ======
let RAW = null, sortKey = 'rate', sortDir = -1, query = '';
async function load(){
  const stampEl = $('stamp');
  if(stampEl) stampEl.textContent = 'กำลังโหลดข้อมูล...';
  try{
    const res = await fetch(API_URL);
    if(!res.ok) throw new Error('HTTP ' + res.status);
    const json = await res.json();
    if(json.status === 'error') throw new Error(json.message);
    RAW = extract(json);
    RAW.mileage.forEach(r => r.__ym = monthOfMileage(r));
    RAW.alarm.forEach(r => r.__ym = monthOfAlarm(r));
    setupFilters();
    if(stampEl) stampEl.textContent = 'อัปเดตล่าสุด ' + new Date().toLocaleString('th-TH') +
      ' • ระยะทาง ' + fmt(RAW.mileage.length) + ' แถว • แจ้งเตือน ' + fmt(RAW.alarm.length) + ' รายการ';
    render();
  }catch(e){
    const appEl = $('app');
    if(appEl) appEl.innerHTML = '<div class="panel msg err">โหลดข้อมูลไม่สำเร็จ: ' + esc(e.message) +
      '<br><span class="sub">ตรวจสอบว่า Deploy เป็น Web App และตั้งผู้มีสิทธิ์เข้าถึงเป็น “ทุกคน”</span></div>';
    if(stampEl) stampEl.textContent = 'โหลดข้อมูลไม่สำเร็จ';
  }
}

function setupFilters(){
  const fleets = new Set(), types = new Set(), months = new Set();
  RAW.mileage.forEach(r => { const f = String(field(r,COL.m.fleet)).trim(); if(f) fleets.add(f); });
  RAW.alarm.forEach(r => {
    const f = String(field(r,COL.a.fleet)).trim(); if(f) fleets.add(f);
    const t = String(field(r,COL.a.type)).trim(); if(t) types.add(t);
  });
  RAW.mileage.concat(RAW.alarm).forEach(r => { if(r.__ym) months.add(r.__ym); });
  const ml = [...months].sort().reverse();
  const fMonthEl = $('fMonth');
  if(!fMonthEl) return;
  const firstLoad = !fMonthEl.options.length;
  const keepM = fMonthEl.value;
  fMonthEl.innerHTML = '<option value="">ทุกเดือน</option>' + ml.map(k => `<option value="${k}">${monthLabel(k)}</option>`).join('');
  fMonthEl.value = firstLoad ? (ml[0] || '') : (ml.includes(keepM) ? keepM : (ml[0] || ''));
  const fFleetEl = $('fFleet'), fTypeEl = $('fType');
  const keep = [fFleetEl ? fFleetEl.value : '', fTypeEl ? fTypeEl.value : ''];
  if(fFleetEl) fFleetEl.innerHTML = '<option value="">ทุกหน่วยงาน</option>' + [...fleets].sort().map(f => `<option>${esc(f)}</option>`).join('');
  if(fTypeEl) fTypeEl.innerHTML = '<option value="">ทุกประเภท</option>' + [...types].sort().map(t => `<option>${esc(t)}</option>`).join('');
  if(fFleetEl) fFleetEl.value = keep[0]; 
  if(fTypeEl) fTypeEl.value = keep[1];
}

// ====== คำนวณ ======
function compute(){
  const fNEl = $('fN'), fMinEl = $('fMin'), fHiEl = $('fHi'), fLoEl = $('fLo'), fFleetEl = $('fFleet'), fTypeEl = $('fType'), fMonthEl = $('fMonth');
  const N = Math.max(1, num(fNEl ? fNEl.value : 1000)), minKm = num(fMinEl ? fMinEl.value : 500);
  const hi = num(fHiEl ? fHiEl.value : 1.5), lo = num(fLoEl ? fLoEl.value : 0.5);
  const fFleet = fFleetEl ? fFleetEl.value : '', fType = fTypeEl ? fTypeEl.value : '', ym = fMonthEl ? fMonthEl.value : '';
  const alarmMonthOk = RAW.alarm.some(r => r.__ym);
  const V = {};
  const get = id => V[id] || (V[id] = {id, fleet:'', km:0, alarms:0, types:{}});
  RAW.mileage.forEach(r => {
    if(ym && r.__ym !== ym) return;
    const id = normId(field(r,COL.m.id)); if(!id) return;
    const v = get(id); v.km += Math.max(0, num(field(r,COL.m.km)));
    const f = String(field(r,COL.m.fleet)).trim(); if(f) v.fleet = f;
  });
  RAW.alarm.forEach(r => {
    if(ym && alarmMonthOk && r.__ym !== ym) return;
    const id = normId(field(r,COL.a.id)); if(!id) return;
    const t = String(field(r,COL.a.type)).trim() || '(ไม่ระบุ)';
    const v = get(id);
    if(!v.fleet){ const f = String(field(r,COL.a.fleet)).trim(); if(f) v.fleet = f; }
    if(fType && t !== fType) return;
    v.alarms++; v.types[t] = (v.types[t]||0) + 1;
  });
  let list = Object.values(V).filter(v => !fFleet || v.fleet === fFleet);
  const el = list.filter(v => v.km >= minKm && v.km > 0);
  const sumKm = el.reduce((s,v) => s + v.km, 0), sumAl = el.reduce((s,v) => s + v.alarms, 0);
  const avg = sumKm ? sumAl / sumKm * N : 0;
  list.forEach(v => {
    v.rate = v.km > 0 ? v.alarms / v.km * N : 0;
    v.ratio = avg ? v.rate / avg : 0;
    v.top = Object.entries(v.types).sort((a,b) => b[1]-a[1])[0];
    v.status = v.km <= 0 ? 'nokm' : v.km < minKm ? 'short' : v.alarms === 0 ? 'zero'
      : v.ratio > hi ? 'high' : v.ratio < lo ? 'low' : 'ok';
  });
  return {list, el, avg, N, sumKm, sumAl, minKm};
}

function trend(){
  const fNEl = $('fN'), fFleetEl = $('fFleet'), fTypeEl = $('fType');
  const N = Math.max(1, num(fNEl ? fNEl.value : 1000)), fFleet = fFleetEl ? fFleetEl.value : '', fType = fTypeEl ? fTypeEl.value : '';
  const fl = {};
  RAW.mileage.forEach(r => { const id = normId(field(r,COL.m.id)), f = String(field(r,COL.m.fleet)).trim(); if(id && f) fl[id] = f; });
  RAW.alarm.forEach(r => { const id = normId(field(r,COL.a.id)), f = String(field(r,COL.a.fleet)).trim(); if(id && f && !fl[id]) fl[id] = f; });
  const M = {};
  const slot = k => M[k] || (M[k] = {km:0, al:0});
  RAW.mileage.forEach(r => {
    const id = normId(field(r,COL.m.id));
    if(!r.__ym || !id || (fFleet && fl[id] !== fFleet)) return;
    slot(r.__ym).km += Math.max(0, num(field(r,COL.m.km)));
  });
  RAW.alarm.forEach(r => {
    const id = normId(field(r,COL.a.id));
    if(!r.__ym || !id || (fFleet && fl[id] !== fFleet)) return;
    if(fType && String(field(r,COL.a.type)).trim() !== fType) return;
    slot(r.__ym).al++;
  });
  return Object.keys(M).sort().map(k => ({k, ...M[k], rate: M[k].km ? M[k].al / M[k].km * N : 0}));
}

function diag(){
  const mids = new Set(RAW.mileage.map(r => normId(field(r,COL.m.id))).filter(Boolean));
  let noId = 0, noMonth = 0, matched = 0; const unm = {}, byM = {};
  RAW.alarm.forEach(r => {
    const id = normId(field(r,COL.a.id));
    if(!id) noId++; else if(mids.has(id)) matched++; else unm[id] = (unm[id]||0) + 1;
    if(!r.__ym) noMonth++; else byM[r.__ym] = (byM[r.__ym]||0) + 1;
  });
  return {mids, noId, noMonth, matched, unm, byM};
}

function diagHtml(){
  const d = diag(), A = RAW.alarm[0] || {}, M = RAW.mileage[0] || {};
  const un = Object.entries(d.unm).sort((a,b) => b[1]-a[1]).slice(0,12).map(([k,c]) => esc(k) + ' (' + c + ')').join(', ') || '-';
  const mids = [...d.mids].slice(0,8).map(esc).join(', ') || '-';
  const bm = Object.keys(d.byM).sort().map(k => monthLabel(k) + ': ' + fmt(d.byM[k])).join(' | ') || '-';
  const tk = Object.entries(A).find(([k]) => norm(k).startsWith('วันและเวลา'));
  return `<div class="sub" style="line-height:1.9;margin-top:10px">
   แจ้งเตือนทั้งหมด ${fmt(RAW.alarm.length)} รายการ: จับคู่กับรถในชีต Mileage ได้ <b>${fmt(d.matched)}</b> • จับคู่ไม่ได้ <b>${fmt(RAW.alarm.length - d.matched - d.noId)}</b> • ไม่มีหมายเลขรถ ${fmt(d.noId)} • อ่านวันที่ไม่ได้ ${fmt(d.noMonth)}<br>
   แจ้งเตือนแยกตามเดือน: ${bm}<br>
   ตัวอย่างหมายเลขรถที่จับคู่ไม่ได้: ${un}<br>
   ตัวอย่างหมายเลขรถใน Mileage: ${mids}<br>
   ค่าหมายเลขรถแถวแรกของ Alarm: ${esc(field(A,COL.a.id) || '(ว่าง)')} • ค่าวันที่แถวแรก: ${esc(tk ? tk[1] : '(ไม่พบคอลัมน์วันที่)')}<br>
   หัวคอลัมน์ Alarm: ${esc(Object.keys(A).filter(k => k !== '__ym').join(' | '))}<br>
   หัวคอลัมน์ Mileage: ${esc(Object.keys(M).filter(k => k !== '__ym').join(' | '))}</div>`;
}

function render(){
  if(!RAW) return;
  const D = compute(), {list, el, avg, N} = D;
  const cnt = s => list.filter(v => v.status === s).length;
  const abn = cnt('high') + cnt('low') + cnt('zero');
  const unit = 'ต่อ ' + fmt(N) + ' กม.';

  const ranked = el.slice().sort((a,b) => b.rate - a.rate).slice(0,20);
  const maxRate = Math.max(...ranked.map(v => v.rate), avg, 0.0001);
  const bars = ranked.map(v => `<div class="bar s-${v.status}">
    <div class="nm" title="${esc(v.id)}">${esc(v.id)}</div>
    <div class="track"><div class="fill" style="width:${v.rate/maxRate*100}%"></div><div class="avgline" style="left:${avg/maxRate*100}%"></div></div>
    <div class="val">${fmt(v.rate,2)}</div></div>`).join('');

  const F = {};
  list.forEach(v => { const k = v.fleet || '(ไม่ระบุ)'; const f = F[k] || (F[k] = {n:0,km:0,al:0}); f.n++; f.km += v.km; f.al += v.alarms; });
  const fleetRows = Object.entries(F).map(([k,f]) => ({k, ...f, rate: f.km ? f.al/f.km*N : 0}))
    .sort((a,b) => b.rate - a.rate)
    .map(f => `<tr><td>${esc(f.k)}</td><td class="n">${f.n}</td><td class="n">${fmt(f.km)}</td><td class="n">${fmt(f.al)}</td><td class="n">${fmt(f.rate,2)}</td></tr>`).join('');

  const T = {}; list.forEach(v => Object.entries(v.types).forEach(([t,c]) => T[t] = (T[t]||0) + c));
  const tEntries = Object.entries(T).sort((a,b) => b[1]-a[1]).slice(0,10);
  const tMax = Math.max(...tEntries.map(e => e[1]), 1);
  const typeBars = tEntries.map(([t,c]) => `<div class="bar" style="grid-template-columns:130px 1fr 50px">
    <div class="nm" title="${esc(t)}">${esc(t)}</div><div class="track"><div class="fill" style="width:${c/tMax*100}%;background:var(--accent)"></div></div><div class="val">${fmt(c)}</div></div>`).join('') || '<div class="msg">ไม่มีข้อมูลแจ้งเตือน</div>';

  const zeros = list.filter(v => v.status === 'zero').sort((a,b) => b.km - a.km);
  const zeroChips = zeros.length ? zeros.map(v => `<span class="chip s-zero" title="${fmt(v.km)} กม.">${esc(v.id)}</span>`).join('')
    : '<span class="sub">ไม่มีรถที่ไม่เตือนเลย</span>';

  const fMonthEl = $('fMonth');
  const ymSel = fMonthEl ? fMonthEl.value : '';
  const totalAl = list.reduce((a,v) => a + v.alarms, 0);
  const noAlMonth = !RAW.alarm.some(r => r.__ym);
  const warn = noAlMonth ? `<div class="panel noprint" style="border-color:var(--lo)"><h2 style="color:var(--lo)">อ่านวันที่ของแจ้งเตือนไม่ได้</h2><p class="hint">ตอนนี้นับแจ้งเตือนทั้งหมดโดยไม่แยกเดือน</p>${diagHtml()}</div>` : (totalAl === 0 && RAW.alarm.length > 0) ? `<div class="panel noprint" style="border-color:var(--hi)"><h2 style="color:var(--hi)">ไม่พบแจ้งเตือนในข้อมูลที่เลือก ทั้งที่โหลดมา ${fmt(RAW.alarm.length)} รายการ</h2>${diagHtml()}</div>` : '';
  const T2 = trend(), tMaxR = Math.max(...T2.map(t => t.rate), 0.0001);
  const trendPanel = T2.length > 1 ? `<section class="panel"><h2>แนวโน้มรายเดือน (${unit})</h2><p class="hint">เทียบอัตราแจ้งเตือนรวมของแต่ละเดือน</p>${T2.map(t => `<div class="bar" style="grid-template-columns:130px 1fr 150px"><div class="nm">${monthLabel(t.k)}</div><div class="track"><div class="fill" style="width:${t.rate/tMaxR*100}%;background:${t.k===ymSel?'var(--accent)':'var(--mute)'}"></div></div><div class="val">${fmt(t.rate,2)} (${fmt(t.al)} ครั้ง / ${fmt(t.km)} กม.)</div></div>`).join('')}</section>` : '';
  
  const appEl = $('app');
  if(!appEl) return;
  appEl.innerHTML = `
  ${warn}
  <p class="sub" style="margin:0 0 10px">แสดงข้อมูล: <b>${ymSel ? monthLabel(ymSel) : 'ทุกเดือนรวมกัน'}</b></p>
  <div class="kpis">
   <div class="kpi"><b>${fmt(list.length)}</b><span>จำนวนรถ</span></div>
   <div class="kpi"><b>${fmt(D.sumKm)}</b><span>ระยะทางรวม (กม.) ของรถที่ประเมิน</span></div>
   <div class="kpi"><b>${fmt(D.sumAl)}</b><span>จำนวนแจ้งเตือนของรถที่ประเมิน</span></div>
   <div class="kpi avg"><b>${fmt(avg,2)}</b><span>ค่าเฉลี่ย ${unit}</span></div>
   <div class="kpi"><b style="color:var(--hi)">${fmt(abn)}</b><span>รถที่ผิดปกติ (มาก ${cnt('high')} / น้อย ${cnt('low')} / ไม่เตือน ${cnt('zero')})</span></div>
  </div>

  <div class="grid2">
   <section class="panel">
    <h2>อัตราการแจ้งเตือน ${unit} สูงสุด 20 อันดับ</h2>
    <p class="hint">เส้นดำคือค่าเฉลี่ย รถที่แท่งยาวเกินเส้นมากคือเตือนถี่ผิดปกติ</p>
    ${bars || '<div class="msg">ไม่มีรถที่ถึงระยะทางขั้นต่ำ</div>'}
    <div class="legend">${['high','low','ok'].map(s => `<span class="s-${s}"><i class="dot c"></i>${STATUS[s][0]}</span>`).join('')}<span><i class="dot" style="background:var(--ink);width:2px"></i>ค่าเฉลี่ย</span></div>
   </section>
   <section class="panel">
    <h2>ประเภทแจ้งเตือนที่พบมากที่สุด</h2>
    <p class="hint">10 อันดับแรกของข้อมูลที่เลือก</p>
    ${typeBars}
   </section>
  </div>

  <div class="grid2">
   <section class="panel">
    <h2>รถที่ไม่เตือนเลย (วิ่งถึงเกณฑ์ขั้นต่ำ)</h2>
    <p class="hint">อาจเป็นอุปกรณ์เสีย สัญญาณขาด หรือไม่ได้ติดตั้ง ควรตรวจสอบ</p>
    <div class="chips">${zeroChips}</div>
   </section>
   <section class="panel">
    <h2>สรุปตามหน่วยงาน</h2>
    <p class="hint">เรียงตามอัตราแจ้งเตือน ${unit}</p>
    <div class="tw"><table><thead><tr><th>หน่วยงาน</th><th class="n">รถ</th><th class="n">กม.</th><th class="n">เตือน</th><th class="n">${unit}</th></tr></thead><tbody>${fleetRows}</tbody></table></div>
   </section>
  </div>

  ${trendPanel}
  <section class="panel">
   <div class="tools">
    <div><h2>รายละเอียดรายคัน</h2><p class="hint" style="margin:0">คลิกหัวตารางเพื่อเรียงลำดับ</p></div>
    <input id="q" type="search" placeholder="ค้นหาหมายเลขรถ / หน่วยงาน / สถานะ" value="${esc(query)}">
   </div>
   <div class="tw"><table><thead><tr id="thead"></tr></thead><tbody id="tbody"></tbody></table></div>
  </section>`;

  const qEl = $('q');
  if(qEl) qEl.addEventListener('input', e => { query = e.target.value; drawTable(list); });
  drawTable(list);
}

const COLS = [
  ['id','หมายเลขรถ',0], ['fleet','หน่วยงาน',0], ['km','ระยะทาง (กม.)',1], ['alarms','แจ้งเตือน (ครั้ง)',1],
  ['rate','อัตรา ต่อ N กม.',1], ['ratio','เทียบค่าเฉลี่ย (เท่า)',1], ['top','ประเภทที่เตือนมากสุด',0], ['status','สถานะ',0]
];

function drawTable(list){
  const q = norm(query);
  let rows = list.filter(v => !q || norm(v.id + ' ' + v.fleet + ' ' + STATUS[v.status][0]).includes(q));
  const val = v => sortKey === 'top' ? (v.top ? v.top[0] : '') : sortKey === 'status' ? STATUS[v.status][0] : v[sortKey];
  rows.sort((a,b) => {
    const x = val(a), y = val(b);
    return (typeof x === 'string' ? x.localeCompare(y,'th') : x - y) * sortDir;
  });
  const theadEl = $('thead');
  if(!theadEl) return;
  theadEl.innerHTML = COLS.map(([k,t,n]) =>
    `<th class="${n?'n':''}" data-k="${k}">${t}${sortKey===k ? (sortDir>0?' ▲':' ▼') : ''}</th>`).join('');
  theadEl.querySelectorAll('th').forEach(th => th.onclick = () => {
    const k = th.dataset.k; sortDir = sortKey === k ? -sortDir : (k==='id'||k==='fleet' ? 1 : -1); sortKey = k; drawTable(list);
  });
  const tbodyEl = $('tbody');
  if(tbodyEl) tbodyEl.innerHTML = rows.map(v => `<tr>
    <td><b>${esc(v.id)}</b></td><td>${esc(v.fleet || '-')}</td>
    <td class="n">${fmt(v.km)}</td><td class="n">${fmt(v.alarms)}</td>
    <td class="n">${v.km>0 ? fmt(v.rate,2) : '-'}</td>
    <td class="n">${v.status==='nokm'||v.status==='short' ? '-' : fmt(v.ratio,2)}</td>
    <td>${v.top ? esc(v.top[0]) + ' (' + v.top[1] + ')' : '-'}</td>
    <td><span class="chip s-${v.status}">${STATUS[v.status][0]}</span></td></tr>`).join('')
    || '<tr><td colspan="8" class="msg">ไม่พบข้อมูล</td></tr>';
}

// ====== ธีม / PDF / ปุ่มควบคุม ======
function setTheme(t){
  document.documentElement.setAttribute('data-theme', t);
  try{ localStorage.setItem('theme', t); }catch(e){}
}
(function(){
  let t = null;
  try{ t = localStorage.getItem('theme'); }catch(e){}
  setTheme(t || (matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'));
})();

const themeBtn = $('themeBtn');
if(themeBtn) themeBtn.onclick = () => setTheme(document.documentElement.getAttribute('data-theme') === 'dark' ? 'light' : 'dark');

const reloadBtn = $('reloadBtn');
if(reloadBtn) reloadBtn.onclick = load;

const pdfBtn = $('pdfBtn');
if(pdfBtn) pdfBtn.onclick = () => window.print();

['fMonth','fFleet','fType','fN','fMin','fHi','fLo'].forEach(id => {
  const el = $(id);
  if(el) el.addEventListener('input', render);
});

load();

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
    document.documentElement.classList.add("ready");
    startInactivityTimer();
  } else {
    window.location.replace(LOGIN_URL);
  }
});

async function doLogout() {
  try { await signOut(auth); }
  catch (error) { console.error("Logout Error:", error); }
}

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