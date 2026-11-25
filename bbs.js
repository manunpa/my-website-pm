import { requireLogin, fetchProtectedText } from './firebase-guard.js?v=20261122-cut';
import { readTemplate, buildReport, colName } from './bbs-xlsx.js?v=8';
import { readPlans, vehicleNo } from './bbs-plan.js?v=6';
import { readImage, parseShot, inShift } from './bbs-ocr.js?v=1';
import { samePlace } from './bbs-match.js?v=1';
import { ALERT_TYPES, detectType, parseAlert, formatAlert } from './bbs-alert.js?v=1';
import { normalize, snapshot, stamp as markEdits, merge, sameReport } from './bbs-merge.js?v=1';
import { destList, diffPlan, mergeChanges, describe } from './bbs-diff.js?v=1';

// URL /exec ของ Apps Script (apps-script/bbs.gs) — ว่างไว้ = เก็บในเครื่องนี้อย่างเดียว
const API_URL = 'https://script.google.com/macros/s/AKfycbxGlbuYTL5_K8DZ7EIPT9P0NO5gef1od1f4WXzRvBPLbCvAPwST87Tl3hqtjMljY3Yx8w/exec';

const $ = (id) => document.getElementById(id);
const range = (a, b) => {
    const num = (s) => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
    return Array.from({ length: num(b) - num(a) + 1 }, (_, i) => colName(num(a) + i));
};
const TYPES = {
    // preset = ช่องที่ติ๊ก ✓ ให้ตั้งแต่แรกเมื่อเลือกสถานะนั้น
    driving: { label: 'ขับรถ', cols: range('AC', 'AO'), preset: [...range('AC', 'AK'), 'AN', 'AO'] },
    loading: { label: 'รับน้ำมัน', cols: range('K', 'Q'), preset: range('K', 'Q') },
    unloading: { label: 'ลงน้ำมัน', cols: range('R', 'AB'), preset: range('R', 'W') },
    packing: { label: 'เก็บอุปกรณ์', cols: range('R', 'AB'), preset: range('X', 'AA') },
    none: { label: 'ลงเวลาอย่างเดียว', cols: [], preset: [] }
};

let template = null; // { buffer, name, vehicles, checks, customers }
let report = null;

// ===== เก็บไฟล์ต้นแบบในเครื่อง (IndexedDB) — ไม่อัปโหลดไปไหน =====
function idb(mode, run) {
    return new Promise((resolve, reject) => {
        setTimeout(() => reject(new Error('ที่เก็บข้อมูลของเบราว์เซอร์ไม่ตอบสนอง')), 4000);
        const open = indexedDB.open('bbs', 1);
        open.onupgradeneeded = () => open.result.createObjectStore('kv');
        open.onerror = () => reject(open.error);
        open.onsuccess = () => {
            const tx = open.result.transaction('kv', mode);
            const req = run(tx.objectStore('kv'));
            tx.oncomplete = () => { open.result.close(); resolve(req.result); };
            tx.onerror = () => { open.result.close(); reject(tx.error); };
        };
    });
}

// ===== กล่องบอกสถานะการโหลด: ทุกช่วงที่รอต้องเห็นว่ากำลังทำอะไร นานแค่ไหน หรือพังตรงไหน =====
let stateTimer;
function busy(text) {
    clearInterval(stateTimer);
    $('state').hidden = !text;
    $('state').classList.remove('bad');
    $('retry').hidden = true;
    if (!text) return;
    const started = Date.now();
    const paint = () => {
        const sec = Math.round((Date.now() - started) / 1000);
        $('state-text').textContent = text + (sec >= 3 ? ' (' + sec + ' วินาที)' : '');
        if (sec >= 40) $('retry').hidden = false;
    };
    paint();
    stateTimer = setInterval(paint, 1000);
}

function fail(text) {
    clearInterval(stateTimer);
    $('state').hidden = false;
    $('state').classList.add('bad');
    $('state-text').textContent = text;
    $('retry').hidden = false;
}

// ===== ฟอร์มต้นแบบจากโฟลเดอร์ Google Drive =====
let forms = []; // [{ id, name, updated }]

const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0)).buffer;
const call = async (body) => JSON.parse(await fetchProtectedText(API_URL, body));

// ใช้สำเนาในเครื่องถ้าไฟล์ใน Drive ไม่ได้ถูกแก้
async function openForm(id) {
    template = null;
    const info = forms.find((f) => f.id === id);
    let saved = await idb('readonly', (s) => s.get('form:' + id)).catch(() => null);
    if (!saved || (info && info.updated > saved.updated)) {
        busy('กำลังดึงฟอร์มจาก Google Drive');
        const res = await call({ action: 'form', id });
        saved = { buffer: fromBase64(res.data), name: res.name, updated: res.updated };
        await idb('readwrite', (s) => s.put(saved, 'form:' + id)).catch(() => {});
    }
    busy('กำลังอ่านรายชื่อรถจากฟอร์ม');
    await useTemplate(saved.buffer, saved.name);
    busy('');
}

async function loadForms() {
    busy('กำลังดึงรายชื่อหน่วยงานจาก Google Drive');
    let problem = null;
    try {
        forms = (await call({ action: 'forms' })).forms;
        localStorage.setItem('bbs-forms', JSON.stringify(forms));
    } catch (err) {
        problem = err;
        try { forms = JSON.parse(localStorage.getItem('bbs-forms')) || []; } catch { forms = []; }
    }
    $('form').replaceChildren(...forms.map((f) => el('option', { value: f.id, textContent: shortName(f.name) })));
    $('form').hidden = false;
    $('pick-file').hidden = true;
    if (!forms.length) throw problem || new Error('ไม่พบไฟล์ฟอร์ม .xlsx ในโฟลเดอร์ Drive');
    const last = localStorage.getItem('bbs-form');
    if (forms.some((f) => f.id === last)) $('form').value = last;
    await openForm($('form').value);
}

// "รายงาน…พขร. BBS BFPL WO-LLK วันที่/เดือน/ปี.xlsx" → "BBS BFPL WO-LLK"
const shortName = (name) => name.replace(/\.xlsx$/i, '').split('วันที่')[0]
    .replace(/^รายงานติดตามพฤติกรรมพขร\.?\s*/, '').trim() || name;

// ===== ข้อมูลรายงานต่อ 1 ฟอร์ม/วัน/กะ =====
const keyOf = () => (API_URL ? $('form').value + '_' : '') + $('date').value + '_' + $('shift').value;
const localKey = (key) => 'bbs-report:' + key;

function emptyVehicle(v) {
    const active = !!v.driver;
    return {
        scc: v.scc, plate: v.plate, driver: v.driver, risk: v.risk,
        gps: active ? 'ปกติ' : '', cctv: active ? 'ปกติ' : '', trips: [], rounds: []
    };
}

function newReport() {
    return {
        date: $('date').value, shift: $('shift').value,
        checker: $('checker').value, monitor: $('monitor').value,
        vehicles: []
    };
}

