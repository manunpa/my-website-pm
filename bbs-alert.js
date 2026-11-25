// จัดเนื้อหาที่โยนเข้ามาให้ตรงแพทเทินข้อความแจ้งเหตุใน LINE (จับจากคำสังเกต ไม่ใช้ AI)
// ช่องที่หาไม่เจอจะเว้นว่างไว้ให้เติมเอง ข้อความที่ไม่เข้าช่องไหนไม่ทิ้ง

export const ALERT_TYPES = {
    fatigue: 'Fatigue (ง่วง/หลับใน)',
    drive4: 'ขับต่อเนื่องเกิน 4 ชม.',
    speed: 'ความเร็วเกิน',
    adas: 'ADAS - DMS',
    rest: 'พักผ่อนไม่เพียงพอ'
};

export function detectType(text) {
    if (/พักผ่อน|วิ่งงานต่อเนื่อง|วิ่งต่อเนื่อง/.test(text)) return 'rest';
    if (/ต่อเนื่อง|4\s*ชม|จอดพักไม่ครบ/.test(text)) return 'drive4';
    if (/adas|เว้นระยะ|ระยะห่าง|headway|collision|phone call|eye clos/i.test(text)) return 'adas';
    if (/over\s*speed|ความเร็ว|กม\.?\s*\/\s*ชม/i.test(text)) return 'speed';
    return 'fatigue';
}

const TIME = /(?<![\d/.])([01]?\d|2[0-3])\s*[:.]\s*([0-5]\d)(?:\s*[:.]\s*[0-5]\d)?(?![\d/]|\.\d)\s*(?:น\.?)?/g;
const DATE = /(?<!\d)(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})(?!\d)/;
const COORDS = /(-?\d{1,2}\.\d{4,})\s*[, ]\s*(\d{2,3}\.\d{4,})/;
const DMS_COORDS = /(\d{1,2})°\s*(\d{1,2})'\s*([\d.]+)"\s*N\s*(\d{2,3})°\s*(\d{1,2})'\s*([\d.]+)"\s*E/;
const LINK = /https?:\/\/\S+/;
const PLATE = /(?<![\d-])(\d{2}-\d{4})(?![\d-])/;
const DRIVER = /(?:พขร\.?\s*[:：]?\s*)?((?:นาย|นางสาว|นาง|น\.ส\.)\s*[ก-๙]+(?:\s+[ก-๙]+)?)|พขร\.\s*(?!ออก|เดิน|ขับ|ให้|รับ|มี|จอด|หน่อย|เรื่อง|ท่าน|ทราบ)([ก-๙]{2,}\s+[ก-๙]{2,})/;
const PLACE = /^(สถานที่|ต\.|อ\.|จ\.|ตำบล|อำเภอ|จังหวัด|ถนน|ถ\.|ทางหลวง|ทางด่วน|กรุงเทพ|แขวง|เขต|จุดจอด|ปตท|คลัง|บางจาก|บ้าน|แยก|กม\.\d)/;
const ACTION = /^(การดำเนินการ|ดำเนินการ|เบื้องต้น|ฝาก|โทร|สั่ง|ให้จอด|เข้าไปสื่อสาร|เข้าสื่อสาร|สื่อสาร|แจ้ง|ประสาน|เน้นย้ำ|คุยกับ)/;

const SYMPTOM = /หาว|หลับ|ตา|เคลิ้ม|ง่วง|สัปหงก|เหม่อ|อาการ|ความเร็ว|เว้นระยะ|โทรศัพท์/;

const two = (n) => String(n).padStart(2, '0');
const clean = (s) => String(s || '').replace(/\s{2,}/g, ' ').replace(/^[\s:：,\-]+|[\s,\-]+$/g, '').trim();

