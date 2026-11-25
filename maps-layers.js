/* ชั้นข้อมูลเสริมของ Access Maps (ใช้กับ maps.js) — ยกมาจาก my-web-p3
 *  1) ฝน: เรดาร์ RainViewer (ละเอียด ย้อนหลัง 2 ชม.) / ดาวเทียม NASA GIBS (หยาบ ย้อนหลัง 6 ชม. ช้ากว่าจริงหลายชั่วโมง)
 *  2) งานออฟชอร์: แท่นผลิตและแปลงสัมปทานปิโตรเลียม จากกรมเชื้อเพลิงธรรมชาติ (บริการสาธารณะ ไม่ต้องใช้ key)
 *  3) ตำบล/อำเภอ/จังหวัด ของพิกัดใด ๆ คำนวณในเครื่องจากไฟล์ data/admin3.json (ขอบเขตของกรมแผนที่ทหาร ผ่าน OCHA/HDX)
 * ทุกอย่างฟรี ไม่มี key ถ้าแหล่งใดล่ม ส่วนอื่นของแผนที่ยังทำงานตามเดิม
 */

/* ===== 1) ฝน ===== */
const RV_API = 'https://api.rainviewer.com/public/weather-maps.json';
const GIBS = 'https://gibs.earthdata.nasa.gov/wmts/epsg3857/best/IMERG_Precipitation_Rate_30min/default';
const GIBS_STEP_MS = 30 * 60 * 1000;
const GIBS_FRAMES = 12;
export const RAIN_SHOW_MAX_ZOOM = 12; // ซูมใกล้กว่านี้ข้อมูลหยาบเกินไป ซ่อนไว้
export const RAIN_OPACITY = 0.65;
const RAIN_CACHE_MS = 4 * 60 * 1000;
const rainCache = {};

