// ฟอร์ม BBS แบบตารางรายชั่วโมง ใช้ได้ทุกหน่วยงาน: อ่านผังจากหัวตารางของไฟล์เอง
// - คอลัมน์ป้ายแถว: ที่มีคำว่า "เวลาที่ดู / ผลการตรวจสอบ"
// - รถ 1 คัน = แถวคู่ติดกัน (คู่ที่ 1 = พขร.1, คู่ที่ 2 = พขร.2) คั่นด้วยแถวว่าง
// - เบอร์รถว่างได้: เป็นช่องรอเติมจากแผนงาน
// - ฟอร์ม RSC (Other Brand, TOYOTA): เบอร์รถอยู่แถว "Driving Pattern" เหนือคู่แถว มีรูธงาน เวลารับงาน และกลุ่มเสี่ยง
// - ชั่วโมง: ครบ 0-23 (ตำแหน่งตายตัว) หรือช่องเรียงต่อจากเวลาเริ่มกะ (หัวตารางเปลี่ยนตามกะ)
import { openBook, els, colOf, rowNum, colName } from './bbs-xlsx.js?v=11';

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
const WATCH = 'เวลาที่ดู';
const HEAD = 'Driving Pattern';
const BLANK = /^(แบบ)?ฟอร์ม$/; // ชีตเปล่าของฟอร์ม RSC
// รหัสผลของฟอร์ม RSC ที่รู้ความหมาย เรียงตามที่ใช้บ่อย
const RSC_RESULTS = [['OK', 'ขับขี่ปกติ'], ['NG', 'ผิดปกติ / เสี่ยง / ละเมิดกฎ'], ['P', 'จุดพัก / จอดพัก'],
    ['B', 'จอดนอน / พักบนรถ'], ['พ', 'จอดพัก'], ['ป', 'เปลี่ยนมือ'], ['D', 'ดีลเลอร์ / ลูกค้า'], ['Y', 'หน่วยงาน SCA']];
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

// หัวชั่วโมงที่เก็บเป็นเวลาของ Excel (1:00 = 0.04166…) → เลขชั่วโมง
const hourText = (text) => (Number(text) > 0 && Number(text) < 1 ? String(Math.round(Number(text) * 24)) : text);

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
            .map((c) => ({ col: colOf(c), text: hourText(book.value(c).trim()) }))
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

    // ส่วนที่มีเฉพาะฟอร์ม RSC
    const route = find(/รูธงาน/)?.col;
    const jobTime = find(/เวลารับงาน|เวลาออก/);
    const abnormal = head.find((x) => /^(บันทึกความผิดปกติ|หมายเหตุ\s*OK)/.test(x.text))?.col;
    const adas = head.find((x) => x.text === 'ADAS-DMS')?.col;
    // ชื่อผู้ Monitor ของแต่ละกะ อยู่ถัดจากป้ายกะ
    const monitors = { day: after(/^กะกลางวัน/), night: after(/^กะกลางคืน/) };
    // รหัสผลในคำอธิบายหัวฟอร์ม (แถว 2-3) รวมตัวเดียวและตัวไทย เช่น P, พ, MMTh
    const keys = [...new Set(head.filter((x) => rowNum(x.row) <= 3 && /^([A-Za-z]{1,6}|พ|ป)$/.test(x.text)).map((x) => x.text))];

    return { label, car, driver, status, rest, trips, hourCells, hourRow, fixed, codes, gps, cctv, number, title, heading,
        route, jobTime: jobTime?.col, jobLabel: jobTime?.text.replace(/\s+/g, ' '), abnormal, adas, monitors, keys };
}

