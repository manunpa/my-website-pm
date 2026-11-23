/* =====================================================================
   ขบวนรถอื่นบนรางที่ 2 (ทางคู่ ขาสวน) ตามตารางเดินรถ
   - สายเหนือ: ขบวนขาล่อง (เชียงใหม่/ต้นทางอื่น → กรุงเทพ) ทุกขบวนตามตารางเดินรถทางการของการรถไฟฯ (train_tt_north.js)
   - สายสนามบิน: รถไฟฟ้าแอร์พอร์ตเรล ลิงก์ สุวรรณภูมิ → พญาไท ทุก 10 นาทีช่วงเร่งด่วน / 13 นาทีช่วงปกติ (05:30–24:00)
   - ไม่มีรถบนรางที่เราวิ่ง → ไม่มีทางชนกัน (เราวิ่งขากลับ: ขบวนสวนเป็นขาขึ้น วิ่งรางที่ 1 แทน)
   - ตำแหน่งคำนวณจากเวลา: ออกตามเวลา เร่ง–วิ่งคงที่–เบรก ให้ถึงสถานีถัดไปตรงเวลาพอดี จอดเปิดประตูรับส่งผู้โดยสาร
   ===================================================================== */
const DAY = 86400;
const KIND = {
  special: { label: "ด่วนพิเศษ", cars: 12, acc: 0.32 },
  express: { label: "รถด่วน", cars: 11, acc: 0.3 },
  rapid: { label: "รถเร็ว", cars: 9, acc: 0.3 },
  ordinary: { label: "รถธรรมดา", cars: 7, acc: 0.3 },
  suburban: { label: "รถชานเมือง", cars: 6, acc: 0.32 },
  local: { label: "รถท้องถิ่น", cars: 5, acc: 0.34 },
  drc: { label: "ด่วนพิเศษดีเซลราง", cars: 4, acc: 0.5, dmu: true },
  feeder: { label: "พิเศษชานเมือง", cars: 3, acc: 0.55, dmu: true },
  arl: { label: "แอร์พอร์ตเรล ลิงก์", cars: 4, acc: 0.8, emu: true }
};
function consist(list) { let acc = 0; return list.map((c) => { const o = Object.assign({}, c, { off: acc + c.len / 2 }); acc += c.len + 0.8; return o; }); }
function carsFor(k) {
  const K = KIND[k], n = K.cars;
  let list;
  if (K.emu) list = Array.from({ length: n }, (_, i) => ({ type: "emu", len: 20, cab: i === 0 ? 1 : 0, cabRear: i === n - 1 ? 1 : 0, panto: i % 3 === 1 ? 1 : 0 }));
  else if (K.dmu) list = Array.from({ length: n }, (_, i) => ({ type: "dmu", len: 20.5, cab: i === 0 ? 1 : 0, cabRear: i === n - 1 ? 1 : 0 }));
  else list = [{ type: "loco", len: 20 }].concat(Array.from({ length: n }, () => ({ type: "coach", len: 20.5 })));
  const cars = consist(list), last = cars[cars.length - 1];
  return { key: "ai-" + k, cars, length: last.off + last.len / 2 };
}
// ช่วงวิ่งระหว่าง 2 สถานี: ระยะ D ในเวลา T → ความเร็วคงที่ v (โปรไฟล์คางหมู เร่ง/เบรกเท่ากัน a)
function runSeg(D, T, a) {
  T = Math.max(T, 20);
  const disc = T * T - 4 * D / a;
  if (disc <= 0) { const a2 = 4 * D / (T * T); return { v: a2 * T / 2, a: a2, T, D }; }
  return { v: (T - Math.sqrt(disc)) * a / 2, a, T, D };
}
function posIn(seg, tau) {
  const { v, a, T, D } = seg, ta = v / a;
  if (tau <= ta) return { d: 0.5 * a * tau * tau, v: a * tau };
  if (tau >= T - ta) { const r = Math.max(0, T - tau); return { d: D - 0.5 * a * r * r, v: a * r }; }
  return { d: 0.5 * v * ta + v * (tau - ta), v };
}
const smooth = (x) => { x = Math.max(0, Math.min(1, x)); return x * x * (3 - 2 * x); };