// สีของจุด: แดง = พลาด, เหลือง = ยังไม่ถึงชีต, เขียว = เรียบร้อย
function status(text, bad = false) {
    const wait = !bad && /รอส่ง|กำลัง|ในเครื่อง/.test(text);
    $('status').className = 'save-state ' + (bad ? 'bad' : wait ? 'wait' : 'done');
    $('status').hidden = !text;
    $('status-title').textContent = bad ? 'มีปัญหา' : wait ? 'กำลังบันทึก' : 'บันทึกแล้ว';
    $('status-detail').textContent = text;
}

// ส่งขึ้นชีตเป็นรอบ: หลังหยุดกรอก 5 วินาที หรืออย่างช้าทุก 60 วินาที และตอนสลับ/ปิดหน้า
const IDLE_MS = 5000;
const MAX_WAIT_MS = 60000;
const pending = new Map(); // key -> ข้อมูลที่รอส่ง
let idleTimer;
let maxTimer = null;

// ===== หลายเครื่องกรอกรายงานเดียวกัน: อ่านของบนชีตมารวมก่อนเสมอ (bbs-merge.js) ไม่เขียนทับ =====
let seen = null; // ภาพจำของ report ใช้ดูว่าเครื่องนี้แก้อะไรไป

async function fetchRemote(key) {
    const res = await call({ action: 'load', key });
    return res.doc ? JSON.parse(res.doc) : null;
}

// กำลังพิมพ์หรือเปิดหน้าต่างอยู่ ยังไม่วาดใหม่ (ของคนอื่นจะเข้ามารอบถัดไป)
const busyEditing = () => openRound.size > 0 || !!document.querySelector('dialog[open]') ||
    !!document.activeElement?.matches('input:not([type=checkbox]):not([type=search]), select, textarea');

function keep() {
    try { localStorage.setItem(localKey(report.key), JSON.stringify(report)); } catch { /* ยังมีบนชีต */ }
}

function adopt(merged) {
    if (merged.key !== keyOf() || busyEditing() || sameReport(merged, report)) return;
    report = merged;
    mergeVehicles();
    seen = snapshot(report);
    keep();
    render();
}

async function flush() {
    clearTimeout(idleTimer);
    clearTimeout(maxTimer);
    maxTimer = null;
    if (pending.size) status('กำลังส่งขึ้น Google Sheet…');
    for (const [key, doc] of [...pending]) {
        pending.delete(key);
        try {
            const remote = await fetchRemote(key);
            const merged = merge(JSON.parse(doc), remote);
            if (!sameReport(merged, remote)) await call({ action: 'save', key, doc: JSON.stringify(merged) });
            adopt(merged);
            status(pending.size ? 'รอส่งขึ้น Google Sheet…'
                : 'บันทึกลง Google Sheet แล้ว ' + new Date().toTimeString().slice(0, 5) + ' น.');
        } catch (err) {
            if (!pending.has(key)) pending.set(key, doc);
            status('ส่งขึ้น Google Sheet ไม่ได้ (เก็บในเครื่องแล้ว จะลองใหม่): ' + err.message, true);
            maxTimer ||= setTimeout(flush, MAX_WAIT_MS);
        }
    }
}

// ดึงของที่คนอื่นกรอกเป็นระยะ และส่งกลับถ้าของเรามีอะไรที่บนชีตหายไป
const PULL_MS = 30000;
async function pull() {
    if (!API_URL || !template || !report || document.visibilityState !== 'visible' || pending.size) return;
    const { key } = report;
    try {
        const remote = await fetchRemote(key);
        if (!remote || key !== report.key || pending.size) return;
        const merged = merge(report, remote);
        adopt(merged);
        if (!sameReport(merged, remote)) queue(key, JSON.stringify(merged));
    } catch (err) {
        console.warn('pull', err);
    }
}
setInterval(pull, PULL_MS);

function queue(key, doc) {
    pending.set(key, doc);
    status('บันทึกในเครื่องแล้ว รอส่งขึ้น Google Sheet…');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(flush, IDLE_MS);
    maxTimer ||= setTimeout(flush, MAX_WAIT_MS);
}

function save() {
    report.updatedAt = Date.now();
    seen = markEdits(report, seen);
    const key = report.key;
    try {
        localStorage.setItem(localKey(key), JSON.stringify(report));
        localStorage.setItem('bbs-names', JSON.stringify({ checker: report.checker, monitor: report.monitor }));
    } catch { status('บันทึกในเครื่องไม่ได้ (พื้นที่เต็มหรือถูกบล็อก)', true); return; }
    if (!API_URL) { status('บันทึกในเครื่องนี้แล้ว (ยังไม่ได้เชื่อม Google Sheet)'); return; }
    queue(key, JSON.stringify(report));
}

// รถในฟอร์มที่ยังไม่มีในรายงาน → เพิ่มเข้าไป ข้อมูลที่กรอกแล้วคงเดิม
function mergeVehicles() {
    report.key = keyOf();
    if (!template) return;
    report.formName = template.name;
    const have = new Set(report.vehicles.map((v) => v.scc));
    report.vehicles.push(...template.vehicles.filter((v) => !have.has(v.scc)).map(emptyVehicle));
}

async function load() {
    current = null;
    openRound.clear();
    const key = keyOf();
    let local = null;
    try { local = JSON.parse(localStorage.getItem(localKey(key))); } catch { /* เริ่มใหม่ */ }
    report = normalize(local || newReport());
    mergeVehicles();
    seen = snapshot(report);
    render();
    if (!API_URL || !template) return;
    try {
        status('กำลังโหลดจาก Google Sheet…');
        const remote = await fetchRemote(key);
        if (key !== keyOf()) return;
        if (remote) {
            // เท่ากันทุกอย่าง (ของเก่าไม่มีเวลาแก้) ให้ฝั่งที่บันทึกทีหลังชนะ
            const localNewer = local && (local.updatedAt || 0) > (remote.updatedAt || 0);
            report = localNewer ? merge(remote, report) : merge(report, remote);
            mergeVehicles();
            seen = snapshot(report);
            keep();
            render();
        }
        // กรอกค้างไว้แล้วยังไม่ได้ส่ง (ปิดหน้าไปก่อน) → ส่งตอนนี้
        if (local && !sameReport(report, remote)) queue(key, JSON.stringify(report));
        else status('ข้อมูลตรงกับ Google Sheet');
    } catch (err) {
        status('โหลดจาก Google Sheet ไม่ได้: ' + err.message, true);
    }
}

// ===== สร้างหน้าจอ =====
function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    node.append(...children.filter((c) => c !== null && c !== undefined));
    return node;
}

function input(obj, prop, placeholder, extra = {}) {
    const node = el('input', { value: obj[prop] || '', placeholder, ...extra });
    node.setAttribute('aria-label', placeholder);
    node.addEventListener('input', () => { obj[prop] = node.value; save(); });
    return node;
}

function select(obj, prop, label, options) {
    const node = el('select', {}, ...options.map(([value, text]) => el('option', { value, textContent: text })));
    node.setAttribute('aria-label', label);
    if (obj[prop] && !options.some(([v]) => v === obj[prop])) node.append(el('option', { value: obj[prop], textContent: obj[prop] }));
    node.value = obj[prop] || '';
    node.addEventListener('change', () => { obj[prop] = node.value; save(); });
    return node;
}

const button = (text, onClick, cls = 'btn') => el('button', { type: 'button', className: cls, textContent: text, onclick: onClick });

