// อ่าน "รายงานกะก่อน" ของฟอร์ม RSC (.xlsx หรือ .ods) จากแท็บของวันที่เลือก (อ่านในเบราว์เซอร์ ไม่อัปโหลดไปไหน)
// แท็บ 1 วัน = ชั่วโมง 0-23 ของวันปฏิทินนั้น ชื่อแท็บ = วันที่ ส่วนเดือน/ปีอยู่ในชื่อไฟล์ ("11 เดือน พฤศจิกายน ... 2569")
import { openBook, els, colOf, rowNum } from './bbs-xlsx.js?v=11';


const ODS_TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const ODS_TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
const ODS_OFFICE = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';

const colNum = (s) => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];
const dayOf = (name) => {
    const day = Number(/^\s*(\d{1,2})\s*\.?\s*$/.exec(name)?.[1]);
    return day >= 1 && day <= 31 ? day : 0;
};

/** วันที่ของแท็บ: แท็บของวันที่เลือก หรือแท็บวันเดียวที่มีในไฟล์ + เดือน/ปีจากชื่อไฟล์ */
function pickTab(names, fileName, date) {
    const tabs = names.filter(dayOf);
    if (!tabs.length) return null;
    const [year, month, day] = date.split('-').map(Number);
    const tab = tabs.find((n) => dayOf(n) === day) || (tabs.length === 1 ? tabs[0] : null);
    if (!tab) throw new Error('ไฟล์นี้ไม่มีแท็บของวันที่ ' + day + ' (มีแท็บ ' + tabs.join(', ') + ') เลือกวันที่บนหน้าให้ตรงก่อน');
    const named = THAI_MONTHS.findIndex((m) => fileName.includes(m)) + 1 ||
        Number(/^\s*(0?[1-9]|1[0-2])[\s_.\-]/.exec(fileName)?.[1]) || month;
    const be = Number(/25[6-9]\d/.exec(fileName)?.[0]);
    const two = (n) => String(n).padStart(2, '0');
    return { name: tab, date: (be ? be - 543 : year) + '-' + two(named) + '-' + two(dayOf(tab)) };
}

// คอมเมนต์: ตัดชื่อผู้เขียน และข้อความแจ้งของ threaded comment ออก
const cleanNote = (text) => {
    let s = String(text || '').replace(/\r/g, '');
    if (s.startsWith('[Threaded comment]')) s = s.split(/\n\s*Comment:\s*/).slice(1).join(' ') || '';
    return s.replace(/^[^\n:]{1,30}:\n/, '').replace(/\s+/g, ' ').trim();
};

// ผลลัพธ์ทั้งสองแบบ: { sheet, rows: Map<เลขแถว, Map<เลขคอลัมน์, {text, note}>> }
async function xlsxGrid(buffer, pick) {
    const book = await openBook(buffer);
    const workbook = await book.read('xl/workbook.xml');
    const sheets = els(workbook, 'sheet');
    const tab = pick(sheets.map((s) => s.getAttribute('name')));
    if (!tab) return null;
    const sheet = sheets.find((s) => s.getAttribute('name') === tab.name);
    const targets = async (path) => Array.from((await book.read(path)).getElementsByTagName('Relationship'));
    const full = (target) => 'xl/' + target.replace(/^(\.\.\/|\/xl\/|xl\/)/, '');
    const link = (await targets('xl/_rels/workbook.xml.rels')).find((l) => l.getAttribute('Id') === sheet.getAttribute('r:id'));
    const path = full(link.getAttribute('Target'));
    const rows = new Map();
    const at = (line, col) => {
        if (!rows.has(line)) rows.set(line, new Map());
        if (!rows.get(line).has(col)) rows.get(line).set(col, { text: '', note: '' });
        return rows.get(line).get(col);
    };
    for (const row of els(await book.read(path), 'row')) {
        for (const c of els(row, 'c')) {
            const text = book.value(c).trim();
            if (!text) continue;
            const cell = at(rowNum(row), colNum(colOf(c)));
            cell.text = text;
            const rgb = book.look(c).fill;
            cell.color = /^[0-9a-f]{6}$/i.test(rgb) ? '#' + rgb.toLowerCase() : '';
        }
    }
    const relsPath = path.replace(/([^/]+)$/, '_rels/$1.rels');
    if (book.zip.file(relsPath)) {
        for (const rel of await targets(relsPath)) {
            if (!/\/comments$/.test(rel.getAttribute('Type'))) continue;
            for (const comment of els(await book.read(full(rel.getAttribute('Target'))), 'comment')) {
                const [, col, line] = /^([A-Z]+)(\d+)$/.exec(comment.getAttribute('ref'));
                at(Number(line), colNum(col)).note = cleanNote(els(comment, 't').map((t) => t.textContent).join(''));
            }
        }
    }
    return { sheet: tab.name, date: tab.date, rows };
}

