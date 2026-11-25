/* เส้นทางขับจริง + วางแผนเส้นทาง (ใช้กับ maps.js) — ยกมาจาก my-web-p3 (src/routing.js, src/planner.js, src/planTiming.js)
 *
 * เส้นทางมาจากเซิร์ฟเวอร์ OSRM สาธารณะ (ถนน OpenStreetMap ฟรี ไม่ต้องใช้ key) เป็นเซิร์ฟเวอร์ทดลองที่ใช้ร่วมกัน
 * จึงเรียกเฉพาะตอนผู้ใช้กดเท่านั้น ห่างกันอย่างน้อย 1 วินาที และไม่เกิน DAY_CAP ครั้ง/วัน/เครื่อง
 * โปรไฟล์ "driving" คิดแบบรถยนต์ ไม่รวมรถติด — เวลาในแผนเส้นทางจึงคิดใหม่จากความเร็วรถบรรทุกของบริษัท
 */

const BASE = 'https://router.project-osrm.org';
export const OSRM_CREDIT = { name: 'OSRM', url: 'https://project-osrm.org/' };
const MIN_GAP_MS = 1100;
const DAY_CAP = 300;
const SNAP_MAX_M = 1500; // จุดที่ห่างถนนเกินนี้ (เช่น อยู่ในทะเล) ถือว่าไม่มีเส้นทาง

const USE_KEY = 'accessMapsRouteUse';
const today = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Bangkok' }).format(new Date());

function takeCall() {
  let u = { d: today(), n: 0 };
  try { const s = JSON.parse(localStorage.getItem(USE_KEY) || 'null'); if (s && s.d === u.d) u = s; } catch {}
  if (u.n >= DAY_CAP) throw new Error(`เรียกคำนวณเส้นทางครบ ${DAY_CAP} ครั้งแล้ววันนี้`);
  u.n += 1;
  try { localStorage.setItem(USE_KEY, JSON.stringify(u)); } catch {}
}

let last = 0;
async function call(path) {
  const wait = last + MIN_GAP_MS - Date.now();
  if (wait > 0) await new Promise(r => setTimeout(r, wait));
  takeCall();
  last = Date.now();
  const res = await fetch(`${BASE}${path}`);
  if (!res.ok) throw new Error(`บริการเส้นทางตอบกลับ HTTP ${res.status}`);
  const j = await res.json();
  if (j.code !== 'Ok') throw new Error(j.message || j.code);
  return j;
}

const lonLat = p => `${p.lng},${p.lat}`;

/** ระยะและเวลาขับจาก from ไปแต่ละจุดใน dests (เรียก 1 ครั้ง) → [{km,min} | null] ตามลำดับเดิม */
export async function driveTable(from, dests) {
  if (!dests.length) return [];
  const j = await call(`/table/v1/driving/${[from, ...dests].map(lonLat).join(';')}?sources=0&annotations=duration,distance`);
  if ((j.sources?.[0]?.distance ?? 0) > SNAP_MAX_M) throw new Error('ตำแหน่งต้นทางอยู่ไกลจากถนนเกินไป');
  return dests.map((_, i) => {
    const d = j.distances?.[0]?.[i + 1], t = j.durations?.[0]?.[i + 1];
    const snap = j.destinations?.[i + 1]?.distance ?? 0;
    if (d == null || t == null || snap > SNAP_MAX_M) return null;
    return { km: d / 1000, min: t / 60 };
  });
}

/** เส้นทางขับจาก from ไป to → {km, min, coords:[[lat,lng],...]} */
export async function driveRoute(from, to) {
  const j = await call(`/route/v1/driving/${lonLat(from)};${lonLat(to)}?overview=full&geometries=geojson`);
  const r = j.routes?.[0];
  if (!r) throw new Error('ไม่พบเส้นทางถนน');
  if (Math.max(j.waypoints?.[0]?.distance ?? 0, j.waypoints?.[1]?.distance ?? 0) > SNAP_MAX_M) throw new Error('จุดอยู่ไกลจากถนนเกินไป');
  return { km: r.distance / 1000, min: r.duration / 60, coords: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]) };
}

