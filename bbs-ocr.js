// อ่านเวลาและสถานที่จากภาพหน้าจอระบบติดตามรถ (ถอดข้อความในเบราว์เซอร์ รูปไม่ถูกส่งออกจากเครื่อง)
// รองรับ 4 แบบ: ตารางหลายคัน / รายการรถ (ไม่มีเวลา) / การ์ดรถคันเดียว / หน้าจอกล้อง (เวลากล่อง + ตำแหน่ง)

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
let workerReady = null;

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error('โหลดตัวอ่านรูปไม่ได้ ตรวจสอบอินเทอร์เน็ต'));
        document.head.append(script);
    });
}

function worker() {
    workerReady ||= (async () => {
        if (!window.Tesseract) await loadScript(TESSERACT);
        return window.Tesseract.createWorker(['tha', 'eng']);
    })().catch((err) => { workerReady = null; throw err; });
    return workerReady;
}

// ขยายก่อน ตัวหนังสือหน้าจอเล็กจะอ่านแม่นขึ้น
async function enlarge(blob) {
    const image = await createImageBitmap(blob);
    const scale = image.width < 1000 ? 3 : image.width < 2200 ? 2 : 1;
    const canvas = document.createElement('canvas');
    canvas.width = image.width * scale;
    canvas.height = image.height * scale;
    const g = canvas.getContext('2d');
    g.filter = 'grayscale(1) contrast(1.2)';
    g.drawImage(image, 0, 0, canvas.width, canvas.height);
    return canvas;
}

/** ถอดข้อความจากรูป */
export async function readImage(blob) {
    const reader = await worker();
    return (await reader.recognize(await enlarge(blob))).data.text;
}

/** อ่านชื่อคนขับจากรูปตาราง GPS: ไอคอนสถานะหน้าเบอร์รถกวนตัวอ่าน จึงตัดคอลัมน์ซ้ายทิ้งแล้วอ่านซ้ำ */
export async function readDrivers(blob) {
    const reader = await worker();
    const canvas = await enlarge(blob);
    const first = (await reader.recognize(canvas)).data;
    const xs = (first.words || []).filter((w) => /^\d{2}-\d{4}$/.test(w.text)).map((w) => w.bbox.x0).sort((a, b) => a - b);
    if (!xs.length) return parseDrivers(first.text);
    const x = Math.max(0, xs[xs.length >> 1] - 16);
    const cut = document.createElement('canvas');
    cut.width = canvas.width - x;
    cut.height = canvas.height;
    cut.getContext('2d').drawImage(canvas, -x, 0);
    const second = parseDrivers((await reader.recognize(cut)).data.text);
    const more = parseDrivers(first.text).filter((d) => !second.some((s) => s.plate === d.plate));
    return [...second, ...more];
}

const DATE_TIME = /(\d{1,2})[/.](\d{1,2})[/.](\d{4})\s+(\d{1,2})[:.](\d{2})[:.](\d{2})/;
const two = (n) => String(n).padStart(2, '0');

// หารถในบรรทัด: ทะเบียนตรงกัน หรือเลขรถที่อยู่ในคำขึ้นต้นแบบ SCC (OCR มักอ่าน SCC เป็น 566/5CC)
function findVehicle(line, vehicles) {
    const words = line.split(/\s+/);
    const digits = words.map((w) => w.replace(/\D/g, ''));
    for (const v of vehicles) {
        const plate = String(v.plate || '').split('/')[0].replace(/\D/g, '');
        if (plate.length >= 6 && digits.some((d) => d.includes(plate))) return v;
    }
    for (const v of vehicles) {
        const no = v.scc.replace(/\D/g, '');
        const scc = new RegExp('[S5$][CcG6(][CcG6(0Oo][^\\s\\d]{0,3}0?' + no + '(?!\\d)', 'i');
        if (no && scc.test(line)) return v;
    }
    return null;
}

