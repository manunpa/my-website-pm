// อ่านไฟล์แผนงานจากหน่วยงาน ดึงเฉพาะ "วันที่ + กะ" ที่เลือกบนหน้าเว็บ (อ่านในเบราว์เซอร์ ไม่อัปโหลดไปไหน)
// รองรับ 3 แบบ: 1.1 Daily Report LLK / Plan Operation (SHELL LLK) / Confirm fleet SRC
// และแบบฟอร์มการจ่ายงาน Other Brand (.ods หรือ .xlsx ชีตชื่อ วัน_เดือน)
import { openBook, els, colOf, rowNum } from './bbs-xlsx.js?v=11';

const THAI_MONTHS = ['มกราคม', 'กุมภาพันธ์', 'มีนาคม', 'เมษายน', 'พฤษภาคม', 'มิถุนายน',
    'กรกฎาคม', 'สิงหาคม', 'กันยายน', 'ตุลาคม', 'พฤศจิกายน', 'ธันวาคม'];

const colNum = (s) => [...s].reduce((n, c) => n * 26 + c.charCodeAt(0) - 64, 0);
const DRIVER = /^(นาย|นาง|น\.ส\.)/;
const SCC = /^(SCC)?\s*(\d{3,4})(\s*S)?$/i;
const SHIPMENTS = /^\d{8,}(\s*\/+\s*\d{8,})*$/;

/** เลขรถสำหรับจับคู่: "SCC7803 S" และ "7803" คือคันเดียวกัน */
// NPM ใช้ทะเบียน (60-1041) เป็นเลขรถ
const PLATE = /^\d{2}-\d{4}$/;
export const vehicleNo = (text) => {
    const s = String(text || '').trim();
    return PLATE.test(s) ? s : SCC.exec(s)?.[2] || '';
};
export const sccName = (no) => (PLATE.test(no) ? no : 'SCC' + no);

const iso = (y, m, d) => [y > 2400 ? y - 543 : y, m, d].map((n) => String(n).padStart(2, '0')).join('-');

// วันที่ที่เขียนไว้ในหัวชีต (รองรับ พ.ศ./ค.ศ. ชื่อเดือนไทย และเซลล์วันที่ของ Excel)
function headerDate(rows) {
    const texts = rows.filter((r) => r.n <= 3).flatMap((r) => [...r.cells.values()]);
    for (const text of texts) {
        let m = /(\d{1,2})\s*[/\-.]\s*(\d{1,2})\s*[/\-.]\s*(\d{4})/.exec(text);
        if (m) return iso(Number(m[3]), Number(m[2]), Number(m[1]));
        m = new RegExp('(\\d{1,2})\\s*(' + THAI_MONTHS.join('|') + ')\\s*(?:พ\\.ศ\\.)?\\s*(\\d{4})').exec(text);
        if (m) return iso(Number(m[3]), THAI_MONTHS.indexOf(m[2]) + 1, Number(m[1]));
        if (/^\d{5}(\.\d+)?$/.test(text) && Number(text) > 40000 && Number(text) < 60000) {
            return new Date(Date.UTC(1899, 11, 30) + Math.floor(Number(text)) * 86400000).toISOString().slice(0, 10);
        }
    }
    return '';
}

// ชีตของวันที่เลือก (ตั้งชื่อตามวันที่ เช่น "25", "25.", "25-11")
async function daySheet(buffer, day) {
    const book = await openBook(buffer);
    const workbook = await book.read('xl/workbook.xml');
    const rels = await book.read('xl/_rels/workbook.xml.rels');
    const targets = Object.fromEntries(Array.from(rels.getElementsByTagName('Relationship'))
        .map((r) => [r.getAttribute('Id'), 'xl/' + r.getAttribute('Target').replace(/^\/?(xl\/)?/, '')]));
    const sheet = els(workbook, 'sheet').find((s) => {
        const m = /^\s*0?(\d{1,2})\s*([.\-_]\s*\d{0,2})?\s*$/.exec(s.getAttribute('name'));
        return s.getAttribute('state') !== 'hidden' && m && Number(m[1]) === day;
    });
    if (!sheet) return null;
    const doc = await book.read(targets[sheet.getAttribute('r:id')]);
    return els(doc, 'row').map((row) => ({
        n: rowNum(row),
        cells: new Map(els(row, 'c')
            .map((c) => [colNum(colOf(c)), book.value(c).replace(/\s+/g, ' ').trim()])
            .filter(([, text]) => text))
    }));
}

