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
  // logarithmicDepthBuffer: กันผิวถนน/เส้นจราจร/ทางเท้าที่วางซ้อนกันห่างไม่กี่ ซม. แย่งกันโผล่ (z-fighting) จนดูกระพริบตอนรถวิ่ง
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", logarithmicDepthBuffer: true });
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

  // ลานคลังน้ำมัน: พื้นคอนกรีต เส้นช่องจอด รั้ว ทางเข้า
  {
    const Y = api.yard;
    const yard = new THREE.Mesh(new THREE.PlaneGeometry(Y.x2 - Y.x1, Y.y2 - Y.y1), mat(0xb9b6ad, { roughness: 0.95 }));
    yard.rotation.x = -Math.PI / 2; yard.position.copy(V((Y.x1 + Y.x2) / 2, (Y.y1 + Y.y2) / 2, 0.02)); yard.receiveShadow = true; scene.add(yard);
    const drive = new THREE.Mesh(new THREE.PlaneGeometry(Y.drive2 - Y.drive1, Y.y1 - 8.5 + 0.3), mat(0xffffff, { map: plainTex, roughness: 0.92 }));
    drive.rotation.x = -Math.PI / 2; drive.position.copy(V((Y.drive1 + Y.drive2) / 2, (8.5 + Y.y1) / 2, 0.18)); drive.receiveShadow = true; scene.add(drive);
    const yel = mat(0xf0c02c, { roughness: 0.6 });
    Y.bays.forEach((bx) => {
      [[bx - Y.bayW / 2, (Y.bayY1 + Y.bayY2) / 2, 0.15, Y.bayY2 - Y.bayY1], [bx + Y.bayW / 2, (Y.bayY1 + Y.bayY2) / 2, 0.15, Y.bayY2 - Y.bayY1], [bx, Y.bayY2, Y.bayW, 0.15]].forEach(([x, y, w, d]) => {
        const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), yel); m.rotation.x = -Math.PI / 2; m.position.copy(V(x, y, 0.03)); scene.add(m);
      });
    });
    const target = new THREE.Mesh(new THREE.PlaneGeometry(Y.bayW, Y.bayY2 - Y.bayY1), new THREE.MeshBasicMaterial({ color: 0xf0c02c, transparent: true, opacity: 0.22, depthWrite: false }));
    target.rotation.x = -Math.PI / 2; target.position.copy(V(Y.bayX, (Y.bayY1 + Y.bayY2) / 2, 0.035)); scene.add(target);
    const fenceM = mat(0x7a7f86, { metalness: 0.5 });
    [[Y.x1, Y.y1, Y.x1, Y.y2], [Y.x1, Y.y2, Y.x2, Y.y2], [Y.x2, Y.y2, Y.x2, Y.y1], [Y.x1, Y.y1, Y.drive1, Y.y1], [Y.drive2, Y.y1, Y.x2, Y.y1]].forEach(([a1, b1, a2, b2]) => {
      const len = Math.hypot(a2 - a1, b2 - b1), f = box(len, 1.8, 0.06, fenceM);
      f.position.copy(V((a1 + a2) / 2, (b1 + b2) / 2, 0.9)); f.rotation.y = Math.atan2(b2 - b1, a2 - a1); f.material = fenceM; scene.add(f);
    });
    // ถังเก็บน้ำมันใหญ่ท้ายลาน
    [[-122, 42], [-58, 42]].forEach(([x, y]) => {
      const tk = new THREE.Mesh(new THREE.CylinderGeometry(5, 5, 9, 40), mat(0xe8ebee, { metalness: 0.4, roughness: 0.35 }));
      tk.position.copy(V(x, y + 6, 4.5)); tk.castShadow = tk.receiveShadow = true; scene.add(tk);
    });
  }
  // กรอบเป้าหมายของภารกิจ
  const goalMesh = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), new THREE.MeshBasicMaterial({ color: 0x30d158, transparent: true, opacity: 0.25, depthWrite: false }));
  goalMesh.rotation.x = -Math.PI / 2; goalMesh.visible = false; scene.add(goalMesh);

  // ไฟจราจร 3 ดวงบนเสา
  const sigLamps = api.signals.map((sg) => {
    const g = new THREE.Group(); g.position.copy(V(sg.x, sg.y, 0)); g.rotation.y = sg.th;
    const pole = box(0.16, 4.6, 0.16, lampMat); pole.position.y = 2.3; g.add(pole);
    const head = box(0.3, 1.25, 0.42, mat(0x1c1f24)); head.position.set(0, 4.2, 0); g.add(head);
    const lamps = ["R", "Y", "G"].map((k, i) => {
      const c = k === "R" ? 0xff3b30 : k === "Y" ? 0xffcc00 : 0x30d158;
      const m = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), mat(c, { emissive: c, emissiveIntensity: 0.1 }));
      m.position.set(0.17, 4.6 - i * 0.4, 0); g.add(m); return { k, m };
    });
    scene.add(g); return { sg, lamps };
  });

  /* ---------------- แผนที่จริง (OSM) ----------------
     ซ่อนเมืองจำลองทั้งหมด แล้วสร้างถนน (แถบยางมะตอย) + ตึก (ยกสูงตามจำนวนชั้น) จากข้อมูลจริง */
  const cityObjs = scene.children.filter((o) => !o.isLight && o !== sun.target);
  let osmGroup = null;
  function ribbon(pts, w, y, material) {
    const n = pts.length, L = [], R = [];
    for (let i = 0; i < n; i++) {
      const p = pts[Math.max(0, i - 1)], q = pts[Math.min(n - 1, i + 1)];
      let dx = q[0] - p[0], dy = q[1] - p[1]; const l = Math.hypot(dx, dy) || 1; dx /= l; dy /= l;
      const h = y + (pts[i][2] || 0);
      L.push([pts[i][0] - dy * w / 2, h, -(pts[i][1] + dx * w / 2)]); R.push([pts[i][0] + dy * w / 2, h, -(pts[i][1] - dx * w / 2)]);
    }
    const pos = [];
    for (let i = 0; i + 1 < n; i++) [L[i], L[i + 1], R[i + 1], L[i], R[i + 1], R[i]].forEach((v) => pos.push(v[0], v[1], v[2]));
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, material); m.receiveShadow = true; return m;
  }
  // แถบตั้งตามขอบถนน (ราวกันตก ผนังอุโมงค์ ราวสะพาน): offset = ระยะจากเส้นกลาง, lo/hi = ความสูงเทียบผิวถนน (หรือฟังก์ชัน)
  function edgeWall(r, idx, off, lo, hi, material) {
    const pos = [];
    for (let k = 0; k + 1 < idx.length; k++) {
      const i = idx[k], j = idx[k + 1], a = r.pts[i], b = r.pts[j];
      const ax = a[0] - Math.sin(r.th[i]) * off, ay = a[1] + Math.cos(r.th[i]) * off, bx = b[0] - Math.sin(r.th[j]) * off, by = b[1] + Math.cos(r.th[j]) * off;
      const l1 = typeof lo === "function" ? lo(a) : a[2] + lo, l2 = typeof lo === "function" ? lo(b) : b[2] + lo;
      const h1 = typeof hi === "function" ? hi(a) : a[2] + hi, h2 = typeof hi === "function" ? hi(b) : b[2] + hi;
      pos.push(ax, l1, -ay, bx, l2, -by, bx, h2, -by, ax, l1, -ay, bx, h2, -by, ax, h1, -ay);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3)); g.computeVertexNormals();
    const m = new THREE.Mesh(g, material); m.castShadow = true; m.receiveShadow = true; return m;
  }
  function offsetPts(r, idx, off, dz) { return idx.map((i) => [r.pts[i][0] - Math.sin(r.th[i]) * off, r.pts[i][1] + Math.cos(r.th[i]) * off, r.pts[i][2] + dz]); }
  function signSprite(text, green) {
    const c = document.createElement("canvas"), g = c.getContext("2d"), font = "700 44px 'IBM Plex Sans Thai', system-ui, sans-serif";
    g.font = font; const w = Math.ceil(g.measureText(text).width) + 60; c.width = w; c.height = 96;
    g.fillStyle = green ? "#1f6f3f" : "#1f4f8f"; g.fillRect(0, 0, w, 96);
    g.strokeStyle = "#fff"; g.lineWidth = 5; g.strokeRect(8, 8, w - 16, 80);
    g.font = font; g.fillStyle = "#fff"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(text, w / 2, 50);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace;
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: t })); sp.scale.set(w / 96 * 1.6, 1.6, 1);
    return sp;
  }
  // สนามพิเศษ (ภูเขา / สะพาน-อุโมงค์): พื้นมีความสูง ถนน 3 มิติ สะพาน เสาตอม่อ อุโมงค์ ราวกันตก ป้าย
  function buildCustom(o) {
    const G3 = osmGroup, b = o.bounds, res = o.flat ? 4 : 6;
    const nx = Math.ceil((b.maxX - b.minX) / res) + 1, ny = Math.ceil((b.maxY - b.minY) / res) + 1;
    const pos = new Float32Array(nx * ny * 3), col = new Float32Array(nx * ny * 3), idx = [];
    let lo = Infinity, hi = -Infinity;
    const H = new Float32Array(nx * ny);
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) { const z = o.ground(b.minX + i * res, b.minY + j * res); H[j * nx + i] = z; lo = Math.min(lo, z); hi = Math.max(hi, z); }
    const c = new THREE.Color();
    for (let j = 0; j < ny; j++) for (let i = 0; i < nx; i++) {
      const k = j * nx + i, z = H[k], x = b.minX + i * res, y = b.minY + j * res;
      pos[k * 3] = x; pos[k * 3 + 1] = z - 0.06; pos[k * 3 + 2] = -y;
      if (o.flat) c.setRGB(0.55, 0.6, 0.47).multiplyScalar(z < -0.3 ? 0.75 : 1);
      else {
        const sl = Math.min(1, Math.abs(H[k] - H[j * nx + Math.min(nx - 1, i + 1)]) / res + Math.abs(H[k] - H[Math.min(ny - 1, j + 1) * nx + i]) / res);
        const f = (z - lo) / (hi - lo || 1);
        c.setRGB(0.28 + f * 0.25, 0.42 + f * 0.05, 0.2 + f * 0.1).lerp(new THREE.Color(0.48, 0.42, 0.34), Math.min(1, sl * 0.9));
      }
      col[k * 3] = c.r; col[k * 3 + 1] = c.g; col[k * 3 + 2] = c.b;
      if (i < nx - 1 && j < ny - 1) { const a = k, b2 = k + 1, c2 = k + nx, d = k + nx + 1; idx.push(a, c2, b2, b2, c2, d); }
    }
    const tg = new THREE.BufferGeometry();
    tg.setAttribute("position", new THREE.BufferAttribute(pos, 3)); tg.setAttribute("color", new THREE.BufferAttribute(col, 3));
    tg.setIndex(idx); tg.computeVertexNormals();
    const terr = new THREE.Mesh(tg, new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 1, side: THREE.DoubleSide }));
    terr.receiveShadow = true; G3.add(terr);
    if (o.flat) { const far = new THREE.Mesh(new THREE.PlaneGeometry(6000, 6000), mat(0xffffff, { map: grassTex, roughness: 1 })); far.rotation.x = -Math.PI / 2; far.position.y = -0.4; G3.add(far); }
    // ถนน
    const asph = mat(0xffffff, { map: plainTex, roughness: 0.9 }), gravel = mat(0xb89f78, { roughness: 1 }), walkM = mat(0xc9c4b8, { roughness: 0.95 });
    const concrete = mat(0xb5b3ad, { roughness: 0.85 }), under = mat(0x8d8f93, { roughness: 0.9 }), rail = mat(0xc9ced3, { metalness: 0.6, roughness: 0.35 });
    const lineW = mat(0xf2f2ee, { roughness: 0.6 }), lineY = mat(0xf0c02c, { roughness: 0.6 }), redM = mat(0xd93036);
    const runs = [];
    o.roads.forEach((r) => {
      let cur = null;
      r.pts.forEach((p, i) => {
        const lvl = !o.flat ? "ground" : p[2] > 1.2 ? "bridge" : p[2] < -0.3 ? (p[3] ? "tunnel" : "cut") : "ground";
        if (!cur || cur.lvl !== lvl) { if (cur) cur.idx.push(i); cur = { r, lvl, idx: [] }; runs.push(cur); }
        cur.idx.push(i);
      });
    });
    runs.forEach((u) => {
      const r = u.r, pts = u.idx.map((i) => r.pts[i]);
      if (o.flat && u.lvl === "ground" && r.kind === "road") G3.add(ribbon(pts, r.w + 3.4, 0.02, walkM));
      G3.add(ribbon(pts, r.w, 0.04, r.kind === "escape" ? gravel : asph));
      // เส้นจราจร
      if (r.kind !== "escape") {
        [r.w / 2 - 0.45, -r.w / 2 + 0.45].forEach((off) => G3.add(ribbon(offsetPts(r, u.idx, off, 0), 0.15, 0.06, lineW)));
        if (r.two) [0.12, -0.12].forEach((off) => G3.add(ribbon(offsetPts(r, u.idx, off, 0), 0.12, 0.06, lineY)));
        else if (r.lanes === 2) for (let k = 0; k + 1 < u.idx.length; k += 3) G3.add(ribbon(offsetPts(r, u.idx.slice(k, k + 2), 0, 0), 0.15, 0.06, lineW));
      } else [r.w / 2 - 0.3, -r.w / 2 + 0.3].forEach((off) => G3.add(edgeWall(r, u.idx, off, 0.02, 0.9, redM)));
      if (u.lvl === "bridge") {
        G3.add(ribbon(pts.map((p) => [p[0], p[1], p[2] - 0.9]), r.w + 0.8, 0, under));
        [r.w / 2 + 0.3, -r.w / 2 - 0.3].forEach((off) => { G3.add(edgeWall(r, u.idx, off, -0.9, 1.05, concrete)); });
        for (let k = 0; k < u.idx.length; k += 8) {
          const pp = r.pts[u.idx[k]], gz = o.ground(pp[0], pp[1]), hgt = pp[2] - 0.9 - gz;
          if (hgt < 1) continue;
          const col = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.8, hgt, 16), concrete);
          col.position.set(pp[0], gz + hgt / 2, -pp[1]); col.castShadow = col.receiveShadow = true; G3.add(col);
        }
      }
      if (u.lvl === "cut" || u.lvl === "tunnel") {
        [r.w / 2 + 0.25, -r.w / 2 - 0.25].forEach((off) => G3.add(edgeWall(r, u.idx, off, 0, () => 0.9, concrete)));
        if (u.lvl === "tunnel") for (let k = 0; k < u.idx.length; k += 3) {
          const pp = r.pts[u.idx[k]], lamp = new THREE.Mesh(new THREE.BoxGeometry(1.2, 0.08, 0.3), mat(0xfff3d6, { emissive: 0xfff3d6, emissiveIntensity: 2.5 }));
          lamp.position.set(pp[0], -0.35, -pp[1]); G3.add(lamp);
        }
      }
      // ราวกันตกภูเขา (เหล็กลูกฟูก) ทั้งสองข้าง
      if (!o.flat && r.kind === "road") [r.w / 2 + 0.6, -r.w / 2 - 0.6].forEach((off) => G3.add(edgeWall(r, u.idx, off, 0.35, 0.8, rail)));
    });
    // เกาะกลาง
    if (o.median) {
      const r0 = o.roads[0], md = o.median;
      let seg = [];
      const flush = () => { if (seg.length > 1) { G3.add(ribbon(seg, md.w, 0.2, concrete)); } seg = []; };
      r0.pts.forEach((p) => { if (md.gaps.some(([a, bb]) => p[0] > a && p[0] < bb)) flush(); else seg.push([p[0], md.y, p[2]]); });
      flush();
    }
    // ต้นไม้
    const T = o.trees;
    const trunk = new THREE.InstancedMesh(new THREE.CylinderGeometry(0.14, 0.2, 2.6, 6), mat(0x6b4f35), T.length);
    const crown = new THREE.InstancedMesh(o.flat ? new THREE.IcosahedronGeometry(1.9, 1) : new THREE.ConeGeometry(2.0, 5.5, 7), mat(0xffffff, { flatShading: true }), T.length);
    const m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), cc = new THREE.Color();
    T.forEach((t, i) => {
      const gz = o.ground(t.x, t.y);
      m4.compose(new THREE.Vector3(t.x, gz + 1.3 * t.s, -t.y), q, sc.set(t.s, t.s, t.s)); trunk.setMatrixAt(i, m4);
      m4.compose(new THREE.Vector3(t.x, gz + (o.flat ? 3.3 : 4.6) * t.s, -t.y), q, sc.set(t.s, t.s, t.s)); crown.setMatrixAt(i, m4);
      crown.setColorAt(i, cc.setHSL(o.flat ? 0.27 : 0.3, 0.45, 0.2 + (t.s - 0.8) * 0.12));
    });
    trunk.castShadow = crown.castShadow = true; G3.add(trunk, crown);
    // ป้าย
    (o.signs || []).forEach((sg) => {
      const gz = o.heightAt(sg.x, sg.y);
      const pole = box(0.12, 3.2, 0.12, mat(0x6b6f75)); pole.position.set(sg.x, gz + 1.6, -sg.y); G3.add(pole);
      const sp = signSprite(sg.text, o.flat); sp.position.set(sg.x, gz + 4.0, -sg.y); G3.add(sp);
    });
  }
  /* ตึกจากแผนที่จริง (OpenStreetMap ฟรี): รวมเป็นก้อนเดียว ผนังมีหน้าต่างตามขนาดจริง (ช่วงเสา 3 ม. × ชั้น 3.2 ม.)
     ตึกสูง ≥ 32 ม. ส่วนใหญ่เป็นผนังกระจก · กลางคืนไฟหน้าต่างเปิดบางห้อง */
  const glassTex = canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = "#a9b9c6"; g.fillRect(0, 0, w, h);
    for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) { const gr = g.createLinearGradient(x, y, x + 32, y + 32); gr.addColorStop(0, "#6a8aa3"); gr.addColorStop(1, "#24394c"); g.fillStyle = gr; g.fillRect(x + 1, y + 2, 30, 27); }
  }, [1, 1]);
  const glassLit = canvasTex(128, 256, (g, w, h) => {
    g.fillStyle = "#000"; g.fillRect(0, 0, w, h); const r = rnd(41);
    for (let y = 0; y < h; y += 32) for (let x = 0; x < w; x += 32) if (r() < 0.5) { g.fillStyle = r() < 0.5 ? "#ffe2a8" : "#fff4d8"; g.fillRect(x + 1, y + 2, 30, 27); }
  }, [1, 1]);
  const osmWall = mat(0xffffff, { map: winTex.clone(), emissive: 0xffffff, emissiveMap: winLit.clone(), emissiveIntensity: 0, roughness: 0.85, vertexColors: true });
  const osmGlass = mat(0xffffff, { map: glassTex, emissive: 0xffffff, emissiveMap: glassLit, emissiveIntensity: 0, roughness: 0.12, metalness: 0.45, vertexColors: true });
  const osmRoof = mat(0xffffff, { roughness: 0.9, vertexColors: true });
  [osmWall.map, osmWall.emissiveMap, glassTex, glassLit].forEach((t) => { t.wrapS = t.wrapT = THREE.RepeatWrapping; t.needsUpdate = true; });
  buildMats.push(osmWall, osmGlass);
  function osmBuildings(list, group) {
    const bk = () => ({ pos: [], nrm: [], uv: [], col: [] });
    const Wc = bk(), Wg = bk(), Rf = bk(), col = new THREE.Color(), rc = new THREE.Color();
    list.forEach((b, i) => {
      let pts = b.pts.slice();
      if (pts.length > 2 && pts[0][0] === pts[pts.length - 1][0] && pts[0][1] === pts[pts.length - 1][1]) pts.pop();
      if (pts.length < 3) return;
      let ar = 0; pts.forEach((p, j) => { const q = pts[(j + 1) % pts.length]; ar += p[0] * q[1] - q[0] * p[1]; });
      if (ar < 0) pts.reverse();
      const H = b.h, hs = ((i * 2654435761) >>> 0) / 4294967296, glassy = H >= 32 && hs < 0.65, T = glassy ? Wg : Wc;
      if (glassy) col.setHSL(0.55 + hs * 0.08, 0.15 + hs * 0.2, 0.6 + hs * 0.25); else col.setHex(PAL[i % PAL.length]);
      let per = 0;
      pts.forEach((p, j) => {
        const q = pts[(j + 1) % pts.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (L < 0.05) return;
        const nx = (q[1] - p[1]) / L, nz = (q[0] - p[0]) / L, u0 = per / 12, u1 = (per + L) / 12, v1 = H / 25.6; per += L;
        const A = [p[0], 0, -p[1]], B = [q[0], 0, -q[1]], B2 = [q[0], H, -q[1]], A2 = [p[0], H, -p[1]];
        [[A, u0, 0], [B, u1, 0], [B2, u1, v1], [A, u0, 0], [B2, u1, v1], [A2, u0, v1]].forEach(([v, u, w]) => { T.pos.push(...v); T.nrm.push(nx, 0, nz); T.uv.push(u, w); T.col.push(col.r, col.g, col.b); });
      });
      rc.setHSL(0.1, 0.03, 0.42 + hs * 0.2);
      THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p[0], p[1])), []).forEach((t) => {
        let [a, c, d] = t; const p0 = pts[a], p1 = pts[c], p2 = pts[d];
        if ((p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]) < 0) [c, d] = [d, c];
        [a, c, d].forEach((k) => { Rf.pos.push(pts[k][0], H, -pts[k][1]); Rf.nrm.push(0, 1, 0); Rf.uv.push(0, 0); Rf.col.push(rc.r, rc.g, rc.b); });
      });
    });
    [[Wc, osmWall], [Wg, osmGlass], [Rf, osmRoof]].forEach(([T, m]) => {
      if (!T.pos.length) return;
      const g = new THREE.BufferGeometry();
      g.setAttribute("position", new THREE.Float32BufferAttribute(T.pos, 3)); g.setAttribute("normal", new THREE.Float32BufferAttribute(T.nrm, 3));
      g.setAttribute("uv", new THREE.Float32BufferAttribute(T.uv, 2)); g.setAttribute("color", new THREE.Float32BufferAttribute(T.col, 3));
      const me = new THREE.Mesh(g, m); me.castShadow = me.receiveShadow = true; group.add(me);
    });
  }
  function setOSM(o) {
    if (osmGroup) { scene.remove(osmGroup); osmGroup.traverse((c) => { if (c.geometry) c.geometry.dispose(); }); osmGroup = null; }
    cityObjs.forEach((c) => { c.visible = !o; });
    if (!o) return;
    osmGroup = new THREE.Group();
    if (o.custom) {
      buildCustom(o);
      osmBuildings(o.buildings, osmGroup);
      scene.add(osmGroup);
      return;
    }
    const gr = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), mat(0xffffff, { map: grassTex, roughness: 1 }));
    gr.rotation.x = -Math.PI / 2; gr.position.y = -0.02; gr.receiveShadow = true; osmGroup.add(gr);
    const walkM = mat(0xc9c4b8, { roughness: 0.95 }), asph = mat(0x4a4e53, { roughness: 0.9 }), lineW = mat(0xf2f2ee), lineY = mat(0xf0c02c);
    o.roads.forEach((r) => { if (r.w >= 6) osmGroup.add(ribbon(r.pts, r.w + 3.4, 0.004, walkM)); });
    o.roads.forEach((r) => osmGroup.add(ribbon(r.pts, r.w, 0.012, asph)));
    o.roads.forEach((r) => { if (r.w >= 7) osmGroup.add(ribbon(r.pts, 0.16, 0.02, r.w >= 10 && !r.oneway ? lineY : lineW)); });
    osmBuildings(o.buildings, osmGroup);
    scene.add(osmGroup);
  }

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
      // ที่ปัดน้ำฝน 2 ก้าน + หยดน้ำบนกระจก
      info.wipers = [-0.55, 0.55].map((z) => {
        const hold = new THREE.Group(); hold.position.set(cf - 0.16, 1.9, z);
        const arm = box(0.03, 0.95, 0.05, mat(0x111214)); arm.position.y = 0.47; hold.add(arm);
        inside.add(hold); return hold;
      });
      const drc = document.createElement("canvas"); drc.width = 512; drc.height = 256;
      const dg = drc.getContext("2d");
      for (let i = 0; i < 420; i++) {
        const x = Math.random() * 512, y = Math.random() * 256, r = 1 + Math.random() * 4;
        const gr = dg.createRadialGradient(x - r * 0.3, y - r * 0.3, 0, x, y, r);
        gr.addColorStop(0, "rgba(255,255,255,.85)"); gr.addColorStop(0.6, "rgba(200,215,230,.35)"); gr.addColorStop(1, "rgba(200,215,230,0)");
        dg.fillStyle = gr; dg.beginPath(); dg.arc(x, y, r, 0, Math.PI * 2); dg.fill();
      }
      const dtx = new THREE.CanvasTexture(drc); dtx.colorSpace = THREE.SRGBColorSpace;
      const drops = new THREE.Mesh(new THREE.PlaneGeometry(2.3, 1.0), new THREE.MeshBasicMaterial({ map: dtx, transparent: true, opacity: 0, depthWrite: false }));
      drops.position.set(cf - 0.2, 2.45, 0); drops.rotation.y = -Math.PI / 2; inside.add(drops); info.drops = drops;
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
    const parts = S.units.map((u, i) => {
      const info = buildUnit(u, i), outer = new THREE.Group(), pivot = new THREE.Group();
      outer.add(pivot); pivot.add(info.g); root.add(outer);
      info.outer = outer; info.pivot = pivot; info.hasTank = u.def.parts.some((p) => p.t === "tank");
      return info;
    });
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
    } else if (o.t === "tank") {
      const tm = mat(0xe4e8eb, { metalness: 0.75, roughness: 0.22 });
      const cyl = new THREE.Mesh(new THREE.CylinderGeometry(1.18, 1.18, 11.8, 32), tm); cyl.rotation.z = Math.PI / 2; cyl.position.y = 2.05; g.add(cyl);
      [1.19, -1.19].forEach((z) => { const st = box(11, 0.22, 0.03, mat(0x6cb200)); st.position.set(0, 1.65, z); g.add(st); });
      const sk = box(11.5, 0.5, 2.3, mat(0x22252a)); sk.position.y = 0.95; g.add(sk);
      [-4.6, -3.3, -2].forEach((x) => [1, -1].forEach((z) => { const w = wheel(); w.position.set(x, 0.52, z * 1.0); g.add(w); }));
      const leg = box(0.2, 1.0, 2.0, mat(0x22252a)); leg.position.set(4.2, 0.5, 0); g.add(leg);
      const body = tm;
      g.userData = { body: mat(0xe4e8eb), ring: new THREE.Mesh() };
      g.traverse((m) => { if (m.isMesh) m.castShadow = true; });
      scene.add(g); return g;
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
      g.position.copy(V(o.x, o.y, o.z || 0)); g.rotation.y = o.th;
      const st = states[i], b = g.userData.body;
      b.color.set(st === "seen" ? (o.col || "#3b6fd8") : st === "hit" ? "#777777" : "#e5484d");
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
    vertexShader: ["#include <common>", "#include <logdepthbuf_pars_vertex>", "attribute float alpha; varying float vA;",
      "void main(){ vA = alpha; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);", "#include <logdepthbuf_vertex>", "}"].join(String.fromCharCode(10)),
    fragmentShader: ["#include <logdepthbuf_pars_fragment>", "varying float vA;", "void main(){", "#include <logdepthbuf_fragment>", "gl_FragColor = vec4(0.9, 0.2, 0.22, vA); }"].join(String.fromCharCode(10))
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
    gridPlane.position.copy(V(G.minX + w / 2, G.maxY - h / 2, (S.z || 0) + 0.19));
    const segs = api.blindOutline(), n = Math.min(MAXSEG, segs.length / 2), H = S.opts.objH;
    const pos = curtainGeo.attributes.position.array, al = curtainGeo.attributes.alpha.array, ep = edgeGeo.attributes.position.array;
    const X = (i) => G.minX + (i + 0.5) * CELL, Z = (j) => -(G.maxY - (j + 0.5) * CELL);
    for (let k = 0; k < n; k++) {
      const a = segs[k * 2], b = segs[k * 2 + 1];
      const ax = X(a[0]), az = Z(a[1]), bx = X(b[0]), bz = Z(b[1]), o = k * 18;
      const z0 = (S.z || 0) + 0.05, zt = (S.z || 0) + H;
      pos.set([ax, z0, az, bx, z0, bz, bx, zt, bz, ax, z0, az, bx, zt, bz, ax, zt, az], o);
      al.set([0.42, 0.42, 0.04, 0.42, 0.04, 0.04], k * 6);
      ep.set([ax, zt, az, bx, zt, bz], k * 6);
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
    g.visible = true; g.position.copy(V(wx, wy, api.heightAt(wx, wy, S.z || 0))); g.rotation.y = th;
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
    const put = (arr, i, p) => { arr[i] = p[0]; arr[i + 1] = api.heightAt(p[0], p[1], S.z || 0) + 0.21; arr[i + 2] = -p[1]; };
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
      const off = (p, k, h) => V(p.x - Math.sin(p.th) * k, p.y + Math.cos(p.th) * k, h + api.heightAt(p.x, p.y, S.z || 0));
      // ป้ายเบรกไว้ซ้ายของเส้น ป้ายหยุดไว้ขวาและสูงกว่า — มองจากที่นั่งคนขับจะไม่ทับกัน
      label(off(pr, 2.6, 1.9), "เริ่มเบรก " + sd.r.toFixed(0) + " ม.", "rgba(214,138,0,.62)");
      label(off(pt, -2.6, 3.1), "หยุดสนิท " + sd.total.toFixed(0) + " ม." + (fz ? " · มองไม่เห็น " + Math.round(fz.pct) + "%" : ""), "rgba(229,72,77,.62)");
      for (let d = 0; d + 1 <= sd.total && pn + 6 <= pp.length; d += 2) {
        const a = api.predictFront(d), b = api.predictFront(d + 1);
        pp.set([a.x, api.heightAt(a.x, a.y, S.z || 0) + 0.24, -a.y, b.x, api.heightAt(b.x, b.y, S.z || 0) + 0.24, -b.y], pn); pn += 6;
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
        label(V(z.far[0], z.far[1], 1.8 + api.heightAt(z.far[0], z.far[1], S.z || 0)), name + " · มองไม่เห็น " + Math.round(a.pct) + "%");
      }
    });
    // ขนาดพื้นที่มุมอับแต่ละก้อน
    (G.regions || []).forEach((r) => {
      label(V(r.x, r.y, (S.z || 0) + S.opts.objH + 0.6), "≈ " + (r.area < 10 ? r.area.toFixed(1) : Math.round(r.area)) + " ตร.ม.", "rgba(229,72,77,.62)");
    });
    for (let i = labelUsed; i < labelPool.length; i++) labelPool[i].sp.visible = false;
  }

  /* ---------------- กล้อง ---------------- */
  const cam = new THREE.PerspectiveCamera(55, 1, 0.1, 3000);
  cam.layers.enable(LABEL_LAYER);
  const mirrorCams = P.mirrors.map(() => new THREE.PerspectiveCamera(40, 0.6, 0.1, 400));
  const topCam = new THREE.OrthographicCamera(-8, 8, 8, -8, 0.1, 80);
  const sideCam = new THREE.PerspectiveCamera(70, 0.75, 0.1, 200);
  const view = { mode: "chase", yaw: 0, pitch: 0.62, dist: 34, lookYaw: 0, lookPitch: -0.1, camPos: null, camTgt: null };
  let night = false;

  let raining = false;
  function setNight(on) {
    night = on;
    const k = on ? NIGHT : DAY;
    scene.background.setHex(raining && !on ? 0x8b97a4 : k.sky); scene.fog.color.setHex(raining && !on ? 0x98a3ae : k.fog);
    hemi.intensity = k.hemi * (raining ? 0.75 : 1); sun.intensity = k.sun * (raining ? 0.25 : 1);
    lamps.forEach((l) => { l.intensity = k.lamp; });
    bulbMat.emissiveIntensity = on ? 2.5 : 0;
    buildMats.forEach((m) => { m.emissiveIntensity = k.win; });
  }

  /* ---------------- ฝนตก ----------------
     เม็ดฝนรอบกล้อง · ถนนเปียกเงาสะท้อนแสงไฟ · หมอกฝนทำให้มองไกลไม่ชัด */
  const RAIN_N = 5000, rainPos = new Float32Array(RAIN_N * 6), rainSeed = new Float32Array(RAIN_N * 3);
  for (let i = 0; i < RAIN_N; i++) { rainSeed[i * 3] = (Math.random() - 0.5) * 120; rainSeed[i * 3 + 1] = Math.random() * 40; rainSeed[i * 3 + 2] = (Math.random() - 0.5) * 120; }
  const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xc9d6e6, transparent: true, opacity: 0.45, depthWrite: false }));
  rain.frustumCulled = false; rain.visible = false; scene.add(rain);
  function setRain(on) {
    raining = on; rain.visible = on;
    roadMat.roughness = on ? 0.28 : 0.92; roadMat.metalness = on ? 0.35 : 0.05; roadMat.color.setHex(on ? 0xb8bcc2 : 0xffffff);
    scene.fog.near = on ? 35 : 160; scene.fog.far = on ? 330 : 900;
    setNight(night);
  }
  let rainT = 0;
  let rainBase = 0;
  function updateRain(dt, cx, cz, cy) {
    rainBase = (cy || 0) - 15;
    if (!raining) return;
    rainT += dt;
    for (let i = 0; i < RAIN_N; i++) {
      let y = rainSeed[i * 3 + 1] - ((rainT * 22 + i * 0.37) % 40);
      if (y < 0) y += 40;
      y += rainBase;
      const x = cx + rainSeed[i * 3], z = cz + rainSeed[i * 3 + 2], o = i * 6;
      rainPos[o] = x; rainPos[o + 1] = y; rainPos[o + 2] = z;
      rainPos[o + 3] = x + 0.12; rainPos[o + 4] = y + 0.9; rainPos[o + 5] = z;
    }
    rainGeo.attributes.position.needsUpdate = true;
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
      info.outer.position.copy(V(u.x, u.y, u.z || 0)); info.outer.rotation.order = "YZX"; info.outer.rotation.set(0, u.th, u.pitch || 0);
      // เอียงตามแรงเหวี่ยง / พลิกตะแคง: หมุนรอบขอบล้อด้านที่เอียงไป
      const edge = (S.lean >= 0 ? -1 : 1) * 1.25;
      info.pivot.position.z = edge; info.g.position.z = -edge;
      info.pivot.rotation.x = -S.lean;
      // น้ำมันในถังโยกหน้า-หลัง → หัวทิ่ม/เชิด เล็กน้อย
      info.g.rotation.z = info.hasTank ? -S.slosh.x * 0.03 : 0;
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
      if (info.wipers) {
        // ปัดไป-กลับทุก ~1.4 วินาทีตอนฝนตก หยดน้ำค่อย ๆ เกาะแล้วถูกปัดออก
        const ph = raining ? (t % 1.4) / 1.4 : 0, sw = raining ? Math.sin(ph * Math.PI) : 0;
        info.wipers.forEach((w, k) => { w.rotation.x = (k ? 1 : -1) * (0.15 - sw * 1.65); });
        info.drops.material.opacity = raining ? 0.15 + 0.6 * Math.min(1, (ph < 0.5 ? 0 : (ph - 0.5) * 2)) : 0;
      }
      if (info.interior) {
        info.interior.visible = inCab; info.steeringWheel.rotation.z = S.steer * 20 / 8;
        const kmh = Math.round(Math.abs(S.v) * 3.6), gear = S.v < -0.05 ? "R" : S.v > 0.05 ? "D" : "N", key = kmh + gear + (braking ? "B" : "") + (S.overspeed || "") + (blink ? 1 : 0);
        if (inCab && key !== info.dash.last) {
          info.dash.last = key;
          const g2 = info.dash.c.getContext("2d");
          g2.fillStyle = "#05070a"; g2.fillRect(0, 0, 256, 128);
          if (S.overspeed && blink) { g2.strokeStyle = S.overspeed === "over" ? "#ff3b3b" : "#ffb020"; g2.lineWidth = 8; g2.strokeRect(4, 4, 248, 120); }
          g2.fillStyle = "#9fb3c8"; g2.font = "600 18px system-ui, sans-serif"; g2.textAlign = "left"; g2.textBaseline = "middle"; g2.fillText("LIMIT " + api.speedLimit(), 14, 22);
          g2.fillStyle = S.overspeed === "over" ? "#ff5a5a" : S.overspeed ? "#ffc04d" : "#7df3ff"; g2.font = "700 74px system-ui, sans-serif"; g2.textAlign = "right"; g2.textBaseline = "middle"; g2.fillText(kmh, 170, 58);
          g2.font = "600 22px system-ui, sans-serif"; g2.fillStyle = "#9fb3c8"; g2.textAlign = "left"; g2.fillText("km/h", 178, 74);
          g2.font = "700 30px system-ui, sans-serif"; g2.fillStyle = gear === "R" ? "#ffffff" : "#ffd54a"; g2.fillText(gear, 190, 36);
          if (braking) { g2.fillStyle = "#ff3b3b"; g2.fillRect(14, 104, 228, 12); }
          info.dash.tex.needsUpdate = true;
        }
      }
    });
    syncObjects(states, t);
    const gb = api.scnBox();
    goalMesh.visible = !!gb;
    if (gb) { goalMesh.scale.set(gb.x2 - gb.x1, gb.y2 - gb.y1, 1); goalMesh.position.copy(V((gb.x1 + gb.x2) / 2, (gb.y1 + gb.y2) / 2, 0.06)); }
    sigLamps.forEach(({ sg, lamps }) => { const st = api.lightState(sg.axis); lamps.forEach(({ k, m }) => { m.material.emissiveIntensity = st === k ? 4 : 0.05; }); });
    updateBlind(showBlind);
    updateOverlays();
    updateRain(dt, cam.position.x, cam.position.z, cam.position.y);

    // ดวงอาทิตย์ตามรถ (เงาคมรอบรถเสมอ)
    const c = V(truck.x, truck.y, S.z || 0);
    sun.position.set(c.x + 38, c.y + 70, c.z + 26); sun.target.position.copy(c); sun.target.updateMatrixWorld();

    // กล้องหลัก
    const b = P.bounds, center = V((b.minX + b.maxX) / 2, (b.minY + b.maxY) / 2, 1.6 + (S.z || 0));
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
      const tp = truck.pitch || 0, eyeY = (truck.z || 0) + EYE_H + P.eyeL[0] * Math.sin(tp);
      cam.position.copy(V(ex, ey, eyeY));
      const yaw = truck.th + view.lookYaw, lp = view.lookPitch + tp;
      cam.lookAt(cam.position.x + Math.cos(yaw) * Math.cos(lp), eyeY + Math.sin(lp), cam.position.z - Math.sin(yaw) * Math.cos(lp));
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
        const mz = (truck.z || 0) + 2.35 + m.lx * Math.sin(truck.pitch || 0);
        mc.position.copy(V(mx, my, mz));
        mc.aspect = iw / ih;
        mc.fov = 2 * Math.atan(Math.tan(hf / 2) / mc.aspect) * 180 / Math.PI;
        mc.lookAt(mc.position.x + Math.cos(dir) * 10, mz - 1.6 - 10 * Math.sin(truck.pitch || 0), mc.position.z - Math.sin(dir) * 10);
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
      // จอกล้องบนคอนโซล
      const extra = [];
      if (S.opts.cam360) extra.push("cam360");
      if (S.opts.sideCam) extra.push("side");
      const cw = Math.round(Math.min(W * 0.2, 220)), chh = Math.round(cw * 0.75);
      extra.forEach((kind, k) => {
        const x = Math.round(W / 2 - (extra.length * (cw + 12)) / 2 + k * (cw + 12)), yTop = Math.round(H * 0.06);
        let camX;
        if (kind === "cam360") {
          const b = P.bounds, cxm = (b.minX + b.maxX) / 2, cym = (b.minY + b.maxY) / 2, half = Math.max(b.maxX - b.minX, b.maxY - b.minY) / 2 + 3;
          topCam.left = -half * (cw / chh); topCam.right = half * (cw / chh); topCam.top = half; topCam.bottom = -half;
          topCam.position.copy(V(cxm, cym, 40 + (S.z || 0))); topCam.up.set(Math.cos(truck.th), 0, -Math.sin(truck.th));
          topCam.lookAt(V(cxm, cym, S.z || 0)); topCam.updateProjectionMatrix(); camX = topCam;
        } else {
          const [sx0, sy0] = api.toWorld(truck, d.cabFront - 0.6, 1.35), dir = truck.th + Math.PI - 0.12;
          sideCam.aspect = cw / chh; sideCam.position.copy(V(sx0, sy0, 3.0 + (S.z || 0)));
          sideCam.lookAt(sideCam.position.x + Math.cos(dir) * 10, 0.4 + (S.z || 0), sideCam.position.z - Math.sin(dir) * 10);
          sideCam.updateProjectionMatrix(); camX = sideCam;
        }
        renderer.setScissorTest(true);
        renderer.setScissor(x, H - yTop - chh, cw, chh); renderer.setViewport(x, H - yTop - chh, cw, chh);
        renderer.clear(); renderer.render(scene, camX);
        insets.push({ side: 0, x, y: yTop, w: cw, h: chh, label: kind === "cam360" ? "จอกล้องรอบคัน 360°" : "จอกล้องข้างซ้าย" });
      });
      renderer.setScissorTest(false);
    }
    return insets;
  }

  return {
    render, resize, setMode, setNight, setRain, setOSM,
    get mode() { return view.mode; },
    dispose() { renderer.dispose(); host.removeChild(renderer.domElement); }
  };
}
