// ฟอร์ม BBS แบบตารางรายชั่วโมง (NPM): ชีตละ 1 วัน ชื่อชีตเป็นเลขวันที่
// A=ทะเบียน B=GPS C=CCTV D=พขร. E-I=Trips 1-5 J=ป้ายแถว K-AH=ชั่วโมง 0-23 AI=เวลาที่ออก
// รถ 1 คัน = แถวคู่ "เวลาที่ดู / ผลการตรวจสอบ" 2 คู่ (พขร.1, พขร.2) คั่นด้วยแถวสี
import { openBook, els, colOf, rowNum, colName } from './bbs-xlsx.js?v=10';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const PLATE = /^\d{2}-\d{4}$/;

export const shiftHours = (shift) => Array.from({ length: 12 }, (_, i) => ((shift === 'night' ? 20 : 8) + i) % 24);

export const RESULTS = [
    ['OK', 'ขับขี่ปกติ'], ['NG', 'ผิดปกติ / เสี่ยง / ละเมิดกฎ'], ['C', 'ลูกค้า'], ['P', 'จุดพัก / จอดพัก'],
    ['BRP', 'BRP'], ['SCSC', 'SCSC'], ['M', 'ซ่อมบำรุง']
];

const cellAt = (row, col) => els(row, 'c').find((c) => colOf(c) === col);
const colNum = (s) => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);

async function daySheets(book) {
    const wb = await book.read('xl/workbook.xml');
    return els(wb, 'sheet').filter((s) => /^\d{1,2}$/.test(s.getAttribute('name').trim()))
        .map((s) => s.getAttribute('name'));
}

// แถวของรถแต่ละคัน: เริ่มที่แถวมีทะเบียนใน A ต่อไปจนกว่าป้ายใน J จะไม่ใช่แถวตรวจ
function findBlocks(book, doc) {
    const text = (row, col) => book.value(cellAt(row, col)).trim();
    const rows = els(doc, 'row');
    const blocks = [];
    for (let i = 0; i < rows.length; i++) {
        const plate = text(rows[i], 'A');
        if (!PLATE.test(plate) || text(rows[i], 'J') !== 'เวลาที่ดู') continue;
        const block = [rows[i]];
        while (block.length < 4) {
            const next = rows[i + block.length];
            if (!next || text(next, 'A') || !/^(เวลาที่ดู|ผลการตรวจสอบ)$/.test(text(next, 'J'))) break;
            block.push(next);
        }
        blocks.push({ plate, rows: block });
    }
    return blocks;
}

// ชีตวันล่าสุดที่เป็นฟอร์มแบบเต็ม (4 แถวต่อคัน) ใช้เป็นต้นแบบ
async function pickSheet(book) {
    let fallback = null;
    for (const name of (await daySheets(book)).reverse()) {
        const path = book.sheetPath(name);
        const doc = await book.read(path);
        const blocks = findBlocks(book, doc);
        if (!blocks.length) continue;
        const found = { name, path, doc, blocks };
        if (blocks.some((b) => b.rows.length === 4)) return found;
        fallback ||= found;
    }
    return fallback;
}

/** คืน null ถ้าไฟล์ไม่ใช่ฟอร์มแบบรายชั่วโมง */
export async function readHourly(buffer) {
    const book = await openBook(buffer);
    const sheet = await pickSheet(book);
    if (!sheet) return null;
    return {
        hourly: true,
        vehicles: sheet.blocks.map((b) => ({ scc: b.plate, plate: '', driver: '', risk: '' })),
        checks: {},
        customers: {}
    };
}

