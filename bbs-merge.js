// รวมรายงานเดียวกัน (ฟอร์ม/วัน/กะ) ที่กรอกจากหลายเครื่อง ไม่ให้ของใครทับของใคร
// - รอบตรวจ: เก็บของทุกคน แยกด้วย id รอบเดียวกันที่แก้สองที่ เอาอันที่แก้ล่าสุด
// - รอบที่ลบ: จดไว้ใน report.gone ไม่ให้เครื่องอื่นเอากลับมา
// - ข้อมูลรถ (คนขับ งาน สถานะ): เอาของที่แก้ล่าสุดทั้งชุดของคันนั้น

const INFO = ['plate', 'driver', 'risk', 'gps', 'cctv', 'trips', 'dest', 'changes', 'pinned', 'driver2', 'remark'];

// เรียง key ก่อนเทียบ ข้อมูลเดียวกันแต่ลำดับต่างต้องถือว่าเท่ากัน
const stable = (value) => JSON.stringify(value, (key, v) => (v && typeof v === 'object' && !Array.isArray(v)
    ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, v[k]]))
    : v));

const roundBody = ({ m, closed, ...rest }) => stable(rest);
const infoBody = (v) => stable(INFO.map((k) => v[k] ?? null));

/** รอบที่กรอกก่อนมีระบบนี้ยังไม่มี id: สร้างจากเนื้อหา ทุกเครื่องจึงได้ id เดียวกัน */
export function normalize(report) {
    for (const v of report.vehicles) {
        const seen = new Set();
        for (const r of v.rounds) {
            if (!r.id) {
                let id = 'old|' + r.time + '|' + r.place;
                while (seen.has(id)) id += '+';
                r.id = id;
            }
            seen.add(r.id);
        }
    }
    report.gone ||= {};
    return report;
}

/** ภาพจำของรายงาน ใช้ดูว่าครั้งต่อไปมีอะไรถูกแก้ */
export function snapshot(report) {
    return {
        head: stable([report.checker || '', report.monitor || '']),
        info: new Map(report.vehicles.map((v) => [v.scc, infoBody(v)])),
        rounds: new Map(report.vehicles.flatMap((v) => v.rounds.map((r) => [v.scc + '#' + r.id, roundBody(r)])))
    };
}

/** ใส่เวลาแก้ล่าสุดให้เฉพาะส่วนที่เปลี่ยนจากภาพจำ และจดรอบที่ถูกลบ */
export function stamp(report, before, now = Date.now()) {
    report.gone ||= {};
    if (stable([report.checker || '', report.monitor || '']) !== before.head) report.headAt = now;
    const present = new Set();
    for (const v of report.vehicles) {
        const was = before.info.get(v.scc);
        if (was !== undefined && was !== infoBody(v)) v.m = now;
        if (was === undefined && v.pinned) v.m = now; // รถที่เพิ่มเอง
        for (const r of v.rounds) {
            r.id ||= now.toString(36) + Math.random().toString(36).slice(2, 8);
            const key = v.scc + '#' + r.id;
            present.add(key);
            if (before.rounds.get(key) !== roundBody(r)) r.m = now;
        }
    }
    for (const key of before.rounds.keys()) if (!present.has(key)) report.gone[key] = now;
    return snapshot(report);
}

/** รวม mine กับ theirs (ไม่แก้ของเดิม) ลำดับรอบของ mine คงที่ ของใหม่ต่อท้าย */
export function merge(mine, theirs) {
    const a = normalize(structuredClone(mine));
    if (!theirs) return a;
    const b = normalize(structuredClone(theirs));
    const gone = { ...b.gone };
    for (const [key, at] of Object.entries(a.gone)) gone[key] = Math.max(at, gone[key] || 0);

    const others = new Map(b.vehicles.map((v) => [v.scc, v]));
    const vehicles = a.vehicles.map((v) => {
        const other = others.get(v.scc);
        others.delete(v.scc);
        if (!other) return v;
        const newer = (other.m || 0) >= (v.m || 0) ? other : v;
        const rounds = new Map(v.rounds.map((r) => [r.id, r]));
        for (const r of other.rounds) {
            const have = rounds.get(r.id);
            if (!have || (r.m || 0) > (have.m || 0)) rounds.set(r.id, r);
        }
        return { ...newer, rounds: [...rounds.values()] };
    }).concat([...others.values()]);
    for (const v of vehicles) v.rounds = v.rounds.filter((r) => !((gone[v.scc + '#' + r.id] || 0) >= (r.m || 0) && gone[v.scc + '#' + r.id]));

    const head = (b.headAt || 0) >= (a.headAt || 0) ? b : a;
    return {
        ...a,
        checker: head.checker || a.checker || b.checker || '',
        monitor: head.monitor || a.monitor || b.monitor || '',
        headAt: head.headAt || 0,
        updatedAt: Math.max(a.updatedAt || 0, b.updatedAt || 0),
        vehicles,
        gone
    };
}

/** เนื้อหาเท่ากันไหม (ไม่สนเวลาและลำดับ) */
export function sameReport(a, b) {
    const body = (r) => stable([
        r.checker || '', r.monitor || '',
        [...r.vehicles].sort((x, y) => x.scc.localeCompare(y.scc)).map((v) => [v.scc, infoBody(v),
            [...v.rounds].map(roundBody).sort()])
    ]);
    return !!a && !!b && body(a) === body(b);
}