const presetMarks = (type) => Object.fromEntries(TYPES[type].preset.map((c) => [c, 'P']));

function roundView(v, r, i, redraw) {
    if (!TYPES[r.type]) r.type = 'driving'; // ข้อมูลที่กรอกจากหน้าแบบตารางไม่มีประเภท
    r.marks ||= {};
    const checks = el('div', { className: 'checks' });
    const count = el('summary');
    const tally = () => {
        const bad = Object.values(r.marks).filter((m) => m === 'O').length;
        count.textContent = 'หัวข้อตรวจ: ติ๊กแล้ว ' + Object.keys(r.marks).length + '/' + TYPES[r.type].cols.length + (bad ? ' · ไม่ผ่าน ' + bad : '');
    };
    for (const col of TYPES[r.type].cols) {
        const name = (template && template.checks[col]) || col;
        const chip = el('button', { type: 'button', title: name });
        const paint = () => {
            const mark = r.marks[col] || '';
            chip.className = 'chk ' + (mark === 'P' ? 'ok' : mark === 'O' ? 'no' : '');
            chip.textContent = (mark === 'P' ? '✓ ' : mark === 'O' ? '✗ ' : '– ') + name.replace(/\s+/g, ' ').trim();
        };
        chip.onclick = () => { // ✓ → ✗ → ว่าง
            const mark = r.marks[col];
            if (mark === 'P') r.marks[col] = 'O';
            else if (mark === 'O') delete r.marks[col];
            else r.marks[col] = 'P';
            paint();
            tally();
            save();
        };
        paint();
        checks.append(chip);
    }

    const type = el('select', {}, ...Object.entries(TYPES).map(([value, t]) => el('option', { value, textContent: t.label })));
    type.value = r.type;
    type.setAttribute('aria-label', 'ประเภทการตรวจ');
    type.onchange = () => { r.type = type.value; r.marks = presetMarks(r.type); save(); redraw(); };

    tally();
    // ปุ่มลัด: เติมค่าเริ่มต้นเฉพาะช่องที่ยังว่าง (ข้อที่เป็น ✗ คงไว้) หรือล้างทั้งหมด
    const quick = el('div', { className: 'line' },
        button('✓ ค่าเริ่มต้น', () => { for (const col of TYPES[r.type].preset) r.marks[col] ||= 'P'; save(); redraw(); }),
        button('ล้าง', () => { r.marks = {}; save(); redraw(); }));
    return el('div', { className: 'round' },
        el('div', { className: 'line' },
            input(r, 'time', 'เวลา', { type: 'time', step: '1' }),
            input(r, 'place', 'สถานที่', { className: 'grow' }),
            type,
            button('ลบ', () => { v.rounds.splice(i, 1); save(); redraw(); })),
        TYPES[r.type].cols.length
            ? el('details', { open: !r.closed, ontoggle: (e) => { r.closed = !e.target.open; } }, count, quick, checks)
            : null,
        input(r, 'note', 'หมายเหตุ / พฤติกรรมเสี่ยง / ชมเชย', { className: 'note' }));
}

function tripView(v, t, i, redraw) {
    const cust = input(t, 'cust', 'ชื่อลูกค้า (Ship-to)', { className: 'grow' });
    const id = input(t, 'custId', 'รหัสลูกค้า');
    id.addEventListener('change', () => {
        const name = template && template.customers[id.value.trim()];
        if (name) { t.cust = cust.value = name; save(); }
    });
    return el('div', { className: 'line' },
        input(t, 'ship', 'Shipment'), id, cust,
        button('ลบ', () => { v.trips.splice(i, 1); save(); redraw(); }));
}

let current = null; // เบอร์รถที่เปิดดูอยู่ (null = หน้ารวม)
const openRound = new Map(); // เบอร์รถ -> รอบที่กำลังเปิดแก้ (เปิดทีละรอบ)

// เวลาจริงของรอบตรวจ ใช้เรียงลำดับ (กะกลางคืน: ก่อนเที่ยง = วันถัดไป)
function roundDate(r) {
    if (!r?.time) return null;
    const [y, m, d] = report.date.split('-').map(Number);
    const [hh, mm, ss = 0] = r.time.split(':').map(Number);
    return new Date(y, m - 1, d + (report.shift === 'night' && hh < 12 ? 1 : 0), hh, mm, ss);
}

const byTime = (rounds) => [...rounds].sort((x, y) => (roundDate(x)?.getTime() || 0) - (roundDate(y)?.getTime() || 0));
const badCount = (r) => Object.values(r.marks || {}).filter((m) => m === 'O').length;
const shortTime = (r) => (r.time || '--:--').slice(0, 5);
const typeName = (r) => TYPES[r.type]?.label || '';

function openVehicle(scc) {
    if (current === null) history.pushState({ bbs: true }, ''); // ปุ่มย้อนกลับของมือถือ = กลับหน้ารวม
    current = scc;
    render();
    window.scrollTo(0, 0);
}

function closeVehicle() {
    if (history.state?.bbs) history.back();
    else { current = null; render(); }
}

window.addEventListener('popstate', () => { current = null; if (report) render(); });

// "26/11/2026 00:21:22" ตรงกับที่ออกในรายงาน (กะกลางคืนหลังเที่ยงคืนเป็นวันถัดไป)
function stamp(r) {
    const at = roundDate(r);
    if (!at) return '--/--/---- --:--:--';
    const two = (n) => String(n).padStart(2, '0');
    return two(at.getDate()) + '/' + two(at.getMonth() + 1) + '/' + at.getFullYear() + ' ' +
        [at.getHours(), at.getMinutes(), at.getSeconds()].map(two).join(':');
}

// 1 รอบตรวจ = 1 แถว 3 คอลัมน์ตรงกันทุกคัน: วันเวลา | สถานที่ | สถานะ
const roundLine = (r) => el('span', { className: 'log' },
    el('span', { className: 'stamp', textContent: stamp(r) }),
    el('span', { className: 'place' }, r.place || el('i', { textContent: 'ยังไม่ใส่สถานที่' }),
        r.note ? el('small', { textContent: r.note }) : null),
    el('span', { className: 'kind' }, typeName(r),
        badCount(r) ? el('em', { textContent: 'ไม่ผ่าน ' + badCount(r) }) : null));

// ปลายทางในแผน บรรทัดละแห่ง
const destNames = (v) => destList(v.trips).map((d) => d.name);

// สถานะงานของปลายทาง: ที่เลือกเองมาก่อน ไม่ได้เลือก = เทียบชื่อกับสถานที่ที่ตรวจแล้ว
function destState(v, name) {
    const manual = v.dest?.[name];
    if (manual === 'cancel' || manual === 'open') return { state: manual };
    const names = destNames(v);
    const round = byTime(v.rounds).find((r) => r.type !== 'loading' && samePlace(r.place, name, names));
    if (manual === 'done') return { state: 'done', round };
    return round ? { state: 'done', round } : { state: 'open' };
}

const STATE_TEXT = { open: 'รอส่ง', done: 'ส่งแล้ว', cancel: 'ยกเลิก', removed: 'ตัดออก' };

