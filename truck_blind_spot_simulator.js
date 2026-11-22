import { requireLogin } from "./firebase-guard.js?v=20261122-sim";

/* =====================================================================
   จำลองมุมอับรถบรรทุก (มุมมองจากด้านบน)
   - หน่วยทั้งหมดเป็นเมตร / องศา · แกนของรถ: x = หน้ารถ, y = ซ้ายของรถ (ไทยขับชิดซ้าย คนขับนั่งขวา)
   - รถหัวลาก/รถพ่วง: หางแต่ละส่วนตามจุดต่อพ่วงแบบเส้น tractrix (เหมือนหางรถจริงตอนความเร็วต่ำ)
     ตอนวิ่งเร็วกว่า 3 ม./วิ ใช้แบบไดนามิก (มวล แรงยาง แรงเฉื่อยตอนเบรก) เพื่อให้เห็นหางส่าย/หางปัด
   - มุมอับ = จุดรอบรถที่คนขับมองไม่เห็นทั้ง "มองตรงผ่านกระจกหน้าต่าง" และ "ผ่านกระจกมองข้าง"
     · มองตรง: ใช้ความสูงตา ขอบล่างกระจก และความสูงวัตถุ หาว่าวัตถุต้องห่างเท่าไรจึงพ้นขอบประตู/คอนโซล
     · กระจกมองข้าง: เป็นมุมกวาดไปด้านหลัง ถูกบังด้วยตัวถัง/หางพ่วง (หางสะบัดเข้ามาบังตอนเลี้ยว)
   - ขนาดรถเป็นค่าประมาณของรถทั่วไปในไทย ไม่ใช่สเปกรุ่นใดรุ่นหนึ่ง
   ===================================================================== */

const DEG = Math.PI / 180;
const HW = 1.25;                     // ครึ่งความกว้างตัวรถ (กว้าง 2.5 ม.)
const EYE_H = 2.45;                  // ความสูงตาคนขับจากพื้น (รถหัวเก๋งแบน)
const SILL = { f: 1.85, l: 1.95, r: 1.9 };  // ความสูงขอบล่างกระจก หน้า / ซ้าย / ขวา
const VIEW_LEFT = 110 * DEG, VIEW_RIGHT = -135 * DEG; // หันมองได้ถึงไหน (หลังจากนี้ติดผนังหลังเก๋ง) ฝั่งคนขับเอี้ยวคอได้มากกว่า
const MIRROR_RANGE = 45;
const CELL = 0.3;                    // ความละเอียดตารางคำนวณมุมอับ
const MAX_FWD = 100 / 3.6, MAX_REV = 9 / 3.6;
const GRAV = 9.81;
const T_REACT = 1.0;                 // เวลาคนขับเห็นเหตุ → ยกเท้าไปเหยียบเบรก (วินาที)
const T_LAG = 0.4;                   // ลมเบรกรถใหญ่ใช้เวลาสร้างแรงดันจนเบรกเต็มที่ (วินาที)
const BRAKE_EMPTY = 7.0, BRAKE_FULL = 5.0; // ความหน่วงที่ระบบเบรกทำได้ ตอนรถเปล่า / บรรทุกเต็มพิกัด (ม./วิ²) — ยิ่งหนักยิ่งเบรกได้น้อยลง

/* ฟิสิกส์ต่อชนิดรถ (ค่าประมาณ) — น้ำหนักเป็นตัน
   truckCurb/trailerCurb = น้ำหนักรถเปล่า · cargoMax/cargoDef = น้ำหนักบรรทุก · rated = น้ำหนักรวมที่ออกแบบ/พิกัด
   split = สัดส่วนน้ำหนักบรรทุกที่อยู่บนตัวลูก/หาง · power = กำลังเครื่อง (kW) · cdA = แรงต้านลม (ม.²)
   srt = เกณฑ์แรงเหวี่ยงที่เริ่มพลิกคว่ำ (g) รถบรรทุกของเหลว/รถขนรถยนต์ศูนย์ถ่วงสูง ≈ 0.30–0.35 g
   trailer: c = ระยะจุดต่อพ่วงถึงศูนย์ถ่วงหาง (ม.), C = ความแข็งยางด้านข้างรวมของล้อหาง (N/rad) */
const PHYS = {
  tanker:  { truckCurb: 11.0, cargoMax: 18, cargoDef: 13.0, rated: 25, split: 0, power: 250, cdA: 5.5, srt: 0.33, cargoNote: "น้ำมัน 18,000 ลิตร ≈ 13 ตัน" },
  semi:    { truckCurb: 8.5, trailerCurb: 7.5, cargoMax: 40, cargoDef: 30.0, rated: 50.5, split: 1, power: 300, cdA: 6.0, srt: 0.33,
             cargoNote: "น้ำมัน 40,000 ลิตร ≈ 30 ตัน", trailer: { c: 4.6, C: 1.0e6 } },
  carrier: { truckCurb: 10.0, trailerCurb: 5.5, cargoMax: 20, cargoDef: 12.6, rated: 32, split: 4 / 7, power: 220, cdA: 7.0, srt: 0.30,
             cargoNote: "รถเก๋ง/อเนกประสงค์คันละ ≈ 1.5–2.1 ตัน", trailer: { c: 6.0, C: 0.8e6 } }
};
const LANE_Y = 5.25;                 // กลางช่องซ้ายสุดของถนนขาไป
const CROSS_X = 75;                  // ตำแหน่งสี่แยก

const RIGS = {
  tanker: {
    name: "รถบรรทุกน้ำมัน 10 ล้อ", key: "1",
    units: [{
      kind: "truck", wb: 5.6, maxSteer: 38, front: 7.0, rear: -3.0, cabFront: 7.0, cabBack: 4.8, color: "#c8392f",
      axles: [{ x: 5.6, steer: true }, { x: 0.65, dual: true }, { x: -0.65, dual: true }],
      parts: [{ t: "chassis", x1: -3.0, x2: 4.8, hw: 0.55 }, { t: "tank", x1: -2.9, x2: 4.6, occ: true }]
    }]
  },
  semi: {
    name: "รถหัวลาก 10 ล้อ + หางพ่วงน้ำมัน", key: "2",
    units: [{
      kind: "truck", wb: 3.9, maxSteer: 32, front: 5.3, rear: -1.0, cabFront: 5.3, cabBack: 3.0, hitch: 0.4, color: "#2f63c8",
      axles: [{ x: 3.9, steer: true }, { x: 0.65, dual: true }, { x: -0.65, dual: true }],
      parts: [{ t: "chassis", x1: -1.0, x2: 3.0, hw: 1.15 }, { t: "fifth", x: 0.4 }]
    }, {
      kind: "trailer", L: 8.0, front: 9.2, rear: -3.0, limit: 85, label: "หางพ่วง",
      axles: [{ x: 1.3, dual: true }, { x: 0, dual: true }, { x: -1.3, dual: true }],
      parts: [{ t: "tank", x1: -2.9, x2: 9.1, occ: true }]
    }]
  },
  carrier: {
    // ตัวลูกเป็นพ่วงแกนกลาง: ล้อ 8 ล้อ (2 เพลา ล้อคู่) อยู่กลางตัว ไม่มีล้อเลี้ยว ต่อกับตัวแม่ด้วยคานลากแข็ง
    name: "รถขนรถยนต์ + พ่วงแกนกลาง (ตัวแม่ + ตัวลูก)", key: "3",
    units: [{
      kind: "truck", wb: 5.8, maxSteer: 38, front: 7.2, rear: -2.2, cabFront: 7.2, cabBack: 5.0, hitch: -2.5, color: "#eef0f2",
      axles: [{ x: 5.8, steer: true }, { x: 0.65, dual: true }, { x: -0.65, dual: true }],
      parts: [{ t: "deck", x1: -2.2, x2: 4.9, occ: true, cars: 1, carLen: 4.7 }, { t: "rackcar", x1: 3.7, x2: 8.1 }]
    }, {
      kind: "trailer", L: 6.3, front: 5.0, rear: -5.0, limit: 55, label: "ตัวลูก",
      axles: [{ x: 0.65, dual: true }, { x: -0.65, dual: true }],
      parts: [{ t: "drawbar", x1: 5.0, x2: 6.3 }, { t: "deck", x1: -5.0, x2: 5.0, occ: true, cars: 2, carLen: 4.7 }]
    }]
  }
};

/* ---------------- ผังเมือง (ใช้ร่วมกันทั้ง 2D และ 3D) ----------------
   ตึกริมถนนทั้งสองเส้น ต้นไม้บนทางเท้า เสาไฟ — สุ่มแบบกำหนดเมล็ดไว้ ทุกครั้งได้ผังเดิม */
const CITY = (() => {
  let seed = 42 >>> 0;
  const r = () => ((seed = (seed * 1664525 + 1013904223) >>> 0) / 4294967296);
  const B = [], T = [], Lm = [];
  for (let i = -14; i <= 14; i++) {
    const x = i * 21;
    [1, -1].forEach((side) => {
      if (Math.abs(x - CROSS_X) < 26) return;
      const d = 12 + r() * 14, w = 14 + r() * 5, h = 7 + r() * r() * 38;
      B.push({ x, y: side * (14 + d / 2), w, d, h, c: Math.floor(r() * 7) });
    });
  }
  for (let j = -14; j <= 14; j++) {
    const y = j * 21;
    [1, -1].forEach((side) => {
      if (Math.abs(y) < 26) return;
      const d = 12 + r() * 14, w = 14 + r() * 5, h = 7 + r() * r() * 38;
      B.push({ x: CROSS_X + side * (14 + d / 2), y, w: d, d: w, h, c: Math.floor(r() * 7) });
    });
  }
  for (let x = -300; x <= 300; x += 13) if (Math.abs(x - CROSS_X) > 13) [10.2, -10.2].forEach((y) => T.push({ x: x + 3, y, s: 0.8 + r() * 0.5 }));
  for (let y = -300; y <= 300; y += 13) if (Math.abs(y) > 13) [CROSS_X - 10.2, CROSS_X + 10.2].forEach((x) => T.push({ x, y: y + 3, s: 0.8 + r() * 0.5 }));
  for (let x = -160; x <= 300; x += 36) if (Math.abs(x - CROSS_X) > 14) {
    Lm.push({ x, y: 9.3, dir: 1, light: Math.abs(x) < 120 });
    Lm.push({ x: x + 18, y: -9.3, dir: -1, light: Math.abs(x) < 120 });
  }
  Lm.push({ x: CROSS_X - 10, y: 10, dir: 1, light: true }, { x: CROSS_X + 10, y: -10, dir: -1, light: true });
  return { B, T, Lm };
})();
const BUILD_COLORS = ["#d8d2c4", "#c7cbd1", "#e2d6c2", "#b9c2c9", "#d6c9b6", "#cfd6d9", "#e8e2d6"];

/* ---------------- สถานะ ---------------- */
const S = {
  rigKey: "tanker", units: [], v: 0, steer: 0,
  keys: new Set(), objects: [], trails: [[], [], [], []], trailAcc: 0,
  cam: { x: 0, y: 0, s: 15 }, msg: "", msgT: 0,
  opts: { prox: false, front: false, showVis: true, trail: true, autoCenter: true, objH: 1.2, range: 8, place: "moto",
          mu: 0.7, tbrake: "abs", cargo: 13, testSpeed: 80, zone: true },
  brakeA: 0, accel: 0, imbSign: 1, test: null, lastResult: "", warnT: 0,
  view: "2d", night: false, skids: [], skidPrev: {}, smoke: [], hist: [], kS: 0,
  phys: { latUse: 0, push: 0, pushLat: 0, aLat: 0, artRate: 0 }
};
const P = {};       // ค่าที่คำนวณล่วงหน้าทุกเฟรม (ตำแหน่งตา กระจก รูปทรงตัวรถ)
const VIS = { INSIDE: 1, DIRECT: 2, MIRROR: 3, PROX: 4, BLIND: 5 };

const $ = (id) => document.getElementById(id);
const cv = $("cv"), ctx = cv.getContext("2d");
let W = 0, H = 0, DPR = 1, COL = {};

/* ---------------- เรขาคณิต ---------------- */
function wrap(a) { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; }
function approach(v, t, d) { return v < t ? Math.min(t, v + d) : Math.max(t, v - d); }
function toWorld(u, lx, ly) {
  const c = Math.cos(u.th), s = Math.sin(u.th);
  return [u.x + lx * c - ly * s, u.y + lx * s + ly * c];
}
function rectPoly(u, x1, x2, hw) {
  const pts = [toWorld(u, x2, hw), toWorld(u, x1, hw), toWorld(u, x1, -hw), toWorld(u, x2, -hw)];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  pts.forEach(([x, y]) => { minX = Math.min(minX, x); maxX = Math.max(maxX, x); minY = Math.min(minY, y); maxY = Math.max(maxY, y); });
  return { pts, minX, minY, maxX, maxY };
}
function inPoly(poly, x, y) {
  if (x < poly.minX || x > poly.maxX || y < poly.minY || y > poly.maxY) return false;
  const p = poly.pts;
  let sign = 0;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = p[i], [bx, by] = p[(i + 1) % 4];
    const cr = (bx - ax) * (y - ay) - (by - ay) * (x - ax);
    if (cr !== 0) { const s = cr > 0 ? 1 : -1; if (sign && s !== sign) return false; sign = s; }
  }
  return true;
}
function segHit(ax, ay, bx, by, cx, cy, dx, dy) {
  const r1 = bx - ax, r2 = by - ay, s1 = dx - cx, s2 = dy - cy;
  const den = r1 * s2 - r2 * s1;
  if (Math.abs(den) < 1e-12) return false;
  const t = ((cx - ax) * s2 - (cy - ay) * s1) / den;
  const u = ((cx - ax) * r2 - (cy - ay) * r1) / den;
  return t > 0 && t < 1 && u >= 0 && u <= 1;
}
function segDist(px, py, ax, ay, bx, by) {
  const dx = bx - ax, dy = by - ay, l = dx * dx + dy * dy;
  let t = l ? ((px - ax) * dx + (py - ay) * dy) / l : 0;
  t = Math.max(0, Math.min(1, t));
  const x = ax + t * dx - px, y = ay + t * dy - py;
  return Math.sqrt(x * x + y * y);
}
function polyDist(poly, x, y) {
  if (inPoly(poly, x, y)) return 0;
  let d = Infinity;
  for (let i = 0; i < 4; i++) {
    const [ax, ay] = poly.pts[i], [bx, by] = poly.pts[(i + 1) % 4];
    d = Math.min(d, segDist(x, y, ax, ay, bx, by));
  }
  return d;
}

