import { requireLogin, fetchProtectedText } from './firebase-guard.js?v=20261122-cut';
import { readTemplate, buildReport, colName } from './bbs-xlsx.js?v=3';
import { readPlans, vehicleNo } from './bbs-plan.js?v=1';

// URL /exec ของ Apps Script (apps-script/bbs.gs) — ว่างไว้ = เก็บในเครื่องนี้อย่างเดียว
const API_URL = 'https://script.google.com/macros/s/AKfycbxGlbuYTL5_K8DZ7EIPT9P0NO5gef1od1f4WXzRvBPLbCvAPwST87Tl3hqtjMljY3Yx8w/exec';

const $ = (id) => document.getElementById(id);
const range = (a, b) => {
    const num = (s) => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
    return Array.from({ length: num(b) - num(a) + 1 }, (_, i) => colName(num(a) + i));
};
const TYPES = {
    driving: { label: 'ขับรถ', cols: range('AC', 'AO'), preset: range('AC', 'AK') },
    loading: { label: 'รับน้ำมัน', cols: range('K', 'Q'), preset: range('K', 'Q') },
    unloading: { label: 'ลงน้ำมัน', cols: range('R', 'AB'), preset: range('R', 'AB') },
    none: { label: 'ลงเวลาอย่างเดียว', cols: [], preset: [] }
};

let template = null; // { buffer, name, vehicles, checks, customers }
let report = null;