function setCell(doc, row, col, val) {
    let cell = cellAt(row, col);
    if (!cell) {
        if (val === '') return;
        cell = doc.createElementNS(NS, 'c');
        cell.setAttribute('r', col + rowNum(row));
        row.insertBefore(cell, els(row, 'c').find((c) => colNum(colOf(c)) > colNum(col)) || null);
    }
    while (cell.firstChild) cell.removeChild(cell.firstChild);
    cell.removeAttribute('t');
    if (val === '' || val === undefined || val === null) return;
    if (typeof val === 'number') {
        const v = doc.createElementNS(NS, 'v');
        v.textContent = String(val);
        cell.appendChild(v);
        return;
    }
    cell.setAttribute('t', 'inlineStr');
    const is = doc.createElementNS(NS, 'is');
    const t = doc.createElementNS(NS, 't');
    t.setAttribute('xml:space', 'preserve');
    t.textContent = String(val);
    is.appendChild(t);
    cell.appendChild(is);
}

// รถที่ไม่มีในฟอร์ม: ตัดแถวท้ายตารางทิ้ง แล้วคัดลอกชุดแถว + แถวคั่น + การผสานช่องของคันสุดท้าย
function appendBlocks(doc, blocks, plates) {
    const last = blocks[blocks.length - 1];
    const lastRow = last.rows[last.rows.length - 1];
    const separator = lastRow.nextElementSibling;
    const source = [...last.rows, ...(separator ? [separator] : [])].map((r) => r.cloneNode(true));
    const first = rowNum(last.rows[0]);
    const end = first + source.length - 1;
    while (separator?.nextSibling) separator.parentNode.removeChild(separator.nextSibling);

    const merges = els(doc, 'mergeCells')[0];
    const parse = (ref) => /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(ref);
    const own = [];
    for (const m of merges ? els(merges, 'mergeCell') : []) {
        const p = parse(m.getAttribute('ref'));
        if (!p) continue;
        if (Number(p[2]) > end) merges.removeChild(m);
        else if (Number(p[2]) >= first) own.push(p);
    }

    let at = end + 1;
    for (const plate of plates) {
        const rows = source.map((original, i) => {
            const row = original.cloneNode(true);
            row.setAttribute('r', String(at + i));
            for (const c of els(row, 'c')) c.setAttribute('r', colOf(c) + (at + i));
            lastRow.parentNode.appendChild(row);
            return row;
        });
        for (const p of own) {
            const m = doc.createElementNS(NS, 'mergeCell');
            m.setAttribute('ref', p[1] + (Number(p[2]) - first + at) + ':' + p[3] + (Number(p[4]) - first + at));
            merges.appendChild(m);
        }
        setCell(doc, rows[0], 'A', plate);
        blocks.push({ plate, rows: rows.slice(0, last.rows.length) });
        at += source.length;
    }
    merges?.setAttribute('count', String(merges.children.length));
    els(doc, 'dimension')[0]?.setAttribute('ref', 'A1:AK' + (at - 1));
}

const watched = (time) => (time ? Number(time.slice(0, 2)) + '.' + time.slice(3, 5) : '');