/* ---------------- มวล / ความสามารถในการเบรก ---------------- */
const PH = {};
function updateMass() {
  const c = PHYS[S.rigKey], cargo = Math.min(S.opts.cargo, c.cargoMax);
  PH.cfg = c;
  PH.mTrailer = c.trailer ? (c.trailerCurb + cargo * c.split) * 1000 : 0;
  PH.mTruck = (c.truckCurb + cargo * (1 - c.split)) * 1000;
  PH.mTot = PH.mTruck + PH.mTrailer;
  const over = PH.mTot / 1000 / c.rated;
  const curb = c.truckCurb + (c.trailerCurb || 0), load = Math.max(0, Math.min(1, (PH.mTot / 1000 - curb) / (c.rated - curb)));
  const roadA = 0.9 * S.opts.mu * GRAV, sysA = over > 1 ? BRAKE_FULL / over : BRAKE_EMPTY - (BRAKE_EMPTY - BRAKE_FULL) * load;
  PH.aMax = Math.min(roadA, sysA);
  PH.limitBy = sysA < roadA ? (over > 1 ? "น้ำหนักเกินพิกัด" : "ระบบเบรก+น้ำหนัก") : "ความฝืดถนน";
  PH.over = over;
  const tu = S.units.find((u) => u.def.kind === "trailer");
  if (c.trailer && tu) {
    const len = tu.def.front - tu.def.rear, m = PH.mTrailer;
    PH.L = tu.def.L; PH.c = c.trailer.c; PH.C = c.trailer.C;
    PH.I = m * (len * len + 2.5 * 2.5) / 12 + m * PH.c * PH.c;   // โมเมนต์ความเฉื่อยรอบจุดต่อพ่วง
    PH.N = m * GRAV * PH.c / PH.L;                                  // น้ำหนักกดล้อหาง
  } else PH.L = 0;
}
function trailerBrake() {
  // แรงเบรกที่ล้อหาง + แรงยึดเกาะด้านข้างที่เหลือ (วงกลมแรงเสียดทาน)
  const muN = S.opts.mu * PH.N, want = PH.mTrailer * S.brakeA;
  let Fb, cap, locked = false;
  if (S.opts.tbrake === "weak") Fb = Math.min(0.4 * want, muN);
  else if (S.opts.tbrake === "lock" && S.brakeA > 3) { Fb = 0.85 * muN; cap = 0.1 * muN; locked = true; }
  else Fb = Math.min(want, 0.95 * muN);
  if (cap === undefined) cap = Math.sqrt(Math.max(0, muN * muN - Fb * Fb));
  return { Fb, cap, locked };
}
function stopDistance(v) {
  const r = v * (T_REACT + T_LAG / 2), b = v * v / (2 * PH.aMax);
  return { r, b, total: r + b };
}

/* ---------------- สร้างรถ / เริ่มใหม่ ---------------- */
function buildRig(key) {
  if (key !== S.rigKey || !PH.cfg) { S.rigKey = key; if ($("cargo")) syncPhysUi(); }
  S.rigKey = key;
  S.units = RIGS[key].units.map((def) => ({ def, x: 0, y: LANE_Y, th: 0 }));
  for (let i = 1; i < S.units.length; i++) {
    const p = S.units[i - 1], u = S.units[i];
    const [hx, hy] = toWorld(p, p.def.hitch, 0);
    u.th = p.th; u.x = hx - u.def.L; u.y = hy;
  }
  S.v = 0; S.steer = 0; S.brakeA = 0; S.accel = 0; S.test = null;
  S.units.forEach((u) => { u.w = 0; u.vH = null; u.aH = null; });
  S.trails = [[], [], [], []]; S.trailAcc = 0; S.hist = []; S.kS = 0;
  S.skids = []; S.skidPrev = {}; S.smoke = [];
  updateMass();
  prep();
  const t = S.units[0];
  S.cam.x = (P.bounds.minX + P.bounds.maxX) / 2; S.cam.y = t.y;
  resetObjects();
  renderRigButtons();
  if (W && !S.autoZoom) S.cam.s = fitScale();
}
function rigLength(key) {
  const units = RIGS[key].units;
  let x = units[0].front, last = units[0].rear, off = 0;
  for (let i = 1; i < units.length; i++) {
    off += units[i - 1].hitch - units[i].L;
    if (units[i].rear != null) last = off + units[i].rear;
  }
  return x - last;
}
function resetObjects() {
  const t = S.units[0], fx = t.x + t.def.front, rx = P.bounds.minX;
  S.objects = [
    { t: "moto", x: fx - 0.6, y: LANE_Y + 2.75, th: 0, v: 0 },   // ข้างเก๋งซ้าย — จุดที่มองไม่เห็นบ่อยที่สุด
    { t: "ped", x: fx + 0.9, y: LANE_Y + 0.6, th: Math.PI / 2, v: 0 }, // คนเดินตัดหน้าชิดกันชน
    { t: "car", x: rx - 5, y: LANE_Y, th: 0, v: 0 },                 // รถเก๋งจี้ท้าย
    { t: "moto", x: fx + 20, y: LANE_Y + 2.55, th: 0, v: 0 },
    { t: "ped", x: CROSS_X - 9.5, y: 9.7, th: 0, v: 0 },
    { t: "ped", x: CROSS_X - 9.8, y: -9.6, th: Math.PI / 2, v: 0 }
  ];
}

/* ---------------- ค่าต่อเฟรม ---------------- */
function prep() {
  const tr = S.units[0], d = tr.def;
  P.c = Math.cos(tr.th); P.s = Math.sin(tr.th); P.tx = tr.x; P.ty = tr.y;
  P.eyeL = [d.cabFront - 1.25, -0.6];
  P.eyeW = toWorld(tr, P.eyeL[0], P.eyeL[1]);
  P.mirrors = [
    { side: 1, lx: d.cabFront - 0.4, ly: 1.55, min: -1.5 * DEG, max: 32 * DEG },
    { side: -1, lx: d.cabFront - 0.4, ly: -1.55, min: -1.5 * DEG, max: 30 * DEG }
  ].map((m) => { const [wx, wy] = toWorld(tr, m.lx, m.ly); return Object.assign(m, { wx, wy }); });
  P.mirrorMinBack = Math.max(1.2, 3.5 - 1.2 * S.opts.objH);
  P.foot = []; P.occ = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  S.units.forEach((u) => {
    if (u.def.front == null) return;
    const f = rectPoly(u, u.def.rear, u.def.front, HW);
    P.foot.push(f);
    minX = Math.min(minX, f.minX); maxX = Math.max(maxX, f.maxX); minY = Math.min(minY, f.minY); maxY = Math.max(maxY, f.maxY);
    u.def.parts.forEach((p) => { if (p.occ) P.occ.push(rectPoly(u, p.x1, p.x2, HW)); });
  });
  P.bounds = { minX, minY, maxX, maxY };
}

// วัตถุต้องห่างจากตาเท่าไร (ตามแนว dir) จึงโผล่พ้นขอบกระจกให้เห็น
function directMin(cx, cy) {
  const d = S.units[0].def, ex = P.eyeL[0], ey = P.eyeL[1];
  let t = Infinity, face = "";
  if (cx > 1e-9) { const k = (d.cabFront - ex) / cx; if (k < t) { t = k; face = "f"; } }
  else if (cx < -1e-9) { const k = (d.cabBack - ex) / cx; if (k < t) { t = k; face = "b"; } }
  if (cy > 1e-9) { const k = (HW - ey) / cy; if (k < t) { t = k; face = "l"; } }
  else if (cy < -1e-9) { const k = (-HW - ey) / cy; if (k < t) { t = k; face = "r"; } }
  if (face === "b") return Infinity;
  const sill = SILL[face], h = S.opts.objH;
  return h >= sill ? t : t * (EYE_H - h) / (EYE_H - sill);
}
function blocked(ax, ay, bx, by) {
  const x1 = Math.min(ax, bx), x2 = Math.max(ax, bx), y1 = Math.min(ay, by), y2 = Math.max(ay, by);
  for (const o of P.occ) {
    if (o.maxX < x1 || o.minX > x2 || o.maxY < y1 || o.minY > y2) continue;
    for (let i = 0; i < 4; i++) {
      const [cx, cy] = o.pts[i], [dx, dy] = o.pts[(i + 1) % 4];
      if (segHit(ax, ay, bx, by, cx, cy, dx, dy)) return true;
    }
  }
  return false;
}
function classify(px, py) {
  for (const f of P.foot) if (inPoly(f, px, py)) return VIS.INSIDE;
  const d = S.units[0].def;
  const dx = px - P.tx, dy = py - P.ty;
  const lx = dx * P.c + dy * P.s, ly = -dx * P.s + dy * P.c;
  if (S.opts.prox && lx >= d.cabBack - 1.2 && lx <= d.cabFront - 0.3 && ly >= HW && ly <= HW + 2.0) return VIS.PROX;
  if (S.opts.front && lx >= d.cabFront && lx <= d.cabFront + 2.0 && ly >= -HW - 0.2 && ly <= HW + 0.3) return VIS.PROX;
  const ex = lx - P.eyeL[0], ey = ly - P.eyeL[1];
  const dist = Math.sqrt(ex * ex + ey * ey);
  const ang = Math.atan2(ey, ex);
  if (ang <= VIEW_LEFT && ang >= VIEW_RIGHT && dist >= directMin(ex / dist, ey / dist) &&
      !blocked(P.eyeW[0], P.eyeW[1], px, py)) return VIS.DIRECT;
  for (const m of P.mirrors) {
    const vx = lx - m.lx, vy = (ly - m.ly) * m.side;
    // กระจกติดสูง มองลงพื้นใกล้ ๆ ไม่ถึง: วัตถุต้องอยู่หลังกระจกระยะหนึ่ง (วัตถุสูงเห็นได้ใกล้กว่า)
    if (-vx < P.mirrorMinBack || vx * vx + vy * vy > MIRROR_RANGE * MIRROR_RANGE) continue;
    const a = Math.atan2(vy, -vx);
    if (a >= m.min && a <= m.max && !blocked(m.wx, m.wy, px, py)) return VIS.MIRROR;
  }
  return VIS.BLIND;
}
const isSeen = (c) => c === VIS.DIRECT || c === VIS.MIRROR || c === VIS.PROX;

/* ---------------- ตารางมุมอับ ---------------- */
const G = { nx: 0, ny: 0, minX: 0, maxY: 0, cls: new Uint8Array(0), img: null, off: document.createElement("canvas"), blindCells: 0 };
function computeGrid() {
  const R = S.opts.range, b = P.bounds;
  const minX = Math.floor((b.minX - R) / CELL) * CELL, maxX = b.maxX + R;
  const minY = b.minY - R, maxY = Math.ceil((b.maxY + R) / CELL) * CELL;
  const nx = Math.ceil((maxX - minX) / CELL), ny = Math.ceil((maxY - minY) / CELL);
  if (nx * ny !== G.cls.length || G.nx !== nx) {
    G.cls = new Uint8Array(nx * ny);
    G.off.width = nx; G.off.height = ny;
    G.img = G.off.getContext("2d").createImageData(nx, ny);
  }
  G.nx = nx; G.ny = ny; G.minX = minX; G.maxY = maxY;
  const data = G.img.data, show = S.opts.showVis;
  let blind = 0;
  for (let j = 0; j < ny; j++) {
    const py = maxY - (j + 0.5) * CELL;
    for (let i = 0; i < nx; i++) {
      const px = minX + (i + 0.5) * CELL, k = j * nx + i, o = k * 4;
      let near = Infinity;
      for (const f of P.foot) { near = Math.min(near, polyDist(f, px, py)); if (near <= R) break; }
      let c = 0;
      if (near <= R) c = classify(px, py);
      G.cls[k] = c;
      let r = 0, g = 0, bl = 0, a = 0;
      if (c === VIS.BLIND) { r = 229; g = 72; bl = 77; a = 120; blind++; }
      else if (show && c === VIS.DIRECT) { r = 46; g = 160; bl = 90; a = 42; }
      else if (show && c === VIS.MIRROR) { r = 59; g = 130; bl = 246; a = 48; }
      else if (show && c === VIS.PROX) { r = 168; g = 85; bl = 247; a = 70; }
      data[o] = r; data[o + 1] = g; data[o + 2] = bl; data[o + 3] = a;
    }
  }
  G.blindCells = blind;
  labelRegions();
  G.off.getContext("2d").putImageData(G.img, 0, 0);
}
// แยกมุมอับเป็นก้อน ๆ (เซลล์ที่ติดกัน) แล้วหาพื้นที่ + จุดวางป้ายของแต่ละก้อน
function labelRegions() {
  const { nx, ny, cls } = G, n = nx * ny;
  if (!G.lab || G.lab.length !== n) { G.lab = new Uint8Array(n); G.q = new Int32Array(n); }
  const lab = G.lab, q = G.q;
  lab.fill(0);
  let tail = 0;
  G.regions = [];
  for (let k = 0; k < n; k++) {
    if (cls[k] !== VIS.BLIND || lab[k]) continue;
    const start = tail;
    let head = tail, si = 0, sj = 0;
    q[tail++] = k; lab[k] = 1;
    while (head < tail) {
      const c = q[head++], i = c % nx, j = (c - i) / nx;
      si += i; sj += j;
      if (i > 0 && cls[c - 1] === VIS.BLIND && !lab[c - 1]) { lab[c - 1] = 1; q[tail++] = c - 1; }
      if (i < nx - 1 && cls[c + 1] === VIS.BLIND && !lab[c + 1]) { lab[c + 1] = 1; q[tail++] = c + 1; }
      if (j > 0 && cls[c - nx] === VIS.BLIND && !lab[c - nx]) { lab[c - nx] = 1; q[tail++] = c - nx; }
      if (j < ny - 1 && cls[c + nx] === VIS.BLIND && !lab[c + nx]) { lab[c + nx] = 1; q[tail++] = c + nx; }
    }
    const count = tail - start, area = count * CELL * CELL;
    if (area < 1) continue;
    // จุดวางป้าย: เซลล์ในก้อนที่ใกล้จุดศูนย์กลางที่สุด (กันป้ายหลุดออกนอกพื้นที่รูปตัว L)
    const ci = si / count, cj = sj / count;
    let best = q[start], bd = Infinity;
    for (let t = start; t < tail; t++) {
      const c = q[t], i = c % nx, j = (c - i) / nx, d = (i - ci) * (i - ci) + (j - cj) * (j - cj);
      if (d < bd) { bd = d; best = c; }
    }
    const bi = best % nx, bj = (best - bi) / nx;
    G.regions.push({ area, x: G.minX + (bi + 0.5) * CELL, y: G.maxY - (bj + 0.5) * CELL });
  }
}