async function odsGrid(buffer, pick) {
    const zip = await window.JSZip.loadAsync(buffer);
    const doc = new DOMParser().parseFromString(await zip.file('content.xml').async('string'), 'application/xml');
    const tables = Array.from(doc.getElementsByTagNameNS(ODS_TABLE, 'table'));
    const tab = pick(tables.map((t) => t.getAttributeNS(ODS_TABLE, 'name')));
    if (!tab) return null;
    const table = tables.find((t) => t.getAttributeNS(ODS_TABLE, 'name') === tab.name);
    const repeat = (node, name) => Number(node.getAttributeNS(ODS_TABLE, name) || 1);
    const paragraphs = (node) => Array.from(node.children)
        .filter((c) => c.namespaceURI === ODS_TEXT && c.localName === 'p').map((c) => c.textContent).join('\n').trim();
    const rows = new Map();
    let line = 1;
    for (const row of Array.from(table.getElementsByTagNameNS(ODS_TABLE, 'table-row'))) {
        const cells = new Map();
        let col = 1;
        for (const cell of Array.from(row.children)) {
            const times = repeat(cell, 'number-columns-repeated');
            const note = Array.from(cell.children).find((c) => c.namespaceURI === ODS_OFFICE && c.localName === 'annotation');
            // ตัวเลขอ่านค่าจริง ไม่ใช่รูปแบบที่แสดง (เช่น 8.26 อาจแสดงเป็น 8.3)
            const number = cell.getAttributeNS(ODS_OFFICE, 'value-type') === 'float' ? cell.getAttributeNS(ODS_OFFICE, 'value') : '';
            const value = { text: number || paragraphs(cell), note: note ? cleanNote(paragraphs(note)) : '' };
            if (value.text || value.note) for (let i = 0; i < times; i++) cells.set(col + i, value);
            col += times;
        }
        const times = repeat(row, 'number-rows-repeated');
        if (cells.size) for (let i = 0; i < times; i++) rows.set(line + i, cells);
        line += times;
    }
    return { sheet: tab.name, date: tab.date, rows };
}

// "8.26" / 9.1 (= 09:10) / 0.3333 (เวลาของ Excel) → "HH:MM"
function clock(text) {
    const s = String(text || '').trim();
    const n = Number(s);
    const two = (x) => String(x).padStart(2, '0');
    if (s && n > 0 && n < 1 && !/^0\.[0-5]\d$/.test(s)) {
        const minutes = Math.round(n * 1440);
        return two(Math.floor(minutes / 60)) + ':' + two(minutes % 60);
    }
    const m = /^(\d{1,2})[.:](\d{2})/.exec(s && !Number.isNaN(n) ? n.toFixed(2) : s);
    return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? two(m[1]) + ':' + m[2] : '';
}

// แถว "เวลาที่ดู" พิมพ์เป็นตัวเลข ชม.นาที เสมอ (0.1 = 00:10) ยกเว้นทศนิยมยาวที่เป็นเวลาของ Excel
function watchTime(text) {
    const n = Number(text);
    return n > 0 && n < 1 && Math.abs(n * 100 - Math.round(n * 100)) < 1e-6 ? clock(n.toFixed(2).replace('.', ':')) : clock(text);
}

