/* =====================================================================
   โลก 3 มิติของตัวจำลองรถไฟสายเหนือ
   - สร้างฉากเป็น "ชิ้น" ละ 400 ม. ตามแนวราง เฉพาะรอบ ๆ ขบวนรถ (ข้างหน้า ~4 กม. ข้างหลัง ~1.2 กม.)
     ชิ้นที่พ้นระยะจะถูกลบทิ้ง → วิ่งได้ทั้งสาย 754 กม. โดยหน่วยความจำไม่บวม
   - พิกัดใช้ "จุดอ้างอิงลอยตัว" (floating origin): ย้ายจุดอ้างอิงตามรถทุก ~2.5 กม. กันตัวเลขทศนิยมคลาดเคลื่อน
   - ราง: หินโรยทาง หมอนคอนกรีต รางเหล็กขนาด 1 เมตร หลักกิโลเมตร
   - สะพานเหล็กโครงถัก + ตอม่อ + แม่น้ำ, อุโมงค์คอนกรีต + ไฟ (อุโมงค์ขุนตาน), สถานี (ชานชาลา หลังคา อาคาร ป้ายชื่อ)
   - ภูมิประเทศ: ภาคกลาง = ทุ่งนาราบ ต้นตาล · ภาคเหนือ = ภูเขา ป่า · ท้องฟ้า/แสงตามเวลา · ฝน · หมอก
   ===================================================================== */
import * as THREE from "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.module.js";