/** เวลา/ระยะขับระหว่างทุกคู่ของ points (เรียก 1 ครั้ง) → {dur:[[นาที]], dist:[[กม.]]} */
export async function driveMatrix(points) {
  const j = await call(`/table/v1/driving/${points.map(lonLat).join(';')}?annotations=duration,distance`);
  const bad = (j.sources ?? []).findIndex(s => (s?.distance ?? 0) > SNAP_MAX_M);
  if (bad >= 0) throw new Error(`จุดที่ ${bad + 1} อยู่ไกลจากถนนเกินไป`);
  const conv = (m, f) => (m ?? []).map(row => row.map(v => (v == null ? null : v / f)));
  return { dur: conv(j.durations, 60), dist: conv(j.distances, 1000) };
}

/** เส้นทางเดียวผ่านทุกจุดตามลำดับ → {km, min, coords, legs:[{km,min}]} (error.waypoint = ลำดับจุดที่ห่างถนน) */
export async function driveRouteVia(points) {
  const j = await call(`/route/v1/driving/${points.map(lonLat).join(';')}?overview=full&geometries=geojson`);
  const r = j.routes?.[0];
  if (!r) throw new Error('ไม่พบเส้นทางถนน');
  const bad = (j.waypoints ?? []).findIndex(w => (w?.distance ?? 0) > SNAP_MAX_M);
  if (bad >= 0) throw Object.assign(new Error(`จุดที่ ${bad + 1} อยู่ไกลจากถนนเกินไป`), { waypoint: bad });
  return {
    km: r.distance / 1000, min: r.duration / 60,
    coords: r.geometry.coordinates.map(([lng, lat]) => [lat, lng]),
    legs: r.legs.map(l => ({ km: l.distance / 1000, min: l.duration / 60 }))
  };
}

export const formatMin = min => (min < 60
  ? `${Math.max(1, Math.round(min))} นาที`
  : `${Math.floor(min / 60)} ชม. ${Math.round(min % 60)} นาที`);

/* ===== ตัวช่วยวางแผนเส้นทาง (ไม่มีเน็ต ไม่มีแผนที่) ===== */

export const MAX_STOPS = 9;  // ลิงก์ Google Maps รับต้นทาง ปลายทาง และจุดแวะได้ราว 7-9 จุด
export const MAX_VIAS = 10;
const KM_PER_DEG = 111.32;

/** จุดที่อยู่ห่างเส้นทางไม่เกิน maxKm พร้อมระยะห่างจากเส้น และระยะตามเส้นทางจากจุดเริ่ม เรียงตามเส้นทาง */
export function alongRoute(coords, points, maxKm) {
  if (coords.length < 2) return { items: [], total: 0 };
  const k = Math.cos((coords[Math.floor(coords.length / 2)][0] * Math.PI) / 180);
  const xy = coords.map(([la, lo]) => [lo * k * KM_PER_DEG, la * KM_PER_DEG]);
  const cum = [0];
  for (let i = 1; i < xy.length; i++) cum.push(cum[i - 1] + Math.hypot(xy[i][0] - xy[i - 1][0], xy[i][1] - xy[i - 1][1]));
  let minLat = Infinity, maxLat = -Infinity, minLng = Infinity, maxLng = -Infinity;
  for (const [la, lo] of coords) { if (la < minLat) minLat = la; if (la > maxLat) maxLat = la; if (lo < minLng) minLng = lo; if (lo > maxLng) maxLng = lo; }
  const padLat = maxKm / KM_PER_DEG, padLng = maxKm / (KM_PER_DEG * k);
  minLat -= padLat; maxLat += padLat; minLng -= padLng; maxLng += padLng;
  const out = [];
  for (const p of points) {
    if (p.lat < minLat || p.lat > maxLat || p.lng < minLng || p.lng > maxLng) continue;
    const px = p.lng * k * KM_PER_DEG, py = p.lat * KM_PER_DEG;
    let best = Infinity, at = 0;
    for (let i = 1; i < xy.length; i++) {
      const ax = xy[i - 1][0], ay = xy[i - 1][1], dx = xy[i][0] - ax, dy = xy[i][1] - ay;
      const len2 = dx * dx + dy * dy;
      let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
      t = t < 0 ? 0 : t > 1 ? 1 : t;
      const d = Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
      if (d < best) { best = d; at = cum[i - 1] + t * Math.sqrt(len2); }
    }
    if (best <= maxKm) out.push({ p, offKm: best, atKm: at });
  }
  return { items: out.sort((a, b) => a.atKm - b.atKm), total: cum[cum.length - 1] || 1 };
}

