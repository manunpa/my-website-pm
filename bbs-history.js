// ประวัติพฤติกรรม พขร. จากชีตแดชบอร์ดของ my-web-p3 — อ่านมาแสดงอย่างเดียว เก็บในหน่วยความจำ ไม่บันทึกที่ไหน
// สคริปต์ฝั่งนั้น: my-web-p3/apps-script/driver-behavior.gs
export const HISTORY_URL = 'https://script.google.com/macros/s/AKfycbybNbKmgyu8krqHAAa334UxWZoiQ1w65zCEqPhweyDvLh0u92FMXlahmyMMdQOrbH29/exec';

const TITLES = /^(นางสาว|น\.ส\.|นาย|นาง|mrs?\.|ms\.|miss )\s*/i;

/** ชื่อ+นามสกุลแบบไม่มีคำนำหน้า/ช่องว่าง มีแค่ชื่อเดียว = ไม่เทียบ (กันขึ้นผิดคน) */
export function nameKey(name) {
    const words = String(name || '').replace(/\(.*?\)/g, ' ').trim().replace(TITLES, '').split(/\s+/).filter(Boolean);
    return words.length < 2 ? '' : words.join('').toLowerCase();
}

/** [[พขร, วันที่, ประเภท, ชนิด, ความเสี่ยง]] -> Map(ชื่อ -> รายการ ใหม่สุดก่อน) */
export function indexHistory(rows) {
    const map = new Map();
    const text = (t) => (t && t !== '-' ? t : '');
    for (const [driver, date, behavior, offense, risk] of rows) {
        const key = nameKey(driver);
        if (!key) continue;
        if (!map.has(key)) map.set(key, []);
        map.get(key).push({ date, what: [text(behavior), text(offense)].filter(Boolean).join(' · ') || 'ไม่ระบุ', risk: text(risk) });
    }
    for (const list of map.values()) list.sort((a, b) => b.date.localeCompare(a.date));
    return map;
}

export const thaiDate = (iso) => iso.split('-').reverse().join('/');