// ตัดไอคอนที่ OCR อ่านเป็นสัญลักษณ์หน้า/หลังชื่อสถานที่
const tidy = (text) => String(text || '')
    .replace(/^[^A-Za-z0-9ก-๙(]+/, '')
    .replace(/(\s+(\(\+\)|[®©@๐-๙|~=<>*+•_-]+|\[[^\]]*\]|Cy|\[ว))+\s*$/g, '')
    .replace(/\s{2,}/g, ' ')
    .trim();

function stamp(m) {
    if (!m) return null;
    let year = Number(m[3]);
    if (year > 2400) year -= 543;
    return { date: year + '-' + two(m[2]) + '-' + two(m[1]), time: two(m[4]) + ':' + m[5] + ':' + m[6] };
}

/**
 * @param {string} text ข้อความจาก OCR
 * @param {{scc:string, plate:string}[]} vehicles เฉพาะรถที่มีงาน
 * @returns {{v:object, date:string, time:string, place:string}[]} date/time ว่าง = ในรูปไม่มี
 */
export function parseShot(text, vehicles) {
    const lines = text.split('\n').map((l) => l.trim()).filter(Boolean);
    const found = lines.map((line) => ({ line, v: findVehicle(line, vehicles) }));
    const first = found.find((f) => f.v)?.v;

    // หน้าจอกล้อง: รถคันเดียว มีแค่เวลา (ไม่มีวันที่)
    const boxTime = /เวลากล่อง\D{0,12}(\d{1,2}):(\d{2}):(\d{2})/.exec(text);
    if (boxTime) {
        const place = lines.map((l) => /แหน่ง\s+(.+)$/.exec(l)?.[1]).filter(Boolean).at(-1);
        return first ? [{ v: first, date: '', time: two(boxTime[1]) + ':' + boxTime[2] + ':' + boxTime[3], place: tidy(place) }] : [];
    }

    // ตาราง: รถ + วันเวลา + สถานที่ อยู่บรรทัดเดียวกัน
    const table = found.filter((f) => f.v && DATE_TIME.test(f.line)).map((f) => {
        const m = DATE_TIME.exec(f.line);
        return { v: f.v, ...stamp(m), place: tidy(f.line.slice(m.index + m[0].length)) };
    });
    // การ์ดที่เบอร์รถกับเวลาอยู่หัวบรรทัดเดียวกัน (ไม่มีสถานที่ต่อท้าย) ให้ไปอ่านแบบการ์ด
    if (table.length > 1 || table[0]?.place) return table;

    // การ์ดรถคันเดียว: วันเวลาและที่อยู่คนละบรรทัดกับเบอร์รถ
    const at = lines.findIndex((l) => DATE_TIME.test(l));
    if (at >= 0) {
        if (!first) return [];
        const place = lines.slice(at + 1).find((l) => /[ก-๙]{3}/.test(l)) || '';
        return [{ v: first, ...stamp(DATE_TIME.exec(lines[at])), place: tidy(place) }];
    }

    // รายการรถ: สถานที่ต่อท้ายเบอร์รถ ไม่มีเวลาในรูป
    return found.filter((f) => f.v).map((f) => {
        const no = f.v.scc.replace(/\D/g, '');
        const after = f.line.slice(f.line.indexOf(no) + no.length).replace(/^[A-Za-z]{0,3}(?=\s)/, '');
        return { v: f.v, date: '', time: '', place: tidy(after) };
    });
}

/**
 * ตาราง Vehicle Status ของ GPS: ... หมายเลขรถ | ชื่อคนขับ | วันและเวลา ... เอาเฉพาะแถวที่มีชื่อ
 * @returns {{plate:string, name:string}[]}
 */
export function parseDrivers(text) {
    const ROW = /(?<!\d)(\d{2})\s?[-–—.]\s?(\d{4})(?!\d)(.*?)\d{1,2}\/\d{1,2}\/\d{4}/;
    return text.split('\n').flatMap((line) => {
        const m = ROW.exec(line);
        if (!m) return [];
        // ตัดเส้นตาราง/สัญลักษณ์ที่ OCR อ่านติดมาหัวท้ายชื่อ
        const name = m[3].replace(/^[^A-Za-zก-๙]+|[^A-Za-zก-๙.)]+$/g, '').replace(/[|\[\]_]/g, ' ').replace(/\s{2,}/g, ' ');
        return /[A-Za-zก-๙]{2}/.test(name) ? [{ plate: m[1] + '-' + m[2], name }] : [];
    });
}

/** เวลาในรูปอยู่ในกะที่เลือกไหม (เผื่อหัวท้าย 1 ชม.) — กันข้อมูลค้างจากวันก่อน */
export function inShift(item, date, shift) {
    if (!item.date) return true;
    const [y, m, d] = date.split('-').map(Number);
    const start = Date.UTC(y, m - 1, d, shift === 'night' ? 19 : 7);
    const [iy, im, id] = item.date.split('-').map(Number);
    const [hh, mm] = item.time.split(':').map(Number);
    const at = Date.UTC(iy, im - 1, id, hh, mm);
    return at >= start && at <= start + 14 * 3600000;
}