// เส้นขอบมุมอับ (marching squares บนตาราง)
function blindOutline() {
  const { nx, ny, cls } = G;
  const m = (i, j) => (i >= 0 && j >= 0 && i < nx && j < ny && cls[j * nx + i] === VIS.BLIND) ? 1 : 0;
  const segs = [];
  for (let j = -1; j < ny; j++) {
    for (let i = -1; i < nx; i++) {
      const idx = m(i, j) * 8 + m(i + 1, j) * 4 + m(i + 1, j + 1) * 2 + m(i, j + 1);
      if (idx === 0 || idx === 15) continue;
      const T = [i + 0.5, j], R = [i + 1, j + 0.5], B = [i + 0.5, j + 1], L = [i, j + 0.5];
      const add = (a, b) => segs.push(a, b);
      switch (idx) {
        case 1: case 14: add(L, B); break;
        case 2: case 13: add(B, R); break;
        case 3: case 12: add(L, R); break;
        case 4: case 11: add(T, R); break;
        case 5: add(T, L); add(B, R); break;
        case 6: case 9: add(T, B); break;
        case 7: case 8: add(T, L); break;
        case 10: add(T, R); add(L, B); break;
      }
    }
  }
  return segs;
}

/* ---------------- วัดระยะมุมอับ ---------------- */
function probe(u, lx, ly, dx, dy, max) {
  const [ox, oy] = toWorld(u, lx, ly);
  const c = Math.cos(u.th), s = Math.sin(u.th);
  const wx = dx * c - dy * s, wy = dx * s + dy * c;
  for (let d = 0.05; d <= max; d += 0.1) {
    const k = classify(ox + wx * d, oy + wy * d);
    if (isSeen(k)) return { ox, oy, wx, wy, d: Math.max(0, d - 0.05), max };
  }
  return { ox, oy, wx, wy, d: null, max };
}
function lastBody() { for (let i = S.units.length - 1; i >= 0; i--) if (S.units[i].def.front != null) return S.units[i]; return S.units[0]; }
function measure() {
  const t = S.units[0], d = t.def, lb = lastBody(), mid = (lb.def.front + lb.def.rear) / 2;
  const doorX = d.cabFront - 1.2;
  return {
    front: probe(t, d.front, 0, 1, 0, 15),
    ldoor: probe(t, doorX, HW, 0, 1, 15),
    rdoor: probe(t, doorX, -HW, 0, -1, 15),
    lmid: probe(lb, mid, HW, 0, 1, 15),
    rmid: probe(lb, mid, -HW, 0, -1, 15),
    rear: probe(lb, lb.def.rear, 0, -1, 0, 25)
  };
}
const fmtM = (p) => p.d === null ? "> " + p.max + " ม." : p.d < 0.05 ? "มองเห็น" : p.d.toFixed(1) + " ม.";

/* ---------------- การขับ ---------------- */
function flash(text) { S.msg = text; S.msgT = 2.6; }
function warn(text) { if (S.warnT <= 0) { flash(text); S.warnT = 3; } }
function step(dt) {
  let k = S.keys;
  // โหมดทดสอบเบรก: ควบคุมเอง ยกเลิกทันทีถ้าผู้ใช้กดปุ่มขับ
  if (S.test) {
    if (k.size) { S.test = null; flash("ยกเลิกการทดสอบ — กลับมาขับเอง"); }
    else k = testControl(dt);
  }
  const d = S.units[0].def, cfg = PH.cfg;
  const maxS = d.maxSteer * DEG;
  if (!S.test || !S.test.steerOverride) {
    if (k.has("left") && !k.has("right")) S.steer = Math.min(maxS, S.steer + 30 * DEG * dt);
    else if (k.has("right") && !k.has("left")) S.steer = Math.max(-maxS, S.steer - 30 * DEG * dt);
    else if (S.opts.autoCenter) S.steer = approach(S.steer, 0, 20 * DEG * dt);
  }

  // เบรก: ↓ = เบรกปกติ (ราว 55% ของที่ทำได้) · Space = เบรกเต็มที่ · ลมเบรกค่อย ๆ สร้างแรงใน T_LAG วินาที
  let v = S.v, target = 0;
  if (k.has("brake")) target = PH.aMax;
  else if (k.has("down") && v > 0.05) target = 0.55 * PH.aMax;
  if (target > 0 && S.brakeA === 0) S.imbSign = Math.random() < 0.5 ? -1 : 1;
  S.brakeA = target > S.brakeA ? Math.min(target, S.brakeA + PH.aMax / T_LAG * dt) : target;

  // แรงต้าน: ยางบดถนน + ลม · แรงขับ: กำลังเครื่องหารด้วยมวล (หนักมาก = ออกตัวช้า)
  const resist = GRAV * 0.007 + 0.5 * 1.2 * cfg.cdA * v * v / PH.mTot;
  let acc = 0;
  if (S.brakeA > 0 && v > 0) acc = -S.brakeA - resist;
  else if (k.has("up") && v >= -0.05) acc = Math.min(1.6, cfg.power * 1000 * 0.85 / (PH.mTot * Math.max(2, v))) - resist;
  else if (k.has("up")) acc = 3;                            // กำลังถอยแล้วกดเดินหน้า = เบรก
  else if (k.has("down")) acc = -0.8;                       // ถอย
  else if (!S.test || S.test.braking) acc = v > 0 ? -(resist + 0.15) : v < 0 ? 0.6 : 0; // ปล่อยไหล + เอนจินเบรก
  let nv = v + acc * dt;
  if (v > 0 && nv < 0 && !k.has("down")) nv = 0;
  if (v < 0 && nv > 0) nv = 0;
  if (v > 0 && nv < 0 && k.has("down") && S.brakeA > 0) nv = 0;
  nv = Math.max(-MAX_REV, Math.min(MAX_FWD, nv));
  S.accel = (nv - v) / dt;
  S.v = nv;

  const n = Math.max(1, Math.ceil(Math.abs(nv * dt) / 0.05));
  for (let i = 0; i < n; i++) if (!moveRig(nv * dt / n, dt / n)) { S.v = 0; break; }

  // แรงเหวี่ยงด้านข้าง (เทียบเกณฑ์พลิกคว่ำ)
  const yawT = nv * Math.tan(S.steer) / d.wb, tu = S.units.find((u) => u.def.kind === "trailer");
  S.phys.aLat = Math.max(Math.abs(nv * yawT), tu ? Math.abs(nv * (tu.w || 0)) : 0) / GRAV;
  if (S.phys.aLat > cfg.srt) warn("แรงเหวี่ยง " + S.phys.aLat.toFixed(2) + " g เกินเกณฑ์พลิกคว่ำ (≈ " + cfg.srt + " g) — ลดความเร็วก่อนเลี้ยว");
  if (S.phys.pushLat > 0 && S.phys.pushLat > 0.35 * S.opts.mu * PH.mTruck * 0.7 * GRAV)
    warn("ตัวลูกดันท้ายตัวแม่แรงมาก — เสี่ยงท้ายตัวแม่ปัด (เบรกตัวลูกน้อยกว่าตัวแม่)");

  S.objects.forEach((o) => {
    if (!o.v || o.hit) return;
    o.x += Math.cos(o.th) * o.v * dt; o.y += Math.sin(o.th) * o.v * dt; o.run = (o.run || 0) + o.v * dt;
    prep();
    if (objPoints(o).some(([x, y]) => P.foot.some((f) => inPoly(f, x, y)))) { o.hit = true; o.v = 0; flash("มอเตอร์ไซค์เฉี่ยวชนรถ — อยู่ในมุมอับที่คนขับมองไม่เห็น"); }
  });
  S.objects = S.objects.filter((o) => !o.run || o.run < 260);
  if (S.msgT > 0) S.msgT -= dt;
  if (S.warnT > 0) S.warnT -= dt;
  if (S.test) testTrack();
  updateSmoke(dt);
  // ความโค้งของเส้นทางข้างหน้า ไล่ตามพวงมาลัยแบบนุ่ม ๆ (โซนหน้า/จุดหยุดรถโค้งตามการเลี้ยว)
  const kNow = Math.tan(S.steer) / d.wb;
  S.kS += (kNow - S.kS) * Math.min(1, dt * 5);
}

/* หางแบบไดนามิก (ใช้ตอนวิ่งเร็วกว่า 3 ม./วิ เดินหน้า)
   หางเป็นวัตถุแข็งหมุนรอบจุดต่อพ่วง: I·ψ̈ = (แรงยางด้านข้าง × L) + (แรงเฉื่อยจากหัวที่เร่ง/เบรก × c) + (เบรกซ้ายขวาไม่เท่ากัน)
   - แรงยาง = ความแข็งยาง × มุมลื่นของล้อหาง แต่ไม่เกินแรงยึดเกาะที่เหลือ (ถ้าล้อล็อกแทบไม่เหลือ → หางปัด)
   - ตอนหัวเบรก หางที่เอียงอยู่จะถูกแรงเฉื่อยผลักให้เอียงมากขึ้น (ยิ่งหนัก/ยิ่งเบรกแรง ยิ่งมาก)
   - ความเร็วสูง: ยางหน่วงการแกว่งได้น้อยลง (แรงหน่วง ∝ 1/ความเร็ว) หางจึงส่ายนานกว่า */
function trailerDynamics(u, p, hx, hy, Hold, h) {
  const vHx = (hx - Hold[0]) / h, vHy = (hy - Hold[1]) / h;
  const ax = u.vH ? (vHx - u.vH[0]) / h : 0, ay = u.vH ? (vHy - u.vH[1]) / h : 0;
  u.vH = [vHx, vHy];
  u.aH = u.aH ? [u.aH[0] + (ax - u.aH[0]) * 0.15, u.aH[1] + (ay - u.aH[1]) * 0.15] : [0, 0];
  const ex = Math.cos(u.th), ey = Math.sin(u.th), nx = -ey, ny = ex;
  const vlon = vHx * ex + vHy * ey, vlat = vHx * nx + vHy * ny, uu = Math.max(1, Math.abs(vlon));
  const { I, c, C, L } = PH;
  const tb = trailerBrake();
  const tauI = c * PH.mTrailer * (ex * u.aH[1] - ey * u.aH[0]);
  const tauB = S.imbSign * 0.08 * tb.Fb * 0.9;
  const kk = L * L * C / (uu * I);
  let w = (u.w + h * (L * C * vlat / uu + tauI + tauB) / I) / (1 + h * kk);
  let F = -C * (vlat - L * w) / uu;
  if (Math.abs(F) > tb.cap) { F = Math.sign(F) * tb.cap; w = u.w + h * (-L * F + tauI + tauB) / I; }
  u.w = w; u.th += w * h;
  u.x = hx - Math.cos(u.th) * L; u.y = hy - Math.sin(u.th) * L;
  // แรงที่ข้อต่อ: ตัวลูกต้องหน่วงด้วยความเร่งเดียวกับหัว ส่วนที่เบรกตัวเองไม่พอ = ดันหัว
  const push = PH.mTrailer * S.brakeA - tb.Fb;
  S.phys.push = push; S.phys.pushLat = Math.abs(push * Math.sin(wrap(p.th - u.th)));
  S.phys.latUse = tb.cap > 1 ? Math.min(1, Math.abs(F) / tb.cap) : 1;
  S.phys.locked = tb.locked;
}
function moveRig(ds, h) {
  const saved = S.units.map((u) => [u.x, u.y, u.th, u.w]);
  const restore = () => S.units.forEach((u, i) => { [u.x, u.y, u.th, u.w] = saved[i]; });
  const Hs = S.units.map((u, i) => i ? toWorld(S.units[i - 1], S.units[i - 1].def.hitch, 0) : null);
  const tr = S.units[0];
  const dth = ds * Math.tan(S.steer) / tr.def.wb, mid = tr.th + dth / 2;
  tr.x += ds * Math.cos(mid); tr.y += ds * Math.sin(mid); tr.th += dth;
  for (let i = 1; i < S.units.length; i++) {
    const p = S.units[i - 1], u = S.units[i];
    const [hx, hy] = toWorld(p, p.def.hitch, 0);
    const oldTh = u.th;
    if (h > 0 && S.v > 3 && PH.L && u.def.kind === "trailer") trailerDynamics(u, p, hx, hy, Hs[i], h);
    else {
      const dx = u.x - hx, dy = u.y - hy, len = Math.hypot(dx, dy) || 1;
      u.x = hx + dx / len * u.def.L; u.y = hy + dy / len * u.def.L;
      u.th = Math.atan2(hy - u.y, hx - u.x);
      u.w = h > 0 ? wrap(u.th - oldTh) / h : 0; u.vH = null; u.aH = null;
      S.phys.push = 0; S.phys.pushLat = 0; S.phys.latUse = 0; S.phys.locked = false;
    }
    const art = wrap(p.th - u.th), lim = u.def.limit * DEG;
    if (Math.abs(art) > lim) {
      if (ds < 0) { restore(); flash("ถอยจนหางพับ (Jackknife) — หยุดถอย แล้วเดินหน้าเพื่อดึงหางให้ตรง"); return false; }
      u.th = p.th - Math.sign(art) * lim; u.w = 0;
      u.x = hx - Math.cos(u.th) * u.def.L; u.y = hy - Math.sin(u.th) * u.def.L;
      if (S.v > 3) { flash("หางปัดจนชนตัวแม่! (" + Math.round(S.v * 3.6) + " กม./ชม.)"); if (S.test) S.test.crashed = true; }
      else flash("หางพับชิดตัวหน้าแล้ว — คืนพวงมาลัย");
    }
  }
  if (S.units.length > 1) S.phys.artRate = Math.abs((S.units[1].w || 0) - (h > 0 ? dth / h : 0)) / DEG;
  prep();
  for (const o of S.objects) {
    if (o.hit) continue;
    if (objPoints(o).some(([x, y]) => P.foot.some((f) => inPoly(f, x, y)))) {
      restore(); prep(); o.hit = true;
      flash("ชน" + objName(o.t) + "! — ตอนนั้นอยู่ในมุมอับหรือไม่ ลองดูสีบนแผนที่");
      return false;
    }
  }
  recordSkids();
  // เก็บเส้นทางล้อ: มุมหน้ารถทั้งสองข้าง + ล้อหลังสุดของคันสุดท้าย
  S.trailAcc += Math.abs(ds);
  if (S.trailAcc >= 0.25) {
    S.trailAcc = 0;
    const lb = lastBody(), ax = lb.def.axles[lb.def.axles.length - 1].x;
    const pts = [toWorld(tr, tr.def.front, HW), toWorld(tr, tr.def.front, -HW), toWorld(lb, ax, HW - 0.15), toWorld(lb, ax, -HW + 0.15)];
    pts.forEach((p, i) => { S.trails[i].push(p); if (S.trails[i].length > 600) S.trails[i].shift(); });
    if (ds > 0) {
      const [hx, hy] = toWorld(lb, lb.def.rear, 0);
      S.hist.push({ x: hx, y: hy }); if (S.hist.length > 900) S.hist.shift();
    }
  }
  return true;
}

