// อ่าน/เขียนฟอร์ม BBS (.xlsx) โดยแก้เฉพาะค่าในช่องของ XML เดิม — สี เส้น โลโก้ และชีตอื่นไม่ถูกแตะ
// ต้องมี JSZip โหลดไว้ก่อน (window.JSZip)

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const INPUT_FILL_THEME = '5'; // ช่องสีส้มในฟอร์ม = ช่องที่ต้องกรอก
const DAY_TITLE = 'SC-Daily Checking Driver’s behavior  Report   กะกลางวัน   08.00 น.  - 20.00 น.';
const NIGHT_TITLE = 'SC-Daily Checking Driver’s behavior  Report   กะกลางคืน   20.00 น.  - 08.00 น.';
const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

export function colName(n) {
    let s = '';
    for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
    return s;
}
const colNum = (s) => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);

export const els = (node, name) => Array.from(node.getElementsByTagNameNS(NS, name));
export const colOf = (cell) => cell.getAttribute('r').replace(/\d+$/, '');
export const rowNum = (row) => Number(row.getAttribute('r'));
const parseXml = (text) => new DOMParser().parseFromString(text, 'application/xml');
const toXml = (doc) => {
    const s = new XMLSerializer().serializeToString(doc);
    return s.startsWith('<?xml') ? s : '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + s;
};

export async function openBook(buffer) {
    const zip = await window.JSZip.loadAsync(buffer);
    const read = async (path) => parseXml(await zip.file(path).async('string'));
    const wb = await read('xl/workbook.xml');
    const rels = await read('xl/_rels/workbook.xml.rels');
    const targets = {};
    for (const r of Array.from(rels.getElementsByTagName('Relationship'))) {
        targets[r.getAttribute('Id')] = 'xl/' + r.getAttribute('Target').replace(/^\/?(xl\/)?/, '');
    }
    const sheetPath = (part) => {
        const s = els(wb, 'sheet').find((x) => x.getAttribute('name').includes(part));
        if (!s) throw new Error('ไฟล์นี้ไม่มีชีต "' + part + '" — ไม่ใช่ฟอร์ม BBS');
        return targets[s.getAttribute('r:id')];
    };

    const sstFile = zip.file('xl/sharedStrings.xml');
    const strings = sstFile
        ? els(await read('xl/sharedStrings.xml'), 'si').map((si) => els(si, 't').map((t) => t.textContent).join(''))
        : [];
    const value = (cell) => {
        if (!cell) return '';
        if (cell.getAttribute('t') === 'inlineStr') return els(cell, 't').map((t) => t.textContent).join('');
        const v = els(cell, 'v')[0];
        if (!v) return '';
        return cell.getAttribute('t') === 's' ? strings[Number(v.textContent)] || '' : v.textContent;
    };

    // style index ที่พื้นเป็นสีของช่องกรอก
    const styles = await read('xl/styles.xml');
    const fills = els(els(styles, 'fills')[0], 'fill').map((f) => {
        const fg = els(f, 'fgColor')[0];
        return !!fg && fg.getAttribute('theme') === INPUT_FILL_THEME;
    });
    const inputStyles = new Set();
    els(els(styles, 'cellXfs')[0], 'xf').forEach((xf, i) => {
        if (fills[Number(xf.getAttribute('fillId'))]) inputStyles.add(String(i));
    });

    return { zip, read, sheetPath, value, inputStyles };
}

export const cellAt = (row, col) => els(row, 'c').find((c) => colOf(c) === col);

function ensureCell(doc, row, col) {
    let cell = cellAt(row, col);
    if (cell) return cell;
    cell = doc.createElementNS(NS, 'c');
    cell.setAttribute('r', col + rowNum(row));
    const next = els(row, 'c').find((c) => colNum(colOf(c)) > colNum(col));
    row.insertBefore(cell, next || null);
    return cell;
}

function clearCell(cell) {
    while (cell.firstChild) cell.removeChild(cell.firstChild);
    cell.removeAttribute('t');
}

