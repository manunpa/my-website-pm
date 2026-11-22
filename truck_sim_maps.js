/* =====================================================================
   สนามขับพิเศษ: ถนนที่มีความสูง-ต่ำจริง
   - "ภูเขาภาคเหนือ": ถนน 2 ช่องสวนกัน ขึ้นเขาชัน 6–9% โค้งหักศอก ลงเขาชัน 8–10% มีทางหนีภัย (กรวด)
   - "สะพาน · อุโมงค์ · ยูเทิร์น": ถนน 4 ช่องมีเกาะกลาง สะพานข้ามแยก จุดกลับรถพื้นราบ อุโมงค์ทางลอด สะพานกลับรถ
   ทุกสนามคืนค่าเป็นชุดเดียวกับแผนที่จริง (roads/buildings) + ฟังก์ชันความสูง:
     roadZ(x, y, prefZ) → ความสูงถนนใต้จุดนั้น (เลือกชั้นที่ใกล้ความสูงเดิม เช่น บนสะพาน/ใต้สะพาน)
     ground(x, y)       → ความสูงพื้นดิน (ภูเขา/ร่องอุโมงค์)
   หน่วยเมตร · แกน x ตะวันออก, y เหนือ, z สูงขึ้น
   ===================================================================== */
const DEG = Math.PI / 180;

function rng(seed) { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); }

// เดินเป็นเส้นทาง: [ยาว, เลี้ยว(องศา, บวก=ซ้าย), ความชัน %]
function turtle(x, y, z, th, moves) {
  const pts = [[x, y, z, 0]], ends = [];
  moves.forEach(([len, turn, grade]) => {
    const n = Math.max(1, Math.ceil(len / 2)), ds = len / n, dth = turn * DEG / n;
    for (let i = 0; i < n; i++) {
      th += dth / 2; x += Math.cos(th) * ds; y += Math.sin(th) * ds; th += dth / 2; z += grade / 100 * ds;
      pts.push([x, y, z, 0]);
    }
    ends.push({ x, y, z, th, i: pts.length - 1 });
  });
  return { pts, ends, end: { x, y, z, th } };
}
function line(x1, y1, x2, y2, zf, step = 2) {
  const len = Math.hypot(x2 - x1, y2 - y1), n = Math.max(1, Math.ceil(len / step)), pts = [];
  for (let i = 0; i <= n; i++) { const f = i / n, x = x1 + (x2 - x1) * f, y = y1 + (y2 - y1) * f; pts.push([x, y, zf(x, y, f), 0]); }
  return pts;
}

function mountain() {
  const moves = [
    [120, 0, 0], [140, 30, 6], [120, -45, 8], [110, 0, 9], [95, 175, 9], [160, -15, 8], [120, 10, 9], [95, -175, 9],
    [150, 25, 7], [110, 0, 5], [90, -20, 1],                                   // ยอดดอย
    [140, 25, -7], [180, 0, -9], [95, 175, -10], [210, -10, -10],             // ลงชัน
    [95, -175, -9], [160, 30, -8], [150, -25, -9], [200, 0, -6], [180, 0, -3], [200, 0, 0]
  ];
  const T = turtle(0, 0, 40, 0, moves);
  const roads = [{ pts: T.pts, w: 7.5, kind: "road", two: true, name: "ทางหลวงขึ้นดอย" }];
  // ทางหนีภัย: แยกตรงไปจากท้ายทางลงชัน 210 ม. ขึ้นเนินกรวด 14%
  const e = T.ends[14], ramp = turtle(e.x, e.y, e.z, e.th, [[24, -10, 0], [120, 0, 14]]);
  roads.push({ pts: ramp.pts, w: 5, kind: "escape", name: "ทางหนีภัย" });
  const signs = [
    { x: T.ends[3].x, y: T.ends[3].y, text: "โค้งหักศอก ลดความเร็ว" },
    { x: T.ends[10].x, y: T.ends[10].y, text: "ยอดดอย — ทางลงชัน 10% ใช้เกียร์ต่ำ/เบรกไอเสีย" },
    { x: T.ends[12].x, y: T.ends[12].y, text: "ลงเขาชัน 9–10% ระยะทาง 2 กม." },
    { x: e.x, y: e.y, text: "ทางหนีภัย (เบรกไม่อยู่ ให้เข้าทางนี้)" },
    { x: T.ends[7].x, y: T.ends[7].y, text: "โค้งหักศอกขวา" }
  ];
  const s0 = T.pts[3];
  return {
    id: "mountain", name: "ภูเขาภาคเหนือ", flat: false, roads, signs,
    start: { x: s0[0], y: s0[1] - 1.9, z: s0[2], th: 0 },
    sky: "mountain"
  };
}