// ===== ไฟล์ .ods: อ่านชีต "วัน_เดือน" ให้ได้แถวรูปเดียวกับ daySheet =====
const ODS_TABLE = 'urn:oasis:names:tc:opendocument:xmlns:table:1.0';
const ODS_TEXT = 'urn:oasis:names:tc:opendocument:xmlns:text:1.0';

async function odsSheet(buffer, day, month) {
    const zip = await window.JSZip.loadAsync(buffer);
    const xml = await zip.file('content.xml').async('string');
    const doc = new DOMParser().parseFromString(xml, 'application/xml');
    const table = Array.from(doc.getElementsByTagNameNS(ODS_TABLE, 'table')).find((t) => {
        const m = /^\s*(\d{1,2})_(\d{1,2})\s*$/.exec(t.getAttributeNS(ODS_TABLE, 'name'));
        return m && Number(m[1]) === day && Number(m[2]) === month;
    });
    if (!table) return null;
    const repeat = (node, name) => Number(node.getAttributeNS(ODS_TABLE, name) || 1);
    const rows = [];
    let n = 1;
    for (const row of Array.from(table.getElementsByTagNameNS(ODS_TABLE, 'table-row'))) {
        const cells = new Map();
        let col = 1;
        for (const cell of Array.from(row.children)) {
            const times = repeat(cell, 'number-columns-repeated');
            // เอาเฉพาะข้อความในช่อง ไม่เอาคอมเมนต์
            const text = Array.from(cell.children).filter((c) => c.namespaceURI === ODS_TEXT && c.localName === 'p')
                .map((c) => c.textContent).join(' ').replace(/\s+/g, ' ').trim();
            if (text) for (let i = 0; i < times; i++) cells.set(col + i, text);
            col += times;
        }
        const times = repeat(row, 'number-rows-repeated');
        if (cells.size) for (let i = 0; i < times; i++) rows.push({ n: n + i, cells });
        n += times;
    }
    return rows;
}

// ===== แบบฟอร์มการจ่ายงาน Other Brand: แผนทั้งวัน คันละหลายแถว (คนละงาน) =====
const isDispatch = (row) => {
    const texts = [...row.cells.values()];
    return texts.includes('เบอร์รถ') && texts.some((t) => /พขร\.?\s*1/.test(t)) && texts.includes('รายละเอียดงาน');
};
// "17.30" / 17.3 / "21:30" / 0.8958 (เวลาของ Excel) → "HH:MM"
const clock = (text) => {
    const raw = String(text || '').trim();
    const n = Number(raw);
    const two = (x) => String(x).padStart(2, '0');
    if (n > 0 && n < 1 && !/^0\.[0-5]\d$/.test(raw)) {
        const minutes = Math.round(n * 1440);
        return two(Math.floor(minutes / 60)) + ':' + two(minutes % 60);
    }
    const m = /^(\d{1,2})[.:](\d{2})/.exec(raw && !Number.isNaN(n) ? n.toFixed(2) : raw);
    return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? two(m[1]) + ':' + m[2] : '';
};
const unique = (list) => [...new Set(list.filter(Boolean))];

