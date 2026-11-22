/* =====================================================================
   ตัวจำลองขับรถไฟสายเหนือ กรุงเทพ–เชียงใหม่ (ข้อมูลทางจริงจาก OpenStreetMap + ความสูง SRTM)
   ฟิสิกส์:  ไม่มีการจำกัดความเร็ว — ความเร็วเกิดจากสมดุลแรงล้วน ๆ
     m·k·a = F_ฉุด − F_เบรก − F_ต้าน(Davis) − F_โค้ง(Röckl) − m·g·ความชัน
     · F_ฉุด  = min(แรงฉุดสูงสุด·n/8, กำลัง·n/8 / v) แล้วลดลงเมื่อเกินความเร็วออกแบบของมอเตอร์ (back-EMF)
     · จำกัดด้วยแรงยึดเกาะล้อ-ราง μ(v) (Curtius–Kniffler) × น้ำหนักบนล้อขับ — ฝนตก μ ลดลง → ล้อฟรี/ล้อล็อก
     · เบรกลมมีเวลาหน่วง (ลมต้องวิ่งไปตลอดขบวน), เบรกไฟฟ้า/คืนพลังงานสำหรับรถไฟฟ้า
     · โค้ง: แรงเหวี่ยงที่ไม่ถูกชดเชย a = v²/R − g·(ยกโค้ง) ถ้าเกินขีดพลิกคว่ำ g·(G/2)/h_cg นานพอ → ตกราง
   ===================================================================== */
import { requireLogin } from "./firebase-guard.js?v=20261122-cut";
import { LINE } from "./train_line_north.js?v=20261126-1";

const $ = (id) => document.getElementById(id);
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const G = 9.81, KMH = 3.6;

/* ---------------- ถอดข้อมูลเส้นทาง ---------------- */
const N = LINE.n, STEP = LINE.step;
const LAT = new Float64Array(N), LON = new Float64Array(N), Z = new Float32Array(N);
{ let a = 0, b = 0, c = 0; for (let i = 0; i < N; i++) { a += LINE.lat[i]; b += LINE.lon[i]; c += LINE.z[i]; LAT[i] = a / 1e5; LON[i] = b / 1e5; Z[i] = c / 10; } }
const TOTAL = (N - 1) * STEP;
const K = new Float32Array(N); for (let i = 0; i < N; i++) { const r = LINE.r[i]; K[i] = r ? Math.sign(r) / Math.max(150, Math.abs(r)) : 0; }
const cr = (a, b, c, d, t) => { const t2 = t * t, t3 = t2 * t; return 0.5 * (2 * b + (c - a) * t + (2 * a - 5 * b + 4 * c - d) * t2 + (3 * b - a - 3 * c + d) * t3); };
const geo = {
  total: TOTAL,
  stations: LINE.st.map((st) => Object.assign({}, st, { s: Math.min(st.s, TOTAL - 120) })),   // ปลายทางเชียงใหม่อยู่ที่ปลายราง
  at(s) {   // Catmull-Rom → ทางโค้งเรียบไม่หักเป็นเหลี่ยม
    s = clamp(s, 0, TOTAL); const x = s / STEP; const i = Math.min(N - 2, Math.floor(x)), t = x - i;
    const i0 = Math.max(0, i - 1), i3 = Math.min(N - 1, i + 2);
    return { lat: cr(LAT[i0], LAT[i], LAT[i + 1], LAT[i3], t), lon: cr(LON[i0], LON[i], LON[i + 1], LON[i3], t), z: cr(Z[i0], Z[i], Z[i + 1], Z[i3], t) };
  },
  z(s) { s = clamp(s, 0, TOTAL); const x = s / STEP, i = Math.min(N - 2, Math.floor(x)), t = x - i; return Z[i] + (Z[i + 1] - Z[i]) * t; },
  flag(s) { return LINE.f[clamp(Math.round(s / STEP), 0, N - 1)]; },
  // ความโค้ง (1/R) แบบต่อเนื่อง: ประมาณค่าเชิงเส้นระหว่างจุด แล้วเฉลี่ยช่วง ±30 ม. → ไม่กระตุกเป็นขั้นทุก 50 ม.
  curv(s) { const x = clamp(s, 0, TOTAL) / STEP, i = Math.min(N - 2, Math.floor(x)), t = x - i; return K[i] + (K[i + 1] - K[i]) * t; },
  curvS(s) { return (geo.curv(s - 30) + 2 * geo.curv(s - 15) + 3 * geo.curv(s) + 2 * geo.curv(s + 15) + geo.curv(s + 30)) / 9; },
  radius(s) { const k = geo.curvS(s); return Math.abs(k) < 1 / 4000 ? 0 : Math.round(Math.sign(k) * Math.max(150, 1 / Math.abs(k))); }
};
// ยกโค้ง (cant) ที่สมมติตามรัศมี: ชดเชยแรงเหวี่ยงได้สูงสุด ~0.9 ม./วินาที² (ยกราง ~10 ซม. บนทาง 1 ม.)
const cantAcc = (R) => (R ? Math.min(0.9, 600 / Math.abs(R)) : 0);
const COMFORT = 0.65;  // ม./วินาที² แรงเหวี่ยงเหลือที่ผู้โดยสารยังสบาย

/* ---------------- ชนิดรถไฟ (ค่าประมาณตามประเภท) ---------------- */
function consist(list) { let acc = 0; return list.map((c) => { const o = Object.assign({}, c, { off: acc + c.len / 2 }); acc += c.len + 0.8; return o; }); }
// ปรับจำนวนตู้ได้: มวล แรงต้าน กำลัง (สำหรับรถที่มีมอเตอร์กระจายทุกคัน) คำนวณใหม่ตามจำนวนตู้
const CARS = { loco: 12, dmu: 3, emu: 6, hsr: 10 };
const CAR_RANGE = { loco: [1, 20, "ตู้โดยสาร"], dmu: [2, 6, "คัน"], emu: [3, 16, "คัน"], hsr: [4, 16, "คัน"] };
const fmtN = (x) => Math.round(x).toLocaleString("en-US");
function makeTrain(k, n) {
  let t, list;
  if (k === "loco") {
    list = [{ type: "loco", len: 20 }].concat(Array.from({ length: n }, () => ({ type: "coach", len: 20.5 })));
    const mt = 90 + 44.25 * n;
    t = { name: `รถจักรดีเซล + ตู้โดยสาร ${n} คัน`, sub: `ขบวนรถเร็ว/ด่วน · ${fmtN(mt)} ตัน · 2,400 kW`, kind: "diesel",
      mass: mt * 1e3, power: 2000e3, fmax: 380e3, adhMass: 88e3, vDesign: 120 / KMH, rot: 1.06, hcg: 1.8,
      A: mt * 12, B: mt * 0.35, bServ: 0.85, bEmer: 1.25, airLag: 1.6 + n * 0.13, dyn: 0, regen: false, tracLag: 2.5,
      stopMin: 1, dwell: 60, eye: 3.7, dial: 160 };
  } else if (k === "dmu") {
    list = Array.from({ length: n }, (_, i) => ({ type: "dmu", len: 20.5, cab: i === 0 ? 1 : 0, cabRear: i === n - 1 ? 1 : 0 }));
    const mt = 45 * n;
    t = { name: `รถดีเซลราง ${n} คัน`, sub: `ขบวนท้องถิ่น/ชานเมือง · ${fmtN(mt)} ตัน · ${fmtN(330 * n)} kW`, kind: "dmu",
      mass: mt * 1e3, power: 267e3 * n, fmax: 36.7e3 * n, adhMass: mt * 1e3 * 0.52, vDesign: 120 / KMH, rot: 1.07, hcg: 1.7,
      A: mt * 13, B: mt * 0.4, bServ: 1.0, bEmer: 1.35, airLag: 1.1 + n * 0.1, dyn: 0, regen: false, tracLag: 1.8,
      stopMin: 0, dwell: 30, eye: 3.1, dial: 160 };
  } else if (k === "emu") {
    list = Array.from({ length: n }, (_, i) => ({ type: "emu", len: 20, cab: i === 0 ? 1 : 0, cabRear: i === n - 1 ? 1 : 0, panto: i % 3 === 1 ? 1 : 0 }));
    const mt = 45 * n;
    t = { name: `รถไฟฟ้า ${n} คัน (EMU)`, sub: `ขบวนด่วนพิเศษไฟฟ้า · ${fmtN(mt)} ตัน · ${fmtN(600 * n)} kW · เบรกคืนพลังงาน`, kind: "emu",
      mass: mt * 1e3, power: 600e3 * n, fmax: 43.3e3 * n, adhMass: mt * 1e3 * 0.67, vDesign: 160 / KMH, rot: 1.08, hcg: 1.6,
      A: mt * 11, B: mt * 0.3, bServ: 1.0, bEmer: 1.35, airLag: 0.8 + n * 0.035, dyn: 500e3 * n, regen: true, tracLag: 0.4,
      stopMin: 1, dwell: 40, eye: 3.1, dial: 200, electric: true };
  } else {
    list = [{ type: "hsrNose", len: 27 }].concat(Array.from({ length: n - 2 }, (_, i) => ({ type: "hsr", len: 25, panto: i % 3 === 2 ? 1 : 0 }))).concat([{ type: "hsrNose", len: 27, flip: 1 }]);
    const mt = 49 * n;
    t = { name: `รถไฟความเร็วสูง ${n} คัน`, sub: `จอดสถานีหลัก 12 แห่ง · ${fmtN(mt)} ตัน · ${fmtN(960 * n)} kW`, kind: "hsr",
      mass: mt * 1e3, power: 960e3 * n, fmax: 30e3 * n, adhMass: mt * 1e3 * 0.53, vDesign: 250 / KMH, rot: 1.05, hcg: 1.5,
      A: mt * 9, B: mt * 0.2, bServ: 0.9, bEmer: 1.3, airLag: 0.6 + n * 0.03, dyn: 800e3 * n, regen: true, tracLag: 0.4,
      stopMin: 2, dwell: 60, eye: 3.2, eyeX: 6.4, dial: 320, electric: true };
  }
  t.cars = consist(list); t.n = n;
  const last = t.cars[t.cars.length - 1]; t.length = last.off + last.len / 2;
  // แรงต้านอากาศ C = ½ρ(Cd·A หน้า + แรงเสียดผิวตามความยาว)
  const front = { diesel: 6.0, dmu: 3.0, emu: 3.5, hsr: 2.4 }[t.kind], skin = { diesel: 0.0095, dmu: 0.0095, emu: 0.0105, hsr: 0.012 }[t.kind];
  t.C = front + skin * t.length * 1.0;
  return t;
}
const TRAINS = {};
Object.keys(CARS).forEach((k) => { TRAINS[k] = makeTrain(k, CARS[k]); });