function expressway() {
  // โปรไฟล์ความสูงของถนนหลัก (ตามแกน x): สะพานข้ามแยก + อุโมงค์ทางลอด
  const zMain = (x) => {
    if (x > 180 && x < 420) return Math.min(7, (x - 180) * 0.06, (420 - x) * 0.06);
    if (x > 820 && x < 1080) return -Math.min(6.5, (x - 820) * 0.06, (1080 - x) * 0.06);
    return 0;
  };
  const covered = (x) => x > 925 && x < 975;
  const main = (y) => line(-400, y, 1600, y, (x) => zMain(x)).map((p) => { p[3] = covered(p[0]) ? 1 : 0; return p; });
  const roads = [
    { pts: main(5.75), w: 9.5, kind: "road", lanes: 2, oneway: true, name: "ขาออก" },
    { pts: main(-5.75), w: 9.5, kind: "road", lanes: 2, oneway: true, name: "ขาเข้า" },
    { pts: line(300, -300, 300, 300, () => 0), w: 9, kind: "road", two: true, name: "ถนนตัดใต้สะพาน" },
    { pts: line(950, -300, 950, 300, () => 0), w: 9, kind: "road", two: true, name: "ถนนข้ามอุโมงค์" }
  ];
  // จุดกลับรถพื้นราบ (ช่องเกาะกลาง) — รัศมีแคบ รถใหญ่ต้องกินเลนกว้าง
  const ut = [];
  for (let x = 570; x <= 600; x += 2) ut.push([x, 6.5, 0, 0]);
  for (let a = 88; a >= -88; a -= 4) ut.push([600 + 6.5 * Math.cos(a * DEG), 6.5 * Math.sin(a * DEG), 0, 0]);
  for (let x = 600; x >= 570; x -= 2) ut.push([x, -6.5, 0, 0]);
  roads.push({ pts: ut, w: 7, kind: "uturn", oneway: true, name: "จุดกลับรถ" });
  // สะพานกลับรถ: แยกซ้ายขึ้นสะพาน วนกลับข้ามถนนหลักที่ความสูง 7 ม. แล้วลงขาเข้า
  const ub = [];
  for (let x = 1090; x <= 1130; x += 2) ub.push([x, 8.2 + (x - 1090) / 40 * 4.8, 0, 0]);
  for (let x = 1132; x <= 1270; x += 2) ub.push([x, 13, Math.min(7, (x - 1130) * 0.05), 0]);
  for (let a = 86; a >= -86; a -= 3) ub.push([1270 + 13 * Math.cos(a * DEG), 13 * Math.sin(a * DEG), 7, 0]);
  for (let x = 1270; x >= 1132; x -= 2) ub.push([x, -13, Math.min(7, (x - 1130) * 0.05), 0]);
  for (let x = 1130; x >= 1090; x -= 2) ub.push([x, -13 + (1130 - x) / 40 * 4.8, 0, 0]);
  roads.push({ pts: ub, w: 7.5, kind: "road", oneway: true, name: "สะพานกลับรถ" });
  const r = rng(11), buildings = [];
  for (let x = -380; x < 1580; x += 34) [1, -1].forEach((side) => {
    if ([300, 950].some((c) => Math.abs(x - c) < 30) || (x > 1080 && x < 1310)) return;
    const d = 14 + r() * 16, w = 18 + r() * 10, h = 8 + r() * r() * 50, y0 = side * (28 + d / 2);
    buildings.push({ pts: [[x - w / 2, y0 - d / 2], [x + w / 2, y0 - d / 2], [x + w / 2, y0 + d / 2], [x - w / 2, y0 + d / 2], [x - w / 2, y0 - d / 2]], h });
  });
  const signs = [
    { x: 150, y: 12, text: "สะพานข้ามแยก" },
    { x: 560, y: 12, text: "จุดกลับรถ (รถใหญ่ระวังเกาะกลาง)" },
    { x: 790, y: 12, text: "อุโมงค์ทางลอด สูง 6.5 ม." },
    { x: 1070, y: 14, text: "สะพานกลับรถ ชิดซ้าย" }
  ];
  return {
    id: "express", name: "สะพาน · อุโมงค์ · ยูเทิร์น", flat: true, roads, buildings, signs, median: { y: 0, w: 2, gaps: [[586, 614]] },
    start: { x: -320, y: 7.5, z: 0, th: 0 }
  };
}

