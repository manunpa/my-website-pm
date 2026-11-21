import { requireLogin } from './firebase-guard.js';
/* ใช้ URL Web App ที่เชื่อมต่อ Google Sheets */
const API_URL = 'https://script.google.com/macros/s/AKfycbxGxDaEkB1IVbzSbMFkMJ08zfx9n9qIRDReGx9Mb-bg2n5C0jh8KuiwDnGjdjTvuVCF/exec';
const $ = id => document.getElementById(id);
let allRows = [], filteredRows = [], activeFilter = 'all', activeSupplier = 'all', selectedId = null, currentLayer = 'street';
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

let searchMarker = null;
// พิกัดที่ค้นหาล่าสุด (กด Enter) ใช้คำนวณ Geofence ที่ใกล้ที่สุด
let searchPoint = null;
const NEAREST_COUNT = 5;
const nearestLines = L.layerGroup().addTo(map);

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
// จุดที่ใกล้ที่สุด N อันดับ (เฉพาะจุดที่มีพิกัด และตาม Supplier ที่เลือกอยู่)
function nearestPoints(lat,lng,n=NEAREST_COUNT){
  return allRows
    .filter(p=>validPoint(p)&&(activeSupplier==='all'||p.supplier===activeSupplier))
    .map(p=>({p,km:distanceKm(lat,lng,p.lat,p.lng)}))
    .sort((a,b)=>a.km-b.km)
    .slice(0,n);
}
function drawNearestLines(){
  nearestLines.clearLayers();
  if(!searchPoint) return;
  nearestPoints(searchPoint.lat,searchPoint.lng).forEach(({p},i)=>{
    L.polyline([[searchPoint.lat,searchPoint.lng],[p.lat,p.lng]],{
      color:i===0?'#e05260':'#4776ff',weight:i===0?3:2,opacity:i===0?.9:.55,dashArray:'6 6',interactive:false
    }).addTo(nearestLines);
  });
  updateNearBar();
}

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
  bar.innerHTML=`<span class="nb-dot"></span><span class="nb-label">ใกล้สุด</span><span class="nb-name">${esc(near.p.name)}</span><span class="nb-dist">${formatDist(near.km)}</span>`;
}

// opts.accuracy (เมตร) = มาจากปุ่มตำแหน่งของฉัน → แสดงเป็นจุดสีฟ้า + วงความแม่นยำ
function showSearchMarker(lat,lng,opts={}){
  clearSearchMarker();
  const isGps=opts.accuracy!==undefined;
  const icon = L.divIcon({
    className:'',
    html:isGps
      ?'<div class="mypos"></div>'
      :'<div style="width:22px;height:22px;border-radius:50%;background:#e05260;border:3px solid #fff;box-shadow:0 0 0 4px #e0526055,0 3px 10px #0006"></div>',
    iconSize:[22,22], iconAnchor:[11,11]
  });
  searchPoint={lat,lng}; gpsActive=isGps;
  const near=nearestPoints(lat,lng);
  const nearText=near.length?`<br><br>ใกล้ที่สุด: <b>${esc(near[0].p.name)}</b><br>ระยะ ${formatKm(near[0].km)} กม.`:'';
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
  const sidebar=$('sidebar');
  if(sidebar&&sidebar.classList.contains('collapsed')){ sidebar.classList.remove('collapsed'); setTimeout(()=>map.invalidateSize(),280); }
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
    if(Array.isArray(r)) return {id:i,name:String(r[0]??`จุดที่ ${i+1}`),lat:asNumber(r[1]),lng:asNumber(r[2]),supplier:String(r[3]??'').trim()||NO_SUPPLIER,raw:r};
    const name=findValue(r,['Geofence']) || `จุดที่ ${i+1}`;
    const lat=asNumber(findValue(r,['Latitude','Lat']));
    const lng=asNumber(findValue(r,['Longitude','Long','Lng','Lon']));
    const supplier=String(findValue(r,['Supplier','ซัพพลายเออร์','ผู้จัดหา'])??'').trim()||NO_SUPPLIER;
    return {id:i,name:String(name).trim(),lat,lng,supplier,raw:r};
  });
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
  'PMS':'#495057'
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
function renderLegend(){
  const box=$('supplierLegend');
  if(!box) return;
  const counts=new Map();
  allRows.forEach(p=>{ if(validPoint(p)) counts.set(p.supplier,(counts.get(p.supplier)||0)+1); });
  const names=[...counts.keys()].sort((a,b)=>counts.get(b)-counts.get(a));
  box.innerHTML=names.map(n=>`<button type="button" class="legend-item sup${activeSupplier===n?' on':''}${activeSupplier!=='all'&&activeSupplier!==n?' dim':''}" data-sup="${esc(n)}" title="กดเพื่อกรองเฉพาะ ${esc(n)}"><span class="legend-dot" style="background:${supplierColor(n)}"></span>${esc(n)}</button>`).join('');
}
// กดชื่อ Supplier ในคำอธิบายสัญลักษณ์ → กรองเฉพาะ Supplier นั้น (กดซ้ำ = แสดงทั้งหมด)
$('supplierLegend')?.addEventListener('click',e=>{
  const item=e.target.closest('[data-sup]');
  const sel=$('supplierSelect');
  if(!item||!sel) return;
  sel.value = activeSupplier===item.dataset.sup ? 'all' : item.dataset.sup;
  sel.dispatchEvent(new Event('change'));
});

