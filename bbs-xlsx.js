// อ่าน/เขียนฟอร์ม BBS (.xlsx) โดยแก้เฉพาะค่าในช่องของ XML เดิม — สี เส้น โลโก้ และชีตอื่นไม่ถูกแตะ
// ต้องมี JSZip โหลดไว้ก่อน (window.JSZip)

const NS = 'http://schemas.openxmlformats.org/spreadsheetml/2006/main';
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
        if (cell.getAttribute('t') === 's') return strings[Number(v.textContent)] || '';
        // บางโปรแกรม (เช่น บันทึกผ่าน Google) เก็บเลขจำนวนเต็มเป็น "1.0" — เบอร์รถและเลขลำดับต้องอ่านได้เหมือนกัน
        return v.textContent.replace(/^(-?\d+)\.0+$/, '$1');
    };

    // สีพื้นและเส้นซ้ายของแต่ละ style ใช้ดูว่าแถวไหนอยู่ในตารางและแถวไหนคือแถวคั่น
    const styles = await read('xl/styles.xml');
    const list = (name, child) => Array.from(els(styles, name)[0].children).filter((n) => n.localName === child);
    const fills = list('fills', 'fill').map((f) => {
        const pattern = els(f, 'patternFill')[0];
        const fg = els(f, 'fgColor')[0];
        if (!pattern || pattern.getAttribute('patternType') !== 'solid' || !fg) return '';
        return fg.getAttribute('rgb')?.slice(-6) ||
            'theme' + fg.getAttribute('theme') + ' ' + (fg.getAttribute('tint') || '');
    });
    const borders = list('borders', 'border').map((x) => !!els(x, 'left')[0]?.getAttribute('style'));
    const xfs = list('cellXfs', 'xf');
    const look = (cell) => {
        const xf = xfs[Number(cell?.getAttribute('s') || 0)];
        return {
            fill: fills[Number(xf?.getAttribute('fillId'))] || '',
            border: !!borders[Number(xf?.getAttribute('borderId'))]
        };
    };

    return { zip, read, sheetPath, value, look };
}

const cellAt = (row, col) => els(row, 'c').find((c) => colOf(c) === col);

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
    const empty = val === '' || val === null || val === undefined;
    if (empty && els(cell, 'f').length) return;
    clearCell(cell);
    if (empty) return;
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

// เบอร์รถในคอลัมน์ B: ฟอร์มจริงเก็บเป็นตัวเลข (6707) บางช่องเป็นข้อความ (SCC9715)
export function sccOf(text) {
    const m = /^(SCC)?\s*(\d{3,5})(\s*S)?$/i.exec(String(text).trim());
    return m ? 'SCC' + m[2] : '';
}