// แปลงตาราง [สถานี, เวลาออก] → ลำดับช่วงเวลา (จอด/วิ่ง) ที่หาตำแหน่งได้ทันที
function plan(tr, geo, dir) {
  const K = KIND[tr.kind], spec = carsFor(tr.kind), st = geo.stations;
  const dwellAt = (i, last) => (last ? 0 : tr.kind === "arl" ? (st[i].n === "มักกะสัน" ? 60 : 40) : K.dmu ? 45 : st[i].m ? 90 : 60);
  // ตำแหน่งหัวขบวน (ขาล่องวิ่งไปทาง s น้อย): หยุดให้ตัวรถอยู่กลางชานชาลา
  const stopS = (i) => Math.max(5, Math.min(geo.total - spec.length - 5, st[i].s + dir * Math.min(spec.length / 2, 105)));
  const segs = [];
  const S0 = tr.stops[0], SN = tr.stops[tr.stops.length - 1];
  segs.push({ k: "dwell", t0: S0[1] - (tr.kind === "arl" ? 240 : 600), t1: S0[1], s: stopS(S0[0]), st: S0[0], first: true });
  // เวลาในตารางบางช่วงสั้นเกินจะทำได้ด้วยความเร็วสูงสุดของทาง (120 กม./ชม.; แอร์พอร์ตลิงก์ 160) → ถึงช้ากว่าตารางเล็กน้อยแล้วไล่เวลาคืน
  const vCap = (tr.kind === "arl" ? 160 : 120) / 3.6;
  let ta = S0[1];
  for (let i = 0; i < tr.stops.length - 1; i++) {
    const a = tr.stops[i][0], [b, tb] = tr.stops[i + 1], last = i === tr.stops.length - 2;
    const sa = stopS(a), sb = stopS(b), D = Math.abs(sb - sa), arr = tb - dwellAt(b, last);
    const tMin = D > vCap * vCap / K.acc ? D / vCap + vCap / K.acc : 2 * Math.sqrt(D / K.acc);
    const seg = runSeg(D, Math.max(arr - ta, tMin), K.acc);
    segs.push({ k: "run", t0: ta, t1: ta + seg.T, sa, sb, seg });
    const tDep = last ? ta + seg.T + 240 : Math.max(tb, ta + seg.T + 25);
    segs.push({ k: "dwell", t0: ta + seg.T, t1: tDep, s: sb, st: b, last });
    ta = tDep;
  }
  return { id: (dir > 0 ? "u" : "d") + tr.no, no: tr.no, kind: tr.kind, label: K.label, name: tr.name, from: st[S0[0]].n, to: st[SN[0]].n, dest: tr.dest, spec, segs, dir, t0: segs[0].t0, t1: segs[segs.length - 1].t1 };
}

function stateAt(P, c) {
  for (const day of [0, DAY, -DAY]) {
    const t = c + day;
    if (t < P.t0 || t > P.t1) continue;
    for (const sg of P.segs) {
      if (t < sg.t0 || t > sg.t1) continue;
      if (sg.k === "dwell") {
        // ประตูเปิด 4 วิหลังจอด · ปิด 8 วิก่อนออก (ต้นทาง: เปิดรอผู้โดยสาร · ปลายทาง: เปิดให้ลงหมดแล้วหายไป)
        const open = sg.first ? smooth((t - sg.t0) / 2.5) * smooth((sg.t1 - 8 - t) / 2.5) : sg.last ? smooth((t - sg.t0 - 4) / 2.5) * smooth((sg.t1 - 20 - t) / 2.5) : smooth((t - sg.t0 - 4) / 2.5) * smooth((sg.t1 - 8 - t) / 2.5);
        return { s: sg.s, v: 0, door: open, st: sg.st, dwellLeft: sg.t1 - t, next: sg.st, term: !!sg.last, orig: !!sg.first };
      }
      const p = posIn(sg.seg, t - sg.t0), sgn = Math.sign(sg.sb - sg.sa);
      return { s: sg.sa + sgn * p.d, v: p.v, door: 0, st: -1, next: null };
    }
  }
  return null;
}

