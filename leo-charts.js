// กราฟวิเคราะห์เพิ่มเติมของหน้า LEO (ปรับจากแดชบอร์ด LEO ของ my-web-p3) ใช้ตัวกรองเดียวกับทั้งหน้า
import {
  hotspots, noise, response, stopShares, rejected, rejectMatrix, rejectWeeks, weekHeat, provinceOf, areaOf,
  SHORT_MIN, MIN_DECIDED,
} from './leo-insights.js?v=20261127';

const $ = id => document.getElementById(id);
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, ch => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[ch]));
const nf = n => Math.round(n).toLocaleString('th-TH');
const pct = v => `${v.toFixed(v >= 10 || v === 0 ? 0 : 1)}%`;
const fmtMin = m => {
  if(!Number.isFinite(m)) return '–';
  if(m < 60) return `${Math.round(m)} นาที`;
  const h = Math.floor(m / 60), mm = Math.round(m % 60);
  return mm ? `${nf(h)} ชม. ${mm} นาที` : `${nf(h)} ชม.`;
};
const empty = (t = 'ไม่มีข้อมูล') => `<div class="empty">${t}</div>`;
const countBy = (rows, key) => {
  const m = new Map();
  for(const r of rows) if(r[key]) m.set(r[key], (m.get(r[key]) || 0) + 1);
  return [...m].map(([name, value]) => ({name, value})).sort((a, b) => b.value - a.value);
};

// แถวของหน้า -> รูปแบบที่สูตรวิเคราะห์ใช้ (เหมือน toRecords ใน my-web-p3/src/fleetData.js)
const cache = new WeakMap();
function toRecord(r){
  let x = cache.get(r);
  if(x) return x;
  const n = r.appr.replace(/[\s/._-]/g,'').toLowerCase();
  const requested = !!r.req && !/^(false|no|n|ไม่|ไม่ขอ|0|-|—)$/i.test(r.req);
  const stage = n.includes('ไม่อนุมัติ') || /^(reject|rejected|denied|no|false)$/.test(n) ? 'rejected'
    : n.includes('อนุมัติ') || /^(approve|approved|yes|true|ok)$/.test(n) || (!n && r.unlockD) ? 'approved'
    : requested || n.includes('รอ') || n.includes('pending') ? 'pending' : 'open';
  const minutes = r.sec ? r.sec / 60 : r.endD && r.endD > r.startD ? (r.endD - r.startD) / 60000 : null;
  x = { driver: r.driver || '(ไม่ระบุ)', plate: r.plate || '(ไม่ระบุ)', start: r.startD, end: r.endD, releasedAt: r.unlockD,
    releasedBy: r.unlocker, minutes, stopType: r.cat, stage, reason: r.reason, area: areaOf(r.place), province: provinceOf(r.place) };
  cache.set(r, x);
  return x;
}

/* ---------- ชิ้นกราฟ ---------- */
const bars = (data, {max, label = nf, cls = ''} = {}) => {
  const top = max ?? Math.max(1, ...data.map(d => d.value));
  return data.length ? data.map(d => `<div class="hbar ${cls}"><span class="t" title="${esc(d.name)}">${esc(d.name)}</span><div class="tr"><div class="f" style="width:${d.value / top * 100}%"></div></div><b title="${esc(d.title || '')}">${label(d.value)}</b></div>`).join('') : empty();
};
// ตารางสีตามชั่วโมง: rows = [{name, hours[24], total}]
function heat(rows){
  if(!rows.length) return empty();
  const max = Math.max(1, ...rows.flatMap(r => r.hours));
  const head = Array.from({length: 24}, (_, h) => `<th>${h % 3 ? '' : String(h).padStart(2,'0')}</th>`).join('');
  return `<div class="x-scroll"><table class="heat"><thead><tr><th></th>${head}<th>รวม</th></tr></thead><tbody>${rows.map(r =>
    `<tr><th>${esc(r.name)}</th>${r.hours.map((v, h) => `<td title="${esc(r.name)} ${String(h).padStart(2,'0')}:00 = ${v} เคส"${v ? ` style="background:rgba(245,163,0,${(.15 + .85 * v / max).toFixed(2)})"` : ''}></td>`).join('')}<td class="sum">${nf(r.total)}</td></tr>`).join('')}</tbody></table></div>`;
}
const table = (head, rows) => rows.length ? `<div class="x-scroll"><table class="mini"><thead><tr>${head.map(h => `<th>${h}</th>`).join('')}</tr></thead><tbody>${rows.join('')}</tbody></table></div>` : empty();