/** ลำดับที่ขับรวมเร็วที่สุด เริ่มที่จุด 0 จบที่ไหนก็ได้ (ลองทุกแบบ ใช้ได้ถึง 9 จุด) → [0, ...] หรือ null */
export function bestOrder(dur) {
  const n = dur.length;
  if (n <= 2) return Array.from({ length: n }, (_, i) => i);
  let best = Infinity, bestPath = null;
  const used = new Array(n).fill(false); used[0] = true;
  const path = [0];
  const walk = cost => {
    if (cost >= best) return;
    if (path.length === n) { best = cost; bestPath = [...path]; return; }
    const lastI = path[path.length - 1];
    for (let j = 1; j < n; j++) {
      if (used[j] || dur[lastI][j] == null) continue;
      used[j] = true; path.push(j);
      walk(cost + dur[lastI][j]);
      path.pop(); used[j] = false;
    }
  };
  walk(0);
  return bestPath;
}

/** เวลาถึงแต่ละจุด: เวลาออก แล้วแต่ละช่วงใช้ กม. ÷ ความเร็ว (ปัดเป็นนาที) */
export function etaTimes(departMs, legsKm, speedKmh) {
  const out = [departMs];
  for (const km of legsKm) out.push(out[out.length - 1] + Math.round((km / speedKmh) * 60) * 60000);
  return out;
}
export const truckMinutes = (km, speedKmh) => (km / speedKmh) * 60;

/** จุดแวะ + จุดผ่าน (ที่ลากเส้นทาง) เรียงตามลำดับขับ — vias: [{lat,lng,leg}] leg = ลำดับจุดแวะที่จุดผ่านอยู่ถัดไป */
export function waypointsOf(stops, vias) {
  const pts = [], isVia = [];
  stops.forEach((s, i) => {
    pts.push({ lat: s.lat, lng: s.lng }); isVia.push(false);
    for (const v of vias) if (v.leg === i && i < stops.length - 1) { pts.push({ lat: v.lat, lng: v.lng }); isVia.push(true); }
  });
  return { pts, isVia };
}

/** รวมช่วงย่อย (ระหว่างจุดผ่าน) ให้เป็นช่วงระหว่างจุดแวะจริง */
export function mainLegs(legs, isVia) {
  const out = []; let cur = null;
  legs.forEach((l, i) => {
    cur = cur ? { km: cur.km + l.km, min: cur.min + l.min } : { km: l.km, min: l.min };
    if (!isVia[i + 1]) { out.push(cur); cur = null; }
  });
  return out;
}

/** จุดที่คลิกบนเส้นทางอยู่ช่วงย่อยไหน → {sub, atKm} */
export function locateOnRoute(coords, totalKm, legsKm, lat, lng) {
  const { items, total } = alongRoute(coords, [{ lat, lng }], 1e6);
  if (!items.length || !total) return { sub: 0, atKm: 0 };
  const atKm = items[0].atKm * (totalKm / total);
  let acc = 0, sub = legsKm.length - 1;
  for (let k = 0; k < legsKm.length; k++) { acc += legsKm[k]; if (atKm <= acc) { sub = k; break; } }
  return { sub, atKm };
}

