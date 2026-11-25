// แปลงชีตรายงานในไฟล์ต้นแบบเป็นข้อมูลสำหรับวาดบนหน้าเว็บ (สี เส้น ฟอนต์ ความกว้าง โลโก้ ตามไฟล์จริง)
import { openBook, findBlocks, colName, els, cellAt, colOf, rowNum } from './bbs-xlsx.js?v=2';

const LAST_COL = 42; // AP
const colNum = (s) => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const first = (node, name) => (node ? els(node, name)[0] : undefined);
const child = (node, name) => (node ? Array.from(node.children).find((c) => c.localName === name) : undefined);

// สัญลักษณ์ในฟอนต์ Wingdings 2 ที่ฟอร์มใช้
const SYMBOLS = { P: '✓', O: '✗', '¢': '■' };

function themeColors(xml) {
    const scheme = xml.getElementsByTagName('a:clrScheme')[0];
    const list = Array.from(scheme ? scheme.children : []).map((n) => {
        const v = n.firstElementChild;
        return v ? v.getAttribute('lastClr') || v.getAttribute('val') : '000000';
    });
    // Excel นับสีธีม 0-3 สลับคู่กับลำดับในไฟล์
    return [list[1], list[0], list[3], list[2], ...list.slice(4)];
}

const INDEXED = { 8: '000000', 9: 'FFFFFF', 10: 'FF0000', 11: '00FF00', 12: '0000FF', 13: 'FFFF00', 17: '008000', 22: 'C0C0C0', 30: '0066CC', 48: '3366FF', 64: '000000' };

function color(node, theme) {
    if (!node) return '';
    let hex = '';
    if (node.getAttribute('rgb')) hex = node.getAttribute('rgb').slice(-6);
    else if (node.getAttribute('theme') !== null) hex = theme[Number(node.getAttribute('theme'))] || '';
    else if (node.getAttribute('indexed') !== null) hex = INDEXED[node.getAttribute('indexed')] || '';
    if (!/^[0-9a-f]{6}$/i.test(hex)) return '';
    const tint = Number(node.getAttribute('tint') || 0);
    const rgb = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16))
        .map((c) => Math.round(tint > 0 ? c + (255 - c) * tint : c * (1 + tint)));
    return 'rgb(' + rgb.join(',') + ')';
}

function fontCss(font, theme) {
    if (!font) return {};
    const size = Number(first(font, 'sz')?.getAttribute('val') || 11);
    const c = color(first(font, 'color'), theme);
    return {
        symbol: /wingdings/i.test((first(font, 'name') || first(font, 'rFont'))?.getAttribute('val') || ''),
        css: 'font-size:' + (size * 1.15).toFixed(1) + 'px;' +
            (first(font, 'b') ? 'font-weight:700;' : '') +
            (first(font, 'i') ? 'font-style:italic;' : '') +
            (c ? 'color:' + c + ';' : '')
    };
}

function readStyles(xml, theme) {
    const list = (parent, name) => Array.from(first(xml, parent).children).filter((n) => n.localName === name);
    const fonts = list('fonts', 'font');
    const fills = list('fills', 'fill');
    const borders = list('borders', 'border');
    return list('cellXfs', 'xf').map((xf) => {
        const font = fontCss(fonts[Number(xf.getAttribute('fontId'))], theme);
        const pattern = first(fills[Number(xf.getAttribute('fillId'))], 'patternFill');
        const bg = pattern && pattern.getAttribute('patternType') === 'solid' ? color(first(pattern, 'fgColor'), theme) : '';
        const border = borders[Number(xf.getAttribute('borderId'))];
        const side = (name) => {
            const n = child(border, name);
            const style = n?.getAttribute('style');
            if (!style) return '';
            const width = /thick|double/.test(style) ? 3 : /medium/.test(style) ? 2 : 1;
            return width + 'px solid ' + (color(first(n, 'color'), theme) || '#000');
        };
        const align = first(xf, 'alignment');
        const h = align?.getAttribute('horizontal') || '';
        const v = align?.getAttribute('vertical') || 'bottom';
        return {
            symbol: !!font.symbol,
            wrap: align?.getAttribute('wrapText') === '1',
            align: h === 'center' || h === 'centerContinuous' ? 'center' : h === 'right' ? 'right' : 'left',
            valign: v === 'center' ? 'middle' : v,
            bg,
            css: font.css || '',
            left: side('left'), right: side('right'), top: side('top'), bottom: side('bottom')
        };
    });
}

