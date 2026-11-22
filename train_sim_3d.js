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
      P.push({ s, x: t.x - cx, y: t.y - cy, z: t.z, th: t.th, f: geo.flag(s) });
    }
    const off = (p, o, dz = 0) => [p.x - Math.sin(p.th) * o, p.y + Math.cos(p.th) * o, p.z + dz];
    const isB = (p) => p.f & 2, isT = (p) => p.f & 1;
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
          if (isB(p)) h = p.z - 2 - Math.min(14, o * 0.8) * (1 - Math.min(1, o / 120)) + far * hill * 30 * noise2(wx, wy);  // หุบน้ำใต้สะพาน
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
      const m = new THREE.Mesh(geom, hill > 0.3 ? M.forest : M.rice); m.receiveShadow = true; g.add(m);
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
      const tube = ribbon(tun.map((p) => prof.map(([o, h]) => off(p, o, h))));
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
        const top = ribbon(plat.map((p) => [off(p, side * 2.0, 0.95), off(p, side * 6.0, 0.95)]));
        const edge = ribbon(plat.map((p) => [off(p, side * 2.0, -0.4), off(p, side * 2.0, 0.95)]));
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
      // อาคารสถานี (หลังคาจั่วทรงไทย)
      if (!st.h) {
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
    const nTree = Math.round(hill > 0.3 ? 420 : 140), trees = [];
    for (let i = 0; i < nTree; i++) {
      const p = P[Math.floor(r() * P.length)], side = r() < 0.5 ? -1 : 1, o = 14 + Math.pow(r(), 1.4) * (hill > 0.3 ? 500 : 380);
      if (isT(p) || isB(p)) continue;
      const [x, y] = off(p, o * side);
      if (geo.stations.some((st) => Math.abs(st.s - p.s) < 130) && o < 30) continue;
      const far = Math.min(1, Math.max(0, (o - 5) / 70)), wx = x + cx, wy = y + cy;
      const h = p.z - 1.2 + far * (hill * (55 * Math.max(0, noise2(wx, wy) + 0.25) + o * 0.08 * (side > 0 ? 1 : 0.4)) + (1 - hill) * 0.6 * noise2(wx * 3, wy * 3));
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
    geo.stations.forEach((st) => {
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

  /* ---------------- ขบวนรถ ---------------- */
  const trainRoot = new THREE.Group(); scene.add(trainRoot);
  let cars = [], carsKey = "";
  const glass = mat(0x17222e, { metalness: 0.85, roughness: 0.1 });
  const winLit = mat(0xffe7b0, { emissive: 0xffd98a, emissiveIntensity: 0 });
  const headL = mat(0xffffff, { emissive: 0xffffff, emissiveIntensity: 0.3 });
  function bogies(gp, len) {
    [len / 2 - 3.2, -len / 2 + 3.2].forEach((x) => {
      const b = new THREE.Mesh(geoBox, M.dark); b.scale.set(2.8, 0.7, 2.0); b.position.set(x, 0.65, 0); gp.add(b);
      [-0.9, 0.9].forEach((dx) => [0.5, -0.5].forEach((dz) => { const w = new THREE.Mesh(new THREE.CylinderGeometry(0.46, 0.46, 0.14, 18), M.steel); w.rotation.x = Math.PI / 2; w.position.set(x + dx, 0.46, dz); gp.add(w); }));
    });
  }
  function bodyBox(gp, len, w, h, y0, colorMat, stripes) {
    const body = new THREE.Mesh(geoBox, colorMat); body.scale.set(len, h, w); body.position.y = y0 + h / 2; body.castShadow = body.receiveShadow = true; gp.add(body);
    (stripes || []).forEach(([yy, hh, m]) => { [w / 2 + 0.01, -w / 2 - 0.01].forEach((z) => { const s = new THREE.Mesh(new THREE.PlaneGeometry(len - 0.4, hh), m); s.position.set(0, y0 + yy, z); s.rotation.y = z > 0 ? 0 : Math.PI; gp.add(s); }); });
    return body;
  }
  function windowsRow(gp, len, w, y, h, n) {
    [w / 2 + 0.015, -w / 2 - 0.015].forEach((z) => {
      for (let i = 0; i < n; i++) { const x = -len / 2 + 1.6 + (i + 0.5) * (len - 3.2) / n; const p = new THREE.Mesh(new THREE.PlaneGeometry((len - 3.2) / n * 0.72, h), winLit); p.position.set(x, y, z); p.rotation.y = z > 0 ? 0 : Math.PI; gp.add(p); }
    });
  }
  function cabFront(gp, len, w, y0, h, colorMat) {
    const ws = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.82, h * 0.32), glass); ws.position.set(len / 2 + 0.02, y0 + h * 0.72, 0); ws.rotation.y = Math.PI / 2; gp.add(ws);
    [0.75, -0.75].forEach((z) => { const l = new THREE.Mesh(new THREE.CircleGeometry(0.18, 16), headL); l.position.set(len / 2 + 0.03, y0 + h * 0.25, z); l.rotation.y = Math.PI / 2; gp.add(l); });
  }
  const LIV = {
    loco: mat(0xd97a1f, { metalness: 0.3, roughness: 0.45 }), locoBand: mat(0x22356b), coach: mat(0xe9e2cf, { roughness: 0.5 }), coachBand: mat(0x8a2a2a),
    dmu: mat(0xe8eef3, { roughness: 0.45 }), dmuBand: mat(0x1f5fa8), emu: mat(0xf4f5f6, { metalness: 0.4, roughness: 0.3 }), emuBand: mat(0xc8102e),
    hsr: mat(0xf7f8f9, { metalness: 0.35, roughness: 0.25 }), hsrBand: mat(0x0f7a5f), hsrBand2: mat(0xd8a32b)
  };
  function buildTrain(tr) {
    trainRoot.clear(); cars = [];
    tr.cars.forEach((c, i) => {
      const gp = new THREE.Group(), len = c.len, w = 2.8;
      if (c.type === "loco") {
        bodyBox(gp, len, w, 2.9, 1.1, LIV.loco, [[1.0, 0.35, LIV.locoBand]]);
        const hood = new THREE.Mesh(geoBox, LIV.loco); hood.scale.set(len - 2, 0.5, w - 0.6); hood.position.y = 4.25; gp.add(hood);
        for (let k = 0; k < 4; k++) { const fan = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.55, 0.12, 20), M.dark); fan.position.set(-5 + k * 2.6, 4.55, 0); gp.add(fan); }
        cabFront(gp, len, w, 1.1, 3.2, LIV.loco);
        const rear = new THREE.Mesh(new THREE.PlaneGeometry(w * 0.7, 0.9), glass); rear.position.set(-len / 2 - 0.02, 3.4, 0); rear.rotation.y = -Math.PI / 2; gp.add(rear);
      } else if (c.type === "coach") {
        bodyBox(gp, len, w, 2.9, 1.1, LIV.coach, [[0.55, 0.3, LIV.coachBand], [2.75, 0.12, LIV.coachBand]]);
        const roof = new THREE.Mesh(new THREE.CylinderGeometry(1.45, 1.45, len, 16, 1, false, 0, Math.PI), LIV.coach); roof.rotation.z = Math.PI / 2; roof.rotation.x = Math.PI / 2; roof.scale.set(1, 1, 0.25); roof.position.y = 4.0; gp.add(roof);
        windowsRow(gp, len, w, 2.4, 0.9, 9);
      } else if (c.type === "dmu" || c.type === "emu") {
        const L = c.type === "dmu" ? LIV.dmu : LIV.emu, B = c.type === "dmu" ? LIV.dmuBand : LIV.emuBand;
        bodyBox(gp, len, w, 3.0, 1.05, L, [[0.5, 0.35, B], [2.9, 0.1, B]]);
        windowsRow(gp, len, w, 2.35, 1.0, 7);
        if (c.cab) cabFront(gp, len, w, 1.05, 3.0, L);
        if (c.cabRear) { const g2 = new THREE.Group(); cabFront(g2, len, w, 1.05, 3.0, L); g2.rotation.y = Math.PI; gp.add(g2); }
        if (c.panto) {
          const base = new THREE.Mesh(geoBox, M.dark); base.scale.set(2.2, 0.2, 1.2); base.position.y = 4.15; gp.add(base);
          [[-0.5, 0.6], [0.5, -0.6]].forEach(([x, a]) => { const arm = new THREE.Mesh(geoBox, M.pole); arm.scale.set(0.08, 1.6, 0.08); arm.position.set(x, 4.9, 0); arm.rotation.z = a; gp.add(arm); });
          const head = new THREE.Mesh(geoBox, M.pole); head.scale.set(0.3, 0.06, 1.6); head.position.y = 5.55; gp.add(head);
        }
        if (c.type === "dmu") { const ex = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.12, 0.6, 10), M.dark); ex.position.set(-len / 2 + 2, 4.35, 0.6); gp.add(ex); }
      } else if (c.type === "hsr" || c.type === "hsrNose") {
        bodyBox(gp, c.type === "hsrNose" ? len - 8 : len, w + 0.2, 2.95, 1.0, LIV.hsr, [[1.0, 0.22, LIV.hsrBand], [1.32, 0.06, LIV.hsrBand2]]).position.x = c.type === "hsrNose" ? -4 : 0;
        windowsRow(gp, c.type === "hsrNose" ? len - 10 : len, w + 0.2, 2.45, 0.6, 12);
        if (c.type === "hsrNose") {
          // จมูกยาวทรงลู่ลม
          const nose = new THREE.Mesh(new THREE.SphereGeometry(1, 28, 18, 0, Math.PI * 2, 0, Math.PI / 2), LIV.hsr);
          nose.scale.set(1.55, 8.6, 1.5); nose.rotation.z = -Math.PI / 2; nose.position.set(len / 2 - 8, 2.3, 0); nose.castShadow = true; gp.add(nose);
          const cw = new THREE.Mesh(new THREE.SphereGeometry(1, 20, 12, 0, Math.PI * 2, 0, Math.PI / 2), glass); cw.scale.set(0.8, 2.6, 0.9); cw.rotation.z = -Math.PI / 2; cw.position.set(len / 2 - 7.4, 3.1, 0); gp.add(cw);
          [0.65, -0.65].forEach((z) => { const l = new THREE.Mesh(new THREE.SphereGeometry(0.16, 12, 8), headL); l.position.set(len / 2 - 1.2, 1.9, z); gp.add(l); });
        }
        if (c.panto) { const base = new THREE.Mesh(geoBox, M.dark); base.scale.set(2.2, 0.2, 1.2); base.position.y = 4.1; gp.add(base); const head = new THREE.Mesh(geoBox, M.pole); head.scale.set(0.3, 0.06, 1.6); head.position.y = 5.55; gp.add(head); const arm = new THREE.Mesh(geoBox, M.pole); arm.scale.set(0.08, 1.6, 0.08); arm.position.set(0, 4.9, 0); arm.rotation.z = 0.6; gp.add(arm); }
      }
      bogies(gp, len);
      // ข้อต่อระหว่างคัน
      const cp = new THREE.Mesh(geoBox, M.dark); cp.scale.set(0.8, 0.4, 0.4); cp.position.set(-len / 2 - 0.3, 1.1, 0); gp.add(cp);
      gp.traverse((o) => { if (o.isMesh) o.castShadow = true; });
      let outer = gp;
      if (c.flip) { outer = new THREE.Group(); gp.rotation.y = Math.PI; outer.add(gp); }
      trainRoot.add(outer); cars.push({ g: outer, len: c.len, off: c.off });
    });
    // ไฟหน้าส่องทาง (กลางคืน)
    headSpot.target.position.set(60, 0, 0); cars[0].g.add(headSpot, headSpot.target); headSpot.position.set(cars[0].len / 2 + 0.5, 2.0, 0);
    // ห้องคนขับ: คอนโซล + เสาหน้าต่าง (เห็นเฉพาะมุมห้องคนขับ)
    cab.clear();
    const con = new THREE.Mesh(geoBox, M.dark); con.scale.set(0.9, 1.0, 2.3); con.position.set(-0.3, -1.05, 0); cab.add(con);
    const gauge = new THREE.Mesh(new THREE.PlaneGeometry(0.9, 0.35), mat(0x0b1016, { emissive: 0x2a6fdb, emissiveIntensity: 0.6 })); gauge.position.set(-0.05, -0.2, -0.35); gauge.rotation.set(-0.6, Math.PI / 2, 0, "YXZ"); cab.add(gauge);
    const sill = new THREE.Mesh(geoBox, M.dark); sill.scale.set(0.2, 0.25, 2.6); sill.position.set(0.55, -0.62, 0); cab.add(sill);
  }
  const headSpot = new THREE.SpotLight(0xfff3d6, 0, 400, 0.22, 0.4, 1.2);
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
    winLit.emissiveIntensity = night || env.tod === "dusk" ? 1.4 : 0;
    M.lamp.emissiveIntensity = night ? 3 : 1.2;
    headL.emissiveIntensity = night || wet ? 3 : 0.5;
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
  function setCam(m) { view.mode = m; view.pos = null; view.trackSpot = null; view.yaw = 0; view.pitch = 0; cam.fov = m === "cab" ? 62 : 55; view.dist = m === "drone" ? 160 : m === "side" ? 24 : 55; }

  /* ---------------- เฟรม ---------------- */
  let W = 1, H = 1;
  function resize() { const r = host.getBoundingClientRect(); W = Math.max(1, r.width); H = Math.max(1, r.height); renderer.setSize(W, H, false); renderer.domElement.style.width = "100%"; renderer.domElement.style.height = "100%"; }
  resize();
  const worldPos = (s) => { const t = trackPoint(s); return t; };
  function update(dt, st) {
    // จุดอ้างอิงตามรถ
    const front = geo.at(st.s);
    const [fx, fy] = toXY(front.lat, front.lon);
    if (O.k === 1 || Math.hypot(fx, fy) > 2500) recenter(front.lat, front.lon);
    const newChunks = refreshChunks(st.s);
    if (carsKey !== st.trainKey) { carsKey = st.trainKey; buildTrain(st.train); }
    // วางรถแต่ละคันตามราง: ตำแหน่ง = กลางระหว่างโบกี้หน้า/หลัง
    cars.forEach((c) => {
      const sc = st.s - c.off, a = trackPoint(Math.max(0, sc + c.len / 2 - 3.2)), b = trackPoint(Math.max(0, sc - c.len / 2 + 3.2));
      const th = Math.atan2(a.y - b.y, a.x - b.x), pitch = Math.atan2(a.z - b.z, Math.hypot(a.x - b.x, a.y - b.y));
      // เอียงตามยกโค้ง (cant) + เอียงเพิ่มตามแรงเหวี่ยง
      c.g.position.set((a.x + b.x) / 2, (a.z + b.z) / 2 + 0.18, -(a.y + b.y) / 2);
      c.g.rotation.order = "YZX"; c.g.rotation.set(st.rollFor(sc), th, pitch);
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
        const ang = t0.th + Math.PI + view.orbit + (view.mode === "side" ? -Math.PI / 2 - 0.6 : 0);
        const tilt = view.mode === "drone" ? Math.max(view.tilt, 0.6) : view.mode === "side" ? 0.12 : view.tilt;
        const tgt = view.mode === "side" ? cars[Math.min(cars.length - 1, Math.floor(cars.length / 2))].g.position.clone() : cen;
        want = new THREE.Vector3(tgt.x + Math.cos(ang) * Math.cos(tilt) * view.dist, tgt.y + 3 + Math.sin(tilt) * view.dist, tgt.z - Math.sin(ang) * Math.cos(tilt) * view.dist);
        view.pos = view.pos ? view.pos.lerp(want, Math.min(1, dt * 3)) : want.clone();
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
  return { update, resize, setCam, setEnv, warm, get mode() { return view.mode; }, recenterAt: (s) => { const p = geo.at(s); recenter(p.lat, p.lon); chunks.forEach((g) => { root.remove(g); g.traverse((o) => { if (o.geometry && o.geometry !== geoBox && !Object.values(treeGeo).includes(o.geometry)) o.geometry.dispose(); }); }); chunks.clear(); } };
}
