// เทียบแผนงานที่อัปซ้ำกับงานที่มีอยู่ ว่าของคันนั้นเปลี่ยนอะไรบ้าง

const same = (text) => String(text || '').replace(/\s+/g, ' ').trim();

/** ปลายทางทีละแห่ง (แผนคั่นหลายแห่งด้วย //) พร้อมเลข Shipment ของงานนั้น */
export function destList(trips) {
    const list = [];
    for (const t of trips) {
        for (const part of String(t.cust || t.ship || '').split(/\/{2,}/)) {
            const name = same(part);
            if (name && !list.some((d) => d.name === name)) list.push({ name, ship: same(t.cust ? t.ship : '') });
        }
    }
    return list;
}

/**
 * @returns {{type:'changed'|'added'|'removed'|'ship'|'driver', name:string, from?:string}[]} ว่าง = ไม่เปลี่ยน
 */
export function diffPlan(v, item) {
    const changes = [];
    if (item.driver && same(v.driver) && same(item.driver) !== same(v.driver)) {
        changes.push({ type: 'driver', name: same(item.driver), from: same(v.driver) });
    }
    if (!item.trips.length) return changes; // ไฟล์ใหม่ไม่บอกงานของคันนี้ = ไม่แตะงาน
    const before = destList(v.trips);
    const after = destList(item.trips);
    const added = after.filter((a) => !before.some((b) => b.name === a.name));
    const removed = before.filter((b) => !after.some((a) => a.name === b.name));
    // ตัดออก 1 แห่ง + เพิ่ม 1 แห่ง = เปลี่ยนจากอันเก่าเป็นอันใหม่
    added.forEach((a, i) => changes.push(removed[i]
        ? { type: 'changed', name: a.name, from: removed[i].name }
        : { type: 'added', name: a.name }));
    for (const r of removed.slice(added.length)) changes.push({ type: 'removed', name: r.name });
    for (const a of after) {
        const b = before.find((x) => x.name === a.name);
        if (b && a.ship && b.ship && a.ship !== b.ship) changes.push({ type: 'ship', name: a.name, from: b.ship, to: a.ship });
    }
    return changes;
}

/** รวมกับประวัติเดิม: เก็บการเปลี่ยนล่าสุดของแต่ละรายการ */
export function mergeChanges(old, fresh, trips, at) {
    const names = destList(trips).map((d) => d.name);
    const keep = (old || []).filter((c) => {
        if (fresh.some((f) => f.type === c.type && (f.type === 'driver' || f.name === c.name))) return false;
        if (c.type === 'driver') return true;
        return c.type === 'removed' ? !names.includes(c.name) : names.includes(c.name);
    });
    return [...keep, ...fresh.map((c) => ({ ...c, at }))];
}

/** ข้อความอธิบายการเปลี่ยน 1 รายการ */
export function describe(c) {
    if (c.type === 'driver') return 'คนขับเปลี่ยนจาก ' + c.from + ' เป็น ' + c.name;
    if (c.type === 'changed') return 'เปลี่ยนจาก ' + c.from + ' เป็น ' + c.name;
    if (c.type === 'ship') return 'Shipment เปลี่ยนจาก ' + c.from + ' เป็น ' + c.to;
    return (c.type === 'added' ? 'เพิ่มงาน ' : 'ตัดงาน ') + c.name;
}