/** คืน { cars: Map<"SC001" | "SC001 (2)", ข้อมูล>, loose: จำนวนแถวงานที่ไม่ระบุรถ } */
function readDispatch(rows, header) {
    const col = (re) => [...header.cells].find(([, t]) => re.test(t))?.[0];
    const cols = {
        car: col(/^เบอร์รถ$/), brand: col(/^Brand$/i), driver: col(/พขร\.?\s*1/), driver2: col(/พขร\.?\s*2/),
        detail: col(/^รายละเอียดงาน/), from: col(/^สถานที่รับงาน/), planned: col(/^เวลารับงาน.*Plan/i),
        actual: col(/^เวลารับงาน.*Actual/i), to: col(/^สถานที่ลงสินค้า/)
    };
    const person = (text) => (!text || /^(แจ้งแล้ว|leader|\d+)$/i.test(text) ? '' : text);
    const crews = new Map(); // คัน -> ชุดคนขับ (คันเดียวกันคนขับคนละชุด = คนละรายการ)
    let crew = null;
    let loose = 0;
    let last = header.n;
    for (const row of rows.filter((r) => r.n > header.n)) {
        const at = (key) => row.cells.get(cols[key]) || '';
        const gap = row.n > last + 1;
        last = row.n;
        // แถวคั่น (เหลือแต่สูตรสรุปท้ายแถว) = จบงานของคันนั้น
        if (gap || !['car', 'brand', 'detail', 'from', 'to'].some(at)) crew = null;
        // .xlsx เก็บเบอร์รถเป็นตัวเลขล้วน (รูปแบบเซลล์ "SC"000)
        const no = /^(?:SC\s*)?(\d{1,3})(?![\d\-])/i.exec(at('car'))?.[1].padStart(3, '0');
        if (no) {
            const car = 'SC' + no;
            const driver = person(at('driver'));
            const driver2 = person(at('driver2'));
            const list = crews.get(car) || [];
            crews.set(car, list);
            const id = (driver + '|' + driver2).replace(/\s|นาย/g, '');
            crew = list.find((c) => c.id === id);
            if (!crew) list.push(crew = { id, driver, driver2, jobs: [], brands: [], from: [], planned: '', actual: '' });
        }
        const name = at('to') || at('detail');
        if (!crew) {
            if (name) loose++;
            continue;
        }
        crew.brands.push(at('brand'));
        crew.from.push(at('from'));
        crew.planned ||= clock(at('planned'));
        crew.actual ||= clock(at('actual'));
        if (name) crew.jobs.push({ ship: /^F\d{6,}$/i.test(at('detail')) ? at('detail') : '', custId: '', cust: name });
    }
    const cars = new Map();
    for (const [car, list] of crews) {
        list.filter((c) => c.jobs.length).forEach((c, i) => {
            const route = unique(c.jobs.map((j) => j.cust)).join(' / ');
            const remark = [unique(c.brands).join(', '), unique(c.from).length ? 'ต้นทาง ' + unique(c.from).join(', ') : '',
                c.planned ? 'รับงาน (แผน) ' + c.planned : ''].filter(Boolean).join(' · ');
            cars.set(i ? car + ' (' + (i + 1) + ')' : car, {
                driver: c.driver, driver2: c.driver2, risk: '', riskIfEmpty: '', remark, route,
                ...(c.driver2 ? { route2: route } : {}),
                ...(c.actual ? { jobTime: c.actual } : {}),
                trips: c.jobs
            });
        });
    }
    return { cars, loose };
}

// "ก // ข" + "111 / 222"  → 2 งาน ถ้าจำนวนไม่เท่ากันเก็บรวมเป็นงานเดียว
function splitTrips(ship, cust) {
    const ships = ship.split(/\/+/).map((s) => s.trim()).filter(Boolean);
    const custs = cust.split(/\/{2,}/).map((s) => s.trim()).filter(Boolean);
    if (ships.length > 1 && ships.length === custs.length) return ships.map((s, i) => ({ ship: s, cust: custs[i] }));
    return ship || cust ? [{ ship, cust }] : [];
}

// ===== หน้างานใส่ผิดช่อง: ช่องตามหัวคอลัมน์ว่างหรือข้อมูลไม่เข้าพวก ให้หาจากช่องอื่นในแถว (LLK, SRC) =====
const isName = (t) => DRIVER.test(t);
const isText = (t) => !!t && !isName(t) && !/^[\d\s.,\/\-:]+$/.test(t) && !/^SCC\s*\d+/i.test(t);
const CUSTOMER = /บจก|บมจ|หจก|หสน|บริษัท|สหกรณ์|ปิโตร|ออย|บริการ|เซอร์วิส|แก๊ส|พลังงาน/;

/** อ่านช่อง cols ที่ควรอยู่ก่อน ไม่ได้จึงหาช่องใกล้สุดในช่วง [lo, hi] (moved = เจอผิดที่) */
function pick(row, cols, ok, stray, [lo, hi]) {
    for (const c of cols) {
        const value = row.cells.get(c) || '';
        if (ok(value)) return { value, col: c };
    }
    const near = [...row.cells].filter(([c, t]) => c >= lo && c <= hi && stray(t))
        .sort((a, b) => Math.abs(a[0] - cols[0]) - Math.abs(b[0] - cols[0]))[0];
    return near ? { value: near[1], col: near[0], moved: true } : { value: '' };
}

