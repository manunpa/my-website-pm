import { requireLogin, fetchProtectedText, PRESENCE_URL, auth } from './firebase-guard.js?v=20261122-cut';
import { readTemplate, buildReport, colName } from './bbs-xlsx.js?v=10';
import { readPlans, vehicleNo, sccName } from './bbs-plan.js?v=10';
import { readHourly, buildHourly } from './bbs-hourly.js?v=4';
import { readImage, parseShot, inShift } from './bbs-ocr.js?v=1';
import { samePlace } from './bbs-match.js?v=1';
import { ALERT_TYPES, detectType, parseAlert, formatAlert } from './bbs-alert.js?v=1';
import { normalize, snapshot, stamp as markEdits, merge, sameReport } from './bbs-merge.js?v=4';
import { destList, diffPlan, mergeChanges, describe } from './bbs-diff.js?v=1';
import { HISTORY_URL, nameKey, indexHistory, thaiDate } from './bbs-history.js?v=1';
import { createLog } from './bbs-log.js?v=1';

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

// ===== ประวัติการใช้งาน (bbs-log.js) =====
const activity = createLog({
    // เก็บที่ชีต PM การใช้งาน (apps-script/presence.gs) ต้องได้ logged กลับมา: สคริปต์รุ่นเก่าตอบ success เฉยๆ โดยไม่ได้จด
    send: async (rows) => !PRESENCE_URL ||
        JSON.parse(await fetchProtectedText(PRESENCE_URL, { action: 'log', rows })).logged === true,
    user: () => auth.currentUser?.email || ''
});

// group: ส่งออก (เขียว) / ลบ (แดง) / นำเข้า / แก้ไข / ดู
function note(group, action, extra = {}) {
    activity.add({
        group, action,
        form: [template && shortName(template.name), unit()?.name].filter(Boolean).join(' · '),
        date: report?.date || '',
        shift: report ? (report.shift === 'night' ? 'กลางคืน' : 'กลางวัน') : '',
        scc: '', ...extra
    });
}
const edited = (field, from, to, scc = '') =>
    note('แก้ไข', 'แก้ข้อมูล', { scc, field, from: String(from ?? ''), to: String(to ?? '') });
const roundText = (r) => [r.hour !== undefined ? 'ชั่วโมง ' + r.hour : '', r.time, r.place, typeName(r), r.note].filter(Boolean).join(' · ');

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
    .replace(/^รายงานติดตามพฤติกรรมพขร\.?\s*/, '').replace(/^ผ่าน\s*CCTV[\s\-]*/i, '')
    .replace(/\s*(January|February|March|April|May|June|July|August|September|October|November|December)\s*\d{4}/i, '')
    .trim() || name;

// ===== ข้อมูลรายงานต่อ 1 ฟอร์ม/วัน/กะ =====
// ฟอร์มที่มีหน่วยงานย่อย แยกรายงานกันคนละ key
const unit = () => template?.units?.[Number($('unit').value)] || null;
const keyOf = () => (API_URL ? $('form').value + (unit() ? '-u' + $('unit').value : '') + '_' : '') + $('date').value + '_' + $('shift').value;
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
    if ((merged.resetAt || 0) < (report.resetAt || 0)) return; // ผลที่ค้างมาจากก่อนกดล้าง
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
    report.layout = template.hourly ? 'hourly' : '';
    report.unitTitle = unit()?.title || '';
    report.tab = template.hourly ? unit()?.name || shortName(template.name).replace(/^BBS\s*/i, '') : ''; // ชื่อแท็บในชีต
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
    note('ดู', 'เปิดรายงาน');
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

// ล้างรายงานของ ฟอร์ม/วัน/กะ ที่เปิดอยู่ ทั้งในเครื่องและบนชีต
function resetReport() {
    const rounds = report.vehicles.reduce((n, v) => n + v.rounds.length, 0);
    // ต้องพิมพ์เอง กันกดตกลงผ่านโดยไม่อ่าน
    const typed = prompt([
        'ล้างรายงาน ' + $('setup-title').textContent,
        'มีรอบตรวจ ' + rounds + ' รายการ แผนงานและผลตรวจจะหายทุกเครื่อง กู้คืนไม่ได้',
        'พิมพ์คำว่า ล้าง เพื่อยืนยัน'
    ].join('\n\n'));
    if (typed === null) return;
    if (typed.trim() !== 'ล้าง') { alert('ยังไม่ได้ล้าง ต้องพิมพ์คำว่า ล้าง ให้ตรง'); return; }
    note('ลบ', 'ล้างรายงาน', { detail: 'รอบตรวจที่หายไป ' + rounds + ' รายการ' + report.vehicles.filter((v) => v.rounds.length)
        .map((v) => ' | ' + v.scc + ': ' + v.rounds.map(roundText).join(', ')).join('') });
    report = newReport();
    report.resetAt = report.headAt = Date.now();
    report.gone = {};
    mergeVehicles();
    seen = snapshot(report);
    current = null;
    openRound.clear();
    summaryKey = '';
    try { localStorage.removeItem('bbs-summary:' + report.key); } catch { /* ไม่มีร่างสรุป */ }
    save();
    render();
    if (API_URL) flush(); // ส่งทันที ไม่รอรอบ
}