function buildMarker(p){
  const marker=L.marker([p.lat,p.lng],{title:p.name,icon:pinIcon(supplierColor(p.supplier))});
  marker.supplierIcon=marker.options.icon;
  marker.bindPopup(`<div class="popup-title">${esc(p.name)}</div><div class="popup-coord">Supplier: ${esc(p.supplier)}<br>Latitude: ${p.lat}<br>Longitude: ${p.lng}</div>${popupActions(p.lat,p.lng)}`);
  marker.on('click',()=>{ selectPoint(p.id); renderList(); scrollRowIntoView(p.id); });
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
}
// พาไปที่หมุด ถ้าหมุดซ่อนอยู่ในกลุ่ม (ตัวเลข) จะซูม/กางกลุ่มออกจนเห็นหมุดนั้นแล้วค่อยเปิดป๊อปอัป
function revealMarker(id){
  const m=markerById.get(id);
  if(!m) return;
  unlockFollow(); // กำลังติดตามอยู่ → หยุดล็อกกลางจอ ไม่งั้นแผนที่จะถูกดึงกลับมาหาตัวเรา
  const ll=m.getLatLng();
  const hidden=()=>{ const vp=clusters.getVisibleParent(m); return vp&&vp!==m ? vp : null; };
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
  const row=document.querySelector(`.pointrow[data-id="${id}"]`);
  if(row) row.scrollIntoView({block:'nearest',behavior:'smooth'});
}
function renderMap(){
  clusters.clearLayers();markerById.clear();
  const bySupplier=allRows.filter(p=>activeSupplier==='all'||p.supplier===activeSupplier);
  const valid=bySupplier.filter(validPoint);
  const markers=valid.map(buildMarker);
  clusters.addLayers(markers);
  selectedMarker=null; selectPoint(selectedId);
  renderLegend();
  drawNearestLines();
  if($('statTotal')) $('statTotal').textContent=bySupplier.length.toLocaleString('th-TH');
  if($('statValid')) $('statValid').textContent=valid.length.toLocaleString('th-TH');
  if(valid.length===1) map.setView([valid[0].lat,valid[0].lng],13);
  else if(valid.length>1) map.fitBounds(L.latLngBounds(valid.map(p=>[p.lat,p.lng])),{padding:[45,45],maxZoom:12});
}
function buildSupplierOptions(){
  const counts=new Map();
  allRows.forEach(p=>counts.set(p.supplier,(counts.get(p.supplier)||0)+1));
  const names=[...counts.keys()].sort((a,b)=>{
    if(a===NO_SUPPLIER) return 1; if(b===NO_SUPPLIER) return -1;
    return a.localeCompare(b,'th');
  });
  if(activeSupplier!=='all'&&!counts.has(activeSupplier)) activeSupplier='all';
  const sel=$('supplierSelect');
  if(!sel) return;
  sel.innerHTML=`<option value="all">Supplier: ทั้งหมด (${allRows.length.toLocaleString('th-TH')})</option>`+
    names.map(n=>`<option value="${esc(n)}">${esc(n)} (${counts.get(n).toLocaleString('th-TH')})</option>`).join('');
  sel.value=activeSupplier;
  sel.classList.toggle('on',activeSupplier!=='all');
}
function renderList(){
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
    const matches = !!coordQ || (p.name+' '+p.supplier).toLocaleLowerCase().includes(q);
    if(activeSupplier!=='all'&&p.supplier!==activeSupplier) return false;
    const valid=validPoint(p);
    return matches&&(activeFilter==='all'||(activeFilter==='valid'&&valid)||(activeFilter==='invalid'&&!valid));
  });
  if(pointCount) pointCount.textContent=`${filteredRows.length.toLocaleString('th-TH')} จุด`;
  if(!filteredRows.length){pointList.innerHTML='<div class="empty">ไม่พบรายการที่ตรงกับการค้นหา</div>';return}
  const hint=coordQ?'<div class="nearhint">กด Enter เพื่อหา Geofence ที่ใกล้พิกัดนี้ที่สุด</div>':'';
  pointList.innerHTML=hint+filteredRows.map(p=>{
    const valid=validPoint(p), selected=selectedId===p.id;
    return `<div class="pointrow ${selected?'selected':''}" data-id="${p.id}">
      <div class="pin"${valid?` style="color:${supplierColor(p.supplier)};background:${supplierColor(p.supplier)}1f"`:''}>${valid?'⌖':'!'}</div>
      <div class="pointinfo"><div class="pointname">${esc(p.name)}</div><div class="pointcoord">${valid?`${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`:'ไม่พบ Latitude / Longitude'}${p.supplier!==NO_SUPPLIER?` · <span class="pointsup" style="color:${supplierColor(p.supplier)}">${esc(p.supplier)}</span>`:''}</div></div>
      <div class="pointarrow">${valid?'›':'·'}</div>
    </div>`;
  }).join('');
  bindRowClicks(pointList);
}