function mapLink(text) {
    const link = LINK.exec(text)?.[0];
    if (link) return link;
    const c = COORDS.exec(text);
    if (c) return 'https://maps.google.com/?q=' + c[1] + ',' + c[2];
    const d = DMS_COORDS.exec(text);
    if (!d) return '';
    const dec = (a, b, s) => (Number(a) + Number(b) / 60 + Number(s) / 3600).toFixed(6);
    return 'https://maps.google.com/?q=' + dec(d[1], d[2], d[3]) + ',' + dec(d[4], d[5], d[6]);
}

/**
 * @param {string} raw เนื้อหาที่โยนเข้ามา
 * @param {{vehicles:object[], unit:string, date:string}} context ข้อมูลจากรายงานบนเว็บ (date = 'YYYY-MM-DD')
 */
export function parseAlert(raw, context) {
    const text = raw.replace(/\r/g, '');
    const out = { plate: PLATE.exec(text)?.[1] || '', link: mapLink(text), lines: [], places: [], actions: [], content: [] };

    // รถ: เบอร์ SCC หรือตัวเลขที่ตรงกับรถในรายงาน หรือทะเบียนตรงกัน
    const known = context.vehicles.map((v) => ({ v, no: v.scc.replace(/\D/g, '') }));
    const scc = /SCC\s*_*(\d{3,4})/i.exec(text)?.[1] ||
        known.find((k) => k.no && new RegExp('(?<![\\d:./-])' + k.no + '(?![\\d:./-])').test(text))?.no || '';
    const v = known.find((k) => k.no === scc)?.v ||
        known.find((k) => out.plate && String(k.v.plate).startsWith(out.plate))?.v;
    out.scc = v ? v.scc : scc ? 'SCC' + scc : '';
    out.plate ||= String(v?.plate || '').split('/')[0];

    const named = DRIVER.exec(text);
    out.driver = clean(named?.[1] || named?.[2] || v?.driver || '');
    const unit = /หน่วยงาน\s*[:：]?\s*([A-Za-z][A-Za-z0-9 \-]*[A-Za-z0-9])/.exec(text)?.[1];
    out.unit = clean(unit || context.unit);
    const date = DATE.exec(text);
    const [y, m, d] = context.date.split('-');
    out.date = date ? date[0] : d + '/' + m + '/' + (Number(y) + 543);
    out.by = /\bDMS\b/i.test(text) && /\bRSC\b/i.test(text) ? 'DMS/RSC' : /\bRSC\b/i.test(text) ? 'RSC' : /\bDMS\b/i.test(text) ? 'DMS' : '';
    out.times = [...text.replace(LINK, ' ').replace(COORDS, ' ').matchAll(TIME)].map((t) => two(t[1]) + ':' + t[2]);

    // แยกแต่ละบรรทัดเป็นวรรค ๆ (ภาษาไทยเว้นวรรคระหว่างใจความ) แล้วจัดเข้าช่อง
    for (const original of text.split('\n').map((l) => l.trim()).filter(Boolean)) {
        out.lines.push(original);
        const line = original
            .replace(LINK, ' ').replace(COORDS, ' ').replace(DMS_COORDS, ' ')
            .replace(DATE, ' ').replace(TIME, ' ')
            .replace(/SCC\s*_*\d{3,4}/gi, ' ').replace(PLATE, ' ')
            .replace(named?.[0] || /(?!)/, ' ')
            .replace(/(หน่วยงาน|เรียนหน่วยงาน)\s*[:：]?\s*[A-Za-z][A-Za-z0-9 \-]*[A-Za-z0-9]/, ' ')
            .replace(/(ตรวจพบโดย|พบเจอโดย)\s*[:：]?|\(?\b(DMS|RSC)\b(\/(DMS|RSC))?\)?(?!\s*-)/g, ' ')
            .replace(/(รถทะเบียน|ทะเบียน|รถเบอร์|เวลา|วันที่|พิกัด|พขร\.?)\s*[:：]?(?=\s|$)/g, ' ')
            .replace(v ? new RegExp('(?<![\\d])' + v.scc.replace(/\D/g, '') + '(?![\\d])', 'g') : /(?!)/, ' ')
            .replace(/shell\s*(llk|src)|bfpl[ \-]*(llk|src)?/gi, ' ');
        let mode = '';
        const part = { place: [], action: [], content: [] };
        const words = line.split(/\s+/).map((w) => w.trim()).filter((w) => clean(w));
        if (!SYMPTOM.test(line) && !words.some((w) => ACTION.test(w)) &&
            (COORDS.test(original) || words.some((w) => PLACE.test(w)))) mode = 'place';
        for (const word of words) {
            if (ACTION.test(word)) mode = 'action';
            else if (PLACE.test(word) && mode !== 'action') mode = 'place';
            else if (/^(ลักษณะอาการ|อาการ)/.test(word)) mode = '';
            part[mode || 'content'].push(word);
        }
        const join = (list) => clean(list.join(' ').replace(/^(สถานที่|การดำเนินการ|ดำเนินการ|ลักษณะอาการ)\s*[:：]?/, ''));
        for (const [key, target] of [['place', 'places'], ['action', 'actions'], ['content', 'content']]) {
            const value = join(part[key]);
            if (value) out[target].push(value);
        }
    }
    return out;
}