/* ---------------- สถานะ ---------------- */
const S = {
  type: "loco", tr: null, s: 0, v: 0, a: 0, lever: 0, emer: false, trac: 0, brk: 0, fT: 0, fB: 0, fR: 0, fG: 0, fC: 0,
  slip: 0, slide: 0, au: 0, auT: 0, derailed: null, t: 0, energy: 0, regenE: 0, fuel: 0,
  from: 0, to: 0, stops: [], stopIdx: 0, dwell: 0, atStation: null, results: [], warp: 1, ato: false, done: false,
  stopMode: "type", wx: "clear", tod: "day", sound: true, maxV: 0
};
const trainKey = () => S.type + TRAINS[S.type].n + (TRAINS[S.type].electric ? "e" : "");

/* ---------------- ฟิสิกส์ ---------------- */
// สัมประสิทธิ์ยึดเกาะ Curtius–Kniffler (v เป็น กม./ชม.) × สภาพราง
const mu = (v) => (0.161 + 7.5 / (Math.abs(v) * KMH + 44)) * (S.wx === "rain" ? 0.62 : S.wx === "fog" ? 0.85 : 1);
function gradeAvg(s, L) { return (geo.z(s) - geo.z(s - L)) / L; }
function curveRes(s, L, m) {   // Röckl: 400/(R−20) ‰ ของน้ำหนัก เฉลี่ยตลอดขบวน
  let sum = 0; const n = 6;
  for (let i = 0; i < n; i++) { const R = Math.abs(geo.radius(s - L * i / (n - 1))); if (R) sum += 400 / Math.max(60, R - 20) / 1000; }
  return m * G * sum / n;
}
function tractionAvail(v, tr, n) {   // แรงฉุดที่ระบบขับเคลื่อนให้ได้ที่ความเร็ว v (ยังไม่รวมแรงยึดเกาะ)
  if (n <= 0) return 0;
  const f = n / 8, va = Math.max(Math.abs(v), 0.5);
  let F = Math.min(tr.fmax * f, tr.power * f / va);
  if (va > tr.vDesign) F *= Math.pow(tr.vDesign / va, 2.2);   // เกินความเร็วออกแบบ: มอเตอร์ถูกแรงเคลื่อนย้อนกลับกด
  return F;
}
function stepPhysics(dt) {
  const tr = TRAINS[S.type], m = tr.mass, v = S.v;
  if (S.derailed) {
    S.derailed.t += dt; S.v = Math.max(0, v - 4.5 * dt); S.s += S.v * dt; S.a = -4.5; return;
  }
  // คันบังคับ → คำสั่งกำลัง/เบรก (ค่อย ๆ ตอบสนอง)
  const n = S.emer ? -9 : S.lever;
  const tracCmd = n > 0 ? n : 0, brkCmd = S.emer ? tr.bEmer / tr.bServ : n < 0 ? -n / 8 : 0;
  S.trac += (tracCmd - S.trac) * Math.min(1, dt / tr.tracLag);
  if (tracCmd < S.trac && tr.kind !== "diesel") S.trac = tracCmd;   // ตัดกำลังไฟฟ้าได้ทันที
  S.brk += (brkCmd - S.brk) * Math.min(1, dt / (brkCmd > S.brk ? tr.airLag : tr.airLag * 1.6));
  // แรงยึดเกาะ
  const grade = gradeAvg(S.s, tr.length);
  const cosg = 1 / Math.sqrt(1 + grade * grade), muv = mu(v);
  const adhT = muv * tr.adhMass * G * cosg, adhB = muv * m * G * cosg;
  // แรงฉุด
  let FT = tractionAvail(v, tr, S.trac);
  S.slip = 0;
  if (FT > adhT) { S.slip = FT / adhT; FT = adhT * 0.78; }   // ล้อฟรี: แรงตกลงเป็นแรงเสียดทานไถล
  // แรงเบรก: เบรกไฟฟ้า (คืนพลังงาน) ก่อน ที่เหลือเป็นเบรกลม
  let FB = S.brk * tr.bServ * m;
  let Fdyn = 0;
  if (tr.dyn && FB > 0 && Math.abs(v) > 1) { Fdyn = Math.min(FB, tr.dyn / Math.abs(v), tr.fmax * 1.1); }
  S.slide = 0;
  if (FB > adhB) { S.slide = FB / adhB; FB = adhB * 0.8; }    // ล้อล็อก/ไถล
  // แรงต้าน
  const FR = tr.A + tr.B * Math.abs(v) + tr.C * v * v;
  const FG = m * G * grade * cosg;
  const FC = curveRes(S.s, tr.length, m);
  const meff = m * tr.rot;
  // สมการการเคลื่อนที่ (แรงเบรก/ต้านตรงข้ามทิศการเคลื่อนที่)
  const drive = FT - FG;
  const resist = FB + FR + FC;
  if (Math.abs(v) < 0.02 && Math.abs(drive) <= resist) { S.v = 0; S.a = 0; }
  else {
    const dir = Math.abs(v) < 0.02 ? Math.sign(drive) : Math.sign(v);
    const a = (drive - dir * resist) / meff;
    let nv = v + a * dt;
    if (dir !== 0 && Math.sign(nv) !== dir && Math.abs(v) > 0) nv = 0;   // เบรกจนหยุด ไม่ย้อนกลับในขั้นเดียว
    S.a = (nv - v) / dt; S.v = nv;
  }
  S.s = clamp(S.s + S.v * dt, tr.length, TOTAL);
  if (S.s >= TOTAL && S.v > 0) { S.v = 0; }
  // พลังงาน
  const pT = FT * Math.abs(S.v), pR = Fdyn * Math.abs(S.v);
  S.energy += pT * dt / 3.6e6;
  if (tr.regen) S.regenE += pR * 0.8 * dt / 3.6e6;
  if (!tr.electric) S.fuel += (pT / 0.36 + 60e3 * (tr.kind === "diesel" ? 1 : 0.5)) * dt / 3.6e6 / 10.0;   // ลิตร (ดีเซล ~10 kWh/ลิตร, ประสิทธิภาพ 36%)
  Object.assign(S, { fT: FT, fB: FB, fDyn: Fdyn, fR: FR, fG: FG, fC: FC, grade, adhT, muv });
  // แรงเหวี่ยงในโค้ง (คิดที่รถคันหน้าซึ่งเข้าโค้งก่อน)
  const R = geo.radius(S.s - 10);
  S.R = R;
  S.au = R ? S.v * S.v / Math.abs(R) - cantAcc(R) : 0;
  const lim = G * 0.535 / tr.hcg * 0.75;   // ขีดพลิกคว่ำ (รวมค่าเผื่อแรงกระแทกแบบพลวัต 25%)
  S.auLim = lim;
  if (S.au > lim) { S.auT += dt; if (S.auT > 0.5) derail(Math.sign(R) || 1); } else S.auT = Math.max(0, S.auT - dt);
  S.t += dt; S.maxV = Math.max(S.maxV, S.v);
}
function derail(side) {
  S.derailed = { side: -side, t: 0 };
  S.lever = -8; S.emer = true; S.ato = false; updAtoBtn();
  big("ตกราง!<br><small style='font-size:1.1rem'>เข้าโค้งเร็วเกินไป — แรงเหวี่ยงชนะน้ำหนักรถ</small>", 6000);
  flash(`ตกรางที่ กม. ${(S.s / 1000).toFixed(1)} · ${Math.round(S.v * KMH)} กม./ชม. ในโค้งรัศมี ${Math.abs(S.R)} ม. (ปลอดภัยไม่เกิน ${Math.round(safeV(S.R) * KMH)})`, "", 9000);
  sfx.crash();
}
const safeV = (R) => (R ? Math.sqrt((COMFORT + cantAcc(R)) * Math.abs(R)) : Infinity);
const flipV = (R, tr) => (R ? Math.sqrt((G * 0.535 / tr.hcg * 0.75 + cantAcc(R)) * Math.abs(R)) : Infinity);
// ระยะหยุดจากความเร็ว v ด้วยเบรกเต็มที่ (รวมเวลาหน่วงเบรกลม) บนความชันปัจจุบัน
function stopDist(v, b) { const tr = TRAINS[S.type]; const d = Math.max(0.15, b + G * (S.grade || 0)); return v * tr.airLag * 0.5 + v * v / (2 * d); }

