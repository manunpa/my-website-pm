// ฟอร์ม BBS แบบตารางรายชั่วโมง ใช้ได้ทุกหน่วยงาน: อ่านผังจากหัวตารางของไฟล์เอง
// - คอลัมน์ป้ายแถว: ที่มีคำว่า "เวลาที่ดู / ผลการตรวจสอบ"
// - รถ 1 คัน = แถวคู่ติดกัน (คู่ที่ 1 = พขร.1, คู่ที่ 2 = พขร.2) คั่นด้วยแถวว่าง
// - เบอร์รถว่างได้: เป็นช่องรอเติมจากแผนงาน
// - ชั่วโมง: ครบ 0-23 (ตำแหน่งตายตัว) หรือช่องเรียงต่อจากเวลาเริ่มกะ (หัวตารางเปลี่ยนตามกะ)
import { openBook, els, colOf, rowNum, colName } from './bbs-xlsx.js?v=10';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const WATCH = 'เวลาที่ดู';
const LABEL = /^(เวลาที่ดู|ผลการตรวจสอบ)$/;
const BASE_RESULTS = [
    ['OK', 'ขับขี่ปกติ'], ['NG', 'ผิดปกติ / เสี่ยง / ละเมิดกฎ'], ['C', 'ลูกค้า'], ['P', 'จุดพัก / จอดพัก'], ['M', 'ซ่อมบำรุง']
];

const colNum = (s) => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const cellAt = (row, col) => (row ? els(row, 'c').find((c) => colOf(c) === col) : undefined);
const textOf = (book, row, col) => book.value(cellAt(row, col)).trim();

// ชีตที่ไม่ซ่อน: ชีตวันที่ล่าสุดก่อน ตามด้วยชีตชื่ออื่น (ตัดสินว่าใช่ตารางหรือไม่จากเนื้อหา)
async function sheetNames(book) {
    const wb = await book.read('xl/workbook.xml');
    const names = els(wb, 'sheet').filter((s) => !/hidden/i.test(s.getAttribute('state') || ''))
        .map((s) => s.getAttribute('name')).reverse();
    const isDay = (name) => /^\d{1,2}$/.test(name.trim());
    return [...names.filter(isDay), ...names.filter((name) => !isDay(name))];
}

async function sheetPathOf(book, name) {
    const wb = await book.read('xl/workbook.xml');
    const rels = await book.read('xl/_rels/workbook.xml.rels');
    const id = els(wb, 'sheet').find((s) => s.getAttribute('name') === name).getAttribute('r:id');
    const link = Array.from(rels.getElementsByTagName('Relationship')).find((l) => l.getAttribute('Id') === id);
    return 'xl/' + link.getAttribute('Target').replace(/^\/?(xl\/)?/, '');
}