function renderNearest(pointList,pointCount){
  const near=nearestPoints(searchPoint.lat,searchPoint.lng);
  filteredRows=near.map(n=>n.p);
  if(pointCount) pointCount.textContent=`ใกล้สุด ${near.length} จุด`;
  const supNote=activeSupplier!=='all'?`<div class="nearsub">เฉพาะ Supplier: ${esc(activeSupplier)}</div>`:'';
  const head=`<div class="nearhead"><div class="neartitle">Geofence ที่ใกล้ที่สุด</div>
    <div class="nearsub">จาก ${searchPoint.lat}, ${searchPoint.lng} · ระยะเส้นตรง</div>${supNote}</div>`;
  if(!near.length){pointList.innerHTML=head+'<div class="empty">ไม่มี Geofence ที่มีพิกัดให้เทียบระยะ</div>';return}
  pointList.innerHTML=head+near.map(({p,km},i)=>{
    const selected=selectedId===p.id;
    return `<div class="pointrow ${selected?'selected':''} ${i===0?'nearest':''}" data-id="${p.id}">
      <div class="pin rank">${i+1}</div>
      <div class="pointinfo"><div class="pointname">${esc(p.name)}</div><div class="pointcoord">${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}${p.supplier!==NO_SUPPLIER?` · <span class="pointsup" style="color:${supplierColor(p.supplier)}">${esc(p.supplier)}</span>`:''}</div></div>
      <div class="dist"><b>${formatKm(km)}</b><span>กม.</span></div>
    </div>`;
  }).join('');
  bindRowClicks(pointList);
}

