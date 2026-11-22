import { requireLogin, fetchProtectedText } from './firebase-guard.js?v=20261122-idle';
/* API ชุดที่ 1: Geofence — โค้ดอยู่ที่ apps-script/geofence.gs (URL เดิม ...uVCF ยังเปิดไว้ให้ my-web-p3 ใช้) */
const API_URL = 'https://script.google.com/macros/s/AKfycbyZFJgBnwq8u-8ND1zQo9T9tJ6XuGX5ZXIAeip2EkI6uNf7eZOhIqAjU435doLMtABf/exec';
/* API ชุดที่ 2: ปั๊มน้ำมันทุกแบรนด์ (แท็บละแบรนด์ มีรายละเอียดสถานี) — โค้ดอยู่ที่ apps-script/stations.gs เว้นว่างไว้ = ไม่โหลด */
const STATIONS_API_URL = 'https://script.google.com/macros/s/AKfycbx2TJEkaUdHu5gYck2T5YRsqCdfxFob8pTq78ehlhYgXsEV7oxEkYc5Dz3h3AQ1r40zNQ/exec';
const $ = id => document.getElementById(id);
let allRows = [], filteredRows = [], activeFilter = 'all', activeSupplier = 'all', selectedId = null, currentLayer = 'street';
// ชั้นข้อมูล: Geofence (Supplier) กับ ปั๊มน้ำมัน (แบรนด์) เปิด/ปิดแยกกัน และกรองแยกกัน — จำค่าที่เลือกไว้ในเครื่อง
let showGeo = true, showStations = false, activeBrand = 'all';
try{ const s=JSON.parse(localStorage.getItem('accessMapsLayers')||'null'); if(s){ showGeo=s.geo!==false; showStations=!!s.st; } }catch{}
function saveLayers(){ try{ localStorage.setItem('accessMapsLayers',JSON.stringify({geo:showGeo,st:showStations})); }catch{} }
const NO_SUPPLIER = '(ไม่ระบุ Supplier)';
let markerById = new Map();

const map = L.map('map',{zoomControl:false,preferCanvas:true}).setView([13.7563,100.5018],6);
L.control.zoom({position:'bottomright'}).addTo(map);
const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
  maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors',
  className:'street-tiles' // โหมดมืดใช้ CSS filter (--map-filter) กับเลเยอร์นี้เท่านั้น ภาพดาวเทียมไม่ถูกปรับสี
});
const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{
  maxZoom:19,attribution:'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
});
streetLayer.addTo(map);
const clusters = L.markerClusterGroup({chunkedLoading:true,chunkInterval:100,chunkDelay:25,maxClusterRadius:55,showCoverageOnHover:false,removeOutsideVisibleBounds:true,spiderfyOnMaxZoom:true});
map.addLayer(clusters);
// กลุ่มหมุดของปั๊มน้ำมันแยกจาก Geofence: วงกลุ่มคนละแบบ นับแยกกัน
const stationClusters = L.markerClusterGroup({chunkedLoading:true,chunkInterval:100,chunkDelay:25,maxClusterRadius:50,showCoverageOnHover:false,removeOutsideVisibleBounds:true,spiderfyOnMaxZoom:true,
  iconCreateFunction:c=>{
    const n=c.getChildCount(), size=n<10?30:n<100?36:n<1000?42:46;
    return L.divIcon({className:'stcluster',html:`<div style="width:${size}px;height:${size}px"><b>⛽</b>${n.toLocaleString('th-TH')}</div>`,iconSize:[size,size]});
  }});

let searchMarker = null;
// พิกัดที่ค้นหาล่าสุด (กด Enter) ใช้คำนวณ Geofence ที่ใกล้ที่สุด
let searchPoint = null;
const NEAREST_COUNT = 5;
const nearestLines = L.layerGroup().addTo(map);
// เส้นประวาดด้วย SVG แยกจากหมุดอื่น (แผนที่หลักใช้ canvas) เพื่อให้ทำเส้นประไหลด้วย CSS ได้
const nearestLineRenderer = L.svg({padding:0.5});

// ระยะทางเป็นกิโลเมตรแบบเส้นตรงบนผิวโลก (Haversine)
function distanceKm(lat1,lng1,lat2,lng2){
  const R=6371, toRad=d=>d*Math.PI/180;
  const dLat=toRad(lat2-lat1), dLng=toRad(lng2-lng1);
  const a=Math.sin(dLat/2)**2+Math.cos(toRad(lat1))*Math.cos(toRad(lat2))*Math.sin(dLng/2)**2;
  return 2*R*Math.asin(Math.sqrt(a));
}
function formatKm(km){
  if(km<10) return km.toLocaleString('th-TH',{minimumFractionDigits:2,maximumFractionDigits:2});
  return km.toLocaleString('th-TH',{minimumFractionDigits:1,maximumFractionDigits:1});
}
// "ใกล้ที่สุด 5 อันดับ" ตามชั้นที่เปิดอยู่: เปิด Geofence → นับ Geofence (ตาม Supplier)
// ปิด Geofence แต่เปิดปั๊ม → นับปั๊ม (ตามแบรนด์) · ปิดทั้งคู่ → ไม่มี (เส้นประ/แถบลอย/รายการหายไป)
const nearestKind = () => showGeo ? 'geo' : showStations ? 'station' : null;
// เปิดทั้ง 2 ชั้น → แสดงปั๊มใกล้สุดเพิ่มต่อท้ายแยกออกมา
const showPumpExtra = () => showGeo && showStations;
function nearestPoints(lat,lng,n=NEAREST_COUNT){
  const kind=nearestKind();
  if(!kind) return [];
  if(kind==='station') return nearestStations(lat,lng,n);
  return allRows
    .filter(p=>p.kind==='geo'&&validPoint(p)&&(activeSupplier==='all'||p.supplier===activeSupplier))
    .map(p=>({p,km:distanceKm(lat,lng,p.lat,p.lng)}))
    .sort((a,b)=>a.km-b.km)
    .slice(0,n);
}
// ปั๊มน้ำมันที่ใกล้ที่สุด (ตามแบรนด์ที่เลือกอยู่) — ใช้เมื่อเปิดชั้นปั๊มน้ำมัน
function nearestStations(lat,lng,n=1){
  return allRows
    .filter(p=>p.kind==='station'&&validPoint(p)&&(activeBrand==='all'||p.supplier===activeBrand))
    .map(p=>({p,km:distanceKm(lat,lng,p.lat,p.lng)}))
    .sort((a,b)=>a.km-b.km)
    .slice(0,n);
}
// เส้นประจากจุดค้นหา/ตำแหน่งของฉัน ไปยัง 5 จุดที่ใกล้ที่สุด พร้อมป้ายระยะทางเล็ก ๆ บนเส้น
let nearestPairs = [];   // [{line,label,to:[lat,lng]}] ใช้ขยับต้นเส้น/ป้ายตามจุดสีฟ้าทุกเฟรม
// ตำแหน่งป้าย (ยึดสเกลหน้าจอ): ตำแหน่งที่ลองตามลำดับ — slot 0 คือที่ปกติ ถ้าทับป้ายอื่นค่อยลอง slot ถัดไป
//  - เส้นยาวบนจอ: ห่างจากจุดสีฟ้า 70 → 105 → 140 → 175 px ตามแนวเส้น (ซูมแค่ไหนป้ายก็อยู่ใกล้ตัวเรา)
//  - เส้นสั้นบนจอ (< 140 px): 50% → 75% → 30% → 90% ของความยาวเส้น
const LABEL_PX = 70;
const LABEL_STEPS_PX = [70,105,140,175];
const LABEL_STEPS_FRAC = [0.5,0.75,0.3,0.9];
function labelLatLng(from,to,slot=0){
  const a=map.latLngToContainerPoint(from), b=map.latLngToContainerPoint(to);
  const len=a.distanceTo(b);
  if(len<1) return from;
  let t;
  if(len>LABEL_PX*2){ const px=LABEL_STEPS_PX[slot]; if(px>len*0.9) return null; t=px/len; }
  else t=LABEL_STEPS_FRAC[slot];
  const ll=map.containerPointToLatLng(a.add(b.subtract(a).multiplyBy(t)));
  return [ll.lat,ll.lng];
}
function placeDistLabels(from){
  if(map._animatingZoom) return;
  nearestPairs.forEach(pr=>{ const ll=labelLatLng(from,pr.to,pr.slot||0); if(ll) pr.label.setLatLng(ll); });
}
function drawNearestLines(){
  nearestLines.clearLayers();
  nearestPairs=[];
  if(!searchPoint) return;
  const from=[searchPoint.lat,searchPoint.lng];
  nearestPoints(searchPoint.lat,searchPoint.lng).forEach(({p,km},i)=>{
    const to=[p.lat,p.lng];
    const line=L.polyline([from,to],{
      color:i===0?'#e05260':i===1?'#f2b705':'#4776ff',weight:i<=1?3:2,opacity:i===0?.9:i===1?.95:.55,dashArray:'6 6',interactive:false,
      renderer:nearestLineRenderer,className:'nearline'+(i===0?' first':i===1?' second':'')
    }).addTo(nearestLines);
    const label=L.marker(labelLatLng(from,to,0)||from,{
      icon:L.divIcon({className:'distlabel-wrap',html:`<span class="distlabel${i===0?' first':i===1?' second':''}">${formatDist(km)}</span>`,iconSize:null}),
      interactive:false,keyboard:false,zIndexOffset:i===0?900:i===1?850:800
    }).addTo(nearestLines);
    nearestPairs.push({line,label,to});
  });
  // วาดเส้นอันดับ 2 (เหลือง) และอันดับ 1 (แดง) ทับเส้นสีน้ำเงิน
  nearestPairs[1]?.line.bringToFront(); nearestPairs[0]?.line.bringToFront();
  layoutDistLabels();
  updateNearBar();
}
// ป้ายซ้อนกัน → เลื่อนป้ายของจุดที่ไกลกว่าไปตำแหน่งถัดไปบนเส้นของมันก่อน (ดู slot ด้านบน)
// ถ้าลองครบแล้วยังทับ ค่อยซ่อน (ป้ายแดงอันดับ 1 แสดงเสมอ ที่ตำแหน่งปกติ)
function layoutDistLabels(){
  if(map._animatingZoom||!nearestPairs.length) return;
  const fl=nearestPairs[0].line.getLatLngs()[0], from=[fl.lat,fl.lng];
  const shown=[];
  const overlaps=r=>shown.some(s=>!(r.right+2<s.left||s.right+2<r.left||r.bottom+2<s.top||s.bottom+2<r.top));
  nearestPairs.forEach((pr,i)=>{
    const el=pr.label.getElement()?.querySelector('.distlabel');
    if(!el) return;
    el.style.visibility='';
    // คำนวณกรอบป้ายจากพิกัดบนจอของแผนที่ + ขนาดป้าย (ไม่อ่านตำแหน่งจากหน้าเว็บ ซึ่งอาจยังไม่อัปเดตหลังซูม)
    const w=el.offsetWidth||44, h=el.offsetHeight||18;
    let placed=false;
    for(let slot=0; slot<(i===0?1:LABEL_STEPS_PX.length); slot++){
      const ll=labelLatLng(from,pr.to,slot); if(!ll) continue;
      const c=map.latLngToContainerPoint(ll);
      const r={left:c.x-w/2,right:c.x+w/2,top:c.y-h/2,bottom:c.y+h/2};
      if(i===0||!overlaps(r)){ pr.label.setLatLng(ll); pr.slot=slot; shown.push(r); placed=true; break; }
    }
    if(!placed){ el.style.visibility='hidden'; pr.slot=0; }
  });
}
// ซูม/เลื่อนแผนที่เสร็จ → รอสักครู่ให้แอนิเมชันซูมของแผนที่เข้าที่จริง (วัดทันทีจะได้ตำแหน่งป้ายเก่า)
// แล้ววางป้ายใหม่และจัดป้ายที่ซ้อนกัน
let labelRelayoutTimer=null;
function scheduleLabelRelayout(){
  if(!nearestPairs.length) return;
  clearTimeout(labelRelayoutTimer);
  labelRelayoutTimer=setTimeout(()=>{
    labelRelayoutTimer=null;
    if(!nearestPairs.length||map._animatingZoom) return;
    const ll=nearestPairs[0].line.getLatLngs()[0];
    placeDistLabels([ll.lat,ll.lng]);
    layoutDistLabels();
  },150);
}
map.on('zoomend moveend resize',scheduleLabelRelayout);