/* ---------------- สถานีจอด ---------------- */
function stopsFor() {
  const tr = TRAINS[S.type], a = geo.stations[S.from], b = geo.stations[S.to];
  return geo.stations.filter((st, i) => {
    if (st.s <= a.s || st.s > b.s) return false;
    if (st === b) return true;
    if (S.stopMode === "none") return false;
    if (S.stopMode === "all") return true;
    if (tr.stopMin === 0) return true;
    return !st.h && st.m >= tr.stopMin;
  });
}
const stopMark = (st) => Math.min(TOTAL - 5, st.s + Math.min(TRAINS[S.type].length / 2, 105));
function nextStation() { return geo.stations.find((st) => st.s > S.s + 5); }
function checkStops(dt) {
  const st = S.stops[S.stopIdx];
  if (S.dwell > 0) {
    S.dwell -= dt;
    if (S.dwell <= 0) { S.dwell = 0; flash("ปิดประตูแล้ว — ออกได้", "ok", 2500); sfx.bell(); S.stopIdx++; if (S.ato) S.atoHold = false; }
    return;
  }
  if (!st) return;
  const mk = stopMark(st), d = mk - S.s;
  if (S.v === 0 && Math.abs(d) <= 25 && !S.atStation) {
    const err = -d, grade = Math.abs(err) <= 1 ? "แม่นยำมาก" : Math.abs(err) <= 5 ? "ดี" : Math.abs(err) <= 12 ? "พอใช้" : "เกือบเลย";
    S.results.push({ n: st.n, err, ok: true });
    S.atStation = st;
    const last = st === geo.stations[S.to];
    flash(`จอด${st.n} ${err >= 0 ? "เลย" : "ก่อน"}จุดจอด ${Math.abs(err).toFixed(1)} ม. · ${grade}`, Math.abs(err) <= 5 ? "ok" : "info", 4000);
    if (last) { S.done = true; S.ato = false; updAtoBtn(); big(`ถึงสถานี${st.n}<br><small style="font-size:1.1rem">${fmtTime(S.t)} · จอดตรงจุด ${S.results.filter((r) => r.ok && Math.abs(r.err) <= 5).length}/${S.results.length} สถานี</small>`, 7000); }
    else S.dwell = TRAINS[S.type].dwell;
  }
  if (S.atStation && Math.abs(stopMark(S.atStation) - S.s) > 30) S.atStation = null;
  if (d < -25 && S.atStation !== st) {
    S.results.push({ n: st.n, err: -d, ok: false });
    flash(`เลยสถานี${st.n} ไม่ได้จอด!`, "", 3500); S.stopIdx++;
  }
}

/* ---------------- ระบบขับอัตโนมัติ (ATO) ---------------- */
// หาความเร็วที่ยอมได้ ณ ตอนนี้ จากข้อจำกัดข้างหน้าทั้งหมด (โค้ง + จุดจอด) ด้วยเส้นโค้งเบรก v² = vc² + 2·b·d
function atoTarget() {
  const tr = TRAINS[S.type], b = tr.bServ * 0.55;
  let vAllow = tr.vDesign * 0.97, why = "ความเร็วออกแบบ";
  const look = Math.max(1500, stopDist(S.v, b) * 1.4 + 300);
  for (let d = -tr.length; d <= look; d += 25) {
    const R = geo.radius(S.s + d); if (!R) continue;
    const vc = safeV(R) * 0.96;
    const v = d <= 0 ? vc : Math.sqrt(vc * vc + 2 * b * Math.max(0, d - S.v * tr.airLag));
    if (v < vAllow) { vAllow = v; why = `โค้ง R${Math.abs(R)} ข้างหน้า ${Math.max(0, Math.round(d))} ม.`; }
  }
  const st = S.stops[S.stopIdx];
  if (st && S.dwell === 0) {
    const d = stopMark(st) - S.s;
    if (d > -20) { const v = Math.sqrt(2 * b * Math.max(0, d - 1.5 - S.v * tr.airLag * 0.6)); if (v < vAllow) { vAllow = v; why = `จอด${st.n} อีก ${Math.max(0, Math.round(d))} ม.`; } }
  }
  return { v: vAllow, why };
}
function runAto() {
  const tr = TRAINS[S.type];
  if (S.dwell > 0 || S.done) { S.lever = -4; return; }
  const T = atoTarget(); S.atoV = T.v; S.atoWhy = T.why;
  const st = S.stops[S.stopIdx], d = st ? stopMark(st) - S.s : 1e9;
  // ช่วงเข้าจอด: เบรกตามความหน่วงที่ต้องการ a = v²/2d
  if (d < 400 && d > -20) {
    if (S.v < 0.05 && Math.abs(d) < 25) { S.lever = -6; return; }
    const need = S.v * S.v / (2 * Math.max(0.5, d - 0.8));
    if (d < 3 && S.v < 1.2) { S.lever = -7; return; }
    if (need > tr.bServ * 0.35) { S.lever = -clamp(Math.ceil((need + G * Math.max(0, -S.grade)) / tr.bServ * 8), 1, 8); return; }
    if (S.v < 3 && d > 6) { S.lever = 2; return; }
  }
  const err = T.v - S.v;
  if (err > 1.5) S.lever = clamp(Math.round(err * 1.5), 1, 8);
  else if (err > 0.3) S.lever = clamp(Math.round(S.grade * 200 + 2), 0, 4);
  else if (err > -0.8) S.lever = S.grade < -0.004 ? -1 : 0;
  else S.lever = -clamp(Math.ceil(-err * 1.6), 1, 8);
}

