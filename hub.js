import { requireLogin, fetchProtectedText, PRESENCE_URL } from "./firebase-guard.js?v=20261122-cut";
var initCards; // ตั้งค่าในฟังก์ชันด้านล่าง เรียกหลังรู้ว่าใครล็อกอิน
(function () {
  var root = document.documentElement;

  /* ---------- ที่เก็บค่าในเครื่องนี้ (เปิดแบบส่วนตัว/บล็อกไว้ก็ยังใช้หน้าได้ แค่ไม่จำ) ---------- */
  function load(key, fallback) {
    try { var v = JSON.parse(localStorage.getItem(key)); return v == null ? fallback : v; } catch (e) { return fallback; }
  }
  function save(key, value) {
    try { localStorage.setItem(key, JSON.stringify(value)); } catch (e) {}
  }

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
      "  <b>" + pad(d.getHours()) + ":" + pad(d.getMinutes()) + "</b>";
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

  /* =====================================================================
     การ์ดลิงก์: ปักหมุด / ใช้ล่าสุด / ชิปกรอง / ค้นหา / พับหมวด / ลูกศร
     - เพิ่มการ์ดใหม่ใน Access-Hub.html: ใส่ data-cat (หมวดจาก CATS ด้านล่าง) และ data-kw (คำค้นเพิ่ม)
     - รายการโปรด / ใช้ล่าสุด / ชิป / หมวดที่พับ จำแยกตามบัญชีที่ล็อกอิน (uid ของ Firebase)
       เก็บในเบราว์เซอร์เครื่องนี้ — คนละบัญชีบนเครื่องเดียวกันไม่เห็นของกัน แต่ยังไม่ซิงก์ข้ามเครื่อง
     ===================================================================== */
  initCards = function (uid) {
  var K = {
    favs: "hub-favs:" + uid,
    recent: "hub-recent:" + uid,
    chip: "hub-chip:" + uid,
    collapsed: "hub-collapsed:" + uid
  };
  var CATS = [
    { id: "all",  label: "ทั้งหมด" },
    { id: "fav",  label: "★ โปรด" },
    { id: "gps",  label: "GPS",              kw: "จีพีเอส ติดตาม ตำแหน่งรถ รถ" },
    { id: "cctv", label: "CCTV",             kw: "กล้อง วงจรปิด" },
    { id: "sea",  label: "ทะเล / AIS",       kw: "เรือ ทะเล มารีน" },
    { id: "tool", label: "รายงาน / เครื่องมือ", kw: "รายงาน แดชบอร์ด dashboard" },
    { id: "scg",  label: "SC Group",         kw: "เอสซี บริษัท" }
  ];
  var CAT_KW = {};
  CATS.forEach(function (c) { CAT_KW[c.id] = c.kw || ""; });
  var RECENT_MAX = 3;

  var STAR = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linejoin="round"><path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1-4.4-4.3 6.1-.9z"/></svg>';
  var CHEV = '<svg class="chev" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="m6 9 6 6 6-6"/></svg>';

  var q = document.getElementById("q");
  var empty = document.getElementById("empty");
  var chipsBox = document.getElementById("chips");
  var quick = document.getElementById("quick");
  var sections = Array.prototype.slice.call(document.querySelectorAll("section[data-sec]"));
  var cards = Array.prototype.slice.call(document.querySelectorAll("section[data-sec] .btn"));

  var favs = load(K.favs, []);
  var recent = load(K.recent, []);
  var chip = load(K.chip, "all");
  var collapsed = load(K.collapsed, []);
  if (!CATS.some(function (c) { return c.id === chip; })) chip = "all";

  function hrefOf(card) { return card && card.getAttribute("href"); }
  function isFav(href) { return favs.indexOf(href) > -1; }
  function firstCard(href) {
    for (var i = 0; i < cards.length; i++) if (hrefOf(cards[i]) === href) return cards[i];
    return null;
  }

  // เตรียมการ์ด: ข้อความสำหรับค้นหา + ปุ่มดาว (การ์ด "เร็ว ๆ นี้" ไม่มีลิงก์ จึงไม่มีดาว)
  cards.forEach(function (c) {
    var cats = (c.getAttribute("data-cat") || "").split(/\s+/).filter(Boolean);
    c._cats = cats;
    c._text = [c.textContent, c.getAttribute("data-kw") || ""].concat(cats.map(function (id) { return CAT_KW[id] || ""; }))
      .join(" ").toLowerCase().replace(/\s+/g, " ");
    if (!hrefOf(c)) return;
    var pin = document.createElement("span");
    pin.className = "pin";
    pin.setAttribute("role", "button");
    pin.tabIndex = 0;
    pin.innerHTML = STAR;
    c.insertBefore(pin, c.querySelector(".go"));
  });

  function syncPins(scope) {
    Array.prototype.forEach.call(scope.querySelectorAll(".btn"), function (c) {
      var on = isFav(hrefOf(c));
      c.classList.toggle("pinned", on);
      var p = c.querySelector(".pin");
      if (!p) return;
      p.setAttribute("aria-pressed", on ? "true" : "false");
      p.setAttribute("aria-label", on ? "เลิกปักหมุด" : "ปักหมุดไว้ในรายการโปรด");
      p.title = on ? "เลิกปักหมุด" : "ปักหมุดไว้ในรายการโปรด";
    });
  }

  /* ----- ชิปกรอง ----- */
  function countFor(id) {
    if (id === "all") return cards.length;
    if (id === "fav") return favs.length;
    return cards.filter(function (c) { return c._cats.indexOf(id) > -1; }).length;
  }
  function renderChips() {
    chipsBox.innerHTML = "";
    CATS.forEach(function (c) {
      var b = document.createElement("button");
      b.type = "button";
      b.className = "chip";
      b.setAttribute("aria-pressed", c.id === chip ? "true" : "false");
      b.innerHTML = c.label + "<small>" + countFor(c.id) + "</small>";
      b.addEventListener("click", function () {
        chip = c.id; save(K.chip, chip);
        renderChips(); filter();
      });
      chipsBox.appendChild(b);
    });
  }

  /* ----- หมวดพับ/กาง ----- */
  sections.forEach(function (s) {
    var h = s.querySelector("h2");
    var n = s.querySelectorAll(".btn").length;
    var meta = document.createElement("span");
    meta.className = "sec-meta";
    meta.innerHTML = "<small>" + n + " ลิงก์</small>" + CHEV;
    h.appendChild(meta);
    h.tabIndex = 0;
    h.setAttribute("role", "button");
    function toggle() {
      var id = s.getAttribute("data-sec");
      var i = collapsed.indexOf(id);
      if (i > -1) collapsed.splice(i, 1); else collapsed.push(id);
      save(K.collapsed, collapsed);
      filter();
    }
    h.addEventListener("click", toggle);
    h.addEventListener("keydown", function (e) {
      if (e.key === "Enter" || e.key === " ") { e.preventDefault(); toggle(); }
    });
  });

  /* ----- รายการโปรด / ใช้ล่าสุด ----- */
  function quickSection(label, hrefs, hint) {
    var s = document.createElement("section");
    s.className = "quick";
    s.innerHTML = "<h2>" + label + "</h2>";
    var g = document.createElement("div");
    g.className = "grid";
    hrefs.forEach(function (href) {
      var src = firstCard(href);
      if (src) g.appendChild(src.cloneNode(true));
    });
    if (!g.children.length && hint) g.innerHTML = '<div class="quick-hint">' + STAR + hint + "</div>";
    if (!g.children.length) return null;
    s.appendChild(g);
    return s;
  }
  function renderQuick() {
    // ทิ้ง href ที่ไม่มีการ์ดแล้ว (เช่น ลบลิงก์ออกจากหน้า)
    favs = favs.filter(function (h, i) { return firstCard(h) && favs.indexOf(h) === i; });
    recent = recent.filter(function (h) { return firstCard(h); });
    quick.innerHTML = "";
    var fav = quickSection("★ รายการโปรด", favs, "กดรูปดาวบนการ์ดใดก็ได้ เพื่อปักหมุดไว้ตรงนี้");
    var rec = quickSection("ใช้ล่าสุด", recent.filter(function (h) { return !isFav(h); }).slice(0, RECENT_MAX));
    if (fav) quick.appendChild(fav);
    if (rec) quick.appendChild(rec);
    syncPins(document);
  }

  function toggleFav(href, pinEl) {
    var i = favs.indexOf(href);
    if (i > -1) favs.splice(i, 1); else favs.push(href);
    save(K.favs, favs);
    renderQuick(); renderChips(); filter();
    if (pinEl && i === -1) {
      // เด้งดาวบนการ์ดต้นทางให้เห็นว่าปักแล้ว
      var p = pinEl.isConnected ? pinEl : null;
      if (p) { p.classList.add("pop"); setTimeout(function () { p.classList.remove("pop"); }, 250); }
    }
  }
  function addRecent(href) {
    if (!href) return;
    recent = [href].concat(recent.filter(function (h) { return h !== href; })).slice(0, 12);
    save(K.recent, recent);
  }

  /* ----- ค้นหา + กรอง ----- */
  function filter() {
    var words = q.value.trim().toLowerCase().split(/\s+/).filter(Boolean);
    var filtering = words.length > 0 || chip !== "all";
    var shown = 0;
    cards.forEach(function (c) {
      var ok = chip === "all" || (chip === "fav" ? isFav(hrefOf(c)) : c._cats.indexOf(chip) > -1);
      if (ok) ok = words.every(function (w) { return c._text.indexOf(w) > -1; });
      c.style.display = ok ? "" : "none";
      if (ok) shown++;
    });
    sections.forEach(function (s) {
      var any = Array.prototype.some.call(s.querySelectorAll(".btn"), function (c) { return c.style.display !== "none"; });
      s.style.display = any ? "" : "none";
      // ตอนค้นหา/กรอง กางทุกหมวดให้เห็นผลลัพธ์ครบ
      var folded = !filtering && collapsed.indexOf(s.getAttribute("data-sec")) > -1;
      s.classList.toggle("collapsed", folded);
      s.querySelector("h2").setAttribute("aria-expanded", folded ? "false" : "true");
    });
    quick.style.display = filtering ? "none" : "";
    empty.textContent = chip === "fav" && !favs.length
      ? "ยังไม่มีรายการโปรด กดรูปดาวบนการ์ดเพื่อปักหมุด"
      : "ไม่พบลิงก์ที่ตรงกับคำค้น";
    empty.style.display = shown ? "none" : "block";
  }

  /* ----- การ์ดที่มองเห็น/กดได้ ตามลำดับบนจอ (รวมรายการโปรดด้านบน) ----- */
  function visibleCards() {
    return Array.prototype.filter.call(document.querySelectorAll(".wrap .btn[href]"), function (c) {
      return c.offsetParent !== null;
    });
  }
  function focusCard(c) {
    if (!c) return;
    c.focus({ preventScroll: true });
    c.scrollIntoView({ block: "nearest", behavior: "smooth" });
  }
  // หาใบถัดไปในแถวบน/ล่าง: แถวที่ใกล้สุด แล้วใบที่ตรงแนวมากสุด
  function cardInRow(from, down) {
    var r = from.getBoundingClientRect(), cx = r.left + r.width / 2, best = null, bestRow = Infinity, bestX = Infinity;
    visibleCards().forEach(function (c) {
      if (c === from) return;
      var cr = c.getBoundingClientRect();
      var gap = down ? cr.top - r.bottom : r.top - cr.bottom;
      if (gap < -2) return;
      var dx = Math.abs(cr.left + cr.width / 2 - cx);
      if (gap < bestRow - 4 || (Math.abs(gap - bestRow) <= 4 && dx < bestX)) { best = c; bestRow = gap; bestX = dx; }
    });
    return best;
  }

  /* ----- เหตุการณ์ ----- */
  document.addEventListener("click", function (e) {
    var pin = e.target.closest(".pin");
    if (pin) {
      e.preventDefault(); e.stopPropagation();
      toggleFav(hrefOf(pin.closest(".btn")), pin);
      return;
    }
    var card = e.target.closest(".btn[href]");
    if (card) addRecent(hrefOf(card));
  });
  document.addEventListener("auxclick", function (e) {
    var card = e.target.closest(".btn[href]");
    if (card && e.button === 1 && !e.target.closest(".pin")) addRecent(hrefOf(card));
  });

  // แสงตามเมาส์บนการ์ด (ใช้กับการ์ดที่สร้างใหม่ในรายการโปรดได้ด้วย)
  document.addEventListener("pointermove", function (e) {
    var c = e.target.closest && e.target.closest(".btn");
    if (!c) return;
    var r = c.getBoundingClientRect();
    c.style.setProperty("--mx", (e.clientX - r.left) + "px");
    c.style.setProperty("--my", (e.clientY - r.top) + "px");
  }, { passive: true });

  q.addEventListener("input", filter);
  q.addEventListener("keydown", function (e) {
    if (e.key === "Escape") { q.value = ""; filter(); q.blur(); }
    if (e.key === "Enter") {
      var first = visibleCards()[0];
      if (first) first.click();
    }
    if (e.key === "ArrowDown") { e.preventDefault(); focusCard(visibleCards()[0]); }
  });

  document.addEventListener("keydown", function (e) {
    if (e.key === "/" && document.activeElement !== q) { e.preventDefault(); q.focus(); return; }

    // Enter/เว้นวรรค บนดาว = ปักหมุด (ไม่เปิดลิงก์)
    var pin = e.target.closest && e.target.closest(".pin");
    if (pin && (e.key === "Enter" || e.key === " ")) {
      e.preventDefault(); e.stopPropagation();
      toggleFav(hrefOf(pin.closest(".btn")), pin);
      return;
    }

    var card = e.target.closest && e.target.closest(".btn[href]");
    if (!card || e.altKey || e.ctrlKey || e.metaKey) return;
    if (e.key === "Escape") { e.preventDefault(); q.focus(); return; }
    var list, i, next = null;
    if (e.key === "ArrowLeft" || e.key === "ArrowRight") {
      list = visibleCards(); i = list.indexOf(card);
      next = list[i + (e.key === "ArrowRight" ? 1 : -1)];
    } else if (e.key === "ArrowDown") {
      next = cardInRow(card, true);
    } else if (e.key === "ArrowUp") {
      next = cardInRow(card, false);
      if (!next) { e.preventDefault(); q.focus(); return; }
    } else return;
    e.preventDefault();
    focusCard(next);
  });

  renderQuick();
  renderChips();
  filter();
  };
})();

// ปุ่มหน้า Active Users: ถาม Apps Script ว่าบัญชีนี้ดูได้ไหม แล้วจำคำตอบไว้ (สิทธิ์จริงตรวจที่ฝั่งนั้น)
function showRoomButton(uid) {
  var room = document.getElementById("room-btn");
  room.onclick = function () { location.href = "./room.html"; };
  try {
    if (localStorage.getItem("hub-room") === uid) { room.hidden = false; return; }
    if (sessionStorage.getItem("hub-room-no") === uid) return;
  } catch (e) {}
  fetchProtectedText(PRESENCE_URL, { action: "view" }).then(function () {
    room.hidden = false;
    try { localStorage.setItem("hub-room", uid); } catch (e) {}
  }).catch(function () {
    try { sessionStorage.setItem("hub-room-no", uid); } catch (e) {}
  });
}

// ===== Firebase: ตรวจสิทธิ์ / Logout / ตัด Session (ดู firebase-guard.js) =====
requireLogin((user) => {
  initCards(user.uid);
  showRoomButton(user.uid);
  if (window.hubStart) window.hubStart();
});