async function readLogo(book, sheetPath, widths, heights) {
    const relsPath = (path) => path.replace(/([^/]+)$/, '_rels/$1.rels');
    const targets = async (path) => {
        if (!book.zip.file(relsPath(path))) return {};
        const xml = await book.read(relsPath(path));
        return Object.fromEntries(Array.from(xml.getElementsByTagName('Relationship'))
            .map((r) => [r.getAttribute('Id'), 'xl/' + r.getAttribute('Target').replace(/^(\.\.\/|\/xl\/)/, '')]));
    };
    const drawingPath = Object.values(await targets(sheetPath)).find((t) => /drawing\d+\.xml$/.test(t));
    if (!drawingPath) return [];
    const drawing = await book.read(drawingPath);
    const media = await targets(drawingPath);
    const NS_R = 'http://schemas.openxmlformats.org/officeDocument/2006/relationships';
    const num = (node, name) => Number(node?.getElementsByTagName('xdr:' + name)[0]?.textContent || 0);
    const images = [];
    for (const anchor of Array.from(drawing.documentElement.children)) {
        const blip = anchor.getElementsByTagName('a:blip')[0];
        const from = anchor.getElementsByTagName('xdr:from')[0];
        const path = blip && media[blip.getAttributeNS(NS_R, 'embed')];
        if (!path || !from || !book.zip.file(path)) continue;
        const sum = (list, n) => list.slice(0, n).reduce((a, b) => a + b, 0);
        const pos = (mark) => ({
            x: sum(widths, num(mark, 'col')) + num(mark, 'colOff') / 9525,
            y: sum(heights, num(mark, 'row')) + num(mark, 'rowOff') / 9525
        });
        const a = pos(from);
        const to = anchor.getElementsByTagName('xdr:to')[0];
        const ext = anchor.getElementsByTagName('xdr:ext')[0];
        const b = to ? pos(to) : { x: a.x + Number(ext?.getAttribute('cx') || 0) / 9525, y: a.y + Number(ext?.getAttribute('cy') || 0) / 9525 };
        images.push({
            x: a.x, y: a.y, width: b.x - a.x, height: b.y - a.y,
            src: 'data:image/' + path.split('.').pop() + ';base64,' + await book.zip.file(path).async('base64')
        });
    }
    return images;
}

/**
 * @returns {Promise<{widths:number[], hidden:boolean[], styles:object[], head:object[], footer:object[],
 *   blocks:Map<string,{separator:object, rows:object[]}>, merges:object[], images:object[]}>}
 */
export async function readLayout(buffer) {
    const book = await openBook(buffer);
    const path = book.sheetPath('ผ่าน_cctv');
    const doc = await book.read(path);
    const theme = themeColors(await book.read('xl/theme/theme1.xml'));
    const styles = readStyles(await book.read('xl/styles.xml'), theme);

    const defaultWidth = Number(first(doc, 'sheetFormatPr')?.getAttribute('defaultColWidth') || 9);
    const widths = Array(LAST_COL).fill(Math.round(defaultWidth * 7 + 5));
    const hidden = Array(LAST_COL).fill(false);
    for (const col of els(doc, 'col')) {
        for (let i = Number(col.getAttribute('min')); i <= Math.min(Number(col.getAttribute('max')), LAST_COL); i++) {
            widths[i - 1] = Math.round(Number(col.getAttribute('width')) * 7 + 5);
            hidden[i - 1] = col.getAttribute('hidden') === '1';
        }
    }

    // ข้อความแบบหลายสีในช่องเดียว (rich text)
    const sst = book.zip.file('xl/sharedStrings.xml') ? els(await book.read('xl/sharedStrings.xml'), 'si') : [];
    const runs = (cell) => {
        if (cell.getAttribute('t') !== 's') return null;
        const si = sst[Number(first(cell, 'v')?.textContent)];
        const list = si ? els(si, 'r') : [];
        return list.length ? list.map((r) => ({
            text: first(r, 't')?.textContent || '',
            css: fontCss(first(r, 'rPr'), theme).css || ''
        })) : null;
    };

    const defaultHeight = Number(first(doc, 'sheetFormatPr')?.getAttribute('defaultRowHeight') || 15);
    const rows = new Map(els(doc, 'row').map((row) => {
        const cells = {};
        for (const c of els(row, 'c')) {
            const n = colNum(colOf(c));
            if (n > LAST_COL) continue;
            const s = Number(c.getAttribute('s') || 0);
            let text = first(c, 'f') ? '' : book.value(c);
            if (styles[s]?.symbol) text = SYMBOLS[text] || text;
            cells[colName(n)] = { s, text, runs: styles[s]?.symbol ? null : runs(c), input: book.inputStyles.has(String(s)) };
        }
        return [rowNum(row), { height: Math.round(Number(row.getAttribute('ht') || defaultHeight) * 4 / 3), cells }];
    }));
    const rowAt = (n) => rows.get(n) || { height: Math.round(defaultHeight * 4 / 3), cells: {} };

    const found = findBlocks(book, doc);
    if (!found.length) throw new Error('ไม่พบช่องกรอกสีส้มในไฟล์นี้');
    const blocks = new Map();
    for (const list of found) {
        const start = rowNum(list[0]);
        const scc = book.value(cellAt(list[0], 'B')).trim();
        if (scc) blocks.set(scc, { separator: rowAt(start - 1), rows: list.map((r) => rowAt(rowNum(r))) });
    }
    const headEnd = rowNum(found[0][0]) - 1; // แถวคั่นแรกเป็นของคันแรก
    const lastRow = rowNum(found[found.length - 1].at(-1));
    const head = [];
    for (let n = 1; n < headEnd; n++) head.push(rowAt(n));
    const footer = [];
    for (let n = lastRow + 1; n <= Math.max(...rows.keys()); n++) footer.push(rowAt(n));

    const merges = els(doc, 'mergeCell').map((m) => {
        const [a, b] = m.getAttribute('ref').split(':').map((ref) => ({
            col: colNum(ref.replace(/\d+$/, '')), row: Number(ref.replace(/^[A-Z]+/, ''))
        }));
        return { row: a.row, col: a.col, rowSpan: b.row - a.row + 1, colSpan: b.col - a.col + 1 };
    });

    return {
        widths, hidden, styles, head, footer, blocks, merges,
        images: await readLogo(book, path, widths.map((w, i) => (hidden[i] ? 0 : w)), head.map((r) => r.height))
    };
}