/* ---------------- เสียง ---------------- */
const sfx = (() => {
  let ctx = null, master, eng, engG, whine, whineG, wind, windG, hiss, hissG, lastJoint = 0;
  function noiseBuf(c) { const b = c.createBuffer(1, c.sampleRate * 2, c.sampleRate), d = b.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; return b; }
  function init() {
    if (ctx) return;
    try {
      ctx = new (window.AudioContext || window.webkitAudioContext)();
      master = ctx.createGain(); master.gain.value = 0.5; master.connect(ctx.destination);
      const nb = noiseBuf(ctx);
      eng = ctx.createOscillator(); eng.type = "sawtooth"; const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 260; engG = ctx.createGain(); engG.gain.value = 0; eng.connect(lp); lp.connect(engG); engG.connect(master); eng.start();
      whine = ctx.createOscillator(); whine.type = "triangle"; whineG = ctx.createGain(); whineG.gain.value = 0; whine.connect(whineG); whineG.connect(master); whine.start();
      wind = ctx.createBufferSource(); wind.buffer = nb; wind.loop = true; const bp = ctx.createBiquadFilter(); bp.type = "lowpass"; bp.frequency.value = 700; windG = ctx.createGain(); windG.gain.value = 0; wind.connect(bp); bp.connect(windG); windG.connect(master); wind.start();
      hiss = ctx.createBufferSource(); hiss.buffer = nb; hiss.loop = true; const hp = ctx.createBiquadFilter(); hp.type = "highpass"; hp.frequency.value = 2500; hissG = ctx.createGain(); hissG.gain.value = 0; hiss.connect(hp); hp.connect(hissG); hissG.connect(master); hiss.start();
      sfx.nb = nb;
    } catch (e) { ctx = null; }
  }
  const set = (p, v) => { if (Number.isFinite(v)) p.setTargetAtTime(v, ctx.currentTime, 0.12); };
  function burst(f, dur, vol, type = "noise") {
    if (!ctx) return;
    try {
      const g = ctx.createGain(); g.gain.setValueAtTime(vol, ctx.currentTime); g.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + dur); g.connect(master);
      if (type === "noise") { const s = ctx.createBufferSource(); s.buffer = sfx.nb; const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f; bp.Q.value = 1.2; s.connect(bp); bp.connect(g); s.start(); s.stop(ctx.currentTime + dur); }
      else { const o = ctx.createOscillator(); o.type = type; o.frequency.value = f; o.connect(g); o.start(); o.stop(ctx.currentTime + dur); }
    } catch (e) { /* ignore */ }
  }
  return {
    init,
    update(dt) {
      if (!ctx) return;
      if (!S.sound) { set(master.gain, 0); return; } set(master.gain, 0.5);
      try {
        const tr = TRAINS[S.type], v = Math.abs(S.v), k = tr.kind;
        const diesel = k === "diesel" || k === "dmu";
        set(eng.frequency, diesel ? 32 + S.trac * 7 + (k === "dmu" ? 14 : 0) : 30);
        set(engG.gain, diesel ? 0.05 + S.trac * 0.02 : 0);
        set(whine.frequency, 180 + v * 22); set(whineG.gain, !diesel && S.trac + (S.fDyn > 0 ? 3 : 0) > 0 ? 0.015 + Math.min(0.03, v * 0.0008) : 0);
        set(windG.gain, Math.min(0.5, v * v * 0.00009 + v * 0.002));
        set(hissG.gain, S.brk > 0.02 ? Math.min(0.06, S.brk * 0.05) : 0);
        // เสียงล้อกระทบรอยต่อราง ทุก ~25 ม. (สองโบกี้)
        if (v > 0.5 && k !== "hsr" && Math.floor(S.s / 25) !== lastJoint) {
          lastJoint = Math.floor(S.s / 25); burst(320, 0.07, 0.14); setTimeout(() => burst(300, 0.07, 0.12), Math.min(400, 2600 / v));
        }
      } catch (e) { /* ignore */ }
    },
    horn() { init(); if (!ctx || !S.sound) return; const hi = S.type === "hsr" || S.type === "emu"; [hi ? 466 : 311, hi ? 587 : 370].forEach((f) => burst(f, 1.3, 0.12, "sawtooth")); },
    bell() { if (!ctx || !S.sound) return; [0, 0.35, 0.7].forEach((t) => setTimeout(() => burst(1320, 0.4, 0.08, "sine"), t * 1000)); },
    beep() { if (!ctx || !S.sound) return; burst(880, 0.15, 0.08, "square"); },
    crash() { if (!ctx || !S.sound) return; burst(120, 2.5, 0.6); burst(600, 1.5, 0.3); }
  };
})();

/* ---------------- HUD ---------------- */
let msgT = 0, bigT = 0;
function flash(t, cls = "", ms = 2500) { const m = $("msg"); m.textContent = t; m.className = "show " + cls; clearTimeout(msgT); msgT = setTimeout(() => (m.className = ""), ms); }
function big(html, ms = 3000) { const b = $("bigText"); b.innerHTML = html; b.className = "show"; clearTimeout(bigT); bigT = setTimeout(() => (b.className = ""), ms); }
const fmtTime = (t) => { t = Math.round(t); const h = Math.floor(t / 3600), m = Math.floor(t / 60) % 60, s = t % 60; return (h ? h + ":" : "") + String(m).padStart(h ? 2 : 1, "0") + ":" + String(s).padStart(2, "0"); };
const fmtD = (m) => (Math.abs(m) >= 1000 ? (m / 1000).toFixed(m >= 10000 ? 1 : 2) + " กม." : Math.round(m) + " ม.");