// เวลาต่าง (นาที) ข้ามเที่ยงคืนได้
function minutesBetween(a, b) {
    const m = (t) => Number(t.slice(0, 2)) * 60 + Number(t.slice(3));
    return (m(b) - m(a) + 1440) % 1440;
}

// เวลาในงานขับต่อเนื่อง: ดูจากคำในบรรทัดเดียวกัน ถ้าไม่บอกให้เรียงตามลำดับ ออก → ถึงจุดพัก → ขับออก
function driveParts(p) {
    const out = { start: '', from: '', stop: '', at: '', leave: '', alarm: '' };
    const spare = [];
    for (const line of p.lines) {
        const times = [...line.matchAll(TIME)].map((t) => two(t[1]) + ':' + t[2]);
        const name = (re) => clean((re.exec(line)?.[1] || '').replace(TIME, ' ').replace(/\s*เวลา\s*$/, ''));
        if (/alarm|leo/i.test(line)) out.alarm ||= times[0] || '';
        else if (/ขับออก|ออกจากจุดพัก/.test(line)) out.leave ||= times[0] || '';
        else if (/ออกจาก|ออกเดินทาง/.test(line)) {
            out.start ||= times[0] || '';
            out.from ||= name(/ออก(?:เดินทาง)?(?:จาก)?\s*(.*)/);
        } else if (/จอด|พักที่/.test(line) && times.length) {
            out.stop ||= times[0];
            out.at ||= name(/(?:จอดพัก|พัก|จอด)\s*(?:ที่)?\s*(.*)/);
            out.leave ||= times[1] || '';
        } else spare.push(...times);
    }
    for (const key of ['start', 'stop', 'leave']) out[key] ||= spare.shift() || '';
    return out;
}

const join = (...lines) => lines.flat().filter((l) => l !== null).join('\n').replace(/\n{3,}/g, '\n\n').trim();
const na = (t) => (t ? t + ' น.' : '');

