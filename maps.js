/* ใช้ URL Web App ที่เชื่อมต่อ Google Sheets */
const API_URL = 'https://script.google.com/macros/s/AKfycbxGxDaEkB1IVbzSbMFkMJ08zfx9n9qIRDReGx9Mb-bg2n5C0jh8KuiwDnGjdjTvuVCF/exec';
const $ = id => document.getElementById(id);
let allRows = [], filteredRows = [], activeFilter = 'all', activeSupplier = 'all', selectedId = null, currentLayer = 'street';
const NO_SUPPLIER = '(ไม่ระบุ Supplier)';
let markerById = new Map();

const map = L.map('map',{zoomControl:false,preferCanvas:true}).setView([13.7563,100.5018],6);
L.control.zoom({position:'bottomright'}).addTo(map);
const streetLayer = L.tileLayer('https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png',{
  maxZoom:19,attribution:'© <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
});
const satelliteLayer = L.tileLayer('https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}',{
  maxZoom:19,attribution:'Tiles © Esri — Source: Esri, Maxar, Earthstar Geographics, and the GIS User Community'
});
streetLayer.addTo(map);
const clusters = L.markerClusterGroup({chunkedLoading:true,chunkInterval:100,chunkDelay:25,maxClusterRadius:55,showCoverageOnHover:false,removeOutsideVisibleBounds:true,spiderfyOnMaxZoom:true});
map.addLayer(clusters);

let searchMarker = null;

function parseLatLng(text){
  const m = String(text).trim().match(/^(-?\d+(?:[.,]\d+)?)\s*[,\s;/]\s*(-?\d+(?:[.,]\d+)?)$/);
  if(!m) return null;
  const lat = Number(m[1].replace(',','.')), lng = Number(m[2].replace(',','.'));
  if(!Number.isFinite(lat)||!Number.isFinite(lng)) return null;
  if(lat<-90||lat>90||lng<-180||lng>180) return null;
  return {lat,lng};
}

function clearSearchMarker(){
  if(searchMarker){ map.removeLayer(searchMarker); searchMarker=null; }
}