/* ---------- ประเภทการจอดรายเดือน (แท่งซ้อน) ---------- */
const MONTH_COLORS = ['#c98500', '#d55181', '#9085e9', '#898781'];
const MTH = ['ม.ค.','ก.พ.','มี.ค.','เม.ย.','พ.ค.','มิ.ย.','ก.ค.','ส.ค.','ก.ย.','ต.ค.','พ.ย.','ธ.ค.'];
function monthStack(rows){
  if(!rows.length) return empty();
  const top = countBy(rows, 'stopType').filter(t => t.name !== 'อื่นๆ').slice(0, 3).map(t => t.name);
  const names = [...top, 'ประเภทอื่น'];
  const months = new Map();
  for(const r of rows){
    const k = r.start.getFullYear() * 100 + r.start.getMonth();
    if(!months.has(k)) months.set(k, names.map(() => 0));
    const i = top.indexOf(r.stopType);
    months.get(k)[i < 0 ? top.length : i]++;
  }
  const list = [...months].sort((a, b) => a[0] - b[0]).slice(-12);
  const max = Math.max(1, ...list.map(([, v]) => v.reduce((a, b) => a + b, 0)));
  const color = i => i < top.length ? MONTH_COLORS[i] : MONTH_COLORS[3];
  return `<div class="stack">${list.map(([k, v]) => {
    const label = `${MTH[k % 100]} ${String(Math.floor(k / 100) + 543).slice(-2)}`;
    return `<div class="col"><span class="n">${nf(v.reduce((a, b) => a + b, 0))}</span>${v.map((n, i) => n ? `<i style="height:${n / max * 130}px;background:${color(i)}" title="${label} · ${esc(names[i])}: ${n} เคส"></i>` : '').reverse().join('')}<span class="x">${label}</span></div>`;
  }).join('')}</div><div class="legend">${names.map((n, i) => `<span><i style="background:${color(i)}"></i>${esc(n)}</span>`).join('')}</div>`;
}

/* ---------- แสดงผล ---------- */
const ui = {level: 'district', type: '', by: 'plate'};
let data = {rows: [], prev: null, range: null};

function drawHot(){
  const list = data.rows.length ? hotspots(data.rows, ui.level) : [];
  const max = list[0] ? list[0].count : 1;
  $('xHot').innerHTML = table(['พื้นที่', 'เคส', 'ประเภทที่พบมากสุด', 'จอดเฉลี่ย'], list.map(h =>
    `<tr><td>${esc(h.name)}<small>${h.name !== h.province ? esc(h.province) : ''}</small></td>
     <td class="num"><span class="cell-bar"><i style="width:${h.count / max * 100}%"></i></span>${nf(h.count)}</td>
     <td>${esc(h.top ? h.top.name : '')}<small>${h.top ? `${nf(h.top.value)} เคส (${pct(h.top.value / h.count * 100)})` : ''}</small></td>
     <td class="num">${fmtMin(h.avg)}</td></tr>`));
  document.querySelectorAll('#xLevel .chip').forEach(c => c.classList.toggle('on', c.dataset.v === ui.level));
}
function drawDrill(){
  const types = countBy(data.rows, 'stopType');
  if(ui.type && !types.some(t => t.name === ui.type)) ui.type = '';
  $('xType').innerHTML = '<option value="">ทุกประเภท</option>' + types.map(t => `<option value="${esc(t.name)}"${t.name === ui.type ? ' selected' : ''}>${esc(t.name)} (${nf(t.value)})</option>`).join('');
  $('xDrill').innerHTML = bars(countBy(ui.type ? data.rows.filter(r => r.stopType === ui.type) : data.rows, ui.by).slice(0, 10));
  document.querySelectorAll('#xBy .chip').forEach(c => c.classList.toggle('on', c.dataset.v === ui.by));
}