function bindRowClicks(pointList){
  pointList.querySelectorAll('.pointrow').forEach(el=>el.addEventListener('click',()=>{
    const id=Number(el.dataset.id),p=allRows.find(x=>x.id===id);
    if(!p)return;
    selectPoint(id);renderList();
    if(!validPoint(p)){toast('รายการนี้ไม่มีพิกัด Latitude / Longitude ที่ถูกต้อง');return}
    const sidebar = $('sidebar');
    if(sidebar && !sidebar.classList.contains('collapsed')&&window.innerWidth<=850) sidebar.classList.add('collapsed');
    revealMarker(id);
  }));
}

async function loadData(){
  if($('statusText')) $('statusText').textContent='กำลังโหลดข้อมูล...';
  if($('pointList')) $('pointList').innerHTML='<div class="empty"><span class="loading"></span>กำลังโหลดรายการพิกัด</div>';
  if($('refreshBtn')) $('refreshBtn').disabled=true;
  try{
    const response=await fetch(API_URL,{method:'GET',cache:'no-store',redirect:'follow'});
    if(!response.ok) throw new Error(`HTTP ${response.status}`);
    const payload=await response.json();
    allRows=normalizeRows(payload);
    buildSupplierOptions();
    renderMap();renderList();
    if($('statusText')) $('statusText').textContent='เชื่อมต่อข้อมูลแล้ว';
    if($('lastUpdated')) $('lastUpdated').textContent=new Date().toLocaleTimeString('th-TH',{hour:'2-digit',minute:'2-digit'});
    toast(`โหลดข้อมูลสำเร็จ ${allRows.length.toLocaleString('th-TH')} รายการ`);
  }catch(err){
    console.error(err);
    if($('statusText')) $('statusText').textContent='โหลดข้อมูลไม่สำเร็จ';
    if($('pointList')) $('pointList').innerHTML=`<div class="empty">ไม่สามารถโหลดข้อมูลได้<br><br>${esc(err.message)}<br><br>ตรวจสอบว่า Apps Script เปิดสิทธิ์ Web app ให้เข้าถึงได้ และส่งข้อมูล JSON ที่มีคอลัมน์ Geofence, Latitude, Longitude</div>`;
    toast('โหลดข้อมูลไม่สำเร็จ — ตรวจสอบ URL, สิทธิ์ Web App และ CORS',5000);
  }finally{if($('refreshBtn')) $('refreshBtn').disabled=false}
}

const searchInputEl = $('searchInput');
if(searchInputEl){
  searchInputEl.addEventListener('input',renderList);
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
    if(!text||(searchPoint&&!(pt&&pt.lat===searchPoint.lat&&pt.lng===searchPoint.lng))){ clearSearchMarker(); renderList(); }
  });
}

