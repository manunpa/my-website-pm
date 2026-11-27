// อ่าน "รูปแผนงาน" ของ TOYOTA (ภาพตารางจ่ายงาน) ทีละช่องตามเส้นตาราง — ถอดข้อความในเบราว์เซอร์ รูปไม่ถูกส่งออกจากเครื่อง
// คอลัมน์นับจากเบอร์รถ: รถ | กะ | พขร.1 | พขร.2 | ตรวจเช็คเทรลเลอร์ Plan/Actual | Tenko Plan/Actual | งาน Plan/Actual | เวลารับงาน | ที่รับ | ที่ลง

const TESSERACT = 'https://cdn.jsdelivr.net/npm/tesseract.js@5.1.1/dist/tesseract.min.js';
const AT = { car: 0, shift: 1, driver: 2, driver2: 3, plan: 8, actual: 9, time: 10, from: 11, to: 12 };
let workers = null;

function loadScript(src) {
    return new Promise((resolve, reject) => {
        const script = document.createElement('script');
        script.src = src;
        script.onload = resolve;
        script.onerror = () => reject(new Error('โหลดตัวอ่านรูปไม่ได้ ตรวจสอบอินเทอร์เน็ต'));
        document.head.append(script);
    });
}

function ready() {
    workers ||= (async () => {
        if (!window.Tesseract) await loadScript(TESSERACT);
        const make = async (languages) => {
            const worker = await window.Tesseract.createWorker(languages);
            await worker.setParameters({ tessedit_pageseg_mode: '7' }); // 1 ช่อง = 1 บรรทัด
            return worker;
        };
        return { eng: await make('eng'), tha: await make('tha'), both: await make(['tha', 'eng']) };
    })().catch((err) => { workers = null; throw err; });
    return workers;
}

// รวมพิกเซลเส้นที่ติดกันเป็นเส้นเดียว
const merged = (list) => list.reduce((out, v) => {
    if (out.length && v - out[out.length - 1] <= 2) out[out.length - 1] = v;
    else out.push(v);
    return out;
}, []);

async function openImage(blob) {
    const image = await createImageBitmap(blob);
    const scale = image.width < 900 ? 1000 / image.width : 1;
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(image.width * scale);
    canvas.height = Math.round(image.height * scale);
    const g = canvas.getContext('2d', { willReadFrequently: true });
    g.drawImage(image, 0, 0, canvas.width, canvas.height);
    const { width: W, height: H } = canvas;
    const data = g.getImageData(0, 0, W, H).data;
    const dark = (x, y) => {
        const i = (y * W + x) * 4;
        return data[i] < 120 && data[i + 1] < 120 && data[i + 2] < 120;
    };
    const share = (length, test) => {
        let n = 0;
        for (let i = 0; i < length; i++) if (test(i)) n++;
        return n / length;
    };
    const ys = merged([...Array(H).keys()].filter((y) => share(W, (x) => dark(x, y)) > 0.55));
    const xs = merged([...Array(W).keys()].filter((x) => share(H, (y) => dark(x, y)) > 0.45));
    return { canvas, g, xs, ys };
}

// ตัดช่องแล้วขยายเป็นภาพเทา (คงขอบตัวอักษรไว้ ตัวอ่านแม่นกว่าทำขาวดำเอง) ช่องว่างคืน null
function crop(sheet, col, row) {
    const x = sheet.xs[col] + 2;
    const y = sheet.ys[row] + 2;
    const w = sheet.xs[col + 1] - x - 2;
    const h = sheet.ys[row + 1] - y - 2;
    if (w < 6 || h < 6) return null;
    const { data } = sheet.g.getImageData(x, y, w, h);
    let low = 255;
    let high = 0;
    for (let i = 0; i < data.length; i += 4) {
        const grey = (data[i] * 3 + data[i + 1] * 6 + data[i + 2]) / 10;
        if (grey < low) low = grey;
        if (grey > high) high = grey;
    }
    if (high - low < 60) return null; // พื้นเรียบ ไม่มีตัวหนังสือ
    const out = document.createElement('canvas');
    out.width = w * 4 + 40;
    out.height = h * 4 + 40;
    const g = out.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, out.width, out.height);
    g.filter = 'grayscale(1) contrast(1.6)';
    g.drawImage(sheet.canvas, x, y, w, h, 20, 20, w * 4, h * 4);
    return out;
}

