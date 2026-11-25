import { requireLogin, fetchProtectedText } from './firebase-guard.js?v=20261122-cut';
import { readTemplate, buildReport } from './bbs-xlsx.js?v=2';
import { readLayout } from './bbs-layout.js?v=2';
import { renderSheet, rowCount, roundAt } from './bbs-sheet.js?v=2';

// URL /exec ของ Apps Script (apps-script/bbs.gs) — ว่างไว้ = เก็บในเบราว์เซอร์นี้อย่างเดียว
const API_URL = '';

// ช่องที่ปุ่ม "ติ๊ก ✓" ใส่ให้
const PRESETS = {
    driving: ['AC', 'AD', 'AE', 'AF', 'AG', 'AH', 'AI', 'AJ', 'AK'],
    unloading: ['R', 'S', 'T', 'U', 'V', 'W', 'X', 'Y', 'Z', 'AA', 'AB'],
    loading: ['K', 'L', 'M', 'N', 'O', 'P', 'Q']
};

const $ = (id) => document.getElementById(id);
let template = null; // { buffer, name, vehicles, checks, customers, layout }
let report = null;
let selected = null; // { scc, row }

// ===== เก็บไฟล์ต้นแบบในเบราว์เซอร์ (IndexedDB) =====
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

// ===== ต้นแบบบน Google Drive (ใช้ร่วมกันทุกเครื่อง) =====
const toBase64 = (buffer) => {
    const bytes = new Uint8Array(buffer);
    let text = '';
    for (let i = 0; i < bytes.length; i += 0x8000) text += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return btoa(text);
};
const fromBase64 = (text) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0)).buffer;

async function useTemplate(saved) {
    const [info, layout] = await Promise.all([readTemplate(saved.buffer), readLayout(saved.buffer)]);
    template = { ...saved, ...info, layout };
}

async function loadTemplate() {
    let saved = null;
    try { saved = await idb('readonly', (s) => s.get('template')); } catch { /* ใช้ของบน Drive */ }
    if (API_URL) {
        try {
            const res = JSON.parse(await fetchProtectedText(API_URL, { action: 'loadTemplate', have: saved?.updatedAt || 0 }));
            if (res.data) {
                saved = { buffer: fromBase64(res.data), name: res.name, updatedAt: res.updatedAt };
                await idb('readwrite', (s) => s.put(saved, 'template'));
            }
        } catch (err) {
            status('โหลดฟอร์มจาก Google Drive ไม่ได้: ' + err.message, true);
        }
    }
    if (saved) await useTemplate(saved);
}