// เลือกสถานะเอง (หน้ารายคัน)
function destSelect(v, name, redraw) {
    const node = el('select', {}, ...[['', 'อัตโนมัติ'], ['done', 'ส่งแล้ว'], ['open', 'รอส่ง'], ['cancel', 'ยกเลิก']]
        .map(([value, text]) => el('option', { value, textContent: text })));
    node.value = v.dest?.[name] || '';
    node.setAttribute('aria-label', 'สถานะงาน ' + name);
    node.onchange = () => {
        v.dest ||= {};
        if (node.value) v.dest[name] = node.value; else delete v.dest[name];
        save();
        redraw();
    };
    return node;
}

const changeNote = (c) => el('span', { className: 'change', textContent: describe(c) + ' (อัปเดต ' + c.at + ')' });

function destinations(v, redraw) {
    const names = destNames(v);
    const changes = v.changes || [];
    const removed = changes.filter((c) => c.type === 'removed');
    const driver = changes.filter((c) => c.type === 'driver');
    if (!names.length && !removed.length && !driver.length) return null;

    const line = (no, name, info, notes, control) => el('span', { className: 'item ' + info.state },
        el('span', { className: 'no', textContent: no }),
        el('span', { className: 'name' }, name, ...notes.map(changeNote)),
        control || el('span', { className: 'st' },
            (info.round ? shortTime(info.round) + ' ' : '') + STATE_TEXT[info.state]),
        control ? el('span', { className: 'st' },
            (info.round ? shortTime(info.round) + ' ' : '') + STATE_TEXT[info.state]) : null);

    return el('span', { className: 'dest' },
        ...driver.map(changeNote),
        ...names.map((name, i) => line(String(i + 1), name, destState(v, name),
            changes.filter((c) => c.name === name && c.type !== 'driver' && c.type !== 'removed'),
            redraw ? destSelect(v, name, redraw) : null)),
        ...removed.map((c) => line('–', c.name, { state: 'removed' }, [c], null)));
}

// ===== หน้ารวม: รถละกล่อง หัว (รถ/คนขับ) → ปลายทาง → รอบที่ตรวจ =====
function vehicleRow(v) {
    return el('button', { type: 'button', className: 'row' + (v.rounds.length ? '' : ' none'), onclick: () => openVehicle(v.scc) },
        el('span', { className: 'car' },
            el('b', { textContent: v.scc }),
            v.plate ? el('span', { className: 'plate', textContent: v.plate }) : null,
            el('span', { className: 'who', textContent: v.driver || 'ไม่มีคนขับ' }),
            v.changes?.length ? el('span', { className: 'changed', textContent: 'แผนเปลี่ยน' }) : null,
            el('span', { className: 'tally', textContent: v.rounds.length ? 'ตรวจ ' + v.rounds.length + ' รอบ' : 'ยังไม่ตรวจ' })),
        destinations(v),
        v.rounds.length ? el('span', { className: 'logs' }, ...byTime(v.rounds).map(roundLine)) : null);
}

// ===== หน้ารายคัน =====
function vehiclePage(v) {
    const page = el('div', { className: 'vehicle' });
    let infoOpen = !v.driver || v.trips.some((t) => !t.ship && !t.cust);
    const redraw = () => {
        const editing = v.rounds[openRound.get(v.scc)];
        const driver = input(v, 'driver', 'ชื่อ พขร.', { className: 'grow' });
        const info = el('details', { className: 'info', open: infoOpen },
            el('summary', { textContent: 'ข้อมูลคนขับและงาน (' + v.trips.length + ' งาน)' }),
            el('div', { className: 'line' },
                driver,
                input(v, 'risk', 'กลุ่มเสี่ยง เช่น L ปกติ'),
                el('label', {}, 'GPS ', select(v, 'gps', 'สถานะ GPS', [['', '-'], ['ปกติ', 'ปกติ'], ['ไม่ปกติ', 'ไม่ปกติ']])),
                el('label', {}, 'CCTV ', select(v, 'cctv', 'สถานะ CCTV', [['', '-'], ['ปกติ', 'ปกติ'], ['ไม่ปกติ', 'ไม่ปกติ']]))),
            ...v.trips.map((t, i) => tripView(v, t, i, redraw)),
            button('+ เพิ่มงาน', () => { v.trips.push({ ship: '', custId: '', cust: '' }); save(); redraw(); }));
        info.addEventListener('toggle', () => { infoOpen = info.open; });

        const entry = (r) => {
            const i = v.rounds.indexOf(r);
            if (r === editing) {
                return el('div', { className: 'editor' },
                    roundView(v, r, i, () => redraw()),
                    button('✔ เสร็จ', () => { openRound.delete(v.scc); redraw(); }, 'btn primary wide'));
            }
            return el('button', { type: 'button', className: 'entry', onclick: () => { openRound.set(v.scc, i); redraw(); } },
                roundLine(r));
        };

        page.replaceChildren(
            button('← กลับหน้ารวม', closeVehicle),
            el('h3', { className: 'title' }, v.scc + ' ',
                v.plate ? el('span', { className: 'plate', textContent: v.plate }) : null, ' ' + (v.driver || '')),
            destinations(v, redraw),
            button('+ ตรวจรอบใหม่', () => {
                const time = new Date().toTimeString().slice(0, 8);
                v.rounds.push({ time, place: '', type: 'driving', marks: presetMarks('driving'), note: '' });
                openRound.set(v.scc, v.rounds.length - 1);
                save();
                redraw();
            }, 'btn primary wide'),
            ...byTime(v.rounds).map(entry),
            info);
    };
    redraw();
    return page;
}

// คันที่ต้องแสดง: มีงาน เพิ่มเข้ามาเอง หรือมีรอบตรวจที่ลงเอง
// (รอบ quiet = ลงจากรูปให้รถที่ไม่มีงาน เก็บไว้ในรายงานแต่ไม่ดึงขึ้นหน้าทำงาน)
const hasWork = (v) => v.trips.length > 0 || !!v.pinned || v.rounds.some((r) => !r.quiet);

function render() {
    $('checker').value = report.checker || '';
    $('monitor').value = report.monitor || '';
    const open = current && report.vehicles.find((v) => v.scc === current);
    document.body.classList.toggle('detail', !!open);
    $('setup-title').textContent = [
        $('form').selectedOptions[0]?.textContent,
        report.date.split('-').reverse().join('/'),
        report.shift === 'night' ? 'กลางคืน' : 'กลางวัน'
    ].filter(Boolean).join(' · ');
    for (const id of ['export', 'summary-button', 'alert-button', 'plan-button', 'shot-button', 'search', 'add']) $(id).disabled = !template;
    $('template-name').textContent = template ? template.name : '';
    $('template-name').hidden = !!API_URL || !template;
    if (open) { $('list').replaceChildren(vehiclePage(open)); return; }

    const q = $('search').value.trim().toLowerCase();
    // ยังไม่ตรวจอยู่บนสุด ตามด้วยคันที่ตรวจนานแล้ว
    const lastAt = (v) => roundDate(byTime(v.rounds).at(-1))?.getTime() || 0;
    const shown = report.vehicles.filter((v) => (q
        ? [v.scc, v.plate, v.driver].join(' ').toLowerCase().includes(q)
        : $('show-all').checked || hasWork(v)))
        .sort((x, y) => Number(!hasWork(x)) - Number(!hasWork(y)) || lastAt(x) - lastAt(y));
    $('list').replaceChildren(...(shown.length
        ? shown.map(vehicleRow)
        : template ? [el('p', { className: 'empty', textContent: q ? 'ไม่พบรถที่ค้นหา' : 'ยังไม่มีรถที่มีงาน กด “แผนงาน” หรือ “+ รถ”' })] : []));
    const working = report.vehicles.filter(hasWork);
    $('count').textContent = template
        ? 'ยังไม่ตรวจ ' + working.filter((v) => !v.rounds.length).length + ' จาก ' + working.length + ' คัน' : '';
    $('hidden-count').textContent = String(report.vehicles.length - working.length);
}