function drawSpeedo() {
  const c = $("speedo"), g = c.getContext("2d"), W = c.width, cx = W / 2, cy = W / 2, R = W * 0.44, tr = TRAINS[S.type];
  const max = tr.dial, a0 = Math.PI * 0.75, a1 = Math.PI * 2.25, ang = (v) => a0 + (a1 - a0) * clamp(v / max, 0, 1.04);
  g.clearRect(0, 0, W, W);
  g.lineCap = "round";
  g.strokeStyle = "rgba(255,255,255,.08)"; g.lineWidth = 22; g.beginPath(); g.arc(cx, cy, R, a0, a1); g.stroke();
  // แถบความเร็วปลอดภัยในโค้งข้างหน้า / เป้า ATO
  const vs = safeV(S.R) * KMH, vf = flipV(S.R, tr) * KMH;
  if (Number.isFinite(vs)) { g.strokeStyle = "rgba(255,176,32,.5)"; g.beginPath(); g.arc(cx, cy, R, ang(vs), ang(Math.min(vf, max))); g.stroke(); g.strokeStyle = "rgba(255,77,79,.7)"; g.beginPath(); g.arc(cx, cy, R, ang(Math.min(vf, max)), a1); g.stroke(); }
  g.strokeStyle = S.au > COMFORT ? "#ff4d4f" : "#f5b301"; g.lineWidth = 22; g.beginPath(); g.arc(cx, cy, R, a0, ang(Math.abs(S.v) * KMH)); g.stroke();
  g.fillStyle = "#9aa6b8"; g.font = "600 22px system-ui"; g.textAlign = "center"; g.textBaseline = "middle";
  const stepT = max > 200 ? 40 : 20;
  for (let v = 0; v <= max; v += stepT) { const a = ang(v); g.fillText(v, cx + Math.cos(a) * (R - 40), cy + Math.sin(a) * (R - 40)); g.strokeStyle = "rgba(255,255,255,.35)"; g.lineWidth = 3; g.beginPath(); g.moveTo(cx + Math.cos(a) * (R + 14), cy + Math.sin(a) * (R + 14)); g.lineTo(cx + Math.cos(a) * (R + 4), cy + Math.sin(a) * (R + 4)); g.stroke(); }
  if (S.ato && S.atoV !== undefined) { const a = ang(S.atoV * KMH); g.strokeStyle = "#30d158"; g.lineWidth = 6; g.beginPath(); g.moveTo(cx + Math.cos(a) * (R - 16), cy + Math.sin(a) * (R - 16)); g.lineTo(cx + Math.cos(a) * (R + 18), cy + Math.sin(a) * (R + 18)); g.stroke(); }
  const a = ang(Math.abs(S.v) * KMH); g.strokeStyle = "#fff"; g.lineWidth = 6; g.beginPath(); g.moveTo(cx, cy); g.lineTo(cx + Math.cos(a) * (R - 8), cy + Math.sin(a) * (R - 8)); g.stroke();
  g.fillStyle = "#fff"; g.beginPath(); g.arc(cx, cy, 10, 0, 7); g.fill();
  g.font = "700 76px system-ui"; g.fillText(Math.round(Math.abs(S.v) * KMH), cx, cy + 82);
  g.font = "500 22px system-ui"; g.fillStyle = "#9aa6b8"; g.fillText("กม./ชม.", cx, cy + 128);
  // แถบความเร่ง
  const acc = clamp(S.a / 1.5, -1, 1); g.fillStyle = acc >= 0 ? "#30d158" : "#ffb020"; g.fillRect(cx, cy + 156, acc * 120, 10); g.fillStyle = "rgba(255,255,255,.4)"; g.fillRect(cx - 1, cy + 150, 2, 22);
}
function leverHTML() {
  let h = '<div class="lever">'; const cur = S.emer ? -9 : S.lever;
  for (let n = -9; n <= 8; n++) {
    const lab = n === -9 ? "E" : n < 0 ? "B" + -n : n === 0 ? "N" : "P" + n;
    const on = n === cur || (n < 0 && cur < 0 && n > cur && n !== -9) || (n > 0 && cur > 0 && n < cur);
    h += `<i class="${n === -9 ? "e" : n < 0 ? "b" : n === 0 ? "n" : "p"}${on ? " on" : ""}">${lab}</i>`;
  }
  return h + "</div>";
}
function drawReadouts() {
  const tr = TRAINS[S.type], kN = (f) => (f / 1000).toFixed(0) + " kN";
  const R = S.R;
  const rows = [
    ["ตำแหน่ง", "กม. " + (S.s / 1000).toFixed(2)],
    ["ระดับสูง", geo.z(S.s).toFixed(0) + " ม. รทก.", 1],
    ["ความชัน", ((S.grade || 0) * 1000).toFixed(1) + " ‰ " + ((S.grade || 0) > 0.0015 ? "ขึ้น" : (S.grade || 0) < -0.0015 ? "ลง" : "ราบ")],
    ["โค้ง", R ? `R ${Math.abs(R)} ม. ${R > 0 ? "ซ้าย" : "ขวา"}` : "ทางตรง"],
    ["แรงเหวี่ยงเหลือ", R ? S.au.toFixed(2) + " ม./วิ²" : "–", 1],
    ["ความเร่ง", (S.a || 0).toFixed(2) + " ม./วิ²", 1],
    ["แรงฉุด", kN(S.fT || 0) + (S.slip ? " ⚠ล้อฟรี" : "")],
    ["แรงเบรก", kN(S.fB || 0) + (S.slide ? " ⚠ล้อไถล" : "") + (S.fDyn ? ` (ไฟฟ้า ${kN(S.fDyn)})` : "")],
    ["กำลังที่ล้อ", ((S.fT || 0) * Math.abs(S.v) / 1000).toFixed(0) + " kW", 1],
    ["เวลา", fmtTime(S.t) + (S.warp > 1 ? ` (×${S.warp})` : "")],
    [tr.electric ? "พลังงานไฟฟ้า" : "น้ำมัน", tr.electric ? `${S.energy.toFixed(0)} kWh${tr.regen ? ` (คืน ${S.regenE.toFixed(0)})` : ""}` : `${S.fuel.toFixed(0)} ลิตร`, 1]
  ];
  $("readouts").innerHTML = rows.map(([k, v, x]) => `<span${x ? ' class="x"' : ""}>${k}</span><b${x ? ' class="x"' : ""}>${v}</b>`).join("") + leverHTML();
}
function drawNext() {
  const st = S.stops[S.stopIdx], nx = nextStation();
  let h = "";
  if (S.done) h = `<div class="k">ถึงปลายทางแล้ว</div><div class="nm">${geo.stations[S.to].n}</div><div class="row"><span>ใช้เวลา</span><b>${fmtTime(S.t)}</b></div><div class="row"><span>เร็วสุด</span><b>${Math.round(S.maxV * KMH)} กม./ชม.</b></div>`;
  else if (S.dwell > 0) h = `<div class="k">จอดอยู่ที่</div><div class="nm">${S.atStation ? S.atStation.n : ""}</div><div class="row"><span>ออกได้ในอีก</span><b>${Math.ceil(S.dwell)} วิ</b></div>`;
  else if (st) {
    const d = stopMark(st) - S.s, sd = stopDist(Math.abs(S.v), TRAINS[S.type].bServ);
    h = `<div class="k">สถานีจอดถัดไป</div><div class="nm">${st.n}</div><div class="en">${st.e || ""} · กม. ${(st.s / 1000).toFixed(1)}</div>
      <div class="row"><span>ถึงจุดจอด</span><b>${fmtD(d)}</b></div>
      <div class="row"><span>ระยะเบรกปกติตอนนี้</span><b style="color:${sd > d ? "var(--bad)" : "inherit"}">${fmtD(sd)}</b></div>`;
    if (nx && nx !== st) h += `<div class="row x"><span>สถานีที่ผ่าน: ${nx.n}</span><span class="stop pass">${fmtD(nx.s - S.s)}</span></div>`;
  }
  const last = S.results[S.results.length - 1];
  if (last) h += `<div class="row"><span>จอดล่าสุด ${last.n}</span><span style="color:${!last.ok ? "var(--bad)" : Math.abs(last.err) <= 5 ? "var(--ok)" : "var(--warn)"}">${last.ok ? (last.err >= 0 ? "+" : "") + last.err.toFixed(1) + " ม." : "ไม่ได้จอด"}</span></div>`;
  if (S.ato) h += `<div class="row"><span style="color:var(--ok)">ATO: ${S.atoWhy || ""}</span><b>${Math.round((S.atoV || 0) * KMH)}</b></div>`;
  $("next").innerHTML = h;
}
function drawPhys() {
  const tr = TRAINS[S.type], v = Math.abs(S.v);
  const rows = [
    ["มวลขบวน", (tr.mass / 1000).toFixed(0) + " ตัน · ยาว " + tr.length.toFixed(0) + " ม."],
    ["กำลัง / แรงฉุดสูงสุด", (tr.power / 1000).toFixed(0) + " kW / " + (tr.fmax / 1000).toFixed(0) + " kN"],
    ["μ ล้อ-ราง ตอนนี้", (S.muv || 0).toFixed(3) + (S.wx === "rain" ? " (รางเปียก)" : "")],
    ["แรงยึดเกาะล้อขับ", ((S.adhT || 0) / 1000).toFixed(0) + " kN"],
    ["แรงต้านลม+ล้อ", ((S.fR || 0) / 1000).toFixed(1) + " kN"],
    ["แรงจากทางลาด", ((S.fG || 0) / 1000).toFixed(1) + " kN"],
    ["แรงต้านโค้ง", ((S.fC || 0) / 1000).toFixed(1) + " kN"],
    ["ความเร็วสูงสุดทางราบ (คำนวณ)", Math.round(vMaxFlat(tr) * KMH) + " กม./ชม."],
    ["โค้งนี้: สบาย / พลิกคว่ำ", S.R ? `${Math.round(safeV(S.R) * KMH)} / ${Math.round(flipV(S.R, tr) * KMH)} กม./ชม.` : "ทางตรง"],
    ["ระยะเบรกปกติ / ฉุกเฉิน", `${fmtD(stopDist(v, tr.bServ))} / ${fmtD(stopDist(v, tr.bEmer))}`]
  ];
  $("phys").innerHTML = rows.map(([k, x]) => `<tr><td>${k}</td><td>${x}</td></tr>`).join("");
}
const vMaxCache = {};
function vMaxFlat(tr) {   // หาจุดที่แรงฉุดเต็มที่ = แรงต้าน (ไม่จำกัดความเร็ว แต่ฟิสิกส์จำกัดเอง)
  if (vMaxCache[tr.name + S.wx]) return vMaxCache[tr.name + S.wx];
  let v = 1; for (; v < 140; v += 0.25) { const F = tractionAvail(v, tr, 8); if (F < tr.A + tr.B * v + tr.C * v * v) break; }
  return (vMaxCache[tr.name + S.wx] = v);
}
function drawAhead() {
  const c = $("aheadCv"); if (!c.clientWidth) return;
  const cw = Math.round(c.clientWidth * 2), chh = Math.round(c.clientHeight * 2);
  if (c.width !== cw || c.height !== chh) { c.width = cw; c.height = chh; }   // ความละเอียดตามขนาดจริง ตัวหนังสือไม่บีบ
  const g = c.getContext("2d"), W = c.width, H = c.height, L = 6000, tr = TRAINS[S.type];
  g.clearRect(0, 0, W, H);
  const zs = []; let zmin = 1e9, zmax = -1e9;
  for (let i = 0; i <= 120; i++) { const z = geo.z(S.s + i * L / 120); zs.push(z); zmin = Math.min(zmin, z); zmax = Math.max(zmax, z); }
  const span = Math.max(30, zmax - zmin), y = (z) => H - 30 - (z - zmin) / span * (H - 80);
  // โค้ง: แถบสีส้ม เข้มตามความแรงโค้ง + ตัวเลขความเร็วปลอดภัย
  let lastLabel = -1e9;
  for (let d = 0; d < L; d += 25) {
    const R = geo.radius(S.s + d); if (!R) continue;
    const x = d / L * W, k = clamp(400 / Math.abs(R), 0.15, 1);
    g.fillStyle = `rgba(255,140,30,${k * 0.7})`; g.fillRect(x, 0, W * 25 / L + 0.5, 16);
    if (d - lastLabel > 600 && Math.abs(R) < 900) { lastLabel = d; g.fillStyle = "#ffb020"; g.font = "600 20px system-ui"; g.textAlign = "left"; g.fillText(Math.round(safeV(R) * KMH), x + 2, 36); }
  }
  // อุโมงค์ / สะพาน
  for (let d = 0; d < L; d += 25) { const f = geo.flag(S.s + d); if (!f) continue; g.fillStyle = f & 1 ? "rgba(150,150,170,.5)" : "rgba(80,160,255,.45)"; g.fillRect(d / L * W, H - 24, W * 25 / L + 0.5, 10); }
  // โปรไฟล์ความสูง
  g.beginPath(); zs.forEach((z, i) => { const x = i / 120 * W; i ? g.lineTo(x, y(z)) : g.moveTo(x, y(z)); });
  g.lineTo(W, H - 30); g.lineTo(0, H - 30); g.closePath(); g.fillStyle = "rgba(255,255,255,.07)"; g.fill();
  g.beginPath(); zs.forEach((z, i) => { const x = i / 120 * W; i ? g.lineTo(x, y(z)) : g.moveTo(x, y(z)); }); g.strokeStyle = "#fff"; g.lineWidth = 3; g.stroke();
  // สถานี
  geo.stations.forEach((st) => {
    const d = st.s - S.s; if (d < 0 || d > L) return;
    const x = d / L * W, isStop = S.stops.slice(S.stopIdx).includes(st);
    g.strokeStyle = isStop ? "#30d158" : "rgba(255,255,255,.4)"; g.lineWidth = isStop ? 3 : 1.5; g.beginPath(); g.moveTo(x, 44); g.lineTo(x, H - 30); g.stroke();
    g.fillStyle = isStop ? "#30d158" : "#9aa6b8"; g.font = "600 20px 'IBM Plex Sans Thai', system-ui"; g.textAlign = "center"; g.fillText(st.n, clamp(x, 50, W - 50), 62);
  });
  // ระยะหยุดตอนนี้
  const sd = stopDist(Math.abs(S.v), tr.bServ); if (sd < L) { const x = sd / L * W; g.strokeStyle = "#ff4d4f"; g.setLineDash([8, 6]); g.lineWidth = 2; g.beginPath(); g.moveTo(x, 20); g.lineTo(x, H - 30); g.stroke(); g.setLineDash([]); g.fillStyle = "#ff4d4f"; g.font = "500 18px system-ui"; g.textAlign = "left"; g.fillText("หยุดได้ที่นี่", x + 4, H - 36); }
  g.fillStyle = "#9aa6b8"; g.font = "500 18px system-ui"; g.textAlign = "left";
  for (let k = 0; k <= 6; k++) { g.fillText(k + " กม.", k / 6 * W + (k === 6 ? -50 : 4), H - 2); }
  $("aheadKm").textContent = `ระดับ ${Math.round(zmin)}–${Math.round(zmax)} ม.`;
}