/* ---------- ดัชนีค้นหาถนนใกล้จุด + ความสูง ---------- */
function prepare(map) {
  const CELLSZ = 16, grid = new Map(), key = (i, j) => i * 73856093 ^ j * 19349663;
  const segs = [];
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  map.roads.forEach((r) => {
    for (let i = 0; i + 1 < r.pts.length; i++) {
      const a = r.pts[i], b = r.pts[i + 1], sg = { r, a, b };
      segs.push(sg);
      const pad = r.w / 2 + 2;
      for (let gi = Math.floor((Math.min(a[0], b[0]) - pad) / CELLSZ); gi <= Math.floor((Math.max(a[0], b[0]) + pad) / CELLSZ); gi++)
        for (let gj = Math.floor((Math.min(a[1], b[1]) - pad) / CELLSZ); gj <= Math.floor((Math.max(a[1], b[1]) + pad) / CELLSZ); gj++) {
          const k = key(gi, gj); if (!grid.has(k)) grid.set(k, []); grid.get(k).push(sg);
        }
      minX = Math.min(minX, a[0]); maxX = Math.max(maxX, a[0]); minY = Math.min(minY, a[1]); maxY = Math.max(maxY, a[1]);
    }
    // ขอบถนนซ้าย/ขวา (ใช้วาดเส้นจราจร/ราวกันตก)
    const n = r.pts.length;
    r.L = []; r.R = []; r.th = [];
    for (let i = 0; i < n; i++) {
      const p = r.pts[Math.max(0, i - 1)], q = r.pts[Math.min(n - 1, i + 1)], th = Math.atan2(q[1] - p[1], q[0] - p[0]);
      const nx = -Math.sin(th), ny = Math.cos(th);
      r.th.push(th);
      r.L.push([r.pts[i][0] + nx * r.w / 2, r.pts[i][1] + ny * r.w / 2]); r.R.push([r.pts[i][0] - nx * r.w / 2, r.pts[i][1] - ny * r.w / 2]);
    }
  });
  const coarse = segs.filter((s, i) => i % 15 === 0);
  function segInfo(sg, x, y) {
    const [ax, ay, az, ac] = sg.a, [bx, by, bz, bc] = sg.b, dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy || 1;
    const t = Math.max(0, Math.min(1, ((x - ax) * dx + (y - ay) * dy) / l2));
    const px = ax + dx * t - x, py = ay + dy * t - y;
    return { d: Math.sqrt(px * px + py * py), z: az + (bz - az) * t, cov: t < 0.5 ? ac : bc, r: sg.r, th: Math.atan2(dy, dx), cx: ax + dx * t, cy: ay + dy * t };
  }
  function near(x, y) {
    const out = [], gi = Math.floor(x / CELLSZ), gj = Math.floor(y / CELLSZ);
    for (let i = gi - 1; i <= gi + 1; i++) for (let j = gj - 1; j <= gj + 1; j++) { const c = grid.get(key(i, j)); if (c) c.forEach((sg) => out.push(segInfo(sg, x, y))); }
    return out;
  }
  // ถนนใต้จุด: ถ้ามีหลายชั้น (สะพาน/ใต้สะพาน) เลือกชั้นที่ใกล้ความสูงเดิมที่สุด
  map.roadAt = (x, y, prefZ) => {
    let best = null;
    near(x, y).forEach((s) => {
      if (s.d > s.r.w / 2 + 0.8) return;
      // ใช้ความสูงเดิมแค่แยก "ชั้น" (บนสะพาน/ใต้สะพาน) ในชั้นเดียวกันเลือกเส้นที่ใกล้สุด
      const dz = prefZ === undefined ? 0 : Math.abs(s.z - prefZ);
      const score = s.d + (dz > 2.5 ? 100 + dz : 0);
      if (!best || score < best.score) best = Object.assign(s, { score });
    });
    return best;
  };
  const noise = (x, y) => Math.sin(x / 61) * Math.cos(y / 47) * 0.6 + Math.sin(x / 23 + y / 31) * 0.3 + Math.sin(x / 9.7 - y / 13) * 0.1;
  map.ground = (x, y) => {
    let n = null;
    near(x, y).forEach((s) => { if (!n || s.d < n.d) n = s; });
    if (map.flat) {
      if (n && n.z < -0.3 && !n.cov && n.d < n.r.w / 2 + 0.6) return n.z;
      return 0;
    }
    if (!n || n.d > 40) coarse.forEach((sg) => { const s = segInfo(sg, x, y); if (!n || s.d < n.d) n = s; });
    const e = Math.max(0, n.d - n.r.w / 2 - 2.2);
    if (e === 0) return n.z - 0.08;
    // ไหล่เขา: ด้านซ้ายของทิศถนนเป็นผาไต่ขึ้น ด้านขวาเป็นหุบลาดลง + ลอนเขาแบบสุ่ม
    const left = Math.cos(n.th) * (y - n.cy) - Math.sin(n.th) * (x - n.cx) > 0;
    const shape = left ? Math.min(85, 0.6 * e) : -Math.min(30, 0.3 * e) + Math.max(0, e - 90) * 0.4;
    return n.z + shape + noise(x, y) * Math.min(1, e / 30) * 14;
  };
  map.heightAt = (x, y, prefZ) => { const r = map.roadAt(x, y, prefZ); return r ? r.z : map.ground(x, y); };
  const pad = map.flat ? 60 : 160;
  map.bounds = { minX: minX - pad, minY: minY - pad, maxX: maxX + pad, maxY: maxY + pad };
  // ต้นไม้ข้างทาง
  const r = rng(5), trees = [];
  map.roads.forEach((rd) => {
    if (rd.kind !== "road") return;
    for (let i = 4; i < rd.pts.length; i += map.flat ? 9 : 4) [1, -1].forEach((sd) => {
      if (r() < (map.flat ? 0.5 : 0.35)) return;
      const th = rd.th[i], off = rd.w / 2 + (map.flat ? 5 : 6 + r() * 25), x = rd.pts[i][0] - Math.sin(th) * off * sd, y = rd.pts[i][1] + Math.cos(th) * off * sd;
      if (map.roadAt(x, y)) return;
      trees.push({ x, y, s: 0.8 + r() * 0.6 });
    });
  });
  if (!map.flat) for (let i = 0; i < 2600; i++) {
    const x = map.bounds.minX + r() * (map.bounds.maxX - map.bounds.minX), y = map.bounds.minY + r() * (map.bounds.maxY - map.bounds.minY);
    if (!map.roadAt(x, y)) trees.push({ x, y, s: 0.9 + r() * 0.9 });
  }
  map.trees = trees;
  map.buildings = map.buildings || [];
  map.custom = true;
  return map;
}

