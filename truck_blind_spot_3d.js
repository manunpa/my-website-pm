/* =====================================================================
   มุมมอง 3 มิติของตัวจำลองมุมอับ (โหลดเมื่อกดเปิดมุมมอง 3D เท่านั้น)
   - ใช้สถานะเดียวกับแผนที่ 2D (ตำแหน่งรถ วัตถุ ตารางมุมอับ) แค่วาดใหม่เป็น 3 มิติ
   - แกน: โลก 2D (x, y) → three.js (x, สูง, -y)
   - "ไล่ตามหลัง": ลากเมาส์เพื่อหมุนรอบรถ ล้อเมาส์ซูม
   - "มุมคนขับ": กล้องอยู่ที่ตาคนขับ (นั่งขวา) มีคอนโซล ประตู เสา A บังสายตาจริง + จอกระจกมองข้างซ้าย/ขวา
   - ม่านสีแดง = ขอบมุมอับ สูงเท่า "ความสูงวัตถุ" ที่ตั้งไว้ วัตถุที่เตี้ยกว่านี้ในม่านคนขับมองไม่เห็น
   ===================================================================== */
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

export function create3D(host, api) {
  const { S, P, G, HW, CELL, CROSS_X, EYE_H } = api;

  /* ---------------- renderer / scene ---------------- */
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.autoClear = false;
  renderer.domElement.style.cssText = "display:block;width:100%;height:100%;touch-action:none;cursor:grab";
  host.appendChild(renderer.domElement);

  const scene = new THREE.Scene();
  const DAY = { sky: 0xb9d3ee, fog: 0xc9dcef, hemi: 1.05, sun: 2.6, lamp: 0, head: 0, win: 0.0 };
  const NIGHT = { sky: 0x070c18, fog: 0x0a1020, hemi: 0.12, sun: 0.06, lamp: 45, head: 140, win: 1.2 };
  scene.fog = new THREE.Fog(DAY.fog, 160, 900);
  scene.background = new THREE.Color(DAY.sky);

  const hemi = new THREE.HemisphereLight(0xdfeaff, 0x5b5648, DAY.hemi);
  scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, DAY.sun);
  sun.castShadow = true;
  sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -55, right: 55, top: 55, bottom: -55, near: 1, far: 260 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.03;
  scene.add(sun, sun.target);

  const V = (x, y, h = 0) => new THREE.Vector3(x, h, -y);
  // ทุกวัสดุเป็นสองหน้า เพราะกล้องกระจกกลับซ้าย-ขวา (ด้านหน้า/หลังของหน้าตัดสลับกัน)
  const mat = (color, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.75, metalness: 0.05, side: THREE.DoubleSide }, o));
  const box = (w, h, d, m) => { const me = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), m); me.castShadow = true; me.receiveShadow = true; return me; };
  const rnd = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };

  /* ---------------- พื้นผิวถนน (texture วาดเอง) ---------------- */
  function canvasTex(w, h, draw, repeat) {
    const c = document.createElement("canvas"); c.width = w; c.height = h;
    draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c);
    t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    if (repeat) { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.repeat.set(repeat[0], repeat[1]); }
    return t;
  }
  function asphalt(g, w, h, seed) {
    g.fillStyle = "#4a4e53"; g.fillRect(0, 0, w, h);
    const r = rnd(seed);
    for (let i = 0; i < w * h / 18; i++) { const v = 60 + r() * 50; g.fillStyle = `rgba(${v},${v},${v + 4},${0.25 + r() * 0.35})`; g.fillRect(r() * w, r() * h, 1 + r() * 1.5, 1 + r() * 1.5); }
  }
  // ถนน 1 ช่วง = ยาว 6 ม. กว้าง 17 ม. (แถวบนสุดของภาพ = ขอบ y = +8.5)
  const roadTex = canvasTex(256, 724, (g, w, h) => {
    asphalt(g, w, h, 7);
    const Y = (y) => (8.5 - y) / 17 * h, px = w / 6;
    g.fillStyle = "#f3f3ee";
    [7, -7].forEach((y) => g.fillRect(0, Y(y) - 0.075 * px, w, 0.15 * px));
    [3.5, -3.5].forEach((y) => g.fillRect(0, Y(y) - 0.075 * px, 3 * px, 0.15 * px));
    g.fillStyle = "#f0c02c";
    [0.12, -0.12].forEach((y) => g.fillRect(0, Y(y) - 0.06 * px, w, 0.12 * px));
    // รอยล้อจาง ๆ
    g.fillStyle = "rgba(20,20,22,.18)";
    [5.25, 1.75, -1.75, -5.25].forEach((c) => [-0.95, 0.95].forEach((o) => g.fillRect(0, Y(c + o) - 0.3 * px, w, 0.6 * px)));
  }, [4000 / 6, 1]);
  const plainTex = canvasTex(256, 256, (g, w, h) => asphalt(g, w, h, 11), [6, 6]);
  const walkTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = "#c9c4b8"; g.fillRect(0, 0, w, h);
    const r = rnd(3);
    for (let i = 0; i < 4; i++) for (let j = 0; j < 4; j++) { const v = 190 + r() * 30; g.fillStyle = `rgb(${v},${v - 4},${v - 12})`; g.fillRect(i * 64 + 2, j * 64 + 2, 60, 60); }
  }, [1, 1]);
  const grassTex = canvasTex(512, 512, (g, w, h) => {
    g.fillStyle = "#7f8f68"; g.fillRect(0, 0, w, h);
    const r = rnd(5);
    for (let i = 0; i < 9000; i++) { g.fillStyle = `rgba(${70 + r() * 60},${90 + r() * 60},${50 + r() * 30},.5)`; g.fillRect(r() * w, r() * h, 2, 2); }
  }, [400, 400]);

  // พื้นดิน
  const ground = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), mat(0xffffff, { map: grassTex, roughness: 1 }));
  ground.rotation.x = -Math.PI / 2; ground.position.y = -0.02; ground.receiveShadow = true;
  scene.add(ground);
  // ถนนแนวนอน + แนวตั้ง (ใช้ texture เดียวกัน)
  const roadMat = mat(0xffffff, { map: roadTex, roughness: 0.92 });
  const road1 = new THREE.Mesh(new THREE.PlaneGeometry(4000, 17), roadMat);
  road1.rotation.x = -Math.PI / 2; road1.receiveShadow = true; scene.add(road1);
  const road2 = new THREE.Mesh(new THREE.PlaneGeometry(4000, 17), roadMat);
  road2.rotation.order = "YXZ"; road2.rotation.set(-Math.PI / 2, Math.PI / 2, 0); road2.position.set(CROSS_X, 0.004, 0);
  road2.receiveShadow = true; scene.add(road2);
  const cross = new THREE.Mesh(new THREE.PlaneGeometry(17, 17), mat(0xffffff, { map: plainTex, roughness: 0.92 }));
  cross.rotation.x = -Math.PI / 2; cross.position.set(CROSS_X, 0.008, 0); cross.receiveShadow = true; scene.add(cross);
  // ทางม้าลาย + เส้นหยุด
  const white = mat(0xf2f2ee, { roughness: 0.6 });
  const stripe = (x, y, w, d) => { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), white); m.rotation.x = -Math.PI / 2; m.position.copy(V(x, y, 0.012)); m.receiveShadow = true; scene.add(m); };
  for (let y = -7.5; y < 7.5; y += 1) { stripe(CROSS_X - 10.5, y + 0.25, 3, 0.5); stripe(CROSS_X + 10.5, y + 0.25, 3, 0.5); }
  for (let x = CROSS_X - 7.5; x < CROSS_X + 7.5; x += 1) { stripe(x + 0.25, 10.5, 0.5, 3); stripe(x + 0.25, -10.5, 0.5, 3); }
  stripe(CROSS_X - 12.6, 3.5, 0.4, 7); stripe(CROSS_X + 12.6, -3.5, 0.4, 7);
  // ทางเท้ายกสูง + ขอบคันหิน
  const walkMat = mat(0xffffff, { map: walkTex, roughness: 0.95 }), curbMat = mat(0xd9d6cf, { roughness: 0.8 });
  function walk(x1, x2, y1, y2) {
    const w = x2 - x1, d = y2 - y1;
    const m = box(w, 0.16, d, walkMat.clone());
    m.material.map = walkTex.clone(); m.material.map.needsUpdate = true; m.material.map.repeat.set(w / 2, d / 2);
    m.position.copy(V((x1 + x2) / 2, (y1 + y2) / 2, 0.08)); m.castShadow = false; scene.add(m);
  }
  const L = 2000, cx1 = CROSS_X - 8.5, cx2 = CROSS_X + 8.5;
  [[8.5, 11], [-11, -8.5]].forEach(([a, b]) => { walk(-L, cx1, a, b); walk(cx2, L, a, b); });
  [[cx1 - 2.5, cx1], [cx2, cx2 + 2.5]].forEach(([a, b]) => { walk(a, b, 11, L); walk(a, b, -L, -11); });
  [[8.5], [-8.5]].forEach(([y]) => {
    [[-L, cx1], [cx2, L]].forEach(([a, b]) => { const c = box(b - a, 0.2, 0.25, curbMat); c.position.copy(V((a + b) / 2, y + Math.sign(y) * 0.12, 0.1)); c.castShadow = false; scene.add(c); });
  });

  /* ---------------- ตึก ต้นไม้ เสาไฟ ---------------- */
  const winTex = canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = "#d9d6cf"; g.fillRect(0, 0, w, h);
    for (let y = 8; y < h; y += 32) for (let x = 8; x < w; x += 30) { g.fillStyle = "#3b4a5c"; g.fillRect(x, y, 18, 20); }
  }, [1, 1]);
  const winLit = canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
    const r = rnd(9);
    for (let y = 8; y < h; y += 32) for (let x = 8; x < w; x += 30) if (r() < 0.55) { g.fillStyle = r() < 0.5 ? "#ffd98a" : "#fff1c4"; g.fillRect(x, y, 18, 20); }
  }, [1, 1]);
  const PAL = [0xd8d2c4, 0xc7cbd1, 0xe2d6c2, 0xb9c2c9, 0xd6c9b6, 0xcfd6d9, 0xe8e2d6];
  const buildMats = [];
  function building(cx, cy, w, d, h, ci) {
    const m = mat(PAL[ci % PAL.length], { map: winTex.clone(), emissive: 0xffffff, emissiveMap: winLit.clone(), emissiveIntensity: 0, roughness: 0.85 });
    m.map.needsUpdate = m.emissiveMap.needsUpdate = true;
    m.map.repeat.set(Math.max(1, Math.round(w / 4)), Math.max(1, Math.round(h / 8)));
    m.emissiveMap.repeat.copy(m.map.repeat);
    buildMats.push(m);
    const b = box(w, h, d, m); b.position.copy(V(cx, cy, h / 2)); scene.add(b);
    const roof = box(w * 0.4, 1.4, d * 0.3, mat(0x9aa0a6)); roof.position.copy(V(cx + w * 0.15, cy, h + 0.7)); scene.add(roof);
  }
  const city = api.city;
  city.B.forEach((b) => building(b.x, b.y, b.w, b.d, b.h, b.c));
  const treePts = city.T;
  const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.2, 2.6, 8), mat(0x6b4f35), treePts.length);
  const crown = new THREE.InstancedMesh(new THREE.IcosahedronGeometry(1.9, 1), mat(0xffffff, { flatShading: true }), treePts.length);
  trunk.castShadow = crown.castShadow = true;
  const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3();
  treePts.forEach((t, i) => {
    const s = t.s;
    q.identity(); m4.compose(V(t.x, t.y, 1.3 * s), q, sc.set(s, s, s)); trunk.setMatrixAt(i, m4);
    q.setFromEuler(new THREE.Euler(0, t.s * 37, 0));
    m4.compose(V(t.x, t.y, 3.3 * s), q, sc.set(s, s * 1.05, s)); crown.setMatrixAt(i, m4);
    crown.setColorAt(i, new THREE.Color().setHSL(0.26 + (t.s - 0.8) * 0.12, 0.42, 0.26 + (t.s - 0.8) * 0.2));
  });
  scene.add(trunk, crown);
  // เสาไฟ + ไฟส่องถนนกลางคืน
  const lampMat = mat(0x4b5057, { metalness: 0.6, roughness: 0.4 });
  const bulbMat = mat(0xfff4d6, { emissive: 0xffe2a0, emissiveIntensity: 0 });
  const lamps = [];
  function lamp(x, y, dir, light) {
    const pole = box(0.18, 8, 0.18, lampMat); pole.position.copy(V(x, y, 4)); scene.add(pole);
    const arm = box(0.12, 0.12, 2.2, lampMat); arm.position.copy(V(x, y - dir * 1.1, 7.9)); scene.add(arm);
    const head = box(0.7, 0.18, 0.4, bulbMat); head.position.copy(V(x, y - dir * 2.2, 7.8)); scene.add(head);
    if (light) {
      const pl = new THREE.PointLight(0xffd9a0, 0, 32, 1.6); pl.position.copy(V(x, y - dir * 2.2, 7.4)); scene.add(pl); lamps.push(pl);
    }
  }
  api.city.Lm.forEach((l) => lamp(l.x, l.y, l.dir, l.light));

  /* ---------------- รถ ---------------- */
  const glass = mat(0x1d2a38, { metalness: 0.85, roughness: 0.08 });
  const dark = mat(0x22252a, { roughness: 0.6 });
  const tireMat = mat(0x141516, { roughness: 0.9 });
  const rimMat = mat(0xb8bec4, { metalness: 0.8, roughness: 0.3 });
  const CAR_COLORS = [0xd94a3d, 0xf2f2f2, 0x2d2f33, 0x3a72c9, 0x9aa1a8, 0xe0b23a, 0x1f6f5c];
  let rig = null;

  function wheel(r = 0.52, w = 0.3) {
    const g = new THREE.Group();
    const t = new THREE.Mesh(new THREE.CylinderGeometry(r, r, w, 24), tireMat); t.rotation.x = Math.PI / 2; t.castShadow = true;
    const h = new THREE.Mesh(new THREE.CylinderGeometry(r * 0.55, r * 0.55, w + 0.02, 12), rimMat); h.rotation.x = Math.PI / 2;
    const spoke = box(r * 1.0, 0.08, w + 0.03, rimMat);
    g.add(t, h, spoke); g.userData.spoke = spoke;
    return g;
  }
  function carMesh(len, colorIdx) {
    const g = new THREE.Group(), c = CAR_COLORS[colorIdx % CAR_COLORS.length];
    const body = box(len, 0.7, 1.75, mat(c, { metalness: 0.55, roughness: 0.3 })); body.position.y = 0.55;
    const cab = box(len * 0.5, 0.55, 1.55, glass); cab.position.set(-len * 0.05, 1.15, 0);
    const roof = box(len * 0.42, 0.06, 1.5, mat(c, { metalness: 0.55, roughness: 0.3 })); roof.position.set(-len * 0.05, 1.44, 0);
    g.add(body, cab, roof);
    [[len * 0.33, 0.8], [len * 0.33, -0.8], [-len * 0.3, 0.8], [-len * 0.3, -0.8]].forEach(([x, z]) => { const w = wheel(0.33, 0.22); w.position.set(x, 0.33, z); g.add(w); });
    return g;
  }
  function light(color, w, h, d) { const m = mat(color, { emissive: color, emissiveIntensity: 0.25 }); return box(w, h, d, m); }

  function buildUnit(u, idx) {
    const d = u.def, g = new THREE.Group(), info = { g, wheels: [], steer: [], brake: [], turnL: [], turnR: [], rev: [], cabParts: [], interior: null, heads: [] };
    // ล้อ
    d.axles.forEach((a) => {
      const zs = a.dual ? [HW - 0.17, HW - 0.52, -HW + 0.17, -HW + 0.52] : [HW - 0.2, -HW + 0.2];
      zs.forEach((y) => {
        const w = wheel(); const holder = new THREE.Group(); holder.add(w);
        holder.position.set(a.x, 0.52, -y); g.add(holder);
        info.wheels.push(w); if (a.steer) info.steer.push(holder);
      });
    });
    d.parts.forEach((p) => {
      const len = (p.x2 - p.x1) || 0, cx = (p.x1 + p.x2) / 2;
      if (p.t === "chassis") { const m = box(len, 0.35, p.hw * 2, dark); m.position.set(cx, 0.95, 0); g.add(m); }
      if (p.t === "fifth") { const m = new THREE.Mesh(new THREE.CylinderGeometry(0.6, 0.6, 0.12, 24), mat(0x6b6f75, { metalness: 0.7 })); m.position.set(p.x, 1.2, 0); m.castShadow = true; g.add(m); }
      if (p.t === "tank") {
        const tm = mat(0xe4e8eb, { metalness: 0.75, roughness: 0.22 });
        const cyl = new THREE.Mesh(new THREE.CylinderGeometry(1.18, 1.18, len - 0.4, 40), tm); cyl.rotation.z = Math.PI / 2; cyl.position.set(cx, 2.05, 0); cyl.castShadow = cyl.receiveShadow = true; g.add(cyl);
        [p.x1 + 0.2, p.x2 - 0.2].forEach((x, k) => { const cap = new THREE.Mesh(new THREE.SphereGeometry(1.18, 32, 16, 0, Math.PI * 2, 0, Math.PI / 2), tm); cap.scale.set(1, 0.3, 1); cap.rotation.z = k ? -Math.PI / 2 : Math.PI / 2; cap.position.set(x, 2.05, 0); cap.castShadow = true; g.add(cap); });
        [1.19, -1.19].forEach((z) => { const s = box(len * 0.92, 0.22, 0.03, mat(0x6cb200, { roughness: 0.5 })); s.position.set(cx, 1.65, z); g.add(s); });
        const walkway = box(len * 0.85, 0.06, 0.55, mat(0x9aa3ab, { metalness: 0.6 })); walkway.position.set(cx, 3.26, 0); g.add(walkway);
        for (let x = p.x1 + 1.4; x < p.x2 - 0.8; x += 2.3) { const mh = new THREE.Mesh(new THREE.CylinderGeometry(0.3, 0.3, 0.12, 16), mat(0x8c949b, { metalness: 0.7 })); mh.position.set(x, 3.28, 0); g.add(mh); }
        const rails = box(len * 0.85, 0.05, 0.05, mat(0xc9ced3)); rails.position.set(cx, 3.55, 0.35); g.add(rails);
        const skirt = box(len * 0.9, 0.5, 2.3, dark); skirt.position.set(cx, 0.95, 0); g.add(skirt);
      }
      if (p.t === "deck") {
        const frame = mat(0xe8eaec, { metalness: 0.5, roughness: 0.35 }), red = mat(0xc8392f, { roughness: 0.5 });
        [1.05, 2.45].forEach((h) => [HW - 0.06, -HW + 0.06].forEach((z) => { const r = box(len, 0.14, 0.12, h > 2 ? red : frame); r.position.set(cx, h, -z); g.add(r); }));
        for (let x = p.x1 + 0.2; x <= p.x2; x += 2.3) [HW - 0.06, -HW + 0.06].forEach((z) => { const post = box(0.12, 2.6, 0.12, frame); post.position.set(x, 1.65, -z); g.add(post); });
        const floor = box(len, 0.08, 2.3, mat(0x6b6f75, { metalness: 0.4 })); floor.position.set(cx, 0.98, 0); g.add(floor);
        const n = p.cars, cl = Math.min(p.carLen || 99, (len - 0.3) / n - 0.15), gap = (len - n * cl) / (n + 1);
        for (let i = 0; i < n; i++) {
          const x = p.x2 - gap - (i + 0.5) * cl - i * gap;
          const lo = carMesh(cl, idx * 3 + i); lo.position.set(x, 1.05, 0); g.add(lo);
          const up = carMesh(cl, idx * 3 + i + 3); up.position.set(x - 0.2, 2.52, 0); g.add(up);
        }
        const skirt = box(len, 0.4, 2.2, dark); skirt.position.set(cx, 0.8, 0); g.add(skirt);
      }
      if (p.t === "rackcar") {
        const c = carMesh(len, 4); c.position.set(cx, 3.2, 0); g.add(c);
        [HW - 0.06, -HW + 0.06].forEach((z) => { const r = box(len + 0.4, 0.12, 0.12, mat(0xc8392f)); r.position.set(cx, 3.18, -z); g.add(r); });
      }
      if (p.t === "drawbar") {
        const a = new THREE.Vector3(p.x1, 0.85, 0.8), b = new THREE.Vector3(p.x2, 0.85, 0), c = new THREE.Vector3(p.x1, 0.85, -0.8);
        [[a, b], [c, b]].forEach(([s, e]) => { const l = s.distanceTo(e); const m = box(l, 0.14, 0.14, dark); m.position.copy(s).add(e).multiplyScalar(0.5); m.rotation.y = -Math.atan2(e.z - s.z, e.x - s.x); g.add(m); });
      }
    });
    // ไฟท้าย / ไฟถอย ทุกคันที่มีตัวถัง
    if (d.front != null) {
      [1.0, -1.0].forEach((z) => {
        const b = light(0xff2a2a, 0.06, 0.18, 0.3); b.position.set(d.rear - 0.02, 1.05, z); g.add(b); info.brake.push(b);
        const r = light(0xffffff, 0.06, 0.12, 0.2); r.position.set(d.rear - 0.02, 0.85, z * 0.7); g.add(r); info.rev.push(r);
        const t = light(0xffa000, 0.06, 0.12, 0.2); t.position.set(d.rear - 0.02, 1.28, z); g.add(t); (z > 0 ? info.turnL : info.turnR).push(t);
      });
    }
    if (d.kind === "truck") {
      const cf = d.cabFront, cb = d.cabBack, cl = cf - cb, cm = mat(d.color, { metalness: 0.35, roughness: 0.35 });
      const parts = [];
      const lower = box(cl, 0.75, 2.5, cm); lower.position.set(cb + cl / 2, 1.15, 0); parts.push(lower);
      const upper = box(cl - 0.15, 1.45, 2.46, cm); upper.position.set(cb + cl / 2 - 0.07, 2.35, 0); parts.push(upper);
      const roof = box(cl - 0.5, 0.35, 2.3, cm); roof.position.set(cb + cl / 2 - 0.3, 3.2, 0); parts.push(roof);
      const ws = box(0.06, 1.0, 2.3, glass); ws.position.set(cf - 0.1, 2.45, 0); parts.push(ws);
      [1.24, -1.24].forEach((z) => { const sw = box(1.1, 0.85, 0.04, glass); sw.position.set(cf - 0.75, 2.5, z); parts.push(sw); });
      const bumper = box(0.3, 0.45, 2.5, dark); bumper.position.set(cf + 0.05, 0.75, 0); parts.push(bumper);
      const grill = box(0.05, 0.5, 1.5, dark); grill.position.set(cf - 0.06, 1.35, 0); parts.push(grill);
      [0.9, -0.9].forEach((z) => {
        const hl = light(0xfff6dd, 0.06, 0.22, 0.45); hl.position.set(cf - 0.04, 1.05, z); parts.push(hl); info.heads.push(hl);
        const t = light(0xffa000, 0.06, 0.14, 0.2); t.position.set(cf - 0.03, 1.32, z * 1.25); parts.push(t); (z > 0 ? info.turnL : info.turnR).push(t);
      });
      parts.forEach((m) => g.add(m)); info.cabParts = parts;
      // กระจกมองข้าง
      P.mirrors.forEach((m) => {
        const arm = box(0.06, 0.06, 0.45, dark); arm.position.set(m.lx + 0.08, 2.35, -m.side * (HW + 0.12)); g.add(arm);
        const head = box(0.12, 0.55, 0.28, dark); head.position.set(m.lx, 2.3, -m.ly); g.add(head);
        const face = box(0.02, 0.48, 0.22, mat(0xbfd4e6, { metalness: 1, roughness: 0.05 })); face.position.set(m.lx - 0.07, 2.3, -m.ly); g.add(face);
      });
      // ภายในห้องโดยสาร (เห็นเฉพาะมุมคนขับ): คอนโซล ประตู เสา A หลังคา ผนังหลัง พวงมาลัย
      const inside = new THREE.Group(), im = mat(0x2b2e33, { roughness: 0.9 }), trim = mat(0x3b3f45, { roughness: 0.8 });
      const dash = box(0.75, 1.85 - 1.0, 2.4, im); dash.position.set(cf - 0.45, 1.0 + (1.85 - 1.0) / 2, 0); inside.add(dash);
      const dashTop = box(0.5, 0.05, 2.4, trim); dashTop.position.set(cf - 0.55, 1.86, 0); inside.add(dashTop);
      const doorL = box(cl, 1.95, 0.1, im); doorL.position.set(cb + cl / 2, 1.95 / 2, -(HW - 0.05)); inside.add(doorL);
      const doorR = box(cl, 1.9, 0.1, im); doorR.position.set(cb + cl / 2, 1.9 / 2, (HW - 0.05)); inside.add(doorR);
      [HW - 0.08, -HW + 0.08].forEach((z) => { const a = box(0.14, 1.25, 0.14, trim); a.position.set(cf - 0.12, 1.85 + 0.62, -z); inside.add(a); });
      const top = box(cl, 0.1, 2.5, im); top.position.set(cb + cl / 2, 3.05, 0); inside.add(top);
      const visor = box(0.35, 0.18, 2.4, trim); visor.position.set(cf - 0.3, 2.92, 0); inside.add(visor);
      const back = box(0.1, 3.1, 2.5, im); back.position.set(cb + 0.05, 1.55, 0); inside.add(back);
      const wheelHold = new THREE.Group(); wheelHold.position.set(P.eyeL[0] + 0.55, 1.95, -P.eyeL[1]); wheelHold.rotation.set(0, Math.PI / 2, 0); wheelHold.rotateX(-0.5);
      const wheelS = new THREE.Mesh(new THREE.TorusGeometry(0.24, 0.035, 10, 32), mat(0x1a1b1d));
      const hub = box(0.36, 0.05, 0.05, mat(0x1a1b1d)); wheelS.add(hub);
      wheelHold.add(wheelS); inside.add(wheelHold);
      // จอความเร็วดิจิทัลบนคอนโซล
      const dc = document.createElement("canvas"); dc.width = 256; dc.height = 128;
      const dtex = new THREE.CanvasTexture(dc); dtex.colorSpace = THREE.SRGBColorSpace;
      const disp = new THREE.Mesh(new THREE.PlaneGeometry(0.42, 0.21), new THREE.MeshBasicMaterial({ map: dtex, toneMapped: false }));
      disp.position.set(cf - 0.73, 1.83, -P.eyeL[1]); disp.rotation.set(0, -Math.PI / 2, 0); disp.rotateX(-0.35);
      inside.add(disp); info.dash = { c: dc, tex: dtex, last: "" };
      inside.visible = false; g.add(inside); info.interior = inside; info.steeringWheel = wheelS;
      // ไฟหน้า (กลางคืน)
      info.spots = [0.9, -0.9].map((z) => {
        const s = new THREE.SpotLight(0xfff3d6, 0, 70, 0.42, 0.55, 1.3);
        s.position.set(cf + 0.1, 1.05, z); s.target.position.set(cf + 25, 0, z * 0.6);
        g.add(s, s.target); return s;
      });
    }
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    return info;
  }
  function ensureRig() {
    if (rig && rig.key === S.rigKey && rig.units === S.units) return;
    if (rig) { scene.remove(rig.root); rig.root.traverse((o) => { if (o.geometry) o.geometry.dispose(); }); }
    const root = new THREE.Group();
    const parts = S.units.map((u, i) => { const info = buildUnit(u, i); root.add(info.g); return info; });
    scene.add(root);
    rig = { key: S.rigKey, units: S.units, root, parts, spin: 0 };
  }

  /* ---------------- วัตถุบนถนน ---------------- */
  const objMeshes = new Map();
  const skin = mat(0xf2c9a0), redGlow = mat(0xe5484d, { emissive: 0xe5484d, emissiveIntensity: 0.6 });
  function objMesh(o) {
    const g = new THREE.Group(), body = mat(0x3b6fd8, { roughness: 0.5 });
    if (o.t === "ped") {
      const legs = box(0.28, 0.85, 0.22, mat(0x2d3a52)); legs.position.y = 0.43;
      const torso = box(0.42, 0.6, 0.26, body); torso.position.y = 1.15;
      const head = new THREE.Mesh(new THREE.SphereGeometry(0.13, 16, 12), skin); head.position.y = 1.58;
      g.add(legs, torso, head);
    } else if (o.t === "moto") {
      const frame = box(1.7, 0.35, 0.3, mat(0x222428, { metalness: 0.5 })); frame.position.y = 0.6;
      [0.7, -0.7].forEach((x) => { const w = wheel(0.32, 0.12); w.position.set(x, 0.32, 0); g.add(w); });
      const tank = box(0.6, 0.25, 0.35, body); tank.position.set(0.15, 0.85, 0);
      const rider = box(0.35, 0.6, 0.42, body); rider.position.set(-0.15, 1.15, 0);
      const helmet = new THREE.Mesh(new THREE.SphereGeometry(0.17, 16, 12), mat(0xf2f2f2, { metalness: 0.3 })); helmet.position.set(-0.05, 1.55, 0);
      g.add(frame, tank, rider, helmet);
    } else {
      const c = carMesh(4.4, 3); g.add(c);
      c.traverse((m) => { if (m.isMesh && m.material.color && m.material.color.getHex() === CAR_COLORS[3]) m.material = body; });
    }
    const ring = new THREE.Mesh(new THREE.RingGeometry(Math.max(0.6, OBJ_R[o.t]), Math.max(0.6, OBJ_R[o.t]) + 0.18, 40), redGlow);
    ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; g.add(ring);
    g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
    g.userData = { body, ring };
    scene.add(g);
    return g;
  }
  const OBJ_R = { ped: 0.6, moto: 1.3, car: 2.6 };
  function syncObjects(states, t) {
    const alive = new Set();
    S.objects.forEach((o, i) => {
      let g = objMeshes.get(o);
      if (!g) { g = objMesh(o); objMeshes.set(o, g); }
      alive.add(o);
      g.position.copy(V(o.x, o.y, 0)); g.rotation.y = o.th;
      const st = states[i], b = g.userData.body;
      b.color.setHex(st === "seen" ? 0x3b6fd8 : st === "hit" ? 0x777777 : 0xe5484d);
      b.emissive.setHex(st === "blind" ? 0xe5484d : 0x000000);
      b.emissiveIntensity = st === "blind" ? 0.4 + 0.4 * Math.sin(t * 6) : 0;
      g.userData.ring.visible = st !== "seen";
      g.userData.ring.scale.setScalar(1 + 0.08 * Math.sin(t * 6));
    });
    objMeshes.forEach((g, o) => { if (!alive.has(o)) { scene.remove(g); objMeshes.delete(o); } });
  }

  /* ---------------- พื้นที่มุมอับบนพื้น + ม่านแดง ---------------- */
  let gridTex = null, gridKey = "";
  const gridMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, toneMapped: false, side: THREE.DoubleSide, polygonOffset: true, polygonOffsetFactor: -2 });
  const gridPlane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), gridMat);
  gridPlane.rotation.x = -Math.PI / 2; gridPlane.renderOrder = 2; scene.add(gridPlane);
  const MAXSEG = 12000;
  const curtainGeo = new THREE.BufferGeometry();
  curtainGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAXSEG * 18), 3));
  curtainGeo.setAttribute("alpha", new THREE.BufferAttribute(new Float32Array(MAXSEG * 6), 1));
  const curtainMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, side: THREE.DoubleSide,
    vertexShader: "attribute float alpha; varying float vA; void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }",
    fragmentShader: "varying float vA; void main(){ gl_FragColor = vec4(0.9, 0.2, 0.22, vA); }"
  });
  const curtain = new THREE.Mesh(curtainGeo, curtainMat); curtain.frustumCulled = false; curtain.renderOrder = 3; scene.add(curtain);
  const edgeGeo = new THREE.BufferGeometry();
  edgeGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(MAXSEG * 6), 3));
  const edge = new THREE.LineSegments(edgeGeo, new THREE.LineBasicMaterial({ color: 0xff4d55, transparent: true, opacity: 0.95 }));
  edge.frustumCulled = false; edge.renderOrder = 4; scene.add(edge);

  function updateBlind(show) {
    gridPlane.visible = curtain.visible = edge.visible = show;
    if (!show || !G.nx) return;
    const key = G.nx + "x" + G.ny;
    if (key !== gridKey) {
      if (gridTex) gridTex.dispose();
      gridTex = new THREE.CanvasTexture(G.off); gridTex.colorSpace = THREE.SRGBColorSpace;
      gridTex.minFilter = THREE.LinearFilter; gridMat.map = gridTex; gridMat.needsUpdate = true; gridKey = key;
    }
    gridTex.needsUpdate = true;
    const w = G.nx * CELL, h = G.ny * CELL;
    gridPlane.scale.set(w, h, 1);
    gridPlane.position.copy(V(G.minX + w / 2, G.maxY - h / 2, 0.19));
    const segs = api.blindOutline(), n = Math.min(MAXSEG, segs.length / 2), H = S.opts.objH;
    const pos = curtainGeo.attributes.position.array, al = curtainGeo.attributes.alpha.array, ep = edgeGeo.attributes.position.array;
    const X = (i) => G.minX + (i + 0.5) * CELL, Z = (j) => -(G.maxY - (j + 0.5) * CELL);
    for (let k = 0; k < n; k++) {
      const a = segs[k * 2], b = segs[k * 2 + 1];
      const ax = X(a[0]), az = Z(a[1]), bx = X(b[0]), bz = Z(b[1]), o = k * 18;
      pos.set([ax, 0.05, az, bx, 0.05, bz, bx, H, bz, ax, 0.05, az, bx, H, bz, ax, H, az], o);
      al.set([0.42, 0.42, 0.04, 0.42, 0.04, 0.04], k * 6);
      ep.set([ax, H, az, bx, H, bz], k * 6);
    }
    curtainGeo.setDrawRange(0, n * 6); curtainGeo.attributes.position.needsUpdate = true; curtainGeo.attributes.alpha.needsUpdate = true;
    edgeGeo.setDrawRange(0, n * 2); edgeGeo.attributes.position.needsUpdate = true;
  }

  /* ---------------- ระยะเบรก + โซนอันตราย + ป้ายตัวเลข ----------------
   เหมือนในแผนที่ 2D: เส้นส้ม = จุดเริ่มเบรก เส้นแดง = จุดหยุดสนิท กรอบส้ม = โซนอันตรายตามความเร็ว
   ป้ายตัวเลขอยู่บนชั้น 1 (กล้องหลักเห็น กล้องกระจกมองข้างไม่เห็น) */
  const LABEL_LAYER = 1;
  function makeLabel() {
    const c = document.createElement("canvas"), g = c.getContext("2d");
    const tex = new THREE.CanvasTexture(c); tex.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, depthTest: false, depthWrite: false, sizeAttenuation: false, transparent: true, opacity: 0.88 }));
    sp.renderOrder = 20; sp.layers.set(LABEL_LAYER); sp.visible = false; scene.add(sp);
    let last = "";
    return {
      sp,
      set(text, bg, fg) {
        const key = text + bg + fg;
        if (key !== last) {
          last = key;
          const font = "600 30px 'IBM Plex Sans Thai', system-ui, sans-serif";
          g.font = font; const w = Math.ceil(g.measureText(text).width) + 36, h = 50;
          c.width = w; c.height = h;
          g.font = font; g.fillStyle = bg;
          g.beginPath(); g.roundRect(1, 1, w - 2, h - 2, 24); g.fill();
          g.fillStyle = fg; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, w / 2, h / 2 + 1);
          tex.dispose(); tex.image = c; tex.needsUpdate = true;
          sp.userData.aspect = w / h;
        }
        // สูงคงที่ราว 19 พิกเซลบนจอ ไม่ว่าจอใหญ่หรือเล็ก
        const hgt = 19 * 2 / (H * cam.projectionMatrix.elements[5]); sp.scale.set(hgt * sp.userData.aspect, hgt, 1);
        sp.visible = true;
      }
    };
  }
  const labelPool = [];
  let labelUsed = 0;
  function label(pos, text, bg = "rgba(232,137,12,.62)", fg = "#fff") {
    if (labelUsed >= labelPool.length) labelPool.push(makeLabel());
    const l = labelPool[labelUsed++]; l.sp.position.copy(pos); l.set(text, bg, fg);
  }
  // เส้นจุดเบรก/หยุด: แถบบนพื้น + เสาเล็ก ๆ ให้เห็นจากไกล
  function marker(color) {
    const g = new THREE.Group();
    const bar = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.06, 1), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
    bar.position.y = 0.22; g.add(bar);
    [1, -1].forEach((k) => {
      const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.6, 8), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
      post.position.set(0, 0.8, 0); post.userData.side = k; g.add(post);
    });
    g.visible = false; scene.add(g); g.userData.bar = bar;
    return g;
  }
  const mBrake = marker(0xf0a000), mStop = marker(0xe5484d);
  function placeMarker(g, wx, wy, th, width) {
    g.visible = true; g.position.copy(V(wx, wy, 0)); g.rotation.y = th;
    g.userData.bar.scale.z = width;
    g.children.forEach((c) => { if (c.userData.side) c.position.z = c.userData.side * width / 2; });
  }
  // โซนอันตราย: แถบส้มโปร่งตามเส้นทาง (สร้าง geometry ใหม่ทุกเฟรม) + ขอบ
  const ZMAX = 30000;
  const zoneGeo = new THREE.BufferGeometry();
  zoneGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(ZMAX * 3), 3));
  const zoneMeshAll = new THREE.Mesh(zoneGeo, new THREE.MeshBasicMaterial({ color: 0xe8890c, transparent: true, opacity: 0.17, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
  zoneMeshAll.frustumCulled = false; zoneMeshAll.renderOrder = 5; scene.add(zoneMeshAll);
  const zoneEdgeGeo = new THREE.BufferGeometry();
  zoneEdgeGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(ZMAX * 3), 3));
  const zoneEdge = new THREE.LineSegments(zoneEdgeGeo, new THREE.LineBasicMaterial({ color: 0xffa024, transparent: true, opacity: 0.95, toneMapped: false }));
  zoneEdge.frustumCulled = false; zoneEdge.renderOrder = 6; scene.add(zoneEdge);
  // เส้นทางล่วงหน้า (เส้นประแดงบนพื้น)
  const pathGeo = new THREE.BufferGeometry();
  pathGeo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3000 * 3), 3));
  const pathLine = new THREE.LineSegments(pathGeo, new THREE.LineBasicMaterial({ color: 0xff5a5f, transparent: true, opacity: 0.8, toneMapped: false }));
  pathLine.frustumCulled = false; pathLine.renderOrder = 6; scene.add(pathLine);
  function buildZones(shapes) {
    const pos = zoneGeo.attributes.position.array, ep = zoneEdgeGeo.attributes.position.array;
    let n = 0, e = 0;
    const Y = 0.21;
    const put = (arr, i, p) => { arr[i] = p[0]; arr[i + 1] = Y; arr[i + 2] = -p[1]; };
    shapes.forEach((z) => {
      for (let i = 0; i + 1 < z.L.length && n + 18 <= ZMAX * 3; i++) {
        const a = z.L[i], b = z.L[i + 1], c = z.R[i + 1], d = z.R[i];
        [a, b, c, a, c, d].forEach((p) => { put(pos, n, p); n += 3; });
        if (e + 12 <= ZMAX * 3) { put(ep, e, a); put(ep, e + 3, b); put(ep, e + 6, d); put(ep, e + 9, c); e += 12; }
      }
      const k = z.L.length - 1;
      [[z.L[0], z.R[0]], [z.L[k], z.R[k]]].forEach(([p, q]) => { if (e + 6 <= ZMAX * 3) { put(ep, e, p); put(ep, e + 3, q); e += 6; } });
    });
    zoneGeo.setDrawRange(0, n / 3); zoneGeo.attributes.position.needsUpdate = true;
    zoneEdgeGeo.setDrawRange(0, e / 3); zoneEdgeGeo.attributes.position.needsUpdate = true;
  }
  function updateOverlays() {
    labelUsed = 0;
    const truck = S.units[0], v = Math.max(0, S.v);
    // เส้นเบรก/หยุดรถ — วางตามเส้นทางโค้งที่รถกำลังจะวิ่งไป
    const pp = pathGeo.attributes.position.array;
    let pn = 0;
    if (v >= 2) {
      const sd = api.stopDistance(v), pr = api.predictFront(sd.r), pt = api.predictFront(sd.total);
      const fz = S.zoneStats && S.zoneStats.front;
      placeMarker(mBrake, pr.x, pr.y, pr.th, 3.6);
      placeMarker(mStop, pt.x, pt.y, pt.th, 3.6);
      const off = (p, k, h) => V(p.x - Math.sin(p.th) * k, p.y + Math.cos(p.th) * k, h);
      // ป้ายเบรกไว้ซ้ายของเส้น ป้ายหยุดไว้ขวาและสูงกว่า — มองจากที่นั่งคนขับจะไม่ทับกัน
      label(off(pr, 2.6, 1.9), "เริ่มเบรก " + sd.r.toFixed(0) + " ม.", "rgba(214,138,0,.62)");
      label(off(pt, -2.6, 3.1), "หยุดสนิท " + sd.total.toFixed(0) + " ม." + (fz ? " · มองไม่เห็น " + Math.round(fz.pct) + "%" : ""), "rgba(229,72,77,.62)");
      for (let d = 0; d + 1 <= sd.total && pn + 6 <= pp.length; d += 2) {
        const a = api.predictFront(d), b = api.predictFront(d + 1);
        pp.set([a.x, 0.24, -a.y, b.x, 0.24, -b.y], pn); pn += 6;
      }
    } else { mBrake.visible = mStop.visible = false; }
    pathGeo.setDrawRange(0, pn / 3); pathGeo.attributes.position.needsUpdate = true;
    // โซนอันตราย
    const shapes = api.zoneRects(), st = S.zoneStats || {};
    buildZones(shapes);
    shapes.forEach((z) => {
      const a = st[z.key];
      if (a && (z.key === "rear" || z.tail)) {
        const name = z.key === "rear" ? "เว้นท้าย 2 วิ " + a.len.toFixed(0) + " ม." : z.key === "left" ? "รถแซงซ้าย" : "รถแซงขวา";
        label(V(z.far[0], z.far[1], 1.8), name + " · มองไม่เห็น " + Math.round(a.pct) + "%");
      }
    });
    // ขนาดพื้นที่มุมอับแต่ละก้อน
    (G.regions || []).forEach((r) => {
      label(V(r.x, r.y, S.opts.objH + 0.6), "≈ " + (r.area < 10 ? r.area.toFixed(1) : Math.round(r.area)) + " ตร.ม.", "rgba(229,72,77,.62)");
    });
    for (let i = labelUsed; i < labelPool.length; i++) labelPool[i].sp.visible = false;
  }

  /* ---------------- กล้อง ---------------- */
  const cam = new THREE.PerspectiveCamera(55, 1, 0.08, 3000);
  cam.layers.enable(LABEL_LAYER);
  const mirrorCams = P.mirrors.map(() => new THREE.PerspectiveCamera(40, 0.6, 0.1, 400));
  const view = { mode: "chase", yaw: 0, pitch: 0.62, dist: 34, lookYaw: 0, lookPitch: -0.1, camPos: null, camTgt: null };
  let night = false;

  function setNight(on) {
    night = on;
    const k = on ? NIGHT : DAY;
    scene.background.setHex(k.sky); scene.fog.color.setHex(k.fog);
    hemi.intensity = k.hemi; sun.intensity = k.sun;
    lamps.forEach((l) => { l.intensity = k.lamp; });
    bulbMat.emissiveIntensity = on ? 2.5 : 0;
    buildMats.forEach((m) => { m.emissiveIntensity = k.win; });
  }

  // ลากเมาส์: หมุนกล้อง (ไล่หลัง) หรือหันหน้ามอง (มุมคนขับ) · คลิกเฉย ๆ = วางวัตถุ
  let drag = null;
  const el = renderer.domElement;
  el.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY, moved: false, btn: e.button, shift: e.shiftKey }; el.setPointerCapture(e.pointerId); el.style.cursor = "grabbing"; });
  el.addEventListener("pointermove", (e) => {
    if (!drag) return;
    const dx = e.clientX - drag.x, dy = e.clientY - drag.y;
    if (Math.abs(dx) + Math.abs(dy) > 3) drag.moved = true;
    drag.x = e.clientX; drag.y = e.clientY;
    if (view.mode === "chase") { view.yaw -= dx * 0.006; view.pitch = Math.max(0.08, Math.min(1.45, view.pitch + dy * 0.005)); }
    else { view.lookYaw = Math.max(-2.6, Math.min(2.6, view.lookYaw - dx * 0.004)); view.lookPitch = Math.max(-0.9, Math.min(0.6, view.lookPitch - dy * 0.004)); }
  });
  el.addEventListener("pointerup", (e) => {
    el.style.cursor = "grab";
    if (drag && !drag.moved) {
      const r = el.getBoundingClientRect(), ndc = new THREE.Vector2((e.clientX - r.left) / r.width * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      const ray = new THREE.Raycaster(); ray.setFromCamera(ndc, cam);
      const hit = new THREE.Vector3();
      if (ray.ray.intersectPlane(new THREE.Plane(new THREE.Vector3(0, 1, 0), 0), hit)) api.placeAt(hit.x, -hit.z, drag.btn === 2 || drag.shift);
    }
    drag = null;
  });
  el.addEventListener("contextmenu", (e) => e.preventDefault());
  el.addEventListener("wheel", (e) => {
    e.preventDefault();
    if (view.mode === "chase") view.dist = Math.max(8, Math.min(160, view.dist * Math.exp(e.deltaY * 0.0012)));
    else cam.fov = Math.max(35, Math.min(95, cam.fov + e.deltaY * 0.03));
  }, { passive: false });

  function setMode(m) {
    view.mode = m; view.camPos = null;
    if (m === "driver") { view.lookYaw = 0; view.lookPitch = -0.1; cam.fov = 72; } else cam.fov = 55;
  }

  /* ---------------- เฟรม ---------------- */
  let W = 1, H = 1;
  function resize() {
    const r = host.getBoundingClientRect();
    W = Math.max(1, r.width); H = Math.max(1, r.height);
    renderer.setSize(W, H, false);
  }
  resize();

  function render(dt, states, showBlind) {
    ensureRig();
    const t = performance.now() / 1000, truck = S.units[0], d = truck.def;
    const braking = S.brakeA > 0.05, reversing = S.v < -0.05, blink = Math.sin(t * 9.5) > 0;
    const turn = Math.abs(S.steer) > 6 * Math.PI / 180 ? Math.sign(S.steer) : 0;
    rig.spin += S.v * dt / 0.52;
    rig.parts.forEach((info, i) => {
      const u = S.units[i];
      info.g.position.copy(V(u.x, u.y, 0)); info.g.rotation.y = u.th;
      info.steer.forEach((h) => { h.rotation.y = S.steer; });
      info.wheels.forEach((w) => { w.rotation.z = -rig.spin; });
      info.brake.forEach((b) => { b.material.emissiveIntensity = braking ? 4 : night ? 1.2 : 0.25; });
      info.rev.forEach((b) => { b.material.emissiveIntensity = reversing ? 3 : 0; });
      info.turnL.forEach((b) => { b.material.emissiveIntensity = turn > 0 && blink ? 4 : 0.15; });
      info.turnR.forEach((b) => { b.material.emissiveIntensity = turn < 0 && blink ? 4 : 0.15; });
      info.heads.forEach((b) => { b.material.emissiveIntensity = night ? 4 : 0.4; });
      if (info.spots) info.spots.forEach((s) => { s.intensity = night ? NIGHT.head : 0; });
      const inCab = view.mode === "driver" && i === 0;
      info.cabParts.forEach((m) => { m.visible = !inCab; });
      if (info.interior) {
        info.interior.visible = inCab; info.steeringWheel.rotation.z = S.steer * 20 / 8;
        const kmh = Math.round(Math.abs(S.v) * 3.6), gear = S.v < -0.05 ? "R" : S.v > 0.05 ? "D" : "N", key = kmh + gear + (braking ? "B" : "");
        if (inCab && key !== info.dash.last) {
          info.dash.last = key;
          const g2 = info.dash.c.getContext("2d");
          g2.fillStyle = "#05070a"; g2.fillRect(0, 0, 256, 128);
          g2.fillStyle = "#7df3ff"; g2.font = "700 74px system-ui, sans-serif"; g2.textAlign = "right"; g2.textBaseline = "middle"; g2.fillText(kmh, 170, 58);
          g2.font = "600 22px system-ui, sans-serif"; g2.fillStyle = "#9fb3c8"; g2.textAlign = "left"; g2.fillText("km/h", 178, 74);
          g2.font = "700 30px system-ui, sans-serif"; g2.fillStyle = gear === "R" ? "#ffffff" : "#ffd54a"; g2.fillText(gear, 190, 36);
          if (braking) { g2.fillStyle = "#ff3b3b"; g2.fillRect(14, 104, 228, 12); }
          info.dash.tex.needsUpdate = true;
        }
      }
    });
    syncObjects(states, t);
    updateBlind(showBlind);
    updateOverlays();

    // ดวงอาทิตย์ตามรถ (เงาคมรอบรถเสมอ)
    const c = V(truck.x, truck.y, 0);
    sun.position.set(c.x + 38, 70, c.z + 26); sun.target.position.copy(c); sun.target.updateMatrixWorld();

    // กล้องหลัก
    const b = P.bounds, center = V((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, 1.6);
    cam.aspect = W / H;
    if (view.mode === "chase") {
      const ang = truck.th + Math.PI + view.yaw;
      const want = new THREE.Vector3(center.x + Math.cos(ang) * Math.cos(view.pitch) * view.dist, center.y + Math.sin(view.pitch) * view.dist, center.z - Math.sin(ang) * Math.cos(view.pitch) * view.dist);
      const k = Math.min(1, dt * 4);
      view.camPos = view.camPos ? view.camPos.lerp(want, k) : want.clone();
      view.camTgt = view.camTgt ? view.camTgt.lerp(center, k) : center.clone();
      cam.position.copy(view.camPos); cam.lookAt(view.camTgt);
    } else {
      const [ex, ey] = api.toWorld(truck, P.eyeL[0], P.eyeL[1]);
      cam.position.copy(V(ex, ey, EYE_H));
      const yaw = truck.th + view.lookYaw;
      cam.lookAt(cam.position.x + Math.cos(yaw) * Math.cos(view.lookPitch), EYE_H + Math.sin(view.lookPitch), cam.position.z - Math.sin(yaw) * Math.cos(view.lookPitch));
    }
    cam.updateProjectionMatrix();

    renderer.setScissorTest(false);
    renderer.setViewport(0, 0, W, H);
    renderer.clear();
    renderer.render(scene, cam);

    // จอกระจกมองข้าง (มุมคนขับ): กล้องที่กระจก มองย้อนหลัง กลับซ้าย-ขวาเหมือนกระจกจริง
    const insets = [];
    if (view.mode === "driver") {
      const iw = Math.round(Math.min(W * 0.2, 230)), ih = Math.round(iw / 0.62), top = Math.round(H * 0.32);
      P.mirrors.forEach((m, k) => {
        const mc = mirrorCams[k];
        const [mx, my] = api.toWorld(truck, m.lx, m.ly);
        const center = (m.min + m.max) / 2, hf = m.max - m.min;
        const dir = truck.th + Math.PI - m.side * center;
        mc.position.copy(V(mx, my, 2.35));
        mc.aspect = iw / ih;
        mc.fov = 2 * Math.atan(Math.tan(hf / 2) / mc.aspect) * 180 / Math.PI;
        mc.lookAt(mc.position.x + Math.cos(dir) * 10, 2.35 - 1.6, mc.position.z - Math.sin(dir) * 10);
        mc.updateProjectionMatrix();
        mc.projectionMatrix.elements[0] *= -1;
        mc.projectionMatrixInverse.copy(mc.projectionMatrix).invert();
        // กระจกซ้ายอยู่ซ้ายจอ กระจกขวา (ฝั่งคนขับ) อยู่ขวาจอ
        const x = m.side > 0 ? 14 : W - iw - 14;
        renderer.setScissorTest(true);
        renderer.setScissor(x, H - top - ih, iw, ih); renderer.setViewport(x, H - top - ih, iw, ih);
        renderer.clearDepth();
        renderer.render(scene, mc);
        insets.push({ side: m.side, x, y: top, w: iw, h: ih });
      });
      renderer.setScissorTest(false);
    }
    return insets;
  }

  return {
    render, resize, setMode, setNight,
    get mode() { return view.mode; },
    dispose() { renderer.dispose(); host.removeChild(renderer.domElement); }
  };
}
