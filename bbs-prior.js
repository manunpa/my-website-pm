// อ่าน "รายงานกะก่อน" ของฟอร์ม RSC (.xlsx หรือ .ods) จากแท็บของวันที่เลือก (อ่านในเบราว์เซอร์ ไม่อัปโหลดไปไหน)
// แท็บ 1 วัน = ชั่วโมง 0-23 ของวันปฏิทินนั้น
import { openBook, els, colOf, rowNum } from './bbs-xlsx.js?v=11';

const ODS_TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const ODS_TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';
const ODS_OFFICE = 'urn:oasis:names:tc:opendocument:xmlns:office:1.0';

const colNum = (s) => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const isDay = (name, day) => /^\s*\d{1,2}\s*$/.test(name) && Number(name) === day;

// คอมเมนต์: ตัดชื่อผู้เขียน และข้อความแจ้งของ threaded comment ออก
const cleanNote = (text) => {
    let s = String(text || '').replace(/\r/g, '');
    if (s.startsWith('[Threaded comment]')) s = s.split(/\n\s*Comment:\s*/).slice(1).join(' ') || '';
    return s.replace(/^[^\n:]{1,30}:\n/, '').replace(/\s+/g, ' ').trim();
};

// ผลลัพธ์ทั้งสองแบบ: { sheet, rows: Map<เลขแถว, Map<เลขคอลัมน์, {text, note}>> }
async function xlsxGrid(buffer, day) {
    const book = await openBook(buffer);
    const workbook = await book.read('xl/workbook.xml');
    const sheet = els(workbook, 'sheet').find((s) => isDay(s.getAttribute('name'), day));
    if (!sheet) return null;
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
            if (text) at(rowNum(row), colNum(colOf(c))).text = text;
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
    return { sheet: sheet.getAttribute('name'), rows };
}

async function odsGrid(buffer, day) {
    const zip = await window.JSZip.loadAsync(buffer);
    const doc = new DOMParser().parseFromString(await zip.file('content.xml').async('string'), 'application/xml');
    const table = Array.from(doc.getElementsByTagNameNS(ODS_TABLE, 'table'))
        .find((t) => isDay(t.getAttributeNS(ODS_TABLE, 'name'), day));
    if (!table) return null;
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
    return { sheet: table.getAttributeNS(ODS_TABLE, 'name'), rows };
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

/** @returns {{sheet:string, cars:object[]}} cars = คันละ 1 ชุดแถวตามลำดับในแท็บ */
export async function readPrior(file, date) {
    const day = Number(date.slice(8));
    const buffer = await file.arrayBuffer();
    const grid = /\.ods$/i.test(file.name) ? await odsGrid(buffer, day) : await xlsxGrid(buffer, day);
    if (!grid) throw new Error('ไฟล์นี้ไม่มีแท็บของวันที่ ' + day);

    const lines = [...grid.rows].sort((a, b) => a[0] - b[0]);
    const columns = (cells, re) => [...cells].find(([, c]) => re.test(c.text))?.[0];
    const header = lines.find(([, cells]) => columns(cells, /^หมายเลขรถ/) && columns(cells, /สถานะ\s*การติดตาม/));
    if (!header) throw new Error('แท็บ ' + grid.sheet + ' ไม่ใช่ฟอร์มบันทึกการตรวจสอบ RSC');
    const find = (re) => columns(header[1], re);
    const cols = {
        car: find(/^หมายเลขรถ/), gps: find(/MDVR/), driver: find(/ชื่อคนขับ/) + 1, route: find(/รูธงาน/),
        jobTime: find(/เวลารับงาน/), label: find(/สถานะ\s*การติดตาม/), abnormal: find(/บันทึกความผิดปกติ/)
    };

    const cars = [];
    let car = null;
    for (const [line, cells] of lines) {
        const text = (col) => cells.get(col)?.text || '';
        const label = text(cols.label);
        if (label === 'Driving Pattern') {
            const no = /SC\s*\d{3}[^\n]*/i.exec(text(cols.car))?.[0].replace(/\s+/g, ' ').trim() || '';
            const flag = (value) => (/^(1|true|ok)$/i.test(value) ? 'ปกติ' : /^(0|false|ng)$/i.test(value) ? 'ไม่ปกติ' : '');
            car = { car: no, gps: flag(text(cols.gps)), cctv: flag(text(cols.gps + 1)), people: [], rounds: [], abnormal: '', pairs: 0 };
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
            if (watch) round.time = clock(cell.text);
            else round.place = cell.text;
            if (cell.note) round.detail = [round.detail, cell.note].filter(Boolean).join(' · ');
        }
    }
    // ชุดที่ว่างทั้งหมด (ไม่มีชื่อและไม่มีการลงเวลา) ไม่ต้องดึง
    return {
        sheet: grid.sheet,
        cars: cars.filter((c) => c.rounds.length || c.abnormal || c.people.some((p) => p.driver || p.route))
    };
}