/* ---------------- รอยเบรก / ควันยาง ----------------
   เบรกเต็มที่ = รอยจาง ๆ จากล้อหลังตัวแม่ · ล้อหางล็อก = รอยเข้ม + ควันยาง */
function recordSkids() {
  const hard = S.brakeA > 0 && S.brakeA >= 0.85 * PH.aMax, locked = S.phys.locked;
  if (S.v < 2 || (!hard && !locked)) { S.skidPrev = {}; return; }
  S.units.forEach((u, ui) => {
    const lockU = locked && u.def.kind === "trailer";
    if (!lockU && !(hard && u.def.kind === "truck")) return;
    u.def.axles.forEach((a, ai) => {
      if (a.steer) return;
      [HW - 0.3, -HW + 0.3].forEach((y, si) => {
        const key = ui + "-" + ai + "-" + si, p = toWorld(u, a.x, y), q = S.skidPrev[key];
        if (!q) { S.skidPrev[key] = p; return; }
        if (Math.hypot(p[0] - q[0], p[1] - q[1]) > 0.35) { S.skids.push([q[0], q[1], p[0], p[1], lockU ? 0.55 : 0.22]); S.skidPrev[key] = p; }
      });
    });
  });
  if (S.skids.length > 8000) S.skids.splice(0, S.skids.length - 8000);
}
function updateSmoke(dt) {
  if (S.phys.locked && S.v > 3) {
    const tu = S.units.find((u) => u.def.kind === "trailer");
    if (tu) tu.def.axles.forEach((a) => [HW - 0.3, -HW + 0.3].forEach((y) => {
      if (Math.random() < 0.6) { const [x, yy] = toWorld(tu, a.x, y); S.smoke.push({ x, y: yy, r: 0.35, life: 1.4, vx: (Math.random() - 0.5) * 0.8, vy: (Math.random() - 0.5) * 0.8 }); }
    }));
  }
  S.smoke.forEach((pt) => { pt.r += 1.8 * dt; pt.life -= dt; pt.x += pt.vx * dt; pt.y += pt.vy * dt; });
  S.smoke = S.smoke.filter((pt) => pt.life > 0).slice(-400);
}

/* ---------------- ทดสอบเบรกกะทันหัน ---------------- */
function startTest(type) {
  buildRig(S.rigKey);
  S.objects = [];
  S.v = S.opts.testSpeed / 3.6;
  S.test = { type, t: 0, braking: false, maxArt: 0, crashed: false, steerOverride: true, d0: null, v0: S.v };
  S.lastResult = "";
  $("testResult").textContent = "กำลังทดสอบ…";
}
function testControl(dt) {
  const T = S.test, keys = new Set();
  T.t += dt;
  // หักหลบ: เลี้ยวขวาเข้าช่องข้าง ๆ แล้วแก้กลับ (ช่วงละ ~0.7 วินาที) แล้วเบรกเต็มที่ระหว่างแก้พวงมาลัย
  // มุมเลี้ยวให้แรงเหวี่ยงราว 0.2 g ทุกความเร็ว (หักหลบแบบที่คนขับทำจริง ยังไม่ถึงเกณฑ์พลิก)
  const sw = T.type === "swerve", vt = Math.max(8, T.v0), a = Math.atan(0.2 * GRAV * S.units[0].def.wb / (vt * vt));
  let steer = 0, brakeAt = sw ? 1.2 : 0.6;
  if (sw) steer = T.t < 0.7 ? -a : T.t < 1.4 ? a : T.t < 2.0 ? -a * 0.3 : 0;
  S.steer = approach(S.steer, steer, 25 * DEG * dt);
  if (T.t >= brakeAt) keys.add("brake");
  return keys;
}
function testTrack() {
  const T = S.test, tu = S.units.find((u) => u.def.kind === "trailer");
  if (tu) T.maxArt = Math.max(T.maxArt, Math.abs(wrap(S.units[0].th - tu.th)) / DEG);
  if (!T.braking && S.brakeA > 0) { T.braking = true; T.d0 = [S.units[0].x, S.units[0].y]; T.vb = S.v; }
  if (T.braking && S.v <= 0.01) {
    const dist = Math.hypot(S.units[0].x - T.d0[0], S.units[0].y - T.d0[1]);
    const sd = stopDistance(T.vb);
    const kmh = Math.round(T.vb * 3.6);
    let txt = "เบรกจาก " + kmh + " กม./ชม. (" + (PH.mTot / 1000).toFixed(1) + " ตัน, ถนน μ " + S.opts.mu + "): ระยะเบรก " + dist.toFixed(0) +
      " ม. + ระยะคิดตัดสินใจ ≈ " + sd.r.toFixed(0) + " ม. = หยุดใน ≈ " + (dist + sd.r).toFixed(0) + " ม.";
    if (tu) txt += " · หางปัดสูงสุด " + T.maxArt.toFixed(1) + "°" + (T.crashed ? " — หางปัดชนตัวแม่!" : T.maxArt > 15 ? " — หางเริ่มคุมไม่อยู่" : T.maxArt > 5 ? " — หางส่ายแต่ยังคุมได้" : " — หางนิ่ง");
    S.lastResult = txt; $("testResult").textContent = txt;
    flash(T.crashed ? "หางปัดชนตัวแม่ระหว่างเบรก" : "หยุดแล้ว — ดูผลในแผงด้านข้าง");
    S.test = null;
  }
}

/* ---------------- วัตถุ ---------------- */
const OBJ = { ped: [0.55, 0.55], moto: [2.0, 0.8], car: [4.5, 1.8] };
function objName(t) { return t === "ped" ? "คนเดิน" : t === "moto" ? "มอเตอร์ไซค์" : "รถเก๋ง"; }
function objPoints(o) {
  const [l, w] = OBJ[o.t], c = Math.cos(o.th), s = Math.sin(o.th);
  const pts = [[o.x, o.y]];
  [[l / 2, w / 2], [l / 2, -w / 2], [-l / 2, w / 2], [-l / 2, -w / 2]].forEach(([a, b]) => pts.push([o.x + a * c - b * s, o.y + a * s + b * c]));
  return pts;
}
function objState(o) {
  if (o.hit) return "hit";
  return objPoints(o).some(([x, y]) => isSeen(classify(x, y))) ? "seen" : "blind";
}

/* ---------------- วาด ---------------- */
function readColors() {
  const cs = getComputedStyle(document.documentElement);
  setTimeout(makePatterns, 0);
  ["ground", "grid", "road", "walk", "mark", "yellow", "text", "label"].forEach((k) => { COL[k] = cs.getPropertyValue("--c-" + k).trim(); });
  COL.bad = cs.getPropertyValue("--bad").trim(); COL.ok = cs.getPropertyValue("--ok").trim();
}
const PAT = {};
function makePatterns() {
  const mk = (size, meters, draw) => {
    const c = document.createElement("canvas"); c.width = c.height = size;
    draw(c.getContext("2d"), size);
    const pat = ctx.createPattern(c, "repeat"); pat.m = meters / size; return pat;
  };
  const speck = (g, n, base, light, dark, count) => {
    g.fillStyle = base; g.fillRect(0, 0, n, n);
    for (let i = 0; i < count; i++) {
      g.fillStyle = Math.random() < 0.5 ? light : dark;
      g.globalAlpha = 0.15 + Math.random() * 0.35; g.fillRect(Math.random() * n, Math.random() * n, 1 + Math.random() * 1.6, 1 + Math.random() * 1.6);
    }
    g.globalAlpha = 1;
  };
  PAT.road = mk(256, 6, (g, n) => speck(g, n, COL.road, "#9aa0a6", "#2a2d31", 5200));
  PAT.ground = mk(256, 12, (g, n) => speck(g, n, COL.ground, "#ffffff", "#7d846f", 2600));
  PAT.walk = mk(128, 2, (g, n) => {
    g.fillStyle = COL.walk; g.fillRect(0, 0, n, n);
    g.strokeStyle = "rgba(0,0,0,.10)"; g.lineWidth = 2;
    for (let i = 0; i <= n; i += n / 2) { g.beginPath(); g.moveTo(i, 0); g.lineTo(i, n); g.moveTo(0, i); g.lineTo(n, i); g.stroke(); }
    speck(g, 0, COL.walk, "#fff", "#000", 0);
  });
}
function patFill(pat) { pat.setTransform(new DOMMatrix().scale(pat.m)); ctx.fillStyle = pat; }
function resize() {
  if (three) three.resize();
  const r = cv.parentElement.getBoundingClientRect();
  DPR = Math.min(2, window.devicePixelRatio || 1);
  W = Math.max(1, r.width); H = Math.max(1, r.height);
  cv.width = Math.round(W * DPR); cv.height = Math.round(H * DPR);
}
const sx = (X) => W / 2 + (X - S.cam.x) * S.cam.s;
const sy = (Y) => H / 2 - (Y - S.cam.y) * S.cam.s;
function worldT() { const s = S.cam.s; ctx.setTransform(DPR * s, 0, 0, -DPR * s, DPR * (W / 2 - S.cam.x * s), DPR * (H / 2 + S.cam.y * s)); }
function screenT() { ctx.setTransform(DPR, 0, 0, DPR, 0, 0); }
function rr(x, y, w, h, r) {
  r = Math.min(r, Math.abs(w) / 2, Math.abs(h) / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y); ctx.lineTo(x + w - r, y); ctx.arcTo(x + w, y, x + w, y + r, r);
  ctx.lineTo(x + w, y + h - r); ctx.arcTo(x + w, y + h, x + w - r, y + h, r);
  ctx.lineTo(x + r, y + h); ctx.arcTo(x, y + h, x, y + h - r, r);
  ctx.lineTo(x, y + r); ctx.arcTo(x, y, x + r, y, r); ctx.closePath();
}