async function useTemplate(buffer, name) {
    template = { buffer, name, ...(await readTemplate(buffer)) };
}

// เบอร์รถ → ทะเบียน จากฟอร์มอื่นในโฟลเดอร์ (ใช้เติมตอนทำรายงานบนฟอร์มกลาง)
async function knownVehicles() {
    const found = new Map();
    for (const f of forms) {
        if (f.id === $('form').value) continue;
        try {
            let saved = await idb('readonly', (s) => s.get('form:' + f.id)).catch(() => null);
            if (!saved || f.updated > saved.updated) {
                const res = await call({ action: 'form', id: f.id });
                saved = { buffer: fromBase64(res.data), name: res.name, updated: res.updated };
                await idb('readwrite', (s) => s.put(saved, 'form:' + f.id)).catch(() => {});
            }
            for (const v of (await readTemplate(saved.buffer)).vehicles) {
                const no = vehicleNo(v.scc);
                if (v.plate && !found.has(no)) found.set(no, v);
            }
        } catch (err) {
            console.warn('อ่านฟอร์ม ' + f.name + ' ไม่ได้', err);
        }
    }
    return found;
}

// ===== อัปโหลดแผนงาน: ดึงเฉพาะวันที่ + กะ ที่เลือกอยู่ ให้ตรวจสรุปก่อนเติม =====
let planPreview = []; // [{ v, item, changes, fresh }]

async function importPlans(files) {
    const { date, shift } = report;
    const when = date.split('-').reverse().join('/') + (shift === 'night' ? ' กะกลางคืน' : ' กะกลางวัน');
    status('กำลังอ่านแผนงาน…');
    const { vehicles, notes } = await readPlans(files, date, shift);
    const mine = new Map(report.vehicles.map((v) => [vehicleNo(v.scc), v]));
    // ฟอร์มกลาง (ไม่มีเบอร์รถ): รถทุกคันในแผนถูกสร้างใหม่ ทะเบียนค้นจากฟอร์มอื่นใน Drive
    const created = new Set();
    if (!template.vehicles.length) {
        status('กำลังค้นทะเบียนรถจากฟอร์มอื่น…');
        const known = await knownVehicles();
        for (const [no, item] of vehicles) {
            if (mine.has(no)) continue;
            const info = known.get(no) || {};
            const v = emptyVehicle({ scc: 'SCC' + no, plate: item.plate || info.plate || '', driver: '', risk: '' });
            mine.set(no, v);
            created.add(v);
        }
    }
    const matched = [...vehicles].filter(([no]) => mine.has(no)).map(([no, item]) => {
        const v = mine.get(no);
        const fresh = !v.trips.length; // ยังไม่เคยมีงาน = งานใหม่ ไม่นับเป็นการเปลี่ยน
        return { v, item, fresh, changes: fresh ? [] : diffPlan(v, item) };
    });
    const update = report.vehicles.some((v) => v.trips.length); // เคยมีแผนแล้ว = โหมดอัปเดต
    planPreview = matched.filter((p) => p.fresh ? p.item.driver || p.item.trips.length : p.changes.length);
    for (const p of planPreview) p.created = created.has(p.v);
    const unchanged = matched.length - planPreview.length;
    const missing = [...vehicles.keys()].filter((no) => !mine.has(no));
    status('');
    $('plan-title').textContent = 'แผนงาน ' + when + ': ' + (update
        ? 'เปลี่ยน ' + planPreview.length + ' คัน · เหมือนเดิม ' + unchanged + ' คัน'
        : 'ตรงกับฟอร์มนี้ ' + planPreview.length + ' คัน');
    $('plan-list').replaceChildren(...planPreview.map(({ v, item, fresh, changes }) => el('li', {},
        el('b', { textContent: v.scc }),
        ' ' + (item.driver || v.driver || 'ไม่ระบุคนขับ'),
        fresh
            ? el('div', { className: 'mute', textContent: (update ? 'งานใหม่: ' : '') + destList(item.trips).map((d) => d.name).join(' | ') })
            : el('ul', {}, ...changes.map((c) => el('li', { textContent: describe(c) }))))));
    $('plan-notes').replaceChildren(...[
        ...notes,
        ...(missing.length ? ['รถในแผนที่ไม่มีในฟอร์มนี้ (ไม่เติม): ' + missing.join(', ')] : [])
    ].map((text) => el('li', { textContent: text })));
    $('plan-ok').disabled = !planPreview.length;
    $('plan-ok').textContent = update ? 'อัปเดตเฉพาะที่เปลี่ยน' : 'เติมลงฟอร์ม';
    $('plan-dialog').dataset.key = report.key || keyOf();
    $('plan-dialog').showModal();
    $('plan-dialog').scrollTop = 0; // เริ่มอ่านจากหัวสรุป
}

function applyPlans() {
    // เปลี่ยนวันที่/ฟอร์มระหว่างเปิดสรุป → ไม่เติมผิดรายงาน
    if ($('plan-dialog').dataset.key !== (report.key || keyOf())) return;
    const at = new Date().toTimeString().slice(0, 5);
    for (const { v, item, fresh, changes, created } of planPreview) {
        if (created && !report.vehicles.some((x) => x.scc === v.scc)) report.vehicles.push(v);
        if (item.driver) v.driver = item.driver;
        if (item.risk) v.risk = item.risk;
        else v.risk ||= item.riskIfEmpty;
        const jobsChanged = fresh || changes.some((c) => c.type !== 'driver');
        if (item.trips.length && jobsChanged) {
            const ids = new Map(v.trips.map((t) => [t.cust, t.custId]));
            v.trips = item.trips.map((t) => ({ ...t, custId: t.custId || ids.get(t.cust) || '' }));
        }
        if (!fresh) v.changes = mergeChanges(v.changes, changes, v.trips, at);
        if (v.driver) { v.gps ||= 'ปกติ'; v.cctv ||= 'ปกติ'; }
    }
    save();
    render();
}

// ===== อ่านรูป: เลือกไฟล์ / วาง / ลากมาใส่ → ตรวจสรุป → เพิ่มเป็นรอบ "ลงเวลาอย่างเดียว" =====
let shotItems = []; // [{ v, time, place, use, warn }]
let shotKey = '';
let shotQueue = Promise.resolve();
let shotsLeft = 0; // รูปที่ยังอ่านไม่เสร็จ: ยังกดเพิ่มไม่ได้ กันตกหล่น

function openShots() {
    if (!template) return false;
    if (!$('shot-dialog').open) {
        shotItems = [];
        shotKey = report.key;
        $('shot-type').value = 'none';
        $('shot-state').textContent = '';
        drawShots();
        $('shot-dialog').showModal();
    }
    return true;
}

