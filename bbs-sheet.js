// วาดฟอร์มเป็นตารางบนหน้าเว็บ ช่องสีส้ม = กรอกได้
import { colName } from './bbs-xlsx.js?v=2';

const CHECK_FROM = 11; // K
const CHECK_TO = 41; // AO
const MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

/** จำนวนแถวที่แสดงของรถ 1 คัน */
export function rowCount(layout, v) {
    const base = layout.blocks.get(v.scc)?.rows.length || 3;
    return Math.max(base, v.rows || 0, v.trips.length, v.rounds.length);
}

const entry = (list, i, empty) => {
    while (list.length <= i) list.push(empty());
    return list[i];
};
export const roundAt = (v, i) => entry(v.rounds, i, () => ({ time: '', place: '', marks: {}, note: '' }));
const tripAt = (v, i) => entry(v.trips, i, () => ({ ship: '', custId: '', cust: '' }));

function headerText(report, ref) {
    const [y, m, d] = report.date.split('-').map(Number);
    return {
        H1: 'SC-Daily Checking Driver’s behavior  Report   ' +
            (report.shift === 'night' ? 'กะกลางคืน   20.00 น.  - 08.00 น.' : 'กะกลางวัน   08.00 น.  - 20.00 น.'),
        H2: 'วันที่ ' + d,
        I2: 'เดือน ' + MONTHS[m - 1],
        J2: 'พ.ศ. ' + (y + 543),
        L2: 'ตรวจสอบโดย ' + (report.checker || ''),
        R2: 'MONITOR : ' + (report.monitor || '')
    }[ref];
}

/**
 * @param {HTMLElement} host
 * @param {{layout:object, report:object, vehicles:object[], showLoading:boolean, customers:object,
 *   onChange:()=>void, onSelect:(v:object,i:number)=>void}} view
 */