function readLayout(book, doc) {
    const rows = els(doc, 'row');
    const first = rows.find((row) => els(row, 'c').some((c) => book.value(c).trim() === WATCH));
    if (!first) return null;
    const label = colOf(els(first, 'c').find((c) => book.value(c).trim() === WATCH));
    const head = rows.filter((r) => rowNum(r) < rowNum(first))
        .flatMap((row) => els(row, 'c').map((c) => ({ row, col: colOf(c), n: colNum(colOf(c)), text: book.value(c).trim() })))
        .filter((x) => x.text);
    const find = (re) => head.find((x) => x.n < colNum(label) && re.test(x.text));

    const car = find(/^(เลขรถ|หมายเลขรถ|เบอร์รถ|ทะเบียน)/)?.col;
    if (!car) return null;
    const driver = find(/driver|พขร|คนขับ/i)?.col || 'D';
    const customer = find(/ลูกค้า/)?.col;
    const trips = [];
    if (customer) for (let n = colNum(customer); n < colNum(label); n++) trips.push(colName(n));

    // แถวหัวชั่วโมง: แถวที่มีตัวเลข 0-24 ทางขวาของคอลัมน์ป้ายมากที่สุด
    let hourCells = [];
    let hourRow = null;
    for (const row of rows.filter((r) => rowNum(r) <= rowNum(first))) {
        const found = els(row, 'c')
            .map((c) => ({ col: colOf(c), text: book.value(c).trim() }))
            .filter((x) => colNum(x.col) > colNum(label) && /^([01]?\d|2[0-4])$/.test(x.text));
        if (found.length > hourCells.length) [hourCells, hourRow] = [found, rowNum(row)];
    }
    if (hourCells.length < 8) return null;
    const fixed = hourCells.length >= 24 && hourCells.some((x) => Number(x.text) === 0);

    // รหัสสถานที่ในคำอธิบายหัวฟอร์ม ใช้เป็นปุ่มผลการตรวจ
    const codes = [...new Set(head.map((x) => x.text)
        .filter((t) => /^[A-Z][A-Z0-9]{1,7}$/.test(t) && !/^(OK|NG|GPS|CCTV|SCC|MDVR|HUB)$/.test(t)))];

    // สถานะของ พขร. แต่ละคน
    const status = find(/^สถานะ$/)?.col;
    const rest = find(/^สถานะวันหยุด$/)?.col;
    const gps = head.find((x) => x.text === 'GPS')?.col;
    const cctv = head.find((x) => x.text === 'CCTV')?.col;
    const number = head.find((x) => x.text === 'ลำดับ')?.col;
    // ช่องหัวรายงาน: อยู่ถัดจากป้ายชื่อ (ข้ามช่องที่ผสานกับป้าย)
    const after = (re) => {
        const x = head.find((h) => re.test(h.text));
        if (!x) return null;
        const merged = els(doc, 'mergeCell').map((m) => m.getAttribute('ref').split(':'))
            .find(([from]) => from === x.col + rowNum(x.row));
        return { row: rowNum(x.row), col: colName(colNum(merged ? merged[1].replace(/\d+$/, '') : x.col) + 1) };
    };
    const date = after(/^วันที่$/);
    const title = date
        ? { date, shift: after(/^กะ$/), monitor: after(/มอนิเตอร์|monitor/i) }
        : { shift: { row: 2, col: 'D' }, date: { row: 3, col: 'D' }, monitor: { row: 4, col: 'D' } };

    const found = head.find((x) => x.text.startsWith('บันทึกการติดตาม'));
    const heading = found ? { row: rowNum(found.row), col: found.col } : null;

    return { label, car, driver, status, rest, trips, hourCells, hourRow, fixed, codes, gps, cctv, number, title, heading };
}

// แถวของรถแต่ละคัน: แถวป้ายที่ต่อเนื่องกัน (เจอเบอร์รถใหม่ = คันถัดไป)
function findBlocks(book, doc, layout) {
    const blocks = [];
    let current = null;
    for (const row of els(doc, 'row')) {
        const label = textOf(book, row, layout.label);
        if (!LABEL.test(label)) { current = null; continue; }
        const car = textOf(book, row, layout.car);
        const follows = current && !car && rowNum(row) === rowNum(current.rows[current.rows.length - 1]) + 1;
        if (follows) current.rows.push(row);
        else if (label === WATCH) blocks.push(current = { plate: car, rows: [row] });
        else current = null;
    }
    return blocks;
}

// ชีตต้นแบบ: เลือกอันที่แถวต่อคันครบ (ชีตวันที่ล่าสุดก่อน)
async function pickSheet(book) {
    let fallback = null;
    for (const name of await sheetNames(book)) {
        const path = await sheetPathOf(book, name);
        const doc = await book.read(path);
        const layout = readLayout(book, doc);
        const blocks = layout ? findBlocks(book, doc, layout) : [];
        if (!blocks.length) continue;
        const found = { name, path, doc, layout, blocks };
        if (blocks.some((b) => b.rows.length >= 4)) return found;
        fallback ||= found;
    }
    return fallback;
}

// ชั่วโมงของกะ ตรงกับช่องในฟอร์ม
function hoursOf(layout, shift) {
    const start = shift === 'night' ? 20 : 8;
    const count = layout.fixed ? 12 : layout.hourCells.length;
    return Array.from({ length: count }, (_, i) => (start + i) % 24);
}