// เลือกสถานะของรถ ณ เวลานั้น (เลือกแล้วติ๊ก ✓ ค่าเริ่มต้นของสถานะนั้นให้)
function typeSelect(label, value, onChange) {
    const node = el('select', {}, ...Object.entries(TYPES).map(([key, t]) => el('option', { value: key, textContent: t.label })));
    node.value = value;
    node.setAttribute('aria-label', label);
    node.onchange = () => onChange(node.value);
    return node;
}

const tickNote = (type) => (TYPES[type].preset.length ? 'ติ๊กให้ ' + TYPES[type].preset.length + ' ข้อ' : '');

function drawShots() {
    $('shot-all').hidden = shotItems.length < 2;
    $('shot-list').replaceChildren(...shotItems.map((item) => {
        const use = el('input', { type: 'checkbox', checked: item.use });
        use.setAttribute('aria-label', 'เพิ่ม ' + item.v.scc);
        use.onchange = () => { item.use = use.checked; countShots(); };
        const time = el('input', { type: 'time', step: '1', value: item.time });
        time.setAttribute('aria-label', 'เวลา ' + item.v.scc);
        time.oninput = () => { item.time = time.value; };
        const place = el('input', { value: item.place, placeholder: 'สถานที่', className: 'grow' });
        place.setAttribute('aria-label', 'สถานที่ ' + item.v.scc);
        place.oninput = () => { item.place = place.value; };
        const ticks = el('span', { className: 'mute', textContent: tickNote(item.type) });
        const type = typeSelect('สถานะ ' + item.v.scc, item.type, (value) => {
            item.type = value;
            ticks.textContent = tickNote(value);
        });
        return el('div', { className: 'shot' },
            el('label', { className: 'line' }, use, el('b', { textContent: item.v.scc }), ' ' + (item.v.driver || ''),
                hasWork(item.v) ? null : el('span', { className: 'mute', textContent: 'ไม่มีงาน' }),
                item.warn ? el('em', { textContent: item.warn }) : null),
            el('div', { className: 'line' }, time, place),
            el('div', { className: 'line' }, type, ticks));
    }));
    countShots();
}

function countShots() {
    const n = shotItems.filter((x) => x.use).length;
    $('shot-ok').textContent = shotsLeft ? 'กำลังอ่านอีก ' + shotsLeft + ' รูป…' : 'เพิ่ม ' + n + ' รอบ';
    $('shot-ok').disabled = !!shotsLeft || !n;
}

async function readShot(blob) {
    $('shot-state').textContent = '⏳ กำลังอ่านรูป… (ครั้งแรกต้องโหลดตัวอ่านภาษาไทย อาจนานหน่อย)';
    const working = report.vehicles.filter(hasWork);
    // จับรถทุกคันในรายงาน คันที่ไม่มีงานก็เก็บข้อมูลไว้ เรียงคันมีงานขึ้นก่อน
    const found = parseShot(await readImage(blob), report.vehicles)
        .sort((a, b) => Number(!hasWork(a.v)) - Number(!hasWork(b.v)));
    const nowTime = new Date().toTimeString().slice(0, 8);
    for (const x of found) {
        const time = x.time || nowTime;
        if (shotItems.some((i) => i.v === x.v && i.time === time && i.place === x.place)) continue;
        const outside = !inShift(x, report.date, report.shift);
        const already = x.v.rounds.some((r) => r.time === time);
        const warn = outside ? 'เวลาอยู่นอกกะนี้ (' + x.date.split('-').reverse().join('/') + ')'
            : already ? 'มีรอบเวลานี้แล้ว' : x.time ? '' : 'ในรูปไม่มีเวลา ใส่เวลาตอนนี้ให้';
        shotItems.push({ v: x.v, time, place: x.place, use: !outside && !already, warn, type: $('shot-type').value || 'none' });
    }
    shotItems.sort((a, b) => Number(!hasWork(a.v)) - Number(!hasWork(b.v)));
    const missing = working.filter((v) => !shotItems.some((i) => i.v === v)).map((v) => v.scc);
    const idle = found.filter((x) => !hasWork(x.v)).length;
    $('shot-state').textContent = (found.length ? '✔ พบ ' + found.length + ' คันในรูปล่าสุด' +
        (idle ? ' (ไม่มีงาน ' + idle + ' คัน เก็บไว้แต่ไม่แสดงหน้าทำงาน)' : '') : '⚠ ไม่พบรถของรายงานนี้ในรูปล่าสุด') +
        (missing.length ? ' · รถมีงานที่ยังไม่เจอ: ' + missing.join(', ') : '');
    drawShots();
}

function addShots(files) {
    const images = [...files].filter((f) => f && f.type.startsWith('image/'));
    if (!images.length || !openShots()) return;
    for (const image of images) {
        shotsLeft++;
        shotQueue = shotQueue.then(() => readShot(image)).catch((err) => {
            console.error(err);
            $('shot-state').textContent = '⚠ อ่านรูปไม่ได้: ' + err.message;
        }).then(() => { shotsLeft--; countShots(); });
    }
    countShots();
}

function applyShots() {
    if (shotKey !== report.key) return; // เปลี่ยนวันที่/ฟอร์มระหว่างเปิดอยู่ → ไม่เติมผิดรายงาน
    // ตัดสินว่ามีงานไหมก่อนเพิ่ม ไม่ให้รอบแรกที่เพิ่มเปลี่ยนผลของรอบถัดไป
    const quiet = new Set(shotItems.filter((x) => !hasWork(x.v)).map((x) => x.v));
    for (const item of shotItems.filter((x) => x.use)) {
        item.v.rounds.push({
            time: item.time, place: item.place.trim(), type: item.type, marks: presetMarks(item.type), note: '',
            ...(quiet.has(item.v) ? { quiet: true } : {})
        });
    }
    save();
    render();
}

function bindShots() {
    $('shot-all').append(typeSelect('สถานะของทุกคัน', 'none', (value) => {
        for (const item of shotItems) item.type = value;
        drawShots();
    }));
    $('shot-all').lastElementChild.id = 'shot-type';
    $('shot-button').addEventListener('click', openShots);
    $('shot-file').addEventListener('change', () => { addShots($('shot-file').files); $('shot-file').value = ''; });
    // วางรูปที่คัดลอกไว้ได้จากทุกที่ในหน้า (ข้อความที่วางในช่องกรอกไม่ถูกแตะ)
    document.addEventListener('paste', (e) => {
        const images = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
        if (!images.length) return;
        e.preventDefault();
        if ($('alert-dialog').open) alertImage(images);
        else addShots(images);
    });
    // ปุ่มวาง สำหรับมือถือที่ไม่มี Ctrl+V
    $('shot-paste').addEventListener('click', async () => {
        try {
            const images = [];
            for (const item of await navigator.clipboard.read()) {
                const type = item.types.find((t) => t.startsWith('image/'));
                if (type) images.push(await item.getType(type));
            }
            if (images.length) addShots(images);
            else $('shot-state').textContent = '⚠ ยังไม่มีรูปในคลิปบอร์ด ให้คัดลอกรูปก่อน';
        } catch {
            $('shot-state').textContent = '⚠ เบราว์เซอร์ไม่ให้อ่านคลิปบอร์ด ใช้ Ctrl+V หรือเลือกรูปแทน';
        }
    });
    const zone = $('shot-zone');
    zone.addEventListener('dragover', (e) => { e.preventDefault(); zone.classList.add('over'); });
    zone.addEventListener('dragleave', () => zone.classList.remove('over'));
    zone.addEventListener('drop', (e) => { e.preventDefault(); zone.classList.remove('over'); addShots(e.dataTransfer.files); });
    $('shot-ok').addEventListener('click', () => { applyShots(); $('shot-dialog').close(); });
    $('shot-cancel').addEventListener('click', () => $('shot-dialog').close());
}