const read = async (worker, canvas) => (canvas ? (await worker.recognize(canvas)).data.text.replace(/\s+/g, ' ').trim() : '');

// ===== แก้คำที่อ่านเพี้ยน =====
const carName = (text) => {
    const m = /[S5$][CcG(]\s?[O0oQ]?\s?([0-9Oo]{2,3})(?!\d)/i.exec(text);
    return m ? 'SC' + m[1].replace(/o/gi, '0').padStart(3, '0') : '';
};
const clock = (text) => {
    const m = /(\d{1,2})\s?[:.]\s?(\d{2})/.exec(text);
    return m && Number(m[1]) < 24 && Number(m[2]) < 60 ? m[1].padStart(2, '0') + ':' + m[2] : '';
};
// รหัสงาน/สถานที่: แก้คู่ตัวอักษรที่ตัวอ่านสับสนบ่อย (LCE/1CB → LCB, EP → BP, WO1 → W01)
const places = (text) => text.replace(/[1I]C[BE]|LC[E8]+/g, 'LCB').replace(/\bEP|\bB+P/g, 'BP').replace(/([WMS])[Oo](?=\d)/g, '$10')
    .replace(/BP25R[A-Z]{0,2}/gi, 'BP25rai');
const code = (text) => places(text.toUpperCase().replace(/\s+/g, '').replace(/[^A-Z0-9\-+/]/g, '')
    .replace(/^[-+/]+|[-+/]+$/g, ''));

const plain = (name) => String(name || '').replace(/^\s*(นางสาว|น\.ส\.|นาย|นาง)/, '').replace(/[^ก-๙A-Za-z]/g, '');
// ตัดวรรณยุกต์/การันต์ ตัวอ่านรูปมักพลาดตรงนี้
const bare = (name) => plain(name).replace(/[็-๎]/g, '');

function distance(a, b) {
    let row = [...Array(b.length + 1).keys()];
    for (let i = 1; i <= a.length; i++) {
        const next = [i];
        for (let j = 1; j <= b.length; j++) next[j] = Math.min(next[j - 1] + 1, row[j] + 1, row[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
        row = next;
    }
    return row[b.length];
}

/** ชื่อที่อ่านได้ → ชื่อในรายชื่อกลุ่มเสี่ยงที่ใกล้ที่สุด (ต่างเกิน 30% = ใช้ตามที่อ่าน) */
export function closestName(text, names) {
    const got = bare(text);
    if (got.length < 4) return '';
    let best = null;
    for (const name of names) {
        const score = distance(got, bare(name)) / Math.max(got.length, bare(name).length);
        if (!best || score < best.score) best = { name, score };
    }
    if (best && best.score <= 0.3) return best.name.trim();
    return /^[ก-๙]{3,}.*\s[ก-๙]{3,}/.test(text) ? text.replace(/[^ก-๙\s]/g, '').trim() : '';
}

/**
 * @param {Blob[]} blobs รูปแผนของวันเดียวกัน
 * @param {string[]} names รายชื่อ พขร. ของฟอร์ม
 * @returns {Promise<{rows:object[], notes:string[]}>} 1 แถว = 1 งาน {car, shift, driver, driver2, code, time, from, to}
 */
export async function readPlanShots(blobs, names, progress = () => {}) {
    const { eng, tha, both } = await ready();
    const rows = [];
    const notes = [];
    for (const [index, blob] of blobs.entries()) {
        const label = blob.name || 'รูปที่ ' + (index + 1);
        const sheet = await openImage(blob);
        const lines = sheet.ys.length - 1;
        // หาคอลัมน์เบอร์รถ: คอลัมน์ซ้ายที่อ่านได้ SC### มากที่สุด
        let first = -1;
        let most = 0;
        for (let col = 0; col < Math.min(3, sheet.xs.length - AT.to - 1); col++) {
            let found = 0;
            for (let row = 0; row < Math.min(lines, 10); row++) if (carName(await read(eng, crop(sheet, col, row)))) found++;
            if (found > most) [most, first] = [found, col];
        }
        if (first < 0) { notes.push(label + ': หาตารางแผนงานในรูปไม่เจอ ถ่ายให้เห็นเส้นตารางครบ'); continue; }

        let car = '';
        let last = null;
        let loose = 0;
        for (let row = 0; row < lines; row++) {
            progress(label + ' แถว ' + (row + 1) + '/' + lines);
            const cell = (key) => crop(sheet, first + AT[key], row);
            const shift = /[DN]/.exec((await read(eng, cell('shift'))).toUpperCase())?.[0];
            if (!shift) continue;
            const own = carName(await read(eng, cell('car')));
            const driver = closestName(await read(tha, cell('driver')), names);
            const plan = code(await read(eng, cell('plan')));
            const actual = code(await read(eng, cell('actual')));
            // แถวไม่มีเบอร์รถ: งานต่อของคนเดิม ถ้าเป็นคนอื่นคือยังไม่ได้จ่ายรถ
            if (own) car = own;
            else if (!last || !driver || plain(driver) !== plain(last.driver)) {
                if (driver) loose++;
                car = '';
                continue;
            }
            if (!car || !driver) continue;
            last = {
                car, shift, driver,
                driver2: closestName(await read(tha, cell('driver2')), names),
                code: actual.length >= 4 ? actual : plan,
                time: clock(await read(eng, cell('time'))),
                from: code(await read(eng, cell('from'))),
                to: places((await read(both, cell('to'))).replace(/[|_[\]]/g, '').trim())
            };
            rows.push(last);
        }
        if (loose) notes.push(label + ': มี ' + loose + ' แถวที่ยังไม่มีเบอร์รถ ไม่ได้ดึง');
    }
    return { rows, notes };
}

/** แถวที่ตรวจแล้ว → รูปเดียวกับแผนอื่น: Map<"SC001" | "SC001 (2)", ข้อมูล> */
export function shotPlan(rows) {
    const cars = new Map();
    for (const row of rows) {
        const crews = cars.get(row.car) || [];
        cars.set(row.car, crews);
        const id = row.shift + plain(row.driver);
        let crew = crews.find((c) => c.id === id);
        if (!crew) crews.push(crew = { id, shift: row.shift, driver: row.driver, driver2: row.driver2, jobs: [] });
        crew.driver2 ||= row.driver2;
        crew.jobs.push(row);
    }
    const vehicles = new Map();
    for (const [car, crews] of cars) {
        crews.forEach((crew, i) => {
            const route = [...new Set(crew.jobs.map((j) => j.code).filter(Boolean))].join(' / ');
            const jobs = crew.jobs.map((j) => [j.time, [j.from, j.to].filter(Boolean).join(' → ')].filter(Boolean).join(' '));
            vehicles.set(i ? car + ' (' + (i + 1) + ')' : car, {
                driver: crew.driver, driver2: crew.driver2, risk: '', riskIfEmpty: '', route,
                ...(crew.driver2 ? { route2: route } : {}),
                planShift: crew.shift,
                remark: ['กะ ' + (crew.shift === 'D' ? 'เช้า' : 'ดึก'), ...jobs].filter(Boolean).join(' · '),
                trips: crew.jobs.map((j) => ({ ship: '', custId: '', cust: j.code || j.to }))
            });
        });
    }
    return vehicles;
}
