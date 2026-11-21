/* =====================================================================
   ลูกเล่นส่งท้ายปีเก่า ต้อนรับปีใหม่ 2570 (ชั่วคราว) สำหรับหน้า Access Hub และหน้าเข้าสู่ระบบ
   - เปิดเองอัตโนมัติเฉพาะช่วงวันที่กำหนดใน FESTIVAL.start / FESTIVAL.end
   - ก่อนเที่ยงคืน 31 ธ.ค.: นับถอยหลังสู่ปี 2570 / หลังเที่ยงคืน: "สวัสดีปีใหม่ 2570"
   - ทดลองดูนอกช่วงวันได้ด้วยการเติม ?festival=newyear ท้าย URL
     (เติม &ny=after เพื่อดูแบบหลังเที่ยงคืน)
   - เลิกใช้: ลบบรรทัด <script src="./festival-newyear.js"> ใน Access-Hub.html และ index.html
   - ไม่บังเมาส์/คลิกของหน้าเดิม และเคารพการตั้งค่า "ลดการเคลื่อนไหว" ของเครื่อง
   ===================================================================== */
(function () {
  var FESTIVAL = {
    start:    "2026-12-27T00:00:00+07:00",   // ต่อจากธีมคริสต์มาส
    end:      "2027-01-04T00:00:00+07:00",   // หมดเขตอัตโนมัติ (แสดงถึง 3 ม.ค.)
    midnight: "2027-01-01T00:00:00+07:00",   // เวลาเปลี่ยนปี (เวลาไทย)
    year:     "2570"
  };

  var forced = window.NY_FORCE === true || /[?&]festival=newyear\b/.test(location.search);
  var now = Date.now();
  if (!forced && (now < Date.parse(FESTIVAL.start) || now >= Date.parse(FESTIVAL.end))) return;

  var HIDE_KEY = "festival-newyear-2570-hidden";
  try { if (!forced && sessionStorage.getItem(HIDE_KEY) === "1") return; } catch (e) {}

  var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;
  var previewAfter = forced && /[?&]ny=after\b/.test(location.search);
  var midnight = Date.parse(FESTIVAL.midnight);
  function isNewYear() { return previewAfter || Date.now() >= midnight; }

  var css = [
    ":root{--ny-gold:#e0a526;--ny-sky:rgba(40,60,140,.14)}",
    ":root[data-theme='dark']{--ny-sky:rgba(60,80,180,.22)}",
    ".ny-layer{position:fixed;inset:0;pointer-events:none;z-index:-1;overflow:hidden}",
    ".ny-sky{position:absolute;inset:0;background:radial-gradient(1200px 600px at 50% -15%,var(--ny-sky),transparent 70%)}",
    ".ny-canvas{position:fixed;inset:0;width:100%;height:100%;pointer-events:none;z-index:0}",
    ".ny-banner{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:-28px 0 34px;padding:12px 14px 12px 16px;",
    "border:1px solid var(--line,#e2e2de);border-radius:14px;background:var(--surface,#fff);box-shadow:var(--shadow,0 8px 24px -10px rgba(0,0,0,.18));position:relative;z-index:1;",
    "background-image:linear-gradient(90deg,rgba(224,165,38,.14),transparent 60%)}",
    ".ny-banner .ny-ico{font-size:1.6rem;line-height:1}",
    ".ny-banner .ny-txt{flex:1;min-width:180px}.ny-banner.ny-compact{margin:16px 24px 0;box-shadow:none}.ny-banner.ny-compact .ny-txt{min-width:140px}",
    ".ny-banner b{display:block;font-weight:600;font-size:1rem;color:var(--ny-gold)}",
    ".ny-banner small{display:block;color:var(--muted,#7a7a75);font-weight:300;font-size:.82rem;font-variant-numeric:tabular-nums}",
    ".ny-count{display:flex;gap:6px;margin-top:6px}",
    ".ny-count span{min-width:44px;padding:4px 6px;border-radius:8px;text-align:center;background:rgba(224,165,38,.12);font-variant-numeric:tabular-nums;line-height:1.1}",
    ".ny-count span i{display:block;font-style:normal;font-weight:700;font-size:1rem;color:var(--text,#1a1a1a)}",
    ".ny-count span em{display:block;font-style:normal;font-size:.68rem;color:var(--muted,#7a7a75)}",
    ".ny-btn{font:inherit;font-size:.85rem;font-weight:500;height:36px;padding:0 14px;border-radius:999px;cursor:pointer;",
    "border:1px solid var(--ny-gold);background:var(--ny-gold);color:#fff;transition:transform .2s}",
    ".ny-btn:hover{transform:translateY(-1px)}.ny-btn:active{transform:scale(.97)}",
    ".ny-x{font:inherit;width:32px;height:32px;border-radius:50%;border:1px solid var(--line,#e2e2de);background:transparent;color:var(--muted,#7a7a75);cursor:pointer}",
    ".ny-x:hover{color:var(--text,#1a1a1a);border-color:var(--muted,#7a7a75)}",
    ".ny-msg{position:fixed;left:50%;bottom:40px;transform:translateX(-50%);z-index:4;font-size:.85rem;padding:6px 14px;border-radius:999px;",
    "background:var(--surface,#fff);border:1px solid var(--line,#e2e2de);box-shadow:var(--shadow,0 8px 24px -10px rgba(0,0,0,.18));opacity:0;transition:opacity .4s;pointer-events:none;white-space:nowrap}",
    ".ny-msg.show{opacity:1}",
    "@media(max-width:520px){.ny-banner{margin-top:-16px}.ny-msg{white-space:normal;text-align:center;width:max-content;max-width:90vw}}"
  ].join("");

  var style = document.createElement("style");
  style.id = "ny-style";
  style.textContent = css;
  document.head.appendChild(style);

  /* ---------------- พลุ (canvas) ---------------- */
  var canvas, ctx, parts = [], rafId = null, autoTimer = null, W = 0, H = 0, dpr = 1;
  var COLORS = ["#ffd54a", "#ff6b6b", "#6bc3ff", "#b07cff", "#5ee0a0", "#ffffff", "#ff9f43"];
  function resize() {
    dpr = Math.min(2, window.devicePixelRatio || 1);
    W = window.innerWidth; H = window.innerHeight;
    canvas.width = W * dpr; canvas.height = H * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }
  function burst(x, y, big) {
    var color = COLORS[Math.floor(Math.random() * COLORS.length)];
    var n = big ? 70 : 46, speed = big ? 4.2 : 3.2;
    for (var i = 0; i < n; i++) {
      var a = (Math.PI * 2 * i) / n + Math.random() * .1, v = speed * (.55 + Math.random() * .45);
      parts.push({ x: x, y: y, vx: Math.cos(a) * v, vy: Math.sin(a) * v, life: 1, decay: .012 + Math.random() * .01,
                   color: Math.random() < .2 ? "#ffffff" : color, r: 1.4 + Math.random() * 1.2 });
    }
    if (!rafId) rafId = requestAnimationFrame(tick);
  }
  function tick() {
    ctx.clearRect(0, 0, W, H);
    for (var i = parts.length - 1; i >= 0; i--) {
      var p = parts[i];
      p.vx *= .985; p.vy = p.vy * .985 + .045; p.x += p.vx; p.y += p.vy; p.life -= p.decay;
      if (p.life <= 0) { parts.splice(i, 1); continue; }
      ctx.globalAlpha = Math.max(0, p.life) * .9;
      ctx.fillStyle = p.color;
      ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, Math.PI * 2); ctx.fill();
    }
    ctx.globalAlpha = 1;
    rafId = parts.length ? requestAnimationFrame(tick) : null;
  }
  // จุดพลุบนท้องฟ้าส่วนบน (สูงกว่าเนื้อหาหลัก) เป็นระยะ ๆ
  function randomBurst(big) { burst(W * (.1 + Math.random() * .8), H * (.08 + Math.random() * .3), big); }
  function scheduleAuto() {
    autoTimer = setTimeout(function () {
      if (!document.hidden) randomBurst(false);
      scheduleAuto();
    }, (isNewYear() ? 1600 : 3200) + Math.random() * 2400);
  }

  function pad(n) { return (n < 10 ? "0" : "") + n; }

  function build() {
    var layer = document.createElement("div");
    layer.className = "ny-layer";
    layer.setAttribute("aria-hidden", "true");
    layer.innerHTML = '<div class="ny-sky"></div>';
    document.body.insertBefore(layer, document.body.firstChild);

    if (!still) {
      canvas = document.createElement("canvas");
      canvas.className = "ny-canvas";
      canvas.setAttribute("aria-hidden", "true");
      ctx = canvas.getContext("2d");
      document.body.appendChild(canvas);
      resize();
      window.addEventListener("resize", resize);
      setTimeout(function () { randomBurst(true); }, 600);
      scheduleAuto();
    }

    var slot = document.querySelector("[data-lk-banner]");
    var header = slot ? null : document.querySelector("header");
    var banner = document.createElement("div");
    banner.className = "ny-banner" + (slot ? " ny-compact" : "");
    banner.innerHTML =
      '<span class="ny-ico" aria-hidden="true">🎆</span>' +
      '<div class="ny-txt"><b class="ny-title"></b><small class="ny-sub"></small><div class="ny-count"></div></div>' +
      (still ? "" : '<button type="button" class="ny-btn">จุดพลุ 🎇</button>') +
      '<button type="button" class="ny-x" aria-label="ซ่อนลูกเล่นเทศกาล" title="ซ่อนลูกเล่นเทศกาล">✕</button>';
    if (slot) slot.appendChild(banner);
    else if (header && header.parentNode) header.parentNode.insertBefore(banner, header.nextSibling);

    var titleEl = banner.querySelector(".ny-title"), subEl = banner.querySelector(".ny-sub"), countEl = banner.querySelector(".ny-count");
    var wasNewYear = null, clockTimer;
    function render() {
      var ny = isNewYear();
      if (ny !== wasNewYear) {
        var crossedMidnight = wasNewYear === false && ny;   // เปิดหน้าค้างไว้จนถึงเที่ยงคืนพอดี
        wasNewYear = ny;
        if (ny) {
          titleEl.textContent = "สวัสดีปีใหม่ " + FESTIVAL.year + " 🎉";
          subEl.textContent = "Happy New Year 2027 · ขอให้ปีนี้งานราบรื่น สุขภาพแข็งแรง";
          countEl.style.display = "none";
          if (!still && crossedMidnight && canvas) { for (var k = 0; k < 6; k++) setTimeout(function () { randomBurst(true); }, k * 350); }
        } else {
          titleEl.textContent = "ส่งท้ายปีเก่า ต้อนรับปีใหม่ " + FESTIVAL.year;
          subEl.textContent = "นับถอยหลังสู่เที่ยงคืน 31 ธันวาคม (เวลาไทย)";
          countEl.style.display = "";
        }
      }
      if (!ny) {
        var ms = Math.max(0, midnight - Date.now()), s = Math.floor(ms / 1000);
        var d = Math.floor(s / 86400), h = Math.floor(s % 86400 / 3600), m = Math.floor(s % 3600 / 60), sec = s % 60;
        countEl.innerHTML = '<span><i>' + d + '</i><em>วัน</em></span><span><i>' + pad(h) + '</i><em>ชม.</em></span>' +
                            '<span><i>' + pad(m) + '</i><em>นาที</em></span><span><i>' + pad(sec) + '</i><em>วินาที</em></span>';
      }
    }
    render();
    clockTimer = setInterval(render, 1000);

    var wishes = ["ขอให้ปีใหม่ไม่มีเคสค้าง", "ขอให้ GPS ออนไลน์ครบทุกคันตลอดปี", "ขอให้ทุกเที่ยววิ่งถึงปลายทางปลอดภัย",
                  "ขอให้ระบบเสถียรตลอดปี", "ขอให้สุขภาพแข็งแรงทั้งทีม", "ขอให้โบนัสมาเต็ม ๆ"];
    var msg = document.createElement("div");
    msg.className = "ny-msg";
    document.body.appendChild(msg);
    var msgTimer;
    var btn = banner.querySelector(".ny-btn");
    if (btn) btn.addEventListener("click", function () {
      for (var k = 0; k < 3; k++) setTimeout(function () { randomBurst(true); }, k * 250);
      msg.textContent = "🎆 " + wishes[Math.floor(Math.random() * wishes.length)];
      msg.classList.add("show");
      clearTimeout(msgTimer);
      msgTimer = setTimeout(function () { msg.classList.remove("show"); }, 2800);
    });

    banner.querySelector(".ny-x").addEventListener("click", function () {
      try { sessionStorage.setItem(HIDE_KEY, "1"); } catch (e) {}
      clearInterval(clockTimer); clearTimeout(autoTimer);
      if (rafId) cancelAnimationFrame(rafId);
      window.removeEventListener("resize", resize);
      [layer, canvas, banner, msg, style].forEach(function (el) { if (el) el.remove(); });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