// ===== ข้อความสรุปสำหรับวางใน LINE (หัวข้อที่ไม่มีข้อมูลไม่แสดง) =====
function summaryText() {
    const [y, m, d] = report.date.split('-');
    const working = report.vehicles.filter(hasWork);
    const tag = (v) => v.scc + (v.plate ? ' (' + v.plate + ')' : '');
    const issues = [];
    const notes = [];
    const waiting = [];
    const changes = [];
    let done = 0;
    let total = 0;
    let cancelled = 0;
    for (const v of working) {
        const rounds = byTime(v.rounds);
        for (const r of rounds) {
            const failed = Object.entries(r.marks || {}).filter(([, mark]) => mark === 'O')
                .map(([col]) => String(template.checks[col] || col).replace(/\s+/g, ' ').trim().slice(0, 60));
            if (!failed.length && !r.note) continue;
            const line = '- ' + tag(v) + ' ' + shortTime(r) + ' ' + (r.place || '') + ': ' + (r.note || failed.join(', '));
            (failed.length ? issues : notes).push(line);
        }
        const open = [];
        for (const name of destNames(v)) {
            const { state } = destState(v, name);
            if (state === 'cancel') { cancelled++; continue; }
            total++;
            if (state === 'done') done++;
            else open.push(name);
        }
        if (open.length) {
            const last = rounds.at(-1);
            waiting.push('- ' + v.scc + ': ' + open.join(', ') +
                (last ? '\n  ล่าสุด ' + shortTime(last) + ' ' + (last.place || '-') : ''));
        }
        for (const c of v.changes || []) changes.push('- ' + v.scc + ': ' + describe(c));
    }
    const checked = working.filter((v) => v.rounds.length).length;
    const section = (title, lines) => (lines.length ? ['', '[' + title + ']', ...lines] : []);
    return [
        'สรุป BBS ' + (API_URL ? shortName(template.name).replace(/^BBS\s*/i, '') : ''),
        d + '/' + m + '/' + (Number(y) + 543) + (report.shift === 'night' ? ' กะกลางคืน' : ' กะกลางวัน') +
            ' (ณ ' + new Date().toTimeString().slice(0, 5) + ' น.)',
        '',
        'ตรวจแล้ว ' + checked + '/' + working.length + ' คัน',
        total || cancelled ? 'ส่งแล้ว ' + done + '/' + total + ' งาน' + (cancelled ? ', ยกเลิก ' + cancelled : '') : null,
        ...section('พบข้อไม่ผ่าน', issues),
        ...section('ยังไม่ตรวจ', working.filter((v) => !v.rounds.length).length
            ? ['- ' + working.filter((v) => !v.rounds.length).map((v) => v.scc).join(', ')] : []),
        ...section('งานค้างส่ง', waiting),
        ...section('แผนเปลี่ยน', changes),
        ...section('หมายเหตุ', notes)
    ].filter((line) => line !== null).join('\n');
}

// ข้อความที่แก้และข้อความเพิ่มเติม จำแยกตามฟอร์ม/วัน/กะ ในเครื่องนี้
let summaryKey = '';
let draft = {}; // { text?, at?, extra? }

function keepDraft() {
    try { localStorage.setItem('bbs-summary:' + summaryKey, JSON.stringify(draft)); } catch { /* ใช้ได้จนปิดหน้า */ }
}

function showSummary() {
    $('summary-text').value = draft.text ?? summaryText();
    $('summary-note').textContent = draft.text === undefined
        ? 'สร้างจากข้อมูลล่าสุด'
        : 'ข้อความที่แก้ไว้เมื่อ ' + draft.at + ' น. กด “สร้างใหม่” เพื่อดึงข้อมูลล่าสุด';
    $('summary-copy').textContent = 'คัดลอก';
}

function bindSummary() {
    $('summary-button').addEventListener('click', () => {
        summaryKey = report.key;
        try { draft = JSON.parse(localStorage.getItem('bbs-summary:' + summaryKey)) || {}; } catch { draft = {}; }
        $('summary-extra').value = draft.extra || '';
        showSummary();
        $('summary-dialog').showModal();
        $('summary-copy').focus();
        $('summary-text').scrollTop = 0;
    });
    $('summary-text').addEventListener('input', () => {
        draft.text = $('summary-text').value;
        draft.at = new Date().toTimeString().slice(0, 5);
        keepDraft();
        $('summary-copy').textContent = 'คัดลอก';
    });
    $('summary-extra').addEventListener('input', () => {
        draft.extra = $('summary-extra').value;
        keepDraft();
        $('summary-copy').textContent = 'คัดลอก';
    });
    $('summary-new').addEventListener('click', () => {
        if (draft.text !== undefined && !confirm('ทิ้งข้อความที่แก้ไว้ แล้วสร้างจากข้อมูลล่าสุด?')) return;
        delete draft.text;
        delete draft.at;
        keepDraft();
        showSummary();
    });
    $('summary-copy').addEventListener('click', async () => {
        const extra = $('summary-extra').value.trim();
        const text = $('summary-text').value.trimEnd() + (extra ? '\n\n[ข้อความเพิ่มเติม]\n' + extra : '');
        try {
            await navigator.clipboard.writeText(text);
            $('summary-copy').textContent = 'คัดลอกแล้ว วางใน LINE ได้เลย';
        } catch {
            // เบราว์เซอร์ไม่ให้เขียนคลิปบอร์ด: รวมข้อความในช่องแล้วให้คัดลอกเอง
            $('summary-text').value = text;
            $('summary-text').select();
            $('summary-copy').textContent = 'กด Ctrl+C เพื่อคัดลอก';
        }
    });
    $('summary-close').addEventListener('click', () => $('summary-dialog').close());
}

// ===== ข้อความแจ้งเหตุ: โยนเนื้อหา → จัดเข้าแพทเทิน → คัดลอกส่ง LINE =====
const alertUnit = () => (API_URL ? shortName(template.name).replace(/^BBS\s*/i, '').replace(/\bWO[- ]*/i, '').replace(/^ALL$/i, '') : '');

function buildAlert() {
    const raw = $('alert-input').value;
    $('alert-copy').textContent = 'คัดลอก';
    if (!raw.trim()) { $('alert-output').value = ''; return; }
    const type = $('alert-type').value || detectType(raw);
    $('alert-guess').textContent = $('alert-type').value ? '' : 'แบบ: ' + ALERT_TYPES[type];
    $('alert-output').value = formatAlert(type, parseAlert(raw,
        { vehicles: report.vehicles, unit: alertUnit(), date: report.date }));
}