// เรียนรูปแบบจากข้อมูลที่อยู่ถูกช่องในไฟล์เดียวกัน ค่าที่อยู่ผิดช่องต้องเข้ารูปแบบนั้นจึงจะหยิบมา
const columnValues = (rows, cols) => rows.flatMap((r) => cols.map((c) => r.cells.get(c) || '')).filter(Boolean);
/** เลขชนิดเดียวกัน = ยาวเท่ากันและขึ้นต้นเหมือนกัน (เช่น NOM 12xxxx) */
function sameKind(values, re) {
    const shape = (v) => v.length + ':' + v.slice(0, 2);
    const seen = new Set(values.filter((v) => re.test(v)).map(shape));
    return (t) => re.test(t) && seen.has(shape(t));
}
/** ชื่อลูกค้า: มีคำของนิติบุคคล/ปั๊ม หรือเคยอยู่ในช่องลูกค้าของไฟล์นี้ */
function likeCustomer(values) {
    const seen = new Set(values.filter(isText));
    return (t) => isText(t) && (CUSTOMER.test(t) || seen.has(t));
}

// เบอร์รถเลื่อนไปช่องข้างๆ ต้องมีคำว่า SCC นำหน้า กันหยิบตัวเลขอื่น (ระยะทาง ฯลฯ)
function carNo(row, col, moved) {
    const no = vehicleNo(row.cells.get(col));
    if (no) return no;
    const near = [col - 1, col + 1].map((c) => row.cells.get(c) || '').find((t) => /^SCC\s*\d/i.test(t) && vehicleNo(t));
    if (!near) return '';
    moved(vehicleNo(near), 'เบอร์รถ');
    return vehicleNo(near);
}

// ===== 1.1 Daily Report: ครึ่งซ้ายกะกลางวัน ครึ่งขวากะกลางคืน =====
// หัวคอลัมน์ฝั่งกลางคืนเหลื่อมกับข้อมูล จึงหาจากลักษณะของข้อความแทน
function readDaily(rows, header, shift, add) {
    const sccCols = [...header.cells].filter(([, t]) => t === 'SCC').map(([c]) => c);
    const start = sccCols[shift === 'night' ? 1 : 0];
    if (!start) return;
    const end = shift === 'night' ? Infinity : (sccCols[1] || Infinity) - 2;
    let current = '';
    for (const row of rows.filter((r) => r.n > header.n)) {
        const no = vehicleNo(row.cells.get(start));
        if (no) current = no;
        if (!current) continue;
        const part = [...row.cells].filter(([c]) => c > start && c <= end);
        const find = (re) => part.find(([, t]) => re.test(t));
        const driver = find(DRIVER)?.[1] || '';
        const ship = find(SHIPMENTS);
        const risk = find(/^[LMH]$/);
        const status = risk ? row.cells.get(risk[0] + 1) || '' : '';
        add(current, {
            driver: no ? driver : '',
            risk: no && driver && risk ? (risk[1] + ' ' + status).trim() : '',
            trips: ship ? splitTrips(ship[1], row.cells.get(ship[0] + 1) || '') : []
        });
    }
}

// ===== Plan Operation (SHELL): เวลาเข้าโหลด | พขร. | เบอร์รถ | ชื่อปั๊ม | SHIPMENT =====
function readShell(rows, header, shift, add) {
    const col = (re) => [...header.cells].find(([, t]) => re.test(t))?.[0];
    const cols = { time: col(/เวลา/), driver: col(/^พขร/), scc: col(/เบอร์รถ/), cust: col(/ชื่อป/), ship: col(/shipment/i) };
    const times = new Map(); // คัน → เวลาเข้าโหลดแถวแรก (แถวต่อใช้เวลาเดียวกัน)
    for (const row of rows.filter((r) => r.n > header.n)) {
        const no = vehicleNo(row.cells.get(cols.scc));
        if (!no) continue;
        const raw = row.cells.get(cols.time) || '';
        const m = /^(\d{1,2})[.:]\d{2}/.exec(raw);
        const hour = m ? Number(m[1]) : /^0?\.\d+$/.test(raw) ? Math.floor(Number(raw) * 24) : null;
        if (hour !== null) times.set(no, hour);
        const at = times.get(no);
        if (at !== undefined && (at >= 8 && at < 20 ? 'day' : 'night') !== shift) continue;
        const driver = row.cells.get(cols.driver) || '';
        add(no, {
            driver: DRIVER.test(driver) ? driver : '',
            risk: '',
            trips: splitTrips(row.cells.get(cols.ship) || '', row.cells.get(cols.cust) || '')
        });
    }
}