export function formatAlert(type, p) {
    const content = p.content.join(' ');
    const action = p.actions.join('\n');
    const car = [p.scc, p.plate].filter(Boolean).join(' ');
    const place = p.places.join(' ');
    if (type === 'fatigue') {
        return join('🔴Fatigue',
            'ตรวจพบโดย : ' + (p.by ? '(' + p.by + ')' : '(DMS/RSC)'),
            'หน่วยงาน : ' + p.unit,
            'รถทะเบียน : ' + car,
            'พขร : ' + p.driver,
            'เวลา : ' + p.date + (p.times[0] ? ' เวลา ' + na(p.times[0]) : ''),
            'สถานที่ : ' + place,
            'พิกัด : ' + p.link,
            '',
            'ลักษณะอาการ : ' + content,
            'การดำเนินการ : ' + action);
    }
    if (type === 'drive4') {
        const d = driveParts(p);
        const rest = d.stop && d.leave ? minutesBetween(d.stop, d.leave) : null;
        return join('🔴 แจ้งพบความเสี่ยง Driving',
            'เรียนหน่วยงาน ' + p.unit,
            'วันที่ ' + p.date,
            p.scc + ' ทะเบียน ' + p.plate,
            'พขร.' + p.driver,
            'ขับขี่ต่อเนื่องเกิน 4 ชม.',
            '',
            'พขร.เดินทางออกจาก' + d.from + ' ' + na(d.start),
            'และมาจอดพัก ที่ ' + d.at + ' ' + na(d.stop),
            d.leave ? 'และขับออก ' + na(d.leave) : null,
            rest === null ? null : 'พักเป็นเวลา ' + rest + ' นาที' + (rest < 30 ? ' โดยจอดพักไม่ครบ 30 นาที' : ''),
            d.alarm ? ['', 'ได้ Alarm ขับขี่ต่อเนื่อง เข้ามาในระบบ Leo system ในเวลา ' + na(d.alarm)] : null,
            action || 'ฝากหัวหน้างานสื่อสารเรื่องการจอดพักให้ครบ 30 นาที');
    }
    if (type === 'speed') {
        const all = p.lines.join(' ');
        const count = /(\d+)\s*ครั้ง/.exec(all)?.[1];
        const top = /(\d{2,3})\s*กม/.exec(all)?.[1];
        return join('เรียนหน่วยงาน ' + p.unit,
            p.date,
            car,
            'พขร.' + p.driver,
            'พบ overspeed',
            (count || '__') + ' ครั้ง ความเร็วสูงสุด อยู่ที่ ' + (top || '__') + ' กม/ชม',
            place ? 'สถานที่ : ' + place : null,
            p.link ? 'พิกัด : ' + p.link : null,
            action || 'เบื้องต้นแจ้งหัวหน้างานสื่อสารแล้ว');
    }
    if (type === 'adas') {
        return join('🔴 พบความเสี่ยงจากระบบ ADAS - DMS',
            content.replace(/ADAS\s*-?\s*(DMS)?/i, '').replace(/พบความเสี่ยงจากระบบ/, '').trim(),
            'หน่วยงาน ' + p.unit,
            'รถเบอร์ ' + p.scc,
            'รถทะเบียน ' + p.plate,
            '',
            'พขร.' + p.driver,
            'วันที่ ' + p.date + (p.times[0] ? ' ' + na(p.times[0]) : ''),
            'สถานที่ : ' + place,
            'พิกัด : ' + p.link,
            '',
            action || 'ฝากหน้างานสื่อสารพขร.ท่านนี้เพื่อความปลอดภัยอีกครั้ง');
    }
    // พักผ่อนไม่เพียงพอ: ลำดับเหตุการณ์เป็นข้อความอิสระ คงบรรทัดตามที่พิมพ์ ตัดเฉพาะส่วนหัว
    const body = p.lines.filter((l) => !/^(SCC|\d{3,4}$|พขร|หน่วยงาน|รถทะเบียน|ทะเบียน|ชั่วโมงพักผ่อน)/i.test(l) &&
        !/^SCC?\d{3,4}\s*$/i.test(l) && l.replace(/SCC\s*\d{3,4}|\d{2}-\d{4}|\d{3,4}/gi, '').trim());
    return join('🔴 ชั่วโมงพักผ่อนก่อนวิ่งงานไม่เพียงพอ',
        '(วิ่งงานต่อเนื่อง)',
        'หน่วยงาน ' + p.unit,
        'รถทะเบียน ' + car,
        'พขร.' + p.driver,
        '',
        body,
        '',
        action ? null : 'เบื้องต้นเน้นย้ำพขร.เรื่องเหนื่อยล้าขณะเดินทางให้รีบจอดพักหรือใช้ปุ่มช่วยเหลือ');
}