function showSearchMarker(lat,lng){
  clearSearchMarker();
  const icon = L.divIcon({
    className:'',
    html:'<div style="width:22px;height:22px;border-radius:50%;background:#e05260;border:3px solid #fff;box-shadow:0 0 0 4px #e0526055,0 3px 10px #0006"></div>',
    iconSize:[22,22], iconAnchor:[11,11]
  });
  searchMarker = L.marker([lat,lng],{icon,zIndexOffset:1000}).addTo(map);
  searchMarker.bindPopup(`<div class="popup-title">พิกัดที่ค้นหา</div><div class="popup-coord">Latitude: ${lat}<br>Longitude: ${lng}</div>`);
  map.flyTo([lat,lng],Math.max(map.getZoom(),16),{duration:.8});
  setTimeout(()=>searchMarker&&searchMarker.openPopup(),850);
}

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
function buildMarker(p){
  const marker=L.marker([p.lat,p.lng],{title:p.name});
  marker.bindPopup(`<div class="popup-title">${esc(p.name)}</div><div class="popup-coord">Supplier: ${esc(p.supplier)}<br>Latitude: ${p.lat}<br>Longitude: ${p.lng}</div>`);
  marker.on('click',()=>{selectedId=p.id;renderList();});
  markerById.set(p.id,marker);
  return marker;
}
function renderMap(){
  clusters.clearLayers();markerById.clear();
  const bySupplier=allRows.filter(p=>activeSupplier==='all'||p.supplier===activeSupplier);
  const valid=bySupplier.filter(validPoint);
  const markers=valid.map(buildMarker);
  clusters.addLayers(markers);
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
  filteredRows=allRows.filter(p=>{
    const isCoord = !!parseLatLng(q);
    const matches = isCoord || (p.name+' '+p.supplier).toLocaleLowerCase().includes(q);
    if(activeSupplier!=='all'&&p.supplier!==activeSupplier) return false;
    const valid=validPoint(p);
    return matches&&(activeFilter==='all'||(activeFilter==='valid'&&valid)||(activeFilter==='invalid'&&!valid));
  });
  if(pointCount) pointCount.textContent=`${filteredRows.length.toLocaleString('th-TH')} จุด`;
  if(!filteredRows.length){pointList.innerHTML='<div class="empty">ไม่พบรายการที่ตรงกับการค้นหา</div>';return}
  pointList.innerHTML=filteredRows.map(p=>{
    const valid=validPoint(p), selected=selectedId===p.id;
    return `<div class="pointrow ${selected?'selected':''}" data-id="${p.id}">
      <div class="pin">${valid?'⌖':'!'}</div>
      <div class="pointinfo"><div class="pointname">${esc(p.name)}</div><div class="pointcoord">${valid?`${p.lat.toFixed(5)}, ${p.lng.toFixed(5)}`:'ไม่พบ Latitude / Longitude'}${p.supplier!==NO_SUPPLIER?` · <span class="pointsup">${esc(p.supplier)}</span>`:''}</div></div>
      <div class="pointarrow">${valid?'›':'·'}</div>
    </div>`;
  }).join('');
  pointList.querySelectorAll('.pointrow').forEach(el=>el.addEventListener('click',()=>{
    const id=Number(el.dataset.id),p=allRows.find(x=>x.id===id);
    if(!p)return;
    selectedId=id;renderList();
    if(!validPoint(p)){toast('รายการนี้ไม่มีพิกัด Latitude / Longitude ที่ถูกต้อง');return}
    const sidebar = $('sidebar');
    if(sidebar && !sidebar.classList.contains('collapsed')&&window.innerWidth<=850) sidebar.classList.add('collapsed');
    map.flyTo([p.lat,p.lng],Math.max(map.getZoom(),15),{duration:.7});
    const marker=markerById.get(id);if(marker) setTimeout(()=>marker.openPopup(),500);
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
    if(!e.target.value.trim()) clearSearchMarker();
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
  themeToggleEl.addEventListener('click',()=>{
    document.body.classList.toggle('dark');
    const dark=document.body.classList.contains('dark');
    if($('themeIcon')) $('themeIcon').textContent=dark?'☀':'☾';
    themeToggleEl.title=dark?'เปลี่ยนเป็นโหมดสว่าง':'เปลี่ยนเป็นโหมดมืด';
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
map.on('click',e=>{if(e.originalEvent.target===map.getContainer()) selectedId=null;});

loadData();

// ===== Firebase: ตรวจสิทธิ์ / Logout / ตัด Session =====
// ใช้ dynamic import + try/catch เพื่อไม่ให้ถ้า Firebase โหลดไม่ได้ แล้วแผนที่พังไปด้วย
const firebaseConfig = {
  apiKey: "AIzaSyD7HPOhloICyxEyDTfR8yRiH2rT--q4fVo",
  authDomain: "my-login-project-26857.firebaseapp.com",
  projectId: "my-login-project-26857",
  storageBucket: "my-login-project-26857.firebasestorage.app",
  messagingSenderId: "199741800244",
  appId: "1:199741800244:web:41b413f67038c687dc2f61"
};

const LOGIN_URL = "./index.html";
const INACTIVITY_LIMIT = 10 * 60 * 1000; // 10 นาที
const FB = "https://www.gstatic.com/firebasejs/10.8.0";

let auth = null, signOutFn = null, inactivityStarted = false;

async function doLogout() {
  try { if (auth && signOutFn) await signOutFn(auth); }
  catch (error) { console.error("Logout Error:", error); }
  window.location.replace(LOGIN_URL);
}

function startInactivityTimer() {
  if (inactivityStarted) return;
  inactivityStarted = true;
  let timer;
  function reset() {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      alert("หมดเวลาการใช้งานเนื่องจากไม่มีการเคลื่อนไหว กรุณาล็อกอินใหม่อีกครั้ง");
      await doLogout();
    }, INACTIVITY_LIMIT);
  }
  ["mousemove", "keydown", "click", "scroll", "touchstart"].forEach((evt) =>
    window.addEventListener(evt, reset, { passive: true })
  );
  reset();
}

// ปุ่มออกจากระบบ (id ต้องตรงกับ HTML = logoutBtn)
const logoutBtnEl = document.getElementById("logoutBtn");
if (logoutBtnEl) logoutBtnEl.addEventListener("click", doLogout);

(async function initAuth() {
  try {
    const [{ initializeApp }, { getAuth, signOut, onAuthStateChanged }] = await Promise.all([
      import(`${FB}/firebase-app.js`),
      import(`${FB}/firebase-auth.js`)
    ]);
    const app = initializeApp(firebaseConfig);
    auth = getAuth(app);
    signOutFn = signOut;
    onAuthStateChanged(auth, (user) => {
      if (user) {
        const userEmailEl = document.getElementById("user-email");
        if (userEmailEl) userEmailEl.textContent = user.email || "";
        document.documentElement.classList.add("ready");
        startInactivityTimer();
      } else {
        window.location.replace(LOGIN_URL);
      }
    });
  } catch (err) {
    console.error("Firebase load error:", err);
    toast("โหลดระบบยืนยันตัวตน (Firebase) ไม่สำเร็จ", 5000);
  }
})();