// กลุ่มแถวของรถ 1 คัน: เริ่มที่แถวมีเบอร์รถ จนถึงแถวคั่น (มีสี) คันถัดไป หรือสุดตาราง (ไม่มีเส้น)
// ไม่พึ่งสีของช่องกรอก เพราะแต่ละฟอร์มลงสีไม่เหมือนกัน
function findBlocks(book, doc) {
    const neutral = (fill) => !fill || fill === 'FFFFFF' || fill.startsWith('theme0 ');
    const blocks = [];
    let current = null;
    let startFill = '';
    for (const row of els(doc, 'row')) {
        if (rowNum(row) < 7) continue;
        const { fill, border } = book.look(cellAt(row, 'C'));
        const b = book.value(cellAt(row, 'B')).trim();
        const slot = !b && /^\d{1,3}$/.test(book.value(cellAt(row, 'A')).trim());
        if (border && (sccOf(b) || slot)) {
            blocks.push(current = [row]);
            startFill = fill;
        } else if (current && border && (neutral(fill) || fill === startFill) &&
            rowNum(row) === rowNum(current[current.length - 1]) + 1) {
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
    const blocks = findBlocks(book, doc);
    const vehicles = blocks.map((rows) => ({
        scc: sccOf(text(rows[0], 'B')),
        plate: text(rows[1], 'B'),
        driver: text(rows[0], 'E'),
        risk: text(rows[1], 'E')
    })).filter((v) => v.scc);
    if (!blocks.length) throw new Error('ไม่พบแถวรถในฟอร์ม (คอลัมน์ B ต้องเป็นเบอร์รถ หรือมีเลขลำดับเป็นช่องว่าง)');

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
    const [hh, mm, ss = 0] = time.split(':').map(Number);
    let serial = (Date.UTC(y, m - 1, d) - Date.UTC(1899, 11, 30)) / 86400000;
    if (shift === 'night' && hh < 12) serial += 1;
    return serial + (hh * 3600 + mm * 60 + ss) / 86400;
}

// style ใหม่ที่ได้จากของเดิมของช่อง (เส้น สีพื้น การจัดวางเหมือนเดิม) เปลี่ยนเฉพาะฟอนต์หรือรูปแบบตัวเลข
const SYMBOL_FONT = 'Segoe UI Symbol'; // มีใน Windows ทุกเครื่อง ไม่ต้องพึ่ง Wingdings 2
const MARKS = { P: '✓', O: '✗' };
const TIME_FORMAT = 'dd/mm/yyyy\\ hh:mm:ss';
const BLACK = 'FF000000';
const RED = 'FFFF0000'; // เฉพาะรอบที่พบความผิด

async function styler(book) {
    const styles = await book.read('xl/styles.xml');
    const part = (name) => els(styles, name)[0];
    const items = (name, child) => Array.from(part(name).children).filter((n) => n.localName === child);
    const add = (name, node) => {
        part(name).appendChild(node);
        part(name).setAttribute('count', String(part(name).children.length));
        return part(name).children.length - 1;
    };
    const made = new Map();
    const once = (key, build) => {
        if (!made.has(key)) made.set(key, build());
        return made.get(key);
    };
    let changed = false;

    const timeFormat = () => once('numFmt', () => {
        if (!part('numFmts')) {
            const list = styles.createElementNS(NS, 'numFmts');
            styles.documentElement.insertBefore(list, styles.documentElement.firstChild);
        }
        const id = Math.max(163, ...els(part('numFmts'), 'numFmt').map((n) => Number(n.getAttribute('numFmtId')))) + 1;
        const format = styles.createElementNS(NS, 'numFmt');
        format.setAttribute('numFmtId', String(id));
        format.setAttribute('formatCode', TIME_FORMAT);
        add('numFmts', format);
        return id;
    });

    const symbolFont = (fontId) => once('font ' + fontId, () => {
        const font = items('fonts', 'font')[fontId].cloneNode(true);
        for (const child of Array.from(font.children)) {
            if (['name', 'charset', 'family', 'scheme'].includes(child.localName)) font.removeChild(child);
        }
        const name = styles.createElementNS(NS, 'name');
        name.setAttribute('val', SYMBOL_FONT);
        font.appendChild(name);
        return add('fonts', font);
    });

    const xfOf = (cell) => items('cellXfs', 'xf')[Number(cell?.getAttribute('s') || 0)];

    // ฟอนต์เดิมของช่อง เปลี่ยนแค่สี
    const colored = (fontId, rgb) => once('color ' + fontId + ' ' + rgb, () => {
        const font = items('fonts', 'font')[fontId].cloneNode(true);
        for (const child of Array.from(font.children)) if (child.localName === 'color') font.removeChild(child);
        const color = styles.createElementNS(NS, 'color');
        color.setAttribute('rgb', rgb);
        font.appendChild(color);
        return add('fonts', font);
    });

    function restyle(cell, set) {
        const s = Number(cell.getAttribute('s') || 0);
        const key = 'xf ' + s + ' ' + JSON.stringify(set);
        const id = once(key, () => {
            const copy = items('cellXfs', 'xf')[s].cloneNode(true);
            for (const [name, value] of Object.entries(set)) {
                copy.setAttribute(name, String(value));
                copy.setAttribute('apply' + (name === 'fontId' ? 'Font' : 'NumberFormat'), '1');
            }
            return add('cellXfs', copy);
        });
        cell.setAttribute('s', String(id));
        changed = true;
    }

    return {
        color: (cell, rgb) => restyle(cell, { fontId: colored(Number(xfOf(cell).getAttribute('fontId') || 0), rgb) }),
        time: (cell) => restyle(cell, { numFmtId: timeFormat() }),
        symbol: (cell) => restyle(cell, { fontId: symbolFont(Number(xfOf(cell).getAttribute('fontId') || 0)) }),
        sameFont: (cell, like) => {
            if (like) restyle(cell, { fontId: Number(xfOf(like).getAttribute('fontId') || 0) });
        },
        save() {
            if (changed) book.zip.file('xl/styles.xml', toXml(styles));
        }
    };
}

// ขยายคอลัมน์ให้พอแสดงข้อความ (ไม่งั้น Excel ขึ้น ####) กว้างอยู่แล้วไม่แตะ
function widen(doc, index, width) {
    for (const col of els(doc, 'col')) {
        const min = Number(col.getAttribute('min'));
        const max = Number(col.getAttribute('max'));
        if (index < min || index > max || Number(col.getAttribute('width')) >= width) continue;
        const piece = (from, to) => {
            const copy = col.cloneNode(true);
            copy.setAttribute('min', String(from));
            copy.setAttribute('max', String(to));
            return copy;
        };
        if (min < index) col.parentNode.insertBefore(piece(min, index - 1), col);
        if (max > index) col.parentNode.insertBefore(piece(index + 1, max), col.nextSibling);
        col.setAttribute('min', String(index));
        col.setAttribute('max', String(index));
        col.setAttribute('width', String(width));
        col.setAttribute('customWidth', '1');
        return;
    }
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

function fillReport(book, doc, report, style) {
    markGaps(doc);
    const sheetData = els(doc, 'sheetData')[0];
    let blocks = findBlocks(book, doc);
    const byScc = new Map();
    const slots = []; // ช่องว่างรอใส่รถ
    for (const rows of blocks) {
        const scc = sccOf(book.value(cellAt(rows[0], 'B')));
        if (scc) byScc.set(scc, rows);
        else slots.push(rows);
    }

    // รถที่ไม่มีในฟอร์ม: คัดลอกแถวคั่น + ชุดแถวของคันสุดท้ายต่อท้าย
    let number = Math.max(0, ...blocks.map((rows) => Number(book.value(cellAt(rows[0], 'A'))) || 0));
    for (const v of report.vehicles) {
        // รถที่ไม่มีในฟอร์มและไม่มีข้อมูลอะไร ไม่ต้องกินช่อง
        if (byScc.has(v.scc) || !(v.driver || v.trips.length || v.rounds.length)) continue;
        const slot = slots.shift();
        if (slot) {
            setCell(doc, slot[0], 'B', v.scc);
            if (slot[1]) setCell(doc, slot[1], 'B', v.plate || '');
            byScc.set(v.scc, slot);
            continue;
        }
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
        const extra = v.extra || []; // แผนเปลี่ยน/ยกเลิกงาน ลงคอลัมน์รายละเอียดพฤติกรรม
        const need = Math.max(v.trips.length, v.rounds.length, extra.length, 2);
        // ข้อมูลเกินแถวของฟอร์ม → แทรกแถวใหม่ (รูปแบบเดียวกัน) ก่อนแถวสุดท้ายของคันนั้น
        // คันที่มีแค่ 2 แถวต้องต่อท้าย ไม่งั้นทะเบียน (แถวที่ 2) จะถูกดันลงไปล่างสุด
        const append = rows.length < 3;
        while (rows.length < need) {
            const source = rows[append ? rows.length - 1 : rows.length - 2];
            const extra = cloneRow(source);
            for (const c of els(extra, 'c')) if (colNum(colOf(c)) <= 2) clearCell(c);
            const at = append ? rows.length : rows.length - 1;
            sheetData.insertBefore(extra, append ? rows[rows.length - 1].nextSibling : rows[at]);
            rows.splice(at, 0, extra);
        }
        rows.forEach((row) => {
            for (const c of els(row, 'c')) {
                const n = colNum(colOf(c));
                if (n >= 3 && n <= colNum('AP') && !els(c, 'f').length) clearCell(c);
            }
        });
        if (v.driver || v.rounds.length || v.trips.length) used++;
        setCell(doc, rows[0], 'C', v.gps || '');
        setCell(doc, rows[0], 'D', v.cctv || '');
        if (v.idle) setCell(doc, rows[0], 'H', 'ไม่มีวิ่งงาน'); // ช่องชื่อลูกค้า
        // ช่องสถานะ GPS/CCTV ใช้ฟอนต์เดียวกับช่องข้อความอื่นในแถว
        for (const col of ['C', 'D']) style.sameFont(cellAt(rows[0], col), cellAt(rows[0], 'J'));
        setCell(doc, rows[0], 'E', v.driver || '');
        if (rows[1]) setCell(doc, rows[1], 'E', v.risk || '');
        v.trips.forEach((t, i) => {
            setCell(doc, rows[i], 'F', t.ship || '');
            setCell(doc, rows[i], 'G', t.custId || '');
            setCell(doc, rows[i], 'H', t.cust || '');
        });
        v.rounds.forEach((r, i) => {
            setCell(doc, rows[i], 'I', excelTime(report.date, r.time, report.shift));
            if (r.time) style.time(cellAt(rows[i], 'I'));
            setCell(doc, rows[i], 'J', r.place || '');
            for (const [col, mark] of Object.entries(r.marks || {})) {
                setCell(doc, rows[i], col, MARKS[mark] || mark);
                if (MARKS[mark]) style.symbol(cellAt(rows[i], col));
            }
            setCell(doc, rows[i], 'AP', r.note || '');
        });
        extra.forEach((text, i) => {
            setCell(doc, rows[i], 'AP', [v.rounds[i]?.note, text].filter(Boolean).join(' / '));
        });
    }

    // ข้อมูลในแถวรถเป็นสีดำทั้งหมด (ไม่ติดสีไฮไลต์เดิมของฟอร์ม) รอบที่มีความผิด: เวลาและ ✗ เป็นสีแดง
    for (const [scc, rows] of byScc) {
        const rounds = data.get(scc)?.rounds || [];
        rows.forEach((line, i) => {
            const bad = Object.values(rounds[i]?.marks || {}).includes('O');
            for (const c of els(line, 'c')) {
                if (colNum(colOf(c)) > colNum('AP') || els(c, 'f').length || !book.value(c)) continue;
                const mark = colNum(colOf(c)) >= colNum('K') && book.value(c) === MARKS.O;
                style.color(c, bad && (colOf(c) === 'I' || mark) ? RED : BLACK);
            }
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

    // คำอธิบายสัญลักษณ์หัวฟอร์ม (คอลัมน์ A) ให้ตรงกับเครื่องหมายที่เขียนลงตาราง
    for (const n of [3, 4]) {
        const cell = row(n) && cellAt(row(n), 'A');
        const mark = cell && MARKS[book.value(cell).trim()];
        if (!mark) continue;
        setCell(doc, row(n), 'A', mark);
        style.symbol(cellAt(row(n), 'A'));
    }
    widen(doc, colNum('I'), 22);

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
function fillSummary(book, doc, report, style) {
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
    const all = els(doc, 'row');
    const header = all.findIndex((r) => book.value(cellAt(r, 'A')).trim() === 'ลำดับ');
    if (header < 0) return;
    const rows = all.slice(header + 1).filter((r) => /^\d+$/.test(book.value(cellAt(r, 'A'))));
    if (!rows.length) return;
    const first = rows[0];
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
        const bad = item && Object.values(item.r.marks || {}).includes('O');
        for (const c of els(target, 'c')) if (book.value(c)) style.color(c, bad && colOf(c) === 'D' ? RED : BLACK);
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
    const style = await styler(book);
    for (const [part, fill] of [['ผ่าน_cctv', fillReport], ['ชมเชย', fillSummary]]) {
        const path = book.sheetPath(part);
        const doc = await book.read(path);
        fill(book, doc, report, style);
        book.zip.file(path, toXml(doc));
    }
    style.save();
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