// ชีต Database_SCC (ถ้ามี): A=ชื่อหัวรายงานของหน่วยงาน B=เบอร์รถ ใช้เป็นรายการหน่วยงานย่อย
async function readUnits(book) {
    const wb = await book.read('xl/workbook.xml');
    const name = els(wb, 'sheet').map((s) => s.getAttribute('name')).find((n) => /^database/i.test(n));
    if (!name) return [];
    const units = new Map();
    for (const row of els(await book.read(await sheetPathOf(book, name)), 'row')) {
        const title = textOf(book, row, 'A');
        const no = textOf(book, row, 'B');
        if (!title.includes('หน่วยงาน') || !/^\d{3,4}$/.test(no)) continue;
        if (!units.has(title)) units.set(title, { title, name: title.split('หน่วยงาน').pop().trim(), cars: [] });
        units.get(title).cars.push('SCC' + no);
    }
    return [...units.values()];
}

/** คืน null ถ้าไฟล์ไม่ใช่ฟอร์มแบบรายชั่วโมง */
export async function readHourly(buffer) {
    const book = await openBook(buffer);
    const sheet = await pickSheet(book);
    if (!sheet) return null;
    const { layout } = sheet;
    return {
        hourly: true,
        units: await readUnits(book),
        shiftHours: (shift) => hoursOf(layout, shift),
        results: [...BASE_RESULTS, ...layout.codes.filter((c) => !BASE_RESULTS.some(([b]) => b === c)).map((c) => [c, c])],
        vehicles: sheet.blocks.filter((b) => b.plate).map((b) => ({ scc: b.plate, plate: '', driver: '', risk: '' })),
        checks: {},
        customers: {}
    };
}