export function createWorld(host, api) {
  const { geo } = api;   // geo.at(s) → {lat, lon, z}, geo.flag(s), geo.radius(s), geo.stations, geo.total
  const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance", logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(2, window.devicePixelRatio || 1));
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.0;
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  host.appendChild(renderer.domElement);
  renderer.domElement.style.touchAction = "none";

  const scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xbcd3e8, 300, 4200);
  const cam = new THREE.PerspectiveCamera(60, 1, 0.1, 9000);
  const hemi = new THREE.HemisphereLight(0xdfeaff, 0x5b5648, 1.0); scene.add(hemi);
  const sun = new THREE.DirectionalLight(0xfff1dc, 2.6);
  sun.castShadow = true; sun.shadow.mapSize.set(4096, 4096);
  Object.assign(sun.shadow.camera, { left: -140, right: 140, top: 140, bottom: -140, near: 1, far: 900 });
  sun.shadow.bias = -0.0004; sun.shadow.normalBias = 0.04;
  scene.add(sun, sun.target);

  const mat = (color, o = {}) => new THREE.MeshStandardMaterial(Object.assign({ color, roughness: 0.8, metalness: 0.05 }, o));
  const rnd = (seed) => { let s = seed >>> 0; return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296); };
  function canvasTex(w, h, draw, rep) {
    const c = document.createElement("canvas"); c.width = w; c.height = h; draw(c.getContext("2d"), w, h);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = renderer.capabilities.getMaxAnisotropy();
    if (rep) { t.wrapS = t.wrapT = THREE.RepeatWrapping; }
    return t;
  }

  /* ---------------- ท้องฟ้า ---------------- */
  const skyGeo = new THREE.SphereGeometry(8000, 32, 16);
  const skyMat = new THREE.ShaderMaterial({
    side: THREE.BackSide, depthWrite: false, fog: false,
    uniforms: { top: { value: new THREE.Color(0x3f7cc8) }, hor: { value: new THREE.Color(0xcfe3f4) }, sunDir: { value: new THREE.Vector3(0, 1, 0) }, sunCol: { value: new THREE.Color(0xfff2d0) }, night: { value: 0 } },
    vertexShader: ["#include <common>", "#include <logdepthbuf_pars_vertex>", "varying vec3 vP;", "void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0);", "#include <logdepthbuf_vertex>", "}"].join(String.fromCharCode(10)),
    fragmentShader: ["#include <logdepthbuf_pars_fragment>", "uniform vec3 top; uniform vec3 hor; uniform vec3 sunDir; uniform vec3 sunCol; uniform float night; varying vec3 vP;",
      "float h21(vec3 p){ return fract(sin(dot(p, vec3(12.9898,78.233,37.719)))*43758.5453); }",
      "void main(){", "#include <logdepthbuf_fragment>",
      "float h = max(vP.y, 0.0); vec3 c = mix(hor, top, pow(h, 0.55));",
      "float d = max(dot(vP, normalize(sunDir)), 0.0); c += sunCol * (pow(d, 900.0) * 3.0 + pow(d, 12.0) * 0.25);",
      "if (night > 0.5) { vec3 q = floor(vP * 420.0); float s = step(0.9965, h21(q)) * smoothstep(0.05, 0.3, h); c += vec3(s); }",
      "gl_FragColor = vec4(c, 1.0); }"].join(String.fromCharCode(10))
  });
  const sky = new THREE.Mesh(skyGeo, skyMat); sky.renderOrder = -1; scene.add(sky);
  const ENV = {
    dawn: { top: 0x5a7fb8, hor: 0xf3b88a, sun: [0.7, 0.12, 0.3], sunCol: 0xffc38a, sunI: 1.6, hemi: 0.75, fog: 0xe6c3a5, exp: 0.95 },
    day: { top: 0x3f7cc8, hor: 0xcfe3f4, sun: [0.35, 0.85, 0.35], sunCol: 0xfff1dc, sunI: 2.7, hemi: 1.05, fog: 0xbcd3e8, exp: 1.0 },
    dusk: { top: 0x3b3f73, hor: 0xf08a4b, sun: [-0.75, 0.1, 0.25], sunCol: 0xff9a5a, sunI: 1.4, hemi: 0.6, fog: 0xc98d6a, exp: 0.95 },
    night: { top: 0x050914, hor: 0x16233a, sun: [0.3, 0.6, -0.4], sunCol: 0x9fb4d9, sunI: 0.12, hemi: 0.12, fog: 0x0b1220, exp: 1.1 }
  };
  let env = { tod: "day", wx: "clear" };

  /* ---------------- พื้นผิว ---------------- */
  const ballastTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = "#7d7a74"; g.fillRect(0, 0, w, h); const r = rnd(3);
    for (let i = 0; i < 2600; i++) { const v = 90 + r() * 90; g.fillStyle = `rgb(${v},${v - 3},${v - 8})`; g.beginPath(); g.arc(r() * w, r() * h, 1 + r() * 2.4, 0, 7); g.fill(); }
  }, true);
  const riceTex = canvasTex(512, 512, (g, w, h) => {
    const r = rnd(9);
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      const k = r(); g.fillStyle = k < 0.55 ? `hsl(${88 + r() * 14},${48 + r() * 15}%,${32 + r() * 10}%)` : k < 0.8 ? `hsl(${50 + r() * 10},55%,${45 + r() * 8}%)` : `hsl(${95},35%,${26 + r() * 6}%)`;
      g.fillRect(i * 64, j * 64, 64, 64);
      g.strokeStyle = "rgba(90,70,40,.55)"; g.lineWidth = 2; g.strokeRect(i * 64 + 1, j * 64 + 1, 62, 62);
      for (let q = 0; q < 40; q++) { g.fillStyle = "rgba(0,0,0,.06)"; g.fillRect(i * 64 + r() * 62, j * 64 + r() * 62, 2, 2); }
    }
  }, true);
  const forestTex = canvasTex(256, 256, (g, w, h) => {
    g.fillStyle = "#2f4a26"; g.fillRect(0, 0, w, h); const r = rnd(4);
    for (let i = 0; i < 1600; i++) { g.fillStyle = `hsla(${95 + r() * 30},${30 + r() * 25}%,${16 + r() * 20}%,.8)`; g.beginPath(); g.arc(r() * w, r() * h, 2 + r() * 5, 0, 7); g.fill(); }
  }, true);
  const concreteTex = canvasTex(128, 128, (g, w, h) => { g.fillStyle = "#b9b6ae"; g.fillRect(0, 0, w, h); const r = rnd(7); for (let i = 0; i < 900; i++) { const v = 150 + r() * 60; g.fillStyle = `rgba(${v},${v},${v - 6},.5)`; g.fillRect(r() * w, r() * h, 2, 2); } }, true);

  const M = {
    ballast: mat(0xffffff, { map: ballastTex, roughness: 1 }),
    sleeper: mat(0xa9a7a1, { map: concreteTex, roughness: 0.9 }),
    rail: mat(0x9aa0a6, { metalness: 0.85, roughness: 0.28 }),
    railWeb: mat(0x5b4a3d, { metalness: 0.4, roughness: 0.8 }),
    rice: new THREE.MeshStandardMaterial({ map: riceTex, vertexColors: true, roughness: 1 }),
    forest: new THREE.MeshStandardMaterial({ map: forestTex, vertexColors: true, roughness: 1 }),
    concrete: mat(0xffffff, { map: concreteTex, roughness: 0.85 }),
    steel: mat(0x6f7a84, { metalness: 0.7, roughness: 0.4 }),
    steelRed: mat(0x8a3b2f, { metalness: 0.55, roughness: 0.5 }),
    water: new THREE.MeshStandardMaterial({ color: 0x4f6f7a, roughness: 0.08, metalness: 0.6, transparent: true, opacity: 0.9 }),
    tunnel: mat(0x6b6a66, { map: concreteTex, roughness: 0.95, side: THREE.DoubleSide }),
    lamp: mat(0xfff2c8, { emissive: 0xfff2c8, emissiveIntensity: 2.2 }),
    platform: mat(0xffffff, { map: concreteTex, roughness: 0.9 }),
    yellow: mat(0xf2c230, { roughness: 0.6 }),
    roofRed: mat(0x9c3b2c, { roughness: 0.7 }),
    wallCream: mat(0xe9dcc0, { roughness: 0.85 }),
    trunk: mat(0x5e4630), leaf: mat(0xffffff, { roughness: 0.9 }), palm: mat(0xffffff, { roughness: 0.9, side: THREE.DoubleSide }),
    pole: mat(0x8d9399, { metalness: 0.6, roughness: 0.4 }), wire: mat(0x2b2b2b, { metalness: 0.6 }),
    white: mat(0xf4f4f0), dark: mat(0x1d2026), house: mat(0xd8cdb6), houseRoof: mat(0x7a4b36)
  };

  /* ---------------- ตำแหน่ง: จุดอ้างอิงลอยตัว ---------------- */
  const O = { lat: 0, lon: 0, k: 1 };
  function setOrigin(lat, lon) { O.lat = lat; O.lon = lon; O.k = Math.cos(lat * Math.PI / 180) * 111320; }
  const toXY = (lat, lon) => [(lon - O.lon) * O.k, (lat - O.lat) * 110574];
  // จุดบนรางที่ระยะ s → พิกัด three.js (x ตะวันออก, y สูง, z = -เหนือ) + ทิศทาง
  function trackPoint(s) {
    const p = geo.at(s), q = geo.at(Math.min(geo.total, s + 2)), b = geo.at(Math.max(0, s - 2));
    const [x, y] = toXY(p.lat, p.lon), [x1, y1] = toXY(q.lat, q.lon), [x0, y0] = toXY(b.lat, b.lon);
    const th = Math.atan2(y1 - y0, x1 - x0);
    return { x, y, z: p.z, th, pitch: Math.atan2(q.z - b.z, Math.hypot(x1 - x0, y1 - y0)) };
  }
  // ภูมิภาค: ภาคกลางราบ (ทุ่งนา) → ภาคเหนือภูเขา ตามละติจูด
  const clamp01 = (x) => Math.max(0, Math.min(1, x));
  const hillness = (lat) => Math.max(0, Math.min(1, (lat - 16.9) / 0.9));
  const noise2 = (x, y) => Math.sin(x * 0.011) * Math.cos(y * 0.013) * 0.5 + Math.sin(x * 0.027 + y * 0.019) * 0.3 + Math.sin(x * 0.071 - y * 0.053) * 0.2;


  /* ---------------- เมือง: พื้น ถนน ตึก ---------------- */
  const cityTex = canvasTex(512, 512, (g, w, h) => {
    const r = rnd(21); g.fillStyle = "#7d7f7a"; g.fillRect(0, 0, w, h);
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      const k = r(); g.fillStyle = k < 0.25 ? `hsl(95,${25 + r() * 15}%,${30 + r() * 8}%)` : k < 0.75 ? `hsl(40,${4 + r() * 6}%,${48 + r() * 14}%)` : `hsl(30,${10 + r() * 10}%,${40 + r() * 10}%)`;
      g.fillRect(i * 64 + 5, j * 64 + 5, 54, 54);
    }
    g.strokeStyle = "rgba(40,40,40,.5)"; g.lineWidth = 6; for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, h); g.stroke(); g.beginPath(); g.moveTo(0, i * 64); g.lineTo(w, i * 64); g.stroke(); }
  }, true);
  const roadTex = canvasTex(256, 512, (g, w, h) => {
    g.fillStyle = "#3c3e41"; g.fillRect(0, 0, w, h); const r = rnd(5);
    for (let i = 0; i < 1500; i++) { g.fillStyle = `rgba(255,255,255,${r() * 0.05})`; g.fillRect(r() * w, r() * h, 2, 2); }
    g.fillStyle = "#e8e2cf"; [0.25, 0.5, 0.75].forEach((x, i) => { for (let y = 0; y < h; y += 64) g.fillRect(x * w - 2, y, 4, i === 1 ? 64 : 34); });
    g.fillStyle = "#d9b440"; g.fillRect(4, 0, 4, h); g.fillRect(w - 8, 0, 4, h);
  }, true);
  // ด้านหน้าตึก: 1 ช่องลาย = 8 ช่วงเสา (3 ม.) × 8 ชั้น (3.2 ม.) · ไฟหน้าต่างกลางคืนสุ่มเปิดบางห้อง
  function facadeTex(kind) {
    const r = rnd(kind === "glass" ? 77 : 33), W = 512, C = 64;
    const c = document.createElement("canvas"); c.width = W; c.height = W; const g = c.getContext("2d");
    const m = document.createElement("canvas"); m.width = W; m.height = W; const k = m.getContext("2d");
    k.fillStyle = "#000"; k.fillRect(0, 0, W, W);
    g.fillStyle = kind === "glass" ? "#9fb2c2" : "#e9e4da"; g.fillRect(0, 0, W, W);
    for (let j = 0; j < 8; j++) for (let i = 0; i < 8; i++) {
      const x = i * C, y = j * C;
      if (kind === "glass") {
        const gr = g.createLinearGradient(x, y, x + C, y + C); gr.addColorStop(0, "#5f7d96"); gr.addColorStop(1, "#22374a");
        g.fillStyle = gr; g.fillRect(x + 2, y + 3, C - 4, C - 8); g.fillStyle = "rgba(220,230,240,.55)"; g.fillRect(x, y + C - 5, C, 5);
      } else {
        g.fillStyle = "rgba(0,0,0,.08)"; g.fillRect(x, y + C - 8, C, 8);
        const gr = g.createLinearGradient(x, y, x, y + C); gr.addColorStop(0, "#4b5f70"); gr.addColorStop(1, "#1f2a35");
        g.fillStyle = gr; g.fillRect(x + 12, y + 14, C - 24, C - 30);
        g.fillStyle = "rgba(255,255,255,.15)"; g.fillRect(x + 12, y + 14, (C - 24) / 2, 3);
        if (r() < 0.25) { g.fillStyle = "#8d969e"; g.fillRect(x + 20, y + C - 18, C - 40, 6); }   // แอร์
      }
      if (r() < (kind === "glass" ? 0.45 : 0.38)) { k.fillStyle = `hsl(${38 + r() * 14},${60 + r() * 30}%,${55 + r() * 25}%)`; k.fillRect(x + (kind === "glass" ? 3 : 12), y + (kind === "glass" ? 4 : 14), C - (kind === "glass" ? 6 : 24), C - (kind === "glass" ? 10 : 30)); }
    }
    const mk = (cv, srgb) => { const t = new THREE.CanvasTexture(cv); if (srgb) t.colorSpace = THREE.SRGBColorSpace; t.wrapS = t.wrapT = THREE.RepeatWrapping; t.anisotropy = renderer.capabilities.getMaxAnisotropy(); return t; };
    return { map: mk(c, true), mask: mk(m, false) };
  }
  const fConc = facadeTex("conc"), fGlass = facadeTex("glass");
  const cityLit = [];
  cityTex.repeat.set(0.4, 0.4);
  M.city = new THREE.MeshStandardMaterial({ map: cityTex, vertexColors: true, roughness: 0.95 });
  M.road = new THREE.MeshStandardMaterial({ map: roadTex, roughness: 0.85 });
  M.concDS = mat(0xffffff, { map: concreteTex, roughness: 0.85, side: THREE.DoubleSide });
  M.roofMetal = mat(0xdfe3e6, { metalness: 0.6, roughness: 0.35, side: THREE.DoubleSide });
  M.bConc = new THREE.MeshStandardMaterial({ map: fConc.map, emissiveMap: fConc.mask, emissive: 0xffd89a, emissiveIntensity: 0, vertexColors: true, roughness: 0.8 });
  M.bGlass = new THREE.MeshStandardMaterial({ map: fGlass.map, emissiveMap: fGlass.mask, emissive: 0xfff0d0, emissiveIntensity: 0, vertexColors: true, roughness: 0.12, metalness: 0.55, envMapIntensity: 1.2 });
  M.bRoof = new THREE.MeshStandardMaterial({ vertexColors: true, roughness: 0.9 });
  cityLit.push(M.bConc, M.bGlass);
  const B = api.bld || null;
  function lowerB(arr, v) { let lo = 0, hi = arr.length; while (lo < hi) { const m = (lo + hi) >> 1; if (arr[m] < v) lo = m + 1; else hi = m; } return lo; }
  // ตึกในช่วง s0..s1 รวมเป็นก้อนเดียวต่อวัสดุ (ผนังคอนกรีต / ผนังกระจก / หลังคา)
  function addBuildings(g, s0, s1, cx, cy) {
    if (!B) return;
    const a = lowerB(B.s, s0), b = lowerB(B.s, s1); if (b <= a) return;
    const bucket = () => ({ pos: [], nrm: [], uv: [], col: [] });
    const Wc = bucket(), Wg = bucket(), Rf = bucket(), col = new THREE.Color();
    for (let i = a; i < b; i++) {
      const lat = B.lat0 + B.y[i] / 110574, lon = B.lon0 + B.x[i] / B.kx, [wx, wy] = toXY(lat, lon), bx = wx - cx, by = wy - cy;
      const gz = geo.ground(B.s[i]) - 0.4, H = B.h[i], top = gz + H + 0.4;
      let pts = []; for (let j = B.o[i]; j < B.o[i + 1]; j++) pts.push([bx + B.p[j * 2] / 10, by + B.p[j * 2 + 1] / 10]);
      let ar = 0; pts.forEach((p, j) => { const q = pts[(j + 1) % pts.length]; ar += p[0] * q[1] - q[0] * p[1]; });
      if (ar < 0) pts.reverse();
      const hs = ((i * 2654435761) >>> 0) / 4294967296;
      const glass = H >= 32 && hs < 0.65, house = B.k[i] === 1 && H < 12;
      const T = glass ? Wg : Wc;
      if (glass) col.setHSL(0.55 + hs * 0.08, 0.15 + hs * 0.2, 0.55 + hs * 0.25);
      else if (house) col.setHSL(0.08 + hs * 0.08, 0.25 + hs * 0.3, 0.7 + hs * 0.15);
      else col.setHSL(0.09 + hs * 0.05, 0.05 + hs * 0.12, 0.62 + hs * 0.3);
      let per = 0;
      for (let j = 0; j < pts.length; j++) {
        const p = pts[j], q = pts[(j + 1) % pts.length], L = Math.hypot(q[0] - p[0], q[1] - p[1]); if (L < 0.05) continue;
        const nx = (q[1] - p[1]) / L, nz = (q[0] - p[0]) / L;
        const u0 = per / 24, u1 = (per + L) / 24, v1 = H / 25.6; per += L;
        const A = [p[0], gz, -p[1]], Bv = [q[0], gz, -q[1]], B2 = [q[0], top, -q[1]], A2 = [p[0], top, -p[1]];
        [[A, u0, 0], [Bv, u1, 0], [B2, u1, v1], [A, u0, 0], [B2, u1, v1], [A2, u0, v1]].forEach(([v, u, w]) => { T.pos.push(...v); T.nrm.push(nx, 0, nz); T.uv.push(u, w); T.col.push(col.r, col.g, col.b); });
      }
      const tri = THREE.ShapeUtils.triangulateShape(pts.map((p) => new THREE.Vector2(p[0], p[1])), []);
      const rc = house ? new THREE.Color().setHSL(0.03 + hs * 0.04, 0.45, 0.32 + hs * 0.1) : new THREE.Color().setHSL(0.1, 0.03, 0.45 + hs * 0.2);
      tri.forEach((t) => {
        let [i0, i1, i2] = t; const p0 = pts[i0], p1 = pts[i1], p2 = pts[i2];
        if ((p1[0] - p0[0]) * (p2[1] - p0[1]) - (p2[0] - p0[0]) * (p1[1] - p0[1]) < 0) [i1, i2] = [i2, i1];
        [i0, i1, i2].forEach((k) => { Rf.pos.push(pts[k][0], top, -pts[k][1]); Rf.nrm.push(0, 1, 0); Rf.uv.push(0, 0); Rf.col.push(rc.r, rc.g, rc.b); });
      });
    }
    [[Wc, M.bConc], [Wg, M.bGlass], [Rf, M.bRoof]].forEach(([T, m]) => {
      if (!T.pos.length) return;
      const gm = new THREE.BufferGeometry();
      gm.setAttribute("position", new THREE.Float32BufferAttribute(T.pos, 3)); gm.setAttribute("normal", new THREE.Float32BufferAttribute(T.nrm, 3));
      gm.setAttribute("uv", new THREE.Float32BufferAttribute(T.uv, 2)); gm.setAttribute("color", new THREE.Float32BufferAttribute(T.col, 3));
      const me = new THREE.Mesh(gm, m); me.castShadow = true; me.receiveShadow = true; g.add(me);
    });
  }

  /* ---------------- ชิ้นฉาก ---------------- */
  const CHUNK = 400, AHEAD = 4400, BEHIND = 1400;
  const chunks = new Map();
  const root = new THREE.Group(); scene.add(root);
  const geoBox = new THREE.BoxGeometry(1, 1, 1);
  const treeGeo = { trunk: new THREE.CylinderGeometry(0.18, 0.28, 1, 6), crown: new THREE.IcosahedronGeometry(1, 1), cone: new THREE.ConeGeometry(1, 2.4, 7), palmLeaf: new THREE.IcosahedronGeometry(1, 0) };

  function ribbon(cols) {   // cols = [[[x,y,z], [x,y,z], …] per row] → ตาข่ายสามเหลี่ยม
    const rows = cols.length, n = cols[0].length, pos = new Float32Array(rows * n * 3), uv = new Float32Array(rows * n * 2), idx = [];
    for (let j = 0; j < rows; j++) for (let i = 0; i < n; i++) {
      const p = cols[j][i], k = j * n + i; pos.set([p[0], p[2], -p[1]], k * 3); uv.set([p[3] || 0, p[4] || 0], k * 2);
      if (i < n - 1 && j < rows - 1) idx.push(k, k + n, k + 1, k + 1, k + n, k + n + 1);
    }
    const g = new THREE.BufferGeometry(); g.setAttribute("position", new THREE.BufferAttribute(pos, 3)); g.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
    g.setIndex(idx); g.computeVertexNormals(); return g;
  }
  function signTexture(th, en, km) {
    const c = document.createElement("canvas"); c.width = 1024; c.height = 300; const g = c.getContext("2d");
    g.fillStyle = "#f7f7f2"; g.fillRect(0, 0, 1024, 300); g.strokeStyle = "#1b3f8f"; g.lineWidth = 14; g.strokeRect(7, 7, 1010, 286);
    g.fillStyle = "#1b3f8f"; g.textAlign = "center"; g.textBaseline = "middle";
    g.font = "700 120px 'IBM Plex Sans Thai', system-ui"; g.fillText(th, 512, 120);
    g.font = "600 56px system-ui"; g.fillText(en.toUpperCase(), 512, 222);
    if (km !== undefined) { g.font = "500 34px system-ui"; g.textAlign = "right"; g.fillText("กม. " + km, 1000, 272); }
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; t.anisotropy = 8; return t;
  }
  function kmTexture(k) {
    const c = document.createElement("canvas"); c.width = 128; c.height = 160; const g = c.getContext("2d");
    g.fillStyle = "#fafafa"; g.fillRect(0, 0, 128, 160); g.fillStyle = "#111"; g.font = "700 64px system-ui"; g.textAlign = "center"; g.textBaseline = "middle"; g.fillText(String(k), 64, 86);
    const t = new THREE.CanvasTexture(c); t.colorSpace = THREE.SRGBColorSpace; return t;
  }

  function trackAt(g, pts, oc, zf, cx, cy) {
    const off2 = (p, o, dz) => [p.x - Math.sin(p.th) * o, p.y + Math.cos(p.th) * o, zf(p) + dz];
    [oc + 0.5, oc - 0.5].forEach((o) => {
      g.add(new THREE.Mesh(ribbon(pts.map((p) => [off2(p, o - 0.035, 0.17), off2(p, o + 0.035, 0.17)])), M.rail));
      g.add(new THREE.Mesh(ribbon(pts.map((p) => [off2(p, o, 0.04), off2(p, o, 0.17)])), M.railWeb));
    });
    const n = Math.floor((pts[pts.length - 1].s - pts[0].s) / 0.62); if (n < 1) return;
    const sl = new THREE.InstancedMesh(geoBox, M.sleeper, n), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(1, 1, 1), v3 = new THREE.Vector3(), eu = new THREE.Euler();
    let j = 0;
    for (let i = 0; i < n; i++) {
      const s = pts[0].s + i * 0.62; while (j < pts.length - 2 && pts[j + 1].s < s) j++;
      const a = pts[j], b = pts[j + 1], t = (s - a.s) / ((b.s - a.s) || 1);
      const p = { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t, th: a.th + (b.th - a.th) * t, z: zf(a) + (zf(b) - zf(a)) * t };
      const [x, y] = [p.x - Math.sin(p.th) * oc, p.y + Math.cos(p.th) * oc];
      eu.set(0, p.th, 0, "YXZ"); q.setFromEuler(eu); m4.compose(v3.set(x, p.z + 0.02, -y), q, sc.set(0.24, 0.16, 1.85)); sl.setMatrixAt(i, m4);
    }
    sl.receiveShadow = true; g.add(sl);
  }
  function buildChunk(ci) {
    const s0 = ci * CHUNK, s1 = Math.min(geo.total, s0 + CHUNK);
    if (s0 >= geo.total) return null;
    const g = new THREE.Group();
    const mid = geo.at((s0 + s1) / 2), [cx, cy] = toXY(mid.lat, mid.lon);
    g.userData = { cx, cy, lat: mid.lat, lon: mid.lon };
    // เมืองรอบสถานีหลัก (ลำปาง ลำพูน เชียงใหม่ ฯลฯ) อยู่ในแอ่งที่ราบ → ลดภูเขาลงใกล้สถานี
    const town = geo.stations.reduce((m, st) => (st.m ? Math.max(m, clamp01(1 - (Math.abs(st.s - (s0 + s1) / 2) - 1500) / 3500)) : m), 0);
    const hill = hillness(mid.lat) * (1 - town), r = rnd(ci * 7919 + 13);
    // จุดกลางรางทุก 5 ม. (พิกัดภายในชิ้น)
    const P = [];
    for (let s = s0; s <= s1 + 0.01; s += 5) {
      const t = trackPoint(Math.min(s, geo.total));
      P.push({ s, x: t.x - cx, y: t.y - cy, z: t.z, th: t.th, f: geo.flag(s), gz: geo.ground(Math.min(s, geo.total)) });
    }
    const off = (p, o, dz = 0) => [p.x - Math.sin(p.th) * o, p.y + Math.cos(p.th) * o, p.z + dz];
    const isB = (p) => p.f & 2, isT = (p) => p.f & 1, isV = (p) => p.f & 4;
    const urban = !!(api.urban && api.urban(s0 - 200, s1 + 200));
    const under = (p) => isT(p) && p.gz > p.z + 3;   // ใต้ดินกลางเมือง (ผิวดินเรียบ ไม่ใช่ภูเขา)
    // --- ภูมิประเทศ: แถบตั้งฉากกับราง (ละเอียดใกล้ราง หยาบเมื่อไกล)
    const OFFS = [0, 2.4, 3.6, 6, 10, 16, 26, 40, 60, 90, 130, 190, 270, 380, 520, 720, 1000];
    const tRows = [];
    for (let k = 0; k < P.length; k += 4) tRows.push(P[k]);
    if (tRows[tRows.length - 1] !== P[P.length - 1]) tRows.push(P[P.length - 1]);
    const terrainSide = (side) => {
      const cols = tRows.map((p) => {
        const row = [];
        OFFS.forEach((o) => {
          const [x, y] = off(p, o * side), wx = x + cx, wy = y + cy;
          const far = Math.min(1, Math.max(0, (o - 5) / 70));
          let h;
          const el = p.z - p.gz;
          if (urban || Math.abs(el) > 0.8 || under(p)) {
            let base = p.gz;
            if (!isT(p) && el > 0.8 && el < 4.5) base = o < 3.7 ? p.z - 0.55 : o < 7.5 ? p.z - 0.55 + (p.gz - p.z + 0.55) * (o - 3.7) / 3.8 : p.gz;   // คันทางลาด
            else if (!isT(p) && el < -0.8) base = o < 3.7 ? p.z - 0.55 : o < 4.4 ? p.z - 0.55 + (p.gz - p.z + 0.55) * (o - 3.7) / 0.7 : p.gz;   // ร่องทางลงใต้ดิน
            else if (!isT(p) && Math.abs(el) <= 0.8) base = o < 3.7 ? p.z - 0.45 : p.gz - 0.25;
            h = base;
          }
          else if (isB(p)) h = p.z - 2 - Math.min(14, o * 0.8) * (1 - Math.min(1, o / 120)) + far * hill * 30 * noise2(wx, wy);  // หุบน้ำใต้สะพาน
          else if (isT(p)) h = p.z + Math.min(60, 9 + o * 0.9) + hill * 20 * noise2(wx, wy);                              // ภูเขาเหนืออุโมงค์
          else {
            const emb = o < 3.7 ? -0.55 : -1.2 + (1 - hill) * 0;                                                         // คันทาง
            h = p.z + emb + far * (hill * (55 * Math.max(0, noise2(wx, wy) + 0.25) + o * 0.08 * (side > 0 ? 1 : 0.4)) + (1 - hill) * 0.6 * noise2(wx * 3, wy * 3));
          }
          row.push([x, y, h, (wx) / 60, (wy) / 60]);
        });
        return side > 0 ? row : row.slice().reverse();
      });
      const geom = ribbon(cols);
      // สีตามความสูง/ภูมิภาค
      const pos = geom.attributes.position, col = new Float32Array(pos.count * 3), c = new THREE.Color();
      for (let i = 0; i < pos.count; i++) {
        const y = pos.getY(i), n = pos.getX(i) * 0.013 + pos.getZ(i) * 0.017;
        if (hill > 0.3) c.setHSL(0.27 + 0.05 * Math.sin(n), 0.35, 0.36 + Math.min(0.18, Math.max(0, (y - 300) / 1500)));
        else c.setRGB(1, 1, 1);
        col.set([c.r, c.g, c.b], i * 3);
      }
      geom.setAttribute("color", new THREE.BufferAttribute(col, 3));
      const m = new THREE.Mesh(geom, urban ? M.city : hill > 0.3 ? M.forest : M.rice); m.receiveShadow = true; g.add(m);
    };
    terrainSide(1); terrainSide(-1);
    // --- น้ำใต้สะพาน
    const bridgeIdx = P.filter(isB);
    if (bridgeIdx.length > 2) {
      const p = bridgeIdx[Math.floor(bridgeIdx.length / 2)];
      const w = new THREE.Mesh(new THREE.PlaneGeometry(bridgeIdx.length * 5 + 30, 260), M.water);
      w.rotation.x = -Math.PI / 2; w.rotation.z = p.th + Math.PI / 2; w.position.set(p.x, p.z - 11, -p.y); g.add(w);
    }
    // --- หินโรยทาง (ไม่มีบนสะพาน)
    const ballastRows = P.filter((p) => !isB(p)).map((p) => [off(p, -2.0, -0.45), off(p, -1.35, 0.02), off(p, 1.35, 0.02), off(p, 2.0, -0.45)].map((q, i) => [q[0], q[1], q[2], i * 0.5, p.s / 2]));
    if (ballastRows.length > 1) { const m = new THREE.Mesh(ribbon(ballastRows.map((r2) => r2)), M.ballast); m.receiveShadow = true; g.add(m); }
    // --- รางเหล็ก (ขนาดทาง 1 ม.) + หมอนคอนกรีตทุก 0.6 ม.
    [0.5, -0.5].forEach((o) => {
      const head = ribbon(P.map((p) => [off(p, o - 0.035, 0.17), off(p, o + 0.035, 0.17)]));
      const web = ribbon(P.map((p) => [off(p, o, 0.04), off(p, o, 0.17)]));
      const mh = new THREE.Mesh(head, M.rail); mh.castShadow = true; g.add(mh); g.add(new THREE.Mesh(web, M.railWeb));
    });
    const nS = Math.floor((s1 - s0) / 0.62);
    const sl = new THREE.InstancedMesh(geoBox, M.sleeper, nS), m4 = new THREE.Matrix4(), q = new THREE.Quaternion(), sc = new THREE.Vector3(), v3 = new THREE.Vector3(), eu = new THREE.Euler();
    for (let i = 0; i < nS; i++) {
      const s = s0 + i * 0.62, t = trackPoint(s);
      eu.set(0, t.th, 0, "YXZ"); q.setFromEuler(eu);
      m4.compose(v3.set(t.x - cx, t.z + 0.02, -(t.y - cy)), q, sc.set(0.24, 0.16, 1.85)); sl.setMatrixAt(i, m4);
    }
    sl.receiveShadow = true; g.add(sl);
    // --- สะพานเหล็กโครงถัก + ตอม่อ
    if (bridgeIdx.length > 1) {
      const deck = ribbon(bridgeIdx.map((p) => [off(p, -2.2, -0.05), off(p, 2.2, -0.05)])); g.add(new THREE.Mesh(deck, M.steel));
      const under = ribbon(bridgeIdx.map((p) => [off(p, -2.2, -1.2), off(p, 2.2, -1.2)])); g.add(new THREE.Mesh(under, M.steel));
      [2.3, -2.3].forEach((o) => {
        const chordTop = ribbon(bridgeIdx.map((p) => [off(p, o, 5.6), off(p, o, 6.0)]));
        const chordBot = ribbon(bridgeIdx.map((p) => [off(p, o, -1.2), off(p, o, 0.3)]));
        g.add(new THREE.Mesh(chordTop, M.steelRed), new THREE.Mesh(chordBot, M.steelRed));
      });
      const nD = bridgeIdx.length * 2;
      const diag = new THREE.InstancedMesh(geoBox, M.steelRed, nD * 2); let k = 0;
      bridgeIdx.forEach((p, i) => [2.3, -2.3].forEach((o) => {
        const [x, y, z] = off(p, o, 2.4);
        eu.set(0, p.th, (i % 2 ? 1 : -1) * 0.78, "YXZ"); q.setFromEuler(eu);
        m4.compose(v3.set(x, z, -y), q, sc.set(0.18, 7.2, 0.18)); diag.setMatrixAt(k++, m4);
      }));
      diag.count = k; diag.castShadow = true; g.add(diag);
      for (let i = 0; i < bridgeIdx.length; i += 6) {
        const p = bridgeIdx[i], hgt = 16;
        const pier = new THREE.Mesh(geoBox, M.concrete); pier.scale.set(2.2, hgt, 5); pier.position.set(p.x, p.z - 1.2 - hgt / 2, -p.y); pier.rotation.y = p.th; pier.castShadow = true; g.add(pier);
      }
    }
    // --- อุโมงค์: ผนังโค้ง + ไฟ + ปากอุโมงค์
    const tun = P.filter(isT);
    if (tun.length > 1) {
      const ARC = []; for (let a = 0; a <= 12; a++) { const t = Math.PI * a / 12; ARC.push([Math.cos(t) * 3.0, 2.4 + Math.sin(t) * 3.2]); }
      const prof = [[3.0, -0.6]].concat(ARC).concat([[-3.0, -0.6]]);
      const wide = (p) => (geo.stations.some((st) => Math.abs(st.s - p.s) < 140) ? 2.6 : 1);
      const tube = ribbon(tun.map((p) => prof.map(([o, h]) => off(p, o * wide(p), h * (wide(p) > 1 ? 1.25 : 1)))));
      g.add(new THREE.Mesh(tube, M.tunnel));
      for (let i = 0; i < tun.length; i += 5) { const [x, y, z] = off(tun[i], 2.7, 3.4); const l = new THREE.Mesh(geoBox, M.lamp); l.scale.set(0.3, 0.12, 1.2); l.position.set(x, z, -y); l.rotation.y = tun[i].th; g.add(l); }
      [tun[0], tun[tun.length - 1]].forEach((p, e) => {
        const idx = P.indexOf(p), prev = P[idx + (e ? 1 : -1)];
        if (!prev || isT(prev)) return;
        const face = new THREE.Group(); face.position.set(p.x, p.z, -p.y); face.rotation.y = p.th;
        [[0, 6.6, 0, 9, 1.6, 2], [3.9, 2.6, 0, 1.6, 6.6, 2], [-3.9, 2.6, 0, 1.6, 6.6, 2]].forEach(([a, b, c, w, h, d]) => { const bx = new THREE.Mesh(geoBox, M.concrete); bx.scale.set(d, h, w); bx.position.set(c, b, a); face.add(bx); });
        if (p.s > 682000 && p.s < 688000) { const sg = new THREE.Mesh(new THREE.PlaneGeometry(6, 1.1), new THREE.MeshBasicMaterial({ map: signTexture("อุโมงค์ขุนตาน", "Khun Tan Tunnel"), side: THREE.DoubleSide })); sg.position.set(e ? 1.05 : -1.05, 6.6, 0); sg.rotation.y = e ? Math.PI / 2 : -Math.PI / 2; face.add(sg); }
        g.add(face);
      });
    }
    // --- สถานี
    geo.stations.forEach((st) => {
      if (st.s < s0 - 120 || st.s > s1 + 120) return;
      const plat = P.filter((p) => Math.abs(p.s - st.s) <= (st.h ? 45 : 110));
      if (plat.length < 2) return;
      [1, -1].forEach((side) => {
        if (st.h && side < 0) return;
        const elevSt = plat.some(isV);
        if (elevSt && side < 0) return;
        const top = ribbon(plat.map((p) => [off(p, side * 2.0, 0.95), off(p, side * 6.0, 0.95)]));
        const edge = ribbon(plat.map((p) => [off(p, side * 2.0, isV(p) ? -2.3 : -0.4), off(p, side * 2.0, 0.95)]));
        if (elevSt) { const outer = ribbon(plat.map((p) => [off(p, side * 6.0, -2.3), off(p, side * 6.0, 1.15)])); g.add(new THREE.Mesh(outer, M.concDS)); const under2 = ribbon(plat.map((p) => [off(p, side * 2.0, -2.3), off(p, side * 6.0, -2.3)])); g.add(new THREE.Mesh(under2, M.concDS)); }
        const line = ribbon(plat.map((p) => [off(p, side * 2.05, 0.96), off(p, side * 2.35, 0.96)]));
        [top, edge].forEach((gm) => { const m = new THREE.Mesh(gm, M.platform); m.receiveShadow = true; g.add(m); });
        g.add(new THREE.Mesh(line, M.yellow));
        // หลังคาชานชาลา + เสา
        const roofP = plat.filter((p) => Math.abs(p.s - st.s) < 40);
        if (roofP.length > 1) {
          const roof = ribbon(roofP.map((p) => [off(p, side * 2.2, 4.6), off(p, side * 6.2, 4.1)])); const rm = new THREE.Mesh(roof, M.roofRed); rm.castShadow = true; g.add(rm);
          roofP.forEach((p, i) => { if (i % 2) return; const [x, y, z] = off(p, side * 4.2, 0.95); const c2 = new THREE.Mesh(geoBox, M.white); c2.scale.set(0.25, 3.5, 0.25); c2.position.set(x, z + 1.75, -y); g.add(c2); });
        }
        // ป้ายชื่อสถานีสองฝั่งปลายชานชาลา
        [plat[1], plat[plat.length - 2]].forEach((p) => {
          if (!p) return;
          const [x, y, z] = off(p, side * 4.6, 0.95);
          const sm = new THREE.MeshStandardMaterial({ map: signTexture(st.n, st.e || "", (st.s / 1000).toFixed(2)), roughness: 0.6 });
          [0, Math.PI].forEach((rot) => { const board = new THREE.Mesh(new THREE.PlaneGeometry(4.2, 1.25), sm); board.position.set(x, z + 3.0, -y); board.rotation.y = p.th + rot; g.add(board); });
          [-1.8, 1.8].forEach((o) => { const leg = new THREE.Mesh(geoBox, M.pole); leg.scale.set(0.1, 2.4, 0.1); leg.position.set(x + Math.cos(p.th) * o, z + 1.2, -(y + Math.sin(p.th) * o)); g.add(leg); });
        });
      });
      // หลังคาโค้งใหญ่ของสถานียกระดับ
      const platV = plat.filter(isV);
      if (platV.length > 1) {
        const arch = ribbon(platV.map((p) => [off(p, -7.6, 6.2), off(p, -4.5, 7.8), off(p, -1, 8.5), off(p, 2.5, 8.4), off(p, 5.5, 7.6), off(p, 7.2, 6.2)]));
        const am = new THREE.Mesh(arch, M.roofMetal); am.castShadow = true; g.add(am);
        platV.forEach((p, i) => { if (i % 4) return; [-7.0, 6.6].forEach((o) => { const [x, y, z] = off(p, o, -2.3); const c2 = new THREE.Mesh(geoBox, M.white); c2.scale.set(0.35, 8.6, 0.35); c2.position.set(x, z + 4.3, -y); g.add(c2); }); });
      }
      // อาคารสถานี (หลังคาจั่วทรงไทย) — เฉพาะสถานีระดับดินนอกเมือง
      if (!st.h && !platV.length && !plat.some(isT) && !urban) {
        const p = P.reduce((a, b) => (Math.abs(b.s - st.s) < Math.abs(a.s - st.s) ? b : a));
        const [x, y, z] = off(p, 13, 0.6);
        const bld = new THREE.Group(); bld.position.set(x, z, -y); bld.rotation.y = p.th;
        const wall = new THREE.Mesh(geoBox, M.wallCream); wall.scale.set(st.m ? 34 : 18, 4.2, 8); wall.position.y = 2.1; wall.castShadow = wall.receiveShadow = true; bld.add(wall);
        const roofG = new THREE.CylinderGeometry(0.01, 6.2, 3.8, 4, 1, false, Math.PI / 4); const roof = new THREE.Mesh(roofG, M.roofRed);
        roof.scale.set(1, 1, (st.m ? 34 : 18) / 8.8); roof.rotation.y = 0; roof.position.y = 6.0; roof.rotation.set(0, Math.PI / 4, 0);
        const roof2 = new THREE.Mesh(new THREE.BoxGeometry(st.m ? 35 : 19, 0.4, 9.4), M.roofRed); roof2.position.y = 4.4; bld.add(roof2);
        const gable = new THREE.Mesh(new THREE.CylinderGeometry(0, 5.2, 3.2, 3, 1), M.roofRed); gable.rotation.z = Math.PI / 2; gable.rotation.y = 0; gable.scale.set(1, (st.m ? 34 : 18) / 3.2 * 0.95, 1); gable.position.y = 6.0;
        const gb = new THREE.Mesh(new THREE.BoxGeometry(st.m ? 34 : 18, 0.01, 0.01), M.roofRed); bld.add(gb);
        const prism = new THREE.Shape(); prism.moveTo(-4.7, 0); prism.lineTo(0, 3.4); prism.lineTo(4.7, 0); prism.lineTo(-4.7, 0);
        const pg = new THREE.ExtrudeGeometry(prism, { depth: st.m ? 34 : 18, bevelEnabled: false }); pg.translate(0, 0, -(st.m ? 34 : 18) / 2); pg.rotateY(Math.PI / 2);
        const pm = new THREE.Mesh(pg, M.roofRed); pm.position.y = 4.4; pm.castShadow = true; bld.add(pm);
        g.add(bld);
      }
    });
    // --- หลักกิโลเมตร
    for (let k = Math.ceil(s0 / 1000); k * 1000 <= s1; k++) {
      const t = trackPoint(k * 1000); const x = t.x - cx - Math.sin(t.th) * 3.2, y = t.y - cy + Math.cos(t.th) * 3.2;
      const post = new THREE.Mesh(new THREE.BoxGeometry(0.4, 1.0, 0.25), [M.white, M.white, M.white, M.white, new THREE.MeshBasicMaterial({ map: kmTexture(k) }), new THREE.MeshBasicMaterial({ map: kmTexture(k) })]);
      post.position.set(x, t.z + 0.2, -y); post.rotation.y = t.th + Math.PI / 2; g.add(post);
    }
    // --- เสาไฟฟ้า + สายส่ง (เฉพาะรถไฟฟ้า/ความเร็วสูง)
    if (api.electric()) {
      const poles = P.filter((p, i) => i % 10 === 0 && !isT(p));
      poles.forEach((p) => {
        const [x, y, z] = off(p, 3.0, 0); const pl = new THREE.Mesh(geoBox, M.pole); pl.scale.set(0.3, 7.2, 0.3); pl.position.set(x, z + 3.6, -y); g.add(pl);
        const [ax, ay, az] = off(p, 1.2, 6.6); const arm = new THREE.Mesh(geoBox, M.pole); arm.scale.set(0.1, 0.1, 3.6); arm.position.set((x + ax) / 2, az, -(y + ay) / 2); arm.rotation.y = p.th; g.add(arm);
      });
      const wire = ribbon(P.map((p) => [off(p, -0.02, 5.6), off(p, 0.02, 5.6)])); g.add(new THREE.Mesh(wire, M.wire));
      const mess = ribbon(P.map((p) => [off(p, -0.02, 6.6), off(p, 0.02, 6.6)])); g.add(new THREE.Mesh(mess, M.wire));
    }
    // --- ต้นไม้ / ต้นตาล / บ้านชนบท
    const nTree = Math.round(urban ? 45 : hill > 0.3 ? 420 : 140), trees = [];
    for (let i = 0; i < nTree; i++) {
      const p = P[Math.floor(r() * P.length)], side = r() < 0.5 ? -1 : 1, o = 14 + Math.pow(r(), 1.4) * (hill > 0.3 ? 500 : 380);
      if ((isT(p) && !under(p)) || isB(p)) continue;
      const [x, y] = off(p, o * side);
      if (geo.stations.some((st) => Math.abs(st.s - p.s) < 130) && o < 30) continue;
      const far = Math.min(1, Math.max(0, (o - 5) / 70)), wx = x + cx, wy = y + cy;
      const h = (urban || Math.abs(p.z - p.gz) > 0.8 || under(p)) ? p.gz - 0.3 : p.z - 1.2 + far * (hill * (55 * Math.max(0, noise2(wx, wy) + 0.25) + o * 0.08 * (side > 0 ? 1 : 0.4)) + (1 - hill) * 0.6 * noise2(wx * 3, wy * 3));
      trees.push([x, y, h, 0.7 + r() * 0.9, hill > 0.3 ? (r() < 0.6 ? 0 : 2) : (r() < 0.5 ? 1 : 0)]);
    }
    const addTrees = (kind, geom, material, yOff, scaleY) => {
      const list = trees.filter((t) => t[4] === kind); if (!list.length) return;
      const im = new THREE.InstancedMesh(geom, material, list.length), cc = new THREE.Color();
      list.forEach((t, i) => {
        m4.compose(v3.set(t[0], t[2] + yOff * t[3], -t[1]), q.identity(), sc.set(t[3] * (kind === 1 ? 2.6 : 2.2), t[3] * scaleY, t[3] * (kind === 1 ? 2.6 : 2.2)));
        im.setMatrixAt(i, m4); if (material === M.leaf || material === M.palm) im.setColorAt(i, cc.setHSL(0.24 + r() * 0.1, 0.5 + r() * 0.2, 0.08 + r() * 0.1));
      });
      im.castShadow = true; g.add(im);
    };
    addTrees(0, treeGeo.crown, M.leaf, 4.2, 2.0); addTrees(2, treeGeo.cone, M.leaf, 4.6, 3.0);
    addTrees(1, treeGeo.palmLeaf, M.palm, 9.6, 0.9);
    const tr2 = trees.filter((t) => t[4] !== 2 || true);
    if (tr2.length) {
      const tk = new THREE.InstancedMesh(treeGeo.trunk, M.trunk, tr2.length);
      tr2.forEach((t, i) => { const tall = t[4] === 1 ? 9.5 : 3.6; m4.compose(v3.set(t[0], t[2] + tall * t[3] / 2, -t[1]), q.identity(), sc.set(t[3], tall * t[3], t[3])); tk.setMatrixAt(i, m4); });
      tk.castShadow = true; g.add(tk);
    }
    // บ้านเรือนใกล้สถานี
    if (!urban) geo.stations.forEach((st) => {
      if (st.s < s0 || st.s > s1) return;
      const nH = st.m ? 30 : 12, hb = new THREE.InstancedMesh(geoBox, M.house, nH), hr = new THREE.InstancedMesh(geoBox, M.houseRoof, nH);
      for (let i = 0; i < nH; i++) {
        const p = P[Math.floor(r() * P.length)], side = r() < 0.5 ? -1 : 1, o = 30 + r() * 140;
        const [x, y] = off(p, o * side), w = 6 + r() * 6, d = 6 + r() * 5, h = 3 + r() * 3;
        eu.set(0, p.th + (r() - 0.5) * 0.4, 0, "YXZ"); q.setFromEuler(eu);
        m4.compose(v3.set(x, p.z + h / 2 - 1, -y), q, sc.set(w, h, d)); hb.setMatrixAt(i, m4);
        m4.compose(v3.set(x, p.z + h - 0.6, -y), q, sc.set(w + 0.8, 0.6, d + 0.8)); hr.setMatrixAt(i, m4);
      }
      hb.castShadow = hr.castShadow = true; g.add(hb, hr);
    });
    // --- ทางยกระดับ (แนวแอร์พอร์ตลิงก์): พื้นสะพาน ราวกันตก ตอม่อ รางคู่ฝั่งซ้าย ถนนใต้สะพาน
    const via = P.filter(isV);
    if (via.length > 1) {
      const W0 = -6.6, W1 = 2.6;
      g.add(new THREE.Mesh(ribbon(via.map((p) => [off(p, W0, -0.5), off(p, W1, -0.5)])), M.concDS));
      g.add(new THREE.Mesh(ribbon(via.map((p) => [off(p, W0 + 1.2, -2.3), off(p, W1 - 1.2, -2.3)])), M.concDS));
      [[W0, W0 + 1.2], [W1, W1 - 1.2]].forEach(([e, i]) => g.add(new THREE.Mesh(ribbon(via.map((p) => [off(p, i, -2.3), off(p, e, -0.9), off(p, e, 1.1), off(p, e + Math.sign(i - e) * 0.25, 1.1), off(p, e + Math.sign(i - e) * 0.25, -0.5)])), M.concDS)));
      for (let i = 0; i < via.length; i += 6) {
        const p = via[i], hp = p.z - 2.3 - p.gz; if (hp < 1.5) continue;
        const [x, y] = off(p, (W0 + W1) / 2);
        const pier = new THREE.Mesh(geoBox, M.concrete); pier.scale.set(2.0, hp, 2.6); pier.position.set(x, p.gz + hp / 2, -y); pier.rotation.y = p.th; pier.castShadow = true; g.add(pier);
        const cap = new THREE.Mesh(geoBox, M.concrete); cap.scale.set(1.8, 1.2, 8.4); cap.position.set(x, p.z - 2.9, -y); cap.rotation.y = p.th; g.add(cap);
      }
      trackAt(g, via, -4.2, (p) => p.z, cx, cy);
      if (urban) g.add(new THREE.Mesh(ribbon(via.map((p) => [off(p, -13, 0, ), off(p, 9, 0)].map((q, k) => [q[0], q[1], p.gz + 0.04, k * 2.75, p.s / 16]))), M.road));
    }
    // --- ทางแยกที่อุรุพงษ์: รางสายตะวันออกระดับดิน ค่อย ๆ แยกออกข้างทางลาด
    const br = api.branch;
    if (br && s1 > br.s0 && s0 < br.s1) {
      const sm = (t) => { t = clamp01(t); return t * t * (3 - 2 * t); };
      const bp = P.filter((p) => p.s >= br.s0 && p.s <= br.s1).map((p) => { const o = br.side * br.off * sm((p.s - br.s0) / br.div); const [x, y] = off(p, o); return { s: p.s, x, y, z: p.gz, th: p.th, gz: p.gz }; });
      if (bp.length > 1) {
        const bal = ribbon(bp.map((p) => [off(p, -2.0, -0.45), off(p, -1.35, 0.02), off(p, 1.35, 0.02), off(p, 2.0, -0.45)].map((q, i) => [q[0], q[1], q[2], i * 0.5, p.s / 2])));
        const bm = new THREE.Mesh(bal, M.ballast); bm.receiveShadow = true; g.add(bm);
        trackAt(g, bp, 0, (p) => p.z, cx, cy);
      }
    }
    addBuildings(g, s0, s1, cx, cy);
    g.traverse((o) => { if (o.isMesh && o.castShadow === undefined) o.castShadow = false; });
    return g;
  }
  function placeChunk(g) { g.position.set(g.userData.cx, 0, -g.userData.cy); }
  function refreshChunks(sNow) {
    const a = Math.floor((sNow - BEHIND) / CHUNK), b = Math.floor((sNow + AHEAD) / CHUNK);
    let built = 0;
    for (let i = Math.max(0, a); i <= b; i++) {
      if (chunks.has(i)) continue;
      if (built >= 2) break;   // สร้างไม่เกิน 2 ชิ้นต่อเฟรม กันกระตุก
      const g = buildChunk(i); if (!g) continue;
      placeChunk(g); root.add(g); chunks.set(i, g); built++;
    }
    chunks.forEach((g, i) => { if (i < a - 1 || i > b + 1) { root.remove(g); g.traverse((o) => { if (o.geometry && o.geometry !== geoBox && !Object.values(treeGeo).includes(o.geometry)) o.geometry.dispose(); }); chunks.delete(i); } });
    return built;
  }
  function recenter(lat, lon) {
    setOrigin(lat, lon);
    chunks.forEach((g) => { const [x, y] = toXY(g.userData.lat, g.userData.lon); g.userData.cx = x; g.userData.cy = y; placeChunk(g); });
  }

  /* ---------------- ขบวนรถ ----------------
     ตัวรถทุกคันสร้างจาก "รูปด้านข้าง" (profile) แล้วรีดออกตามความกว้าง + ลบมุมโค้ง (bevel)
     → หลังคาโค้งมน หน้ารถลาดเอียง แล้วบีบความกว้างช่วงหัวรถ (taper) ให้เป็นทรงลู่ลมแบบ 3 มิติ
     ลายรถ/หน้าต่าง/ประตู วาดลงพื้นผิวด้านข้าง (canvas texture) + สีบนหลังคา/หน้ารถเป็นสีต่อจุด (vertex color)
     สะท้อนท้องฟ้าด้วย environment map ที่สร้างจากท้องฟ้าจริงของฉาก */
  const trainRoot = new THREE.Group(); scene.add(trainRoot);
  let cars = [], carsKey = "";
  const pmrem = new THREE.PMREMGenerator(renderer);
  let envTex = null;
  const trainMats = [], litMats = [];
  function updateEnvMap() {
    try {
      const es = new THREE.Scene();
      es.add(new THREE.Mesh(new THREE.SphereGeometry(40, 32, 16), skyMat));
      const gnd = new THREE.Mesh(new THREE.CircleGeometry(40, 32), new THREE.MeshBasicMaterial({ color: env.tod === "night" ? 0x0a0d0a : 0x4a5a36 }));
      gnd.rotation.x = -Math.PI / 2; gnd.position.y = -1.5; es.add(gnd);
      const rt = pmrem.fromScene(es, 0.03, 0.1, 90);
      if (envTex) envTex.dispose();
      envTex = rt.texture;
      trainMats.concat([M.bGlass]).forEach((m) => { m.envMap = envTex; m.needsUpdate = true; });
    } catch (e) { /* เครื่องที่ไม่รองรับ: ไม่มีเงาสะท้อน */ }
  }
  const lampW = new THREE.MeshBasicMaterial({ color: 0xfff6e0 }), lampR = new THREE.MeshBasicMaterial({ color: 0xff2a1a });
  const rubber = mat(0x1a1c1f, { roughness: 0.95 }), under = mat(0x2a2d31, { roughness: 0.8, metalness: 0.3 });
  const wheelM = mat(0x55585c, { metalness: 0.9, roughness: 0.35 }), frameM = mat(0x23262a, { roughness: 0.6, metalness: 0.4 });
  const insul = mat(0xe8e2d0, { roughness: 0.5 }), pantoM = mat(0x9aa1a8, { metalness: 0.8, roughness: 0.3 });
  const glassM = mat(0x0c1218, { metalness: 0.9, roughness: 0.06 });
  [glassM, wheelM, pantoM].forEach((m) => trainMats.push(m));

  // ปรับ normal ให้ผิวเรียบ แต่คงขอบคม (มุมเกิน deg องศา)
  function smoothNormals(g, deg) {
    const p = g.attributes.position, n = p.count, fn = new Float32Array(n * 3);
    const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3();
    for (let i = 0; i < n; i += 3) {
      a.fromBufferAttribute(p, i); b.fromBufferAttribute(p, i + 1); c.fromBufferAttribute(p, i + 2);
      c.sub(b); a.sub(b); c.cross(a);
      for (let k = 0; k < 3; k++) fn.set([c.x, c.y, c.z], (i + k) * 3);
    }
    const groups = new Map();
    for (let i = 0; i < n; i++) {
      const k = Math.round(p.getX(i) * 500) + "," + Math.round(p.getY(i) * 500) + "," + Math.round(p.getZ(i) * 500);
      let l = groups.get(k); if (!l) groups.set(k, (l = [])); l.push(i);
    }
    const out = new Float32Array(n * 3), cs = Math.cos(deg * Math.PI / 180);
    groups.forEach((l) => l.forEach((i) => {
      const ix = fn[i * 3], iy = fn[i * 3 + 1], iz = fn[i * 3 + 2], il = Math.hypot(ix, iy, iz) || 1;
      let x = 0, y = 0, z = 0;
      l.forEach((j) => {
        const jx = fn[j * 3], jy = fn[j * 3 + 1], jz = fn[j * 3 + 2], jl = Math.hypot(jx, jy, jz) || 1;
        if ((ix * jx + iy * jy + iz * jz) / (il * jl) >= cs) { x += jx; y += jy; z += jz; }
      });
      const L = Math.hypot(x, y, z) || 1; out[i * 3] = x / L; out[i * 3 + 1] = y / L; out[i * 3 + 2] = z / L;
    }));
    g.setAttribute("normal", new THREE.BufferAttribute(out, 3));
  }
  const hexRGB = (h) => [((h >> 16) & 255) / 255, ((h >> 8) & 255) / 255, (h & 255) / 255].map((v) => Math.pow(v, 2.2));
  // ตัวรถ: profile(shape) = รูปด้านข้าง (x ตามยาว, y สูง) · zs(x) = สัดส่วนความกว้าง · wall(x,y) = สีหลังคา/หน้ารถ
  const geoCache = new Map();
  function bodyGeo(key, w, bevel, profile, zs, wall) {
    if (geoCache.has(key)) return geoCache.get(key);
    const raw = new THREE.Shape(); profile(raw);
    // แบ่งเส้นตรงสั้น ๆ (หน้ารถ/กระจก) ให้ละเอียด เพื่อให้สีต่อจุดเป็นแถบคมชัด ไม่ไล่เฉด
    const src = raw.getPoints(28), pts = [];
    src.forEach((q, i) => {
      const nq = src[(i + 1) % src.length], d = q.distanceTo(nq);
      pts.push(q);
      if (i < src.length - 1 && d < 4.5 && d > 0.1) { const n = Math.ceil(d / 0.06); for (let k = 1; k < n; k++) pts.push(q.clone().lerp(nq, k / n)); }
    });
    const shape = new THREE.Shape(pts);
    const depth = w - 2 * bevel;
    const g = new THREE.ExtrudeGeometry(shape, { depth, bevelEnabled: true, bevelThickness: bevel, bevelSize: bevel, bevelOffset: -bevel, bevelSegments: 5, curveSegments: 1, steps: 1 });
    g.translate(0, 0, -depth / 2);
    const p = g.attributes.position;
    for (let i = 0; i < p.count; i++) { const s = zs ? zs(p.getX(i), p.getY(i)) : 1; if (s !== 1) p.setZ(i, p.getZ(i) * s); }
    smoothNormals(g, 50);
    const col = new Float32Array(p.count * 3), cap = g.groups[0];
    for (let i = 0; i < p.count; i++) {
      const isCap = i >= cap.start && i < cap.start + cap.count;
      col.set(isCap ? [1, 1, 1] : hexRGB(wall(p.getX(i), p.getY(i))), i * 3);
    }
    g.setAttribute("color", new THREE.BufferAttribute(col, 3));
    geoCache.set(key, g); return g;
  }
  // ลายด้านข้าง: วาดเป็นเมตร (x: −len/2..len/2, y: y0..y1) → texture สี + texture ไฟหน้าต่างตอนกลางคืน
  const texCache = new Map();
  function livery(key, len, y0, y1, draw) {
    if (texCache.has(key)) return texCache.get(key);
    const PX = 64, W = Math.round(len * PX), H = Math.round((y1 - y0) * PX);
    const c = document.createElement("canvas"); c.width = W; c.height = H; const g = c.getContext("2d");
    const m = document.createElement("canvas"); m.width = W; m.height = H; const k = m.getContext("2d");
    k.fillStyle = "#000"; k.fillRect(0, 0, W, H);
    const X = (x) => (x + len / 2) * PX, Y = (y) => H - (y - y0) * PX;
    const api = {
      g, X, Y,
      band(ya, yb, col) { g.fillStyle = col; g.fillRect(0, Y(yb), W, Y(ya) - Y(yb)); },
      rect(x0, x1, ya, yb, col) { g.fillStyle = col; g.fillRect(X(x0), Y(yb), X(x1) - X(x0), Y(ya) - Y(yb)); },
      win(x0, x1, ya, yb, r = 0.12, lit = true) {
        const x = X(x0), y = Y(yb), w = X(x1) - X(x0), h = Y(ya) - Y(yb), rr = r * PX;
        const gr = g.createLinearGradient(x, y, x + w * 0.6, y + h);
        gr.addColorStop(0, "#5d7286"); gr.addColorStop(0.35, "#1a2633"); gr.addColorStop(1, "#0b1118");
        g.fillStyle = "#2b2f35"; g.beginPath(); g.roundRect(x - 3, y - 3, w + 6, h + 6, rr + 3); g.fill();
        g.fillStyle = gr; g.beginPath(); g.roundRect(x, y, w, h, rr); g.fill();
        g.fillStyle = "rgba(255,255,255,.10)"; g.beginPath(); g.moveTo(x + w * 0.15, y); g.lineTo(x + w * 0.42, y); g.lineTo(x + w * 0.12, y + h); g.lineTo(x - w * 0.15 + w * 0.15, y + h); g.fill();
        if (lit) { k.fillStyle = "#fff"; k.beginPath(); k.roundRect(x, y, w, h, rr); k.fill(); }
      },
      door(x0, x1, ya, yb, col, leaves = 1) {
        g.fillStyle = col; g.fillRect(X(x0), Y(yb), X(x1) - X(x0), Y(ya) - Y(yb));
        g.strokeStyle = "rgba(0,0,0,.55)"; g.lineWidth = 3; g.strokeRect(X(x0), Y(yb), X(x1) - X(x0), Y(ya) - Y(yb));
        if (leaves === 2) { g.beginPath(); g.moveTo((X(x0) + X(x1)) / 2, Y(yb)); g.lineTo((X(x0) + X(x1)) / 2, Y(ya)); g.stroke(); }
        const n = leaves, ww = (x1 - x0) / n;
        for (let i = 0; i < n; i++) api.win(x0 + ww * i + ww * 0.2, x0 + ww * (i + 1) - ww * 0.2, yb - 0.95, yb - 0.25, 0.08);
      },
      louvre(x0, x1, ya, yb) { g.fillStyle = "rgba(0,0,0,.18)"; g.fillRect(X(x0), Y(yb), X(x1) - X(x0), Y(ya) - Y(yb)); g.strokeStyle = "rgba(0,0,0,.35)"; g.lineWidth = 2; for (let x = X(x0) + 4; x < X(x1); x += 7) { g.beginPath(); g.moveTo(x, Y(yb) + 3); g.lineTo(x, Y(ya) - 3); g.stroke(); } },
      dirt() { const gr = g.createLinearGradient(0, H * 0.6, 0, H); gr.addColorStop(0, "rgba(60,45,30,0)"); gr.addColorStop(1, "rgba(60,45,30,.28)"); g.fillStyle = gr; g.fillRect(0, 0, W, H); },
      panelLines(step) { g.strokeStyle = "rgba(0,0,0,.10)"; g.lineWidth = 2; for (let x = -len / 2 + step; x < len / 2; x += step) { g.beginPath(); g.moveTo(X(x), 0); g.lineTo(X(x), H); g.stroke(); } }
    };
    draw(api);
    const mk = (cv) => { const t = new THREE.CanvasTexture(cv); t.anisotropy = renderer.capabilities.getMaxAnisotropy(); t.repeat.set(1 / len, 1 / (y1 - y0)); t.offset.set(0.5, -y0 / (y1 - y0)); return t; };
    const map = mk(c); map.colorSpace = THREE.SRGBColorSpace;
    const r = { map, mask: mk(m) }; texCache.set(key, r); return r;
  }
  function bodyMats(key, tex, o) {
    const capM = new THREE.MeshStandardMaterial(Object.assign({ map: tex.map, emissiveMap: tex.mask, emissive: 0xffd99a, emissiveIntensity: 0, vertexColors: true, envMap: envTex, envMapIntensity: 0.9 }, o));
    const wallM = new THREE.MeshStandardMaterial(Object.assign({ vertexColors: true, envMap: envTex, envMapIntensity: 0.9 }, o));
    trainMats.push(capM, wallM); litMats.push(capM);
    return [capM, wallM];
  }
  const matCache = new Map();
  function body(gp, key, geo, tex, o) {
    if (!matCache.has(key)) matCache.set(key, bodyMats(key, tex, o));
    const m = new THREE.Mesh(geo, matCache.get(key)); m.castShadow = true; m.receiveShadow = true; gp.add(m); return m;
  }
  const box = (gp, m, sx, sy, sz, x, y, z, shadow = false) => { const b = new THREE.Mesh(geoBox, m); b.scale.set(sx, sy, sz); b.position.set(x, y, z); b.castShadow = shadow; gp.add(b); return b; };
  const cylG = new THREE.CylinderGeometry(1, 1, 1, 16);
  function rod(gp, m, a, b, r) {   // ท่อกลมจากจุด a ไป b
    const v = new THREE.Vector3().subVectors(b, a), c = new THREE.Mesh(cylG, m);
    c.scale.set(r, v.length(), r); c.position.copy(a).addScaledVector(v, 0.5);
    c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), v.normalize()); gp.add(c); return c;
  }
  function lamp(gp, m, x, y, z, r = 0.14) { const l = new THREE.Mesh(new THREE.SphereGeometry(r, 14, 10), m); l.scale.set(0.5, 1, 1); l.position.set(x, y, z); gp.add(l); return l; }
  const wheelG = new THREE.CylinderGeometry(0.43, 0.43, 0.12, 22), hubG = new THREE.CylinderGeometry(0.2, 0.2, 0.16, 12);
  function bogie(gp, x, skirt) {
    const b = new THREE.Group(); b.position.set(x, 0, 0); gp.add(b);
    [-0.78, 0.78].forEach((z) => {
      box(b, frameM, 2.7, 0.32, 0.14, 0, 0.62, z);                       // โครงข้าง
      box(b, frameM, 0.5, 0.5, 0.16, 0, 0.75, z);                        // แป้นรับสปริง
      [-1.05, 1.05].forEach((dx) => { box(b, mat(0x3a3d41), 0.34, 0.3, 0.2, dx, 0.45, z * 1.08); });   // กล่องเพลา
      rod(b, mat(0x8a5a2a, { metalness: 0.5 }), new THREE.Vector3(-0.45, 0.82, z), new THREE.Vector3(-0.45, 1.08, z), 0.09);
      rod(b, mat(0x8a5a2a, { metalness: 0.5 }), new THREE.Vector3(0.45, 0.82, z), new THREE.Vector3(0.45, 1.08, z), 0.09);
    });
    box(b, frameM, 0.5, 0.26, 1.5, 0, 0.72, 0);                          // คานกลาง
    [-1.05, 1.05].forEach((dx) => {
      [-0.5, 0.5].forEach((z) => { const w = new THREE.Mesh(wheelG, wheelM); w.rotation.x = Math.PI / 2; w.position.set(dx, 0.43, z); b.add(w); const h = new THREE.Mesh(hubG, frameM); h.rotation.x = Math.PI / 2; h.position.set(dx, 0.43, z * 1.25); b.add(h); });
      rod(b, frameM, new THREE.Vector3(dx, 0.43, -0.6), new THREE.Vector3(dx, 0.43, 0.6), 0.07).rotation.order = "XYZ";
    });
    if (skirt) { box(b, skirt, 3.2, 0.42, 0.05, 0, 0.92, 1.42); box(b, skirt, 3.2, 0.42, 0.05, 0, 0.92, -1.42); }
  }
  function gangway(gp, x) { box(gp, rubber, 0.42, 2.45, 1.9, x, 2.45, 0); }
  function pantograph(gp, x, y) {
    const p = new THREE.Group(); p.position.set(x, y, 0); gp.add(p);
    [[-0.7, -0.5], [-0.7, 0.5], [0.7, -0.5], [0.7, 0.5]].forEach(([a, b]) => rod(p, insul, new THREE.Vector3(a, 0, b), new THREE.Vector3(a, 0.28, b), 0.07));
    box(p, frameM, 1.7, 0.1, 1.2, 0, 0.32, 0);
    [-0.35, 0.35].forEach((z) => {
      rod(p, pantoM, new THREE.Vector3(-0.6, 0.38, z * 0.9), new THREE.Vector3(0.55, 1.05, z * 0.5), 0.035);
      rod(p, pantoM, new THREE.Vector3(0.55, 1.05, z * 0.5), new THREE.Vector3(-0.25, 1.7, z * 0.2), 0.03);
    });
    box(p, pantoM, 0.28, 0.05, 1.7, -0.25, 1.74, 0);
    [-0.85, 0.85].forEach((z) => rod(p, pantoM, new THREE.Vector3(-0.25, 1.74, z), new THREE.Vector3(-0.25, 1.6, z * 1.12), 0.025));
  }

  /* ----- ลาย / รูปร่างแต่ละแบบ ----- */
  const STRIPE = (bands, base) => (x, y) => { for (const [a, b, c] of bands) if (y >= a && y <= b) return c; return base; };
  function makeCoach(gp, len) {
    const y0 = 1.15, y1 = 4.05;
    const wallC = STRIPE([[0, 1.42, 0x8d9196], [2.1, 2.2, 0xb3262e], [2.25, 3.32, 0x1e3f7a], [3.88, 9, 0xbfc3c8]], 0xece7dc);
    const geo = bodyGeo("coach" + len, 2.9, 0.32, (s) => { s.moveTo(-len / 2, y0); s.lineTo(len / 2, y0); s.lineTo(len / 2, y1); s.lineTo(-len / 2, y1); s.closePath(); }, null, wallC);
    const tex = livery("coach" + len, len, y0, y1, (L) => {
      L.band(y0, y1, "#ece7dc"); L.band(y0, 1.42, "#8d9196"); L.band(2.1, 2.2, "#b3262e"); L.band(2.25, 3.32, "#1e3f7a"); L.band(3.88, y1, "#bfc3c8");
      for (let i = 0; i < 9; i++) { const x = -len / 2 + 2.35 + i * (len - 4.7) / 9; L.win(x + 0.12, x + (len - 4.7) / 9 - 0.12, 2.42, 3.16, 0.14); }
      [-len / 2 + 0.75, len / 2 - 1.75].forEach((x) => L.door(x, x + 1.0, 1.3, 3.45, "#ddd7ca"));
      L.panelLines(2.2); L.dirt();
    });
    body(gp, "coach", geo, tex, { metalness: 0.25, roughness: 0.42 });
    box(gp, mat(0xa9adb2, { metalness: 0.4, roughness: 0.5 }), 2.6, 0.32, 1.5, 0, y1 + 0.12, 0, true);     // แอร์บนหลังคา
    box(gp, under, len - 7.5, 0.5, 2.1, 0, 0.92, 0);                                                    // อุปกรณ์ใต้ท้อง
    bogie(gp, len / 2 - 2.6); bogie(gp, -len / 2 + 2.6);
    gangway(gp, len / 2 + 0.2); gangway(gp, -len / 2 - 0.2);
  }
  function makeLoco(gp, len) {
    const y0 = 1.25, cabX = len / 2 - 3.6;
    const prof = (s) => { s.moveTo(-len / 2, y0); s.lineTo(len / 2 - 0.15, y0); s.lineTo(len / 2, y0 + 0.25); s.lineTo(len / 2, 2.85); s.lineTo(len / 2 - 0.5, 3.85); s.quadraticCurveTo(len / 2 - 0.7, 4.15, len / 2 - 1.1, 4.15); s.lineTo(cabX, 4.15); s.lineTo(cabX, 3.72); s.lineTo(-len / 2 + 0.5, 3.72); s.quadraticCurveTo(-len / 2, 3.72, -len / 2, 3.3); s.closePath(); };
    const zs = (x) => (x < cabX - 0.25 ? 0.76 : x < cabX ? 0.76 + 0.24 * (x - cabX + 0.25) / 0.25 : x > len / 2 - 0.5 ? 1 - 0.1 * (x - len / 2 + 0.5) / 0.5 : 1);
    const wallC = (x, y) => (x > len / 2 - 0.55 && y > 2.95 && y < 3.8 && Math.abs(0) === 0 ? 0x0e141a : y < 1.75 && y > 1.35 ? 0x1b2f6b : y > 1.8 && y < 1.97 ? 0xf1e3c0 : y > 4.1 ? 0x3a3d42 : 0xd9541e);
    const geo = bodyGeo("loco" + len, 2.95, 0.16, prof, zs, wallC);
    const tex = livery("loco" + len, len, y0, 4.15, (L) => {
      L.band(y0, 4.15, "#d9541e"); L.band(1.35, 1.75, "#1b2f6b"); L.band(1.8, 1.97, "#f1e3c0");
      for (let x = -len / 2 + 1.2; x < cabX - 1.5; x += 2.6) L.louvre(x, x + 1.9, 2.3, 3.4);
      L.win(len / 2 - 2.95, len / 2 - 1.35, 2.95, 3.72, 0.12, false);
      L.door(cabX + 0.12, cabX + 0.82, 1.45, 3.75, "#c94a17"); L.dirt();
    });
    body(gp, "loco", geo, tex, { metalness: 0.3, roughness: 0.38 });
    // ทางเดินรอบตัวรถ + ราวกันตก
    box(gp, frameM, len - 0.2, 0.16, 2.95, 0, y0 - 0.02, 0, true);
    box(gp, mat(0xf2c230), len - 0.2, 0.08, 0.04, 0, y0 - 0.02, 1.5); box(gp, mat(0xf2c230), len - 0.2, 0.08, 0.04, 0, y0 - 0.02, -1.5);
    [1.38, -1.38].forEach((z) => {
      rod(gp, M.pole, new THREE.Vector3(-len / 2 + 0.6, 2.3, z), new THREE.Vector3(cabX - 0.3, 2.3, z), 0.025);
      for (let x = -len / 2 + 0.6; x < cabX; x += 2.2) rod(gp, M.pole, new THREE.Vector3(x, y0, z), new THREE.Vector3(x, 2.3, z), 0.022);
    });
    // พัดลมระบายความร้อน + ท่อไอเสีย + แตร
    for (let k = 0; k < 3; k++) { const f = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 0.1, 24), mat(0x23262a)); f.position.set(-len / 2 + 2 + k * 1.6, 3.78, 0); gp.add(f); const gr = new THREE.Mesh(new THREE.TorusGeometry(0.62, 0.04, 6, 24), pantoM); gr.rotation.x = Math.PI / 2; gr.position.copy(f.position); gp.add(gr); }
    rod(gp, mat(0x1a1a1a), new THREE.Vector3(1.2, 3.7, 0), new THREE.Vector3(1.2, 4.1, 0), 0.16);
    rod(gp, pantoM, new THREE.Vector3(len / 2 - 2, 4.15, 0.3), new THREE.Vector3(len / 2 - 1.4, 4.3, 0.3), 0.06);
    // ถังน้ำมันใต้ท้อง + โบกี้ 3 เพลา (ดูหนักแบบรถจักร)
    const tank = new THREE.Mesh(new THREE.CylinderGeometry(0.62, 0.62, 5.5, 20), mat(0x2c2f33, { metalness: 0.4, roughness: 0.5 })); tank.rotation.z = Math.PI / 2; tank.position.set(0, 0.75, 0); tank.scale.set(1, 1, 1.5); gp.add(tank);
    bogie(gp, len / 2 - 3.2); bogie(gp, -len / 2 + 3.2);
    // ไฟหน้า + กันชน
    lamp(gp, lampW, len / 2 + 0.01, 2.15, 0.95, 0.15); lamp(gp, lampW, len / 2 + 0.01, 2.15, -0.95, 0.15); lamp(gp, lampW, len / 2 - 0.62, 3.98, 0, 0.17);
    box(gp, mat(0xf2c230), 0.12, 0.3, 2.6, len / 2 + 0.06, y0 + 0.05, 0);
    box(gp, frameM, 0.5, 0.35, 0.4, len / 2 + 0.2, 1.05, 0); box(gp, frameM, 0.5, 0.35, 0.4, -len / 2 - 0.2, 1.05, 0);
  }
  function makeMU(gp, len, kind, cab, panto) {
    const dmu = kind === "dmu", modern = kind === "emuModern", y0 = 1.12, y1 = 4.05;
    const base = dmu ? 0xeef2f5 : 0xf2f3f4, baseS = dmu ? "#eef2f5" : "#f2f3f4";
    const bands = dmu
      ? [[1.35, 1.8, 0x1f5fa8], [1.83, 1.92, 0xf2c230], [2.28, 3.25, 0x1c2633], [3.9, 9, 0xc9cdd2]]
      : modern
        ? [[1.42, 1.78, 0x0a9f9a], [1.83, 1.91, 0xd7b66b], [2.28, 3.3, 0x10243a], [3.5, 3.58, 0x20c7bb], [3.9, 9, 0xe3e9ef]]
        : [[1.45, 1.85, 0xc8102e], [2.28, 3.3, 0x20252d], [3.5, 3.58, 0xc8102e], [3.9, 9, 0xc4c8cd]];
    const noseL = dmu ? 1.6 : modern ? 4.35 : 2.2;
    const prof = (s) => {
      s.moveTo(-len / 2, y0);
      if (!cab) { s.lineTo(len / 2, y0); s.lineTo(len / 2, y1); }
      else if (dmu) { s.lineTo(len / 2 - 0.25, y0); s.quadraticCurveTo(len / 2, y0 + 0.05, len / 2, y0 + 0.45); s.lineTo(len / 2, 2.5); s.lineTo(len / 2 - 0.62, 3.78); s.quadraticCurveTo(len / 2 - 0.85, y1, len / 2 - 1.3, y1); }
      else if (modern) {
        // Longer swept cab: low aerodynamic nose and a continuous roofline into the cab.
        s.lineTo(len / 2 - 0.42, y0);
        s.quadraticCurveTo(len / 2, y0 + 0.06, len / 2, y0 + 0.72);
        s.lineTo(len / 2, 2.35);
        s.bezierCurveTo(len / 2 - 0.5, 3.08, len / 2 - 2.1, 3.82, len / 2 - 3.55, 3.98);
        s.quadraticCurveTo(len / 2 - 4.1, y1, len / 2 - 4.35, y1);
      }
      else { s.lineTo(len / 2 - 0.4, y0); s.quadraticCurveTo(len / 2, y0 + 0.05, len / 2, y0 + 0.55); s.lineTo(len / 2, 2.25); s.bezierCurveTo(len / 2 - 0.1, 3.0, len / 2 - 0.9, 3.95, len / 2 - 1.9, y1); }
      s.lineTo(-len / 2, y1); s.closePath();
    };
    const zs = cab ? (x, y) => {
      if (x <= len / 2 - noseL) return 1;
      const t = (x - len / 2 + noseL) / noseL, h = Math.max(0, (y - y0) / (y1 - y0));
      const sideTaper = modern ? 0.28 : dmu ? 0.1 : 0.16, roofTaper = modern ? 0.2 : dmu ? 0.08 : 0.14;
      return (1 - sideTaper * t * t) * (1 - roofTaper * t * h * h);
    } : null;
    const stripe = STRIPE(bands, base);
    const wallC = (x, y) => {
      if (cab && x > len / 2 - (dmu ? 0.72 : modern ? 4.05 : 1.45) && y > (dmu ? 2.6 : 2.32) && y < (dmu ? 3.76 : 3.9)) return 0x0b1015;
      if (cab && dmu && x > len / 2 - 0.3 && y < 2.5 && y > 1.95) return 0xf2c230;
      return stripe(x, y);
    };
    const geo = bodyGeo(kind + len + (cab ? "c" : ""), 2.9, 0.3, prof, zs, wallC);
    const tex = livery(kind + len, len, y0, y1, (L) => {
      L.band(y0, y1, modern ? "#edf1f4" : baseS);
      bands.forEach(([a, b, c]) => L.band(a, Math.min(b, y1), "#" + c.toString(16).padStart(6, "0")));
      if (modern) {
        // Premium teal sweep with a fine champagne pinstripe along the lower body.
        const { g, X, Y } = L;
        const sweep = g.createLinearGradient(X(-len / 2), 0, X(len / 2), 0);
        sweep.addColorStop(0, "#13b8ad"); sweep.addColorStop(0.55, "#087f8a"); sweep.addColorStop(1, "#19c9b9");
        g.beginPath();
        g.moveTo(X(-len / 2), Y(2.03));
        g.bezierCurveTo(X(-len / 5), Y(2.03), X(len / 5), Y(2.24), X(len / 2), Y(2.18));
        g.lineTo(X(len / 2), Y(2.04));
        g.bezierCurveTo(X(len / 5), Y(2.11), X(-len / 5), Y(1.88), X(-len / 2), Y(1.89));
        g.closePath(); g.fillStyle = sweep; g.fill();
        g.beginPath();
        g.moveTo(X(-len / 2), Y(1.84));
        g.bezierCurveTo(X(-len / 5), Y(1.84), X(len / 5), Y(2.05), X(len / 2), Y(1.99));
        g.strokeStyle = "#e4c984"; g.lineWidth = 3; g.stroke();
      }
      const doors = dmu ? [-len / 2 + 0.9, len / 2 - 2.1] : [-len / 4 - 0.65, len / 4 - 0.65];
      const dw = dmu ? 1.2 : 1.3;
      const nW = dmu ? 7 : modern ? 7 : 8, winW = modern ? 1.35 : 1.1;
      for (let i = 0; i < nW; i++) {
        const x = -len / 2 + 1.0 + (i + 0.5) * (len - 2.0) / nW;
        if (doors.some((d) => x > d - 0.5 && x < d + dw + 0.5)) continue;
        L.win(x - winW / 2, x + winW / 2, modern ? 2.43 : 2.4, modern ? 3.18 : 3.15, modern ? 0.18 : 0.12);
      }
      doors.forEach((d) => L.door(d, d + dw, 1.25, 3.45, dmu ? "#dfe5ea" : modern ? "#dfe6eb" : "#d0d3d6", 2));
      L.panelLines(dmu ? 2.6 : 3.4); L.dirt();
    });
    body(gp, kind, geo, tex, { metalness: dmu ? 0.3 : modern ? 0.5 : 0.45, roughness: dmu ? 0.38 : modern ? 0.24 : 0.3 });
    box(gp, under, len - 7, 0.55, 2.2, 0, 0.9, 0);
    if (dmu) { box(gp, mat(0x9ba0a6, { metalness: 0.4 }), 2.2, 0.3, 1.4, -2, y1 + 0.1, 0, true); rod(gp, mat(0x1a1a1a), new THREE.Vector3(-len / 2 + 2.2, y1, 0.7), new THREE.Vector3(-len / 2 + 2.2, y1 + 0.45, 0.7), 0.1); }
    else box(gp, mat(0xa9adb2, { metalness: 0.4 }), 3.2, 0.3, 1.6, -3, y1 + 0.1, 0, true);
    if (panto) pantograph(gp, 3, y1);
    bogie(gp, len / 2 - 2.5, null); bogie(gp, -len / 2 + 2.5, null);
    if (cab) {
      if (modern) {
        // Wraparound dark visor, full-width LED light bar, and sculpted lower bumper.
        box(gp, mat(0x091b2b, { metalness: 0.45, roughness: 0.2 }), 0.055, 0.48, 2.42, len / 2 + 0.025, 2.08, 0);
        box(gp, lampW, 0.045, 0.075, 1.86, len / 2 + 0.064, 1.77, 0);
        lamp(gp, lampW, len / 2 + 0.05, 2.24, 1.17, 0.11); lamp(gp, lampW, len / 2 + 0.05, 2.24, -1.17, 0.11);
        box(gp, mat(0x087f8a, { metalness: 0.35, roughness: 0.3 }), 0.12, 0.22, 2.45, len / 2 - 0.02, y0 + 0.18, 0, true);
      } else {
        lamp(gp, lampW, len / 2 + 0.005, 1.95, 0.9); lamp(gp, lampW, len / 2 + 0.005, 1.95, -0.9);
        box(gp, frameM, 0.4, 0.3, 2.4, len / 2 - 0.1, y0 - 0.12, 0);
      }
      gangway(gp, -len / 2 - 0.2);
    } else { gangway(gp, len / 2 + 0.2); gangway(gp, -len / 2 - 0.2); }
    if (modern) {
      // Streamlined side skirts bridge the bogies and repeat the teal signature line on every car.
      [-1, 1].forEach((side) => {
        box(gp, mat(0xb2bec7, { metalness: 0.32, roughness: 0.36 }), len - 8.5, 0.34, 0.12, 0, 1.02, side * 1.48);
        box(gp, mat(0x16aaa5, { metalness: 0.25, roughness: 0.3 }), len - 8.5, 0.045, 0.13, 0, 1.23, side * 1.49);
      });
    }
  }
  function makeHSR(gp, len, nose, panto) {
    const y0 = 1.0, y1 = 4.0, NL = 11;
    const xn = len / 2 - NL;
    const prof = (s) => {
      s.moveTo(-len / 2, y0);
      if (!nose) { s.lineTo(len / 2, y0); s.lineTo(len / 2, y1); }
      else { s.lineTo(len / 2 - 1.2, y0); s.quadraticCurveTo(len / 2, y0 + 0.02, len / 2, 1.55); s.bezierCurveTo(len / 2 - 2.2, 2.1, len / 2 - 6.5, 3.75, xn, y1); }
      s.lineTo(-len / 2, y1); s.closePath();
    };
    const zs = nose ? (x, y) => { if (x <= xn) return 1; const t = (x - xn) / NL, h = Math.max(0, (y - y0) / (y1 - y0)); return (1 - 0.6 * Math.pow(t, 1.55)) * (1 - 0.42 * Math.pow(t, 0.8) * h * h); } : null;
    const stripe = STRIPE([[0, 1.3, 0xc9ccd0], [1.72, 2.0, 0x0e7a5c], [2.04, 2.11, 0xd8a32b], [3.86, 9, 0xe3e5e7]], 0xf6f7f8);
    const wallC = (x, y) => (nose && x > len / 2 - 8.8 && x < len / 2 - 4.8 && y > 3.0 ? 0x0a0f14 : stripe(x, y));
    const geo = bodyGeo("hsr" + len + (nose ? "n" : ""), 3.05, 0.5, prof, zs, wallC);
    const tex = livery("hsr" + len + (nose ? "n" : ""), len, y0, y1, (L) => {
      L.band(y0, y1, "#f6f7f8"); L.band(y0, 1.3, "#c9ccd0"); L.band(1.72, 2.0, "#0e7a5c"); L.band(2.04, 2.11, "#d8a32b"); L.band(3.86, y1, "#e3e5e7");
      const xe = nose ? xn - 0.6 : len / 2 - 2.2;
      for (let x = -len / 2 + 2.4; x + 0.8 < xe; x += 1.12) L.win(x, x + 0.8, 2.55, 3.2, 0.16);
      L.door(-len / 2 + 0.7, -len / 2 + 1.55, 1.3, 3.4, "#eceef0");
      if (!nose) L.door(len / 2 - 1.55, len / 2 - 0.7, 1.3, 3.4, "#eceef0");
      else L.win(len / 2 - 9.4, len / 2 - 7.7, 3.02, 3.5, 0.2, false);
      L.panelLines(5);
    });
    body(gp, "hsr", geo, tex, { metalness: 0.42, roughness: 0.22 });
    box(gp, mat(0xc9ccd0, { metalness: 0.3 }), nose ? len - NL - 1 : len - 2, 0.55, 2.7, nose ? -NL / 2 - 0.5 : 0, 0.95, 0);   // แผงปิดใต้ท้อง (ลู่ลม)
    if (panto) { pantograph(gp, 2, y1); box(gp, mat(0xd8dbde, { metalness: 0.3 }), 4.2, 0.35, 2.0, 2, y1 + 0.1, 0, true); }
    bogie(gp, len / 2 - (nose ? 4 : 2.7), null); bogie(gp, -len / 2 + 2.7, null);
    if (nose) {
      lamp(gp, lampW, len / 2 - 1.05, 1.5, 0.52, 0.12); lamp(gp, lampW, len / 2 - 1.05, 1.5, -0.52, 0.12);
      // แผงปิดโบกี้หน้าใต้จมูก (ไม่ให้เห็นล้อโผล่)
      [1, -1].forEach((sd) => { const sk = box(gp, mat(0xc9ccd0, { metalness: 0.3 }), 6.5, 0.6, 0.06, len / 2 - 4.4, 0.95, sd * 1.05); sk.rotation.y = sd * 0.07; });
      box(gp, mat(0x9aa0a6, { metalness: 0.3 }), 1.6, 0.35, 1.6, len / 2 - 1.2, 0.85, 0);
      gangway(gp, -len / 2 - 0.2);
    } else { gangway(gp, len / 2 + 0.2); gangway(gp, -len / 2 - 0.2); }
  }
  // ตำแหน่งประตูของแต่ละแบบ (ตรงกับลายที่วาดบนตัวรถ): [x เริ่ม, ความกว้าง, จำนวนบาน]
  function doorSpec(type, len) {
    if (type === "coach") return { w: 2.9, y0: 1.3, y1: 3.45, col: 0xddd7ca, list: [[-len / 2 + 0.75, 1.0, 1], [len / 2 - 1.75, 1.0, 1]] };
    if (type === "dmu") return { w: 2.9, y0: 1.25, y1: 3.45, col: 0xdfe5ea, list: [[-len / 2 + 0.9, 1.2, 2], [len / 2 - 2.1, 1.2, 2]] };
    if (type === "emu" || type === "emuModern") return { w: 2.9, y0: 1.25, y1: 3.45, col: type === "emuModern" ? 0xe5edf1 : 0xdfe6eb, list: [[-len / 4 - 0.65, 1.3, 2], [len / 4 - 0.65, 1.3, 2]] };
    if (type === "hsr") return { w: 3.05, y0: 1.3, y1: 3.4, col: 0xeceef0, list: [[-len / 2 + 0.7, 0.85, 1], [len / 2 - 1.55, 0.85, 1]] };
    if (type === "hsrNose") return { w: 3.05, y0: 1.3, y1: 3.4, col: 0xeceef0, list: [[-len / 2 + 0.7, 0.85, 1]] };
    return null;
  }
  const doorMats = new Map();
  function addDoors(gp, type, len, side) {
    const sp = doorSpec(type, len); if (!sp) return [];
    if (!doorMats.has(sp.col)) doorMats.set(sp.col, mat(sp.col, { metalness: 0.4, roughness: 0.35 }));
    const dm = doorMats.get(sp.col), out = [], h = sp.y1 - sp.y0, zc = side * (sp.w / 2);
    sp.list.forEach(([x0, dw, n]) => {
      // ช่องประตูด้านใน (มืด) — เห็นเมื่อบานเลื่อนเปิด
      const hole = new THREE.Mesh(new THREE.PlaneGeometry(dw, h), rubber); hole.position.set(x0 + dw / 2, sp.y0 + h / 2, zc + side * 0.012); hole.rotation.y = side > 0 ? 0 : Math.PI; gp.add(hole);
      const lw = dw / n;
      for (let k = 0; k < n; k++) {
        const leaf = new THREE.Group(), bx = x0 + lw * k + lw / 2;
        const panel = new THREE.Mesh(geoBox, dm); panel.scale.set(lw - 0.02, h, 0.04); leaf.add(panel);
        const gl = new THREE.Mesh(new THREE.PlaneGeometry(lw * 0.55, 0.7), glassM); gl.position.set(0, h / 2 - 0.6, side * 0.025); gl.rotation.y = side > 0 ? 0 : Math.PI; leaf.add(gl);
        leaf.position.set(bx, sp.y0 + h / 2, zc + side * 0.035); gp.add(leaf);
        out.push({ g: leaf, x0: bx, dx: n === 1 ? lw * 0.98 : (k === 0 ? -1 : 1) * lw * 0.98 });   // บานเลื่อนเก็บข้างตัวรถ
      }
    });
    return out;
  }
  const headSpot = new THREE.SpotLight(0xfff3d6, 0, 400, 0.22, 0.4, 1.2);
  function buildTrain(tr) {
    trainRoot.clear(); cars = [];
    tr.cars.forEach((c, i) => {
      const gp = new THREE.Group(), len = c.len;
      const flip = !!(c.flip || c.cabRear);
      if (c.type === "loco") makeLoco(gp, len);
      else if (c.type === "coach") makeCoach(gp, len);
      else if (c.type === "dmu" || c.type === "emu" || c.type === "emuModern") makeMU(gp, len, c.type, !!(c.cab || c.cabRear), !!c.panto);
      else makeHSR(gp, len, c.type === "hsrNose", !!c.panto);
      // คันท้าย: ไฟหน้ากลายเป็นไฟท้ายสีแดง
      if (flip) gp.traverse((o) => { if (o.material === lampW) o.material = lampR; });
      // ประตูเปิดฝั่งซ้ายตามทิศวิ่ง (ฝั่งชานชาลา) — คันที่กลับหัว ฝั่งซ้ายคือ +z ของตัวเอง
      const doors = addDoors(gp, c.type, len, flip ? 1 : -1);
      let outer = gp;
      if (flip) { outer = new THREE.Group(); gp.rotation.y = Math.PI; outer.add(gp); }
      trainRoot.add(outer); cars.push({ g: outer, len: c.len, off: c.off, doors });
    });
    // ไฟหน้าส่องทาง (กลางคืน)
    headSpot.target.position.set(60, 0, 0); cars[0].g.add(headSpot, headSpot.target); headSpot.position.set(cars[0].len / 2 + 0.5, 2.0, 0);
    // ห้องคนขับ: คอนโซล (เห็นเฉพาะมุมห้องคนขับ)
    cab.clear();
    const con = new THREE.Mesh(geoBox, M.dark); con.scale.set(0.9, 1.0, 2.3); con.position.set(-0.3, -1.05, 0); cab.add(con);
    const gauge = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.35), mat(0x0b1016, { emissive: 0x2a6fdb, emissiveIntensity: 0.6 })); gauge.position.set(-0.05, -0.2, -0.35); gauge.rotation.set(-0.6, Math.PI / 2, 0, "YXZ"); cab.add(gauge);
    const sill = new THREE.Mesh(geoBox, M.dark); sill.scale.set(0.2, 0.25, 2.6); sill.position.set(0.55, -0.62, 0); cab.add(sill);
    setLights();
  }
  function setLights() {
    const night = env.tod === "night", dim = night || env.tod === "dusk";
    litMats.forEach((m) => { m.emissiveIntensity = dim ? 1.1 : 0; });
    cityLit.forEach((m) => { m.emissiveIntensity = night ? 1.5 : env.tod === "dusk" ? 0.7 : 0; });
    lampW.color.setHex(night || env.wx !== "clear" ? 0xffffff : 0xe8e4d6);
  }
  const cab = new THREE.Group(); scene.add(cab);

  /* ---------------- ฝน ---------------- */
  const RAIN_N = 6000, rainPos = new Float32Array(RAIN_N * 6), rainSeed = new Float32Array(RAIN_N * 3);
  for (let i = 0; i < RAIN_N; i++) { rainSeed[i * 3] = (Math.random() - 0.5) * 140; rainSeed[i * 3 + 1] = Math.random() * 50; rainSeed[i * 3 + 2] = (Math.random() - 0.5) * 140; }
  const rainGeo = new THREE.BufferGeometry(); rainGeo.setAttribute("position", new THREE.BufferAttribute(rainPos, 3));
  const rain = new THREE.LineSegments(rainGeo, new THREE.LineBasicMaterial({ color: 0xc9d6e6, transparent: true, opacity: 0.45 })); rain.frustumCulled = false; rain.visible = false; scene.add(rain);
  let rainT = 0;

  function setEnv(e) {
    Object.assign(env, e);
    const k = ENV[env.tod];
    skyMat.uniforms.top.value.setHex(env.wx === "clear" ? k.top : 0x5d6875); skyMat.uniforms.hor.value.setHex(env.wx === "clear" ? k.hor : 0x9aa4ae);
    skyMat.uniforms.sunCol.value.setHex(k.sunCol); skyMat.uniforms.night.value = env.tod === "night" && env.wx === "clear" ? 1 : 0;
    const wet = env.wx !== "clear";
    sun.intensity = k.sunI * (wet ? 0.3 : 1); hemi.intensity = k.hemi * (wet ? 0.8 : 1); sun.color.setHex(k.sunCol);
    scene.fog.color.setHex(env.wx === "fog" ? 0xc4c9ce : wet ? 0x8f99a3 : k.fog);
    scene.fog.near = env.wx === "fog" ? 20 : wet ? 120 : 300; scene.fog.far = env.wx === "fog" ? 450 : wet ? 1600 : 4200;
    renderer.toneMappingExposure = k.exp;
    rain.visible = env.wx === "rain";
    const night = env.tod === "night";
    M.lamp.emissiveIntensity = night ? 3 : 1.2;
    setLights(); updateEnvMap();
    headSpot.intensity = night ? 260 : env.tod === "dusk" || wet ? 90 : 0;
    M.rail.roughness = wet ? 0.12 : 0.28;
  }

  /* ---------------- กล้อง ---------------- */
  const view = { mode: "cab", yaw: 0, pitch: 0, dist: 60, orbit: 0.6, tilt: 0.35, trackSpot: null, pos: null };
  let drag = null;
  const el = renderer.domElement;
  el.addEventListener("pointerdown", (e) => { drag = { x: e.clientX, y: e.clientY }; el.setPointerCapture(e.pointerId); });
  el.addEventListener("pointermove", (e) => {
    if (!drag) return; const dx = e.clientX - drag.x, dy = e.clientY - drag.y; drag.x = e.clientX; drag.y = e.clientY;
    if (view.mode === "cab") { view.yaw = Math.max(-2.4, Math.min(2.4, view.yaw - dx * 0.004)); view.pitch = Math.max(-0.7, Math.min(0.6, view.pitch - dy * 0.004)); }
    else { view.orbit -= dx * 0.006; view.tilt = Math.max(0.03, Math.min(1.45, view.tilt + dy * 0.005)); }
  });
  el.addEventListener("pointerup", () => { drag = null; });
  el.addEventListener("wheel", (e) => { e.preventDefault(); if (view.mode === "cab") cam.fov = Math.max(30, Math.min(95, cam.fov + e.deltaY * 0.03)); else view.dist = Math.max(15, Math.min(900, view.dist * Math.exp(e.deltaY * 0.0012))); }, { passive: false });
  function setCam(m) { view.mode = m; view.pos = null; view.th = undefined; view.trackSpot = null; view.yaw = 0; view.pitch = 0; cam.fov = m === "cab" ? 62 : 55; view.dist = m === "drone" ? 160 : m === "side" ? 24 : 55; }

  /* ---------------- เฟรม ---------------- */
  let W = 1, H = 1;
  function resize() { const r = host.getBoundingClientRect(); W = Math.max(1, r.width); H = Math.max(1, r.height); renderer.setSize(W, H, false); renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%"; }
  resize();
  const worldPos = (s) => { const t = trackPoint(s); return t; };
  function update(dt, st) {
    // จุดอ้างอิงตามรถ
    const front = geo.at(st.s);
    const [fx, fy] = toXY(front.lat, front.lon);
    if (O.k === 1 || Math.hypot(fx, fy) > 2500) {
      // ย้ายจุดอ้างอิง: ทุกอย่างเลื่อนไป (−fx, +fy) → เลื่อนตำแหน่งกล้องที่จำไว้ตามด้วย ไม่งั้นกล้องจะพุ่ง/เด้ง
      if (O.k !== 1) {
        if (view.pos) { view.pos.x -= fx; view.pos.z += fy; }
        if (view.trackSpot) { view.trackSpot.p.x -= fx; view.trackSpot.p.z += fy; }
      }
      recenter(front.lat, front.lon);
    }
    const newChunks = refreshChunks(st.s);
    if (carsKey !== st.trainKey) { carsKey = st.trainKey; buildTrain(st.train); }
    if (st.jumped) cars.forEach((c) => { c.roll = undefined; });
    // วางรถแต่ละคันตามราง: ตำแหน่ง = กลางระหว่างโบกี้หน้า/หลัง
    cars.forEach((c) => {
      const sc = st.s - c.off, a = trackPoint(Math.max(0, sc + c.len / 2 - 3.2)), b = trackPoint(Math.max(0, sc - c.len / 2 + 3.2));
      const th = Math.atan2(a.y - b.y, a.x - b.x), pitch = Math.atan2(a.z - b.z, Math.hypot(a.x - b.x, a.y - b.y));
      // เอียงตามยกโค้ง (cant) + เอียงเพิ่มตามแรงเหวี่ยง
      c.g.position.set((a.x + b.x) / 2, (a.z + b.z) / 2 + 0.18, -(a.y + b.y) / 2);
      // ช่วงล่างแบบสปริง-โช้ค: มุมเอียงวิ่งตามเป้าอย่างนุ่มนวล (มีโยกเล็กน้อยเหมือนรถจริง)
      const tgt = st.rollFor(sc);
      if (c.roll === undefined) { c.roll = tgt; c.rollV = 0; }
      for (let left = Math.min(dt, 0.25); left > 1e-4; left -= 0.02) {
        const h = Math.min(0.02, left), w = 2.6, z = 0.55;
        c.rollV += (w * w * (tgt - c.roll) - 2 * z * w * c.rollV) * h; c.roll += c.rollV * h;
      }
      c.g.rotation.order = "YZX"; c.g.rotation.set(c.roll, th, pitch);
      const da = st.door || 0, de = da * da * (3 - 2 * da);
      c.doors.forEach((d) => { d.g.position.x = d.x0 + d.dx * de; });
      if (st.derailed) { c.g.rotation.x += st.derailed.side * Math.min(1.35, st.derailed.t * 0.9) * (c === cars[0] ? 1 : 0.6); c.g.position.y -= Math.min(1.2, st.derailed.t); }
    });
    // ท้องฟ้า/ดวงอาทิตย์ตามกล้อง
    const k = ENV[env.tod]; const sd = new THREE.Vector3(k.sun[0], k.sun[1], k.sun[2]).normalize();
    skyMat.uniforms.sunDir.value.copy(sd);
    // กล้อง
    const lead = cars[0], t0 = trackPoint(st.s);
    if (view.mode === "cab") {
      const ex = st.train.eyeX !== undefined ? st.train.eyeX : lead.len / 2 - 1.6, ey = st.train.eye;
      const v = new THREE.Vector3(ex, ey, -0.45).applyEuler(lead.g.rotation).add(lead.g.position);
      cam.position.copy(v);
      const yaw = t0.th + view.yaw, pitch = view.pitch - 0.04 + t0.pitch;
      cam.up.set(0, 1, 0);
      cam.lookAt(v.x + Math.cos(yaw) * Math.cos(pitch), v.y + Math.sin(pitch), v.z - Math.sin(yaw) * Math.cos(pitch));
      cab.visible = true; cab.position.copy(v); cab.rotation.set(0, t0.th, 0, "YXZ");
      cab.children.forEach((m) => { m.visible = true; });
      cab.position.add(new THREE.Vector3(Math.cos(t0.th) * 0.9, -0.15, -Math.sin(t0.th) * 0.9));
    } else {
      cab.visible = false;
      const cen = lead.g.position.clone();
      let want;
      if (view.mode === "track") {
        if (!view.trackSpot || st.s - view.trackSpot.s > 220) {
          const s2 = Math.min(geo.total, st.s + 650 + Math.max(0, st.v) * 8), tp = trackPoint(s2), side = Math.random() < 0.5 ? 1 : -1;
          view.trackSpot = { s: s2, p: new THREE.Vector3(tp.x - Math.sin(tp.th) * 9 * side, tp.z + 2.2, -(tp.y + Math.cos(tp.th) * 9 * side)) };
        }
        want = view.trackSpot.p.clone();
        cam.position.copy(want); cam.lookAt(cen.x, cen.y + 2, cen.z);
      } else {
        // ทิศของราง: หน่วงเฉพาะ "มุม" (ให้โค้งนุ่ม) แต่ตำแหน่งยึดกับรถตลอด → กล้องไม่หลุดหลังเวลาวิ่งเร็ว
        let dth = t0.th - (view.th === undefined ? t0.th : view.th);
        dth = Math.atan2(Math.sin(dth), Math.cos(dth));
        view.th = (view.th === undefined ? t0.th : view.th) + dth * Math.min(1, dt * 2.5);
        const ang = view.th + Math.PI + view.orbit + (view.mode === "side" ? -Math.PI / 2 - 0.6 : 0);
        const tilt = view.mode === "drone" ? Math.max(view.tilt, 0.6) : view.mode === "side" ? 0.12 : view.tilt;
        const tgt = view.mode === "side" ? cars[Math.min(cars.length - 1, Math.floor(cars.length / 2))].g.position.clone() : cen;
        want = new THREE.Vector3(tgt.x + Math.cos(ang) * Math.cos(tilt) * view.dist, tgt.y + 3 + Math.sin(tilt) * view.dist, tgt.z - Math.sin(ang) * Math.cos(tilt) * view.dist);
        view.pos = want.clone();
        cam.position.copy(view.pos); cam.lookAt(tgt.x, tgt.y + 2, tgt.z);
      }
    }
    // แสงแดด + เงาตามกล้อง
    sun.position.copy(cam.position).add(sd.clone().multiplyScalar(400)); sun.target.position.copy(cam.position).add(new THREE.Vector3(Math.cos(t0.th) * 60, -cam.position.y + t0.z, -Math.sin(t0.th) * 60)); sun.target.updateMatrixWorld();
    sky.position.copy(cam.position);
    // ฝน
    if (rain.visible) {
      rainT += dt;
      for (let i = 0; i < RAIN_N; i++) {
        let y = rainSeed[i * 3 + 1] - ((rainT * 24 + i * 0.37) % 50); if (y < 0) y += 50;
        const x = cam.position.x + rainSeed[i * 3], z = cam.position.z + rainSeed[i * 3 + 2], yy = cam.position.y - 20 + y, o = i * 6;
        rainPos[o] = x; rainPos[o + 1] = yy; rainPos[o + 2] = z; rainPos[o + 3] = x + 0.1; rainPos[o + 4] = yy + 1.0; rainPos[o + 5] = z;
      }
      rainGeo.attributes.position.needsUpdate = true;
    }
    cam.aspect = W / H; cam.updateProjectionMatrix();
    renderer.render(scene, cam);
    return newChunks;
  }
  function warm(s) { let n = 0; while (refreshChunks(s) > 0 && n < 40) n++; }
  return { camDist: () => (view.pos && cars[0] ? view.pos.distanceTo(cars[0].g.position) : -1), update, resize, setCam, setEnv, warm, get mode() { return view.mode; }, recenterAt: (s) => { const p = geo.at(s); recenter(p.lat, p.lon); view.pos = null; view.th = undefined; view.trackSpot = null; chunks.forEach((g) => { root.remove(g); g.traverse((o) => { if (o.geometry && o.geometry !== geoBox && !Object.values(treeGeo).includes(o.geometry)) o.geometry.dispose(); }); }); chunks.clear(); } };
}