async function loadRadar() {
  const res = await fetch(RV_API, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const j = await res.json();
  const frames = (j.radar?.past ?? []).map(f => ({ time: f.time * 1000, template: `${j.host}${f.path}/256/{z}/{x}/{y}/2/1_1.png` }));
  if (!j.host || !frames.length) throw new Error('no radar frames');
  return { source: 'radar', frames, maxZoom: 7, lagMs: 0, credit: { name: 'RainViewer', url: 'https://www.rainviewer.com/' } };
}
async function loadNasa() {
  // ขอภาพแบบไม่ระบุเวลา = ได้ข้อมูลล่าสุด และ header บอกเวลาของข้อมูลนั้น
  const res = await fetch(`${GIBS}/default/GoogleMapsCompatible_Level6/0/0/0.png`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const latest = Date.parse(res.headers.get('layer-time-actual') ?? '');
  if (!Number.isFinite(latest)) throw new Error('no data time');
  const frames = [];
  for (let i = GIBS_FRAMES - 1; i >= 0; i--) {
    const t = latest - i * GIBS_STEP_MS;
    frames.push({ time: t, template: `${GIBS}/${new Date(t).toISOString().replace('.000Z', 'Z')}/GoogleMapsCompatible_Level6/{z}/{y}/{x}.png` });
  }
  return {
    source: 'nasa', frames, maxZoom: 6, lagMs: Math.max(0, Date.now() - (latest + GIBS_STEP_MS)),
    credit: { name: 'NASA GIBS', url: 'https://www.earthdata.nasa.gov/data/tools/gibs' }
  };
}
/** → {source, frames:[{time, template}], maxZoom, lagMs, credit} เก่าสุดก่อน */
export async function loadRainFrames(source = 'radar') {
  const hit = rainCache[source];
  if (hit && Date.now() - hit.at < RAIN_CACHE_MS) return hit.data;
  const data = await (source === 'nasa' ? loadNasa() : loadRadar());
  rainCache[source] = { at: Date.now(), data };
  return data;
}
export const rainTimeLabel = ms => new Intl.DateTimeFormat('th-TH', { hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Bangkok' }).format(new Date(ms));
export function lagLabel(lagMs) {
  const h = lagMs / 3600000;
  if (h < 0.5) return '';
  return h < 1 ? `ช้า ~${Math.round(h * 60)} นาที` : `ช้า ~${h < 10 ? h.toFixed(1) : Math.round(h)} ชม.`;
}

/* ===== 2) งานออฟชอร์ (DMF) ===== */
const DMF = 'https://gis.dmf.go.th/arcgis/rest/services/GIS_Internet/GIS_Internet_2018/MapServer';
export const DMF_CREDIT = 'กรมเชื้อเพลิงธรรมชาติ (DMF) · ชุดข้อมูลปี 2018';
export const PLATFORM_GROUP = 'แท่นผลิตนอกชายฝั่ง';
export const PLATFORM_COLOR = '#0e7490';
const AREA_OFFSHORE_COLOR = '#0e7490';
const AREA_ONSHORE_COLOR = '#b45309';
export const areaColor = props => (props.shore === 'Onshore' ? AREA_ONSHORE_COLOR : AREA_OFFSHORE_COLOR);

const txt = v => String(v ?? '').replace(/\s+/g, ' ').trim();
const dateTh = ms => {
  const n = Number(ms);
  return Number.isFinite(n) && n > 0 ? new Intl.DateTimeFormat('th-TH', { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(n)) : '';
};
async function dmfQuery(layer, params) {
  const qs = new URLSearchParams({ where: '1=1', outSR: '4326', f: 'geojson', ...params });
  const res = await fetch(`${DMF}/${layer}/query?${qs}`);
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const json = await res.json();
  if (json.error) throw new Error(json.error.message || 'service error');
  if (json.type !== 'FeatureCollection') throw new Error('unexpected reply');
  return json;
}
let offshoreMemory = null;
/** → {platforms:[{name,lat,lng,platform:{...}}], areas: GeoJSON} (โหลดครั้งแรกที่เปิดชั้น จำไว้ระหว่างเปิดหน้า) */
export async function loadOffshore() {
  if (offshoreMemory) return offshoreMemory;
  const [pl, ar] = await Promise.all([
    dmfQuery(1, { outFields: 'OBJECTID,NAME_TYPET,OPERATOR_E,OPERATOR_T,FIELD,LEASE,BLOCK,TYPE,INSTALL_D', geometryPrecision: '5' }),
    dmfQuery(2, { outFields: 'BLOCK,LEASE_NO,SHORE,STATUS,ISSUE_DATE,AREA_KM,OPERATOR_E,OPERATOR_T,OWNER', maxAllowableOffset: '0.002', geometryPrecision: '4' })
  ]);
  const platforms = [];
  for (const f of pl.features) {
    const c = f.geometry?.type === 'Point' ? f.geometry.coordinates : null;
    if (!c || !(c[1] >= 5 && c[1] <= 21 && c[0] >= 95 && c[0] <= 110)) continue;
    const p = f.properties;
    platforms.push({
      name: txt(p.NAME_TYPET) || `แท่น ${txt(p.FIELD) || p.OBJECTID}`, lat: c[1], lng: c[0],
      platform: {
        operator: txt(p.OPERATOR_T) || txt(p.OPERATOR_E), operatorE: txt(p.OPERATOR_E),
        field: txt(p.FIELD), block: txt(p.BLOCK), lease: txt(p.LEASE), type: txt(p.TYPE), installed: dateTh(p.INSTALL_D)
      }
    });
  }
  const features = ar.features.filter(f => f.geometry).map(f => {
    const p = f.properties;
    return {
      type: 'Feature', geometry: f.geometry,
      properties: {
        block: txt(p.BLOCK), lease: txt(p.LEASE_NO), shore: txt(p.SHORE), status: txt(p.STATUS), issued: dateTh(p.ISSUE_DATE),
        areaKm: Number.isFinite(Number(p.AREA_KM)) ? Math.round(Number(p.AREA_KM)) : null,
        operator: txt(p.OPERATOR_T) || txt(p.OPERATOR_E), owner: txt(p.OWNER)
      }
    };
  });
  offshoreMemory = { platforms, areas: { type: 'FeatureCollection', features } };
  return offshoreMemory;
}
const SHORE_TH = { Offshore: 'ในทะเล', Onshore: 'บนบก' };
const STATUS_TH = { Production: 'กำลังผลิต', Exploration: 'สำรวจ', OCA: 'พื้นที่พัฒนาร่วม (OCA)', 'Exploration / OCA': 'สำรวจ / OCA' };
export function areaPopupHtml(props, esc) {
  const line = (label, v) => (v ? `<div class="ptt-line"><b>${label}</b> ${esc(v)}</div>` : '');
  const color = areaColor(props);
  return `<div class="popup-title">${esc(props.block || props.lease || 'แปลงสัมปทาน')}</div>
    <div class="ptt-detail"><span class="ptt-type" style="background:${color}">แปลงสัมปทาน</span><span class="ptt-prov">${esc(SHORE_TH[props.shore] ?? props.shore)}</span>
    ${line('สัมปทานเลขที่', props.lease)}${line('สถานะ', STATUS_TH[props.status] ?? props.status)}${line('ผู้ดำเนินการ', props.operator)}${line('เจ้าของ', props.owner)}
    ${line('ออกให้เมื่อ', props.issued)}${props.areaKm ? line('พื้นที่', `${props.areaKm.toLocaleString('th-TH')} ตร.กม.`) : ''}
    <div class="pop-src">ที่มา: ${esc(DMF_CREDIT)}</div></div>`;
}
export function platformDetailsHtml(d, esc) {
  const line = (label, v) => (v ? `<div class="ptt-line"><b>${label}</b> ${esc(v)}</div>` : '');
  return `<div class="ptt-detail"><span class="ptt-type" style="background:${PLATFORM_COLOR}">◆ ${esc(PLATFORM_GROUP)}</span>${d.type ? `<span class="ptt-prov">${esc(d.type)}</span>` : ''}
    ${line('ผู้ดำเนินการ', d.operator)}${line('แหล่ง', d.field)}${line('แปลง', d.block)}${line('สัมปทาน', d.lease)}${line('ติดตั้ง', d.installed)}
    <div class="pop-src">ที่มา: ${esc(DMF_CREDIT)}</div></div>`;
}
/** ลิงก์ Windy (ลม คลื่น พยากรณ์ฝน) ที่จุดนั้น — ฟรี เป็นแค่ลิงก์ */
export const windyLink = (p, zoom = 9) => `https://www.windy.com/${p.lat.toFixed(3)}/${p.lng.toFixed(3)}?${p.lat.toFixed(3)},${p.lng.toFixed(3)},${zoom}`;

/* ===== 3) ตำบล / อำเภอ / จังหวัด =====
 * รูปแบบไฟล์: { v, provinces:[name], districts:[[provinceIndex,name]], subs:[[districtIndex,name]],
 *   f:[[subIndex,minX,minY,maxX,maxY,[polygon,...]]] } พิกัดหน่วย 1/10000 องศา (x = ลองจิจูด)
 * เส้นขอบถูกทำให้เรียบลง จุดที่อยู่ติดแนวเขตอาจได้พื้นที่ข้างเคียง ถือเป็นค่าโดยประมาณ */
export const ADMIN_CREDIT = 'ขอบเขตการปกครอง: กรมแผนที่ทหาร ผ่าน OCHA/HDX (CC BY-IGO) · ค่าโดยประมาณ ใกล้แนวเขตอาจคลาดเคลื่อน';
const UNIT = 10000, CELL = 2000, NEAR = 120;
let adminLoading = null, adminLookup = null;
const cellKey = (cx, cy) => cx * 100000 + cy;
function inRing(ring, x, y) {
  let inside = false;
  for (let i = 0, j = ring.length - 2; i < ring.length; j = i, i += 2) {
    const xi = ring[i], yi = ring[i + 1], xj = ring[j], yj = ring[j + 1];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const inPolygon = (poly, x, y) => inRing(poly[0], x, y) && !poly.slice(1).some(h => inRing(h, x, y));
function ringDist2(ring, x, y) {
  let best = Infinity;
  for (let i = 0; i < ring.length; i += 2) { const dx = ring[i] - x, dy = ring[i + 1] - y, d = dx * dx + dy * dy; if (d < best) best = d; }
  return best;
}
function createAdminLookup(d) {
  const grid = new Map();
  d.f.forEach((f, i) => {
    const [, x0, y0, x1, y1] = f;
    for (let cx = Math.floor(x0 / CELL); cx <= Math.floor(x1 / CELL); cx++)
      for (let cy = Math.floor(y0 / CELL); cy <= Math.floor(y1 / CELL); cy++) {
        const k = cellKey(cx, cy), g = grid.get(k);
        if (g) g.push(i); else grid.set(k, [i]);
      }
  });
  const result = (sub, near) => { const [di, t] = d.subs[sub]; const [pi, a] = d.districts[di]; return { t, a, p: d.provinces[pi], near }; };
  return (lat, lng) => {
    const x = Math.round(lng * UNIT), y = Math.round(lat * UNIT), cx = Math.floor(x / CELL), cy = Math.floor(y / CELL);
    let nearest = null, nearD = NEAR * NEAR;
    for (const ox of [0, -1, 1]) for (const oy of [0, -1, 1]) {
      for (const i of grid.get(cellKey(cx + ox, cy + oy)) ?? []) {
        const [sub, x0, y0, x1, y1, polys] = d.f[i];
        if (x >= x0 && x <= x1 && y >= y0 && y <= y1 && polys.some(poly => inPolygon(poly, x, y))) return result(sub, false);
        if (x >= x0 - NEAR && x <= x1 + NEAR && y >= y0 - NEAR && y <= y1 + NEAR)
          for (const poly of polys) { const dd = ringDist2(poly[0], x, y); if (dd < nearD) { nearD = dd; nearest = sub; } }
      }
    }
    return nearest === null ? null : result(nearest, true);
  };
}
/** โหลดไฟล์ขอบเขต (ครั้งเดียว ~8 MB) */
export function loadAdmin() {
  if (adminLookup) return Promise.resolve();
  adminLoading ??= fetch('./data/admin3.json')
    .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
    .then(d => { if (d.v !== 1) throw new Error('unknown boundary file version'); adminLookup = createAdminLookup(d); })
    .catch(e => { adminLoading = null; throw e; });
  return adminLoading;
}
export const adminReady = () => !!adminLookup;
/** → {t: ตำบล, a: อำเภอ, p: จังหวัด, near} หรือ null (ยังไม่โหลด / อยู่ในทะเล / นอกประเทศ) */
export const areaOf = (lat, lng) => (adminLookup ? adminLookup(lat, lng) : null);
const BKK = 'กรุงเทพมหานคร';
/** "ต.บางนา อ.บางนา จ.ชลบุรี" (กรุงเทพฯ: "แขวง… เขต… กรุงเทพมหานคร") */
export function formatArea(a) {
  if (!a) return '';
  const bkk = a.p === BKK;
  const sub = a.t.startsWith('แขวง') || a.t.startsWith('ต.') ? a.t : `${bkk ? 'แขวง' : 'ต.'}${a.t}`;
  const dist = a.a.startsWith('เขต') || a.a.startsWith('อ.') ? a.a : `${bkk ? 'เขต' : 'อ.'}${a.a}`;
  return `${sub} ${dist} ${bkk ? a.p : `จ.${a.p}`}`;
}
/** ชื่อพื้นที่ทุกแบบที่คนพิมพ์ค้นหา (ตัวพิมพ์เล็ก) */
export function areaSearchText(a) {
  if (!a) return '';
  const bkk = a.p === BKK;
  return `${a.t} ${a.a} ${a.p} ${formatArea(a)} ${bkk ? `แขวง${a.t} เขต${a.a}` : `ตำบล${a.t} อำเภอ${a.a} จังหวัด${a.p}`}`.toLowerCase();
}