function parseLatLng(text){
  const m = String(text).trim().match(/^(-?\d+(?:[.,]\d+)?)\s*[,\s;/]\s*(-?\d+(?:[.,]\d+)?)$/);
  if(!m) return null;
  const lat = Number(m[1].replace(',','.')), lng = Number(m[2].replace(',','.'));
  if(!Number.isFinite(lat)||!Number.isFinite(lng)) return null;
  if(lat<-90||lat>90||lng<-180||lng>180) return null;
  return {lat,lng};
}

let accuracyCircle = null;
function clearSearchMarker(){
  if(searchMarker){ map.removeLayer(searchMarker); searchMarker=null; }
  if(accuracyCircle){ map.removeLayer(accuracyCircle); accuracyCircle=null; }
  document.querySelector('.locatebtn')?.classList.remove('on');
  stopFollow();
  searchPoint=null; gpsActive=false;
  nearestLines.clearLayers();
  updateNearBar();
}

// ===== แถบลอยบนแผนที่: Geofence ที่ใกล้ที่สุด (แสดงเมื่อใช้ปุ่มตำแหน่งของฉัน) =====
let gpsActive = false;
function formatDist(km){
  return km<1 ? `${Math.round(km*1000).toLocaleString('th-TH')} ม.` : `${formatKm(km)} กม.`;
}
function updateNearBar(){
  const bar=$('nearBar');
  if(!bar) return;
  const near=gpsActive&&searchPoint ? nearestPoints(searchPoint.lat,searchPoint.lng,1)[0] : null;
  if(!near){ bar.hidden=true; return; }
  bar.hidden=false;
  bar.dataset.id=near.p.id;
  bar.classList.toggle('following',followWatchId!==null);
  const st=showPumpExtra()?nearestStations(searchPoint.lat,searchPoint.lng,1)[0]:null;
  const isPump=nearestKind()==='station';
  const stColor=st?supplierColor(st.p.supplier):'';
  bar.innerHTML=`<span class="nb-row" data-go="${near.p.id}"><span class="nb-dot"></span><span class="nb-label">${isPump?'⛽ ปั๊มใกล้สุด':'ใกล้สุด'}</span><span class="nb-name">${isPump?esc(near.p.station.brand)+' · ':''}${esc(near.p.name)}</span><span class="nb-dist">${formatDist(near.km)}</span></span>`+
    (st?`<span class="nb-row nb-st" data-go="${st.p.id}"><span class="nb-fuel" style="background:${stColor};color:${fuelInk(stColor)}">⛽</span><span class="nb-label">ปั๊มใกล้สุด</span><span class="nb-name">${esc(st.p.station.brand)} · ${esc(st.p.name)}</span><span class="nb-dist">${formatDist(st.km)}</span></span>`:'');
}

// opts.accuracy (เมตร) = มาจากปุ่มตำแหน่งของฉัน → แสดงเป็นจุดสีฟ้า + วงความแม่นยำ
function showSearchMarker(lat,lng,opts={}){
  clearSearchMarker();
  const isGps=opts.accuracy!==undefined;
  const icon = L.divIcon({
    className:'',
    html:isGps
      ?'<div class="mypos"><span class="mypos-arrow"></span></div>'
      :'<div style="width:22px;height:22px;border-radius:50%;background:#e05260;border:3px solid #fff;box-shadow:0 0 0 4px #e0526055,0 3px 10px #0006"></div>',
    iconSize:[22,22], iconAnchor:[11,11]
  });
  searchPoint={lat,lng}; gpsActive=isGps;
  const near=nearestPoints(lat,lng);
  const st=showPumpExtra()?nearestStations(lat,lng,1)[0]:null;
  const nearText=(near.length?`<br><br>ใกล้ที่สุด: <b>${esc(near[0].p.name)}</b><br>ระยะ ${formatKm(near[0].km)} กม.`:'')+
    (st?`<br><br>⛽ ปั๊มใกล้สุด: <b>${esc(st.p.station.brand)} · ${esc(st.p.name)}</b><br>ระยะ ${formatKm(st.km)} กม.`:'');
  if(isGps) accuracyCircle=L.circle([lat,lng],{radius:opts.accuracy,color:'#1a73e8',weight:1,opacity:.5,fillColor:'#1a73e8',fillOpacity:.12,interactive:false}).addTo(map);
  searchMarker = L.marker([lat,lng],{icon,zIndexOffset:1000}).addTo(map);
  const title=isGps?'ตำแหน่งของฉัน':'พิกัดที่ค้นหา';
  const accText=isGps?`<br>ความแม่นยำ: ±${Math.round(opts.accuracy).toLocaleString('th-TH')} ม.`:'';
  searchMarker.bindPopup(`<div class="popup-title">${title}</div><div class="popup-coord">Latitude: ${lat}<br>Longitude: ${lng}${accText}${nearText}</div>${popupActions(lat,lng)}`);
  drawNearestLines();
  // ซูมให้เห็นทั้งหมุดที่ค้นหาและจุดที่ใกล้ที่สุดในจอเดียว
  if(near.length) map.flyToBounds(L.latLngBounds([[lat,lng],...near.map(n=>[n.p.lat,n.p.lng])]),{padding:[70,70],maxZoom:16,duration:.8});
  else map.flyTo([lat,lng],Math.max(map.getZoom(),16),{duration:.8});
  // ตำแหน่งของฉัน: ไม่เปิดป๊อปอัปเอง เพราะแถบลอยด้านบนแสดงข้อมูลเดียวกันอยู่แล้ว (กดจุดสีฟ้าเพื่อเปิดได้)
  if(!isGps) setTimeout(()=>searchMarker&&searchMarker.openPopup(),850);
  // เปิดรายการด้านข้างเพื่อให้เห็นผล 5 อันดับ
  // ยกเว้นปุ่มตำแหน่งของฉันบนมือถือ: รายการจะบังแผนที่และการแตะครั้งถัดไปจะแค่ปิดรายการ (แถบใกล้สุดแสดงข้อมูลให้แล้ว)
  const sidebar=$('sidebar');
  const skipOpen=isGps&&window.innerWidth<=850;
  if(!skipOpen&&sidebar&&sidebar.classList.contains('collapsed')){ sidebar.classList.remove('collapsed'); setTimeout(()=>map.invalidateSize(),280); }
  renderList();
}

// ===== ปุ่มในป๊อปอัป: คัดลอกพิกัด / นำทางด้วย Google Maps =====
function popupActions(lat,lng){
  const nav=`https://www.google.com/maps/dir/?api=1&destination=${lat},${lng}`;
  return `<div class="popactions">
    <button type="button" class="popbtn" data-copy="${lat}, ${lng}">⧉ คัดลอกพิกัด</button>
    <a class="popbtn primary" href="${nav}" target="_blank" rel="noopener">➤ นำทาง</a>
  </div>`;
}
async function copyText(text){
  try{ await navigator.clipboard.writeText(text); return true; }
  catch{
    // สำรองสำหรับเบราว์เซอร์ที่ไม่อนุญาต clipboard API
    const ta=document.createElement('textarea');
    ta.value=text; ta.style.position='fixed'; ta.style.opacity='0';
    document.body.appendChild(ta); ta.select();
    let ok=false; try{ ok=document.execCommand('copy'); }catch{}
    ta.remove(); return ok;
  }
}
document.addEventListener('click',async e=>{
  const btn=e.target.closest('.popbtn[data-copy]');
  if(!btn) return;
  e.preventDefault(); e.stopPropagation();
  const ok=await copyText(btn.dataset.copy);
  toast(ok?`คัดลอกพิกัดแล้ว: ${btn.dataset.copy}`:'คัดลอกไม่สำเร็จ ลองกดค้างที่พิกัดเพื่อคัดลอกเอง',2500);
  if(ok){ const old=btn.textContent; btn.textContent='✓ คัดลอกแล้ว'; setTimeout(()=>btn.textContent=old,1500); }
});

function toast(message, duration=3500){
  const el=$('toast');
  if(!el) return;
  el.textContent=message;
  el.classList.add('show');
  clearTimeout(toast.timer);
  toast.timer=setTimeout(()=>el.classList.remove('show'),duration);
}