function fill(book, doc, blocks, report) {
    const data = new Map(report.vehicles.map((v) => [v.scc, v]));
    const have = new Set(blocks.map((b) => b.plate));
    const extra = report.vehicles.filter((v) => !have.has(v.scc) && (v.driver || v.trips.length || v.rounds.length));
    if (extra.length) appendBlocks(doc, blocks, extra.map((v) => v.scc));

    for (const { plate, rows } of blocks) {
        const v = data.get(plate) || { trips: [], rounds: [] };
        for (const row of rows) {
            for (let n = colNum('D'); n <= colNum('AI'); n++) if (n !== colNum('J')) setCell(doc, row, colName(n), '');
        }
        const mark = (s) => (s === 'ปกติ' ? 'OK' : s === 'ไม่ปกติ' ? 'NG' : '');
        setCell(doc, rows[0], 'B', mark(v.gps));
        setCell(doc, rows[0], 'C', mark(v.cctv));
        setCell(doc, rows[0], 'D', v.driver || '');
        if (rows[2]) setCell(doc, rows[2], 'D', v.driver2 || '');
        const trips = v.trips.map((t) => t.cust || t.ship).filter(Boolean);
        // ฟอร์มมี 5 ช่อง เที่ยวที่เกินรวมไว้ช่องสุดท้าย
        if (trips.length > 5) trips.splice(4, trips.length - 4, trips.slice(4).join(' / '));
        trips.forEach((name, i) => setCell(doc, rows[0], colName(colNum('E') + i), name));
        const notes = [];
        for (const r of v.rounds) {
            const top = rows[(r.who === 2 ? 2 : 0)];
            const bottom = rows[(r.who === 2 ? 3 : 1)];
            if (!bottom || !Number.isInteger(r.hour)) continue;
            const col = colName(colNum('K') + r.hour);
            setCell(doc, top, col, watched(r.time));
            setCell(doc, bottom, col, r.place || '');
            if (r.note) notes.push(r.hour + ' น. ' + r.note);
        }
        if (notes.length) setCell(doc, rows[0], 'AJ', notes.join(' / '));
        else setCell(doc, rows[0], 'AJ', '');
    }

    const row = (n) => els(doc, 'row').find((r) => rowNum(r) === n);
    const [y, m, d] = report.date.split('-').map(Number);
    setCell(doc, row(2), 'D', report.shift === 'night' ? 'กะกลางคืน 20.00 น. - 08.00 น.' : 'กะกลางวัน 08.00 น. - 20.00 น.');
    setCell(doc, row(3), 'D', (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
    setCell(doc, row(4), 'D', report.monitor || report.checker || '');
}

// เหลือชีตเดียว (วันของรายงาน) ลบชีตอื่นออกจากไฟล์
async function keepOnly(book, keepName, newName) {
    const wb = await book.read('xl/workbook.xml');
    const rels = await book.read('xl/_rels/workbook.xml.rels');
    let types = await book.zip.file('[Content_Types].xml').async('string');
    const links = Array.from(rels.getElementsByTagName('Relationship'));
    for (const sheet of els(wb, 'sheet')) {
        if (sheet.getAttribute('name') === keepName) {
            sheet.setAttribute('name', newName);
            sheet.removeAttribute('state');
            continue;
        }
        const id = sheet.getAttribute('r:id');
        const link = links.find((l) => l.getAttribute('Id') === id);
        const path = 'xl/' + link.getAttribute('Target').replace(/^\/?(xl\/)?/, '');
        book.zip.remove(path);
        book.zip.remove(path.replace(/([^/]+)$/, '_rels/$1.rels'));
        types = types.replace(new RegExp('<Override[^>]*PartName="/' + path + '"[^>]*/>'), '');
        link.parentNode.removeChild(link);
        sheet.parentNode.removeChild(sheet);
    }
    for (const names of els(wb, 'definedNames')) names.parentNode.removeChild(names);
    for (const view of els(wb, 'workbookView')) {
        view.setAttribute('firstSheet', '0');
        view.setAttribute('activeTab', '0');
    }
    // ลำดับคำนวณเดิมอ้างชีตที่ลบไปแล้ว
    book.zip.remove('xl/calcChain.xml');
    types = types.replace(/<Override\b[^>]*calcChain[^>]*\/>/g, '');
    for (const link of links) if (/calcChain/.test(link.getAttribute('Target'))) link.parentNode?.removeChild(link);
    book.zip.file('[Content_Types].xml', types);
    const xml = (doc) => new XMLSerializer().serializeToString(doc);
    book.zip.file('xl/workbook.xml', xml(wb));
    book.zip.file('xl/_rels/workbook.xml.rels', xml(rels));
}

export async function buildHourly(buffer, report) {
    const book = await openBook(buffer);
    const sheet = await pickSheet(book);
    if (!sheet) throw new Error('ไม่พบชีตรายวันในฟอร์ม');
    fill(book, sheet.doc, sheet.blocks, report);
    book.zip.file(sheet.path, new XMLSerializer().serializeToString(sheet.doc));
    await keepOnly(book, sheet.name, report.date.slice(8));
    return book.zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
}