// ขบวนขาขึ้นสายเหนือ: ในเกมยังไม่มีตารางขาขึ้นจริง → สร้างจากขบวนขาล่องแต่ละขบวน
// วิ่งเส้นทางเดิมย้อนกลับ ใช้เวลาแต่ละช่วงเท่าเดิม ออกจากต้นทางเวลาเดียวกับที่ขาล่องออก · เลขขบวน = เลขคี่คู่กัน (ขาล่องเลขคู่) + "*"
function mirrorTrip(t) {
  const st = t.stops, n = st.length, out = [[st[n - 1][0], st[0][1]]];
  for (let k = 1; k < n; k++) out.push([st[n - 1 - k][0], out[k - 1][1] + (st[n - k][1] - st[n - 1 - k][1])]);
  const no = /^\d+$/.test(t.no) ? String(+t.no % 2 === 0 ? +t.no - 1 : +t.no + 1) : t.no;
  return { no: no + "*", name: t.name, type: t.type, dest: t.dest, stops: out };
}

// dir = ทิศของขบวนสวน: −1 วิ่งเข้ากรุงเทพ (ใช้เมื่อเราวิ่งขาออก) · +1 วิ่งออกจากกรุงเทพ (ใช้เมื่อเราวิ่งขากลับ)
export function makeTraffic(lineId, geo, TT, dir = -1) {
  const trains = [];
  if (lineId === "arl") {
    // แอร์พอร์ตเรล ลิงก์ (City Line) สุวรรณภูมิ ↔ พญาไท: หาเวลาแต่ละช่วงจากความเร็วสูงสุด 160 กม./ชม. เร่ง/เบรก 0.8 ม./วิ²
    const idx = geo.stations.map((s, i) => i).filter((i) => geo.stations[i].s >= (geo.stations.find((x) => x.n === "พญาไท") || geo.stations[0]).s);
    if (dir < 0) idx.reverse();
    const dest = geo.stations[idx[idx.length - 1]].n;
    const vmax = 160 / 3.6, a = 0.8;
    const runT = (D) => (D > vmax * vmax / a ? D / vmax + vmax / a : 2 * Math.sqrt(D / a)) * 1.06 + 8;
    let n = 1;
    for (let t = 5 * 3600 + 30 * 60; t <= 24 * 3600; ) {
      const stops = []; let tt = t;
      idx.forEach((i, k) => {
        if (k > 0) tt += runT(Math.abs(geo.stations[idx[k - 1]].s - geo.stations[i].s)) + (k < idx.length - 1 ? (geo.stations[i].n === "มักกะสัน" ? 60 : 40) : 0);
        stops.push([i, Math.round(tt)]);
      });
      trains.push(plan({ no: "ARL " + String(n++).padStart(3, "0"), name: "City Line", kind: "arl", dest, stops }, geo, dir));
      const h = t / 3600, peak = (h >= 6.5 && h < 9.5) || (h >= 16.5 && h < 19.5);
      t += peak ? 600 : 780;
    }
  } else if (TT) {
    const kindOf = (t) => (t.type === "special" && /ดีเซลราง/.test(t.name) ? "drc" : t.type === "feeder_dm" || /^90/.test(t.no) ? "feeder" : KIND[t.type] ? t.type : "ordinary");
    (dir < 0 ? TT.south : TT.south.map(mirrorTrip)).forEach((t) => { trains.push(plan({ no: t.no, name: t.name, kind: kindOf(t), dest: t.dest, stops: t.stops }, geo, dir)); });
  }
  return {
    trains,
    // ขบวนที่อยู่บนรางในเวลานาฬิกา c (วินาทีนับจากเที่ยงคืน)
    at(c) {
      c = ((c % DAY) + DAY) % DAY;
      const out = [];
      trains.forEach((P) => { const r = stateAt(P, c); if (r) out.push(Object.assign(r, { id: P.id, P })); });
      return out;
    }
  };
}