function normalizeKey(k){return String(k??'').trim().toLowerCase().replace(/[\s_-]/g,'')}
function findValue(row, aliases){
  if(!row || typeof row!=='object') return '';
  const keys=Object.keys(row);
  for(const alias of aliases){const key=keys.find(k=>normalizeKey(k)===normalizeKey(alias));if(key!==undefined)return row[key]}
  return '';
}
function asNumber(v){
  if(typeof v==='number') return Number.isFinite(v)?v:null;
  if(v===null||v===undefined||String(v).trim()==='') return null;
  const n=Number(String(v).trim().replace(',','.'));
  return Number.isFinite(n)?n:null;
}
// จุดที่อยู่ในประเทศไทย (ใช้ตอนซูมแผนที่ ไม่ให้จุดทดสอบในต่างประเทศดึงให้ซูมออกไปไกล)
const inThailand = p => p.lat>=5 && p.lat<=21 && p.lng>=97 && p.lng<=106;
function normalizeRows(payload){
  let rows=payload;
  if(payload && !Array.isArray(payload)){
    rows=payload.data??payload.rows??payload.values??payload.result??payload.records??payload.items??payload.geofences??payload.locations;
    if(!rows && payload.success===false) throw new Error(payload.message||'API แจ้งว่าไม่สำเร็จ');
  }
  if(!Array.isArray(rows)) throw new Error('รูปแบบข้อมูล API ไม่ใช่รายการแถว กรุณาตรวจสอบผลลัพธ์จาก Google Apps Script');
  if(rows.length && Array.isArray(rows[0])){
    const headers=rows[0].map(v=>String(v).trim());
    rows=rows.slice(1).map(r=>Object.fromEntries(headers.map((h,i)=>[h,r[i]])));
  }
  return rows.map((r,i)=>{
    if(Array.isArray(r)) return {id:i,name:String(r[0]??`จุดที่ ${i+1}`),lat:asNumber(r[1]),lng:asNumber(r[2]),supplier:String(r[3]??'').trim()||NO_SUPPLIER,kind:'geo',raw:r};
    const name=findValue(r,['Geofence']) || `จุดที่ ${i+1}`;
    const lat=asNumber(findValue(r,['Latitude','Lat']));
    const lng=asNumber(findValue(r,['Longitude','Long','Lng','Lon']));
    const supplier=String(findValue(r,['Supplier','ซัพพลายเออร์','ผู้จัดหา'])??'').trim()||NO_SUPPLIER;
    return {id:i,name:String(name).trim(),lat,lng,supplier,kind:'geo',raw:r};
  });
}
// ===== ปั๊มน้ำมันทุกแบรนด์ (API ชุดที่ 2) =====
// Apps Script ส่งทุกแท็บมาในรายการเดียว แต่ละแถวมี _sheet = ชื่อแท็บ = แบรนด์ (ข้อมูลเก่าไม่มี _sheet ถือเป็น PTT)
// แต่ละแบรนด์ใช้ชื่อคอลัมน์ต่างกันได้ — ด้านล่างรวบไว้ให้อ่านได้ทุกแบบ
function stationSupplier(sheet){ return `${sheet||'PTT'} Station`; }
// รหัสสิ่งอำนวยความสะดวกภาษาอังกฤษ (Shell) → ภาษาไทย; '' = ไม่ต้องแสดง
const AMENITY_TH = {
  air_and_water:'เติมลม/น้ำ', twenty_four_hour:'เปิด 24 ชม.', full_service:'มีพนักงานเติมน้ำมัน',
  standard_toilet:'ห้องน้ำ', disabled_facilities:'ห้องน้ำผู้พิการ', carwash:'ล้างรถ', service_bay:'ช่องบริการรถ',
  quick_lubes:'เปลี่ยนน้ำมันเครื่อง', high_speed_diesel_pump:'หัวจ่ายดีเซลความเร็วสูง', motorway_service:'จุดพักทางหลวง',
  selectshop:'Shell Select', stop_and_shop:'ร้านสะดวกซื้อ', clubsmart_shop:'ร้านค้า ClubSmart', city_market:'ร้านค้า',
  food_offerings:'อาหาร', fast_food:'อาหาร', snack_food:'อาหาร', deli_cafe:'คาเฟ่', cafe:'คาเฟ่',
  atm:'ATM', atm_in:'ATM', atm_out:'ATM',
  clubsmart_card:'บัตร ClubSmart', go_plus:'Shell GO+', loyalty_cards:'บัตรสะสมแต้ม', partner_loyalty_accepted:'บัตรสะสมแต้มพันธมิตร',
  fuel_card:'บัตรน้ำมัน', shell_card:'Shell Card', fleet_card_general:'บัตร Fleet',
  credit_card:'บัตรเครดิต', credit_card_general:'บัตรเครดิต', credit_card_visa:'Visa', credit_card_mastercard:'Mastercard', credit_card_american_express:'Amex',
  manned:'', manual:'', loyalty_program:'', other_loyalty_cards:'', parking_lanes:'', type_of_parking:''
};
function amenityList(v){
  const seen=new Set();
  return String(v||'').split(/\s*,\s*/).filter(Boolean).map(a=>{
    const k=a.trim();
    return /^[a-z0-9_]+$/.test(k) ? (k in AMENITY_TH ? AMENITY_TH[k] : k.replace(/_/g,' ')) : k;
  }).filter(a=>a&&!seen.has(a)&&seen.add(a));
}
function normalizeStationRows(payload,startId){
  const rows=Array.isArray(payload)?payload:(payload?.data??payload?.rows??[]);
  if(!Array.isArray(rows)) throw new Error('รูปแบบข้อมูลปั๊มน้ำมันไม่ถูกต้อง');
  const txt=v=>String(v??'').trim();
  return rows.map((r,i)=>{
    const sheet=txt(r._sheet)||'PTT';
    const cat=txt(findValue(r,['category','site_category']));
    const d={
      brand:sheet,
      type:txt(findValue(r,['type'])),
      ev:/ev/i.test(cat),
      region:txt(findValue(r,['region'])),
      province:txt(findValue(r,['province_name','province'])),
      district:txt(findValue(r,['district','city'])),
      address:[txt(findValue(r,['address'])),txt(findValue(r,['postcode']))].filter(Boolean).join(' '),
      phone:txt(findValue(r,['phone'])),
      hours:txt(findValue(r,['hours'])),
      products:txt(findValue(r,['products','fuels'])),
      services:amenityList(findValue(r,['services','amenities'])),
      cards:txt(findValue(r,['card_type'])),
      link:txt(findValue(r,['link']))
    };
    return {
      id:startId+i, name:txt(findValue(r,['name']))||`ปั๊ม ${sheet} ${i+1}`,
      lat:asNumber(findValue(r,['lat','Latitude'])), lng:asNumber(findValue(r,['lng','Longitude'])),
      supplier:stationSupplier(sheet), station:d, kind:'station',
      searchText:`${d.region} ${d.province} ${d.district} ${d.address}`, raw:r
    };
  });
}
function stationDetailsHtml(d){
  const line=(label,val)=>val?`<div class="ptt-line"><b>${label}</b> ${esc(val)}</div>`:'';
  const chips=list=>list.length?`<div class="ptt-chips">${list.map(x=>`<span>${esc(x)}</span>`).join('')}</div>`:'';
  const split=v=>String(v||'').split(/\s*,\s*/).filter(Boolean);
  const tel=d.phone?`<div class="ptt-line"><b>โทร</b> ${d.phone.split(/\s*[,/]\s*/).filter(Boolean).map(n=>`<a href="tel:${esc(n.replace(/[^\d+]/g,''))}">${esc(n)}</a>`).join(', ')}</div>`:'';
  const bc=supplierColor(stationSupplier(d.brand));
  const where=[d.district,d.province,d.region].filter(Boolean).join(' · ');
  let host=''; try{ host=/^https?:\/\//.test(d.link)?new URL(d.link).hostname.replace(/^www\./,''):''; }catch{}
  return `<div class="ptt-detail">
    <span class="ptt-type" style="background:${bc};color:${bc==='#f7c600'?'#3d2e00':'#fff'}">${esc(d.brand)}</span>${d.type?`<span class="ptt-prov">${esc(d.type)}</span>`:''}${d.ev?'<span class="ptt-prov">⚡ ที่ชาร์จ EV</span>':''}
    ${line('พื้นที่',where)}${line('ที่อยู่',d.address)}${tel}${line('เวลาเปิด',d.hours)}
    ${d.products?`<div class="ptt-sec">น้ำมัน / ผลิตภัณฑ์</div>${chips(split(d.products))}`:''}
    ${d.services.length?`<div class="ptt-sec">บริการในสถานี</div>${chips(d.services)}`:''}
    ${line('บัตรที่รับ',d.cards)}
    ${host?`<a class="ptt-link" href="${esc(d.link)}" target="_blank" rel="noopener">ดูหน้าสถานีบน ${esc(host)} ↗</a>`:''}
  </div>`;
}
function validPoint(p){return p.lat!==null&&p.lng!==null&&p.lat>=-90&&p.lat<=90&&p.lng>=-180&&p.lng<=180}
function esc(s){
  const ent={'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'};
  return String(s).replace(/[&<>"']/g,c=>ent[c]);
}
// ===== สีหมุดแยกตาม Supplier =====
// กำหนดสีให้ Supplier ที่รู้จัก ถ้ามี Supplier ใหม่ในชีต จะได้สีจากชุดสำรองอัตโนมัติ
const SUPPLIER_COLORS = {
  'DTC':'#4776ff',
  'SONGDEE':'#f59f00',
  'SCA DTC':'#0ca678',
  'Smart Logistics':'#8b5cf6',
  'LEO System':'#e64980',
  'PMS':'#495057',
  'PTT Station':'#00a3e0',
  'PT Station':'#66a80f',
  'Shell Station':'#f7c600',
  'Caltex Station':'#b02a37'
};
const EXTRA_COLORS = ['#1098ad','#d9480f','#5c940d','#9c36b5','#364fc7','#c92a2a'];
const NO_SUPPLIER_COLOR = '#adb5bd';
const supplierColorCache = new Map();
function supplierColor(name){
  if(name===NO_SUPPLIER) return NO_SUPPLIER_COLOR;
  if(SUPPLIER_COLORS[name]) return SUPPLIER_COLORS[name];
  if(!supplierColorCache.has(name)) supplierColorCache.set(name,EXTRA_COLORS[supplierColorCache.size%EXTRA_COLORS.length]);
  return supplierColorCache.get(name);
}
const pinIconCache = new Map();
function pinIcon(color){
  if(!pinIconCache.has(color)) pinIconCache.set(color,L.divIcon({
    className:'suppin',
    html:`<svg viewBox="0 0 32 44" width="25" height="34"><path d="M16 1C7.7 1 1 7.6 1 15.9 1 27 16 43 16 43s15-16 15-27.1C31 7.6 24.3 1 16 1z" fill="${color}" stroke="#fff" stroke-width="2.5"/><circle cx="16" cy="16" r="5.5" fill="#fff"/></svg>`,
    iconSize:[25,34], iconAnchor:[12.5,33], popupAnchor:[0,-30]
  }));
  return pinIconCache.get(color);
}
// หมุดปั๊มน้ำมัน: วงกลมสีแบรนด์ + ไอคอนหัวจ่าย (ต่างจากหมุดหยดน้ำของ Geofence ชัดเจน)
const fuelInk = color => color==='#f7c600' ? '#3d2e00' : '#fff';
const FUEL_SVG = '<svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor"><path d="M5 3h8a1 1 0 0 1 1 1v7h1.5a2 2 0 0 1 2 2v4.5a1 1 0 0 0 2 0V9.2L17.3 7l1.4-1.4 2.6 2.6c.2.2.3.4.3.7v8.6a3 3 0 0 1-6 0V13H14v8H4V4a1 1 0 0 1 1-1zm1 2v5h6V5H6z"/></svg>';
const stationIconCache = new Map();
function stationIcon(color){
  if(!stationIconCache.has(color)) stationIconCache.set(color,L.divIcon({
    className:'stpin',
    html:`<div style="background:${color};color:${fuelInk(color)}">${FUEL_SVG}</div>`,
    iconSize:[24,24], iconAnchor:[12,12], popupAnchor:[0,-12]
  }));
  return stationIconCache.get(color);
}
// คำอธิบายสัญลักษณ์: แถว Geofence (Supplier) กับแถวปั๊มน้ำมัน (แบรนด์) แยกกัน แสดงเฉพาะชั้นที่เปิดอยู่
function renderLegend(){
  const box=$('supplierLegend');
  if(!box) return;
  const row=(kind,active,attr,head)=>{
    const counts=new Map();
    allRows.forEach(p=>{ if(p.kind===kind&&validPoint(p)) counts.set(p.supplier,(counts.get(p.supplier)||0)+1); });
    if(!counts.size) return '';
    const names=[...counts.keys()].sort((a,b)=>counts.get(b)-counts.get(a));
    const label=n=>kind==='station'?n.replace(/ Station$/,''):n;
    const dot=n=>`<span class="legend-dot${kind==='station'?' fuel':' drop'}" style="background:${supplierColor(n)}"></span>`;
    return `<div class="legrow"><span class="leghead">${head}</span>`+names.map(n=>`<button type="button" class="legend-item sup${active===n?' on':''}${active!=='all'&&active!==n?' dim':''}" ${attr}="${esc(n)}" title="กดเพื่อกรองเฉพาะ ${esc(label(n))}">${dot(n)}${esc(label(n))}</button>`).join('')+'</div>';
  };
  box.innerHTML=(showGeo?row('geo',activeSupplier,'data-sup','Geofence'):'')+(showStations?row('station',activeBrand,'data-brand','⛽ ปั๊มน้ำมัน'):'');
  box.closest('.legend')?.toggleAttribute('hidden',!box.innerHTML);
}
// กดชื่อในคำอธิบายสัญลักษณ์ → กรองเฉพาะ Supplier/แบรนด์นั้น (กดซ้ำ = แสดงทั้งหมด)
$('supplierLegend')?.addEventListener('click',e=>{
  const sup=e.target.closest('[data-sup]'), brand=e.target.closest('[data-brand]');
  const sel=sup?$('supplierSelect'):brand?$('brandSelect'):null;
  if(!sel) return;
  const v=sup?sup.dataset.sup:brand.dataset.brand, cur=sup?activeSupplier:activeBrand;
  sel.value = cur===v ? 'all' : v;
  sel.dispatchEvent(new Event('change'));
});

function buildMarker(p,group){
  const color=supplierColor(p.supplier);
  const marker=L.marker([p.lat,p.lng],{title:p.name,icon:p.kind==='station'?stationIcon(color):pinIcon(color)});
  marker.__grp=group;
  marker.supplierIcon=marker.options.icon;
  marker.bindPopup(p.station
    ? `<div class="popup-title">${esc(p.name)}</div>${stationDetailsHtml(p.station)}<div class="popup-coord">Latitude: ${p.lat}<br>Longitude: ${p.lng}</div>${popupActions(p.lat,p.lng)}`
    : `<div class="popup-title">${esc(p.name)}</div><div class="popup-coord">Supplier: ${esc(p.supplier)}<br>Latitude: ${p.lat}<br>Longitude: ${p.lng}</div>${popupActions(p.lat,p.lng)}`,
    p.station?{maxWidth:300,minWidth:240}:undefined);
  marker.on('click',()=>{ selectPoint(p.id); scrollRowIntoView(p.id); });
  markerById.set(p.id,marker);
  return marker;
}

// ===== หมุดที่ถูกเลือก: เปลี่ยนเป็นหมุดสีแดงใหญ่ มีวงกระเพื่อม ให้รู้ว่า "คือหมุดนี้" =====
const selectedIcon = L.divIcon({
  className:'selpin',
  html:'<span class="selpin-pulse"></span><svg viewBox="0 0 32 44" width="34" height="46"><path d="M16 1C7.7 1 1 7.6 1 15.9 1 27 16 43 16 43s15-16 15-27.1C31 7.6 24.3 1 16 1z" fill="#e05260" stroke="#fff" stroke-width="2"/><circle cx="16" cy="16" r="6" fill="#fff"/></svg>',
  iconSize:[34,46], iconAnchor:[17,45], popupAnchor:[0,-40]
});
let selectedMarker = null;
function selectPoint(id){
  if(selectedMarker){ selectedMarker.setIcon(selectedMarker.supplierIcon); selectedMarker.setZIndexOffset(0); selectedMarker=null; }
  selectedId=id;
  const m=id===null?null:markerById.get(id);
  if(m){ m.setIcon(selectedIcon); m.setZIndexOffset(1000); selectedMarker=m; }
  markSelectedRow();
}
// พาไปที่หมุด ถ้าหมุดซ่อนอยู่ในกลุ่ม (ตัวเลข) จะซูม/กางกลุ่มออกจนเห็นหมุดนั้นแล้วค่อยเปิดป๊อปอัป
function revealMarker(id){
  const m=markerById.get(id);
  if(!m) return;
  unlockFollow(); // กำลังติดตามอยู่ → หยุดล็อกกลางจอ ไม่งั้นแผนที่จะถูกดึงกลับมาหาตัวเรา
  const ll=m.getLatLng();
  const hidden=()=>{ const vp=(m.__grp||clusters).getVisibleParent(m); return vp&&vp!==m ? vp : null; };
  // ขั้นสุดท้าย: ถ้ายังอยู่ในกลุ่ม (หมุดซ้อนที่เดียวกัน) ให้กางกลุ่มออกแล้วเปิดป๊อปอัป
  const finish=()=>{
    const c=hidden();
    if(c&&c.spiderfy){ c.spiderfy(); setTimeout(()=>m.openPopup(),350); }
    else m.openPopup();
  };
  // ถ้าซูม 17 แล้วยังอยู่ในกลุ่ม ซูมเข้าสุดอีกขั้น
  const afterFly=()=>{
    if(hidden()&&map.getZoom()<map.getMaxZoom()){ map.once('moveend',finish); map.setView(ll,map.getMaxZoom()); }
    else finish();
  };
  const z=Math.max(map.getZoom(),17);
  if(map.getZoom()===z&&map.getCenter().distanceTo(ll)<1) afterFly();
  else { map.once('moveend',afterFly); map.flyTo(ll,z,{duration:.7}); }
}
function scrollRowIntoView(id){
  // แถวยังไม่ถูกโหลด (อยู่เกิน 200 แถวแรก) → โหลดเพิ่มจนถึงแถวนั้นก่อน
  const idx=filteredRows.findIndex(p=>p.id===id);
  while(idx>=listShown&&listShown<filteredRows.length) appendMoreRows();
  const row=document.querySelector(`.pointrow[data-id="${id}"]`);
  if(row) row.scrollIntoView({block:'nearest',behavior:'smooth'});
}
// แถวที่อยู่ในชั้น/ตัวกรองปัจจุบัน
const geoRows = () => allRows.filter(p=>p.kind==='geo'&&(activeSupplier==='all'||p.supplier===activeSupplier));
const stationRows = () => allRows.filter(p=>p.kind==='station'&&(activeBrand==='all'||p.supplier===activeBrand));
// วาดหมุดใหม่เฉพาะชั้นที่เปลี่ยน (อีกชั้นไม่ต้องวาดใหม่ เปิด/ปิดชั้นจึงเร็ว)
function renderLayer(group,rows,on){
  group.clearLayers();
  markerById.forEach((m,id)=>{ if(m.__grp===group) markerById.delete(id); });
  if(on){ group.addLayers(rows.filter(validPoint).map(p=>buildMarker(p,group))); if(!map.hasLayer(group)) map.addLayer(group); }
  else if(map.hasLayer(group)) map.removeLayer(group);
}
const renderGeoLayer = () => renderLayer(clusters,geoRows(),showGeo);
const renderStationLayer = () => renderLayer(stationClusters,stationRows(),showStations);
function afterLayerChange(){
  selectedMarker=null; selectPoint(selectedId);
  renderLegend(); renderLayerCards();
  drawNearestLines(); updateNearBar();
}
function renderLayerCards(){
  const set=(cardId,valId,on,n)=>{
    const card=$(cardId); if(!card) return;
    card.classList.toggle('on',on); card.setAttribute('aria-pressed',on);
    $(valId).innerHTML=on?n.toLocaleString('th-TH'):'<small>ปิดอยู่</small>';
  };
  set('layerGeo','statGeo',showGeo,geoRows().length);
  set('layerStations','statStations',showStations,stationRows().length);
  if($('supplierSelect')) $('supplierSelect').hidden=!showGeo;
  if($('brandSelect')) $('brandSelect').hidden=!showStations;
  const t=$('sideTitleText');
  if(t) t.textContent=showGeo&&showStations?'รายการ Geofence + ปั๊ม':showStations?'รายการปั๊มน้ำมัน':'รายการ Geofence';
}
function fitToVisible(){
  const all=(showGeo?geoRows():showStations?stationRows():[]).filter(validPoint);
  // ซูมเฉพาะจุดในประเทศไทย (จุดทดสอบในต่างประเทศไม่ดึงแผนที่ให้ซูมออกไปไกล) — ถ้าไม่มีจุดในไทยเลยค่อยใช้ทั้งหมด
  const th=all.filter(inThailand), pts=th.length?th:all;
  if(pts.length===1) map.setView([pts[0].lat,pts[0].lng],13);
  else if(pts.length>1) map.fitBounds(L.latLngBounds(pts.map(p=>[p.lat,p.lng])),{padding:[45,45],maxZoom:12});
}
function renderMap(opts={}){
  renderGeoLayer(); renderStationLayer();
  afterLayerChange();
  if(opts.fit!==false) fitToVisible();
}
function buildBrandOptions(){
  const counts=new Map(); let total=0;
  allRows.forEach(p=>{ if(p.kind==='station'){ counts.set(p.supplier,(counts.get(p.supplier)||0)+1); total++; } });
  if(activeBrand!=='all'&&!counts.has(activeBrand)) activeBrand='all';
  const sel=$('brandSelect');
  if(!sel) return;
  const names=[...counts.keys()].sort((a,b)=>counts.get(b)-counts.get(a));
  sel.innerHTML=`<option value="all">⛽ ปั๊ม: ทุกแบรนด์ (${total.toLocaleString('th-TH')})</option>`+
    names.map(n=>`<option value="${esc(n)}">⛽ ${esc(n.replace(/ Station$/,''))} (${counts.get(n).toLocaleString('th-TH')})</option>`).join('');
  sel.value=activeBrand;
  sel.classList.toggle('on',activeBrand!=='all');
}
function buildSupplierOptions(){
  buildBrandOptions();
  const counts=new Map();
  allRows.forEach(p=>{ if(p.kind==='geo') counts.set(p.supplier,(counts.get(p.supplier)||0)+1); });
  const names=[...counts.keys()].sort((a,b)=>{
    if(a===NO_SUPPLIER) return 1; if(b===NO_SUPPLIER) return -1;
    return a.localeCompare(b,'th');
  });
  if(activeSupplier!=='all'&&!counts.has(activeSupplier)) activeSupplier='all';
  const sel=$('supplierSelect');
  if(!sel) return;
  const geoTotal=[...counts.values()].reduce((a,b)=>a+b,0);
  sel.innerHTML=`<option value="all">Supplier: ทั้งหมด (${geoTotal.toLocaleString('th-TH')})</option>`+
    names.map(n=>`<option value="${esc(n)}">${esc(n)} (${counts.get(n).toLocaleString('th-TH')})</option>`).join('');
  sel.value=activeSupplier;
  sel.classList.toggle('on',activeSupplier!=='all');
}
// ===== รายการด้านซ้าย: วาดทีละ 200 แถว (วาดหมื่นแถวทีเดียวทำให้หน้าค้างหลายวินาที) =====
const LIST_PAGE = 200;
let listShown = 0;
function rowHtml(p){
  const valid=validPoint(p), selected=selectedId===p.id;
  return `<div class="pointrow ${selected?'selected':''}" data-id="${p.id}">
      <div class="pin${p.kind==='station'?' fuel':''}"${valid?` style="color:${supplierColor(p.supplier)};background:${supplierColor(p.supplier)}1f"`:''}>${!valid?'!':p.kind==='station'?FUEL_SVG:'⌖'}</div>
      <div class="pointinfo"><div class="pointname">${esc(p.name)}${p.dup&&activeFilter==='dup'?` <span class="dupbadge">${p.dup}</span>`:''}</div><div class="pointcoord">${valid?`${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`:'ไม่พบ Latitude / Longitude'}${p.supplier!==NO_SUPPLIER?` · <span class="pointsup" style="color:${supplierColor(p.supplier)}">${esc(p.supplier)}</span>`:''}</div></div>
      <div class="pointarrow">${valid?'›':'·'}</div>
    </div>`;
}
function moreHtml(){
  if(listShown>=filteredRows.length) return '';
  return `<button type="button" class="listmore">แสดง ${listShown.toLocaleString('th-TH')} จาก ${filteredRows.length.toLocaleString('th-TH')} · เลื่อนลงหรือกดเพื่อดูเพิ่ม</button>`;
}
function appendMoreRows(){
  const pointList=$('pointList');
  if(!pointList||listShown>=filteredRows.length) return;
  pointList.querySelector('.listmore')?.remove();
  const next=filteredRows.slice(listShown,listShown+LIST_PAGE);
  listShown+=next.length;
  pointList.insertAdjacentHTML('beforeend',next.map(rowHtml).join('')+moreHtml());
}
// อัปเดตไฮไลต์แถวที่เลือกโดยไม่วาดรายการใหม่ทั้งหมด (ตำแหน่งเลื่อนของรายการไม่กระโดด)
function markSelectedRow(){
  const pointList=$('pointList');
  if(!pointList) return;
  pointList.querySelectorAll('.pointrow.selected').forEach(r=>r.classList.remove('selected'));
  if(selectedId!==null) pointList.querySelector(`.pointrow[data-id="${selectedId}"]`)?.classList.add('selected');
}
// รอให้หยุดพิมพ์ 0.25 วินาทีก่อนค้นหา
let searchTimer = null;
// แสดงปุ่ม ✕ เฉพาะตอนมีข้อความในช่องค้นหา
function syncSearchClear(){ const b=$('searchClear'), i=$('searchInput'); if(b&&i) b.hidden=!i.value; }
const isMobileWidth=()=>window.innerWidth<=850;
function scheduleRenderList(){ clearTimeout(searchTimer); searchTimer=setTimeout(renderList,250); }

function renderList(){
  clearTimeout(searchTimer);
  syncSearchClear();
  const searchInput = $('searchInput');
  const pointList = $('pointList');
  const pointCount = $('pointCount');
  if(!searchInput || !pointList) return;

  const q=searchInput.value.trim().toLocaleLowerCase();
  const coordQ=parseLatLng(q);
  // ค้นหาด้วยพิกัด (กด Enter แล้ว) → แสดง Geofence ที่ใกล้ที่สุด 5 อันดับ
  if(searchPoint&&coordQ&&coordQ.lat===searchPoint.lat&&coordQ.lng===searchPoint.lng){
    renderNearest(pointList,pointCount);
    return;
  }
  filteredRows=allRows.filter(p=>{
    const matches = !!coordQ || (p.name+' '+p.supplier+(p.searchText?' '+p.searchText:'')).toLocaleLowerCase().includes(q);
    if(p.kind==='station'){ if(!showStations||(activeBrand!=='all'&&p.supplier!==activeBrand)) return false; }
    else if(!showGeo||(activeSupplier!=='all'&&p.supplier!==activeSupplier)) return false;
    const valid=validPoint(p);
    return matches&&(activeFilter==='all'||(activeFilter==='valid'&&valid)||(activeFilter==='invalid'&&!valid)||(activeFilter==='dup'&&!!p.dup));
  });
  // ตัวกรองข้อมูลซ้ำ: เรียงให้แถวที่ซ้ำกันอยู่ติดกัน
  if(activeFilter==='dup') filteredRows.sort((a,b)=>a.dupKey.localeCompare(b.dupKey,'th')||a.id-b.id);
  if(pointCount) pointCount.textContent=`${filteredRows.length.toLocaleString('th-TH')} จุด`;
  if(!filteredRows.length){pointList.innerHTML='<div class="empty">ไม่พบรายการที่ตรงกับการค้นหา</div>';return}
  const hint=coordQ?'<div class="nearhint">กด Enter เพื่อหา Geofence ที่ใกล้พิกัดนี้ที่สุด</div>':'';
  const first=filteredRows.slice(0,LIST_PAGE);
  listShown=first.length;
  pointList.innerHTML=hint+first.map(rowHtml).join('')+moreHtml();
  pointList.scrollTop=0;
}

function renderNearest(pointList,pointCount){
  const near=nearestPoints(searchPoint.lat,searchPoint.lng);
  filteredRows=near.map(n=>n.p);
  listShown=filteredRows.length;
  if(pointCount) pointCount.textContent=`ใกล้สุด ${near.length} จุด`;
  const kind=nearestKind();
  const supNote=kind==='geo'&&activeSupplier!=='all'?`<div class="nearsub">เฉพาะ Supplier: ${esc(activeSupplier)}</div>`
    :kind==='station'&&activeBrand!=='all'?`<div class="nearsub">เฉพาะแบรนด์: ${esc(activeBrand.replace(/ Station$/,''))}</div>`:'';
  const head=`<div class="nearhead"><div class="neartitle">${kind==='station'?'⛽ ปั๊มน้ำมันที่ใกล้ที่สุด':kind==='geo'?'Geofence ที่ใกล้ที่สุด':'จุดที่ใกล้ที่สุด'}</div>
    <div class="nearsub">จาก ${searchPoint.lat}, ${searchPoint.lng} · ระยะเส้นตรง</div>${supNote}</div>`;
  // เปิดชั้นปั๊มน้ำมันอยู่ → แสดงปั๊มที่ใกล้ที่สุด 3 อันดับต่อท้าย (แยกจาก 5 อันดับ Geofence)
  const sts=showPumpExtra()?nearestStations(searchPoint.lat,searchPoint.lng,3):[];
  filteredRows=filteredRows.concat(sts.map(n=>n.p)); listShown=filteredRows.length;
  const brandNote=activeBrand!=='all'?` · ${esc(activeBrand.replace(/ Station$/,''))}`:'';
  const stHtml=sts.length?`<div class="nearhead st"><div class="neartitle">⛽ ปั๊มน้ำมันที่ใกล้ที่สุด</div><div class="nearsub">3 อันดับ${brandNote}</div></div>`+sts.map(({p,km})=>{
    const c=supplierColor(p.supplier);
    return `<div class="pointrow ${selectedId===p.id?'selected':''}" data-id="${p.id}">
      <div class="pin fuel" style="color:${c};background:${c}1f">${FUEL_SVG}</div>
      <div class="pointinfo"><div class="pointname">${esc(p.name)}</div><div class="pointcoord"><span class="pointsup" style="color:${c}">${esc(p.station.brand)}</span>${p.station.province?` · ${esc(p.station.province)}`:''}</div></div>
      <div class="dist"><b>${formatKm(km)}</b><span>กม.</span></div>
    </div>`;
  }).join(''):'';
  if(!near.length){pointList.innerHTML=head+`<div class="empty">${kind?'ไม่มีจุดที่มีพิกัดให้เทียบระยะ':'ปิดทั้ง Geofence และปั๊มน้ำมันอยู่<br>กดการ์ดมุมขวาบนเพื่อเปิดชั้นข้อมูล'}</div>`+stHtml;return}
  pointList.innerHTML=head+near.map(({p,km},i)=>{
    const selected=selectedId===p.id;
    return `<div class="pointrow ${selected?'selected':''} ${i===0?'nearest':i===1?'second':''}" data-id="${p.id}">
      <div class="pin rank">${i+1}</div>
      <div class="pointinfo"><div class="pointname">${esc(p.name)}</div><div class="pointcoord">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}${p.supplier!==NO_SUPPLIER?` · <span class="pointsup" style="color:${supplierColor(p.supplier)}">${esc(p.supplier)}</span>`:''}</div></div>
      <div class="dist"><b>${formatKm(km)}</b><span>กม.</span></div>
    </div>`;
  }).join('')+stHtml;
}

// คลิกในรายการ: ผูก event ครั้งเดียวที่กล่องรายการ (แถวที่โหลดเพิ่มภายหลังก็ใช้ได้)
const pointListEl=$('pointList');
if(pointListEl){
  pointListEl.addEventListener('click',e=>{
    if(e.target.closest('.listmore')){ appendMoreRows(); return; }
    const el=e.target.closest('.pointrow');
    if(!el) return;
    const id=Number(el.dataset.id),p=allRows.find(x=>x.id===id);
    if(!p)return;
    selectPoint(id);
    if(!validPoint(p)){toast('รายการนี้ไม่มีพิกัด Latitude / Longitude ที่ถูกต้อง');return}
    const sidebar = $('sidebar');
    if(sidebar && !sidebar.classList.contains('collapsed')&&window.innerWidth<=850) sidebar.classList.add('collapsed');
    revealMarker(id);
  });
  // เลื่อนใกล้ท้ายรายการ → โหลดเพิ่มอีก 200 แถว
  pointListEl.addEventListener('scroll',()=>{
    if(pointListEl.scrollTop+pointListEl.clientHeight>pointListEl.scrollHeight-400) appendMoreRows();
  },{passive:true});
}

// ===== จำข้อมูลรอบก่อนไว้ในเครื่อง (Cache Storage) =====
// เปิดหน้า → แสดงแผนที่จากข้อมูลที่จำไว้ทันที แล้วดึงข้อมูลใหม่จาก API เบื้องหลัง ถ้าข้อมูลเปลี่ยนค่อยวาดใหม่
// ออกจากระบบ → firebase-guard.js ลบข้อมูลที่จำไว้ทิ้ง
const DATA_CACHE = 'access-maps-data-v1';
async function cacheGet(url){
  try{ const r=await (await caches.open(DATA_CACHE)).match(url); return r ? await r.text() : null; }catch{ return null; }
}
async function cachePut(url,text){
  try{ await (await caches.open(DATA_CACHE)).put(url,new Response(text,{headers:{'content-type':'application/json'}})); }catch{}
}
// แปลงข้อความ JSON ทั้ง 2 ชุดเป็นจุดบนแผนที่ แล้ววาดใหม่ (fit=false: ไม่ขยับมุมมองแผนที่ที่ผู้ใช้ดูอยู่)
function applyData(mainText,stText,fit){
  const rows=normalizeRows(JSON.parse(mainText));
  let stationsOk=true;
  if(stText){
    try{ rows.push(...normalizeStationRows(JSON.parse(stText),rows.length)); }
    catch(e){ console.error(e); stationsOk=false; }
  }
  allRows=rows;
  markDuplicates();
  if(selectedId!==null&&!allRows.some(p=>p.id===selectedId)) selectedId=null;
  buildSupplierOptions();
  renderMap({fit});renderList();
  return stationsOk;
}
// Geofence ที่ชื่อซ้ำ หรือพิกัดซ้ำกัน (ใช้กับตัวกรอง "ข้อมูลซ้ำ") → p.dup = 'ชื่อซ้ำ' | 'พิกัดซ้ำ' | 'ชื่อ+พิกัดซ้ำ'
function markDuplicates(){
  const geo=allRows.filter(p=>p.kind==='geo');
  const nameKey=p=>p.name.trim().toLocaleLowerCase(), coordKey=p=>`${p.lat.toFixed(6)},${p.lng.toFixed(6)}`;
  const names=new Map(), coords=new Map();
  geo.forEach(p=>{ names.set(nameKey(p),(names.get(nameKey(p))||0)+1); if(validPoint(p)) coords.set(coordKey(p),(coords.get(coordKey(p))||0)+1); });
  geo.forEach(p=>{
    const n=names.get(nameKey(p))>1, c=validPoint(p)&&coords.get(coordKey(p))>1;
    p.dup = n&&c ? 'ชื่อ+พิกัดซ้ำ' : n ? 'ชื่อซ้ำ' : c ? 'พิกัดซ้ำ' : null;
    p.dupKey = n ? 'n:'+nameKey(p) : c ? 'c:'+coordKey(p) : '';
  });
}
// ทั้ง 2 ชุด (Geofence + ปั๊มน้ำมัน) แนบ Firebase ID token ไปให้ Apps Script ตรวจ
// (ดู firebase-guard.js / apps-script/geofence.gs / apps-script/stations.gs)
const fetchText=url=>fetchProtectedText(url);
async function loadData(){
  const setStatus=t=>{ if($('statusText')) $('statusText').textContent=t; };
  if($('refreshBtn')) $('refreshBtn').disabled=true;
  const hadRows=allRows.length>0;
  let fromCache=false, cMain=null, cSt=null;
  try{
    // 1) ข้อมูลที่จำไว้ → แสดงทันที (ครั้งแรกที่เปิดยังไม่มี)
    if(!allRows.length){
      [cMain,cSt]=await Promise.all([cacheGet(API_URL), STATIONS_API_URL?cacheGet(STATIONS_API_URL):null]);
      if(cMain){
        try{ applyData(cMain,cSt,true); fromCache=true; setStatus('ข้อมูลที่บันทึกไว้ · กำลังอัปเดต...'); }
        catch(e){ console.error(e); cMain=null; }
      }
    }
    if(!fromCache&&!allRows.length){
      setStatus('กำลังโหลดข้อมูล...');
      if($('pointList')) $('pointList').innerHTML='<div class="empty"><span class="loading"></span>กำลังโหลดรายการพิกัด</div>';
    }else if(!fromCache) setStatus('กำลังอัปเดตข้อมูล...');
    // 2) ดึงข้อมูลล่าสุดจาก API ทั้ง 2 ชุดพร้อมกัน — ถ้าชุดปั๊มล้มเหลว ชุดหลักยังแสดงได้
    const [mainRes,stRes]=await Promise.allSettled([fetchText(API_URL), STATIONS_API_URL?fetchText(STATIONS_API_URL):Promise.resolve(null)]);
    if(mainRes.status==='rejected'){
      if(allRows.length){ console.error(mainRes.reason); setStatus('อัปเดตไม่สำเร็จ · ใช้ข้อมูลที่บันทึกไว้'); toast('อัปเดตข้อมูลไม่สำเร็จ — แสดงข้อมูลที่บันทึกไว้ล่าสุด',4500); return; }
      throw mainRes.reason;
    }
    const mainText=mainRes.value;
    if(stRes.status==='rejected'){ console.error(stRes.reason); toast('โหลดข้อมูลปั๊มน้ำมันไม่สำเร็จ',4000); }
    const stText=stRes.status==='fulfilled'?stRes.value:cSt;
    // 3) วาดใหม่เฉพาะเมื่อข้อมูลเปลี่ยนจากที่แสดงอยู่ (ไม่เปลี่ยน = ไม่กระพริบ ไม่ขยับแผนที่)
    const changed=!fromCache||mainText!==cMain||stText!==cSt;
    if(changed){
      const stOk=applyData(mainText,stText,!fromCache&&!hadRows);
      if(!stOk) toast('โหลดข้อมูลปั๊มน้ำมันไม่สำเร็จ',4000);
    }
    cachePut(API_URL,mainText);
    if(stRes.status==='fulfilled'&&stRes.value) cachePut(STATIONS_API_URL,stRes.value);
    setStatus('เชื่อมต่อข้อมูลแล้ว');
    if($('lastUpdated')) $('lastUpdated').textContent=new Date().toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'});
    if(!fromCache) toast(`โหลดข้อมูลสำเร็จ ${allRows.length.toLocaleString('th-TH')} รายการ`);
    else if(changed) toast('อัปเดตข้อมูลล่าสุดแล้ว',2500);
  }catch(err){
    console.error(err);
    setStatus('โหลดข้อมูลไม่สำเร็จ');
    if($('pointList')) $('pointList').innerHTML=`<div class="empty">ไม่สามารถโหลดข้อมูลได้<br><br>${esc(err.message)}<br><br>ลองกดรีเฟรชหน้า หรือออกจากระบบแล้วล็อกอินใหม่</div>`;
    toast('โหลดข้อมูลไม่สำเร็จ — ตรวจสอบ URL, สิทธิ์ Web App และ CORS',5000);
  }finally{if($('refreshBtn')) $('refreshBtn').disabled=false}
}

const searchInputEl = $('searchInput');
if(searchInputEl){
  searchInputEl.addEventListener('input',scheduleRenderList);
  searchInputEl.addEventListener('input',syncSearchClear);
  // ปุ่ม ✕ ล้างช่องค้นหาทีเดียว (ล้างหมุดค้นหา/ตำแหน่งของฉันด้วย เหมือนลบข้อความจนหมด)
  $('searchClear')?.addEventListener('click',()=>{
    searchInputEl.value='';
    searchInputEl.dispatchEvent(new Event('input'));
    renderList();
    if(!isMobileWidth()) searchInputEl.focus();
  });
  searchInputEl.addEventListener('keydown',e=>{
    if(e.key!=='Enter') return;
    const text=e.target.value.trim();
    if(!text) { clearSearchMarker(); return; }
    const pt=parseLatLng(text);
    if(pt){
      showSearchMarker(pt.lat,pt.lng);
    }else if(/^[-\d.,\s;/]+$/.test(text)){
      toast('รูปแบบพิกัดไม่ถูกต้อง ตัวอย่าง: 13.7563, 100.5018');
    }
  });
  searchInputEl.addEventListener('input',e=>{
    const text=e.target.value.trim();
    const pt=parseLatLng(text);
    // แก้ข้อความจนไม่ใช่พิกัดเดิมแล้ว → ล้างหมุด/เส้น/ผล 5 อันดับเดิม
    if(!text||(searchPoint&&!(pt&&pt.lat===searchPoint.lat&&pt.lng===searchPoint.lng))){ clearSearchMarker(); scheduleRenderList(); }
  });
}

const supplierSelectEl = $('supplierSelect');
if(supplierSelectEl){
  supplierSelectEl.addEventListener('change',e=>{
    activeSupplier=e.target.value;
    e.target.classList.toggle('on',activeSupplier!=='all');
    selectedId=null;
    renderGeoLayer(); afterLayerChange(); renderList();
    if(showGeo) fitToVisible();
  });
}
$('brandSelect')?.addEventListener('change',e=>{
  activeBrand=e.target.value;
  e.target.classList.toggle('on',activeBrand!=='all');
  selectedId=null;
  renderStationLayer(); afterLayerChange(); renderList();
  if(!showGeo) fitToVisible();
});
// การ์ดมุมขวาบน = ปุ่มเปิด/ปิดชั้นข้อมูล
$('layerGeo')?.addEventListener('click',()=>{ showGeo=!showGeo; saveLayers(); renderGeoLayer(); afterLayerChange(); renderList(); });
$('layerStations')?.addEventListener('click',()=>{
  showStations=!showStations; saveLayers(); renderStationLayer(); afterLayerChange(); renderList();
  if(showStations) toast(`แสดงปั๊มน้ำมัน ${stationRows().length.toLocaleString('th-TH')} แห่ง`,2500);
});

document.querySelectorAll('.chip').forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelectorAll('.chip').forEach(b=>b.classList.remove('active'));
  btn.classList.add('active');activeFilter=btn.dataset.filter;renderList();
}));

const sidebarToggleEl = $('sidebarToggle');
if(sidebarToggleEl){
  sidebarToggleEl.addEventListener('click',()=>{ 
    const sidebar = $('sidebar');
    if(sidebar) sidebar.classList.toggle('collapsed');
    setTimeout(()=>map.invalidateSize(),280);
  });
}

// ===== มือถือ: แถบรายการลอยทับแผนที่ =====
const isMobile=()=>window.innerWidth<=850;
// เปิดหน้ามาบนมือถือ → เห็นแผนที่ก่อน (กด ☰ รายการ เพื่อเปิด)
if(isMobile()) $('sidebar')?.classList.add('collapsed');
// แตะแผนที่ข้างแถบรายการ → ปิดแถบรายการ (แตะครั้งนั้นใช้ปิดอย่างเดียว ไม่ไปกดหมุด/ปุ่มบนแผนที่)
document.querySelector('.maparea')?.addEventListener('click',e=>{
  const sidebar=$('sidebar');
  if(!isMobile()||!sidebar||sidebar.classList.contains('collapsed')) return;
  e.preventDefault(); e.stopPropagation();
  sidebar.classList.add('collapsed');
},true);

const themeToggleEl = $('themeToggle');
if(themeToggleEl){
  const applyTheme=dark=>{
    document.body.classList.toggle('dark',dark);
    if($('themeIcon')) $('themeIcon').textContent=dark?'☀':'☾';
    themeToggleEl.title=dark?'เปลี่ยนเป็นโหมดสว่าง':'เปลี่ยนเป็นโหมดมืด';
  };
  // จำธีมที่เลือกไว้ในเบราว์เซอร์นี้ (เปิดหน้าใหม่ยังเป็นธีมเดิม)
  try{ if(localStorage.getItem('accessMapsTheme')==='dark') applyTheme(true); }catch{}
  themeToggleEl.addEventListener('click',()=>{
    const dark=!document.body.classList.contains('dark');
    applyTheme(dark);
    try{ localStorage.setItem('accessMapsTheme',dark?'dark':'light'); }catch{}
  });
}

const refreshBtnEl = $('refreshBtn');
if(refreshBtnEl) refreshBtnEl.addEventListener('click',loadData);

document.querySelectorAll('[data-layer]').forEach(btn=>btn.addEventListener('click',()=>{
  document.querySelectorAll('[data-layer]').forEach(b=>b.classList.remove('active'));btn.classList.add('active');
  currentLayer=btn.dataset.layer;
  if(currentLayer==='satellite'){map.removeLayer(streetLayer);satelliteLayer.addTo(map)}
  else{map.removeLayer(satelliteLayer);streetLayer.addTo(map)}
}));

map.on('mousemove',e=>{
  const cursorCoords = $('cursorCoords');
  if(cursorCoords) cursorCoords.textContent=`LAT ${e.latlng.lat.toFixed(5)} · LNG ${e.latlng.lng.toFixed(5)}`;
});
map.on('click',e=>{if(e.originalEvent.target===map.getContainer()&&selectedId!==null){ selectPoint(null); }});

// ===== ปุ่มตำแหน่งของฉัน (มุมขวาล่าง เหนือปุ่มซูม) =====
// ใช้ Geolocation ของเบราว์เซอร์ ตำแหน่งอยู่ในเครื่องผู้ใช้เท่านั้น ไม่ได้ส่งไปเก็บที่ไหน
const LocateControl = L.Control.extend({
  options:{position:'bottomright'},
  onAdd(){
    const btn=L.DomUtil.create('button','locatebtn');
    btn.type='button'; btn.title='ตำแหน่งของฉัน'; btn.setAttribute('aria-label','ตำแหน่งของฉัน');
    btn.innerHTML='<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v3M12 19v3M2 12h3M19 12h3"/><circle cx="12" cy="12" r="8"/></svg>';
    L.DomEvent.disableClickPropagation(btn);
    L.DomEvent.on(btn,'click',()=>locateMe(btn));
    return btn;
  }
});
map.addControl(new LocateControl());

// กดปุ่มวนเป็น 3 สถานะ: ปิด → หาตำแหน่งครั้งเดียว (on) → ติดตามเรียลไทม์ (follow) → ปิด
function locateMe(btn){
  if(!('geolocation' in navigator)){ toast('อุปกรณ์หรือเบราว์เซอร์นี้ไม่รองรับการหาตำแหน่ง'); return; }
  if(btn.classList.contains('busy')) return;
  if(followWatchId!==null){ stopFollow(); toast('ปิดการติดตามตำแหน่งแล้ว',2500); return; }
  if(btn.classList.contains('on')&&searchPoint){ startFollow(btn); return; }
  btn.classList.add('busy');
  toast('กำลังหาตำแหน่งของคุณ...',10000);
  navigator.geolocation.getCurrentPosition(pos=>{
    btn.classList.remove('busy');
    const lat=Number(pos.coords.latitude.toFixed(6)), lng=Number(pos.coords.longitude.toFixed(6));
    const inp=$('searchInput');
    // ใส่พิกัดในช่องค้นหา เพื่อให้รายการด้านซ้ายแสดง Geofence ใกล้สุด 5 อันดับ (ลบช่องค้นหา = ล้างตำแหน่ง)
    if(inp) inp.value=`${lat}, ${lng}`;
    showSearchMarker(lat,lng,{accuracy:pos.coords.accuracy||0});
    btn.classList.add('on');
    const near=nearestPoints(lat,lng,1)[0];
    toast((near?`ใกล้ที่สุด: ${near.p.name} (${formatKm(near.km)} กม.) · แม่นยำ ±${Math.round(pos.coords.accuracy)} ม.`:`พบตำแหน่งแล้ว · แม่นยำ ±${Math.round(pos.coords.accuracy)} ม.`)+' — กดปุ่มอีกครั้งเพื่อติดตามแบบเรียลไทม์',5500);
    btn.title='กดเพื่อติดตามตำแหน่งแบบเรียลไทม์';
  },err=>{
    btn.classList.remove('busy','on');
    toast(geoErrorText(err),6000);
  },{enableHighAccuracy:true,timeout:15000,maximumAge:10000});
}
function geoErrorText(err){
  return err.code===1 ? 'ไม่ได้รับอนุญาตให้ใช้ตำแหน่ง — เปิดสิทธิ์ "ตำแหน่ง" ให้เว็บนี้ในการตั้งค่าเบราว์เซอร์ แล้วลองใหม่'
    : err.code===3 ? 'หาตำแหน่งนานเกินไป ลองใหม่อีกครั้ง หรือออกไปที่โล่ง'
    : 'หาตำแหน่งไม่สำเร็จ ตรวจสอบว่าเปิด GPS / Location ในมือถือแล้ว';
}

// ===== โหมดติดตามตำแหน่งแบบเรียลไทม์ =====
// การแสดงผลแบบลื่น (B+C):
//  - รับพิกัดทุก 1 วินาที แล้ววาดจุดสีฟ้า/วงความแม่นยำ/แผนที่ใหม่ทุกเฟรม (ไม่กระโดด)
//  - ถ้ารถวิ่งตรงและเร็วพอ และ GPS ส่งความเร็ว+ทิศทางมา → เดาตำแหน่งล่วงหน้าตามความเร็ว (ไม่ตามหลัง)
//    ไม่งั้น → ค่อย ๆ ไหลไปหาพิกัดล่าสุด
//  - พิกัดจริงมาไม่ตรงกับที่เดา → ค่อย ๆ ไหลเข้าหา ไม่ดีดกลับทันที
//  - ข้อมูลรายการ/แถบใกล้สุดยังอัปเดตทุก 2 วินาที
const FOLLOW = {
  FIX_INTERVAL: 1000,      // รับพิกัดไม่ถี่กว่านี้ (ms)
  DATA_INTERVAL: 2000,     // อัปเดตรายการ 5 จุด / แถบใกล้สุด / ป๊อปอัป (ms)
  PREDICT_MIN_SPEED: 2.8,  // m/s (~10 กม./ชม.) ต่ำกว่านี้ไม่เดาล่วงหน้า
  PREDICT_MAX_TURN: 30,    // องศา: ทิศทางเปลี่ยนมากกว่านี้ระหว่าง 2 พิกัด = กำลังเลี้ยว ไม่เดา
  PREDICT_MAX_MS: 2000,    // เดาต่อได้ไม่เกินเท่านี้หลังพิกัดล่าสุด แล้วหยุดรอ
  JITTER_M: 4,             // จอดนิ่ง: ขยับน้อยกว่านี้ (เมตร) ไม่ขยับจุด
  JUMP_SPEED: 60,          // m/s (~216 กม./ชม.) กระโดดเร็วกว่านี้ = พิกัดผิดปกติ ข้าม
  EASE_MS_PREDICT: 600,    // เวลาไหลเข้าหาพิกัดจริง ตอนเดาล่วงหน้า
  EASE_MS_FOLLOW: 1000     // เวลาไหลไปหาพิกัดใหม่ ตอนไม่เดา
};
let followWatchId = null, followLastFix = 0, followLastData = 0;
let fix = null;            // พิกัดล่าสุดที่ใช้ได้ {lat,lng,acc,t,v:{e,n}|null,heading,gpsT}
let fixErr = null;         // ส่วนต่างระหว่างจุดที่แสดงอยู่กับพิกัดใหม่ {dLat,dLng,t0,dur} ค่อย ๆ ลดเป็น 0
let followRaf = null, lastMoveEndFire = 0, panDirty = false, jumpRejects = 0, lastLabelLayout = 0;

function startFollow(btn){
  btn.classList.add('follow');
  btn.title='กำลังติดตามตำแหน่ง — กดเพื่อปิด';
  $('nearBar')?.classList.add('following');
  if(searchPoint) fix={lat:searchPoint.lat,lng:searchPoint.lng,acc:accuracyCircle?accuracyCircle.getRadius():0,t:performance.now(),v:null,heading:null,gpsT:0};
  fixErr=null; followLastFix=0; followLastData=performance.now();
  lockFollow();
  toast('เปิดติดตามตำแหน่งแบบเรียลไทม์ — กดปุ่มอีกครั้งเพื่อปิด (ใช้แบตมากขึ้น)',4500);
  followWatchId=navigator.geolocation.watchPosition(onFollowFix,err=>{
    if(err.code===3) return; // หมดเวลารอบนี้ รอรอบถัดไป
    stopFollow(); toast(geoErrorText(err),6000);
  },{enableHighAccuracy:true,timeout:20000,maximumAge:1000});
  if(!followRaf) followRaf=requestAnimationFrame(followFrame);
}

// ระยะทาง (เมตร) และการเลื่อนพิกัดตามเมตร แบบระยะสั้น
function metersBetween(a,b){ return distanceKm(a.lat,a.lng,b.lat,b.lng)*1000; }
function offsetMeters(lat,lng,e,n){ return {lat:lat+n/111320, lng:lng+e/(111320*Math.cos(lat*Math.PI/180))}; }
function angleDiff(a,b){ const d=Math.abs(a-b)%360; return d>180?360-d:d; }

function onFollowFix(pos){
  const now=performance.now();
  if(now-followLastFix<FOLLOW.FIX_INTERVAL) return;
  const c=pos.coords;
  const p={lat:Number(c.latitude.toFixed(6)),lng:Number(c.longitude.toFixed(6))};
  const acc=c.accuracy||0;
  const speed=(c.speed!=null&&!isNaN(c.speed))?c.speed:null;
  const heading=(c.heading!=null&&!isNaN(c.heading))?c.heading:null;
  if(fix){
    const dist=metersBetween(fix,p);
    const dt=Math.max(0.2,(pos.timestamp&&fix.gpsT?(pos.timestamp-fix.gpsT):(now-fix.t))/1000);
    // พิกัดกระโดดผิดปกติ → ข้าม (แต่ถ้าผิดปกติติดกัน 3 ครั้ง ถือว่าย้ายที่จริง เช่น ออกจากอุโมงค์/ตึก)
    if(dist/dt>FOLLOW.JUMP_SPEED&&dist>Math.max(40,2*acc)){ if(++jumpRejects<3) return; }
    // จอดนิ่ง GPS แกว่ง → ไม่ขยับจุด (อัปเดตแค่ความแม่นยำ) ถ้าเพิ่งเดาล่วงหน้าไป ค่อย ๆ ไหลกลับมาที่พิกัดจริง
    else if(dist<FOLLOW.JITTER_M&&(speed===null||speed<1)){
      const shown=displayedPos(now);
      followLastFix=now; jumpRejects=0; fix.acc=acc; fix.v=null; fix.heading=null; fix.gpsT=pos.timestamp||fix.gpsT;
      if(shown) fixErr={dLat:shown.lat-fix.lat,dLng:shown.lng-fix.lng,t0:now,dur:FOLLOW.EASE_MS_FOLLOW};
      if(accuracyCircle) accuracyCircle.setRadius(acc);
      return;
    }
  }
  followLastFix=now; jumpRejects=0;
  // ใช้ความเร็ว+ทิศทางเดาล่วงหน้า เฉพาะเมื่อวิ่งเร็วพอและไม่ได้กำลังเลี้ยว
  let v=null;
  if(speed!==null&&heading!==null&&speed>=FOLLOW.PREDICT_MIN_SPEED&&!(fix&&fix.heading!==null&&angleDiff(fix.heading,heading)>FOLLOW.PREDICT_MAX_TURN)){
    const r=heading*Math.PI/180;
    v={e:Math.sin(r)*speed,n:Math.cos(r)*speed};
  }
  const shown=displayedPos(now);
  fix={lat:p.lat,lng:p.lng,acc,t:now,v,heading:(speed!==null&&speed>=FOLLOW.PREDICT_MIN_SPEED)?heading:null,gpsT:pos.timestamp||0};
  // จุดที่แสดงอยู่ต่างจากพิกัดใหม่เท่าไร → ค่อย ๆ ไหลเข้าหา
  if(shown) fixErr={dLat:shown.lat-p.lat,dLng:shown.lng-p.lng,t0:now,dur:v?FOLLOW.EASE_MS_PREDICT:FOLLOW.EASE_MS_FOLLOW};
  if(accuracyCircle) accuracyCircle.setRadius(acc);
  if(now-followLastData>=FOLLOW.DATA_INTERVAL){ followLastData=now; updateMyPosition(p.lat,p.lng,acc); }
}

// ตำแหน่งที่ควรแสดง ณ เวลา t = พิกัดล่าสุด (+ เดาล่วงหน้า) + ส่วนต่างที่กำลังค่อย ๆ หายไป
function displayedPos(t){
  if(!fix) return null;
  let base={lat:fix.lat,lng:fix.lng};
  if(fix.v){ const s=Math.min(t-fix.t,FOLLOW.PREDICT_MAX_MS)/1000; base=offsetMeters(fix.lat,fix.lng,fix.v.e*s,fix.v.n*s); }
  if(fixErr){
    const k=Math.min(1,(t-fixErr.t0)/fixErr.dur), left=1-(1-Math.pow(1-k,3)); // easeOutCubic
    if(k>=1) fixErr=null; else { base.lat+=fixErr.dLat*left; base.lng+=fixErr.dLng*left; }
  }
  return base;
}

// วาดทุกเฟรม: จุดสีฟ้า วงความแม่นยำ ต้นเส้นประ ลูกศรทิศทาง และเลื่อนแผนที่ (ถ้าล็อกกลางจอ)
function followFrame(){
  followRaf=null;
  if(followWatchId===null||!searchMarker) return;
  const now=performance.now();
  const d=displayedPos(now);
  if(d&&!document.hidden){
    searchMarker.setLatLng([d.lat,d.lng]);
    if(accuracyCircle) accuracyCircle.setLatLng([d.lat,d.lng]);
    const from=[d.lat,d.lng];
    nearestPairs.forEach(pr=>pr.line.setLatLngs([from,pr.to]));
    placeDistLabels(from);
    if(now-lastLabelLayout>250){ lastLabelLayout=now; layoutDistLabels(); }
    const el=searchMarker.getElement()?.querySelector('.mypos');
    if(el){ const moving=!!(fix&&fix.v&&fix.heading!==null); el.classList.toggle('moving',moving); if(moving) el.style.setProperty('--hd',fix.heading+'deg'); }
    if(followLocked&&!map._animatingZoom){
      const off=map.latLngToContainerPoint([d.lat,d.lng]).subtract(map.getSize().divideBy(2));
      const len=Math.hypot(off.x,off.y);
      if(len>0.05){
        // ห่างกลางจอมาก (เพิ่งกดกลับมาที่ตำแหน่งฉัน / เพิ่งซูม) → ค่อย ๆ ไล่ตาม, ใกล้แล้ว → ตามพอดี
        const step=len>2?off.multiplyBy(0.18):off;
        if(typeof map._rawPanBy==='function'){ map._rawPanBy(step); map.fire('move'); panDirty=true; }
        else map.panBy(step,{animate:false});
      }
    }
    // ให้แผนที่โหลดภาพ/จัดกลุ่มหมุดตามตำแหน่งใหม่เป็นระยะ (ไม่ทุกเฟรม เพื่อไม่ให้หนักเครื่อง)
    if(panDirty&&now-lastMoveEndFire>500){ lastMoveEndFire=now; panDirty=false; map.fire('moveend'); }
  }
  followRaf=requestAnimationFrame(followFrame);
}
// กดแถบลอย → พาไปที่ Geofence ที่ใกล้ที่สุด
$('nearBar')?.addEventListener('click',e=>{
  const id=Number(e.target.closest('[data-go]')?.dataset.go ?? $('nearBar').dataset.id);
  if(!Number.isFinite(id)) return;
  selectPoint(id);
  const p=allRows.find(x=>x.id===id);
  // ระหว่างติดตาม: ซูมให้เห็นทั้งตัวเราและจุดนั้น (ถ้าบินไปที่จุดเดียว แผนที่จะถูกดึงกลับมาหาตัวเรา)
  if(followWatchId!==null) unlockFollow();
  if(followWatchId!==null&&p&&searchPoint) map.flyToBounds(L.latLngBounds([[searchPoint.lat,searchPoint.lng],[p.lat,p.lng]]),{padding:[90,90],maxZoom:17,duration:.7});
  else revealMarker(id);
});
function stopFollow(){
  if(followWatchId!==null){ navigator.geolocation.clearWatch(followWatchId); followWatchId=null; }
  if(followRaf){ cancelAnimationFrame(followRaf); followRaf=null; }
  if(panDirty){ panDirty=false; map.fire('moveend'); }
  fixErr=null; jumpRejects=0;
  searchMarker?.getElement()?.querySelector('.mypos')?.classList.remove('moving');
  $('nearBar')?.classList.remove('following');
  followLocked=false; if($('recenterBtn')) $('recenterBtn').hidden=true;
  const btn=document.querySelector('.locatebtn');
  if(btn){ btn.classList.remove('follow'); btn.title=btn.classList.contains('on')?'กดเพื่อติดตามตำแหน่งแบบเรียลไทม์':'ตำแหน่งของฉัน'; }
}
// อัปเดตข้อมูลตามพิกัดล่าสุดทุก 2 วินาที (ป๊อปอัป ช่องค้นหา เส้นประ รายการ 5 จุด แถบใกล้สุด)
// ส่วนการขยับจุด/แผนที่ทำใน followFrame ทุกเฟรม
function updateMyPosition(lat,lng,accuracy){
  if(!searchMarker||!searchPoint) return;
  searchPoint={lat,lng};
  const near=nearestPoints(lat,lng);
  const nearText=near.length?`<br><br>ใกล้ที่สุด: <b>${esc(near[0].p.name)}</b><br>ระยะ ${formatKm(near[0].km)} กม.`:'';
  searchMarker.setPopupContent(`<div class="popup-title">ตำแหน่งของฉัน (ติดตามอยู่)</div><div class="popup-coord">Latitude: ${lat}<br>Longitude: ${lng}<br>ความแม่นยำ: ±${Math.round(accuracy).toLocaleString('th-TH')} ม.${nearText}</div>${popupActions(lat,lng)}`);
  const inp=$('searchInput'); if(inp) inp.value=`${lat}, ${lng}`;
  drawNearestLines();
  renderList();
}

// ===== ล็อกกลางจอระหว่างติดตาม =====
let followLocked = false;
// ล็อกกลางจอ: followFrame จะค่อย ๆ เลื่อนแผนที่กลับมาให้จุดสีฟ้าอยู่กลางจอเอง
function lockFollow(){
  followLocked=true;
  if($('recenterBtn')) $('recenterBtn').hidden=true;
}
function unlockFollow(){
  if(followWatchId===null||!followLocked) return;
  followLocked=false;
  if($('recenterBtn')) $('recenterBtn').hidden=false;
}
map.on('dragstart',unlockFollow);   // ใช้นิ้ว/เมาส์ลากแผนที่เอง → หยุดล็อก
$('recenterBtn')?.addEventListener('click',lockFollow);
// สลับไปแอปอื่น/ปิดจอ → ปิดการติดตามอัตโนมัติ เพื่อไม่ให้แบตหมดโดยไม่รู้ตัว
document.addEventListener('visibilitychange',()=>{
  if(document.hidden&&followWatchId!==null){ stopFollow(); toast('ปิดการติดตามตำแหน่งอัตโนมัติ (ออกจากหน้าจอ) — กดปุ่มเพื่อเริ่มใหม่',5000); }
});

// ===== Firebase: ตรวจสิทธิ์ / Logout / ตัด Session (ดู firebase-guard.js) =====
// โหลดข้อมูลหลังยืนยันตัวตนแล้วเท่านั้น
requireLogin(() => loadData(), { logoutButtonId: 'logoutBtn' });