// ===== PLAN NPM: Reg.Truck | Driver Name | Trips 1-6 | Remark (ไม่แยกกะ) =====
function readNpm(rows, header, add) {
    const col = (re) => [...header.cells].find(([, t]) => re.test(t))?.[0];
    const cols = { truck: col(/^Reg/i), driver: col(/^Driver/i), remark: col(/^Remark/i) };
    const trips = [...header.cells].filter(([, t]) => /^Trips?\s*\d/i.test(t)).map(([c]) => c);
    for (const row of rows.filter((r) => r.n > header.n)) {
        const no = vehicleNo(row.cells.get(cols.truck));
        if (!no) continue;
        const driver = row.cells.get(cols.driver) || '';
        add(no, {
            replace: true,
            driver: DRIVER.test(driver) ? driver : '',
            remark: row.cells.get(cols.remark) || '',
            // เที่ยวชื่อซ้ำคือวิ่งหลายรอบจริง เก็บทุกเที่ยว
            trips: trips.map((c) => row.cells.get(c)).filter(Boolean).map((cust) => ({ ship: '', custId: '', cust }))
        });
    }
}

// ===== JC Daily Report: ครึ่งซ้ายกะกลางวัน ครึ่งขวากะกลางคืน คันละหลายแถว (คนละ Drop) =====
// แผน LLK ใช้ผังเดียวกัน (มี "วันทำงาน" เพิ่ม): สถานะเป็นกลุ่มเสี่ยง L/M/H และหัวคอลัมน์ฝั่งกลางคืนเหลื่อม
// คือไม่มีหัว "พขร." (ชื่ออยู่ใต้ "รหัส พขร.") และชื่อลูกค้าอยู่ใต้ "Shipment"
function readJourney(rows, header, shift, add, moved) {
    const nth = (re) => [...header.cells].filter(([, t]) => re.test(t)).map(([c]) => c)[shift === 'night' ? 1 : 0];
    const cols = { scc: nth(/^SCC$/), driver: nth(/^พขร/) || nth(/^รหัส\s*พขร/), cust: nth(/^ลูกค้า/), ship: nth(/^Shipment/i),
        trip: nth(/^Trip$/i), status: nth(/^สถานะ$/), rest: nth(/^สถานะวันหยุด$/) };
    const llk = [...header.cells.values()].includes('วันทำงาน');
    // ช่วงคอลัมน์ของกะนี้ (ไม่ให้ไปหยิบของอีกกะหรือคอลัมน์สรุป)
    const sccCols = [...header.cells].filter(([, t]) => t === 'SCC').map(([c]) => c);
    const total = [...header.cells].find(([, t]) => /^จำนวนเที่ยว/.test(t))?.[0];
    const range = shift === 'night' ? [cols.scc - 1, (total || 999) - 1] : [1, (sccCols[1] || 999) - 2];
    const body = rows.filter((r) => r.n > header.n);
    const knownShip = sameKind(columnValues(body, [cols.ship]), SHIPMENTS);
    const knownCustomer = likeCustomer(columnValues(body, [cols.cust, cols.ship]));
    const cars = new Map();
    let current = '';
    for (const row of rows.filter((r) => r.n > header.n)) {
        if ([...row.cells.values()].some((t) => /^(รวม|สรุป)/.test(t))) break;
        const no = llk ? carNo(row, cols.scc, moved) : vehicleNo(row.cells.get(cols.scc));
        if (no) current = no;
        if (!current) continue;
        const car = cars.get(current) || { people: [], custs: [] };
        cars.set(current, car);
        let driver = row.cells.get(cols.driver) || '';
        let statusText = row.cells.get(cols.status) || '';
        let restText = row.cells.get(cols.rest) || '';
        if (llk) {
            const found = pick(row, [cols.driver], isName, isName, range);
            if (found.moved) moved(current, 'พขร.');
            driver = found.value || (isText(driver) ? driver : '');
            if (driver) {
                const risk = pick(row, [cols.status], (t) => /^[LMH]$/.test(t), (t) => /^[LMH]$/.test(t), range);
                const isRest = (t) => /^(ปกติ|หยุด|ลา|กลับจากหยุด)/.test(t);
                const rest = pick(row, [cols.rest], isRest, isRest, range);
                if (risk.moved || rest.moved) moved(current, 'กลุ่มเสี่ยง/วันหยุด');
                statusText = risk.value;
                restText = rest.value;
            }
        }
        // แผนมีแถวละ 1 งาน เขียนชื่อซ้ำได้ ชื่อเดียวกันคือคนเดียวกัน
        if (driver) {
            const same = (name) => name.replace(/\(.*?\)|^(นาย|นาง|น\.ส\.)|[\s*]/g, '');
            let person = car.people.find((p) => same(p.name) === same(driver));
            if (!person) car.people.push(person = { name: driver, status: '', rest: '' });
            person.status ||= statusText;
            person.rest ||= restText;
        }
        let ship = SHIPMENTS.test(row.cells.get(cols.ship) || '') ? row.cells.get(cols.ship) : '';
        let cust = row.cells.get(cols.cust) || '';
        if (llk) {
            const foundShip = pick(row, [cols.ship], (t) => SHIPMENTS.test(t), knownShip, range);
            ship = foundShip.value;
            // LLK: แถวไม่มีเลข Trip และไม่มี Shipment คือข้อความบอกสถานะรถ (จอดซ่อม ฯลฯ) ไม่ใช่งาน
            const trip = [cols.trip, cols.trip - 1, cols.trip + 1].some((c) => /^\d{1,2}$/.test(row.cells.get(c) || ''));
            if (!trip && !ship) continue;
            // ชื่อลูกค้าอยู่ใต้ "ลูกค้า" หรือ "Shipment" (ฝั่งกลางคืน) ได้ทั้งคู่
            const found = pick(row, [cols.cust, cols.ship], isText, knownCustomer, range);
            cust = found.value;
            if (found.moved) moved(current, 'ลูกค้า');
            if (foundShip.moved) moved(current, 'Shipment');
        }
        if ((cust || ship) && !/^(SPARE|ไม่มีงาน)$/i.test(cust)) car.custs.push(...splitTrips(ship, cust));
    }
    for (const [no, car] of cars) {
        // คนที่ 2 = คนโหลด (ถ้าระบุ) คนที่เหลือเป็นคนที่ 3
        const [first, ...others] = car.people;
        const second = others.find((p) => /โหลด/.test(p.name)) || others[0];
        const third = others.find((p) => p !== second);
        add(no, {
            replace: true,
            driver: first?.name || '',
            driver2: second?.name || '',
            driver3: third?.name || '',
            risk: /^[LMH]$/.test(first?.status || '') ? (first.status + ' ' + first.rest).trim() : '',
            status: first?.status || '', rest: first?.rest || '',
            status2: second?.status || '', rest2: second?.rest || '',
            status3: third?.status || '', rest3: third?.rest || '',
            trips: car.custs.map((t) => ({ ...t, custId: '' }))
        });
    }
}

