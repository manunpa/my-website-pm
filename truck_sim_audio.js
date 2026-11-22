/* =====================================================================
   เสียงของตัวจำลอง — สังเคราะห์สดด้วย Web Audio (ไม่มีไฟล์เสียง)
   เครื่องยนต์ดีเซล (รอบตามความเร็ว+เกียร์) · ลมเบรก · เสียงเตือนถอย · ไฟเลี้ยว · แตร
   · ยางลื่นไถล · เสียงชน · เสียงเตือนเซนเซอร์มุมอับ
   เบราว์เซอร์จะยอมเล่นเสียงหลังผู้ใช้คลิก/กดปุ่มครั้งแรกเท่านั้น
   ===================================================================== */
export function createAudio() {
  const AC = window.AudioContext || window.webkitAudioContext;
  if (!AC) return null;
  const ctx = new AC();
  const master = ctx.createGain(); master.gain.value = 0.55; master.connect(ctx.destination);

  // เสียงรบกวน (ใช้ทำลมเบรก/ยาง/ชน)
  const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
  const nd = noiseBuf.getChannelData(0);
  for (let i = 0; i < nd.length; i++) nd[i] = Math.random() * 2 - 1;
  const noise = () => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = true; return s; };

  // ---- เครื่องยนต์: 2 ออสซิลเลเตอร์ + กรองเสียงต่ำ + เสียงลูกสูบสั่น ----
  const eng = ctx.createGain(); eng.gain.value = 0;
  const lp = ctx.createBiquadFilter(); lp.type = "lowpass"; lp.frequency.value = 600; lp.Q.value = 3;
  const o1 = ctx.createOscillator(); o1.type = "sawtooth";
  const o2 = ctx.createOscillator(); o2.type = "square";
  const g2 = ctx.createGain(); g2.gain.value = 0.35;
  const trem = ctx.createOscillator(); trem.type = "sine";
  const tremG = ctx.createGain(); tremG.gain.value = 0.25;
  const engAmp = ctx.createGain(); engAmp.gain.value = 0.75;
  trem.connect(tremG); tremG.connect(engAmp.gain);
  o1.connect(lp); o2.connect(g2); g2.connect(lp); lp.connect(engAmp); engAmp.connect(eng); eng.connect(master);
  o1.start(); o2.start(); trem.start();
  // ลมเทอร์โบหวีดเบา ๆ
  const turbo = ctx.createOscillator(); turbo.type = "sine";
  const turboG = ctx.createGain(); turboG.gain.value = 0;
  turbo.connect(turboG); turboG.connect(master); turbo.start();

  // ---- ยางลื่นไถล ----
  const skid = noise(), skidBp = ctx.createBiquadFilter(); skidBp.type = "bandpass"; skidBp.frequency.value = 900; skidBp.Q.value = 4;
  const skidG = ctx.createGain(); skidG.gain.value = 0;
  skid.connect(skidBp); skidBp.connect(skidG); skidG.connect(master); skid.start();

  // ---- แตร (2 โทน) ----
  const hornG = ctx.createGain(); hornG.gain.value = 0;
  [330, 415].forEach((f) => { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = f; const bp = ctx.createBiquadFilter(); bp.type = "bandpass"; bp.frequency.value = f * 2; bp.Q.value = 1.5; o.connect(bp); bp.connect(hornG); o.start(); });
  hornG.connect(master);

  function burst({ dur = 0.5, freq = 2500, type = "highpass", gain = 0.35, q = 0.8 }) {
    const s = noise(), f = ctx.createBiquadFilter(); f.type = type; f.frequency.value = freq; f.Q.value = q;
    const g = ctx.createGain(), t = ctx.currentTime;
    g.gain.setValueAtTime(gain, t); g.gain.exponentialRampToValueAtTime(0.001, t + dur);
    s.connect(f); f.connect(g); g.connect(master); s.start(t); s.stop(t + dur + 0.05);
  }
  function tone(freq, dur, gain = 0.12, type = "square") {
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.type = type; o.frequency.value = freq;
    g.gain.setValueAtTime(gain, t); g.gain.setValueAtTime(gain, t + dur * 0.8); g.gain.linearRampToValueAtTime(0, t + dur);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + dur + 0.02);
  }
  function crash() {
    burst({ dur: 0.9, freq: 400, type: "lowpass", gain: 0.9, q: 0.5 });
    burst({ dur: 0.35, freq: 3000, type: "highpass", gain: 0.5 });
    const o = ctx.createOscillator(), g = ctx.createGain(), t = ctx.currentTime;
    o.frequency.setValueAtTime(90, t); o.frequency.exponentialRampToValueAtTime(35, t + 0.4);
    g.gain.setValueAtTime(0.8, t); g.gain.exponentialRampToValueAtTime(0.001, t + 0.5);
    o.connect(g); g.connect(master); o.start(t); o.stop(t + 0.55);
  }

  // ---- สถานะต่อเฟรม ----
  const st = { gear: 1, wasBraking: 0, brakeHeld: 0, revT: 0, blinkT: 0, hits: 0, rolls: 0, bsdT: 0, on: true };
  const GEARS = [0, 2.6, 4.6, 7.2, 10.5, 14.5, 19.5, 26];   // ความเร็วสูงสุดต่อเกียร์ (ม./วิ)

  function update(dt, s) {
    if (!st.on || !Number.isFinite(s.v)) return;
    const v = Math.abs(s.v), thr = s.ctl && Number.isFinite(s.ctl.thr) ? s.ctl.thr : 0;
    // เกียร์อัตโนมัติจำลอง: รอบ 650–2100
    if (v > GEARS[st.gear] * 0.95 && st.gear < 7) st.gear++;
    else if (st.gear > 1 && v < GEARS[st.gear - 1] * 0.7) st.gear--;
    const lo = GEARS[st.gear - 1], hi = GEARS[st.gear];
    const rpm = s.rolled ? 650 : 650 + 1450 * Math.max(0, Math.min(1, (v - lo * 0.7) / (hi - lo * 0.7 || 1))) * (v > 0.3 ? 1 : 0) + thr * 120;
    const f = rpm / 60 * 3;                    // ดีเซล 6 สูบ: จุดระเบิด 3 ครั้ง/รอบ
    const t = ctx.currentTime;
    o1.frequency.setTargetAtTime(f, t, 0.08); o2.frequency.setTargetAtTime(f / 2, t, 0.08);
    trem.frequency.setTargetAtTime(f / 3, t, 0.08);
    lp.frequency.setTargetAtTime(300 + thr * 900 + rpm * 0.2, t, 0.1);
    eng.gain.setTargetAtTime(s.rolled ? 0.02 : 0.07 + thr * 0.09, t, 0.1);
    turbo.frequency.setTargetAtTime(1800 + rpm * 1.4, t, 0.2);
    turboG.gain.setTargetAtTime(thr * 0.012 * Math.min(1, rpm / 1500), t, 0.3);
    // ลมเบรก: ฟู่ตอนปล่อยเบรกหลังเหยียบนาน
    const braking = s.brakeA > 0.2;
    if (braking) st.brakeHeld += dt;
    if (!braking && st.wasBraking && st.brakeHeld > 0.4) burst({ dur: 0.7, freq: 2800, gain: 0.28 });
    if (braking && !st.wasBraking && s.ctl && s.ctl.brk > 0.9) burst({ dur: 0.25, freq: 3500, gain: 0.12 });
    if (!braking) st.brakeHeld = 0;
    st.wasBraking = braking;
    // ยางเสียดถนน
    const skidOn = v > 3 && (s.phys.locked || s.brakeA > 0.92 * s.aMax);
    skidG.gain.setTargetAtTime(skidOn ? Math.min(0.25, v / 60) : 0, t, 0.05);
    // เสียงเตือนถอย
    if (s.v < -0.05) { st.revT += dt; if (st.revT > 0.9) { st.revT = 0; tone(1050, 0.45, 0.07); } } else st.revT = 0.85;
    // ไฟเลี้ยว ติ๊ก-ต็อก
    if (Math.abs(s.steer) > 6 * Math.PI / 180) { st.blinkT += dt; if (st.blinkT > 0.33) { st.blinkT = 0; tone(2200, 0.02, 0.05, "square"); } } else st.blinkT = 0;
    // แตร
    hornG.gain.setTargetAtTime(s.horn ? 0.16 : 0, t, 0.02);
    // ชน / พลิก
    if (s.ev.hits !== st.hits) { st.hits = s.ev.hits; crash(); }
    if (s.ev.rolls !== st.rolls) { st.rolls = s.ev.rolls; crash(); setTimeout(crash, 700); }
    // เซนเซอร์มุมอับ: บี๊บถี่ ๆ
    if (s.bsd) { st.bsdT += dt; if (st.bsdT > 0.22) { st.bsdT = 0; tone(1600, 0.08, 0.06, "sine"); } } else st.bsdT = 0.2;
  }
  return {
    update,
    resume() { if (ctx.state !== "running") ctx.resume(); },
    setOn(on) { st.on = on; master.gain.setTargetAtTime(on ? 0.55 : 0, ctx.currentTime, 0.05); if (on) ctx.resume(); },
    get on() { return st.on; }
  };
}