function draw(){
  const {rows, prev, range} = data;

  const types = countBy(rows, 'stopType');
  $('xTypeHeat').innerHTML = heat(types.map(({name, value}) => {
    const hours = Array(24).fill(0);
    for(const r of rows) if(r.stopType === name) hours[r.start.getHours()]++;
    return {name, hours, total: value};
  }));
  $('xWeekHeat').innerHTML = rows.length ? heat(weekHeat(rows)) : empty();

  $('xAvg').innerHTML = bars(types.filter(t => t.value >= 3).map(({name}) => {
    const l = rows.filter(r => r.stopType === name);
    return {name, value: l.reduce((s, r) => s + (r.minutes || 0), 0) / l.length};
  }).sort((a, b) => b.value - a.value), {label: fmtMin, cls: 'wide'});

  $('xMonth').innerHTML = monthStack(rows);

  const sh = stopShares(rows, prev);
  $('xShare').innerHTML = table(['ประเภทการจอด', 'เคส', 'สัดส่วน', prev ? 'เทียบช่วงก่อน' : ''], sh.rows.map(r =>
    `<tr><td>${esc(r.name)}</td><td class="num">${nf(r.count)}</td>
     <td class="num"><span class="cell-bar"><i style="width:${r.pct / sh.rows[0].pct * 100}%"></i></span>${pct(r.pct)}</td>
     <td class="num">${r.delta === null ? '' : Math.abs(r.delta) < .05 ? 'เท่าเดิม' : `${r.delta > 0 ? '▲' : '▼'} ${Math.abs(r.delta).toFixed(1)} จุด`}</td></tr>`));

  drawHot();
  drawDrill();

  const no = noise(rows);
  $('xNoise').innerHTML = rows.length ? `<div class="big">${pct(no.pct)}</div><div class="note">${nf(no.count)} จาก ${nf(no.total)} เคส เป็นไฟแดงหรือจราจรที่จอดไม่เกิน ${SHORT_MIN} นาที</div>${bars(no.byType, {cls: 'wide'})}` : empty();

  const rs = response(rows);
  $('xResp').innerHTML = rs.count ? `<div class="big">${fmtMin(rs.median)}</div><div class="note">ค่ากลางจากเวลาสิ้นสุดเคสถึงเวลาปลด (${nf(rs.count)} เคส)</div>
    <h4>ตามกะ (เวลาสิ้นสุดเคส)</h4>${bars(rs.shifts.filter(s => s.count), {label: fmtMin, cls: 'wide'})}
    <h4>ตามผู้ปลด (5 เคสขึ้นไป)</h4>${bars(rs.people, {label: fmtMin, cls: 'wide'})}` : empty();

  const rj = rejected(rows);
  $('xRej').innerHTML = rj.count ? `<div class="big">${nf(rj.count)}</div><div class="note">เคสไม่อนุมัติ · ${pct(rj.rate)} ของเคสที่พิจารณาแล้ว</div>
    <h4>ตามประเภทการจอด</h4>${bars(rj.byType, {cls: 'wide'})}
    <h4>% ไม่อนุมัติของผู้ปลด (5 เคสขึ้นไป)</h4>${bars(rj.people.map(p => ({name: p.name, value: p.rate, title: `${p.rejected}/${p.total}`})), {max: 100, label: pct, cls: 'wide'})}` : empty('ไม่มีเคสไม่อนุมัติ');

  const weeks = range ? rejectWeeks(rows, range.from, range.to).slice(-12) : [];
  $('xRejWeek').innerHTML = bars(weeks.map(w => ({name: w.label, value: w.rejected, title: w.rate === null ? '' : `${pct(w.rate)} ของ ${w.total} เคสที่พิจารณา`})), {cls: 'wide'});

  const m = rejectMatrix(rows);
  $('xMatrix').innerHTML = !m.types.length ? empty('ไม่มีเคสไม่อนุมัติ') :
    m.mismatches.map(t => `<div class="warnline">⚠ เกณฑ์ไม่ตรงกัน: ${esc(t.name)} · ${t.mismatch.strict.map(p => `${esc(p)} ไม่อนุมัติ ${pct(t.cells[p].rate)}`).join(', ')} แต่ ${t.mismatch.lenient.map(esc).join(', ')} อนุมัติทุกเคส</div>`).join('') +
    table(['ประเภทการจอด', 'รวม', ...m.people.map(esc)], m.types.map(t =>
      `<tr><td>${t.mismatch ? '⚠ ' : ''}${esc(t.name)}</td><td class="num">${pct(t.rate)}<small>${t.rejected}/${t.total}</small></td>${m.people.map(p => {
        const c = t.cells[p];
        if(!c.total) return '<td class="num">–</td>';
        const solid = c.total >= MIN_DECIDED;
        return `<td class="num${solid ? '' : ' thin'}"${solid ? ` style="background:rgba(220,38,38,${(.06 + .5 * c.rate / 100).toFixed(2)})"` : ''}>${pct(c.rate)}<small>${c.rejected}/${c.total}</small></td>`;
      }).join('')}</tr>`)) +
    `<div class="note">% ไม่อนุมัติของแต่ละคน · ตัวจาง = น้อยกว่า ${MIN_DECIDED} เคส ไม่นำมาเทียบ</div>`;
}

$('xLevel').onclick = e => { if(e.target.dataset.v){ ui.level = e.target.dataset.v; drawHot(); } };
$('xBy').onclick = e => { if(e.target.dataset.v){ ui.by = e.target.dataset.v; drawDrill(); } };
$('xType').onchange = e => { ui.type = e.target.value; drawDrill(); };

// next: { rows, prev, range } เป็นแถวของหน้า (ยังไม่แปลง)
export function renderCharts(next){
  data = { rows: next.rows.map(toRecord), prev: next.prev && next.prev.map(toRecord), range: next.range };
  draw();
}
