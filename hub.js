(function () {
  var root = document.documentElement;

  /* ---------- ธีมสว่าง/มืด ---------- */
  try { if (localStorage.getItem("hub-theme") === "dark") root.setAttribute("data-theme", "dark"); } catch (e) {}
  document.getElementById("theme").addEventListener("click", function () {
    var dark = root.getAttribute("data-theme") !== "dark";
    if (dark) root.setAttribute("data-theme", "dark"); else root.removeAttribute("data-theme");
    try { localStorage.setItem("hub-theme", dark ? "dark" : "light"); } catch (e) {}
  });

  /* ---------- นาฬิกา + คำทักทายตามช่วงเวลา ---------- */
  var clock = document.getElementById("clock");
  var greet = document.getElementById("greet");
  var days = ["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"];
  var months = ["ม.ค.","ก.พ.","มี.ค.","เม.ย.","พ.ค.","มิ.ย.","ก.ค.","ส.ค.","ก.ย.","ต.ค.","พ.ย.","ธ.ค."];
  function pad(n) { return String(n).padStart(2, "0"); }
  function tick() {
    var d = new Date();
    clock.innerHTML = "วัน" + days[d.getDay()] + "ที่ " + d.getDate() + " " + months[d.getMonth()] + " " + (d.getFullYear() + 543) +
      "  <b>" + pad(d.getHours()) + ":" + pad(d.getMinutes()) + "</b>";
    var h = d.getHours();
    greet.textContent = (h < 5 ? "ดึกแล้ว พักผ่อนบ้างนะ" : h < 12 ? "อรุณสวัสดิ์ วันนี้เริ่มจากตรงไหนดี" : h < 17 ? "สวัสดียามบ่าย" : h < 21 ? "สวัสดียามเย็น" : "สวัสดียามค่ำ");
  }
  tick(); setInterval(tick, 20000);

  /* ---------- หัวข้อพิมพ์ทีละตัว ---------- */
  var title = document.getElementById("title");
  var started = false;
  window.hubStart = function () {
    if (started) return;
    started = true;
    var text = "Access", i = 0;
    var still = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    if (still) { title.textContent = text; title.classList.remove("typed"); return; }
    setTimeout(function type() {
      title.textContent = text.slice(0, ++i);
      if (i < text.length) setTimeout(type, 140);
      else setTimeout(function () { title.classList.remove("typed"); }, 1800);
    }, 450);
  };

  /* ---------- แสงตามเมาส์บนการ์ด ---------- */
  var cards = Array.prototype.slice.call(document.querySelectorAll(".btn"));
  cards.forEach(function (c) {
    c.addEventListener("pointermove", function (e) {
      var r = c.getBoundingClientRect();
      c.style.setProperty("--mx", (e.clientX - r.left) + "px");
      c.style.setProperty("--my", (e.clientY - r.top) + "px");
    });
  });

  /* ---------- ค้นหา / กรองปุ่ม ---------- */
  var q = document.getElementById("q");
  var empty = document.getElementById("empty");
  var sections = Array.prototype.slice.call(document.querySelectorAll("section"));
  function filter() {
    var term = q.value.trim().toLowerCase(), shown = 0;
    cards.forEach(function (c) {
      var ok = !term || c.textContent.toLowerCase().indexOf(term) > -1;
      c.style.display = ok ? "" : "none";
      if (ok) shown++;
    });
    sections.forEach(function (s) {
      var any = Array.prototype.some.call(s.querySelectorAll(".btn"), function (c) { return c.style.display !== "none"; });
      s.style.display = any ? "" : "none";
    });
    empty.style.display = shown ? "none" : "block";
  }
  q.addEventListener("input", filter);
  q.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { q.value = ""; filter(); q.blur(); }
    if (e.key === "Enter") {
      var first = cards.filter(function (c) { return c.style.display !== "none"; })[0];
      if (first) first.click();
    }
  });
  document.addEventListener("keydown", function (e) {
    if (e.key === "/" && document.activeElement !== q) { e.preventDefault(); q.focus(); }
  });
})();

// ===== Firebase: ตรวจสิทธิ์ / Logout / ตัด Session =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-app.js";
import { getAuth, signOut, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.8.0/firebase-auth.js";

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

const app = initializeApp(firebaseConfig);
const auth = getAuth(app);

onAuthStateChanged(auth, (user) => {
  if (user) {
    document.getElementById("user-email").textContent = user.email || "";
    document.documentElement.classList.add("ready");
    if (window.hubStart) window.hubStart();
    startInactivityTimer();
  } else {
    window.location.replace(LOGIN_URL);
  }
});

async function doLogout() {
  try { await signOut(auth); }
  catch (error) { console.error("Logout Error:", error); }
}
document.getElementById("logout-btn").addEventListener("click", doLogout);

let inactivityStarted = false;
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