/* ---------------- แผนที่ + โปรไฟล์ทั้งสาย ---------------- */
let map = null, trainMk = null;
function initMap() {
  if (!window.L) return;
  map = L.map("map", { zoomControl: false, attributionControl: true }).setView([LAT[0], LON[0]], 9);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", { maxZoom: 18, className: "darktiles", attribution: "© OpenStreetMap" }).addTo(map);
  const pts = []; for (let i = 0; i < N; i += 6) pts.push([LAT[i], LON[i]]); pts.push([LAT[N - 1], LON[N - 1]]);
  L.polyline(pts, { color: "#f5b301", weight: 3, opacity: 0.9 }).addTo(map);
  geo.stations.forEach((st) => {
    const p = geo.at(st.s);
    L.circleMarker([p.lat, p.lon], { radius: st.m === 2 ? 5 : st.m ? 4 : 2.5, color: "#fff", weight: 1, fillColor: st.m === 2 ? "#30d158" : st.m ? "#f5b301" : "#9aa6b8", fillOpacity: 1 })
      .bindTooltip(`${st.n} · กม. ${(st.s / 1000).toFixed(1)}`).addTo(map);
  });
  trainMk = L.circleMarker([LAT[0], LON[0]], { radius: 7, color: "#fff", weight: 2, fillColor: "#ff4d4f", fillOpacity: 1 }).addTo(map);
}
function updMap() { if (!map) return; const p = geo.at(S.s); trainMk.setLatLng([p.lat, p.lon]); if (!$("mapWrap").classList.contains("big") || !updMap.done) { map.panTo([p.lat, p.lon], { animate: false }); updMap.done = true; } }
let profBase = null;
function drawProfile() {
  const c = $("profile"), r = c.getBoundingClientRect(), dpr = Math.min(2, devicePixelRatio || 1), W = Math.round(r.width * dpr), H = Math.round(r.height * dpr);
  if (!W || !H) return;
  if (c.width !== W || c.height !== H || !profBase) {
    c.width = W; c.height = H;
    const b = document.createElement("canvas"); b.width = W; b.height = H; const g = b.getContext("2d");
    g.fillStyle = "#121722"; g.fillRect(0, 0, W, H);
    let zmax = 0; for (let i = 0; i < N; i++) zmax = Math.max(zmax, Z[i]);
    g.beginPath(); g.moveTo(0, H);
    for (let x = 0; x < W; x++) { const z = geo.z(x / W * TOTAL); g.lineTo(x, H - 6 - z / (zmax + 50) * (H - 22)); }
    g.lineTo(W, H); g.closePath(); const gr = g.createLinearGradient(0, 0, 0, H); gr.addColorStop(0, "#5a7d4a"); gr.addColorStop(1, "#22301c"); g.fillStyle = gr; g.fill();
    geo.stations.forEach((st) => { if (!st.m) return; const x = st.s / TOTAL * W; g.fillStyle = st.m === 2 ? "#30d158" : "rgba(255,255,255,.5)"; g.fillRect(x, H - 6, 1.5 * dpr, 6); });
    g.fillStyle = "#9aa6b8"; g.font = `${10 * dpr}px system-ui`; g.fillText(`ระดับสูง ${Math.round(zmax)} ม. · คลิกเพื่อย้ายรถ`, 6 * dpr, 13 * dpr);
    profBase = b;
  }
  const g = c.getContext("2d"); g.drawImage(profBase, 0, 0);
  const x = S.s / TOTAL * W; g.fillStyle = "#ff4d4f"; g.fillRect(x - dpr, 0, 2 * dpr, H);
}