function drawWorld() {
  const s = S.cam.s, px = 1 / s;
  const vx1 = S.cam.x - W / 2 / s - 5, vx2 = S.cam.x + W / 2 / s + 5;
  const vy1 = S.cam.y - H / 2 / s - 5, vy2 = S.cam.y + H / 2 / s + 5;
  worldT();
  if (PAT.ground) patFill(PAT.ground); else ctx.fillStyle = COL.ground;
  ctx.fillRect(vx1, vy1, vx2 - vx1, vy2 - vy1);
  // เส้นตาราง 5 ม.
  ctx.strokeStyle = COL.grid; ctx.lineWidth = px; ctx.beginPath();
  for (let x = Math.floor(vx1 / 5) * 5; x < vx2; x += 5) { ctx.moveTo(x, vy1); ctx.lineTo(x, vy2); }
  for (let y = Math.floor(vy1 / 5) * 5; y < vy2; y += 5) { ctx.moveTo(vx1, y); ctx.lineTo(vx2, y); }
  ctx.stroke();
  // ทางเท้า + ถนน
  if (PAT.walk) patFill(PAT.walk); else ctx.fillStyle = COL.walk;
  ctx.fillRect(vx1, -11, vx2 - vx1, 22); ctx.fillRect(CROSS_X - 11, vy1, 22, vy2 - vy1);
  if (PAT.road) patFill(PAT.road); else ctx.fillStyle = COL.road;
  ctx.fillRect(vx1, -8.5, vx2 - vx1, 17); ctx.fillRect(CROSS_X - 8.5, vy1, 17, vy2 - vy1);
  // ขอบคันหิน
  ctx.fillStyle = "rgba(255,255,255,.35)";
  [[8.5, 0.25], [-8.75, 0.25]].forEach(([y, h]) => { ctx.fillRect(vx1, y, CROSS_X - 8.5 - vx1, h); ctx.fillRect(CROSS_X + 8.5, y, vx2 - CROSS_X - 8.5, h); });
  [[CROSS_X - 8.75, 0.25], [CROSS_X + 8.5, 0.25]].forEach(([x, w]) => { ctx.fillRect(x, 8.5, w, vy2 - 8.5); ctx.fillRect(x, vy1, w, -8.5 - vy1); });
  // รอยล้อจาง ๆ กลางช่องจราจร
  ctx.fillStyle = "rgba(0,0,0,.07)";
  [5.25, 1.75, -1.75, -5.25].forEach((c) => [-0.95, 0.95].forEach((o) => { ctx.fillRect(vx1, c + o - 0.3, CROSS_X - 9 - vx1, 0.6); ctx.fillRect(CROSS_X + 9, c + o - 0.3, vx2 - CROSS_X - 9, 0.6); }));
  const inX = (x) => x > CROSS_X - 8.5 && x < CROSS_X + 8.5, inY = (y) => y > -8.5 && y < 8.5;
  // เส้นขอบทาง / แบ่งช่อง / เส้นกลางถนน
  ctx.lineWidth = 0.15;
  ctx.strokeStyle = COL.mark; ctx.beginPath();
  [-7, 7].forEach((y) => { ctx.moveTo(vx1, y); ctx.lineTo(CROSS_X - 8.5, y); ctx.moveTo(CROSS_X + 8.5, y); ctx.lineTo(vx2, y); });
  [CROSS_X - 7, CROSS_X + 7].forEach((x) => { ctx.moveTo(x, vy1); ctx.lineTo(x, -8.5); ctx.moveTo(x, 8.5); ctx.lineTo(x, vy2); });
  ctx.stroke();
  ctx.beginPath();
  for (let x = Math.floor(vx1 / 6) * 6; x < vx2; x += 6) if (!inX(x) && !inX(x + 3)) [-3.5, 3.5].forEach((y) => { ctx.moveTo(x, y); ctx.lineTo(x + 3, y); });
  for (let y = Math.floor(vy1 / 6) * 6; y < vy2; y += 6) if (!inY(y) && !inY(y + 3)) [CROSS_X - 3.5, CROSS_X + 3.5].forEach((x) => { ctx.moveTo(x, y); ctx.lineTo(x, y + 3); });
  ctx.stroke();
  ctx.strokeStyle = COL.yellow; ctx.beginPath();
  [-0.12, 0.12].forEach((o) => {
    ctx.moveTo(vx1, o); ctx.lineTo(CROSS_X - 12, o); ctx.moveTo(CROSS_X + 12, o); ctx.lineTo(vx2, o);
    ctx.moveTo(CROSS_X + o, vy1); ctx.lineTo(CROSS_X + o, -12); ctx.moveTo(CROSS_X + o, 12); ctx.lineTo(CROSS_X + o, vy2);
  });
  ctx.stroke();
  // ทางม้าลาย + เส้นหยุด
  ctx.fillStyle = COL.mark;
  for (let y = -7.5; y < 7.5; y += 1) { ctx.fillRect(CROSS_X - 12, y, 3, 0.5); ctx.fillRect(CROSS_X + 9, y, 3, 0.5); }
  for (let x = CROSS_X - 7.5; x < CROSS_X + 7.5; x += 1) { ctx.fillRect(x, 9, 0.5, 3); ctx.fillRect(x, -12, 0.5, 3); }
  ctx.fillRect(CROSS_X - 12.8, 0, 0.4, 7); ctx.fillRect(CROSS_X + 12.4, -7, 0.4, 7);
  drawDecor(vx1, vx2, vy1, vy2);
}
// ตึก (หลังคา + เงา) ต้นไม้ เสาไฟ — แสงแดดมาจากซ้ายบน เงาทอดไปขวาล่าง
function drawDecor(vx1, vx2, vy1, vy2) {
  const px = 1 / S.cam.s, inView = (x, y, r) => x + r > vx1 && x - r < vx2 && y + r > vy1 && y - r < vy2;
  CITY.B.forEach((b) => {
    if (!inView(b.x, b.y, Math.max(b.w, b.d) / 2 + b.h * 0.4)) return;
    const x1 = b.x - b.w / 2, y1 = b.y - b.d / 2, sh = Math.min(b.h * 0.35, 14);
    ctx.fillStyle = "rgba(0,0,0,.22)";
    ctx.beginPath();
    ctx.moveTo(x1 + b.w, y1 + b.d); ctx.lineTo(x1 + b.w + sh, y1 + b.d - sh); ctx.lineTo(x1 + b.w + sh, y1 - sh); ctx.lineTo(x1 + sh, y1 - sh); ctx.lineTo(x1, y1); ctx.lineTo(x1 + b.w, y1);
    ctx.closePath(); ctx.fill();
    const col = BUILD_COLORS[b.c % BUILD_COLORS.length];
    const g = ctx.createLinearGradient(x1, y1 + b.d, x1 + b.w, y1);
    g.addColorStop(0, col); g.addColorStop(1, "rgba(0,0,0,0)");
    ctx.fillStyle = col; ctx.fillRect(x1, y1, b.w, b.d);
    ctx.fillStyle = "rgba(255,255,255,.18)"; ctx.fillRect(x1, y1 + b.d - 0.6, b.w, 0.6); ctx.fillRect(x1, y1, 0.6, b.d);
    ctx.strokeStyle = "rgba(0,0,0,.25)"; ctx.lineWidth = px; ctx.strokeRect(x1, y1, b.w, b.d);
    // อุปกรณ์บนหลังคา
    ctx.fillStyle = "rgba(90,96,104,.55)";
    ctx.fillRect(b.x + b.w * 0.05, b.y - b.d * 0.15, b.w * 0.3, b.d * 0.25);
    ctx.fillStyle = "rgba(255,255,255,.45)";
    for (let i = 0; i < 3; i++) ctx.fillRect(x1 + 1.2 + i * 1.6, y1 + 1.2, 1.1, 1.1);
  });
  CITY.T.forEach((t) => {
    if (!inView(t.x, t.y, 4)) return;
    const r = 1.9 * t.s;
    ctx.fillStyle = "rgba(0,0,0,.2)"; ctx.beginPath(); ctx.ellipse(t.x + r * 0.55, t.y - r * 0.55, r, r * 0.9, 0, 0, Math.PI * 2); ctx.fill();
    const g = ctx.createRadialGradient(t.x - r * 0.3, t.y + r * 0.3, r * 0.1, t.x, t.y, r);
    g.addColorStop(0, "#7fae5a"); g.addColorStop(0.7, "#4f7a3a"); g.addColorStop(1, "#3a5c2b");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(t.x, t.y, r, 0, Math.PI * 2); ctx.fill();
  });
  CITY.Lm.forEach((l) => {
    if (!inView(l.x, l.y, 4)) return;
    ctx.strokeStyle = "#4b5057"; ctx.lineWidth = 0.14;
    ctx.beginPath(); ctx.moveTo(l.x, l.y); ctx.lineTo(l.x, l.y - l.dir * 2.2); ctx.stroke();
    ctx.fillStyle = "#4b5057"; ctx.beginPath(); ctx.arc(l.x, l.y, 0.2, 0, Math.PI * 2); ctx.fill();
    ctx.fillStyle = S.night ? "#ffe6a8" : "#d9dce0"; ctx.fillRect(l.x - 0.35, l.y - l.dir * 2.2 - 0.2, 0.7, 0.4);
  });
}
function drawSkids() {
  if (!S.skids.length) return;
  worldT();
  ctx.lineCap = "round"; ctx.lineWidth = 0.32;
  [0.22, 0.55].forEach((a) => {
    ctx.strokeStyle = "rgba(18,18,20," + a + ")"; ctx.beginPath();
    S.skids.forEach((k) => { if (k[4] === a) { ctx.moveTo(k[0], k[1]); ctx.lineTo(k[2], k[3]); } });
    ctx.stroke();
  });
  ctx.lineCap = "butt";
}
function drawSmoke() {
  if (!S.smoke.length) return;
  worldT();
  S.smoke.forEach((pt) => {
    const a = Math.max(0, pt.life / 1.4) * 0.38;
    const g = ctx.createRadialGradient(pt.x, pt.y, 0, pt.x, pt.y, pt.r);
    g.addColorStop(0, "rgba(225,225,225," + a + ")"); g.addColorStop(1, "rgba(225,225,225,0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(pt.x, pt.y, pt.r, 0, Math.PI * 2); ctx.fill();
  });
}
// ไฟเบรก ไฟท้าย ไฟถอย ไฟเลี้ยว
function drawLights() {
  worldT();
  const t = performance.now() / 1000, blink = Math.sin(t * 9.5) > 0;
  const braking = S.brakeA > 0.05, rev = S.v < -0.05, turn = Math.abs(S.steer) > 6 * DEG ? Math.sign(S.steer) : 0;
  const glow = (x, y, r, rgb, a) => {
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, "rgba(" + rgb + "," + a + ")"); g.addColorStop(1, "rgba(" + rgb + ",0)");
    ctx.fillStyle = g; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  };
  const lb = lastBody();
  S.units.forEach((u) => {
    if (u.def.front == null) return;
    [HW - 0.25, -HW + 0.25].forEach((y) => {
      const [x, yy] = toWorld(u, u.def.rear + 0.05, y);
      ctx.fillStyle = braking ? "#ff2a2a" : "#9b1c1c"; ctx.beginPath(); ctx.arc(x, yy, 0.16, 0, Math.PI * 2); ctx.fill();
      if (braking) glow(x, yy, 1.8, "255,40,40", 0.55); else if (S.night) glow(x, yy, 1.0, "255,40,40", 0.3);
      if (rev && u === lb) glow(x, yy, 1.4, "255,255,255", 0.7);
    });
  });
  if (turn && blink) {
    const tr = S.units[0], y = turn * (HW - 0.15);
    [toWorld(tr, tr.def.front, y), toWorld(lb, lb.def.rear, y)].forEach(([x, yy]) => {
      ctx.fillStyle = "#ffb020"; ctx.beginPath(); ctx.arc(x, yy, 0.18, 0, Math.PI * 2); ctx.fill();
      glow(x, yy, 1.5, "255,170,30", 0.65);
    });
  }
}
// กลางคืน: ฉากมืด เปิดช่องแสงตามไฟถนนและไฟหน้ารถ
const nightC = document.createElement("canvas"), nctx = nightC.getContext("2d");
function drawNight() {
  if (nightC.width !== cv.width || nightC.height !== cv.height) { nightC.width = cv.width; nightC.height = cv.height; }
  nctx.setTransform(1, 0, 0, 1, 0, 0); nctx.globalCompositeOperation = "source-over";
  nctx.clearRect(0, 0, nightC.width, nightC.height);
  nctx.fillStyle = "rgba(4,8,22,0.82)"; nctx.fillRect(0, 0, nightC.width, nightC.height);
  nctx.globalCompositeOperation = "destination-out";
  nctx.setTransform(DPR, 0, 0, DPR, 0, 0);
  const hole = (X, Y, R, a) => {
    const g = nctx.createRadialGradient(X, Y, 0, X, Y, R);
    g.addColorStop(0, "rgba(0,0,0," + a + ")"); g.addColorStop(1, "rgba(0,0,0,0)");
    nctx.fillStyle = g; nctx.fillRect(X - R, Y - R, R * 2, R * 2);
  };
  CITY.Lm.forEach((l) => { const X = sx(l.x), Y = sy(l.y - l.dir * 2.2), R = 11 * S.cam.s; if (X > -R && X < W + R && Y > -R && Y < H + R) hole(X, Y, R, 0.8); });
  const tr = S.units[0];
  [HW - 0.35, -HW + 0.35].forEach((yo) => {
    const [fx, fy] = toWorld(tr, tr.def.front, yo), X = sx(fx), Y = sy(fy), R = 42 * S.cam.s;
    nctx.save(); nctx.translate(X, Y); nctx.rotate(-tr.th);
    const g = nctx.createRadialGradient(0, 0, 0, 0, 0, R);
    g.addColorStop(0, "rgba(0,0,0,.95)"); g.addColorStop(0.6, "rgba(0,0,0,.6)"); g.addColorStop(1, "rgba(0,0,0,0)");
    nctx.fillStyle = g; nctx.beginPath(); nctx.moveTo(0, 0); nctx.arc(0, 0, R, -0.33, 0.33); nctx.closePath(); nctx.fill();
    nctx.restore();
  });
  S.units.forEach((u) => { if (u.def.front != null) { const [x, y] = toWorld(u, (u.def.front + u.def.rear) / 2, 0); hole(sx(x), sy(y), 7 * S.cam.s, 0.35); } });
  ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.drawImage(nightC, 0, 0);
  // แสงอุ่น ๆ ของไฟถนน
  screenT(); ctx.globalCompositeOperation = "lighter";
  CITY.Lm.forEach((l) => {
    const X = sx(l.x), Y = sy(l.y - l.dir * 2.2), R = 9 * S.cam.s;
    if (X < -R || X > W + R || Y < -R || Y > H + R) return;
    const g = ctx.createRadialGradient(X, Y, 0, X, Y, R);
    g.addColorStop(0, "rgba(255,190,90,.22)"); g.addColorStop(1, "rgba(255,190,90,0)");
    ctx.fillStyle = g; ctx.fillRect(X - R, Y - R, R * 2, R * 2);
  });
  ctx.globalCompositeOperation = "source-over";
}

function drawVisibility() {
  screenT();
  ctx.imageSmoothingEnabled = true;
  const s = S.cam.s;
  ctx.drawImage(G.off, sx(G.minX), sy(G.maxY), G.nx * CELL * s, G.ny * CELL * s);
  // เส้นขอบมุมอับ
  const segs = blindOutline(), X = (i) => sx(G.minX + (i + 0.5) * CELL), Y = (j) => sy(G.maxY - (j + 0.5) * CELL);
  ctx.strokeStyle = COL.bad; ctx.lineWidth = 1.6; ctx.setLineDash([]); ctx.beginPath();
  for (let i = 0; i < segs.length; i += 2) { ctx.moveTo(X(segs[i][0]), Y(segs[i][1])); ctx.lineTo(X(segs[i + 1][0]), Y(segs[i + 1][1])); }
  ctx.stroke();
}

/* ---------------- โซนอันตรายตามความเร็ว ----------------
   มุมอับไม่เปลี่ยนตามความเร็ว แต่พื้นที่ที่ "ต้องมองเห็น" ยาวขึ้นตามความเร็ว:
   - หน้า: ระยะหยุดรถ (ระยะคิด + ระยะเบรก)
   - หลัง: ระยะที่รถตามหลังควรเว้น 2 วินาที (ขั้นต่ำ 5 ม.)
   - ข้างซ้าย/ขวา: ช่องจราจรข้าง ๆ ตลอดความยาวรถ + ระยะที่รถกำลังแซงวิ่งเข้ามาได้ใน 1.5 วินาที */
const ZONE_COL = "#e8890c", LANE_W = 3.5;
const ZONE_NAME = { front: "หน้า: ระยะหยุดรถ", rear: "หลัง: เว้นระยะ 2 วิ", left: "ช่องซ้าย: รถแซง 1.5 วิ", right: "ช่องขวา: รถแซง 1.5 วิ" };
/* โซนเป็น "แถบ" ตามเส้นทาง ไม่ใช่สี่เหลี่ยมแข็ง ๆ:
   - หน้า: ตามเส้นทางที่รถกำลังจะวิ่งไปด้วยมุมพวงมาลัยตอนนี้ (โค้งตามการเลี้ยว)
   - หลัง + ส่วนต่อท้ายช่องข้าง: ตามเส้นทางที่ท้ายรถเพิ่งวิ่งผ่านมา (โค้งตามรอยที่รถมา)
   - ช่องข้างตลอดตัวรถ: ติดกับรถแต่ละท่อน (หัว/หาง) จึงหักตามข้อต่อ */
