import { requireLogin, fetchProtectedText } from './firebase-guard.js?v=20261122-cut';
import { readTemplate, buildReport, colName } from './bbs-xlsx.js?v=1';

// URL /exec ของ Apps Script (apps-script/bbs.gs) — ว่างไว้ = เก็บในเครื่องนี้อย่างเดียว
const API_URL = '';

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

// ===== ข้อมูลรายงานต่อ 1 วัน/กะ =====
const keyOf = () => $('date').value + '_' + $('shift').value;
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
        vehicles: template ? template.vehicles.map(emptyVehicle) : []
    };
}

function status(text, bad = false) {
    $('status').textContent = text;
    $('status').classList.toggle('bad', bad);
}

let saveTimer;
function save() {
    report.updatedAt = Date.now();
    const key = report.date + '_' + report.shift;
    try {
        localStorage.setItem(localKey(key), JSON.stringify(report));
        localStorage.setItem('bbs-names', JSON.stringify({ checker: report.checker, monitor: report.monitor }));
    } catch { status('บันทึกในเครื่องไม่ได้ (พื้นที่เต็มหรือถูกบล็อก)', true); return; }
    if (!API_URL) { status('บันทึกในเครื่องนี้แล้ว (ยังไม่ได้เชื่อม Google Sheet)'); return; }
    status('รอส่งขึ้น Google Sheet…');
    clearTimeout(saveTimer);
    const doc = JSON.stringify(report);
    saveTimer = setTimeout(async () => {
        try {
            await fetchProtectedText(API_URL, { action: 'save', key, doc });
            status('บันทึกลง Google Sheet แล้ว');
        } catch (err) {
            status('ส่งขึ้น Google Sheet ไม่ได้ (เก็บในเครื่องแล้ว): ' + err.message, true);
        }
    }, 2500);
}

async function load() {
    const key = keyOf();
    let local = null;
    try { local = JSON.parse(localStorage.getItem(localKey(key))); } catch { /* เริ่มใหม่ */ }
    report = local || newReport();
    render();
    if (!API_URL) return;
    try {
        status('กำลังโหลดจาก Google Sheet…');
        const res = JSON.parse(await fetchProtectedText(API_URL, { action: 'load', key }));
        const remote = res.doc ? JSON.parse(res.doc) : null;
        if (key !== keyOf()) return;
        if (remote && (remote.updatedAt || 0) > ((local && local.updatedAt) || 0)) {
            report = remote;
            render();
        }
        status('ข้อมูลตรงกับ Google Sheet');
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
    const checks = el('div', { className: 'checks' });
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
            save();
        };
        paint();
        checks.append(chip);
    }

    const type = el('select', {}, ...Object.entries(TYPES).map(([value, t]) => el('option', { value, textContent: t.label })));
    type.value = r.type;
    type.setAttribute('aria-label', 'ประเภทการตรวจ');
    type.onchange = () => { r.type = type.value; r.marks = presetMarks(r.type); save(); redraw(); };

    const bad = Object.values(r.marks).filter((m) => m === 'O').length;
    return el('div', { className: 'round' },
        el('div', { className: 'line' },
            input(r, 'time', 'เวลา', { type: 'time' }),
            input(r, 'place', 'สถานที่', { className: 'grow' }),
            type,
            button('ลบ', () => { v.rounds.splice(i, 1); save(); redraw(); })),
        TYPES[r.type].cols.length
            ? el('details', {}, el('summary', { textContent: 'หัวข้อตรวจ ' + Object.keys(r.marks).length + ' ข้อ' + (bad ? ' · ไม่ผ่าน ' + bad : '') }), checks)
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
                v.rounds.push({ time, place: '', type: 'driving', marks: presetMarks('driving'), note: '' });
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

function bind() {
    $('template').addEventListener('change', async () => {
        const file = $('template').files[0];
        if (!file) return;
        try {
            const buffer = await file.arrayBuffer();
            await useTemplate(buffer, file.name);
            await idb('readwrite', (s) => s.put({ buffer, name: file.name }, 'template'));
            // รถในฟอร์มที่ยังไม่มีในรายงาน → เพิ่มเข้าไป ข้อมูลที่กรอกแล้วคงเดิม
            const have = new Set(report.vehicles.map((v) => v.scc));
            report.vehicles.push(...template.vehicles.filter((v) => !have.has(v.scc)).map(emptyVehicle));
            render();
            save();
        } catch (err) {
            status('เปิดไฟล์ต้นแบบไม่ได้: ' + err.message, true);
        }
        $('template').value = '';
    });
    for (const id of ['date', 'shift']) $(id).addEventListener('change', () => { if ($('date').value) load(); });
    for (const id of ['checker', 'monitor']) $(id).addEventListener('input', () => { report[id] = $(id).value; save(); });
    $('search').addEventListener('input', render);
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
                download: 'รายงานติดตามพฤติกรรมพขร. BBS ' + d + '-' + m + '-' + (Number(y) + 543) +
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
        const saved = await idb('readonly', (s) => s.get('template'));
        if (saved) await useTemplate(saved.buffer, saved.name);
    } catch (err) {
        status('อ่านไฟล์ต้นแบบที่จำไว้ไม่ได้: ' + err.message, true);
    }
    bind();
    await load();
});