function setCell(doc, row, col, val) {
    const cell = ensureCell(doc, row, col);
    clearCell(cell);
    if (val === '' || val === null || val === undefined) return;
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

// กลุ่มแถวของรถ 1 คัน = แถวติดกันที่คอลัมน์ C เป็นช่องกรอก
export function findBlocks(book, doc) {
    const blocks = [];
    let current = null;
    for (const row of els(doc, 'row')) {
        const c = cellAt(row, 'C');
        if (rowNum(row) >= 7 && c && book.inputStyles.has(c.getAttribute('s'))) {
            if (!current) blocks.push(current = []);
            current.push(row);
        } else current = null;
    }
    return blocks;
}

/** อ่านรายชื่อรถ/คนขับ ชื่อคอลัมน์หัวข้อตรวจ และรหัสลูกค้า จากไฟล์ต้นแบบ */
export async function readTemplate(buffer) {
    const book = await openBook(buffer);
    const doc = await book.read(book.sheetPath('ผ่าน_cctv'));
    const text = (row, col) => (row ? book.value(cellAt(row, col)).trim() : '');
    const vehicles = findBlocks(book, doc).map((rows) => ({
        scc: text(rows[0], 'B'),
        plate: text(rows[1], 'B'),
        driver: text(rows[0], 'E'),
        risk: text(rows[1], 'E')
    })).filter((v) => v.scc);
    if (!vehicles.length) throw new Error('ไม่พบช่องกรอกสีส้มในไฟล์นี้');

    const header = els(doc, 'row').find((r) => rowNum(r) === 6);
    const checks = {};
    for (let n = colNum('K'); n <= colNum('AO'); n++) checks[colName(n)] = text(header, colName(n));

    const customers = {};
    try {
        const cdoc = await book.read(book.sheetPath('Customer'));
        for (const row of els(cdoc, 'row')) {
            const id = text(row, 'A');
            if (/^\d+$/.test(id)) customers[id] = text(row, 'B');
        }
    } catch { /* ไม่มีชีตลูกค้า: พิมพ์ชื่อเอง */ }
    return { vehicles, checks, customers };
}

// เลขวันที่แบบ Excel จากวันที่รายงาน + เวลา (กะกลางคืน: เวลาก่อนเที่ยง = วันถัดไป)
function excelTime(date, time, shift) {
    if (!time) return '';
    const [y, m, d] = date.split('-').map(Number);
    const [hh, mm] = time.split(':').map(Number);
    let serial = (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
    if (shift === 'night' && hh < 12) serial += 1;
    return serial + (hh * 60 + mm) / 1440;
}

function renumber(doc) {
    const sheetData = els(doc, 'sheetData')[0];
    const moved = {};
    let n = 0;
    for (const row of els(sheetData, 'row')) {
        const old = rowNum(row);
        // แถวเดิมรักษาช่องว่างระหว่างเลขแถวไว้ แถวที่แทรกใหม่ (data-new) นับต่อกัน
        const isNew = row.hasAttribute('data-new');
        const gap = isNew || !row.hasAttribute('data-gap') ? 1 : Number(row.getAttribute('data-gap'));
        n += gap;
        if (!isNew) moved[old] = n;
        row.removeAttribute('data-new');
        row.removeAttribute('data-gap');
        row.setAttribute('r', String(n));
        for (const c of els(row, 'c')) c.setAttribute('r', colOf(c) + n);
    }
    // สูตรที่อ้างแถวในชีตเดียวกัน (ส่วนท้ายฟอร์ม) เลื่อนตาม
    for (const f of els(doc, 'f')) {
        f.textContent = f.textContent.replace(/(?<![!:A-Z])([A-Z]{1,3})(\d+)/g,
            (all, col, r) => (moved[r] ? col + moved[r] : all));
    }
    const dim = els(doc, 'dimension')[0];
    if (dim) dim.setAttribute('ref', dim.getAttribute('ref').replace(/\d+$/, String(n)));
}

function markGaps(doc) {
    let prev = 0;
    for (const row of els(doc, 'row')) {
        row.setAttribute('data-gap', String(rowNum(row) - prev));
        prev = rowNum(row);
    }
}

function cloneRow(row) {
    const copy = row.cloneNode(true);
    copy.setAttribute('data-new', '1');
    copy.removeAttribute('data-gap');
    for (const c of els(copy, 'c')) for (const f of els(c, 'f')) c.removeChild(f);
    return copy;
}

function fillReport(book, doc, report) {
    markGaps(doc);
    const sheetData = els(doc, 'sheetData')[0];
    let blocks = findBlocks(book, doc);
    const byScc = new Map(blocks.map((rows) => [book.value(cellAt(rows[0], 'B')).trim(), rows]));

    // รถที่ไม่มีในฟอร์ม: คัดลอกแถวคั่น + ชุดแถวของคันสุดท้ายต่อท้าย
    let number = Math.max(0, ...blocks.map((rows) => Number(book.value(cellAt(rows[0], 'A'))) || 0));
    for (const v of report.vehicles) {
        if (byScc.has(v.scc)) continue;
        const last = blocks[blocks.length - 1];
        const separator = last[0].previousElementSibling;
        const after = last[last.length - 1].nextSibling;
        sheetData.insertBefore(cloneRow(separator), after);
        for (const c of els(after ? after.previousSibling : sheetData.lastChild, 'c')) {
            if (colOf(c) === 'B') clearCell(c);
        }
        const rows = last.slice(0, 3).map(cloneRow);
        rows.forEach((row) => {
            sheetData.insertBefore(row, after);
            for (const c of els(row, 'c')) if (colNum(colOf(c)) <= 2) clearCell(c);
        });
        setCell(doc, rows[0], 'A', ++number);
        setCell(doc, rows[0], 'B', v.scc);
        if (rows[1]) setCell(doc, rows[1], 'B', v.plate || '');
        byScc.set(v.scc, rows);
        blocks = blocks.concat([rows]);
    }

    const data = new Map(report.vehicles.map((v) => [v.scc, v]));
    let used = 0;
    for (const [scc, rows] of byScc) {
        const v = data.get(scc) || { trips: [], rounds: [] };
        const need = Math.max(v.trips.length, v.rounds.length, 2);
        // ข้อมูลเกินแถวของฟอร์ม → แทรกแถวใหม่ (รูปแบบเดียวกัน) ก่อนแถวสุดท้ายของคันนั้น
        while (rows.length < need) {
            const source = rows[Math.max(0, rows.length - 2)];
            const extra = cloneRow(source);
            for (const c of els(extra, 'c')) if (colNum(colOf(c)) <= 2) clearCell(c);
            sheetData.insertBefore(extra, rows[rows.length - 1]);
            rows.splice(rows.length - 1, 0, extra);
        }
        rows.forEach((row) => {
            for (const c of els(row, 'c')) {
                const n = colNum(colOf(c));
                if (n >= 3 && n <= colNum('AP')) clearCell(c);
            }
        });
        if (v.driver || v.rounds.length || v.trips.length) used++;
        setCell(doc, rows[0], 'C', v.gps || '');
        setCell(doc, rows[0], 'D', v.cctv || '');
        setCell(doc, rows[0], 'E', v.driver || '');
        if (rows[1]) setCell(doc, rows[1], 'E', v.risk || '');
        v.trips.forEach((t, i) => {
            setCell(doc, rows[i], 'F', t.ship || '');
            setCell(doc, rows[i], 'G', t.custId || '');
            setCell(doc, rows[i], 'H', t.cust || '');
        });
        v.rounds.forEach((r, i) => {
            setCell(doc, rows[i], 'I', excelTime(report.date, r.time, report.shift));
            setCell(doc, rows[i], 'J', r.place || '');
            for (const [col, mark] of Object.entries(r.marks || {})) setCell(doc, rows[i], col, mark);
            setCell(doc, rows[i], 'AP', r.note || '');
        });
    }

    // หัวรายงาน
    const row = (n) => els(doc, 'row').find((r) => rowNum(r) === n);
    const [y, m, d] = report.date.split('-').map(Number);
    setCell(doc, row(1), 'H', report.shift === 'night' ? NIGHT_TITLE : DAY_TITLE);
    setCell(doc, row(2), 'H', 'วันที่ ' + d);
    setCell(doc, row(2), 'I', 'เดือน ' + MONTHS[m - 1]);
    setCell(doc, row(2), 'J', 'พ.ศ. ' + (y + 543));
    setCell(doc, row(2), 'L', 'ตรวจสอบโดย ' + (report.checker || ''));
    setCell(doc, row(2), 'R', 'MONITOR : ' + (report.monitor || ''));

    // ยอดรวมจำนวนคันที่ส่วนท้าย
    for (const c of els(doc, 'c')) {
        const text = book.value(c);
        if (colOf(c) === 'I' && /รวม.*คัน/.test(text)) {
            setCell(doc, c.parentNode, 'I', text.replace(/\d+/, String(used)));
        }
    }
    renumber(doc);
}

// ชีตสรุป: วันที่ กะ และรายการที่ติด O หรือมีหมายเหตุ
function fillSummary(book, doc, report) {
    markGaps(doc);
    const sheetData = els(doc, 'sheetData')[0];
    const row = (n) => els(doc, 'row').find((r) => rowNum(r) === n);
    const [y, m, d] = report.date.split('-');
    setCell(doc, row(1), 'F', 'วันที่ ' + d + '/' + m + '/' + (Number(y) + 543));
    setCell(doc, row(1), 'G', report.shift === 'night' ? 'กะกลางคืน   20.00 น.  - 08.00 น.' : 'กะกลางวัน   08.00 น.  - 20.00 น.');

    const issues = [];
    for (const v of report.vehicles) {
        for (const r of v.rounds) {
            const bad = Object.values(r.marks || {}).includes('O');
            if (bad || r.note) issues.push({ v, r });
        }
    }
    const first = row(10);
    if (!first) return;
    const rows = [first];
    while (rows.length < issues.length) {
        const extra = cloneRow(first);
        sheetData.insertBefore(extra, rows[rows.length - 1].nextSibling);
        rows.push(extra);
    }
    rows.forEach((target, i) => {
        const item = issues[i];
        setCell(doc, target, 'A', i + 1);
        setCell(doc, target, 'B', item ? item.v.scc : '');
        setCell(doc, target, 'C', item ? item.v.driver : '');
        setCell(doc, target, 'D', item ? item.r.time : '');
        setCell(doc, target, 'E', item ? item.r.place : '');
        setCell(doc, target, 'F', item ? item.v.risk : '');
        setCell(doc, target, 'G', item ? item.r.note : '');
        setCell(doc, target, 'H', item ? report.monitor : '');
    });
    renumber(doc);
}

/**
 * @param {ArrayBuffer} buffer ไฟล์ต้นแบบ
 * @param {{date:string, shift:'day'|'night', checker:string, monitor:string, vehicles:object[]}} report
 * @returns {Promise<Blob>}
 */
export async function buildReport(buffer, report) {
    const book = await openBook(buffer);
    for (const [part, fill] of [['ผ่าน_cctv', fillReport], ['ชมเชย', fillSummary]]) {
        const path = book.sheetPath(part);
        const doc = await book.read(path);
        fill(book, doc, report);
        book.zip.file(path, toXml(doc));
    }
    // ลำดับคำนวณสูตรเดิมอ้างตำแหน่งแถวเก่า: ลบออก Excel สร้างใหม่เอง
    if (book.zip.file('xl/calcChain.xml')) {
        book.zip.remove('xl/calcChain.xml');
        for (const path of ['[Content_Types].xml', 'xl/_rels/workbook.xml.rels']) {
            const text = await book.zip.file(path).async('string');
            book.zip.file(path, text.replace(/<(Override|Relationship)\b[^>]*calcChain[^>]*\/>/g, ''));
        }
    }
    return book.zip.generateAsync({
        type: 'blob',
        compression: 'DEFLATE',
        mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    });
}