const supplierSelectEl = $('supplierSelect');
if(supplierSelectEl){
  supplierSelectEl.addEventListener('change',e=>{
    activeSupplier=e.target.value;
    e.target.classList.toggle('on',activeSupplier!=='all');
    selectedId=null;
    renderMap();renderList();
  });
}

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
map.on('click',e=>{if(e.originalEvent.target===map.getContainer()&&selectedId!==null){ selectPoint(null); renderList(); }});

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
let followWatchId = null, followLastUpdate = 0;
const FOLLOW_MIN_INTERVAL = 2000; // อัปเดตหน้าจอไม่ถี่กว่าทุก 2 วินาที (ประหยัดแบต/ไม่กระตุก)
function startFollow(btn){
  btn.classList.add('follow');
  btn.title='กำลังติดตามตำแหน่ง — กดเพื่อปิด';
  $('nearBar')?.classList.add('following');
  lockFollow();
  toast('เปิดติดตามตำแหน่งแบบเรียลไทม์ — กดปุ่มอีกครั้งเพื่อปิด (ใช้แบตมากขึ้น)',4500);
  followWatchId=navigator.geolocation.watchPosition(pos=>{
    const now=Date.now();
    if(now-followLastUpdate<FOLLOW_MIN_INTERVAL) return;
    followLastUpdate=now;
    updateMyPosition(Number(pos.coords.latitude.toFixed(6)),Number(pos.coords.longitude.toFixed(6)),pos.coords.accuracy||0);
  },err=>{
    if(err.code===3) return; // หมดเวลารอบนี้ รอรอบถัดไป
    stopFollow(); toast(geoErrorText(err),6000);
  },{enableHighAccuracy:true,timeout:20000,maximumAge:3000});
}
// กดแถบลอย → พาไปที่ Geofence ที่ใกล้ที่สุด
$('nearBar')?.addEventListener('click',()=>{
  const id=Number($('nearBar').dataset.id);
  if(!Number.isFinite(id)) return;
  selectPoint(id); renderList();
  const p=allRows.find(x=>x.id===id);
  // ระหว่างติดตาม: ซูมให้เห็นทั้งตัวเราและจุดนั้น (ถ้าบินไปที่จุดเดียว แผนที่จะถูกดึงกลับมาหาตัวเรา)
  if(followWatchId!==null) unlockFollow();
  if(followWatchId!==null&&p&&searchPoint) map.flyToBounds(L.latLngBounds([[searchPoint.lat,searchPoint.lng],[p.lat,p.lng]]),{padding:[90,90],maxZoom:17,duration:.7});
  else revealMarker(id);
});
function stopFollow(){
  if(followWatchId!==null){ navigator.geolocation.clearWatch(followWatchId); followWatchId=null; }
  $('nearBar')?.classList.remove('following');
  followLocked=false; if($('recenterBtn')) $('recenterBtn').hidden=true;
  const btn=document.querySelector('.locatebtn');
  if(btn){ btn.classList.remove('follow'); btn.title=btn.classList.contains('on')?'กดเพื่อติดตามตำแหน่งแบบเรียลไทม์':'ตำแหน่งของฉัน'; }
}
// ขยับจุดสีฟ้าไปตำแหน่งใหม่โดยไม่ล้างของเดิม (ไม่ซูม ไม่เปิดป๊อปอัปซ้ำ)
function updateMyPosition(lat,lng,accuracy){
  if(!searchMarker||!searchPoint) return;
  searchPoint={lat,lng};
  searchMarker.setLatLng([lat,lng]);
  if(accuracyCircle){ accuracyCircle.setLatLng([lat,lng]); accuracyCircle.setRadius(accuracy); }
  const near=nearestPoints(lat,lng);
  const nearText=near.length?`<br><br>ใกล้ที่สุด: <b>${esc(near[0].p.name)}</b><br>ระยะ ${formatKm(near[0].km)} กม.`:'';
  searchMarker.setPopupContent(`<div class="popup-title">ตำแหน่งของฉัน (ติดตามอยู่)</div><div class="popup-coord">Latitude: ${lat}<br>Longitude: ${lng}<br>ความแม่นยำ: ±${Math.round(accuracy).toLocaleString('th-TH')} ม.${nearText}</div>${popupActions(lat,lng)}`);
  const inp=$('searchInput'); if(inp) inp.value=`${lat}, ${lng}`;
  drawNearestLines();
  renderList();
  // เลื่อนแผนที่ตามเฉพาะเมื่อจุดสีฟ้าใกล้หลุดขอบจอ (ไม่แย่งตอนผู้ใช้เลื่อนดูที่อื่น)
  // ล็อกกลางจอ: แผนที่เลื่อนตามให้จุดสีฟ้าอยู่กลางจอตลอด (ถ้าผู้ใช้เลื่อนแผนที่เอง จะหยุดล็อกจนกว่าจะกด "กลับมาที่ตำแหน่งฉัน")
  if(followLocked) map.panTo([lat,lng],{animate:true,duration:1,easeLinearity:1});
}

// ===== ล็อกกลางจอระหว่างติดตาม =====
let followLocked = false;
function lockFollow(){
  followLocked=true;
  if($('recenterBtn')) $('recenterBtn').hidden=true;
  if(searchPoint) map.panTo([searchPoint.lat,searchPoint.lng],{animate:true,duration:.6});
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