// ===== Confirm fleet SRC (งานเย็น = กะกลางคืน): กลุ่มคอลัมน์ พขร./ลูกค้า/NOM มี 2 ชุด =====
function readConfirm(rows, header, shift, add, moved) {
    if (shift !== 'night') return 'เป็นแผนงานเย็น ใช้กับกะกลางคืนเท่านั้น';
    const cols = (re) => [...header.cells].filter(([, t]) => re.test(t)).map(([c]) => c);
    const [scc] = cols(/เบอร์รถ/);
    const drivers = cols(/ชื่อพขร/);
    const custs = cols(/^ลูกค้า/);
    const noms = cols(/^NOM/i);
    const [risk] = cols(/risk/i);
    const [plate] = cols(/^ทะเบียน/);
    const codes = cols(/^รหัสพขร/);
    const body = rows.filter((r) => r.n > header.n);
    const nomShape = /^\d{6}(\s*[\/,]\s*\d{6})*$/;
    const knownNom = sameKind(columnValues(body, noms), nomShape);
    const knownCustomer = likeCustomer(columnValues(body, custs));
    for (const row of body) {
        const no = carNo(row, scc, moved);
        if (!no) continue;
        drivers.forEach((c, i) => {
            const range = [codes[i] || c - 1, noms[i] || custs[i] + 1]; // กลุ่มคอลัมน์ พขร. ชุดนี้
            const name = pick(row, [c], isName, isName, range);
            const driver = name.value;
            // NOM ผิดช่องต้องขึ้นต้นเหมือนเลข NOM อื่นในไฟล์ กันหยิบเลขในหมายเหตุ
            const number = pick(row, [noms[i]], (t) => nomShape.test(t), knownNom, [range[0], range[1] + 1]);
            const nom = number.value || row.cells.get(noms[i]) || '';
            let place = pick(row, [custs[i]], isText, knownCustomer, range);
            // ชื่อกับลูกค้าใส่สลับช่องกัน: ข้อความในช่องชื่อคือลูกค้า
            if (!place.value && name.moved && name.col === custs[i] && isText(row.cells.get(c))) place = { value: row.cells.get(c), moved: true };
            const names = place.value.split(/\/+/).map((s) => s.trim()).filter(Boolean);
            if (name.moved) moved(no, 'พขร.');
            if (number.moved) moved(no, 'NOM');
            if (place.moved) moved(no, 'ลูกค้า');
            if (!DRIVER.test(driver) && !names.length && !nom) return;
            add(no, {
                plate: (row.cells.get(plate) || '').split('/')[0].trim(),
                driver: DRIVER.test(driver) ? driver : '',
                riskIfEmpty: (row.cells.get(risk) || '').charAt(0).toUpperCase(),
                // NOM มี 1 เลขต่อแถว ใส่ที่งานแรก
                trips: names.length ? names.map((cust, n) => ({ ship: n ? '' : nom, cust })) : nom ? [{ ship: nom, cust: '' }] : []
            });
        });
    }
    return '';
}