// ===== เก็บไฟล์ต้นแบบในเครื่อง (IndexedDB) — ไม่อัปโหลดไปไหน =====
function idb(mode, run) {
    return new Promise((resolve, reject) => {
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
        status('กำลังโหลดฟอร์มจาก Google Drive…');
        const res = await call({ action: 'form', id });
        saved = { buffer: fromBase64(res.data), name: res.name, updated: res.updated };
        await idb('readwrite', (s) => s.put(saved, 'form:' + id)).catch(() => {});
    }
    await useTemplate(saved.buffer, saved.name);
}

async function loadForms() {
    try {
        forms = (await call({ action: 'forms' })).forms;
        localStorage.setItem('bbs-forms', JSON.stringify(forms));
    } catch (err) {
        status('โหลดรายชื่อฟอร์มจาก Google Drive ไม่ได้: ' + err.message, true);
        try { forms = JSON.parse(localStorage.getItem('bbs-forms')) || []; } catch { forms = []; }
    }
    $('form').replaceChildren(...forms.map((f) => el('option', { value: f.id, textContent: f.name.replace(/\.xlsx$/i, '') })));
    $('form').hidden = false;
    $('pick-file').hidden = true;
    if (!forms.length) throw new Error('ไม่พบไฟล์ฟอร์ม .xlsx ในโฟลเดอร์ Drive');
    const last = localStorage.getItem('bbs-form');
    if (forms.some((f) => f.id === last)) $('form').value = last;
    await openForm($('form').value);
}

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

function status(text, bad = false) {
    $('status').textContent = text;
    $('status').classList.toggle('bad', bad);
}

// ส่งขึ้นชีตเป็นรอบ: หลังหยุดกรอก 15 วินาที หรืออย่างช้าทุก 60 วินาที และตอนสลับ/ปิดหน้า
const IDLE_MS = 15000;
const MAX_WAIT_MS = 60000;
const pending = new Map(); // key -> ข้อมูลที่รอส่ง
let idleTimer;
let maxTimer = null;

async function flush() {
    clearTimeout(idleTimer);
    clearTimeout(maxTimer);
    maxTimer = null;
    for (const [key, doc] of [...pending]) {
        pending.delete(key);
        try {
            await call({ action: 'save', key, doc });
            status(pending.size ? 'รอส่งขึ้น Google Sheet…' : 'บันทึกลง Google Sheet แล้ว');
        } catch (err) {
            if (!pending.has(key)) pending.set(key, doc);
            status('ส่งขึ้น Google Sheet ไม่ได้ (เก็บในเครื่องแล้ว จะลองใหม่): ' + err.message, true);
            maxTimer ||= setTimeout(flush, MAX_WAIT_MS);
        }
    }
}

function queue(key, doc) {
    pending.set(key, doc);
    status('บันทึกในเครื่องแล้ว รอส่งขึ้น Google Sheet…');
    clearTimeout(idleTimer);
    idleTimer = setTimeout(flush, IDLE_MS);
    maxTimer ||= setTimeout(flush, MAX_WAIT_MS);
}

function save() {
    report.updatedAt = Date.now();
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
    const key = keyOf();
    let local = null;
    try { local = JSON.parse(localStorage.getItem(localKey(key))); } catch { /* เริ่มใหม่ */ }
    report = local || newReport();
    mergeVehicles();
    render();
    if (!API_URL || !template) return;
    try {
        status('กำลังโหลดจาก Google Sheet…');
        const res = await call({ action: 'load', key });
        const remote = res.doc ? JSON.parse(res.doc) : null;
        if (key !== keyOf()) return;
        if (remote && (remote.updatedAt || 0) > ((local && local.updatedAt) || 0)) {
            report = remote;
            mergeVehicles();
            render();
        }
        // กรอกค้างไว้แล้วยังไม่ได้ส่ง (ปิดหน้าไปก่อน) → ส่งตอนนี้
        if (local && (local.updatedAt || 0) > ((remote && remote.updatedAt) || 0)) queue(key, JSON.stringify(local));
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
    type.onchange = () => { r.type = type.value; r.marks = {}; save(); redraw(); };

    tally();
    // ปุ่มลัด: ติ๊กเฉพาะช่องที่ยังว่าง (ข้อที่เป็น ✗ คงไว้) หรือล้างทั้งหมด
    const quick = el('div', { className: 'line' },
        button('✓ ติ๊กทั้งหมด', () => { for (const col of TYPES[r.type].preset) r.marks[col] ||= 'P'; save(); redraw(); }),
        button('ล้าง', () => { r.marks = {}; save(); redraw(); }));
    return el('div', { className: 'round' },
        el('div', { className: 'line' },
            input(r, 'time', 'เวลา', { type: 'time' }),
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

const openCards = new Set();

function vehicleCard(v) {
    const card = el('details', { className: 'card', open: openCards.has(v.scc) });
    card.addEventListener('toggle', () => { card.open ? openCards.add(v.scc) : openCards.delete(v.scc); });
    const summary = el('summary');
    const body = el('div', { className: 'body' });
    const head = () => {
        const bad = v.rounds.some((r) => Object.values(r.marks).includes('O'));
        summary.replaceChildren(
            el('b', { textContent: v.scc }),
            el('span', { textContent: v.driver || 'ไม่มีคนขับ' }),
            el('em', { className: bad ? 'bad' : '', textContent: v.rounds.length ? 'ตรวจ ' + v.rounds.length + ' รอบ' + (bad ? ' · พบ ✗' : '') : 'ยังไม่ตรวจ' }));
    };
    const redraw = () => {
        head();
        const driver = input(v, 'driver', 'ชื่อ พขร.', { className: 'grow' });
        driver.addEventListener('input', head);
        body.replaceChildren(
            el('div', { className: 'line' },
                driver,
                input(v, 'risk', 'กลุ่มเสี่ยง เช่น L ปกติ'),
                el('label', {}, 'GPS ', select(v, 'gps', 'สถานะ GPS', [['', '-'], ['ปกติ', 'ปกติ'], ['ไม่ปกติ', 'ไม่ปกติ']])),
                el('label', {}, 'CCTV ', select(v, 'cctv', 'สถานะ CCTV', [['', '-'], ['ปกติ', 'ปกติ'], ['ไม่ปกติ', 'ไม่ปกติ']]))),
            el('h3', { textContent: 'งานขนส่ง' }),
            ...v.trips.map((t, i) => tripView(v, t, i, redraw)),
            button('+ เพิ่มงาน', () => { v.trips.push({ ship: '', custId: '', cust: '' }); save(); redraw(); }),
            el('h3', { textContent: 'รอบตรวจ' }),
            ...v.rounds.map((r, i) => roundView(v, r, i, redraw)),
            button('+ เพิ่มรอบตรวจ (เวลาตอนนี้)', () => {
                const time = new Date().toTimeString().slice(0, 5);
                v.rounds.push({ time, place: '', type: 'driving', marks: {}, note: '' });
                save();
                redraw();
            }, 'btn primary'));
    };
    redraw();
    card.append(summary, body);
    return card;
}

function render() {
    $('checker').value = report.checker || '';
    $('monitor').value = report.monitor || '';
    const q = $('search').value.trim().toLowerCase();
    $('list').replaceChildren(...report.vehicles
        .filter((v) => !q || [v.scc, v.plate, v.driver].join(' ').toLowerCase().includes(q))
        .map(vehicleCard));
    $('tools').hidden = !template;
    $('export').disabled = !template;
    $('template-name').textContent = template ? template.name : 'ยังไม่ได้เลือกไฟล์ต้นแบบ';
}

async function useTemplate(buffer, name) {
    template = { buffer, name, ...(await readTemplate(buffer)) };
}

// ===== อัปโหลดแผนงาน: ดึงเฉพาะวันที่ + กะ ที่เลือกอยู่ ให้ตรวจสรุปก่อนเติม =====
let planPreview = []; // [{ v, item }]

async function importPlans(files) {
    const { date, shift } = report;
    const when = date.split('-').reverse().join('/') + (shift === 'night' ? ' กะกลางคืน' : ' กะกลางวัน');
    status('กำลังอ่านแผนงาน…');
    const { vehicles, notes } = await readPlans(files, date, shift);
    const mine = new Map(report.vehicles.map((v) => [vehicleNo(v.scc), v]));
    planPreview = [...vehicles].filter(([no]) => mine.has(no)).map(([no, item]) => ({ v: mine.get(no), item }));
    const missing = [...vehicles.keys()].filter((no) => !mine.has(no));
    status('');
    $('plan-title').textContent = 'แผนงาน ' + when + ': ตรงกับฟอร์มนี้ ' + planPreview.length + ' คัน';
    $('plan-list').replaceChildren(...planPreview.map(({ v, item }) => el('li', {},
        el('b', { textContent: v.scc }),
        ' ' + (item.driver || 'ไม่ระบุคนขับ') + ' · ' + item.trips.length + ' งาน',
        v.trips.length && item.trips.length ? el('em', { textContent: ' (แทนงานเดิม ' + v.trips.length + ')' }) : null,
        el('div', { className: 'mute', textContent: item.trips.map((t) => [t.ship, t.cust].filter(Boolean).join(' ')).join(' | ') }))));
    $('plan-notes').replaceChildren(...[
        ...notes,
        ...(missing.length ? ['รถในแผนที่ไม่มีในฟอร์มนี้ (ไม่เติม): ' + missing.join(', ')] : [])
    ].map((text) => el('li', { textContent: text })));
    $('plan-ok').disabled = !planPreview.length;
    $('plan-dialog').dataset.key = report.key || keyOf();
    $('plan-dialog').showModal();
    $('plan-dialog').scrollTop = 0; // เริ่มอ่านจากหัวสรุป
}

function applyPlans() {
    // เปลี่ยนวันที่/ฟอร์มระหว่างเปิดสรุป → ไม่เติมผิดรายงาน
    if ($('plan-dialog').dataset.key !== (report.key || keyOf())) return;
    for (const { v, item } of planPreview) {
        if (item.driver) v.driver = item.driver;
        if (item.risk) v.risk = item.risk;
        else v.risk ||= item.riskIfEmpty;
        if (item.trips.length) v.trips = item.trips.map((t) => ({ ...t }));
        if (v.driver) { v.gps ||= 'ปกติ'; v.cctv ||= 'ปกติ'; }
    }
    save();
    render();
}

// ชื่อไฟล์ส่งออกตามชื่อฟอร์ม โดยตัดคำว่า "วันที่/เดือน..." ท้ายชื่อออก
function baseName() {
    const name = API_URL ? template.name.replace(/\.xlsx$/i, '').split('วันที่')[0].trim() : '';
    return name || 'รายงานติดตามพฤติกรรมพขร. BBS';
}

function bind() {
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
        $('export').disabled = true;
        try {
            await openForm($('form').value);
            localStorage.setItem('bbs-form', $('form').value);
            status('');
        } catch (err) {
            status('เปิดฟอร์มไม่ได้: ' + err.message, true);
        }
        await load();
    });
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden' && pending.size) flush(); });
    for (const id of ['checker', 'monitor']) $(id).addEventListener('input', () => { report[id] = $(id).value; save(); });
    $('search').addEventListener('input', render);
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
        const scc = (prompt('เบอร์รถ (SCC)') || '').trim();
        if (!scc) return;
        if (report.vehicles.some((v) => v.scc === scc)) { status('มีรถเบอร์นี้อยู่แล้ว', true); return; }
        const plate = (prompt('ทะเบียนรถ') || '').trim();
        report.vehicles.push(emptyVehicle({ scc, plate, driver: '', risk: '' }));
        openCards.add(scc);
        $('search').value = '';
        save();
        render();
    });
    $('export').addEventListener('click', async () => {
        $('export').disabled = true;
        try {
            const blob = await buildReport(template.buffer, report);
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
    try {
        if (API_URL) await loadForms();
        else {
            const saved = await idb('readonly', (s) => s.get('template'));
            if (saved) await useTemplate(saved.buffer, saved.name);
        }
    } catch (err) {
        status('เปิดฟอร์มไม่ได้: ' + err.message, true);
    }
    bind();
    await load();
});