/* ---------------- แผงควบคุม ---------------- */
function pressed(groupId, attr, val) { document.querySelectorAll(`#${groupId} button`).forEach((b) => b.setAttribute("aria-pressed", String(b.dataset[attr] === String(val)))); }
function buildPanel() {
  renderTrains();
  $("trains").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.type = b.dataset.k; pressed("trains", "k", S.type); fillRoute(); restart(); updCarUI(); });
  const setCars = (n) => {
    const [lo, hi] = CAR_RANGE[S.type]; n = clamp(Math.round(n), lo, hi);
    if (n === CARS[S.type]) { updCarUI(); return; }
    CARS[S.type] = n; TRAINS[S.type] = makeTrain(S.type, n); renderTrains(); restart(); updCarUI();
    flash(`ปรับเป็น ${TRAINS[S.type].name} — เริ่มใหม่ที่สถานี${geo.stations[S.from].n}`, "info", 3000);
  };
  $("carMinus").addEventListener("click", () => setCars(CARS[S.type] - 1));
  $("carPlus").addEventListener("click", () => setCars(CARS[S.type] + 1));
  $("carRange").addEventListener("input", () => updCarUI(+$("carRange").value));
  $("carRange").addEventListener("change", () => setCars(+$("carRange").value));
  updCarUI();
  fillRoute();
  $("from").addEventListener("change", () => { S.from = +$("from").value; if (S.to <= S.from) { S.to = geo.stations.length - 1; $("to").value = S.to; } restart(); });
  $("to").addEventListener("change", () => { S.to = +$("to").value; if (S.to <= S.from) { S.from = 0; $("from").value = 0; } restart(); });
  $("stopMode").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.stopMode = b.dataset.m; pressed("stopMode", "m", S.stopMode); S.stops = stopsFor().filter((st) => stopMark(st) > S.s - 25); S.stopIdx = 0; flash("ปรับรูปแบบการจอดแล้ว", "info"); });
  $("btnStart").addEventListener("click", () => { restart(); showPanel(false); });
  $("camBtn").addEventListener("click", () => { const i = CAMS.indexOf(world ? world.mode : "cab"); setCam(CAMS[(i + 1) % CAMS.length]); $("camBtn").blur(); });
  $("cams").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; setCam(b.dataset.c); });
  $("warp").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.warp = +b.dataset.w; pressed("warp", "w", S.warp); });
  $("btnAuto").addEventListener("click", toggleAto);
  $("tod").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.tod = b.dataset.t; pressed("tod", "t", S.tod); world && world.setEnv({ tod: S.tod }); });
  $("wx").addEventListener("click", (e) => { const b = e.target.closest("button"); if (!b) return; S.wx = b.dataset.x; pressed("wx", "x", S.wx); world && world.setEnv({ wx: S.wx }); if (S.wx === "rain") flash("ฝนตก: รางเปียก แรงยึดเกาะลดลง ~40% — ระวังล้อฟรีตอนออกตัวและล้อไถลตอนเบรก", "info", 5000); });
  $("btnSound").addEventListener("click", () => { S.sound = !S.sound; sfx.init(); $("btnSound").setAttribute("aria-pressed", String(S.sound)); $("btnSound").textContent = "เสียง " + (S.sound ? "เปิด" : "ปิด"); });
  $("mapBtn").addEventListener("click", toggleMap);
  $("mapTop").addEventListener("click", () => showMap($("mapWrap").hidden));
  $("panelTop").addEventListener("click", () => showPanel($("panel").classList.contains("closed")));
  $("panelClose").addEventListener("click", () => showPanel(false));
  $("atoTop").addEventListener("click", () => { toggleAto(); $("atoTop").blur(); });
  if (innerWidth < 1000 || innerHeight < 640) showMap(false);
  $("profile").addEventListener("click", (e) => {
    const r = $("profile").getBoundingClientRect(), s = clamp((e.clientX - r.left) / r.width * TOTAL, TRAINS[S.type].length, TOTAL - 50);
    jumpTo(s); flash(`ย้ายรถไปที่ กม. ${(s / 1000).toFixed(1)}`, "info");
  });
}
function renderTrains() { $("trains").innerHTML = Object.entries(TRAINS).map(([k, t]) => `<button data-k="${k}" aria-pressed="${k === S.type}"><strong>${t.name}</strong><span>${t.sub}</span></button>`).join(""); }
// แสดงจำนวนตู้ + ผลทางฟิสิกส์ของการเพิ่ม/ลดตู้ (ยังไม่กดยืนยัน = แสดงค่าที่จะได้)
function updCarUI(preview) {
  const [lo, hi, unit] = CAR_RANGE[S.type], n = preview || CARS[S.type], tr = preview ? makeTrain(S.type, n) : TRAINS[S.type];
  const r = $("carRange"); r.min = lo; r.max = hi; if (!preview) r.value = n;
  $("carN").textContent = `${n} ${unit}`;
  $("carMinus").disabled = n <= lo; $("carPlus").disabled = n >= hi;
  const kwt = tr.power / tr.mass, need = tr.mass * G * 0.026 + tr.A + tr.mass * G * 0.0015, adh = mu(8) * tr.adhMass * G;
  const climb = Math.min(tr.fmax, adh) > need;
  $("carInfo").innerHTML = `ยาว ${Math.round(tr.length)} ม. · หนัก ${fmtN(tr.mass / 1000)} ตัน · ${(kwt).toFixed(1)} kW/ตัน<br>
    ความเร็วสูงสุดทางราบ ~${Math.round(vMaxFlat(tr) * KMH)} กม./ชม. · ระยะเบรกจาก 100 กม./ชม. ~${Math.round(tr.airLag * 27.8 * 0.5 + 27.8 * 27.8 / (2 * tr.bServ))} ม.<br>
    ${climb ? `ขึ้นทางชันสุด 2.6% (ดอยขุนตาน) ได้ — แรงที่ใช้ ${fmtN(need / 1000)} kN / แรงฉุดได้ ${fmtN(Math.min(tr.fmax, adh) / 1000)} kN` : `<b style="color:var(--bad)">หนักเกิน! ขึ้นทางชัน 2.6% ไม่ไหว — ต้องใช้ ${fmtN(need / 1000)} kN แต่ล้อยึดเกาะได้แค่ ${fmtN(Math.min(tr.fmax, adh) / 1000)} kN (ล้อจะฟรี)</b>`}
    ${tr.length > 230 ? "<br>ขบวนยาวกว่าชานชาลาสถานีหลัก (~220 ม.) ท้ายขบวนจะเลยชานชาลา" : ""}`;
}
function fillRoute() {
  const tr = TRAINS[S.type];
  const opt = geo.stations.map((st, i) => (st.h && tr.stopMin > 0 ? "" : `<option value="${i}">${st.n} · กม. ${(st.s / 1000).toFixed(1)}${st.m === 2 ? " ★" : ""}</option>`)).join("");
  $("from").innerHTML = opt; $("to").innerHTML = opt;
  const ok = (i) => !(geo.stations[i].h && tr.stopMin > 0);
  if (!ok(S.from)) S.from = 0;
  if (!S.to || !ok(S.to)) S.to = geo.stations.length - 1;
  $("from").value = S.from; $("to").value = S.to;
}
function showMap(on) { $("mapWrap").hidden = !on; $("mapTop").setAttribute("aria-pressed", String(on)); if (on) setTimeout(() => { map && map.invalidateSize(); profBase = null; }, 50); }
function showPanel(on) { $("panel").classList.toggle("closed", !on); $("panelTop").setAttribute("aria-pressed", String(on)); }
function toggleMap() { const w = $("mapWrap"); w.classList.toggle("big"); $("mapBtn").textContent = w.classList.contains("big") ? "ย่อ" : "ขยาย"; setTimeout(() => { map && map.invalidateSize(); profBase = null; }, 280); }
function updAtoBtn() { $("atoTop").setAttribute("aria-pressed", String(S.ato)); $("btnAuto").setAttribute("aria-pressed", String(S.ato)); $("btnAuto").textContent = "ระบบขับอัตโนมัติ (ATO) — " + (S.ato ? "เปิด" : "ปิด"); }
function toggleAto() { if (S.derailed) return; S.ato = !S.ato; S.emer = false; updAtoBtn(); flash(S.ato ? "ATO เปิด: ระบบขับตามความเร็วปลอดภัยของโค้งและจอดตรงจุดให้" : "ATO ปิด: ขับเองด้วยคันบังคับ", "info"); }
const CAMS = ["cab", "chase", "side", "drone", "track"];
const CAM_NAME = { cab: "ห้องคนขับ", chase: "ไล่หลัง", side: "ข้างขบวน", drone: "โดรน", track: "ข้างราง" };
function setCam(c) { pressed("cams", "c", c); world && world.setCam(c); $("camBtn").querySelector(".lbl").textContent = CAM_NAME[c]; }
function resetRun(sStart) {
  Object.assign(S, { v: 0, a: 0, lever: -8, emer: false, trac: 0, brk: 1, slip: 0, slide: 0, au: 0, auT: 0, derailed: null, t: 0, energy: 0, regenE: 0, fuel: 0, dwell: 0, atStation: null, results: [], done: false, maxV: 0 });
  S.s = clamp(sStart, TRAINS[S.type].length, TOTAL);
}
function restart() {
  S.tr = TRAINS[S.type];
  const a = geo.stations[S.from];
  resetRun(a.s === 0 ? S.tr.length + 5 : stopMark(a));
  S.stops = stopsFor(); S.stopIdx = 0; S.atStation = a;
  world && world.recenterAt(S.s);
  world && world.warm(S.s);
  big(`${S.tr.name}<br><small style="font-size:1.1rem">${a.n} → ${geo.stations[S.to].n} · จอด ${S.stops.length} สถานี · ${((geo.stations[S.to].s - a.s) / 1000).toFixed(0)} กม.</small>`, 3500);
}
function jumpTo(s) {
  resetRun(s); S.atStation = null;
  S.stops = stopsFor().filter((st) => stopMark(st) > S.s + 30); S.stopIdx = 0;
  world && world.recenterAt(S.s); world && world.warm(S.s);
}