// ===== สร้างหน้าจอ =====
function el(tag, props = {}, ...children) {
    const node = document.createElement(tag);
    Object.assign(node, props);
    node.append(...children.filter((c) => c !== null && c !== undefined));
    return node;
}

// current = รถที่กำลังแก้ (หน้ารายคัน) ใช้ลงประวัติ
function input(obj, prop, placeholder, extra = {}) {
    const node = el('input', { value: obj[prop] || '', placeholder, ...extra });
    node.setAttribute('aria-label', placeholder);
    let before = node.value;
    node.addEventListener('input', () => { obj[prop] = node.value; save(); });
    node.addEventListener('change', () => {
        if (node.value !== before) edited(placeholder, before, node.value, current || '');
        before = node.value;
    });
    return node;
}

function select(obj, prop, label, options) {
    const node = el('select', {}, ...options.map(([value, text]) => el('option', { value, textContent: text })));
    node.setAttribute('aria-label', label);
    if (obj[prop] && !options.some(([v]) => v === obj[prop])) node.append(el('option', { value: obj[prop], textContent: obj[prop] }));
    node.value = obj[prop] || '';
    node.addEventListener('change', () => { edited(label, obj[prop], node.value, current || ''); obj[prop] = node.value; save(); });
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
            const shown = (m) => (m === 'P' ? '✓' : m === 'O' ? '✗' : '–');
            edited('รอบ ' + shortTime(r) + ' ' + name.replace(/\s+/g, ' ').trim(), shown(mark), shown(r.marks[col]), v.scc);
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
    type.onchange = () => { edited('ประเภทการตรวจ รอบ ' + shortTime(r), typeName(r), TYPES[type.value].label, v.scc); r.type = type.value; r.marks = presetMarks(r.type); save(); redraw(); };

    tally();
    // ปุ่มลัด: เติมค่าเริ่มต้นเฉพาะช่องที่ยังว่าง (ข้อที่เป็น ✗ คงไว้) หรือล้างทั้งหมด
    const quick = el('div', { className: 'line' },
        button('✓ ค่าเริ่มต้น', () => { note('แก้ไข', 'ติ๊กค่าเริ่มต้น', { scc: v.scc, detail: roundText(r) }); for (const col of TYPES[r.type].preset) r.marks[col] ||= 'P'; save(); redraw(); }),
        button('ล้าง', () => { note('ลบ', 'ล้างหัวข้อตรวจ', { scc: v.scc, detail: roundText(r) + ' (ติ๊กไว้ ' + Object.keys(r.marks).length + ' ข้อ)' }); r.marks = {}; save(); redraw(); }));
    return el('div', { className: 'round' },
        el('div', { className: 'line' },
            input(r, 'time', 'เวลา', { type: 'time', step: '1' }),
            input(r, 'place', 'สถานที่', { className: 'grow' }),
            type,
            button('ลบ', () => { note('ลบ', 'ลบรอบตรวจ', { scc: v.scc, detail: roundText(r) }); v.rounds.splice(i, 1); save(); redraw(); })),
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
        if (name) { edited('ชื่อลูกค้า (จากรหัส)', t.cust, name, v.scc); t.cust = cust.value = name; save(); }
    });
    return el('div', { className: 'line' },
        input(t, 'ship', 'Shipment'), id, cust,
        button('ลบ', () => { noteTripDelete(v, t); v.trips.splice(i, 1); save(); redraw(); }));
}

const noteTripDelete = (v, t) => note('ลบ', 'ลบงาน', { scc: v.scc, detail: [t.ship, t.custId, t.cust].filter(Boolean).join(' · ') });

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
    note('ดู', 'เปิดดูรถ', { scc });
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
    // ฟอร์มรายชั่วโมงช่องเก็บแค่รหัสผล ไม่มีชื่อปลายทาง จึงใช้ที่เลือกเองเท่านั้น
    if (template?.hourly) return { state: manual === 'done' ? 'done' : 'open' };
    const names = destNames(v);
    const round = byTime(v.rounds).find((r) => r.type !== 'loading' && samePlace(r.place, name, names));
    if (manual === 'done') return { state: 'done', round };
    return round ? { state: 'done', round } : { state: 'open' };
}

const STATE_TEXT = { open: 'รอส่ง', done: 'ส่งแล้ว', cancel: 'ยกเลิก', removed: 'ตัดออก' };