async function alertImage(images) {
    for (const image of images) {
        $('alert-guess').textContent = '⏳ กำลังอ่านรูป…';
        try {
            const text = await readImage(image);
            $('alert-input').value += ($('alert-input').value ? '\n' : '') + text.trim();
            buildAlert();
        } catch (err) {
            $('alert-guess').textContent = 'อ่านรูปไม่ได้: ' + err.message;
        }
    }
}

function bindAlert() {
    $('alert-type').append(...Object.entries(ALERT_TYPES).map(([value, textContent]) => el('option', { value, textContent })));
    $('alert-button').addEventListener('click', () => {
        $('alert-dialog').showModal();
        $('alert-input').focus();
    });
    $('alert-input').addEventListener('input', buildAlert);
    $('alert-type').addEventListener('change', buildAlert);
    $('alert-clear').addEventListener('click', () => {
        $('alert-input').value = '';
        $('alert-type').value = '';
        $('alert-guess').textContent = '';
        buildAlert();
        $('alert-input').focus();
    });
    $('alert-copy').addEventListener('click', async () => {
        try {
            await navigator.clipboard.writeText($('alert-output').value);
            $('alert-copy').textContent = 'คัดลอกแล้ว';
        } catch {
            $('alert-output').select();
            $('alert-copy').textContent = 'กด Ctrl+C เพื่อคัดลอก';
        }
    });
    $('alert-close').addEventListener('click', () => $('alert-dialog').close());
}

// ชื่อไฟล์ส่งออกตามชื่อฟอร์ม โดยตัดคำว่า "วันที่/เดือน..." ท้ายชื่อออก
function baseName() {
    const name = API_URL ? template.name.replace(/\.xlsx$/i, '').split('วันที่')[0].trim() : '';
    return name || 'รายงานติดตามพฤติกรรมพขร. BBS';
}

function bind() {
    bindShots();
    bindSummary();
    bindAlert();
    $('template').addEventListener('change', async () => {
        const file = $('template').files[0];
        if (!file) return;
        try {
            const buffer = await file.arrayBuffer();
            await useTemplate(buffer, file.name);
            await idb('readwrite', (s) => s.put({ buffer, name: file.name }, 'template'));
            mergeVehicles();
            render();
            save();
        } catch (err) {
            status('เปิดไฟล์ต้นแบบไม่ได้: ' + err.message, true);
        }
        $('template').value = '';
    });
    for (const id of ['date', 'shift']) $(id).addEventListener('change', () => { if ($('date').value) load(); });
    $('form').addEventListener('change', async () => {
        $('list').replaceChildren();
        for (const id of ['export', 'summary-button', 'alert-button', 'plan-button', 'shot-button', 'search', 'add']) $(id).disabled = true;
        try {
            await openForm($('form').value);
            localStorage.setItem('bbs-form', $('form').value);
            status('');
        } catch (err) {
            fail('เปิดฟอร์มไม่ได้: ' + err.message);
        }
        await load();
    });
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') { if (pending.size) flush(); }
        else pull();
    });
    for (const id of ['checker', 'monitor']) $(id).addEventListener('input', () => { report[id] = $(id).value; save(); });
    $('search').addEventListener('input', render);
    $('show-all').addEventListener('change', render);
    $('plan-button').addEventListener('click', () => $('plan').click());
    $('plan').addEventListener('change', async () => {
        const files = [...$('plan').files];
        $('plan').value = '';
        if (!files.length) return;
        try { await importPlans(files); }
        catch (err) { console.error(err); status('อ่านแผนงานไม่ได้: ' + err.message, true); }
    });
    $('plan-ok').addEventListener('click', () => { applyPlans(); $('plan-dialog').close(); });
    $('plan-cancel').addEventListener('click', () => $('plan-dialog').close());
    $('add').addEventListener('click', () => {
        $('add-list').replaceChildren(...report.vehicles.filter((v) => !hasWork(v)).map((v) =>
            el('option', { value: v.scc, label: [v.plate, v.driver].filter(Boolean).join(' · ') })));
        $('add-scc').value = '';
        $('add-plate').value = '';
        $('add-dialog').showModal();
    });
    $('add-cancel').addEventListener('click', () => $('add-dialog').close());
    $('add-form').addEventListener('submit', (e) => {
        e.preventDefault();
        const typed = $('add-scc').value.trim().toUpperCase();
        if (!typed) return;
        const no = vehicleNo(typed);
        let v = report.vehicles.find((x) => x.scc.toUpperCase() === typed || (no && vehicleNo(x.scc) === no));
        if (!v) {
            v = emptyVehicle({ scc: no ? 'SCC' + no : typed, plate: $('add-plate').value.trim(), driver: '', risk: '' });
            report.vehicles.push(v);
        }
        v.pinned = true;
        if (!v.trips.length) v.trips.push({ ship: '', custId: '', cust: '' });
        $('search').value = '';
        $('add-dialog').close();
        save();
        openVehicle(v.scc);
    });
    $('export').addEventListener('click', async () => {
        $('export').disabled = true;
        try {
            // มีแผนแล้ว คันที่ไม่มีงานให้เขียนว่าไม่มีวิ่งงาน (ยังไม่อัปแผน = ยังไม่รู้ ไม่เขียน)
            const planned = report.vehicles.some((v) => v.trips.some((t) => t.cust || t.ship));
            const blob = await buildReport(template.buffer, {
                ...report,
                vehicles: report.vehicles.map((v) => (planned && !hasWork(v) ? { ...v, idle: true } : v))
            });
            const [y, m, d] = report.date.split('-');
            const link = el('a', {
                href: URL.createObjectURL(blob),
                download: baseName() + ' ' + d + '-' + m + '-' + (Number(y) + 543) +
                    (report.shift === 'night' ? ' Night' : ' Day') + '.xlsx'
            });
            link.click();
            setTimeout(() => URL.revokeObjectURL(link.href), 10000);
            status('ส่งออกรายงานแล้ว');
        } catch (err) {
            console.error(err);
            status('ส่งออกไม่ได้: ' + err.message, true);
        }
        $('export').disabled = false;
    });
}

requireLogin(async () => {
    // วันที่/กะตั้งต้นตามเวลาปัจจุบัน (ก่อน 08:00 = กะกลางคืนของเมื่อวาน)
    const now = new Date();
    const hour = now.getHours();
    if (hour < 8) now.setDate(now.getDate() - 1);
    $('date').value = new Date(now - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
    $('shift').value = hour >= 8 && hour < 20 ? 'day' : 'night';
    try {
        const names = JSON.parse(localStorage.getItem('bbs-names')) || {};
        $('checker').value = names.checker || '';
        $('monitor').value = names.monitor || '';
    } catch { /* ไม่มีชื่อเดิม */ }
    $('retry').addEventListener('click', () => location.reload());
    for (const id of ['form', 'date', 'shift']) $(id).disabled = true;
    try {
        if (API_URL) await loadForms();
        else {
            const saved = await idb('readonly', (s) => s.get('template'));
            if (saved) await useTemplate(saved.buffer, saved.name);
        }
    } catch (err) {
        console.error(err);
        fail('เปิดฟอร์มไม่ได้: ' + err.message);
    }
    for (const id of ['form', 'date', 'shift']) $(id).disabled = false;
    bind();
    await load();
});