// พขร.คนที่ 3 และสถานะของแต่ละคน (มีเฉพาะแผน JC)
export const PEOPLE_FIELDS = ['driver3', 'status', 'rest', 'status2', 'rest2', 'status3', 'rest3'];

/**
 * @param {File[]} files
 * @param {string} date 'YYYY-MM-DD'
 * @param {'day'|'night'} shift
 * @returns {Promise<{vehicles:Map<string,{driver:string,risk:string,riskIfEmpty:string,trips:object[]}>, notes:string[]}>}
 */
export async function readPlans(files, date, shift) {
    const vehicles = new Map();
    const notes = [];
    let dispatch = false; // แผน Other Brand ใช้เบอร์รถ SC001 เป็นตัวจับคู่
    const add = (no, item) => {
        const v = vehicles.get(no) || { driver: '', risk: '', riskIfEmpty: '', trips: [] };
        v.plate ||= item.plate || '';
        if (item.replace) { // แผน NPM: ไฟล์หลังคือฉบับแก้ ใช้ทับของเดิม
            v.driver = item.driver || v.driver;
            v.risk = item.risk || v.risk;
            v.remark = item.remark;
            v.driver2 = item.driver2;
            for (const k of PEOPLE_FIELDS) if (item[k] !== undefined) v[k] = item[k];
            if (item.trips.length) v.trips = item.trips;
            vehicles.set(no, v);
            return;
        }
        v.driver ||= item.driver;
        v.risk ||= item.risk || '';
        v.riskIfEmpty ||= item.riskIfEmpty || '';
        for (const t of item.trips) {
            // ไฟล์ซ้ำกัน (เช่น LLK กับ LLK-2) ไม่เพิ่มงานเดิมสองรอบ
            if (!v.trips.some((x) => x.ship === t.ship && x.cust === t.cust)) v.trips.push({ ship: t.ship, custId: '', cust: t.cust });
        }
        vehicles.set(no, v);
    };
    const want = date.split('-').reverse().join('/');
    const misplaced = new Map(); // คัน -> ข้อมูลที่เจอผิดช่อง
    const moved = (no, what) => misplaced.set(no, (misplaced.get(no) || new Set()).add(what));
    for (const file of files) {
        const say = (text) => notes.push(file.name + ': ' + text);
        try {
            const buffer = await file.arrayBuffer();
            const [day, month2] = [Number(date.slice(8)), Number(date.slice(5, 7))];
            const rows = /\.ods$/i.test(file.name) ? await odsSheet(buffer, day, month2) : await daySheet(buffer, day);
            if (!rows) { say('ไม่มีชีตของวันที่ ' + day + (/\.ods$/i.test(file.name) ? '/' + month2 : '')); continue; }
            const dispatchHead = rows.slice(0, 8).find(isDispatch);
            if (dispatchHead) {
                // วันที่ในหัวชีตมักค้างของเดิม ยึดชื่อชีตเป็นหลัก แล้วเตือนให้ตรวจ
                const written = headerDate(rows);
                if (written && written !== date) say('หัวชีตเขียนวันที่ ' + written.split('-').reverse().join('/') + ' ใช้ตามชื่อชีต ตรวจก่อนกดตกลง');
                const { cars, loose } = readDispatch(rows, dispatchHead);
                for (const [car, item] of cars) vehicles.set(car, item);
                if (loose) say('มีงานที่ยังไม่ระบุรถ ' + loose + ' แถว ไม่ได้ดึง');
                if (!cars.size) say('ยังไม่มีงานที่ระบุรถในวันนี้');
                dispatch = true;
                continue;
            }
            const has = (row, re) => [...row.cells.values()].some((t) => re.test(t));
            const journey = rows.slice(0, 8).find((r) => has(r, /^SCC$/) && has(r, /^ใช้รถจริง$/));
            // JC Report ไม่มีวันที่ในหัวชีต: วัน = ชื่อชีต เดือน/ปี = ชื่อไฟล์ (เช่น 11_2026)
            const month = journey && /(\d{1,2})[_\-](\d{4})/.exec(file.name);
            const written = headerDate(rows);
            const found = month ? iso(Number(month[2]), Number(month[1]), Number(date.slice(8))) : written || (journey ? date : '');
            if (journey && !month && !written) say('ชื่อไฟล์ไม่บอกเดือน/ปี ตรวจสอบว่าเป็นแผนของเดือนนี้');
            if (found !== date) {
                say(found ? 'หัวชีตเป็นวันที่ ' + found.split('-').reverse().join('/') + ' ไม่ใช่ ' + want + ' จึงไม่ดึง'
                    : 'หาวันที่ในหัวชีตไม่เจอ จึงไม่ดึง');
                continue;
            }
            const header = rows.slice(0, 8).find((r) => has(r, /^SCC$/) || has(r, /^เบอร์รถ$/) || has(r, /^Reg\.?\s*Truck$/i));
            if (!header) { say('ไม่รู้จักรูปแบบแผนงานนี้'); continue; }
            const before = vehicles.size;
            let problem = '';
            if (journey) readJourney(rows, journey, shift, add, moved);
            else if (has(header, /^Reg\.?\s*Truck$/i)) readNpm(rows, header, add);
            else if (has(header, /^SCC$/)) readDaily(rows, header, shift, add);
            else if (has(header, /ชื่อพขร/)) problem = readConfirm(rows, header, shift, add, moved);
            else readShell(rows, header, shift, add);
            if (problem) say(problem);
            else if (vehicles.size === before && !journey && !has(header, /^Reg/i)) say('ไม่พบรถใหม่ของกะนี้');
        } catch (err) {
            console.error(err);
            say('อ่านไม่ได้ (' + err.message + ')');
        }
    }
    for (const [no, what] of misplaced) notes.push(sccName(no) + ': อ่าน ' + [...what].join(', ') + ' จากช่องที่ใส่ผิดที่ ตรวจก่อนกดตกลง');
    // รถจอดซ่อม/ไม่มีงาน ไม่ต้องเติมอะไร
    for (const [no, v] of vehicles) if (!v.driver && !v.trips.length) vehicles.delete(no);
    return { vehicles, notes, dispatch };
}
