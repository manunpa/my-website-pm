/* Google Maps + Street View ของ Access Maps (ใช้กับ maps.js)
 *
 * - ภาพแผนที่ Google แสดงเป็นชั้นพื้นหลังของ Leaflet (ปลั๊กอิน GoogleMutant ใช้ Maps JavaScript API ของ Google เอง)
 *   หมุด เส้น ป๊อปอัปทั้งหมดยังเป็นของ Leaflet เหมือนตอนใช้ OpenStreetMap
 * - สร้างแผนที่ Google แค่ 1 ครั้งต่อการเปิดหน้า (สลับรูปแบบ/ชั้นจราจรไม่นับเพิ่ม) — Google คิดตามจำนวนครั้งที่สร้างแผนที่
 * - key ตัวเดียวกับ my-web-p3 จึงใช้ "ตัวนับรายเดือนร่วมกัน 2 เว็บ" ที่ apps-script/maps-quota.gs
 *   นับก่อนสร้างแผนที่ / ก่อนเปิดภาพ Street View ทุกครั้ง ถ้าครบโควตาหรือนับไม่สำเร็จ → ไม่โหลด (กันเกินโควตาฟรี)
 */
// maps.js ส่งฟังก์ชันดึงข้อมูลแบบแนบ token มาให้ (ไม่ import firebase-guard.js ซ้ำ — คนละ ?v= จะได้ Firebase 2 ชุด)
let fetchProtectedText = () => Promise.reject(new Error('ยังไม่ได้เข้าสู่ระบบ'));
export function setProtectedFetch(fn) { fetchProtectedText = fn; }

// key ของ Google Maps (ล็อกไว้ให้ใช้ได้เฉพาะเว็บ my-web-p3 / my-website-pm และเปิดเฉพาะ Maps JavaScript API)
const GOOGLE_MAPS_KEY = ['AIzaSyBX7FmeGhUSMBh_', 'vIUM2x-YS_cp2_LtSh8'].join('');
// ตัวนับโควตาร่วม (apps-script/maps-quota.gs) — เว้นว่าง = ยังไม่ได้ติดตั้ง → ปุ่ม Google / Street View ใช้ไม่ได้
export const QUOTA_API_URL = 'https://script.google.com/macros/s/AKfycbymzE6rCfY5nP4uX4K96NH5sQ_nBKwpQ8tUscw3ubO3voQal5CGp38_bH1SltZl2elCnA/exec';
export const MAPS_MONTHLY_LIMIT = 9000;   // ต้องตรงกับ maps-quota.gs (Google ให้ฟรี 10,000 ครั้ง/เดือน)
export const SV_MONTHLY_LIMIT = 4500;     // ต้องตรงกับ maps-quota.gs (ฟรี 5,000 ภาพ/เดือน)
const MUTANT_URL = 'https://unpkg.com/leaflet.gridlayer.googlemutant@0.14.1/dist/Leaflet.GoogleMutant.js';

const nf = n => Number(n).toLocaleString('th-TH');

/* ===== ตัวนับโควตา ===== */
async function claim(kind) {
  if (!QUOTA_API_URL) throw new Error('ยังไม่ได้ติดตั้งตัวนับโควตา Google Maps');
  const j = JSON.parse(await fetchProtectedText(QUOTA_API_URL, { kind }));
  if (j.status !== 'ok') throw new Error(j.message || 'ตัวนับโควตาตอบกลับผิดรูปแบบ');
  return j; // {status:'ok', ok, used, limit}
}