function predictFront(s) {
  const t = S.units[0], k = S.kS || 0, th = t.th + k * s;
  let x, y;
  if (Math.abs(k) < 1e-5) { x = t.x + s * Math.cos(t.th); y = t.y + s * Math.sin(t.th); }
  else { x = t.x + (Math.sin(th) - Math.sin(t.th)) / k; y = t.y - (Math.cos(th) - Math.cos(t.th)) / k; }
  return { x: x + t.def.front * Math.cos(th), y: y + t.def.front * Math.sin(th), th };
}
function pathBack(len) {
  const lb = lastBody(), [rx, ry] = toWorld(lb, lb.def.rear, 0), c = Math.cos(lb.th), sn = Math.sin(lb.th);
  const out = [{ x: rx, y: ry, th: lb.th }];
  let acc = 0, px = rx, py = ry, started = false;
  for (let i = S.hist.length - 1; i >= 0 && acc < len; i--) {
    const h = S.hist[i];
    if (!started && (h.x - rx) * c + (h.y - ry) * sn > -0.3) continue;   // ข้ามจุดที่อยู่หน้าท้ายรถ
    started = true;
    const d = Math.hypot(h.x - px, h.y - py);
    if (d < 0.45) continue;
    const th = Math.atan2(py - h.y, px - h.x);
    if (acc + d > len) { const f = (len - acc) / d; out.push({ x: px + (h.x - px) * f, y: py + (h.y - py) * f, th }); acc = len; break; }
    acc += d; out.push({ x: h.x, y: h.y, th }); px = h.x; py = h.y;
  }
  if (acc < len) { const th = out[out.length - 1].th, rem = len - acc; out.push({ x: px - Math.cos(th) * rem, y: py - Math.sin(th) * rem, th }); }
  return out;
}
// เติมจุดให้ห่างกันไม่เกิน step (ใช้สุ่มตัวอย่างและให้ขอบโค้งเนียน)
function resample(pts, step) {
  const out = [pts[0]];
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i], d = Math.hypot(b.x - a.x, b.y - a.y), n = Math.max(1, Math.ceil(d / step));
    for (let k = 1; k <= n; k++) { const f = k / n; out.push({ x: a.x + (b.x - a.x) * f, y: a.y + (b.y - a.y) * f, th: f < 1 ? a.th + wrap(b.th - a.th) * f : b.th }); }
  }
  return out;
}
function strip(key, pts, o1, o2, extra) {
  const P2 = resample(pts, 0.5), L = [], R = [], samples = [];
  P2.forEach((p, i) => {
    const nx = -Math.sin(p.th), ny = Math.cos(p.th);
    L.push([p.x + nx * o2, p.y + ny * o2]); R.push([p.x + nx * o1, p.y + ny * o1]);
    if (i % 1 === 0) for (let o = o1 + 0.25; o < o2; o += 0.5) samples.push([p.x + nx * o, p.y + ny * o]);
  });
  const e = P2[P2.length - 1], mid = (o1 + o2) / 2;
  return Object.assign({ key, L, R, samples, far: [e.x - Math.sin(e.th) * mid, e.y + Math.cos(e.th) * mid] }, extra || {});
}
function zoneRects() {
  const v = Math.max(0, S.v);
  if (v < 1 || !S.opts.zone) return [];
  const sd = stopDistance(v), w = HW + 0.35, rear = Math.max(5, v * 2), side = v * 1.5;
  const front = [];
  for (let d = 0; d < sd.total; d += 0.5) front.push(predictFront(d));
  front.push(predictFront(sd.total));
  const z = [strip("front", front, -w, w, { len: sd.total }), strip("rear", pathBack(rear), -w, w, { len: rear })];
  const back = pathBack(side), lo = HW + 0.3, hi = HW + 0.3 + LANE_W;
  S.units.forEach((u) => {
    if (u.def.front == null) return;
    const [ax, ay] = toWorld(u, u.def.front, 0), [bx, by] = toWorld(u, u.def.rear, 0);
    const seg = [{ x: ax, y: ay, th: u.th }, { x: bx, y: by, th: u.th }];
    z.push(strip("left", seg, lo, hi), strip("right", seg, -hi, -lo));
  });
  z.push(strip("left", back, lo, hi, { tail: true, len: side }), strip("right", back, -hi, -lo, { tail: true, len: side }));
  return z;
}
function zoneStats(shapes) {
  const acc = {};
  shapes.forEach((z) => {
    const a = acc[z.key] || (acc[z.key] = { n: 0, blind: 0, len: 0 });
    if (z.len) a.len = z.len;
    z.samples.forEach(([x, y]) => { const c = classify(x, y); if (c === VIS.INSIDE) return; a.n++; if (c === VIS.BLIND) a.blind++; });
  });
  Object.keys(acc).forEach((k) => { acc[k].pct = acc[k].n ? acc[k].blind / acc[k].n * 100 : 0; });
  return acc;
}
function drawZones(shapes) {
  if (!shapes.length) return;
  worldT();
  const px = 1 / S.cam.s;
  ctx.fillStyle = "rgba(232,137,12,.11)"; ctx.strokeStyle = ZONE_COL; ctx.lineWidth = 1.5 * px; ctx.setLineDash([7 * px, 5 * px]);
  shapes.forEach((z) => {
    ctx.beginPath();
    z.L.forEach(([x, y], i) => (i ? ctx.lineTo(x, y) : ctx.moveTo(x, y)));
    for (let i = z.R.length - 1; i >= 0; i--) ctx.lineTo(z.R[i][0], z.R[i][1]);
    ctx.closePath(); ctx.fill(); ctx.stroke();
  });
  ctx.setLineDash([]);
  screenT();
  const st = S.zoneStats || {};
  shapes.forEach((z) => {
    const a = st[z.key];
    if (!a || !(z.key === "rear" || z.tail) || (z.tail && S.cam.s < 9)) return;
    const name = z.key === "rear" ? "เว้นท้าย 2 วิ " + a.len.toFixed(0) + " ม." : z.key === "left" ? "รถแซงซ้าย" : "รถแซงขวา";
    label(sx(z.far[0]), sy(z.far[1]), name + " · มองไม่เห็น " + Math.round(a.pct) + "%", ZONE_COL);
  });
}
function updateZonePanel() {
  const st = S.zoneStats || {}, rows = ["front", "rear", "left", "right"].map((k) => {
    const a = st[k];
    const val = !a ? "–" : (a.len ? a.len.toFixed(0) + " ม. · " : "") + "มองไม่เห็น " + Math.round(a.pct) + "%";
    return "<tr" + (a && a.pct >= 50 ? ' class="warn"' : "") + "><td>" + ZONE_NAME[k] + "</td><td>" + val + "</td></tr>";
  });
  $("zones").innerHTML = rows.join("");
}

function drawStopMarker() {
  if (S.v < 2) return;
  const sd = stopDistance(S.v), pr = predictFront(sd.r), pt = predictFront(sd.total);
  screenT();
  // เส้นทางที่ด้านหน้ารถจะวิ่งไป (ประตามพวงมาลัย)
  ctx.strokeStyle = "rgba(229,72,77,.55)"; ctx.lineWidth = 2; ctx.setLineDash([3, 5]); ctx.beginPath();
  for (let d = 0; d <= sd.total; d += 1) { const p = predictFront(d); d ? ctx.lineTo(sx(p.x), sy(p.y)) : ctx.moveTo(sx(p.x), sy(p.y)); }
  ctx.stroke(); ctx.setLineDash([]);
  const line = (p, col, text, dash) => {
    const x = sx(p.x), y = sy(p.y), nx = -Math.sin(p.th) * HW * 1.6 * S.cam.s, ny = -Math.cos(p.th) * HW * 1.6 * S.cam.s;
    ctx.strokeStyle = col; ctx.lineWidth = 3; ctx.setLineDash(dash ? [6, 4] : []);
    ctx.beginPath(); ctx.moveTo(x + nx, y + ny); ctx.lineTo(x - nx, y - ny); ctx.stroke(); ctx.setLineDash([]);
    label(x - nx * 1.4, y - ny * 1.4, text, col);
  };
  line(pr, "#d68a00", "เริ่มเบรก " + sd.r.toFixed(0) + " ม.", true);
  const fz = S.zoneStats && S.zoneStats.front;
  line(pt, COL.bad, "หยุดสนิท " + sd.total.toFixed(0) + " ม." + (fz ? " · มองไม่เห็น " + Math.round(fz.pct) + "%" : ""), false);
}
function drawTrails() {
  if (!S.opts.trail) return;
  worldT();
  const px = 1 / S.cam.s;
  ctx.lineWidth = 2 * px; ctx.setLineDash([6 * px, 4 * px]);
  S.trails.forEach((t, i) => {
    if (t.length < 2) return;
    ctx.strokeStyle = i < 2 ? "rgba(37,99,235,.85)" : "rgba(234,128,24,.9)";
    ctx.beginPath(); ctx.moveTo(t[0][0], t[0][1]);
    for (let k = 1; k < t.length; k++) ctx.lineTo(t[k][0], t[k][1]);
    ctx.stroke();
  });
  ctx.setLineDash([]);
}