async function storeTemplate(file) {
    const buffer = await file.arrayBuffer();
    const saved = { buffer, name: file.name, updatedAt: Date.now() };
    await useTemplate(saved); // ตรวจว่าเป็นฟอร์ม BBS ก่อนเก็บ
    await idb('readwrite', (s) => s.put(saved, 'template'));
    if (API_URL) {
        await fetchProtectedText(API_URL, { action: 'saveTemplate', name: file.name, updatedAt: saved.updatedAt, data: toBase64(buffer) });
        status('บันทึกฟอร์มไว้บน Google Drive แล้ว ทุกเครื่องใช้ได้เลย');
    } else status('จำฟอร์มไว้ในเบราว์เซอร์นี้แล้ว ครั้งต่อไปไม่ต้องเลือกใหม่');
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

// รถในฟอร์มที่ยังไม่มีในรายงาน → เพิ่มเข้าไป ข้อมูลที่กรอกแล้วคงเดิม
function mergeVehicles() {
    if (!template) return;
    const have = new Set(report.vehicles.map((v) => v.scc));
    report.vehicles.push(...template.vehicles.filter((v) => !have.has(v.scc)).map(emptyVehicle));
}

async function load() {
    const key = keyOf();
    let local = null;
    try { local = JSON.parse(localStorage.getItem(localKey(key))); } catch { /* เริ่มใหม่ */ }
    report = local || {
        date: $('date').value, shift: $('shift').value,
        checker: $('checker').value, monitor: $('monitor').value, vehicles: []
    };
    selected = null;
    mergeVehicles();
    render();
    if (!API_URL) return;
    try {
        status('กำลังโหลดจาก Google Sheet…');
        const res = JSON.parse(await fetchProtectedText(API_URL, { action: 'load', key }));
        const remote = res.doc ? JSON.parse(res.doc) : null;
        if (key !== keyOf()) return;
        if (remote && (remote.updatedAt || 0) > ((local && local.updatedAt) || 0)) {
            report = remote;
            mergeVehicles();
            render();
        }
        status('ข้อมูลตรงกับ Google Sheet');
    } catch (err) {
        status('โหลดจาก Google Sheet ไม่ได้: ' + err.message, true);
    }
}

function render() {
    $('checker').value = report.checker || '';
    $('monitor').value = report.monitor || '';
    $('setup').hidden = !!template;
    $('work').hidden = !template;
    $('change-template').hidden = !template;
    if (!template) return;
    const q = $('search').value.trim().toLowerCase();
    const host = $('sheet');
    const { scrollLeft, scrollTop } = host;
    renderSheet(host, {
        layout: template.layout,
        report,
        vehicles: report.vehicles.filter((v) => !q || [v.scc, v.plate, v.driver].join(' ').toLowerCase().includes(q)),
        showLoading: $('show-loading').checked,
        checks: template.checks,
        customers: template.customers,
        onChange: save,
        onSelect: (v, row) => select(v.scc, row)
    });
    host.scrollLeft = scrollLeft;
    host.scrollTop = scrollTop;
    if (selected) select(selected.scc, selected.row);
}

function select(scc, row) {
    selected = { scc, row };
    for (const tr of $('sheet').querySelectorAll('tr.picked')) tr.classList.remove('picked');
    const tr = [...$('sheet').querySelectorAll('tr[data-row]')].find((x) => x.dataset.row === scc + ':' + row);
    tr?.classList.add('picked');
    $('picked-name').textContent = scc + ' แถว ' + (row + 1);
    for (const b of document.querySelectorAll('[data-needs-row]')) b.disabled = false;
}

const selectedVehicle = () => selected && report.vehicles.find((v) => v.scc === selected.scc);

function applyPreset(name) {
    const v = selectedVehicle();
    if (!v) return;
    const round = roundAt(v, selected.row);
    for (const col of PRESETS[name]) round.marks[col] ||= 'P';
    if (!round.time) round.time = new Date().toTimeString().slice(0, 5);
    if (name === 'loading') $('show-loading').checked = true;
    save();
    render();
}

function bind() {
    $('template').addEventListener('change', async () => {
        const file = $('template').files[0];
        if (!file) return;
        try {
            await storeTemplate(file);
            mergeVehicles();
            render();
            if (report.vehicles.length) save();
        } catch (err) {
            status('บันทึกฟอร์มไม่ได้: ' + err.message, true);
            render();
        }
        $('template').value = '';
    });
    for (const id of ['date', 'shift']) $(id).addEventListener('change', () => { if ($('date').value) load(); });
    for (const id of ['checker', 'monitor']) {
        $(id).addEventListener('input', () => { report[id] = $(id).value; save(); });
        $(id).addEventListener('change', render);
    }
    $('search').addEventListener('input', render);
    $('show-loading').addEventListener('change', render);
    $('zoom').addEventListener('change', () => {
        $('sheet').style.setProperty('--zoom', $('zoom').value);
        try { localStorage.setItem('bbs-zoom', $('zoom').value); } catch { /* ไม่จำก็ได้ */ }
    });
    for (const b of document.querySelectorAll('[data-preset]')) b.addEventListener('click', () => applyPreset(b.dataset.preset));
    $('add-row').addEventListener('click', () => {
        const v = selectedVehicle();
        if (!v) return;
        v.rows = rowCount(template.layout, v) + 1;
        save();
        render();
    });
    $('add').addEventListener('click', () => {
        const scc = (prompt('เบอร์รถ (SCC)') || '').trim();
        if (!scc) return;
        if (report.vehicles.some((v) => v.scc === scc)) { status('มีรถเบอร์นี้อยู่แล้ว', true); return; }
        const plate = (prompt('ทะเบียนรถ') || '').trim();
        report.vehicles.push(emptyVehicle({ scc, plate, driver: '', risk: '' }));
        $('search').value = '';
        save();
        render();
        $('sheet').querySelector(`tr[data-row="${CSS.escape(scc)}:0"]`)?.scrollIntoView({ block: 'center' });
    });
    $('export').addEventListener('click', async () => {
        $('export').disabled = true;
        try {
            const blob = await buildReport(template.buffer, report);
            const [y, m, d] = report.date.split('-');
            const link = document.createElement('a');
            link.href = URL.createObjectURL(blob);
            link.download = 'รายงานติดตามพฤติกรรมพขร. BBS ' + d + '-' + m + '-' + (Number(y) + 543) +
                (report.shift === 'night' ? ' Night' : ' Day') + '.xlsx';
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
        $('zoom').value = localStorage.getItem('bbs-zoom') || '0.7';
    } catch { /* ใช้ค่าตั้งต้น */ }
    $('sheet').style.setProperty('--zoom', $('zoom').value);
    status('กำลังเปิดฟอร์ม…');
    try {
        await loadTemplate();
        status('');
    } catch (err) {
        status('เปิดฟอร์มที่จำไว้ไม่ได้: ' + err.message, true);
    }
    bind();
    await load();
});