/** @returns {{sheet:string, date:string, cars:object[]}} cars = คันละ 1 ชุดแถวตามลำดับในแท็บ */
export async function readPrior(file, date) {
    const buffer = await file.arrayBuffer();
    const pick = (names) => pickTab(names, file.name, date);
    const grid = /\.ods$/i.test(file.name) ? await odsGrid(buffer, pick) : await xlsxGrid(buffer, pick);
    if (!grid) throw new Error('ไฟล์นี้ไม่มีแท็บที่ตั้งชื่อเป็นวันที่');

    const lines = [...grid.rows].sort((a, b) => a[0] - b[0]);
    const columns = (cells, re) => [...cells].find(([, c]) => re.test(c.text))?.[0];
    const header = lines.find(([, cells]) => columns(cells, /^หมายเลขรถ/) && columns(cells, /สถานะ\s*การติดตาม/));
    if (!header) throw new Error('แท็บ ' + grid.sheet + ' ไม่ใช่ฟอร์มบันทึกการตรวจสอบ RSC');
    const find = (re) => columns(header[1], re);
    const cols = {
        car: find(/^หมายเลขรถ/), gps: find(/MDVR/), driver: find(/ชื่อคนขับ/) + 1, route: find(/รูธงาน/),
        jobTime: find(/เวลารับงาน|เวลาออก/), label: find(/สถานะ\s*การติดตาม/), abnormal: find(/บันทึกความผิดปกติ|หมายเหตุ\s*OK/)
    };
    // ADAS-DMS อยู่ในหัวแถวที่สอง (มีเฉพาะฟอร์ม TOYOTA)
    const adas = columns(grid.rows.get(header[0] + 1) || new Map(), /^ADAS/);

    const cars = [];
    let car = null;
    for (const [line, cells] of lines) {
        const text = (col) => cells.get(col)?.text || '';
        const label = text(cols.label);
        if (label === 'Driving Pattern') {
            const no = /SC\s*\d{3}[^\n]*/i.exec(text(cols.car))?.[0].replace(/\s+/g, ' ').trim() || '';
            const flag = (value) => (/^(1|true|ok)$/i.test(value) ? 'ปกติ' : /^(0|false|ng)$/i.test(value) ? 'ไม่ปกติ' : '');
            car = { car: no, gps: flag(text(cols.gps)), cctv: flag(text(cols.gps + 1)), adas: adas ? flag(text(adas)) : '', people: [], rounds: [], abnormal: '', pairs: 0 };
            if (no) cars.push(car);
        }
        if (!car) continue;
        const abnormal = text(cols.abnormal);
        if (abnormal && !car.abnormal.includes(abnormal)) car.abnormal = [car.abnormal, abnormal].filter(Boolean).join(' / ');
        const watch = label === 'เวลาที่ดู';
        if (!watch && label !== 'ผลการตรวจสอบ') continue;
        if (watch) {
            car.pairs++;
            car.people.push({ driver: text(cols.driver), route: text(cols.route), jobTime: clock(text(cols.jobTime)) || text(cols.jobTime) });
        }
        if (!car.pairs) continue;
        for (let hour = 0; hour < 24; hour++) {
            const cell = cells.get(cols.label + 1 + hour);
            if (!cell || !(cell.text || cell.note)) continue;
            let round = car.rounds.find((r) => r.who === car.pairs && r.hour === hour);
            if (!round) car.rounds.push(round = { who: car.pairs, hour, time: '', place: '', detail: '' });
            if (watch) round.time = watchTime(cell.text);
            else {
                round.place = cell.text;
                round.fill = cell.color || '';
            }
            if (cell.note) round.detail = [round.detail, cell.note].filter(Boolean).join(' · ');
        }
    }
    // ชุดที่ว่างทั้งหมด (ไม่มีชื่อและไม่มีการลงเวลา) ไม่ต้องดึง
    return {
        sheet: grid.sheet,
        date: grid.date,
        cars: cars.filter((c) => c.rounds.length || c.abnormal || c.people.some((p) => p.driver || p.route))
    };
}