function drawObjects(states) {
  worldT();
  const px = 1 / S.cam.s, now = performance.now() / 1000;
  S.objects.forEach((o, i) => {
    const st = states[i];
    const col = st === "seen" ? COL.ok : COL.bad;
    ctx.save(); ctx.translate(o.x, o.y); ctx.rotate(o.th);
    const [l, w] = OBJ[o.t];
    if (st !== "seen") {
      const pulse = 0.6 + 0.4 * Math.sin(now * 6);
      ctx.strokeStyle = col; ctx.globalAlpha = pulse; ctx.lineWidth = 2.5 * px;
      ctx.beginPath(); ctx.arc(0, 0, Math.max(l, w) / 2 + 0.6, 0, Math.PI * 2); ctx.stroke(); ctx.globalAlpha = 1;
    }
    ctx.lineWidth = 1.5 * px; ctx.strokeStyle = "rgba(0,0,0,.55)";
    if (o.t === "ped") {
      ctx.fillStyle = st === "seen" ? "#3b6fd8" : col;
      ctx.beginPath(); ctx.ellipse(0, 0, 0.22, 0.3, 0, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#f2c9a0"; ctx.beginPath(); ctx.arc(0, 0, 0.12, 0, Math.PI * 2); ctx.fill();
    } else if (o.t === "moto") {
      ctx.fillStyle = "#222"; rr(-1.0, -0.12, 2.0, 0.24, 0.1); ctx.fill();
      ctx.fillStyle = st === "seen" ? "#3b6fd8" : col; rr(-0.55, -0.3, 1.05, 0.6, 0.25); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "#333"; ctx.fillRect(0.45, -0.38, 0.08, 0.76);
      ctx.fillStyle = "#f2c9a0"; ctx.beginPath(); ctx.arc(-0.05, 0, 0.16, 0, Math.PI * 2); ctx.fill();
    } else {
      ctx.fillStyle = st === "seen" ? "#5b7fbf" : col; rr(-l / 2, -w / 2, l, w, 0.5); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "rgba(20,30,45,.7)"; rr(0.45, -0.75, 0.75, 1.5, 0.2); ctx.fill(); rr(-1.6, -0.72, 0.5, 1.44, 0.2); ctx.fill();
    }
    if (st === "hit") {
      ctx.strokeStyle = "#fff"; ctx.lineWidth = 3 * px;
      ctx.beginPath(); ctx.moveTo(-0.5, -0.5); ctx.lineTo(0.5, 0.5); ctx.moveTo(-0.5, 0.5); ctx.lineTo(0.5, -0.5); ctx.stroke();
    }
    ctx.restore();
  });
}

const CAR_COLORS = ["#d94a3d", "#f2f2f2", "#2d2f33", "#3a72c9", "#9aa1a8", "#e0b23a"];
function drawUnit(u, idx) {
  const d = u.def, px = 1 / S.cam.s;
  ctx.save();
  ctx.transform(Math.cos(u.th), Math.sin(u.th), -Math.sin(u.th), Math.cos(u.th), u.x, u.y);
  ctx.lineWidth = 1.2 * px;
  if (d.front != null) {
    ctx.save();
    ctx.shadowColor = "rgba(0,0,0,.45)"; ctx.shadowBlur = 0.8 * S.cam.s;
    ctx.shadowOffsetX = 0.55 * S.cam.s; ctx.shadowOffsetY = 0.55 * S.cam.s;
    ctx.fillStyle = "rgba(0,0,0,.25)"; rr(d.rear, -HW, d.front - d.rear, HW * 2, 0.4); ctx.fill();
    ctx.restore();
  }
  d.parts.forEach((p) => {
    if (p.t === "chassis") { ctx.fillStyle = "#3b3e42"; ctx.fillRect(p.x1, -p.hw, p.x2 - p.x1, p.hw * 2); }
    if (p.t === "fifth") { ctx.fillStyle = "#6b6f75"; ctx.beginPath(); ctx.arc(p.x, 0, 0.55, 0, Math.PI * 2); ctx.fill(); ctx.fillStyle = "#222"; ctx.beginPath(); ctx.arc(p.x, 0, 0.12, 0, Math.PI * 2); ctx.fill(); }
    if (p.t === "tank") {
      const tg = ctx.createLinearGradient(0, -HW, 0, HW);
      tg.addColorStop(0, "#9ea6ad"); tg.addColorStop(0.35, "#f4f6f7"); tg.addColorStop(0.55, "#ffffff"); tg.addColorStop(1, "#aeb6bd");
      ctx.fillStyle = tg; ctx.strokeStyle = "#7d868e"; rr(p.x1, -HW, p.x2 - p.x1, HW * 2, 0.9); ctx.fill(); ctx.stroke();
      ctx.fillStyle = "rgba(0,0,0,.07)"; ctx.fillRect(p.x1 + 0.4, -0.35, p.x2 - p.x1 - 0.8, 0.7);
      ctx.fillStyle = "#9aa3ab";
      for (let x = p.x1 + 1.4; x < p.x2 - 0.8; x += 2.3) { ctx.beginPath(); ctx.arc(x, 0, 0.28, 0, Math.PI * 2); ctx.fill(); }
      ctx.fillStyle = "#6cb200"; ctx.fillRect(p.x1 + 0.2, -HW, p.x2 - p.x1 - 0.4, 0.14); ctx.fillRect(p.x1 + 0.2, HW - 0.14, p.x2 - p.x1 - 0.4, 0.14);
    }
    if (p.t === "deck") {
      ctx.fillStyle = "rgba(60,64,70,.35)"; ctx.strokeStyle = "#4b5057"; ctx.fillRect(p.x1, -HW, p.x2 - p.x1, HW * 2); ctx.strokeRect(p.x1, -HW, p.x2 - p.x1, HW * 2);
      ctx.fillStyle = "#4b5057"; ctx.fillRect(p.x1, HW - 0.12, p.x2 - p.x1, 0.12); ctx.fillRect(p.x1, -HW, p.x2 - p.x1, 0.12);
      const n = p.cars, len = p.x2 - p.x1, cl = Math.min(p.carLen || 99, (len - 0.3) / n - 0.15), gap = (len - n * cl) / (n + 1);
      for (let i = 0; i < n; i++) {
        const x = p.x2 - gap - (i + 1) * cl - i * gap;
        ctx.fillStyle = CAR_COLORS[(idx * 2 + i) % CAR_COLORS.length]; ctx.strokeStyle = "rgba(0,0,0,.45)";
        rr(x, -0.85, cl, 1.7, 0.45); ctx.fill(); ctx.stroke();
        ctx.fillStyle = "rgba(20,30,45,.65)"; rr(x + cl * 0.62, -0.68, cl * 0.17, 1.36, 0.15); ctx.fill(); rr(x + cl * 0.12, -0.65, cl * 0.12, 1.3, 0.15); ctx.fill();
      }
    }
    if (p.t === "drawbar") {
      ctx.strokeStyle = "#3b3e42"; ctx.lineWidth = 0.16;
      ctx.beginPath(); ctx.moveTo(p.x1, -0.8); ctx.lineTo(p.x2, 0); ctx.lineTo(p.x1, 0.8); ctx.stroke();
      ctx.lineWidth = 1.2 * px;
    }
    if (p.t === "dolly") {
      ctx.strokeStyle = "#3b3e42"; ctx.lineWidth = 0.18;
      ctx.beginPath(); ctx.moveTo(0, -0.9); ctx.lineTo(d.L, 0); ctx.lineTo(0, 0.9); ctx.stroke();
      ctx.fillStyle = "#3b3e42"; ctx.fillRect(-0.5, -1.05, 1.0, 2.1);
      ctx.fillStyle = "#6b6f75"; ctx.beginPath(); ctx.arc(0, 0, 0.5, 0, Math.PI * 2); ctx.fill();
      ctx.lineWidth = 1.2 * px;
    }
  });
  // ล้อ
  d.axles.forEach((a) => {
    const ys = a.dual ? [HW - 0.17, HW - 0.52, -HW + 0.17, -HW + 0.52] : [HW - 0.2, -HW + 0.2];
    ys.forEach((y) => {
      ctx.save(); ctx.translate(a.x, y); if (a.steer) ctx.rotate(S.steer);
      ctx.fillStyle = "#151515"; rr(-0.5, -0.15, 1.0, 0.3, 0.08); ctx.fill();
      ctx.restore();
    });
  });
  // ห้องโดยสาร + กระจกข้าง + ตำแหน่งคนขับ
  if (d.kind === "truck") {
    const cf = d.cabFront, cb = d.cabBack;
    ctx.fillStyle = d.color; ctx.strokeStyle = "rgba(0,0,0,.5)";
    rr(cb, -HW, cf - cb, HW * 2, 0.35); ctx.fill(); ctx.stroke();
    const cg = ctx.createLinearGradient(0, -HW, 0, HW);
    cg.addColorStop(0, "rgba(0,0,0,.22)"); cg.addColorStop(0.45, "rgba(255,255,255,.28)"); cg.addColorStop(1, "rgba(0,0,0,.18)");
    ctx.fillStyle = cg; rr(cb, -HW, cf - cb, HW * 2, 0.35); ctx.fill();
    ctx.fillStyle = "rgba(255,255,255,.18)"; rr(cb + 0.25, -HW + 0.25, cf - cb - 0.6, HW * 2 - 0.5, 0.2); ctx.fill();
    ctx.fillStyle = "rgba(0,0,0,.25)"; ctx.fillRect(cb + 0.35, -0.5, 0.5, 1.0);
    ctx.fillStyle = "rgba(20,30,45,.8)"; ctx.fillRect(cf - 0.28, -HW + 0.12, 0.16, HW * 2 - 0.24);
    ctx.strokeStyle = "#222"; ctx.lineWidth = 0.07;
    P.mirrors.forEach((m) => { ctx.beginPath(); ctx.moveTo(m.lx + 0.1, m.side * (HW - 0.05)); ctx.lineTo(m.lx, m.ly); ctx.stroke(); });
    ctx.fillStyle = "#222"; P.mirrors.forEach((m) => ctx.fillRect(m.lx - 0.12, m.ly - 0.09, 0.24, 0.18));
    ctx.fillStyle = "#ffd54a"; ctx.strokeStyle = "#222"; ctx.lineWidth = 1.2 * px;
    ctx.beginPath(); ctx.arc(P.eyeL[0], P.eyeL[1], 0.22, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
    // รถคันบนแร็คเหนือหัวเก๋ง (วาดโปร่งให้ยังเห็นห้องโดยสารกับตำแหน่งคนขับ)
    d.parts.forEach((p) => {
      if (p.t !== "rackcar") return;
      ctx.globalAlpha = 0.45;
      ctx.fillStyle = "#3a72c9"; ctx.strokeStyle = "rgba(0,0,0,.6)";
      rr(p.x1, -0.88, p.x2 - p.x1, 1.76, 0.45); ctx.fill(); ctx.stroke();
      ctx.globalAlpha = 1;
      ctx.strokeStyle = "#4b5057"; ctx.lineWidth = 0.08; ctx.strokeRect(p.x1 - 0.1, -HW + 0.1, p.x2 - p.x1 + 0.2, HW * 2 - 0.2);
      ctx.lineWidth = 1.2 * px;
    });
  }
  ctx.restore();
}
function drawRig() {
  worldT();
  for (let i = S.units.length - 1; i >= 0; i--) drawUnit(S.units[i], i);
  // จุดต่อพ่วง
  const px = 1 / S.cam.s;
  for (let i = 1; i < S.units.length; i++) {
    const p = S.units[i - 1], [hx, hy] = toWorld(p, p.def.hitch, 0);
    ctx.fillStyle = "#ffd54a"; ctx.strokeStyle = "#222"; ctx.lineWidth = 1.2 * px;
    ctx.beginPath(); ctx.arc(hx, hy, 0.16, 0, Math.PI * 2); ctx.fill(); ctx.stroke();
  }
}

function label(x, y, text, color) {
  ctx.font = "500 12px 'IBM Plex Sans Thai', system-ui, sans-serif";
  const w = ctx.measureText(text).width + 12;
  ctx.fillStyle = COL.label; ctx.strokeStyle = color; ctx.lineWidth = 1;
  rr(x - w / 2, y - 10, w, 20, 10); ctx.fill(); ctx.stroke();
  ctx.fillStyle = color; ctx.textAlign = "center"; ctx.textBaseline = "middle";
  ctx.fillText(text, x, y + 0.5);
}
function drawProbes(M) {
  screenT();
  const names = { front: "หน้า", ldoor: "ซ้าย", rdoor: "ขวา", lmid: "ซ้าย", rmid: "ขวา", rear: "หลัง" };
  Object.keys(M).forEach((k) => {
    const p = M[k], len = p.d === null ? p.max : p.d;
    if (p.d !== null && p.d < 0.05) return;
    const x1 = sx(p.ox), y1 = sy(p.oy), x2 = sx(p.ox + p.wx * len), y2 = sy(p.oy + p.wy * len);
    ctx.strokeStyle = COL.bad; ctx.lineWidth = 1.5; ctx.setLineDash([4, 3]);
    ctx.beginPath(); ctx.moveTo(x1, y1); ctx.lineTo(x2, y2); ctx.stroke(); ctx.setLineDash([]);
    const nx = -(y2 - y1), ny = x2 - x1, nl = Math.hypot(nx, ny) || 1;
    ctx.beginPath(); ctx.moveTo(x2 + nx / nl * 5, y2 + ny / nl * 5); ctx.lineTo(x2 - nx / nl * 5, y2 - ny / nl * 5); ctx.stroke();
    // ป้ายไว้ปลายเส้นด้านนอก ไม่ทับตัวรถ · ซูมออกมาก (รถเล็ก) ซ่อนป้าย ดูตัวเลขในแผงแทน
    if (S.cam.s < 11) return;
    const ul =Math.hypot(x2 - x1, y2 - y1) || 1, ux = (x2 - x1) / ul, uy = (y2 - y1) / ul;
    const text = names[k] + " " + fmtM(p);
    ctx.font = "500 12px 'IBM Plex Sans Thai', system-ui, sans-serif";
    const half = ctx.measureText(text).width / 2 + 10;
    label(x2 + ux * (Math.abs(ux) * half + Math.abs(uy) * 14), y2 + uy * (Math.abs(ux) * half + Math.abs(uy) * 14), text, COL.bad);
  });
}
function drawRegionLabels() {
  screenT();
  ctx.font = "600 12px 'IBM Plex Sans Thai', system-ui, sans-serif";
  ctx.textAlign = "center"; ctx.textBaseline = "middle";
  (G.regions || []).forEach((r) => {
    const text = "≈ " + (r.area < 10 ? r.area.toFixed(1) : Math.round(r.area)) + " ตร.ม.";
    const x = sx(r.x), y = sy(r.y), w = ctx.measureText(text).width + 14;
    ctx.fillStyle = COL.bad; rr(x - w / 2, y - 11, w, 22, 11); ctx.fill();
    ctx.fillStyle = "#fff"; ctx.fillText(text, x, y + 0.5);
  });
}
function drawScale() {
  screenT();
  if (matchMedia("(pointer: coarse)").matches) return;
  // เลือกความยาวแถบสเกลให้กว้างราว 60–150 px ตามระดับซูม
  const s = S.cam.s, m = [1, 2, 5, 10, 20, 50, 100, 200].find((v) => v * s >= 60) || 200;
  const len = m * s, x = W - len - 16, y = H - 18;
  ctx.strokeStyle = COL.text; ctx.lineWidth = 2;
  ctx.beginPath(); ctx.moveTo(x, y - 5); ctx.lineTo(x, y); ctx.lineTo(x + len, y); ctx.lineTo(x + len, y - 5); ctx.stroke();
  ctx.fillStyle = COL.text; ctx.font = "12px 'IBM Plex Sans Thai', system-ui"; ctx.textAlign = "center"; ctx.textBaseline = "bottom";
  ctx.fillText(m + " ม.", x + len / 2, y - 3);
}

/* ---------------- แผงข้าง ---------------- */
function renderRigButtons() {
  const box = $("rigs"); box.innerHTML = "";
  Object.keys(RIGS).forEach((k) => {
    const r = RIGS[k], b = document.createElement("button");
    b.className = "rig"; b.type = "button";
    b.setAttribute("aria-pressed", k === S.rigKey ? "true" : "false");
    const joints = r.units.length - 1;
    b.innerHTML = "<kbd>" + r.key + "</kbd><strong>" + r.name + "</strong><span>ยาวรวม ≈ " + rigLength(k).toFixed(1) +
      " ม. · ฐานล้อหน้า " + r.units[0].wb + " ม." + (joints ? " · ข้อต่อ " + joints + " จุด" : "") + "</span>";
    b.addEventListener("click", () => { buildRig(k); b.blur(); });
    box.appendChild(b);
  });
  $("lb-lmid").textContent = S.units.length > 1 ? "ซ้าย กลางหาง/ตัวลูก" : "ซ้าย กลางตัวรถ";
  $("lb-rmid").textContent = S.units.length > 1 ? "ขวา กลางหาง/ตัวลูก" : "ขวา กลางตัวรถ";
}
function updatePanel(M) {
  Object.keys(M).forEach((k) => {
    $("pv-" + k).textContent = fmtM(M[k]);
    $("r-" + k).classList.toggle("warn", M[k].d === null || M[k].d >= 0.05);
  });
  $("pv-area").textContent = Math.round(G.blindCells * CELL * CELL) + " ตร.ม.";
  const rows = [["ความเร็ว", Math.abs(S.v * 3.6).toFixed(0) + " กม./ชม." + (S.v < -0.05 ? " (ถอย)" : "")],
    ["มุมล้อหน้า", (S.steer / DEG).toFixed(0) + "°"],
    ["มุมพวงมาลัย (≈ อัตราทด 20:1)", Math.round(S.steer / DEG * 20) + "°"]];
  for (let i = 1; i < S.units.length; i++) {
    const a = wrap(S.units[i - 1].th - S.units[i].th) / DEG;
    rows.push(["มุมหักข้อต่อ " + (S.units[i].def.label || i), a.toFixed(0) + "° / " + S.units[i].def.limit + "°"]);
  }
  $("state").innerHTML = rows.map((r) => "<tr><td>" + r[0] + "</td><td>" + r[1] + "</td></tr>").join("");
}
function updatePhysPanel() {
  const cfg = PH.cfg, sd = stopDistance(Math.max(0, S.v)), tu = S.units.find((u) => u.def.kind === "trailer");
  const t = (x) => (x / 1000).toFixed(1);
  const rows = [
    ["น้ำหนักรวม", t(PH.mTot) + " / " + cfg.rated + " ตัน" + (PH.over > 1 ? " ⚠" : "")],
    ...(PH.mTrailer ? [["· ตัวแม่ / ตัวลูก(หาง)", t(PH.mTruck) + " / " + t(PH.mTrailer) + " ตัน"]] : []),
    ["เบรกได้สูงสุด", PH.aMax.toFixed(1) + " ม./วิ² (" + (PH.aMax / GRAV).toFixed(2) + " g) · จำกัดโดย" + PH.limitBy],
    ["ระยะหยุดจากความเร็วนี้", S.v > 0.5 ? sd.total.toFixed(0) + " ม. (คิด " + sd.r.toFixed(0) + " + เบรก " + sd.b.toFixed(0) + ")" : "–"],
    ["เร่ง / หน่วงตอนนี้", (S.accel >= 0 ? "+" : "") + S.accel.toFixed(1) + " ม./วิ²"],
    ["แรงเหวี่ยงด้านข้าง", S.phys.aLat.toFixed(2) + " g / พลิกที่ ≈ " + cfg.srt + " g", S.phys.aLat > cfg.srt * 0.8]
  ];
  if (tu) {
    rows.push(["อัตราหางปัด", S.phys.artRate.toFixed(0) + " °/วิ", S.phys.artRate > 15]);
    rows.push(["ล้อหางใช้แรงยึดเกาะด้านข้าง", S.v > 3 ? Math.round(S.phys.latUse * 100) + "%" + (S.phys.locked ? " (ล้อล็อก)" : "") : "–", S.phys.latUse > 0.8 && S.v > 3]);
    rows.push(["แรงที่จุดต่อพ่วง", S.v > 3 && S.brakeA > 0 ? (S.phys.push >= 0 ? "ดันหัว " : "ดึงหัว ") + Math.abs(S.phys.push / 1000).toFixed(0) + " kN" : "–", S.phys.push > 20000]);
  }
  $("phys").innerHTML = rows.map((r) => "<tr" + (r[2] ? ' class="warn"' : "") + "><td>" + r[0] + "</td><td>" + r[1] + "</td></tr>").join("");
}
function syncPhysUi() {
  const cfg = PHYS[S.rigKey], el = $("cargo");
  el.max = cfg.cargoMax; el.value = S.opts.cargo = cfg.cargoDef;
  $("cargoNote").textContent = cfg.cargoNote + (cfg.trailer ? " · บนตัวลูก/หาง " + Math.round(cfg.split * 100) + "%" : "");
  $("tbWrap").style.display = cfg.trailer ? "" : "none";
  $("cargov").textContent = S.opts.cargo.toFixed(1) + " ตัน";
}
function updateHud() {
  const kmh = Math.abs(S.v * 3.6), gear = S.v < -0.05 ? "R" : S.v > 0.05 ? "D" : "N";
  $("hud").innerHTML = '<div class="big">' + kmh.toFixed(0) + "<small>กม./ชม. · " + gear + "</small></div>" +
    "<span>ล้อหน้า</span><b>" + (S.steer / DEG).toFixed(0) + "°</b>";
  const m = $("msg");
  if (S.msgT > 0) { m.textContent = S.msg; m.classList.add("show"); } else m.classList.remove("show");
}

/* ---------------- ลูป ---------------- */
let last = 0, panelT = 0, lastM = null;
function frame(t) {
  const dt = Math.min(0.05, (t - last) / 1000 || 0); last = t;
  step(dt);
  prep();
  // กล้องตามรถ: กลางคันรถทั้งชุด
  const b = P.bounds, tx = (b.minX + b.maxX) / 2, ty = (b.minY + b.maxY) / 2, k = Math.min(1, dt * 4);
  S.cam.x += (tx - S.cam.x) * k; S.cam.y += (ty - S.cam.y) * k;
  autoZoom(dt);

  computeGrid();
  const M = measure();
  const states = S.objects.map(objState);

  const zr = zoneRects();
  if (panelT - dt <= 0) S.zoneStats = zr.length ? zoneStats(zr) : null;
  if (S.view !== "2d" && three) {
    placeMirrorLabels(three.render(dt, states, true));
  } else {
    screenT(); ctx.clearRect(0, 0, W, H);
    drawWorld();
    drawSkids();
    if (S.night) {
      // กลางคืน: วาดรถกับวัตถุก่อน แล้วค่อยทาความมืด จากนั้นวางชั้นมุมอับ/ป้ายไว้บนสุดให้ยังอ่านได้
      drawObjects(states); drawRig(); drawSmoke(); drawNight(); drawLights();
      drawVisibility(); drawTrails(); drawZones(zr); drawStopMarker();
    } else {
      drawVisibility(); drawTrails(); drawZones(zr); drawStopMarker();
      drawObjects(states); drawRig(); drawSmoke(); drawLights();
    }
    drawProbes(M);
    drawRegionLabels();
    drawScale();
  }

  panelT -= dt;
  if (panelT <= 0) { panelT = 0.15; updatePanel(M); updatePhysPanel(); updateZonePanel(); updateHud(); zoomLabel(); }
  lastM = M;
  requestAnimationFrame(frame);
}

/* ---------------- ปุ่มและการควบคุม ---------------- */
const KEYMAP = { ArrowUp: "up", KeyW: "up", ArrowDown: "down", KeyS: "down", ArrowLeft: "left", KeyA: "left", ArrowRight: "right", KeyD: "right", Space: "brake" };
function bindControls() {
  window.addEventListener("keydown", (e) => {
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = KEYMAP[e.code];
    if (k) { S.keys.add(k); e.preventDefault(); if (document.activeElement && document.activeElement !== document.body) document.activeElement.blur(); return; }
    if (e.repeat) return;
    if (e.code === "KeyR") buildRig(S.rigKey);
    else if (e.code === "Digit1") buildRig("tanker");
    else if (e.code === "Digit2") buildRig("semi");
    else if (e.code === "Digit3") buildRig("carrier");
    else if (e.code === "KeyV") setOpt("showVis", !S.opts.showVis, "optVis");
    else if (e.code === "KeyT") setOpt("trail", !S.opts.trail, "optTrail");
    else if (e.code === "KeyZ") setOpt("zone", !S.opts.zone, "optZone");
    else if (e.code === "KeyC") setView({ "2d": "chase", chase: "driver", driver: "2d" }[S.view]);
    else if (e.code === "KeyN") setNight(!S.night);
    else if (e.key === "+" || e.key === "=") zoom(1.2);
    else if (e.key === "-" || e.key === "_") zoom(1 / 1.2);
  });
  window.addEventListener("keyup", (e) => { const k = KEYMAP[e.code]; if (k) S.keys.delete(k); });
  window.addEventListener("blur", () => S.keys.clear());

  cv.addEventListener("wheel", (e) => { e.preventDefault(); zoom(Math.exp(-e.deltaY * 0.0015)); }, { passive: false });
  cv.addEventListener("contextmenu", (e) => e.preventDefault());
  cv.addEventListener("pointerdown", (e) => {
    const r = cv.getBoundingClientRect();
    const X = S.cam.x + (e.clientX - r.left - W / 2) / S.cam.s, Y = S.cam.y - (e.clientY - r.top - H / 2) / S.cam.s;
    if (e.button === 2 || e.shiftKey) placeAt(X, Y, true);
    else if (e.button === 0) placeAt(X, Y, false);
  });
  document.querySelectorAll("#viewbar [data-view]").forEach((b) => b.addEventListener("click", () => { setView(b.dataset.view); b.blur(); }));
  $("btnNight").addEventListener("click", (e) => { setNight(!S.night); e.currentTarget.blur(); });

  document.querySelectorAll(".touch button").forEach((b) => {
    const k = b.dataset.key;
    b.addEventListener("pointerdown", (e) => { e.preventDefault(); S.keys.add(k); });
    ["pointerup", "pointerleave", "pointercancel"].forEach((ev) => b.addEventListener(ev, () => S.keys.delete(k)));
  });

  const bindCheck = (id, key) => $(id).addEventListener("change", (e) => { S.opts[key] = e.target.checked; e.target.blur(); });
  bindCheck("optProx", "prox"); bindCheck("optFront", "front"); bindCheck("optVis", "showVis");
  bindCheck("optTrail", "trail"); bindCheck("optCenter", "autoCenter"); bindCheck("optZone", "zone");
  const bindRange = (id, key, unit) => {
    const el = $(id), out = $(id + "v");
    const set = () => { S.opts[key] = +el.value; out.textContent = (+el.value).toFixed(key === "objH" ? 1 : 0) + unit; };
    el.addEventListener("input", set); el.addEventListener("change", () => el.blur()); set();
  };
  bindRange("objH", "objH", " ม."); bindRange("range", "range", " ม.");
  $("cargo").addEventListener("input", (e) => { S.opts.cargo = +e.target.value; $("cargov").textContent = S.opts.cargo.toFixed(1) + " ตัน"; updateMass(); });
  $("cargo").addEventListener("change", (e) => e.target.blur());
  $("testSpeed").addEventListener("input", (e) => { S.opts.testSpeed = +e.target.value; $("testSpeedv").textContent = e.target.value + " กม./ชม."; });
  $("testSpeed").addEventListener("change", (e) => e.target.blur());
  $("testSpeedv").textContent = S.opts.testSpeed + " กม./ชม.";
  const seg = (id, attr, key, cast) => document.querySelectorAll("#" + id + " button").forEach((b) => b.addEventListener("click", () => {
    S.opts[key] = cast(b.dataset[attr]);
    document.querySelectorAll("#" + id + " button").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
    updateMass(); b.blur();
  }));
  seg("road", "mu", "mu", Number); seg("tbrake", "m", "tbrake", String);
  $("btnTestStraight").addEventListener("click", (e) => { startTest("straight"); e.currentTarget.blur(); });
  $("btnTestSwerve").addEventListener("click", (e) => { startTest("swerve"); e.currentTarget.blur(); });

  document.querySelectorAll("#place button").forEach((b) => b.addEventListener("click", () => {
    S.opts.place = b.dataset.t;
    document.querySelectorAll("#place button").forEach((x) => x.setAttribute("aria-pressed", x === b ? "true" : "false"));
    b.blur();
  }));
  $("btnClear").addEventListener("click", (e) => { S.objects = []; e.currentTarget.blur(); });
  $("btnReset").addEventListener("click", (e) => { buildRig(S.rigKey); e.currentTarget.blur(); });
  $("btnOvertake").addEventListener("click", (e) => {
    // ปล่อยมอเตอร์ไซค์จากท้ายรถด้านซ้าย วิ่งขนานไปข้างหน้าเร็วกว่ารถ
    const lb = lastBody(), t = S.units[0];
    const [x, y] = toWorld(lb, lb.def.rear - 4, HW + 1.3);
    S.objects.push({ t: "moto", x, y, th: t.th, v: Math.max(4, S.v + 3) });
    e.currentTarget.blur();
  });

  window.addEventListener("resize", resize);
}
function setOpt(key, val, id) { S.opts[key] = val; $(id).checked = val; }
function placeAt(X, Y, remove) {
  if (remove) {
    let best = -1, bd = 3;
    S.objects.forEach((o, i) => { const d = Math.hypot(o.x - X, o.y - Y); if (d < bd) { bd = d; best = i; } });
    if (best > -1) S.objects.splice(best, 1);
    return;
  }
  S.objects.push({ t: S.opts.place, x: X, y: Y, th: S.units[0].th, v: 0 });
}

/* ---------------- มุมมอง 3D (โหลดเมื่อใช้ครั้งแรก) ---------------- */
let three = null, threeLoading = false;
const API3D = { S, P, G, HW, CELL, CROSS_X, EYE_H, toWorld, blindOutline, city: CITY, placeAt, zoneRects, stopDistance, predictFront };
async function setView(v) {
  if (v !== "2d" && !three) {
    if (threeLoading) return;
    threeLoading = true; flash("กำลังโหลดมุมมอง 3 มิติ…");
    try {
      const mod = await import("./truck_blind_spot_3d.js?v=20261123-6");
      three = mod.create3D($("view3d"), API3D);
      three.setNight(S.night);
    } catch (err) {
      console.error(err); threeLoading = false;
      flash("โหลดมุมมอง 3 มิติไม่สำเร็จ — ลองตรวจอินเทอร์เน็ตแล้วกดใหม่");
      return;
    }
    threeLoading = false; S.msgT = 0;
  }
  S.view = v;
  const is3d = v !== "2d";
  $("view3d").hidden = !is3d; cv.style.display = is3d ? "none" : "";
  $("zoomBar").style.display = is3d ? "none" : "";
  $("legendMini").style.display = is3d ? "none" : "";
  $("hint3d").hidden = !is3d;
  $("hint3d").textContent = v === "driver" ? "ลากเมาส์ = หันมองรอบตัว · ล้อเมาส์ = มุมกว้าง/แคบ · จอซ้าย-ขวา = กระจกมองข้าง" : "ลากเมาส์ = หมุนกล้องรอบรถ · ล้อเมาส์ = ซูม · คลิกพื้น = วางวัตถุ";
  document.querySelectorAll("#viewbar [data-view]").forEach((b) => b.setAttribute("aria-pressed", b.dataset.view === v ? "true" : "false"));
  if (is3d) { three.setMode(v); three.resize(); }
  clearTimeout(setView.hintT);
  if (is3d) setView.hintT = setTimeout(() => { $("hint3d").hidden = true; }, 7000);
  placeMirrorLabels([]);
}
function setNight(on) {
  S.night = on;
  $("btnNight").setAttribute("aria-pressed", on ? "true" : "false");
  if (three) three.setNight(on);
}
function placeMirrorLabels(insets) {
  const box = $("mirLabels");
  if (!insets.length) { if (box.childElementCount) box.innerHTML = ""; return; }
  if (box.childElementCount !== insets.length) box.innerHTML = insets.map(() => '<div class="mir"><span></span></div>').join("");
  insets.forEach((m, i) => {
    const el = box.children[i];
    Object.assign(el.style, { left: m.x - 5 + "px", top: m.y - 5 + "px", width: m.w + 10 + "px", height: m.h + 10 + "px" });
    el.firstChild.textContent = m.side > 0 ? "กระจกซ้าย" : "กระจกขวา (ฝั่งคนขับ)";
  });
}
const ZOOM_MIN = 1.5, ZOOM_MAX = 60;
function zoom(f) { setAutoZoom(false); S.cam.s = Math.max(ZOOM_MIN, Math.min(ZOOM_MAX, S.cam.s * f)); }
// ซูมพอดีทั้งคันรถ + ระยะแสดงมุมอับรอบรถ
function fitScale() {
  const len = rigLength(S.rigKey) + 2 * S.opts.range + 8, wid = 2.5 + 2 * S.opts.range + 8;
  return Math.max(3, Math.min(40, Math.min(W / len, H / wid)));
}
function setAutoZoom(on) {
  S.autoZoom = on;
  const b = $("zAuto"); if (b) b.setAttribute("aria-pressed", on ? "true" : "false");
}
// ซูมอัตโนมัติ: ยิ่งเร็วยิ่งซูมออก ให้เห็นจุดหยุดรถด้านหน้าเสมอ
function autoZoom(dt) {
  if (!S.autoZoom) return;
  const ahead = rigLength(S.rigKey) / 2 + stopDistance(Math.max(0, S.v)).total + 8;
  const target = Math.max(ZOOM_MIN, Math.min(fitScale(), W / 2 / ahead));
  S.cam.s += (target - S.cam.s) * Math.min(1, dt * 1.5);
}
function zoomLabel() { const z = $("zLabel"); if (z) z.textContent = Math.round(S.cam.s / fitScale() * 100) + "%"; }

/* ---------------- เริ่ม ---------------- */
try { if (localStorage.getItem("hub-theme") === "dark") document.documentElement.setAttribute("data-theme", "dark"); } catch (e) {}
let started = false;
function start() {
  if (started) return; started = true;
  readColors(); resize(); bindControls();
  buildRig("tanker");
  S.cam.s = fitScale();
  $("zIn").addEventListener("click", (e) => { zoom(1.25); e.currentTarget.blur(); });
  $("zOut").addEventListener("click", (e) => { zoom(1 / 1.25); e.currentTarget.blur(); });
  $("zFit").addEventListener("click", (e) => { setAutoZoom(false); S.cam.s = fitScale(); e.currentTarget.blur(); });
  $("zAuto").addEventListener("click", (e) => { setAutoZoom(!S.autoZoom); e.currentTarget.blur(); });
  requestAnimationFrame((t) => { last = t; frame(t); });
}
requireLogin(() => start());