// เลือกสถานะเอง (หน้ารายคัน)
function destSelect(v, name, redraw) {
    const node = el('select', {}, ...(template?.hourly
        ? [['', 'รอส่ง'], ['done', 'ส่งแล้ว'], ['cancel', 'ยกเลิก']]
        : [['', 'อัตโนมัติ'], ['done', 'ส่งแล้ว'], ['open', 'รอส่ง'], ['cancel', 'ยกเลิก']])
        .map(([value, text]) => el('option', { value, textContent: text })));
    node.value = v.dest?.[name] || '';
    node.setAttribute('aria-label', 'สถานะงาน ' + name);
    node.onchange = () => {
        v.dest ||= {};
        const unset = template?.hourly ? 'รอส่ง' : 'อัตโนมัติ';
        edited('สถานะงาน ' + name, STATE_TEXT[v.dest[name]] || unset, STATE_TEXT[node.value] || unset, v.scc);
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

// ===== ป้ายประวัติพฤติกรรมข้างชื่อ พขร. (ดูอย่างเดียว) =====
let behaviorLog = new Map();

// เปิด/ปิดได้จากหน้า Active Users (apps-script/presence.gs) เช็กซ้ำทุกนาที
let historyLoaded = false;

async function historyAllowed() {
    if (!PRESENCE_URL) return true;
    const { showHistory } = JSON.parse(await fetchProtectedText(PRESENCE_URL, { action: 'flags' }));
    return showHistory !== false;
}

function setHistory(map) {
    behaviorLog = map;
    if (!map.size && $('history-dialog').open) $('history-dialog').close();
    if (report && !busyEditing()) render();
}

async function loadHistory() {
    if (document.visibilityState !== 'visible') return;
    try {
        if (!(await historyAllowed())) {
            $('history-note').hidden = true;
            if (historyLoaded) { historyLoaded = false; setHistory(new Map()); }
            return;
        }
        if (historyLoaded) return;
        const { history: rows } = JSON.parse(await fetchProtectedText(HISTORY_URL));
        if (!Array.isArray(rows)) throw new Error('สคริปต์ยังเป็นเวอร์ชันเก่า');
        historyLoaded = true;
        $('history-note').hidden = true;
        setHistory(indexHistory(rows));
    } catch (err) {
        console.warn('history', err);
        if (!historyLoaded) $('history-note').hidden = false;
    }
}

function historyBadge(name) {
    const list = behaviorLog.get(nameKey(name));
    if (!list) return null;
    const lines = list.map((h) => thaiDate(h.date) + '  ' + h.what + (h.risk ? ' (เสี่ยง' + h.risk + ')' : ''));
    const head = 'ประวัติ 6 เดือน: ' + name + ' ' + list.length + ' ครั้ง';
    const open = (e) => {
        // ป้ายอยู่ในปุ่มของรถ ไม่ให้เปิดหน้ารถตามไปด้วย
        e.preventDefault();
        e.stopPropagation();
        $('history-title').textContent = head;
        $('history-list').replaceChildren(...lines.map((text) => el('li', { textContent: text })));
        $('history-dialog').showModal();
        note('ดู', 'ดูประวัติพฤติกรรม พขร.', { detail: name });
    };
    const node = el('span', {
        className: 'history', tabIndex: 0, textContent: '⚠ ' + list.length,
        title: [head, ...lines.slice(0, 8), ...(lines.length > 8 ? ['… กดเพื่อดูทั้งหมด'] : [])].join('\n'),
        onclick: open, onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') open(e); }
    });
    node.setAttribute('role', 'button');
    node.setAttribute('aria-label', head);
    return node;
}

// ชื่อ + ป้าย (ถ้ามีประวัติ)
const who = (name) => el('span', { className: 'who' }, name || 'ไม่มีคนขับ', historyBadge(name));

// หัวหน้ารายคัน: วาดป้ายใหม่เมื่อพิมพ์ชื่อเสร็จ
function titleOf(v, withPlate) {
    const node = el('h3', { className: 'title' });
    const paint = () => node.replaceChildren(...[
        v.scc + ' ',
        withPlate && v.plate ? el('span', { className: 'plate', textContent: v.plate }) : null,
        ' ' + (v.driver || ''), historyBadge(v.driver)
    ].filter(Boolean));
    paint();
    return { node, paint };
}

// ไอคอนตาท้ายหัวการ์ด: ซ่อน / เอากลับ (ข้อมูลยังอยู่ครบ)
const EYE = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 12s3.5-6.5 10-6.5S22 12 22 12s-3.5 6.5-10 6.5S2 12 2 12z"/><circle cx="12" cy="12" r="2.5"/>';

function hideToggle(v) {
    const label = (v.hidden ? 'เอารถกลับ ' : 'ซ่อนรถ ') + v.scc;
    const toggle = (e) => {
        // ไอคอนอยู่ในปุ่มของรถ ไม่ให้เปิดหน้ารถตามไปด้วย
        e.preventDefault();
        e.stopPropagation();
        note('แก้ไข', v.hidden ? 'เอารถกลับ' : 'ซ่อนรถ', { scc: v.scc });
        if (v.hidden) { delete v.hidden; v.pinned = true; } else v.hidden = true;
        save();
        render();
    };
    const node = el('span', {
        className: 'hide', tabIndex: 0, title: label, onclick: toggle,
        onkeydown: (e) => { if (e.key === 'Enter' || e.key === ' ') toggle(e); }
    });
    // ตาขีดฆ่า = กดเพื่อซ่อน, ตาเปิด = กดเพื่อเอากลับ
    node.innerHTML = EYE + (v.hidden ? '' : '<path d="M4 4l16 16"/>') + '</svg>';
    node.setAttribute('role', 'button');
    node.setAttribute('aria-label', label);
    return node;
}

// ===== หน้ารวม: รถละกล่อง หัว (รถ/คนขับ) → ปลายทาง → รอบที่ตรวจ =====
function vehicleRow(v) {
    return el('button', { type: 'button', className: 'row' + (v.rounds.length ? '' : ' none'), onclick: () => openVehicle(v.scc) },
        el('span', { className: 'car' },
            el('b', { textContent: v.scc }),
            v.plate ? el('span', { className: 'plate', textContent: v.plate }) : null,
            who(v.driver),
            v.changes?.length ? el('span', { className: 'changed', textContent: 'แผนเปลี่ยน' }) : null,
            el('span', { className: 'tally', textContent: v.rounds.length ? 'ตรวจ ' + v.rounds.length + ' รอบ' : 'ยังไม่ตรวจ' }),
            hideToggle(v)),
        destinations(v),
        v.rounds.length ? el('span', { className: 'logs' }, ...byTime(v.rounds).map(roundLine)) : null);
}

// ===== ฟอร์มรายชั่วโมง (NPM): 1 ช่อง = 1 คัน/พขร./ชั่วโมง =====
const roundAt = (v, hour, who) => v.rounds.find((r) => r.hour === hour && (r.who || 1) === who);
const tone = (r) => (!r ? '' : r.place === 'NG' ? ' no' : r.place === 'OK' ? ' ok' : ' at');

function hourGrid(v, who) {
    const hours = template.shiftHours(report.shift);
    const grid = el('div', { className: 'hours' }, ...hours.map((hour) => {
        const r = roundAt(v, hour, who);
        const node = el('button', { type: 'button', className: 'hour' + tone(r), onclick: () => editHour(v, hour, who) },
            el('small', { textContent: String(hour).padStart(2, '0') }),
            el('b', { textContent: r ? r.place : '–' }),
            el('small', { textContent: r ? shortTime(r) : '' }));
        node.setAttribute('aria-label', v.scc + ' ' + hour + ' นาฬิกา ' + (r ? r.place : 'ยังไม่ตรวจ'));
        if (r?.note) { node.title = r.note; node.classList.add('noted'); }
        return node;
    }));
    grid.style.setProperty('--n', hours.length);
    return grid;
}

const hourGrids = (v) => [hourGrid(v, 1), ...(v.driver2
    ? [el('div', { className: 'mute second' }, 'พขร.2 ' + v.driver2, historyBadge(v.driver2)), hourGrid(v, 2)] : [])];

function hourlyRow(v) {
    return el('div', { className: 'row plain' + (v.rounds.length ? '' : ' none') },
        el('button', { type: 'button', className: 'car', onclick: () => openVehicle(v.scc) },
            el('b', { textContent: v.scc }),
            who(v.driver),
            v.changes?.length ? el('span', { className: 'changed', textContent: 'แผนเปลี่ยน' }) : null,
            el('span', { className: 'tally', textContent: v.rounds.length ? 'ตรวจ ' + v.rounds.length + ' ช่อง' : 'ยังไม่ตรวจ' }),
            hideToggle(v)),
        v.remark ? el('div', { className: 'jobs' }, el('em', { textContent: v.remark })) : null,
        destinations(v),
        ...hourGrids(v));
}

function hourlyPage(v) {
    const page = el('div', { className: 'vehicle' });
    const title = titleOf(v);
    const redraw = () => page.replaceChildren(...[
        button('← กลับหน้ารวม', closeVehicle),
        title.node,
        ...hourGrids(v),
        el('div', { className: 'line' },
            el('label', { className: 'field grow' }, 'พขร.1', input(v, 'driver', 'ชื่อ พขร.1', { onchange: () => title.paint() })),
            el('label', { className: 'field grow' }, 'พขร.2 / คนโหลด', input(v, 'driver2', 'ชื่อ พขร.2 (ถ้ามี)', { onchange: () => redraw() }))),
        el('div', { className: 'line' },
            el('label', {}, 'GPS ', select(v, 'gps', 'สถานะ GPS', [['', '-'], ['ปกติ', 'ปกติ'], ['ไม่ปกติ', 'ไม่ปกติ']])),
            el('label', {}, 'CCTV ', select(v, 'cctv', 'สถานะ CCTV', [['', '-'], ['ปกติ', 'ปกติ'], ['ไม่ปกติ', 'ไม่ปกติ']])),
            input(v, 'remark', 'หมายเหตุแผน', { className: 'grow' })),
        destinations(v, redraw),
        el('h3', { textContent: 'งานตามแผน' }),
        ...v.trips.map((t, i) => el('div', { className: 'line' },
            input(t, 'cust', 'Trips ' + (i + 1), { className: 'grow', onchange: () => redraw() }),
            button('ลบ', () => { noteTripDelete(v, t); v.trips.splice(i, 1); save(); redraw(); }))),
        button('+ เพิ่มงาน', () => { note('นำเข้า', 'เพิ่มงาน', { scc: v.scc }); v.trips.push({ ship: '', custId: '', cust: '' }); save(); redraw(); })
    ]);
    redraw();
    return page;
}

function editHour(v, hour, who) {
    const old = roundAt(v, hour, who);
    $('hour-title').textContent = v.scc + ' · ' + String(hour).padStart(2, '0') + ':00 น.' + (who === 2 ? ' · พขร.2' : '');
    $('hour-time').value = old ? shortTime(old) : new Date().toTimeString().slice(0, 5);
    $('hour-note').value = old?.note || '';
    $('hour-other').value = old && !template.results.some(([code]) => code === old.place) ? old.place : '';
    // หารถใหม่ตอนกด: ระหว่างเปิดหน้าต่างรายงานอาจถูกโหลดใหม่
    const car = () => report.vehicles.find((x) => x.scc === v.scc);
    const done = () => { save(); $('hour-dialog').close(); render(); };
    const set = (place) => {
        // id ตามช่อง: สองเครื่องลงช่องเดียวกันจะเหลืออันที่แก้ล่าสุด
        const entry = {
            id: 'h' + who + '-' + hour, type: 'hour', hour, who, place,
            time: ($('hour-time').value || new Date().toTimeString().slice(0, 5)) + ':00',
            note: $('hour-note').value.trim(), marks: {}
        };
        const target = car();
        note('แก้ไข', old ? 'แก้ช่องรายชั่วโมง' : 'ลงช่องรายชั่วโมง', {
            scc: v.scc, detail: (old ? roundText(old) + ' → ' : '') + roundText(entry) + (who === 2 ? ' · พขร.2' : '')
        });
        const i = target.rounds.findIndex((r) => r.id === entry.id);
        if (i < 0) target.rounds.push(entry); else target.rounds[i] = entry;
        target.gps ||= 'ปกติ';
        target.cctv ||= 'ปกติ';
        done();
    };
    $('hour-results').replaceChildren(...template.results.map(([code, label]) => el('button', {
        type: 'button', className: 'btn result' + (old?.place === code ? ' primary' : ''), onclick: () => set(code)
    }, el('b', { textContent: code }), el('small', { textContent: label === code ? '' : label }))));
    $('hour-other-ok').onclick = () => { const text = $('hour-other').value.trim(); if (text) set(text); };
    $('hour-clear').hidden = !old;
    $('hour-clear').onclick = () => {
        note('ลบ', 'ลบช่องรายชั่วโมง', { scc: v.scc, detail: roundText(old) });
        car().rounds = car().rounds.filter((r) => r.id !== old.id);
        done();
    };
    $('hour-close').onclick = () => $('hour-dialog').close();
    $('hour-dialog').showModal();
}

function hourlySummary() {
    const [y, m, d] = report.date.split('-');
    const working = report.vehicles.filter(hasWork);
    const bad = [];
    const notes = [];
    for (const v of working) {
        for (const r of byTime(v.rounds)) {
            if (r.place !== 'NG' && !r.note) continue;
            (r.place === 'NG' ? bad : notes).push('- ' + v.scc + ' ' + ((r.who === 2 ? v.driver2 : v.driver) || '') +
                ' ' + shortTime(r) + ': ' + (r.note || r.place));
        }
    }
    const unchecked = working.filter((v) => !v.rounds.length).map((v) => v.scc);
    const jobs = working.flatMap((v) => destNames(v).map((name) => ({ scc: v.scc, name, state: destState(v, name).state })));
    const count = (state) => jobs.filter((j) => j.state === state).length;
    const waiting = working.map((v) => [v.scc, jobs.filter((j) => j.scc === v.scc && j.state === 'open').map((j) => j.name)])
        .filter(([, names]) => names.length).map(([scc, names]) => '- ' + scc + ': ' + names.join(', '));
    const section = (title, lines) => (lines.length ? ['', '[' + title + ']', ...lines] : []);
    return [
        'สรุป BBS ' + (unit()?.name || shortName(template.name)),
        d + '/' + m + '/' + (Number(y) + 543) + (report.shift === 'night' ? ' กะกลางคืน' : ' กะกลางวัน') +
            ' (ณ ' + new Date().toTimeString().slice(0, 5) + ' น.)',
        '',
        'ตรวจแล้ว ' + (working.length - unchecked.length) + '/' + working.length + ' คัน',
        ...(jobs.length ? ['ส่งแล้ว ' + count('done') + '/' + (jobs.length - count('cancel')) + ' งาน' +
            (count('cancel') ? ', ยกเลิก ' + count('cancel') : '')] : []),
        ...section('พบผิดปกติ (NG)', bad),
        ...section('ยังไม่ตรวจ', unchecked.length ? ['- ' + unchecked.join(', ')] : []),
        ...section('งานค้างส่ง', waiting),
        ...section('หมายเหตุ', notes)
    ].join('\n');
}

// ===== หน้ารายคัน =====
function vehiclePage(v) {
    const page = el('div', { className: 'vehicle' });
    let infoOpen = !v.driver || v.trips.some((t) => !t.ship && !t.cust);
    const redraw = () => {
        const editing = v.rounds[openRound.get(v.scc)];
        const title = titleOf(v, true);
        const driver = input(v, 'driver', 'ชื่อ พขร.', { className: 'grow', onchange: () => title.paint() });
        const info = el('details', { className: 'info', open: infoOpen },
            el('summary', { textContent: 'ข้อมูลคนขับและงาน (' + v.trips.length + ' งาน)' }),
            el('div', { className: 'line' },
                driver,
                input(v, 'risk', 'กลุ่มเสี่ยง เช่น L ปกติ'),
                el('label', {}, 'GPS ', select(v, 'gps', 'สถานะ GPS', [['', '-'], ['ปกติ', 'ปกติ'], ['ไม่ปกติ', 'ไม่ปกติ']])),
                el('label', {}, 'CCTV ', select(v, 'cctv', 'สถานะ CCTV', [['', '-'], ['ปกติ', 'ปกติ'], ['ไม่ปกติ', 'ไม่ปกติ']]))),
            ...v.trips.map((t, i) => tripView(v, t, i, redraw)),
            button('+ เพิ่มงาน', () => { note('นำเข้า', 'เพิ่มงาน', { scc: v.scc }); v.trips.push({ ship: '', custId: '', cust: '' }); save(); redraw(); }));
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
            title.node,
            destinations(v, redraw),
            button('+ ตรวจรอบใหม่', () => {
                const time = new Date().toTimeString().slice(0, 8);
                v.rounds.push({ time, place: '', type: 'driving', marks: presetMarks('driving'), note: '' });
                note('นำเข้า', 'เพิ่มรอบตรวจ', { scc: v.scc, detail: time });
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
// กดซ่อนเอง (เช่น แผนใส่ข้อความอื่นมาแทนงาน) ไม่นับว่ามีงาน
const hasWork = (v) => !v.hidden && (v.trips.length > 0 || !!v.pinned || v.rounds.some((r) => !r.quiet));

function render() {
    $('checker').value = report.checker || '';
    $('monitor').value = report.monitor || '';
    const open = current && report.vehicles.find((v) => v.scc === current);
    document.body.classList.toggle('detail', !!open);
    $('setup-title').textContent = [
        $('form').selectedOptions[0]?.textContent,
        unit()?.name,
        report.date.split('-').reverse().join('/'),
        report.shift === 'night' ? 'กลางคืน' : 'กลางวัน'
    ].filter(Boolean).join(' · ');
    for (const id of ['reset-button', 'export', 'summary-button', 'alert-button', 'plan-button', 'shot-button', 'search', 'add']) $(id).disabled = !template;
    $('template-name').textContent = template ? template.name : '';
    $('template-name').hidden = !!API_URL || !template;
    $('shot-button').hidden = !!template?.hourly; // ตัวอ่านรูปทำไว้สำหรับฟอร์มรายรอบ
    if (open) { $('list').replaceChildren(template?.hourly ? hourlyPage(open) : vehiclePage(open)); return; }

    const q = $('search').value.trim().toLowerCase();
    // ยังไม่ตรวจอยู่บนสุด ตามด้วยคันที่ตรวจนานแล้ว
    const lastAt = (v) => roundDate(byTime(v.rounds).at(-1))?.getTime() || 0;
    const shown = report.vehicles.filter((v) => (q
        ? [v.scc, v.plate, v.driver].join(' ').toLowerCase().includes(q)
        : $('show-all').checked || hasWork(v)))
        .sort((x, y) => Number(!hasWork(x)) - Number(!hasWork(y)) ||
            (template?.hourly ? x.scc.localeCompare(y.scc) : lastAt(x) - lastAt(y)));
    $('list').replaceChildren(...(shown.length
        ? shown.map(template?.hourly ? hourlyRow : vehicleRow)
        : template ? [el('p', { className: 'empty', textContent: q ? 'ไม่พบรถที่ค้นหา' : 'ยังไม่มีรถที่มีงาน กด “แผนงาน” หรือ “+ รถ”' })] : []));
    const working = report.vehicles.filter(hasWork);
    $('count').textContent = template
        ? 'ยังไม่ตรวจ ' + working.filter((v) => !v.rounds.length).length + ' จาก ' + working.length + ' คัน' : '';
    $('hidden-count').textContent = String(report.vehicles.length - working.length);
}

async function useTemplate(buffer, name) {
    template = { buffer, name, ...((await readHourly(buffer)) || (await readTemplate(buffer))) };
    const units = template.units || [];
    $('unit').replaceChildren(...units.map((u, i) => el('option', { value: String(i), textContent: u.name })));
    $('unit-field').hidden = !units.length;
    const last = units.findIndex((u) => u.title === localStorage.getItem('bbs-unit'));
    if (units.length) $('unit').value = String(Math.max(0, last));
    useUnit();
}

// รายชื่อรถตั้งต้นตามหน่วยงานย่อยที่เลือก
function useUnit() {
    if (unit()) template.vehicles = unit().cars.map((scc) => ({ scc, plate: '', driver: '', risk: '' }));
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
            if (template.hourly) continue; // ฟอร์มรายชั่วโมงใช้ทะเบียนเป็นเลขรถอยู่แล้ว
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
    note('นำเข้า', 'เปิดไฟล์แผนงาน', { detail: [...files].map((f) => f.name).join(', ') });
    const mine = new Map(report.vehicles.map((v) => [vehicleNo(v.scc), v]));
    // รถในแผนที่ยังไม่มีในรายงาน (รถย้ายเข้าใหม่ หรือฟอร์มกลาง) สร้างเพิ่มให้ ทะเบียนค้นจากฟอร์มอื่นใน Drive
    const created = new Set();
    if ([...vehicles.keys()].some((no) => !mine.has(no))) {
        status('กำลังค้นทะเบียนรถจากฟอร์มอื่น…');
        const known = await knownVehicles();
        for (const [no, item] of vehicles) {
            if (mine.has(no)) continue;
            const info = known.get(no) || {};
            const v = emptyVehicle({ scc: sccName(no), plate: item.plate || info.plate || '', driver: '', risk: '' });
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
    status('');
    $('plan-title').textContent = 'แผนงาน ' + when + ': ' + (update
        ? 'เปลี่ยน ' + planPreview.length + ' คัน · เหมือนเดิม ' + unchanged + ' คัน'
        : 'ตรงกับฟอร์มนี้ ' + planPreview.length + ' คัน');
    const added = template.vehicles.length ? planPreview.filter((p) => p.created).length : 0;
    $('plan-list').replaceChildren(...planPreview.map((p) => { const { v, item, fresh, changes } = p; return el('li', {},
        // รถที่ไม่มีในฟอร์มติ๊กออกได้ กันอัปแผนของหน่วยงานอื่นมา
        p.created && template.vehicles.length ? el('input', { type: 'checkbox', checked: true, onchange: (e) => { p.skip = !e.target.checked; } }) : null,
        el('b', { textContent: v.scc }),
        p.created && template.vehicles.length ? el('em', { textContent: ' รถใหม่ ไม่มีในฟอร์ม' }) : null,
        ' ' + (item.driver || v.driver || 'ไม่ระบุคนขับ'),
        historyBadge(item.driver || v.driver),
        fresh
            ? el('div', { className: 'mute', textContent: (update ? 'งานใหม่: ' : '') + destList(item.trips).map((d) => d.name).join(' | ') })
            : el('ul', {}, ...changes.map((c) => el('li', { textContent: describe(c) })))); }));
    $('plan-notes').replaceChildren(...[
        ...notes,
        ...(added ? ['มีรถที่ไม่มีในฟอร์ม ' + added + ' คัน จะเติมต่อท้ายให้ (ติ๊กออกได้ถ้าไม่ใช่รถของหน่วยงานนี้)'] : [])
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
    for (const { v, item, fresh, changes, created, skip } of planPreview) {
        if (skip) continue;
        if (created && !report.vehicles.some((x) => x.scc === v.scc)) report.vehicles.push(v);
        if (item.driver) v.driver = item.driver;
        if (item.risk) v.risk = item.risk;
        else v.risk ||= item.riskIfEmpty;
        if (item.remark !== undefined) v.remark = item.remark;
        if (item.driver2 !== undefined) v.driver2 = item.driver2;
        const jobsChanged = fresh || changes.some((c) => c.type !== 'driver');
        if (item.trips.length && jobsChanged) {
            const ids = new Map(v.trips.map((t) => [t.cust, t.custId]));
            v.trips = item.trips.map((t) => ({ ...t, custId: t.custId || ids.get(t.cust) || '' }));
            delete v.hidden; // งานเปลี่ยน ต้องกลับมาให้เห็น
        }
        if (!fresh) v.changes = mergeChanges(v.changes, changes, v.trips, at);
        if (v.driver) { v.gps ||= 'ปกติ'; v.cctv ||= 'ปกติ'; }
    }
    const applied = planPreview.filter((p) => !p.skip).map((p) => p.v.scc);
    note('นำเข้า', 'เติมแผนงาน', { detail: applied.length + ' คัน: ' + applied.join(', ') });
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
    note('นำเข้า', 'ใส่รูปให้อ่าน', { detail: images.length + ' รูป' });
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
        note('นำเข้า', 'ลงเวลาจากรูป', { scc: item.v.scc, detail: [item.time, item.place.trim(), TYPES[item.type]?.label].filter(Boolean).join(' · ') });
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
    if (template.hourly) return hourlySummary();
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
        note('ดู', 'เปิดหน้าสรุป');
        $('summary-copy').focus();
        $('summary-text').scrollTop = 0;
    });
    for (const [id, label] of [['summary-text', 'ข้อความสรุป'], ['summary-extra', 'ข้อความเพิ่มเติม']]) {
        $(id).addEventListener('change', () => note('แก้ไข', 'แก้' + label, { detail: $(id).value }));
    }
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
        if (draft.text !== undefined) note('ลบ', 'ทิ้งข้อความสรุปที่แก้ไว้', { detail: draft.text });
        delete draft.text;
        delete draft.at;
        keepDraft();
        showSummary();
    });
    $('summary-copy').addEventListener('click', async () => {
        const extra = $('summary-extra').value.trim();
        const text = $('summary-text').value.trimEnd() + (extra ? '\n\n[ข้อความเพิ่มเติม]\n' + extra : '');
        note('ส่งออก', 'คัดลอกสรุป', { detail: text });
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
        note('ดู', 'เปิดหน้าแจ้งเหตุ');
    });
    $('alert-input').addEventListener('input', buildAlert);
    $('alert-type').addEventListener('change', buildAlert);
    for (const [id, label] of [['alert-input', 'เนื้อหาแจ้งเหตุ'], ['alert-output', 'ข้อความตามแพทเทิน']]) {
        $(id).addEventListener('change', () => note('แก้ไข', 'แก้' + label, { detail: $(id).value }));
    }
    $('alert-clear').addEventListener('click', () => {
        if ($('alert-input').value) note('ลบ', 'ล้างข้อความแจ้งเหตุ', { detail: $('alert-input').value });
        $('alert-input').value = '';
        $('alert-type').value = '';
        $('alert-guess').textContent = '';
        buildAlert();
        $('alert-input').focus();
    });
    $('alert-copy').addEventListener('click', async () => {
        note('ส่งออก', 'คัดลอกข้อความแจ้งเหตุ', { detail: $('alert-output').value });
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
    if (template.hourly) return 'รายงานติดตามพฤติกรรมพขร ผ่าน CCTV ' + (unit()?.name || shortName(template.name));
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
    $('unit').addEventListener('change', () => {
        localStorage.setItem('bbs-unit', unit().title);
        useUnit();
        load();
    });
    $('form').addEventListener('change', async () => {
        $('list').replaceChildren();
        $('unit-field').hidden = true;
        for (const id of ['reset-button', 'export', 'summary-button', 'alert-button', 'plan-button', 'shot-button', 'search', 'add']) $(id).disabled = true;
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
        if (document.visibilityState === 'hidden') { if (pending.size) flush(); activity.flush(); }
        else pull();
    });
    for (const [id, label] of [['checker', 'ชื่อผู้ตรวจสอบ'], ['monitor', 'ชื่อ Monitor']]) {
        let before = '';
        $(id).addEventListener('focus', () => { before = $(id).value; });
        $(id).addEventListener('input', () => { report[id] = $(id).value; save(); });
        $(id).addEventListener('change', () => { edited(label, before, $(id).value); before = $(id).value; });
    }
    $('search').addEventListener('change', () => { if ($('search').value.trim()) note('ดู', 'ค้นหา', { detail: $('search').value.trim() }); });
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
            v = emptyVehicle({ scc: no ? sccName(no) : typed, plate: $('add-plate').value.trim(), driver: '', risk: '' });
            report.vehicles.push(v);
        }
        v.pinned = true;
        delete v.hidden;
        note('นำเข้า', 'เพิ่มรถ/งาน', { scc: v.scc });
        if (!v.trips.length) v.trips.push({ ship: '', custId: '', cust: '' });
        $('search').value = '';
        $('add-dialog').close();
        save();
        openVehicle(v.scc);
    });
    $('reset-button').addEventListener('click', resetReport);
    $('export').addEventListener('click', async () => {
        $('export').disabled = true;
        try {
            // มีแผนแล้ว คันที่ไม่มีงานให้เขียนว่าไม่มีวิ่งงาน (ยังไม่อัปแผน = ยังไม่รู้ ไม่เขียน)
            const planned = report.vehicles.some((v) => v.trips.some((t) => t.cust || t.ship));
            const blob = template.hourly ? await buildHourly(template.buffer, report) : await buildReport(template.buffer, {
                ...report,
                vehicles: report.vehicles.map((v) => ({
                    ...v,
                    idle: planned && !hasWork(v) && !(v.hidden && v.rounds.length),
                    extra: [
                        ...(v.changes || []).map((c) => describe(c) + ' (อัปเดต ' + c.at + ' น.)'),
                        ...destNames(v).filter((name) => v.dest?.[name] === 'cancel').map((name) => 'ยกเลิกงาน ' + name)
                    ]
                }))
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
            note('ส่งออก', 'ส่งออกรายงาน Excel', { detail: link.download });
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
    loadHistory(); // ไม่ต้องรอ ประวัติมาช้าไม่ขวางการทำงาน
    setInterval(loadHistory, 60000);
    document.addEventListener('visibilitychange', loadHistory);
    await load();
    activity.flush(); // ของที่ค้างจากครั้งก่อน
});