/* ===== โหลดสคริปต์ (โหลดสคริปต์ไม่นับเป็นการใช้แผนที่ — นับเฉพาะตอนสร้างแผนที่) ===== */
let gLoader = null, authFailed = false;
const authListeners = new Set();
export function loadGoogleScript() {
  if (window.google?.maps?.Map) return Promise.resolve(window.google.maps);
  if (gLoader) return gLoader;
  gLoader = new Promise((resolve, reject) => {
    window.__gmapsReady = () => resolve(window.google.maps);
    // Google เรียกเมื่อ key ใช้ไม่ได้ / ไม่อนุญาตเว็บนี้
    window.gm_authFailure = () => { authFailed = true; authListeners.forEach(f => f()); };
    const s = document.createElement('script');
    s.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(GOOGLE_MAPS_KEY)}&v=weekly&loading=async&language=th&region=TH&callback=__gmapsReady`;
    s.async = true;
    s.onerror = () => { gLoader = null; reject(new Error('โหลด Google Maps ไม่สำเร็จ ตรวจการเชื่อมต่ออินเทอร์เน็ต')); };
    document.head.append(s);
  });
  return gLoader;
}
let mutantLoader = null;
function loadMutant() {
  if (L.GridLayer.GoogleMutant) return Promise.resolve();
  mutantLoader ??= new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = MUTANT_URL;
    s.onload = () => (L.GridLayer.GoogleMutant ? resolve() : reject(new Error('โหลดตัวแสดง Google Maps ไม่สำเร็จ')));
    s.onerror = () => { mutantLoader = null; reject(new Error('โหลดตัวแสดง Google Maps ไม่สำเร็จ')); };
    document.head.append(s);
  });
  return mutantLoader;
}

/* ===== รูปแบบแผนที่ ===== */
const LEAN = [
  { featureType: 'poi', stylers: [{ visibility: 'off' }] },
  { featureType: 'transit', stylers: [{ visibility: 'off' }] }
];
const DARK = [
  ...LEAN,
  { elementType: 'geometry', stylers: [{ color: '#1b2433' }] },
  { elementType: 'labels.text.fill', stylers: [{ color: '#9fb0c8' }] },
  { elementType: 'labels.text.stroke', stylers: [{ color: '#0e1726' }] },
  { featureType: 'administrative', elementType: 'geometry.stroke', stylers: [{ color: '#3a4a63' }] },
  { featureType: 'road', elementType: 'geometry', stylers: [{ color: '#2a3547' }] },
  { featureType: 'road.highway', elementType: 'geometry', stylers: [{ color: '#3b4f7a' }] },
  { featureType: 'road.highway', elementType: 'labels.text.fill', stylers: [{ color: '#c9d6ff' }] },
  { featureType: 'water', elementType: 'geometry', stylers: [{ color: '#0b1a2b' }] }
];
const MAP_TYPES = { street: 'roadmap', dark: 'roadmap', satellite: 'satellite', hybrid: 'hybrid', terrain: 'terrain' };
const stylesFor = (type, poi) => (type === 'dark' ? DARK : LEAN).filter(s => !(poi && s.featureType === 'poi'));
const GOOGLE_LAYERS = { traffic: 'TrafficLayer', transit: 'TransitLayer', bike: 'BicyclingLayer' };

/* ===== ชั้นพื้นหลัง Google =====
 * getGoogleBase() → Promise<{layer, setType(type, poi), setOverlay(id, on), used}>
 * reject ด้วย Error ที่มี .reason = 'quota' | 'auth' | 'setup' | 'load' */
let basePromise = null;
export function getGoogleBase() {
  basePromise ??= (async () => {
    let q;
    try { q = await claim('map'); }
    catch (e) { throw Object.assign(new Error(QUOTA_API_URL ? `ตรวจสอบโควตา Google Maps ไม่สำเร็จ (${e.message}) จึงยังไม่โหลดแผนที่ Google` : e.message), { reason: 'setup' }); }
    if (!q.ok) throw Object.assign(new Error(`เดือนนี้ใช้ Google Maps ครบ ${nf(q.limit || MAPS_MONTHLY_LIMIT)} ครั้งแล้ว (ทั้ง 2 เว็บรวมกัน) นับใหม่ต้นเดือนหน้า`), { reason: 'quota' });
    try { await Promise.all([loadGoogleScript(), loadMutant()]); }
    catch (e) { throw Object.assign(e, { reason: 'load' }); }
    if (authFailed) throw Object.assign(new Error('Google Maps ปฏิเสธ key นี้'), { reason: 'auth' });
    const layer = L.gridLayer.googleMutant({ type: 'roadmap', styles: LEAN, maxZoom: 19, maxNativeZoom: 19 });
    // ปลั๊กอินเดาว่า "Google ไม่มีภาพที่ซูมนี้" ถ้าแผนที่กำลังซูมอยู่ตอนตรวจ แล้วล็อกภาพไว้ที่ซูมต่ำ (แผนที่เบลอ/เทา)
    // ประเทศไทยมีภาพถึงซูม 19 อยู่แล้ว จึงปิดการตรวจนี้
    layer._checkZoomLevels = () => {};
    const subs = new Map();
    let cur = { type: 'street', poi: false };
    const setType = (type, poi) => {
      if (cur.type === type && cur.poi === poi) return;
      cur = { type, poi };
      const id = MAP_TYPES[type] || 'roadmap';
      layer.options.type = id; layer.options.styles = stylesFor(type, poi);
      const g = layer._mutant;
      if (!g) { layer._imagesPerTile = id === 'hybrid' ? 2 : 1; return; } // ยังไม่สร้าง: ใช้ค่าใน options ตอนสร้าง
      g.setOptions({ mapTypeId: id, styles: stylesFor(type, poi) });
      // ปลั๊กอินจับภาพทีละช่อง: เปลี่ยนรูปแบบแล้วต้องล้างภาพเก่าที่จำไว้ แล้ววาดใหม่
      layer._imagesPerTile = id === 'hybrid' ? 2 : 1;
      layer._lru?.clear?.(); layer._tileCallbacks = {};
      if (layer._map) layer.redraw();
    };
    const setOverlay = (id, on) => {
      const name = GOOGLE_LAYERS[id]; if (!name) return;
      if (on && !subs.has(id)) { layer.addGoogleLayer(name); subs.set(id, true); }
      else if (!on && subs.has(id)) { layer.removeGoogleLayer(name); subs.delete(id); }
    };
    return { layer, setType, setOverlay, used: q.used, limit: q.limit || MAPS_MONTHLY_LIMIT };
  })();
  basePromise.catch(() => {}); // ข้อผิดพลาดถูกจัดการโดยผู้เรียก — ไม่ลองซ้ำจนกว่าจะรีเฟรชหน้า
  return basePromise;
}
export function onGoogleAuthFail(cb) { authListeners.add(cb); return () => authListeners.delete(cb); }

/* ===== Street View ในพื้นที่แผนที่ =====
 * เปิดภาพ 1 ครั้ง = นับ 1 (Google คิดตามจำนวนภาพที่เปิด หมุนดูต่อไม่นับเพิ่ม) นับก่อนสร้างภาพเสมอ
 * ครบโควตา / key ใช้ไม่ได้ / นับไม่สำเร็จ → ไม่เปิดภาพ แสดงลิงก์ไป Street View บนเว็บ Google แทน (ฟรี ไม่นับ) */
export const streetViewLink = p => `https://www.google.com/maps/@?api=1&map_action=pano&viewpoint=${p.lat},${p.lng}`;
let svPanel = null;
export function openStreetView(host, at, esc) {
  closeStreetView();
  const link = streetViewLink(at);
  const el = document.createElement('div');
  el.className = 'sv-panel';
  el.setAttribute('role', 'dialog'); el.setAttribute('aria-label', 'Street View');
  el.innerHTML = `<div class="sv-head"><button type="button" class="sv-x" aria-label="ปิด Street View">✕</button><strong>Street View</strong>
      <span class="sv-name">${esc(at.name || `${at.lat.toFixed(5)}, ${at.lng.toFixed(5)}`)}</span>
      <a class="sv-link" href="${link}" target="_blank" rel="noopener">↗ เปิดบน Google Maps</a></div>
    <div class="sv-body"><div class="sv-canvas" hidden></div><div class="sv-msg">กำลังโหลด Street View…</div></div>
    <div class="sv-foot" hidden></div>`;
  host.append(el);
  const state = { alive: true, pano: null };
  svPanel = { el, state };
  el.querySelector('.sv-x').addEventListener('click', closeStreetView);
  const msg = (title, text) => {
    el.querySelector('.sv-canvas').hidden = true;
    el.querySelector('.sv-msg').innerHTML = `<strong>${title}</strong><span>${text}</span><a class="popbtn" href="${link}" target="_blank" rel="noopener">↗ เปิด Street View บน Google Maps</a>`;
  };
  (async () => {
    let q;
    try { q = await claim('sv'); }
    catch (e) { if (state.alive) msg('ยังเปิด Street View ในหน้านี้ไม่ได้', `${esc(e.message)} (เพื่อไม่ให้เกินโควตาฟรี)`); return; }
    if (!state.alive) return;
    if (!q.ok) { msg(`เดือนนี้ใช้ Street View ครบ ${nf(q.limit || SV_MONTHLY_LIMIT)} ครั้งแล้ว`, 'จำกัดไว้เพื่อไม่ให้เกินโควตาฟรีของ Google นับใหม่ต้นเดือนหน้า ระหว่างนี้เปิดดูบน Google Maps ได้ฟรี'); return; }
    if (authFailed) { msg('ยังเปิด Street View ในหน้านี้ไม่ได้', 'Google Maps ใช้ไม่ได้ (key ถูกปฏิเสธ)'); return; }
    try {
      const gm = await loadGoogleScript();
      if (!state.alive) return;
      const box = el.querySelector('.sv-canvas');
      box.hidden = false; el.querySelector('.sv-msg').hidden = true;
      state.pano = new gm.StreetViewPanorama(box, {
        position: { lat: at.lat, lng: at.lng }, pov: { heading: 0, pitch: 0 }, zoom: 1,
        addressControl: false, fullscreenControl: false, motionTracking: false, motionTrackingControl: false,
        clickToGo: true, linksControl: true, panControl: true, zoomControl: true, enableCloseButton: false
      });
      state.pano.addListener('status_changed', () => {
        if (state.alive && state.pano.getStatus() === 'ZERO_RESULTS') { el.querySelector('.sv-msg').hidden = false; msg('ไม่มีภาพ Street View ตรงจุดนี้', 'ลองดูบน Google Maps ซึ่งอาจมีภาพใกล้เคียง'); }
      });
      const foot = el.querySelector('.sv-foot');
      foot.hidden = false;
      foot.textContent = `เดือนนี้เปิดไปแล้ว ${nf(q.used)} / ${nf(q.limit || SV_MONTHLY_LIMIT)} ครั้ง (ทุกคน 2 เว็บรวมกัน)`;
    } catch (e) {
      if (state.alive) { el.querySelector('.sv-msg').hidden = false; msg('ยังเปิด Street View ในหน้านี้ไม่ได้', esc(e.message || 'โหลด Google Maps ไม่สำเร็จ')); }
    }
  })();
}
export function closeStreetView() {
  if (!svPanel) return;
  svPanel.state.alive = false;
  svPanel.state.pano?.setVisible(false);
  svPanel.el.remove();
  svPanel = null;
}