// แถวของรถแต่ละคัน: แถวป้ายที่ต่อเนื่องกัน (เจอเบอร์รถใหม่ = คันถัดไป)
function findBlocks(book, doc, layout) {
    const blocks = [];
    let current = null;
    let head = []; // แถว Driving Pattern ที่รอจับคู่ (ฟอร์ม RSC)
    for (const row of els(doc, 'row')) {
        const label = textOf(book, row, layout.label);
        const last = head[head.length - 1];
        // แถวที่สองของหัวเป็นช่องผสาน ไม่มีข้อความ
        if (label === HEAD || (!label && last && head.length < 2 && rowNum(row) === rowNum(last) + 1)) {
            head = label === HEAD ? [row] : [...head, row];
            current = null;
            continue;
        }
        if (!LABEL.test(label)) { current = null; head = []; continue; }
        const car = textOf(book, row, layout.car);
        const follows = current && !car && rowNum(row) === rowNum(current.rows[current.rows.length - 1]) + 1;
        if (follows) current.rows.push(row);
        else if (label === WATCH) {
            current = head.length
                ? { plate: textOf(book, head[0], layout.car), rows: [row], head }
                : { plate: car, rows: [row] };
            blocks.push(current);
            head = [];
        } else current = null;
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
        // ฟอร์ม RSC: แท็บรายวันมีคันซ้ำได้ ใช้ชีต "ฟอร์ม" ที่ว่างเป็นต้นแบบ
        const blankName = blocks[0].head && !BLANK.test(name) && (await sheetNames(book)).find((n) => BLANK.test(n));
        if (blankName) {
            const blankPath = await sheetPathOf(book, blankName);
            const blank = await book.read(blankPath);
            const blankLayout = readLayout(book, blank);
            const blankBlocks = blankLayout ? findBlocks(book, blank, blankLayout) : [];
            if (blankBlocks[0]?.head) return { name: blankName, path: blankPath, doc: blank, layout: blankLayout, blocks: blankBlocks };
        }
        if (blocks.some((b) => b.rows.length >= 4)) return found;
        fallback ||= found;
    }
    return fallback;
}

// ฟอร์ม RSC: ช่อง "ชื่อคนขับ" กว้างสองคอลัมน์ คอลัมน์แรกเป็นป้าย พขร.1/2 ชื่ออยู่คอลัมน์ถัดไป
const nameColumn = (sheet) => (sheet.blocks[0].head ? colName(colNum(sheet.layout.driver) + 1) : sheet.layout.driver);

