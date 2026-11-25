// เทียบชื่อปลายทางในแผนงานกับชื่อสถานที่ที่ตรวจ เพื่อบอกว่า "ส่งแล้ว"
// ชื่อจาก GPS/รูป มักต่างจากแผน (คำนำหน้าบริษัท เว้นวรรค วรรณยุกต์ที่อ่านผิด) จึงตัดสิ่งเหล่านั้นออกก่อน
// ตั้งใจให้เข้มไว้ก่อน: ไม่แน่ใจ = ยังไม่ส่ง (คนกดเองได้) ดีกว่าขึ้นว่าส่งแล้วทั้งที่ยัง

const NOISE = /ห้างหุ้นส่วนจำกัด|บริษัท|บจก\.?|หจก\.?|หสน\.?|จำกัด|\(มหาชน\)|มหาชน|สาขาที่|สาขา|bsrc|bfpl|จ\.\s*[ก-๙]+/gi;

function plain(text) {
    return String(text || '')
        .replace(/ํา/g, 'ำ') // สระอำที่ถูกแยกเป็นสองตัว
        .replace(NOISE, ' ')
        .replace(/[็-๎]/g, '') // วรรณยุกต์/ไม้ไต่คู้
        .replace(/[^A-Za-z0-9ก-๙]/g, '')
        .toLowerCase();
}

// มี needle อยู่ใน hay ไหม ยอมให้สะกดเพี้ยนเล็กน้อยเมื่อชื่อยาวพอ
function has(hay, needle) {
    if (!needle) return false;
    if (hay.includes(needle)) return true;
    if (needle.length < 7) return false;
    const pairs = [...needle].slice(1).map((c, i) => needle[i] + c);
    for (let at = 0; at <= hay.length - needle.length + 1; at++) {
        const window = hay.slice(at, at + needle.length + 1);
        if (pairs.filter((p) => window.includes(p)).length / pairs.length >= 0.82) return true;
    }
    return false;
}

const split = (name) => ({
    core: plain(String(name).replace(/\([^)]*\)/g, ' ')),
    branch: plain((String(name).match(/\(([^)]*)\)/g) || []).join(' '))
});

/**
 * @param {string} place สถานที่ที่ตรวจ
 * @param {string} name ปลายทางในแผน
 * @param {string[]} others ปลายทางทั้งหมดของรถคันนั้น (ใช้แยกสาขาที่ชื่อบริษัทเดียวกัน)
 */
export function samePlace(place, name, others = []) {
    const { core, branch } = split(name);
    const p = plain(place);
    if (core.length < 4 || !has(p, core)) return false;
    if (!branch) return true;
    if (has(p, branch)) return true;
    // ไม่เจอสาขา: ยอมเฉพาะเมื่อสถานที่ไม่ได้ระบุสาขาอื่น และไม่มีปลายทางอื่นชื่อบริษัทเดียวกัน
    return !/\(/.test(place) && others.filter((o) => split(o).core === core).length <= 1;
}