// ภาพพื้นที่ 2D: สีตามความสูง + แสงเงาภูเขา + เส้นชั้นความสูงทุก 10 ม.
function shade(map) {
  if (map.flat) return null;
  const b = map.bounds, res = 4, w = Math.ceil((b.maxX - b.minX) / res), h = Math.ceil((b.maxY - b.minY) / res);
  const H = new Float32Array(w * h);
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) H[j * w + i] = map.ground(b.minX + (i + 0.5) * res, b.maxY - (j + 0.5) * res);
  let lo = Infinity, hi = -Infinity; H.forEach((v) => { lo = Math.min(lo, v); hi = Math.max(hi, v); });
  const c = document.createElement("canvas"); c.width = w; c.height = h;
  const g = c.getContext("2d"), img = g.createImageData(w, h), d = img.data;
  for (let j = 0; j < h; j++) for (let i = 0; i < w; i++) {
    const k = j * w + i, z = H[k];
    const zx = (H[j * w + Math.min(w - 1, i + 1)] - H[j * w + Math.max(0, i - 1)]) / (2 * res);
    const zy = (H[Math.max(0, j - 1) * w + i] - H[Math.min(h - 1, j + 1) * w + i]) / (2 * res);
    const l = Math.max(0.25, Math.min(1.2, 0.75 + (-zx * 0.6 + zy * 0.5) * 0.9));
    const f = (z - lo) / (hi - lo || 1);
    let R = 92 + f * 70, Gc = 128 + f * 25, B = 70 + f * 30;          // เขียวป่าเขา → น้ำตาลยอดดอย
    const contour = Math.floor(z / 10) !== Math.floor(H[j * w + Math.min(w - 1, i + 1)] / 10) || Math.floor(z / 10) !== Math.floor(H[Math.min(h - 1, j + 1) * w + i] / 10);
    const m = contour ? 0.82 : 1;
    d[k * 4] = R * l * m; d[k * 4 + 1] = Gc * l * m; d[k * 4 + 2] = B * l * m; d[k * 4 + 3] = 255;
  }
  g.putImageData(img, 0, 0);
  return { canvas: c, minX: b.minX, maxY: b.maxY, w: w * res, h: h * res, lo, hi };
}

export function buildMap(id) {
  const map = prepare(id === "mountain" ? mountain() : expressway());
  map.shade = shade(map);
  return map;
}