export function renderSheet(host, view) {
    const { layout, report, vehicles, onChange } = view;
    const { styles } = layout;
    // คอลัมน์ K–Q ซ่อนไว้ตามไฟล์ต้นแบบ เปิดดูได้
    const visible = [];
    for (let n = 1; n <= layout.widths.length; n++) {
        if (!layout.hidden[n - 1] || (view.showLoading && n >= CHECK_FROM && n <= 17)) visible.push(n);
    }

    const table = document.createElement('table');
    const group = table.appendChild(document.createElement('colgroup'));
    for (const n of visible) group.appendChild(document.createElement('col')).style.width = layout.widths[n - 1] + 'px';
    table.style.width = visible.reduce((sum, n) => sum + layout.widths[n - 1], 0) + 'px';
    const body = table.appendChild(document.createElement('tbody'));

    function paintCell(td, cell, next) {
        const st = styles[cell?.s || 0];
        let css = st.css + 'text-align:' + st.align + ';vertical-align:' + st.valign + ';';
        if (st.bg) css += 'background:' + st.bg + ';';
        const right = st.right || styles[next?.s || 0].left;
        if (right) css += 'border-right:' + right + ';';
        if (st.bottom) css += 'border-bottom:' + st.bottom + ';';
        if (st.top) css += 'border-top:' + st.top + ';';
        if (st.left) css += 'border-left:' + st.left + ';';
        td.style.cssText = css;
        return st;
    }

    function addRow(row, { number, editor, ref } = {}) {
        const tr = body.appendChild(document.createElement('tr'));
        tr.style.height = row.height + 'px';
        if (number === 6) tr.className = 'titles';
        const skip = new Set();
        for (const n of visible) {
            if (skip.has(n)) continue;
            const col = colName(n);
            const cell = row.cells[col];
            const merge = number && layout.merges.find((m) => m.row === number && m.col === n);
            const td = tr.appendChild(document.createElement('td'));
            let span = 1;
            if (merge) {
                const inside = visible.filter((x) => x >= n && x < n + merge.colSpan);
                span = inside.length;
                td.colSpan = span;
                inside.forEach((x) => skip.add(x));
            }
            const nextCol = visible[visible.indexOf(n) + span];
            const next = nextCol ? row.cells[colName(nextCol)] : undefined;
            const st = paintCell(td, cell, next);
            if (n <= 2) td.classList.add('fix' + n);
            if (editor && editor(td, col, n, cell)) continue;
            const text = (ref && headerText(report, col + number)) ?? ref?.[col] ?? cell?.text ?? '';
            if (!text) continue;
            const box = td.appendChild(document.createElement('div'));
            box.className = st.wrap ? 'wrap-text' : 'flow';
            if (st.wrap) {
                box.style.maxHeight = row.height - 2 + 'px';
                box.title = text;
            }
            if (cell?.runs && text === cell.text) {
                for (const run of cell.runs) {
                    const s = box.appendChild(document.createElement('span'));
                    s.style.cssText = run.css;
                    s.textContent = run.text;
                }
            } else box.textContent = text;
        }
    }

    function field(td, value, label, set, type = 'text') {
        const input = td.appendChild(document.createElement('input'));
        input.type = type;
        input.value = value || '';
        input.setAttribute('aria-label', label);
        input.addEventListener('input', () => { set(input.value); onChange(); });
        return input;
    }

    // ช่องกดวนค่า (สถานะ GPS/CCTV และช่องติ๊ก)
    function toggle(td, values, get, set, label) {
        const button = td.appendChild(document.createElement('button'));
        button.type = 'button';
        button.title = label;
        button.setAttribute('aria-label', label);
        const paint = () => {
            const value = get();
            button.textContent = value === 'P' ? '✓' : value === 'O' ? '✗' : value;
            button.className = value === 'O' || value === 'ไม่ปกติ' ? 'bad' : '';
        };
        button.addEventListener('click', () => {
            set(values[(values.indexOf(get()) + 1) % values.length]);
            paint();
            onChange();
        });
        paint();
        return button;
    }

    function vehicleRows(v, index) {
        const block = layout.blocks.get(v.scc) || [...layout.blocks.values()].at(-1);
        const known = layout.blocks.has(v.scc);
        const sep = block.separator;
        addRow(known ? sep : { height: sep.height, cells: { ...sep.cells, B: { ...sep.cells.B, text: '', runs: null } } });
        const total = rowCount(layout, v);
        for (let i = 0; i < total; i++) {
            // แถวที่เกินฟอร์มใช้รูปแบบเดียวกับแถวก่อนสุดท้าย (ตรงกับตอนส่งออก)
            const base = block.rows;
            const source = i < base.length - 1 ? base[i] : i === total - 1 ? base.at(-1) : base[Math.max(0, base.length - 2)];
            const row = { height: source.height, cells: { ...source.cells } };
            const keep = (col, text) => { row.cells[col] = { ...row.cells[col], s: row.cells[col]?.s || 0, text, runs: null }; };
            const number = known ? base[0].cells.A?.text : String(index + 1);
            keep('A', i === 0 ? number || '' : '');
            keep('B', i === 0 ? v.scc : i === 1 ? v.plate : known && i === 2 ? base[2]?.cells.B?.text || '' : '');
            addRow(row, {
                editor(td, col, n, cell) {
                    if (!cell?.input) return false;
                    for (const type of ['focusin', 'click']) td.addEventListener(type, () => view.onSelect(v, i));
                    const r = v.rounds[i];
                    const t = v.trips[i];
                    const where = v.scc + ' แถว ' + (i + 1) + ' ';
                    if (col === 'C' || col === 'D') {
                        if (i) return true;
                        const key = col === 'C' ? 'gps' : 'cctv';
                        toggle(td, ['', 'ปกติ', 'ไม่ปกติ'], () => v[key] || '', (x) => { v[key] = x; }, where + key.toUpperCase());
                    } else if (col === 'E') {
                        if (i === 0) field(td, v.driver, where + 'ชื่อ พขร.', (x) => { v.driver = x; });
                        else if (i === 1) field(td, v.risk, where + 'กลุ่มเสี่ยง', (x) => { v.risk = x; });
                    } else if (col === 'F') {
                        field(td, t?.ship, where + 'Shipment', (x) => { tripAt(v, i).ship = x; });
                    } else if (col === 'G') {
                        const input = field(td, t?.custId, where + 'Ship-to', (x) => { tripAt(v, i).custId = x; });
                        input.addEventListener('change', () => {
                            const name = view.customers[input.value.trim()];
                            if (!name) return;
                            tripAt(v, i).cust = name;
                            const target = td.nextElementSibling?.querySelector('input');
                            if (target) target.value = name;
                            onChange();
                        });
                    } else if (col === 'H') {
                        field(td, t?.cust, where + 'ชื่อลูกค้า', (x) => { tripAt(v, i).cust = x; });
                    } else if (col === 'I') {
                        const input = field(td, r?.time, where + 'เวลา (ดับเบิลคลิก = ตอนนี้)', (x) => { roundAt(v, i).time = x; }, 'time');
                        input.title = 'ดับเบิลคลิกเพื่อใส่เวลาตอนนี้';
                        input.addEventListener('dblclick', () => {
                            input.value = new Date().toTimeString().slice(0, 5);
                            input.dispatchEvent(new Event('input'));
                        });
                    } else if (col === 'J') {
                        field(td, r?.place, where + 'สถานที่', (x) => { roundAt(v, i).place = x; });
                    } else if (col === 'AP') {
                        field(td, r?.note, where + 'หมายเหตุ', (x) => { roundAt(v, i).note = x; });
                    } else if (n >= CHECK_FROM && n <= CHECK_TO) {
                        const button = toggle(td, ['', 'P', 'O'], () => v.rounds[i]?.marks[col] || '', (x) => {
                            const marks = roundAt(v, i).marks;
                            if (x) marks[col] = x; else delete marks[col];
                        }, where + (view.checks[col] || col));
                        button.dataset.col = col;
                    }
                    return true;
                }
            });
            body.lastElementChild.dataset.row = v.scc + ':' + i;
        }
    }

    layout.head.forEach((row, i) => addRow(row, { number: i + 1, ref: {} }));
    vehicles.forEach((v) => vehicleRows(v, report.vehicles.indexOf(v)));
    const used = report.vehicles.filter((v) => v.driver).length;
    layout.footer.forEach((row) => {
        const total = row.cells.I?.text;
        addRow(row, { ref: /รวม.*คัน/.test(total || '') ? { I: total.replace(/\d+/, String(used)) } : undefined });
    });

    const frame = document.createElement('div');
    frame.className = 'sheet';
    frame.append(table);
    for (const image of layout.images) {
        const img = frame.appendChild(document.createElement('img'));
        img.src = image.src;
        img.alt = 'โลโก้';
        img.style.cssText = `left:${image.x}px;top:${image.y}px;width:${image.width}px;height:${image.height}px`;
    }
    host.replaceChildren(frame);
}