/** ตัดช่วงย่อย sub เป็น 2 ท่อนที่ atKm (ให้ช่วงยังตรงกับจุดหลังเพิ่มจุดผ่าน) */
export function splitLeg(legs, sub, atKm) {
  const before = legs.slice(0, sub).reduce((s, l) => s + l.km, 0);
  const l = legs[sub];
  const first = Math.min(Math.max(atKm - before, 0), l.km);
  const r = l.km ? first / l.km : 0.5;
  return [...legs.slice(0, sub), { km: first, min: l.min * r }, { km: l.km - first, min: l.min * (1 - r) }, ...legs.slice(sub + 1)];
}

/** แทรกจุดผ่านใหม่ต่อจาก waypoint ลำดับ sub ของเส้นทางปัจจุบัน */
export function insertVia(stops, vias, sub, pt) {
  const { isVia } = waypointsOf(stops, vias);
  const upto = isVia.slice(0, sub + 1);
  const leg = upto.filter(v => !v).length - 1;
  const lastStop = upto.lastIndexOf(false);
  const pos = upto.slice(lastStop + 1).length;
  const before = vias.filter(v => v.leg < leg).length;
  const next = vias.slice();
  next.splice(before + pos, 0, { lat: pt.lat, lng: pt.lng, leg });
  return next;
}

const ll = s => `${s.lat.toFixed(6)},${s.lng.toFixed(6)}`;
/** ลิงก์นำทาง Google Maps ผ่านทุกจุดตามลำดับ (ฟรี เปิดในแอป/เว็บ Google Maps) */
export function googleDirections(stops) {
  if (stops.length < 2) return '';
  const u = new URLSearchParams({ api: '1', origin: ll(stops[0]), destination: ll(stops[stops.length - 1]), travelmode: 'driving' });
  if (stops.length > 2) u.set('waypoints', stops.slice(1, -1).map(ll).join('|'));
  return `https://www.google.com/maps/dir/?${u}`;
}

/* ===== ความเร็วรถบรรทุกของบริษัท (เหมือนหน้าเอกสารของ my-web-p3 / ค่าในระบบ PlanCheck) ===== */
export const SPEED = { '10W': 53, SEMI: 43 }; // กม./ชม.
export const TYPE_LABEL = { '10W': 'สิบล้อ', SEMI: 'หัวลาก+หาง' };
const T = '10W', S = 'SEMI';
const VEHICLE_TYPES = Object.fromEntries([
  // SCC-SCN
  ['79-5846', T], ['66-0756', T], ['62-3062', S], ['62-3107', S], ['66-0757', T], ['67-0167', T], ['62-3105', S],
  ['65-8563', S], ['79-0144', T], ['79-0641', T], ['77-4038', S], ['78-1482', S],
  // SCC-Atlas SRC
  ['62-4247', T], ['62-4246', T], ['62-4060', T], ['62-5209', T], ['62-5570', T], ['62-4061', S], ['62-4245', T],
  // SCC-Atlas BPK-BRP
  ['68-3732', T], ['65-8565', S], ['79-5584', T], ['79-1961', T], ['78-9103', T], ['60-0702', S], ['77-4043', S],
  ['79-0870', S], ['78-1469', S], ['65-8566', S], ['63-0035', T], ['61-6552', T], ['66-0770', T], ['63-1302', T],
  ['68-3731', T], ['63-0036', T], ['63-0037', T], ['63-1300', T], ['66-0755', T], ['79-0869', S], ['79-0871', S],
  ['60-0709', S], ['60-1037', S], ['77-0410', S], ['79-0841', T], ['61-4783', T], ['61-4778', T], ['79-1830', T],
  ['76-9801', S]
]);
const plateKey = p => (String(p ?? '').match(/(\d{1,3})\s*-\s*(\d{4})/) || []).slice(1).join('-');
/** ประเภทรถจากทะเบียน ('10W' | 'SEMI') หรือ null ถ้าไม่พบ */
export const vehicleTypeOf = plate => VEHICLE_TYPES[plateKey(plate)] ?? null;
