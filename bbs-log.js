// ===== ประวัติการใช้งานหน้า BBS =====
// จดลงคิวในเครื่องก่อน แล้วส่งขึ้นแท็บ history ของชีตเป็นชุด ส่งไม่ได้ก็เก็บไว้ลองใหม่ ไม่ขวางการทำงาน

const STORE = 'bbs-log';
const MAX_QUEUE = 1000;
const BATCH = 100;
const SEND_MS = 10000;
const MERGE_MS = 30000; // แก้ช่องเดิมต่อเนื่อง (เช่น หมุนเวลา กดติ๊กวน) นับเป็นรายการเดียว

// send(rows) ต้องคืน true เมื่อชีตรับแล้ว, user() = อีเมลที่ล็อกอินอยู่
export function createLog({ send, user, storage = localStorage, now = Date.now }) {
    let timer = null;
    let sending = false;
    const read = () => { try { return JSON.parse(storage.getItem(STORE)) || []; } catch { return []; } };
    const write = (list) => { try { storage.setItem(STORE, JSON.stringify(list.slice(-MAX_QUEUE))); } catch { /* พื้นที่เต็ม */ } };
    let flying = new Set(); // กำลังส่ง ห้ามรวมรายการใหม่เข้าไป

    const schedule = () => { timer ||= setTimeout(flush, SEND_MS); };

    // entry = { group, action, form, date, shift, scc, detail, field?, from?, to? }
    // มี field = เป็นการแก้ค่า รวมกับรายการก่อนหน้าของช่องเดียวกันได้
    function add(entry) {
        const list = read();
        const at = now();
        const who = user();
        const same = entry.field && list.at(-1);
        if (same && !flying.has(same.id) && at - same.at < MERGE_MS &&
            ['user', 'action', 'form', 'date', 'shift', 'scc', 'field'].every((k) => (k === 'user' ? who : entry[k]) === same[k])) {
            Object.assign(same, { to: entry.to, at });
        } else {
            list.push({ ...entry, user: who, at, id: at.toString(36) + Math.random().toString(36).slice(2, 8) });
        }
        write(list);
        schedule();
    }

    async function flush() {
        clearTimeout(timer);
        timer = null;
        if (sending) return;
        const who = user();
        // ส่งเฉพาะของคนที่ล็อกอินอยู่ ชีตจะได้ไม่ลงชื่อผิดคน
        const batch = read().filter((e) => e.user === who).slice(0, BATCH);
        if (!who || !batch.length) return;
        sending = true;
        flying = new Set(batch.map((e) => e.id));
        let ok = false;
        try {
            ok = await send(batch.map(({ field, from, to, user: _, ...e }) => ({
                ...e, detail: field ? field + ': ' + (from || '(ว่าง)') + ' → ' + (to || '(ว่าง)') : e.detail || ''
            })));
            if (ok) write(read().filter((e) => !flying.has(e.id)));
        } catch (err) {
            console.warn('log', err);
        }
        flying = new Set();
        sending = false;
        if (!ok || read().some((e) => e.user === who)) schedule();
    }

    return { add, flush };
}