/* ---------------- คีย์บอร์ด + จอยเกม ---------------- */
let held = { up: 0, dn: 0 }, repeatT = 0;
// ใช้ตำแหน่งปุ่มจริง (e.code) — คีย์บอร์ดภาษาไทยกด C ได้ "แ" ปุ่มลัดจะไม่ทำงานถ้าใช้ e.key
const keyOf = (e) => (e.code && e.code.startsWith("Key") ? e.code.slice(3).toLowerCase() : e.code && e.code.startsWith("Digit") ? e.code.slice(5) : e.code === "Space" ? " " : e.key.toLowerCase());
function moveLever(d) {
  if (S.derailed) return;
  if (S.ato) { S.ato = false; updAtoBtn(); flash("คนขับรับช่วงต่อ — ATO ปิด", "info"); }
  if (S.emer && d > 0) { S.emer = false; S.lever = -8; return; }
  S.lever = clamp(S.lever + d, -8, 8);
}
window.addEventListener("keydown", (e) => {
  if (e.target && e.target.closest && e.target.closest("select, input")) return;
  sfx.init();
  const k = keyOf(e);
  if (k === "arrowup" || k === "w") { if (!held.up) moveLever(1); held.up = 1; repeatT = 0.35; e.preventDefault(); }
  else if (k === "arrowdown" || k === "s") { if (!held.dn) moveLever(-1); held.dn = 1; repeatT = 0.35; e.preventDefault(); }
  else if (k === " ") { S.emer = true; S.ato = false; updAtoBtn(); flash("เบรกฉุกเฉิน!", "", 1500); e.preventDefault(); }
  else if (k === "0") { if (!S.derailed) { S.lever = 0; S.emer = false; } }
  else if (k === "h") sfx.horn();
  else if (k === "c") { const i = CAMS.indexOf(world ? world.mode : "cab"); setCam(CAMS[(i + 1) % CAMS.length]); }
  else if (k === "a") toggleAto();
  else if (k === "m") showMap($("mapWrap").hidden);
  else if (k === "tab") { showPanel($("panel").classList.contains("closed")); e.preventDefault(); }
});
window.addEventListener("keyup", (e) => { const k = keyOf(e); if (k === "arrowup" || k === "w") held.up = 0; if (k === "arrowdown" || k === "s") held.dn = 0; });
window.addEventListener("pointerdown", () => sfx.init(), { once: true });
let padPrev = [];
function pollPad(dt) {
  const pads = navigator.getGamepads ? navigator.getGamepads() : []; const p = pads && [...pads].find(Boolean); if (!p) return;
  const b = (i) => p.buttons[i] && p.buttons[i].pressed, edge = (i) => b(i) && !padPrev[i];
  const rt = p.buttons[7] ? p.buttons[7].value : 0, lt = p.buttons[6] ? p.buttons[6].value : 0;
  if (rt > 0.1 || lt > 0.1) { if (S.ato) { S.ato = false; updAtoBtn(); } S.emer = false; S.lever = rt > lt ? Math.round(rt * 8) : -Math.round(lt * 8); }
  if (edge(0)) sfx.horn();
  if (edge(1)) { S.emer = true; S.ato = false; updAtoBtn(); }
  if (edge(3)) { const i = CAMS.indexOf(world.mode); setCam(CAMS[(i + 1) % CAMS.length]); }
  if (edge(2)) toggleAto();
  if (edge(12)) moveLever(1); if (edge(13)) moveLever(-1);
  padPrev = p.buttons.map((x) => x.pressed);
}

/* ---------------- วงรอบหลัก ---------------- */
let world = null, last = 0, hudT = 0, slowT = 0, warnT = 0;
// มุมเอียงเป้าหมายของตัวรถ: เอียงเข้าตามยกโค้ง + เอนออกตามแรงเหวี่ยงที่เหลือ (คิดจากความโค้งต่อเนื่อง)
const rollFor = (s) => { const k = geo.curvS(s), ak = Math.abs(k); if (ak < 1e-5) return 0; const sg = Math.sign(k), cant = Math.min(0.9, 600 * ak), au = S.v * S.v * ak - cant; return -sg * cant / G + sg * clamp(au, -2, 3) / G * 0.12; };
function frame(now) {
  requestAnimationFrame(frame);
  const dtR = Math.min(0.1, (now - last) / 1000 || 0); last = now;
  if (!(dtR > 0)) return;
  // คันบังคับค้างปุ่ม
  if (held.up || held.dn) { repeatT -= dtR; if (repeatT <= 0) { moveLever(held.up ? 1 : -1); repeatT = 0.16; } }
  pollPad(dtR);
  // จำลองแบบละเอียด (ขั้นละไม่เกิน 0.05 วินาที) × เร่งเวลา
  let rem = dtR * S.warp;
  while (rem > 1e-6) { const h = Math.min(0.05, rem); if (S.ato) runAto(); stepPhysics(h); checkStops(h); rem -= h; }
  // คำเตือนแรงเหวี่ยง/ล้อฟรี
  warnT -= dtR;
  if (warnT <= 0 && !S.derailed) {
    if (S.au > S.auLim * 0.8) { flash(`อันตราย! แรงเหวี่ยง ${S.au.toFixed(2)} ม./วิ² ใกล้ขีดพลิกคว่ำ ${S.auLim.toFixed(2)} — ลดความเร็วด่วน`, "", 1200); sfx.beep(); warnT = 0.6; }
    else if (S.au > COMFORT) { flash(`แรงเหวี่ยงเกินระดับสบาย (${S.au.toFixed(2)} > ${COMFORT}) — ผู้โดยสารเซ`, "info", 1200); warnT = 1.5; }
    else if (S.slip) { flash("ล้อฟรี! ลดกำลังลง (แรงฉุดเกินแรงยึดเกาะ)", "info", 1200); warnT = 1.5; }
    else if (S.slide) { flash("ล้อไถล! เบรกแรงเกินแรงยึดเกาะ ระยะเบรกจะยาวขึ้น", "info", 1200); warnT = 1.5; }
  }
  sfx.update(dtR);
  if (world) world.update(dtR, { s: S.s, v: S.v, trainKey: trainKey(), train: TRAINS[S.type], rollFor, derailed: S.derailed });
  drawSpeedo();
  hudT -= dtR; slowT -= dtR;
  if (hudT <= 0) { hudT = 0.12; drawReadouts(); drawNext(); }
  if (slowT <= 0) { slowT = 0.5; drawPhys(); drawAhead(); updMap(); drawProfile(); }
}
async function start() {
  buildPanel(); initMap(); updAtoBtn();
  try {
    const mod = await import("./train_sim_3d.js?v=20261126-7");
    world = mod.createWorld($("view"), { geo, electric: () => !!TRAINS[S.type].electric });
    window.addEventListener("resize", () => world.resize());
    world.setEnv({ tod: S.tod, wx: S.wx });
  } catch (e) { console.error(e); flash("โหลดกราฟิก 3 มิติไม่สำเร็จ — ยังขับได้จากหน้าปัดและแผนที่", "", 6000); }
  restart();
  $("loading").hidden = true;
  if (new URLSearchParams(location.search).get("debug") === "1") window.__train = { S, geo, TRAINS, jumpTo, restart, world: () => world, sim(sec) { for (let t = 0; t < sec; t += 0.05) { if (S.ato) runAto(); stepPhysics(0.05); checkStops(0.05); } } };
  requestAnimationFrame(frame);
}
requireLogin(() => start());