function setCell(doc, row, col, val) {
    if (!row) return;
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

// รถเกินช่องในฟอร์ม: ตัดแถวท้ายตารางทิ้ง แล้วคัดลอกชุดแถว + แถวคั่น + การผสานช่องของคันสุดท้าย
function appendBlocks(doc, blocks, count) {
    const last = blocks[blocks.length - 1];
    const lastRow = last.rows[last.rows.length - 1];
    const separator = lastRow.nextElementSibling;
    const source = [...last.rows, ...(separator ? [separator] : [])].map((r) => r.cloneNode(true));
    const first = rowNum(last.rows[0]);
    const end = first + source.length - 1;
    while (separator?.nextSibling) separator.parentNode.removeChild(separator.nextSibling);

    const merges = els(doc, 'mergeCells')[0];
    const own = [];
    for (const m of merges ? els(merges, 'mergeCell') : []) {
        const p = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(m.getAttribute('ref'));
        if (!p) continue;
        if (Number(p[2]) > end) merges.removeChild(m);
        else if (Number(p[2]) >= first) own.push(p);
    }

    let at = end + 1;
    const added = [];
    for (let n = 0; n < count; n++) {
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
        added.push({ plate: '', rows: rows.slice(0, last.rows.length) });
        at += source.length;
    }
    merges?.setAttribute('count', String(merges.children.length));
    const dim = els(doc, 'dimension')[0];
    dim?.setAttribute('ref', dim.getAttribute('ref').replace(/\d+$/, String(at - 1)));
    return added;
}

const watched = (time) => (time ? Number(time.slice(0, 2)) + '.' + time.slice(3, 5) : '');
const used = (v) => !!(v.driver || v.trips.length || v.rounds.length);

// สีของแต่ละรหัสอ่านจากคำอธิบายหัวฟอร์ม (เช่น ช่อง C สีชมพู) แล้วลงสีเดียวกันในช่องผลการตรวจ
// รหัสที่มีสองสีในหัวฟอร์มใช้อันแรกที่เจอ
function painter(book, doc, styles) {
    const fills = els(els(styles, 'fills')[0], 'fill');
    const cellXfs = els(styles, 'cellXfs')[0];
    const xfs = els(cellXfs, 'xf');
    const colored = (id) => {
        const pattern = fills[id] && els(fills[id], 'patternFill')[0];
        const color = pattern?.getAttribute('patternType') === 'solid' && els(pattern, 'fgColor')[0];
        if (!color) return false;
        const rgb = color.getAttribute('rgb');
        return rgb ? !/FFFFFF$/i.test(rgb) : color.getAttribute('theme') !== '0';
    };

    const legend = new Map(); // รหัส -> fillId
    for (const row of els(doc, 'row')) {
        const texts = els(row, 'c').map((c) => [c, book.value(c).trim()]);
        if (texts.some(([, t]) => t === WATCH)) break;
        for (const [c, text] of texts) {
            if (!/^[A-Z][A-Z0-9]{0,7}$/.test(text) || legend.has(text)) continue;
            const id = Number(xfs[Number(c.getAttribute('s') || 0)]?.getAttribute('fillId') || 0);
            if (colored(id)) legend.set(text, id);
        }
    }

    const made = new Map(); // สไตล์เดิม:สี -> สไตล์ใหม่ (เส้นขอบ ฟอนต์ คงเดิม)
    return (cell, code) => {
        const fill = legend.get(/^C\d+$/.test(code) ? 'C' : code);
        if (!cell || fill === undefined) return;
        const base = Number(cell.getAttribute('s') || 0);
        const key = base + ':' + fill;
        if (!made.has(key)) {
            const xf = xfs[base].cloneNode(true);
            xf.setAttribute('fillId', String(fill));
            xf.setAttribute('applyFill', '1');
            cellXfs.appendChild(xf);
            made.set(key, els(cellXfs, 'xf').length - 1);
            cellXfs.setAttribute('count', String(made.get(key) + 1));
        }
        cell.setAttribute('s', String(made.get(key)));
    };
}

function fill(book, doc, layout, blocks, report, paint) {
    const data = new Map(report.vehicles.map((v) => [v.scc, v]));
    const have = new Set(blocks.map((b) => b.plate));
    const waiting = report.vehicles.filter((v) => !have.has(v.scc) && (report.unitTitle || used(v)))
        .sort((x, y) => x.scc.localeCompare(y.scc, undefined, { numeric: true }));
    const slots = blocks.filter((b) => !b.plate);
    if (waiting.length > slots.length) {
        const added = appendBlocks(doc, blocks, waiting.length - slots.length);
        blocks.push(...added);
        slots.push(...added);
    }
    waiting.forEach((v, i) => { slots[i].plate = v.scc; });

    // ช่องชั่วโมง: ผังตายตัวใช้ตามหัวตาราง ผังเรียงตามกะต้องเขียนหัวตารางใหม่
    const hours = hoursOf(layout, report.shift);
    const row = (n) => els(doc, 'row').find((r) => rowNum(r) === n);
    const column = new Map(layout.fixed
        ? layout.hourCells.map((x) => [Number(x.text) % 24, x.col])
        : layout.hourCells.map((x, i) => [hours[i], x.col]));
    if (!layout.fixed) layout.hourCells.forEach((x, i) => setCell(doc, row(layout.hourRow), x.col, hours[i]));

    const clear = [layout.driver, layout.status, layout.rest, ...layout.trips, ...layout.hourCells.map((x) => x.col)].filter(Boolean);
    // หมายเหตุลงคอลัมน์ว่างถัดจากตาราง
    const noteCol = colName(Math.max(...layout.hourCells.map((x) => colNum(x.col))) + (layout.fixed ? 2 : 1));
    blocks.forEach(({ plate, rows }, index) => {
        const v = data.get(plate) || { trips: [], rounds: [] };
        for (const r of rows) {
            for (const col of clear) setCell(doc, r, col, '');
        }
        if (layout.fixed) setCell(doc, rows[0], 'AI', '');
        const no = /^SCC(\d+)$/.exec(plate);
        setCell(doc, rows[0], layout.car, no ? Number(no[1]) : plate);
        if (layout.number) setCell(doc, rows[0], layout.number, plate ? index + 1 : '');
        const mark = (s) => (s === 'ปกติ' ? 'OK' : s === 'ไม่ปกติ' ? 'NG' : '');
        if (layout.gps) setCell(doc, rows[0], layout.gps, mark(v.gps));
        if (layout.cctv) setCell(doc, rows[0], layout.cctv, mark(v.cctv));
        setCell(doc, rows[0], layout.driver, v.driver || '');
        setCell(doc, rows[2], layout.driver, v.driver2 || '');
        setCell(doc, rows[4], layout.driver, v.driver3 || '');
        [['status', 'rest'], ['status2', 'rest2'], ['status3', 'rest3']].forEach(([status, rest], i) => {
            if (layout.status) setCell(doc, rows[i * 2], layout.status, v[status] || '');
            if (layout.rest) setCell(doc, rows[i * 2], layout.rest, v[rest] || '');
        });

        // หลายคอลัมน์ = เที่ยวเรียงไปทางขวา คอลัมน์เดียว = เรียงลงตามแถวของคัน ที่เกินรวมช่องสุดท้าย
        const names = v.trips.map((t) => t.cust || t.ship).filter(Boolean);
        const across = layout.trips.length > 1;
        const room = across ? layout.trips.length : rows.length;
        if (names.length > room) names.splice(room - 1, names.length, names.slice(room - 1).join(' / '));
        if (layout.trips.length) {
            names.forEach((name, i) => setCell(doc, across ? rows[0] : rows[i], layout.trips[across ? i : 0], name));
        }

        const notes = [];
        for (const r of v.rounds) {
            const at = ((r.who || 1) - 1) * 2; // พขร. คนละคู่แถว
            const col = column.get(r.hour);
            if (!col || !rows[at + 1]) continue;
            setCell(doc, rows[at], col, watched(r.time));
            setCell(doc, rows[at + 1], col, r.place || '');
            paint(cellAt(rows[at + 1], col), r.place || '');
            if (r.note) notes.push(r.hour + ' น. ' + r.note);
        }
        setCell(doc, rows[0], noteCol, notes.join(' / '));
    });

    if (report.unitTitle && layout.heading) setCell(doc, row(layout.heading.row), layout.heading.col, report.unitTitle);
    const [y, m, d] = report.date.split('-').map(Number);
    const { date, shift, monitor } = layout.title;
    const put = (at, val) => { if (at) setCell(doc, row(at.row), at.col, val); };
    // บางฟอร์มเก็บปีเป็น พ.ศ. ในเซลล์วันที่ ใช้แบบเดียวกับของเดิม
    const buddhist = Number(book.value(cellAt(row(date.row), date.col))) > 150000;
    put(date, (Date.UTC(y + (buddhist ? 543 : 0), m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
    put(shift, report.shift === 'night' ? 'กะกลางคืน 20.00 น. - 08.00 น.' : 'กะกลางวัน 08.00 น. - 20.00 น.');
    put(monitor, report.monitor || report.checker || '');
}

// ไฟล์รายเดือน: เหลือชีตเดียว (วันของรายงาน) ลบชีตอื่นออกจากไฟล์
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
    const xml = (doc) => new XMLSerializer().serializeToString(doc);
    book.zip.file('[Content_Types].xml', types);
    book.zip.file('xl/workbook.xml', xml(wb));
    book.zip.file('xl/_rels/workbook.xml.rels', xml(rels));
}

export async function buildHourly(buffer, report) {
    const book = await openBook(buffer);
    const sheet = await pickSheet(book);
    if (!sheet) throw new Error('ไม่พบตารางรายชั่วโมงในฟอร์ม');
    const styles = await book.read('xl/styles.xml');
    fill(book, sheet.doc, sheet.layout, sheet.blocks, report, painter(book, sheet.doc, styles));
    book.zip.file('xl/styles.xml', new XMLSerializer().serializeToString(styles));
    // ฟอร์มที่แยกมาจากไฟล์อื่นมีรายการเลือกที่ลิงก์เสีย (#REF!) ติดมา ทำให้ Excel เปิดไฟล์ไม่ได้
    const xml = new XMLSerializer().serializeToString(sheet.doc)
        .replace(/<x14:dataValidation[ >](?:(?!<\/x14:dataValidation>)[\s\S])*?#REF![\s\S]*?<\/x14:dataValidation>/g, '')
        .replace(/<ext [^>]*>\s*<x14:dataValidations [^>]*>\s*<\/x14:dataValidations>\s*<\/ext>/g, '')
        .replace(/<extLst>\s*<\/extLst>|<extLst\/>/g, '');
    book.zip.file(sheet.path, xml);
    if (/^\d{1,2}$/.test(sheet.name.trim())) await keepOnly(book, sheet.name, report.date.slice(8));
    // ลำดับคำนวณเดิมอ้างสูตรที่ถูกเขียนทับหรือชีตที่ลบไปแล้ว: Excel สร้างใหม่เอง
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