// ชีตกลุ่มเสี่ยง: B=ชื่อ C=กลุ่ม E=รายละเอียด
async function readRisk(book) {
    if (!(await sheetNames(book)).includes('กลุ่มเสี่ยง')) return [];
    return els(await book.read(await sheetPathOf(book, 'กลุ่มเสี่ยง')), 'row')
        .map((row) => ({ name: textOf(book, row, 'B'), group: textOf(book, row, 'C'), detail: textOf(book, row, 'E') }))
        .filter((x) => x.name && /^(sheep|wolf|new)/i.test(x.group));
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

// คำอธิบายรหัสบนหัวฟอร์ม RSC: แต่ละรหัสมีสีของตัวเอง และความหมายคือข้อความถัดไปในแถวเดียวกัน
// รหัสเดียวกันคนละสี = คนละความหมาย (เช่น LCB จุดรับสินค้า กับ LCB ดีลเลอร์)
function paletteOf(book, doc, styles) {
    const KEY = /^([A-Za-z]{1,6}|พ|ป)$/;
    const fills = els(els(styles, 'fills')[0], 'fill');
    const xfs = els(els(styles, 'cellXfs')[0], 'xf');
    const colorOf = (cell) => {
        const fill = fills[Number(xfs[Number(cell.getAttribute('s') || 0)]?.getAttribute('fillId') || 0)];
        const pattern = fill && els(fill, 'patternFill')[0];
        const front = pattern?.getAttribute('patternType') === 'solid' && els(pattern, 'fgColor')[0];
        const rgb = front ? (front.getAttribute('rgb') || '').slice(-6).toLowerCase() : '';
        return rgb && rgb !== 'ffffff' ? '#' + rgb : '';
    };
    const found = [];
    for (const row of els(doc, 'row').filter((r) => rowNum(r) === 2 || rowNum(r) === 3)) {
        let waiting = [];
        for (const cell of els(row, 'c')) {
            const text = book.value(cell).trim();
            if (!text) continue;
            if (KEY.test(text)) { waiting.push({ code: text, color: colorOf(cell) }); continue; }
            const meaning = text.replace(/\s+/g, ' ');
            for (const item of waiting) {
                if (!found.some((x) => x.code === item.code && x.color === item.color)) found.push({ ...item, meaning });
            }
            waiting = [];
        }
    }
    return found;
}

/** คืน null ถ้าไฟล์ไม่ใช่ฟอร์มแบบรายชั่วโมง */
export async function readHourly(buffer) {
    const book = await openBook(buffer);
    const sheet = await pickSheet(book);
    if (!sheet) return null;
    const { layout } = sheet;
    const styles = await book.read('xl/styles.xml');
    const legend = legendOf(book, sheet.doc, styles);
    const codesOf = (kind) => [...new Set(legend.filter((x) => x.kind === kind).map((x) => x.code))];
    const rsc = !!sheet.blocks[0].head;
    const known = (list) => list.filter(([code]) => layout.keys.includes(code));
    const results = rsc
        ? [...known(RSC_RESULTS), ...layout.keys.filter((k) => !RSC_RESULTS.some(([c]) => c === k)).map((c) => [c, c])]
        : [...BASE_RESULTS, ...layout.codes.filter((c) => !BASE_RESULTS.some(([b]) => b === c)).map((c) => [c, c])];
    const plates = [...new Set(sheet.blocks.map((b) => b.plate).filter(Boolean))];
    return {
        rsc,
        risks: rsc ? await readRisk(book) : [],
        palette: rsc ? paletteOf(book, sheet.doc, styles) : [],
        adas: rsc && !!layout.adas,
        jobLabel: layout.jobLabel || '',
        // สีปุ่มบนเว็บตามหัวฟอร์ม (รหัสที่ไม่ได้อยู่ในกลุ่มคลัง/หน่วยงาน)
        colors: Object.fromEntries(legend.filter((x) => !x.kind && x.color).map((x) => [x.code, x.color])),
        groups: [['depot', 'คลังน้ำมัน', codesOf('depot')], ['unit', 'หน่วยงาน', codesOf('unit')]].filter((g) => g[2].length),
        hourly: true,
        units: await readUnits(book),
        // ฟอร์ม RSC 1 รายงาน = 1 วันปฏิทิน ครบ 24 ชม. ไม่แยกกะ
        shiftHours: rsc ? () => Array.from({ length: 24 }, (_, i) => i) : (shift) => hoursOf(layout, shift),
        results,
        vehicles: plates.map((scc) => ({ scc, plate: '', driver: '', risk: '' })),
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
    if (typeof val === 'boolean') {
        const v = doc.createElementNS(NS, 'v');
        v.textContent = val ? '1' : '0';
        cell.setAttribute('t', 'b');
        cell.appendChild(v);
        return;
    }
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
    const head = last.head || [];
    // ฟอร์ม RSC ไม่มีแถวคั่น: ชุดของคันหนึ่งคือแถวหัว + คู่แถว
    const source = [...head, ...last.rows, ...(!head.length && separator ? [separator] : [])].map((r) => r.cloneNode(true));
    const first = rowNum(source[0]);
    const end = first + source.length - 1;
    // ฟอร์ม RSC มีคำอธิบายท้ายตาราง: ยกออกก่อน แล้วเลื่อนลงไปต่อท้ายคันที่เพิ่ม
    const tail = [];
    if (head.length) {
        while (lastRow.nextElementSibling) tail.push(lastRow.parentNode.removeChild(lastRow.nextElementSibling));
    } else {
        while (separator?.nextSibling) separator.parentNode.removeChild(separator.nextSibling);
    }
    const shift = count * source.length;

    const merges = els(doc, 'mergeCells')[0];
    const own = [];
    for (const m of merges ? els(merges, 'mergeCell') : []) {
        const p = /^([A-Z]+)(\d+):([A-Z]+)(\d+)$/.exec(m.getAttribute('ref'));
        if (!p) continue;
        if (Number(p[2]) > end) {
            if (head.length) m.setAttribute('ref', p[1] + (Number(p[2]) + shift) + ':' + p[3] + (Number(p[4]) + shift));
            else merges.removeChild(m);
        }
        else if (Number(p[2]) >= first) own.push(p);
    }

    let at = end + 1;
    const added = [];
    for (let n = 0; n < count; n++) {
        const rows = source.map((original, i) => {
            const row = original.cloneNode(true);
            row.setAttribute('r', String(at + i));
            for (const c of els(row, 'c')) c.setAttribute('r', colOf(c) + (at + i));
            // สูตรของแถวที่คัดลอก (กลุ่มเสี่ยง) ต้องอ้างแถวของตัวเอง
            for (const f of els(row, 'f')) {
                f.textContent = f.textContent.replace(/\b([A-Z]{1,2})(\d+)\b/g, (ref, col, n) =>
                    (Number(n) >= first && Number(n) <= end ? col + (Number(n) - first + at) : ref));
                const value = els(f.parentNode, 'v')[0];
                if (value) f.parentNode.removeChild(value);
            }
            lastRow.parentNode.appendChild(row);
            return row;
        });
        for (const p of own) {
            const m = doc.createElementNS(NS, 'mergeCell');
            m.setAttribute('ref', p[1] + (Number(p[2]) - first + at) + ':' + p[3] + (Number(p[4]) - first + at));
            merges.appendChild(m);
        }
        added.push({ plate: '', rows: rows.slice(head.length, head.length + last.rows.length),
            ...(head.length ? { head: rows.slice(0, head.length) } : {}) });
        at += source.length;
    }
    for (const row of tail) {
        const n = rowNum(row) + shift;
        row.setAttribute('r', String(n));
        for (const c of els(row, 'c')) c.setAttribute('r', colOf(c) + n);
        lastRow.parentNode.appendChild(row);
        at = Math.max(at, n + 1);
    }
    merges?.setAttribute('count', String(merges.children.length));
    const dim = els(doc, 'dimension')[0];
    dim?.setAttribute('ref', dim.getAttribute('ref').replace(/\d+$/, String(at - 1)));
    return added;
}

const watched = (time) => (time ? Number(time.slice(0, 2)) + '.' + time.slice(3, 5) : '');
const used = (v) => !!(v.driver || v.trips.length || v.rounds.length);

/** "SC001 (2)", "SC025 DTC" → เบอร์รถจริง ใช้จับคู่ฟอร์ม RSC */
export const baseCar = (scc) => String(scc).replace(/\s*\(\d+\)$/, '').replace(/^(SC\s*\d{3})\s*(DTC|10W)$/i, '$1').replace(/\s+/g, '');
export const plainName = (name) => String(name || '').replace(/^\s*(นางสาว|น\.ส\.|นาย|นาง)/, '').replace(/\s+/g, '');

// คันเดียวมีได้หลายชุดแถว: จับคู่ด้วยชื่อ พขร. ก่อน ที่เหลือเรียงตามลำดับ
function assignBlocks(book, blocks, vehicles, driverCol) {
    const free = [...vehicles].sort((x, y) => x.scc.localeCompare(y.scc, undefined, { numeric: true }));
    const result = new Map();
    const take = (block, test) => {
        if (result.has(block) || !block.plate) return;
        const i = free.findIndex((v) => baseCar(v.scc) === baseCar(block.plate) && test(v));
        if (i >= 0) result.set(block, free.splice(i, 1)[0]);
    };
    for (const block of blocks) {
        const names = [0, 2].map((at) => plainName(book.value(cellAt(block.rows[at], driverCol)))).filter(Boolean);
        take(block, (v) => [v.driver, v.driver2].some((n) => names.includes(plainName(n))));
    }
    for (const block of blocks) take(block, used);
    for (const block of blocks) take(block, () => true);
    return result;
}

// คำอธิบายรหัสที่ลงสีไว้บนหัวฟอร์ม: [{ code, fill, kind }]
// kind ดูจากสี: ส้ม = คลังน้ำมัน, ฟ้า = หน่วยงาน (รหัสเดียวกันมีได้ทั้งสองสี)
const KINDS = { FF9900: 'depot', '4D93D9': 'unit' };

function legendOf(book, doc, styles) {
    const fills = els(els(styles, 'fills')[0], 'fill');
    const xfs = els(els(styles, 'cellXfs')[0], 'xf');
    const found = [];
    for (const row of els(doc, 'row')) {
        const texts = els(row, 'c').map((c) => [c, book.value(c).trim()]);
        if (texts.some(([, t]) => t === WATCH)) break;
        for (const [c, code] of texts) {
            if (!/^[A-Z][A-Z0-9]{0,7}$/.test(code)) continue;
            const fill = Number(xfs[Number(c.getAttribute('s') || 0)]?.getAttribute('fillId') || 0);
            const pattern = fills[fill] && els(fills[fill], 'patternFill')[0];
            const color = pattern?.getAttribute('patternType') === 'solid' && els(pattern, 'fgColor')[0];
            if (!color) continue;
            const rgb = (color.getAttribute('rgb') || '').slice(-6).toUpperCase();
            if (rgb ? rgb === 'FFFFFF' : color.getAttribute('theme') === '0') continue;
            found.push({ code, fill, kind: KINDS[rgb] || '', color: rgb ? '#' + rgb : '' });
        }
    }
    return found;
}

// ลงสีช่องผลการตรวจตามคำอธิบายหัวฟอร์ม (เช่น ช่อง C สีชมพู)
function painter(book, doc, styles) {
    const cellXfs = els(styles, 'cellXfs')[0];
    const xfs = els(cellXfs, 'xf');
    const legend = new Map(); // รหัส หรือ รหัส@kind -> fillId (ไม่ระบุ kind = อันแรกที่เจอ)
    for (const { code, fill, kind } of legendOf(book, doc, styles)) {
        if (!legend.has(code)) legend.set(code, fill);
        if (kind) legend.set(code + '@' + kind, fill);
    }

    const made = new Map(); // สไตล์เดิม:สี -> สไตล์ใหม่ (เส้นขอบ ฟอนต์ คงเดิม)
    // สีของตัวเลือกที่ผู้ใช้เก็บเอง: เพิ่มสีพื้นใหม่ในไฟล์
    const fills = els(styles, 'fills')[0];
    const custom = new Map();
    const fillOf = (color) => {
        if (!/^#[0-9a-f]{6}$/i.test(color || '')) return undefined;
        if (!custom.has(color)) {
            const make = (name) => styles.createElementNS(NS, name);
            const [node, pattern, front] = ['fill', 'patternFill', 'fgColor'].map(make);
            pattern.setAttribute('patternType', 'solid');
            front.setAttribute('rgb', 'FF' + color.slice(1).toUpperCase());
            pattern.appendChild(front);
            node.appendChild(pattern);
            fills.appendChild(node);
            const count = els(fills, 'fill').length;
            fills.setAttribute('count', String(count));
            custom.set(color, count - 1);
        }
        return custom.get(color);
    };
    return (cell, code, kind, color) => {
        const fill = fillOf(color) ?? legend.get(code + '@' + kind) ?? legend.get(/^C\d+$/.test(code) ? 'C' : code);
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

function fill(book, doc, layout, blocks, report, paint, driverCol) {
    const rsc = !!blocks[0].head;
    const comments = []; // สถานที่ของแต่ละช่อง (ฟอร์ม RSC ใส่เป็นคอมเมนต์)
    const data = new Map(report.vehicles.map((v) => [v.scc, v]));
    const have = new Set(blocks.map((b) => b.plate));
    const assigned = rsc ? assignBlocks(book, blocks, report.vehicles, driverCol) : null;
    const placed = new Set(assigned?.values());
    const waiting = report.vehicles.filter((v) => (rsc ? !placed.has(v) && used(v) : !have.has(v.scc) && (report.unitTitle || used(v))))
        .sort((x, y) => x.scc.localeCompare(y.scc, undefined, { numeric: true }));
    const slots = blocks.filter((b) => !b.plate);
    if (waiting.length > slots.length) {
        const added = appendBlocks(doc, blocks, waiting.length - slots.length);
        blocks.push(...added);
        slots.push(...added);
    }
    waiting.forEach((v, i) => {
        slots[i].plate = v.scc;
        slots[i].added = true;
        assigned?.set(slots[i], v);
    });

    // ช่องชั่วโมง: ผังตายตัวใช้ตามหัวตาราง ผังเรียงตามกะต้องเขียนหัวตารางใหม่
    const hours = hoursOf(layout, report.shift);
    const row = (n) => els(doc, 'row').find((r) => rowNum(r) === n);
    const column = new Map(layout.fixed
        ? layout.hourCells.map((x) => [Number(x.text) % 24, x.col])
        : layout.hourCells.map((x, i) => [hours[i], x.col]));
    if (!layout.fixed) layout.hourCells.forEach((x, i) => setCell(doc, row(layout.hourRow), x.col, hours[i]));

    const clear = [driverCol, layout.status, layout.rest, layout.route, layout.jobTime, ...layout.trips,
        ...layout.hourCells.map((x) => x.col)].filter(Boolean);
    // หมายเหตุลงคอลัมน์ว่างถัดจากตาราง
    const noteCol = (rsc && layout.abnormal) || colName(Math.max(...layout.hourCells.map((x) => colNum(x.col))) + (layout.fixed ? 2 : 1));
    const written = new Set();
    blocks.forEach((block, index) => {
        const { plate, rows, head } = block;
        // คันเดียวกันที่มีสองชุดในฟอร์ม ลงเฉพาะชุดแรก
        const v = (rsc ? assigned.get(block) : !written.has(plate) && data.get(plate)) || { trips: [], rounds: [] };
        written.add(plate);
        const top = head?.[0] || rows[0];
        const before = new Map(); // ผลเดิมในช่อง ใช้ดูว่าต้องลงสีใหม่ไหม
        if (rsc && !block.added) {
            for (const r of rows) for (const x of layout.hourCells) before.set(rowNum(r) + x.col, textOf(book, r, x.col));
        }
        for (const r of [...(head || []), ...rows]) {
            // รูธบรรทัดที่สอง (แถวผลการตรวจ) ของชุดเดิมคงไว้
            const second = rsc && !block.added && (r === rows[1] || r === rows[3]);
            for (const col of clear) if (!(second && col === layout.route)) setCell(doc, r, col, '');
            if (rsc) setCell(doc, r, noteCol, '');
        }
        if (layout.fixed && !rsc) setCell(doc, rows[0], 'AI', '');
        const no = /^SCC(\d+)$/.exec(plate);
        // ฟอร์ม RSC: ชุดแถวเดิมคงเบอร์รถและลำดับของไฟล์ไว้ เขียนเฉพาะชุดที่เพิ่ม ("SC001 (2)" เขียนเป็น SC001)
        if (!rsc || block.added) {
            setCell(doc, top, layout.car, no ? Number(no[1]) : rsc ? plate.replace(/ \(\d+\)$/, '') : plate);
            if (layout.number) setCell(doc, top, layout.number, plate ? index + 1 : '');
        }
        const mark = (s) => (s === 'ปกติ' ? 'OK' : s === 'ไม่ปกติ' ? 'NG' : '');
        // ฟอร์ม RSC เป็นช่องติ๊ก: ยังไม่ได้เลือกให้คงค่าของฟอร์มไว้
        for (const [col, state] of [[layout.gps, v.gps], [layout.cctv, v.cctv], [rsc && layout.adas, v.adas]]) {
            if (!col) continue;
            if (!rsc) setCell(doc, top, col, mark(state));
            else if (state) setCell(doc, top, col, state === 'ปกติ');
        }
        setCell(doc, rows[0], driverCol, v.driver || '');
        setCell(doc, rows[2], driverCol, v.driver2 || '');
        setCell(doc, rows[4], driverCol, v.driver3 || '');
        if (rsc) {
            [['route', 'jobTime', 0], ['route2', 'jobTime2', 2]].forEach(([route, time, at]) => {
                if (layout.route) setCell(doc, rows[at], layout.route, v[route] || '');
                if (layout.jobTime) setCell(doc, rows[at], layout.jobTime, v[time] || '');
            });
        }
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

        const notes = rsc && v.abnormal ? [v.abnormal] : []; // ของคนก่อนหน้ามาก่อน
        for (const r of v.rounds) {
            const at = ((r.who || 1) - 1) * 2; // พขร. คนละคู่แถว
            const col = column.get(r.hour);
            if (!col || !rows[at + 1]) continue;
            const time = watched(r.time);
            setCell(doc, rows[at], col, rsc && time ? Number(time) : time); // ฟอร์ม RSC เก็บเวลาเป็นตัวเลข
            setCell(doc, rows[at + 1], col, r.place || '');
            if (before.get(rowNum(rows[at + 1]) + col) !== (r.place || '')) paint(cellAt(rows[at + 1], col), r.place || '', r.group, r.color);
            const text = r.note && r.hour + ' น. ' + r.note;
            if (text && !String(v.abnormal || '').includes(text)) notes.push(text);
            if (rsc && r.detail) comments.push({ ref: col + rowNum(rows[at + 1]), text: r.detail });
        }
        setCell(doc, rsc ? top : rows[0], noteCol, notes.join(' / '));
    });

    if (rsc) {
        // ฟอร์ม RSC ไม่มีช่องวันที่ (ใช้ชื่อแท็บ) มีแค่ชื่อผู้ Monitor ของกะ
        const at = layout.monitors[report.shift === 'night' ? 'night' : 'day'];
        const name = report.monitor || report.checker;
        if (at && name) setCell(doc, row(at.row), at.col, name);
        return comments;
    }

    if (report.unitTitle && layout.heading) setCell(doc, row(layout.heading.row), layout.heading.col, report.unitTitle);
    const [y, m, d] = report.date.split('-').map(Number);
    const { date, shift, monitor } = layout.title;
    const put = (at, val) => { if (at) setCell(doc, row(at.row), at.col, val); };
    // บางฟอร์มเก็บปีเป็น พ.ศ. ในเซลล์วันที่ ใช้แบบเดียวกับของเดิม
    const buddhist = Number(book.value(cellAt(row(date.row), date.col))) > 150000;
    put(date, (Date.UTC(y + (buddhist ? 543 : 0), m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000);
    put(shift, report.shift === 'night' ? 'กะกลางคืน 20.00 น. - 08.00 น.' : 'กะกลางวัน 08.00 น. - 20.00 น.');
    put(monitor, report.monitor || report.checker || '');
    return comments;
}

const escapeXml = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ใส่คอมเมนต์ลงชีต (แทนของเดิมของชีตนั้น): ไฟล์ comments + vmlDrawing + ความสัมพันธ์ + ชนิดไฟล์
async function writeComments(book, path, doc, list) {
    const relsPath = path.replace(/([^/]+)$/, '_rels/$1.rels');
    let rels = (await book.zip.file(relsPath)?.async('string')) ||
        '<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"></Relationships>';
    rels = rels.replace(/<Relationships([^>]*)\/>/, '<Relationships$1></Relationships>')
        .replace(/<Relationship\b[^>]*\/(comments|vmlDrawing|threadedComment)"[^>]*\/>/g, '');
    for (const old of els(doc, 'legacyDrawing')) old.parentNode.removeChild(old);
    if (list.length) {
        const BASE = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships/';
        rels = rels.replace('</Relationships>',
            '<Relationship Id="rIdBbsC" Type="' + BASE + 'comments" Target="/xl/comments_bbs.xml"/>' +
            '<Relationship Id="rIdBbsV" Type="' + BASE + 'vmlDrawing" Target="/xl/drawings/vmlDrawing_bbs.vml"/></Relationships>');
        book.zip.file('xl/comments_bbs.xml', '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
            '<comments xmlns="' + NS + '"><authors><author>BBS</author></authors><commentList>' +
            list.map((c) => '<comment ref="' + c.ref + '" authorId="0"><text><t xml:space="preserve">' + escapeXml(c.text) +
                '</t></text></comment>').join('') + '</commentList></comments>');
        const shapes = list.map((c, i) => {
            const [, col, line] = /^([A-Z]+)(\d+)$/.exec(c.ref);
            return '<v:shape id="_x0000_s' + (2049 + i) + '" type="#_x0000_t202" style="position:absolute;width:160pt;height:48pt;visibility:hidden" fillcolor="#ffffe1" o:insetmode="auto">' +
                '<v:textbox/><x:ClientData ObjectType="Note"><x:MoveWithCells/><x:SizeWithCells/><x:AutoFill>False</x:AutoFill>' +
                '<x:Row>' + (Number(line) - 1) + '</x:Row><x:Column>' + (colNum(col) - 1) + '</x:Column></x:ClientData></v:shape>';
        }).join('');
        book.zip.file('xl/drawings/vmlDrawing_bbs.vml', '<xml xmlns:v="urn:schemas-microsoft-com:vml" xmlns:o="urn:schemas-microsoft-com:office:office" xmlns:x="urn:schemas-microsoft-com:office:excel">' +
            '<o:shapelayout v:ext="edit"><o:idmap v:ext="edit" data="2"/></o:shapelayout>' +
            '<v:shapetype id="_x0000_t202" coordsize="21600,21600" o:spt="202" path="m,l,21600r21600,l21600,xe"><v:stroke joinstyle="miter"/><v:path gradientshapeok="t" o:connecttype="rect"/></v:shapetype>' +
            shapes + '</xml>');

        const legacy = doc.createElementNS(NS, 'legacyDrawing');
        legacy.setAttributeNS('http://schemas.openxmlformats.org/officeDocument/2006/relationships', 'r:id', 'rIdBbsV');
        const later = ['legacyDrawingHF', 'picture', 'oleObjects', 'controls', 'webPublishItems', 'tableParts', 'extLst'];
        const next = Array.from(doc.documentElement.children).find((n) => later.includes(n.localName));
        doc.documentElement.insertBefore(legacy, next || null);

        let types = await book.zip.file('[Content_Types].xml').async('string');
        if (!/Extension="vml"/i.test(types)) {
            types = types.replace('</Types>', '<Default Extension="vml" ContentType="application/vnd.openxmlformats-officedocument.vmlDrawing"/></Types>');
        }
        types = types.replace(/<Override[^>]*comments_bbs\.xml"[^>]*\/>/g, '');
        types = types.replace('</Types>', '<Override PartName="/xl/comments_bbs.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.comments+xml"/></Types>');
        book.zip.file('[Content_Types].xml', types);
    }
    book.zip.file(relsPath, rels);
}

// ไฟล์รายเดือน: เหลือชีตเดียว (วันของรายงาน) ลบชีตอื่นออกจากไฟล์
async function keepOnly(book, keepName, newName, drop = () => true) {
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
        if (!drop(sheet.getAttribute('name'))) continue;
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

// แท็บวันที่ระบุในรายงานของคนก่อนหน้า (ใช้เป็นต้นแบบ จะได้ลำดับและรูปแบบเดิม)
async function dayTab(book, day) {
    const name = (await sheetNames(book)).find((n) => /^\s*\d{1,2}\s*$/.test(n) && Number(n) === day);
    if (!name) return null;
    const path = await sheetPathOf(book, name);
    const doc = await book.read(path);
    const layout = readLayout(book, doc);
    const blocks = layout ? findBlocks(book, doc, layout) : [];
    return blocks[0]?.head ? { name, path, doc, layout, blocks } : null;
}

export async function buildHourly(buffer, report, { prior } = {}) {
    let book = prior ? await openBook(prior) : null;
    let sheet = book ? await dayTab(book, Number(report.date.slice(8))) : null;
    if (!sheet) {
        book = await openBook(buffer);
        sheet = await pickSheet(book);
    }
    if (!sheet) throw new Error('ไม่พบตารางรายชั่วโมงในฟอร์ม');
    const styles = await book.read('xl/styles.xml');
    const rsc = !!sheet.blocks[0].head;
    const comments = fill(book, sheet.doc, sheet.layout, sheet.blocks, report, painter(book, sheet.doc, styles), nameColumn(sheet));
    if (rsc) await writeComments(book, sheet.path, sheet.doc, comments);
    book.zip.file('xl/styles.xml', new XMLSerializer().serializeToString(styles));
    // ฟอร์มที่แยกมาจากไฟล์อื่นมีรายการเลือกที่ลิงก์เสีย (#REF!) ติดมา ทำให้ Excel เปิดไฟล์ไม่ได้
    const xml = new XMLSerializer().serializeToString(sheet.doc)
        .replace(/<x14:dataValidation[ >](?:(?!<\/x14:dataValidation>)[\s\S])*?#REF![\s\S]*?<\/x14:dataValidation>/g, '')
        .replace(/<ext [^>]*>\s*<x14:dataValidations [^>]*>\s*<\/x14:dataValidations>\s*<\/ext>/g, '')
        .replace(/<extLst>\s*<\/extLst>|<extLst\/>/g, '');
    book.zip.file(sheet.path, xml);
    if (!rsc && /^\d{1,2}$/.test(sheet.name.trim())) await keepOnly(book, sheet.name, report.date.slice(8));
    if (rsc) {
        // เก็บชีตอ้างอิง (สูตรกลุ่มเสี่ยงใช้) ลบแท็บวันอื่น แล้วเปลี่ยน "ฟอร์ม" เป็นวันของรายงาน
        await keepOnly(book, sheet.name, report.date.slice(8), (name) => /^\d{1,2}$/.test(name.trim()) || BLANK.test(name.trim()));
        // สูตรกลุ่มเสี่ยงมีค่าเก่าค้าง ให้ Excel คำนวณใหม่ตอนเปิด
        const wb = await book.read('xl/workbook.xml');
        const calc = els(wb, 'calcPr')[0];
        calc?.setAttribute('fullCalcOnLoad', '1');
        // keepOnly เขียน workbook.xml ใหม่แล้ว อ่านจากไฟล์ใน zip อีกรอบก่อนแก้
        book.zip.file('xl/workbook.xml', new XMLSerializer().serializeToString(wb));
    }
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
