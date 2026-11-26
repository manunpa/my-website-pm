// อ่านไฟล์แผนงานจากหน่วยงาน ดึงเฉพาะ "วันที่ + กะ" ที่เลือกบนหน้าเว็บ (อ่านในเบราว์เซอร์ ไม่อัปโหลดไปไหน)
// รองรับ 3 แบบ: 1.1 Daily Report LLK / Plan Operation (SHELL LLK) / Confirm fleet SRC
import { openBook, els, colOf, rowNum } from './bbs-xlsx.js?v=10';

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
        const m = /^\s*0?(\d{1,2})\s*([.\-]\s*\d{0,2})?\s*$/.exec(s.getAttribute('name'));
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

// "ก // ข" + "111 / 222" → 2 งาน ถ้าจำนวนไม่เท่ากันเก็บรวมเป็นงานเดียว
function splitTrips(ship, cust) {
    const ships = ship.split(/\/+/).map((s) => s.trim()).filter(Boolean);
    const custs = cust.split(/\/{2,}/).map((s) => s.trim()).filter(Boolean);
    if (ships.length > 1 && ships.length === custs.length) return ships.map((s, i) => ({ ship: s, cust: custs[i] }));
    return ship || cust ? [{ ship, cust }] : [];
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
function readJourney(rows, header, shift, add) {
    const nth = (re) => [...header.cells].filter(([, t]) => re.test(t)).map(([c]) => c)[shift === 'night' ? 1 : 0];
    const cols = { scc: nth(/^SCC$/), driver: nth(/^พขร/), cust: nth(/^ลูกค้า/) };
    const cars = new Map();
    let current = '';
    for (const row of rows.filter((r) => r.n > header.n)) {
        if ([...row.cells.values()].some((t) => /^(รวม|สรุป)/.test(t))) break;
        const no = vehicleNo(row.cells.get(cols.scc));
        if (no) current = no;
        if (!current) continue;
        const car = cars.get(current) || { drivers: [], custs: [] };
        cars.set(current, car);
        const driver = row.cells.get(cols.driver) || '';
        if (driver) car.drivers.push(driver);
        const cust = row.cells.get(cols.cust) || '';
        if (cust && !/^(SPARE|ไม่มีงาน)$/i.test(cust)) car.custs.push(cust);
    }
    for (const [no, car] of cars) {
        const loader = car.drivers.find((d, i) => i > 0 && /โหลด/.test(d)) || car.drivers[1] || '';
        add(no, {
            replace: true,
            driver: car.drivers[0] || '',
            driver2: loader,
            trips: car.custs.map((cust) => ({ ship: '', custId: '', cust }))
        });
    }
}

// ===== Confirm fleet SRC (งานเย็น = กะกลางคืน): กลุ่มคอลัมน์ พขร./ลูกค้า/NOM มี 2 ชุด =====
function readConfirm(rows, header, shift, add) {
    if (shift !== 'night') return 'เป็นแผนงานเย็น ใช้กับกะกลางคืนเท่านั้น';
    const cols = (re) => [...header.cells].filter(([, t]) => re.test(t)).map(([c]) => c);
    const [scc] = cols(/เบอร์รถ/);
    const drivers = cols(/ชื่อพขร/);
    const custs = cols(/^ลูกค้า/);
    const noms = cols(/^NOM/i);
    const [risk] = cols(/risk/i);
    const [plate] = cols(/^ทะเบียน/);
    for (const row of rows.filter((r) => r.n > header.n)) {
        const no = vehicleNo(row.cells.get(scc));
        if (!no) continue;
        drivers.forEach((c, i) => {
            const driver = row.cells.get(c) || '';
            const names = (row.cells.get(custs[i]) || '').split(/\/+/).map((s) => s.trim()).filter(Boolean);
            const nom = row.cells.get(noms[i]) || '';
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

/**
 * @param {File[]} files
 * @param {string} date 'YYYY-MM-DD'
 * @param {'day'|'night'} shift
 * @returns {Promise<{vehicles:Map<string,{driver:string,risk:string,riskIfEmpty:string,trips:object[]}>, notes:string[]}>}
 */
export async function readPlans(files, date, shift) {
    const vehicles = new Map();
    const notes = [];
    const add = (no, item) => {
        const v = vehicles.get(no) || { driver: '', risk: '', riskIfEmpty: '', trips: [] };
        v.plate ||= item.plate || '';
        if (item.replace) { // แผน NPM: ไฟล์หลังคือฉบับแก้ ใช้ทับของเดิม
            v.driver = item.driver || v.driver;
            v.remark = item.remark;
            v.driver2 = item.driver2;
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
    for (const file of files) {
        const say = (text) => notes.push(file.name + ': ' + text);
        try {
            const rows = await daySheet(await file.arrayBuffer(), Number(date.slice(8)));
            if (!rows) { say('ไม่มีชีตของวันที่ ' + Number(date.slice(8))); continue; }
            const has = (row, re) => [...row.cells.values()].some((t) => re.test(t));
            const journey = rows.slice(0, 8).find((r) => has(r, /^SCC$/) && has(r, /^ใช้รถจริง$/));
            // JC Report ไม่มีวันที่ในหัวชีต: วัน = ชื่อชีต เดือน/ปี = ชื่อไฟล์ (เช่น 11_2026)
            const month = journey && /(\d{1,2})[_\-](\d{4})/.exec(file.name);
            const found = month ? iso(Number(month[2]), Number(month[1]), Number(date.slice(8))) : headerDate(rows) || (journey ? date : '');
            if (journey && !month) say('ชื่อไฟล์ไม่บอกเดือน/ปี ตรวจสอบว่าเป็นแผนของเดือนนี้');
            if (found !== date) {
                say(found ? 'หัวชีตเป็นวันที่ ' + found.split('-').reverse().join('/') + ' ไม่ใช่ ' + want + ' จึงไม่ดึง'
                    : 'หาวันที่ในหัวชีตไม่เจอ จึงไม่ดึง');
                continue;
            }
            const header = rows.slice(0, 8).find((r) => has(r, /^SCC$/) || has(r, /^เบอร์รถ$/) || has(r, /^Reg\.?\s*Truck$/i));
            if (!header) { say('ไม่รู้จักรูปแบบแผนงานนี้'); continue; }
            const before = vehicles.size;
            let problem = '';
            if (journey) readJourney(rows, journey, shift, add);
            else if (has(header, /^Reg\.?\s*Truck$/i)) readNpm(rows, header, add);
            else if (has(header, /^SCC$/)) readDaily(rows, header, shift, add);
            else if (has(header, /ชื่อพขร/)) problem = readConfirm(rows, header, shift, add);
            else readShell(rows, header, shift, add);
            if (problem) say(problem);
            else if (vehicles.size === before && !journey && !has(header, /^Reg/i)) say('ไม่พบรถใหม่ของกะนี้');
        } catch (err) {
            console.error(err);
            say('อ่านไม่ได้ (' + err.message + ')');
        }
    }
    // รถจอดซ่อม/ไม่มีงาน ไม่ต้องเติมอะไร
    for (const [no, v] of vehicles) if (!v.driver && !v.trips.length) vehicles.delete(no);
    return { vehicles, notes };
}
