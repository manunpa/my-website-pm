/* =====================================================================
   ลูกเล่นเทศกาลลอยกระทง (ชั่วคราว) สำหรับหน้า Access Hub และหน้าเข้าสู่ระบบ
   - เปิดเองอัตโนมัติเฉพาะช่วงวันที่กำหนดใน FESTIVAL.start / FESTIVAL.end
   - ทดลองดูนอกช่วงวันได้ด้วยการเติม ?festival=loykrathong ท้าย URL
   - เลิกใช้: ลบบรรทัด <script src="./festival-loykrathong.js"> ใน Access-Hub.html และ index.html
   - ไม่บังเมาส์/คลิกของหน้าเดิม และเคารพการตั้งค่า "ลดการเคลื่อนไหว" ของเครื่อง
   ===================================================================== */
(function () {
  var FESTIVAL = {
    start: "2026-11-20T00:00:00+07:00",
    end:   "2026-11-25T00:00:00+07:00",   // หมดเขตอัตโนมัติ (ไม่รวมวันนี้) ต่อด้วยธีมงานวิ่ง ATM
    title: "สุขสันต์วันลอยกระทง",
    sub:   "อังคารที่ 24 พฤศจิกายน 2569 · คืนวันเพ็ญเดือนสิบสอง"
  };

  var forced = window.LK_FORCE === true || /[?&]festival=loykrathong\b/.test(location.search);
  var now = Date.now();
  if (!forced && (now < Date.parse(FESTIVAL.start) || now >= Date.parse(FESTIVAL.end))) return;

  var HIDE_KEY = "festival-loykrathong-2569-hidden";
  try { if (!forced && sessionStorage.getItem(HIDE_KEY) === "1") return; } catch (e) {}

  var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- CSS ---------------- */
  var css = [
    ":root{--lk-water1:rgba(40,92,140,.55);--lk-water2:rgba(22,58,98,.8);--lk-moon:#fff6d8;--lk-glow:rgba(255,226,150,.55);--lk-sky:rgba(255,214,150,.18)}",
    ":root[data-theme='dark']{--lk-water1:rgba(52,110,170,.45);--lk-water2:rgba(14,36,66,.92);--lk-glow:rgba(255,226,150,.38);--lk-sky:rgba(40,70,140,.22)}",
    "body.lk-on{padding-bottom:110px}",
    ".lk-layer{position:fixed;inset:0;pointer-events:none;z-index:-1;overflow:hidden}",
    ".lk-sky{position:absolute;inset:0;background:radial-gradient(900px 520px at 88% -8%,var(--lk-sky),transparent 70%)}",
    ".lk-moon{position:absolute;top:34px;right:6vw;width:92px;height:92px;border-radius:50%;",
    "background:radial-gradient(circle at 38% 36%,#fffdf3 0 30%,var(--lk-moon) 62%,#f3e2ad 100%);",
    "box-shadow:0 0 40px 10px var(--lk-glow),0 0 120px 40px var(--lk-glow);opacity:.95}",
    ".lk-moon::before,.lk-moon::after{content:'';position:absolute;border-radius:50%;background:rgba(214,190,130,.28)}",
    ".lk-moon::before{width:18px;height:14px;top:28px;left:24px}.lk-moon::after{width:11px;height:10px;top:54px;left:52px}",
    ".lk-lantern{position:absolute;bottom:-60px;width:20px;height:26px;border-radius:7px 7px 9px 9px;",
    "background:linear-gradient(#ffcf7a,#ff8f3a);box-shadow:0 0 18px 6px rgba(255,160,70,.45);opacity:0;",
    "animation:lk-rise linear infinite}",
    ".lk-lantern::after{content:'';position:absolute;left:50%;bottom:3px;width:6px;height:6px;margin-left:-3px;border-radius:50%;background:#fff3c4}",
    "@keyframes lk-rise{0%{transform:translate(0,0) scale(1);opacity:0}8%{opacity:.9}50%{transform:translate(var(--sway),-55vh) scale(.75)}",
    "85%{opacity:.6}100%{transform:translate(0,-105vh) scale(.45);opacity:0}}",
    /* น้ำ */
    ".lk-water{position:fixed;left:0;right:0;bottom:0;height:96px;pointer-events:none;z-index:3}",
    ".lk-wave{position:absolute;left:0;bottom:0;width:200%;height:100%;animation:lk-flow linear infinite}",
    ".lk-wave svg{display:block;width:100%;height:100%}",
    ".lk-wave.w1{animation-duration:26s;opacity:.85}.lk-wave.w2{animation-duration:17s;animation-direction:reverse;bottom:-10px}",
    "@keyframes lk-flow{to{transform:translateX(-50%)}}",
    /* กระทง */
    ".lk-k{position:absolute;bottom:34px;left:0;width:58px;height:58px;animation:lk-drift linear forwards}",
    ".lk-k .bob{width:100%;height:100%;animation:lk-bob 3.2s ease-in-out infinite}",
    ".lk-k svg{width:100%;height:100%;overflow:visible}",
    ".lk-k .flame{transform-origin:29px 15px;animation:lk-flick .18s ease-in-out infinite alternate}",
    ".lk-k .halo{animation:lk-halo 1.6s ease-in-out infinite alternate}",
    "@keyframes lk-drift{from{transform:translateX(-80px)}to{transform:translateX(calc(100vw + 80px))}}",
    "@keyframes lk-bob{0%,100%{transform:translateY(0) rotate(-3deg)}50%{transform:translateY(-6px) rotate(3deg)}}",
    "@keyframes lk-flick{from{transform:scale(1,1)}to{transform:scale(.88,1.12)}}",
    "@keyframes lk-halo{from{opacity:.55}to{opacity:.95}}",
    /* แบนเนอร์ */
    ".lk-banner{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:-28px 0 34px;padding:12px 14px 12px 16px;",
    "border:1px solid var(--line,#e2e2de);border-radius:14px;background:var(--surface,#fff);box-shadow:var(--shadow,0 8px 24px -10px rgba(0,0,0,.18));position:relative;z-index:1}",
    ".lk-banner .lk-ico{font-size:1.6rem;line-height:1}",
    ".lk-banner .lk-txt{flex:1;min-width:180px}.lk-banner.lk-compact{margin:16px 24px 0;box-shadow:none}.lk-banner.lk-compact .lk-txt{min-width:140px}",
    ".lk-banner b{display:block;font-weight:600;font-size:1rem}",
    ".lk-banner small{display:block;color:var(--muted,#7a7a75);font-weight:300;font-size:.82rem}",
    ".lk-btn{font:inherit;font-size:.85rem;font-weight:500;height:36px;padding:0 14px;border-radius:999px;cursor:pointer;",
    "border:1px solid var(--accent,#1a1a1a);background:var(--accent,#1a1a1a);color:var(--accent-text,#fff);transition:transform .2s}",
    ".lk-btn:hover{transform:translateY(-1px)}.lk-btn:active{transform:scale(.97)}",
    ".lk-x{font:inherit;width:32px;height:32px;border-radius:50%;border:1px solid var(--line,#e2e2de);background:transparent;color:var(--muted,#7a7a75);cursor:pointer}",
    ".lk-x:hover{color:var(--text,#1a1a1a);border-color:var(--muted,#7a7a75)}",
    ".lk-wish{position:fixed;left:50%;bottom:112px;transform:translateX(-50%);z-index:4;font-size:.85rem;padding:6px 14px;border-radius:999px;",
    "background:var(--surface,#fff);border:1px solid var(--line,#e2e2de);box-shadow:var(--shadow,0 8px 24px -10px rgba(0,0,0,.18));opacity:0;transition:opacity .4s;pointer-events:none}",
    ".lk-wish.show{opacity:1}",
    "@media(max-width:520px){.lk-moon{width:62px;height:62px;top:18px}.lk-banner{margin-top:-16px}.lk-k{width:46px;height:46px}}",
    "@media(prefers-reduced-motion:reduce){.lk-lantern{display:none}}"
  ].join("");

  var style = document.createElement("style");
  style.id = "lk-style";
  style.textContent = css;
  document.head.appendChild(style);

  /* ---------------- กระทง (SVG วาดเอง) ---------------- */
  var KRATHONG =
    '<svg viewBox="0 0 58 58" aria-hidden="true">' +
      '<defs><radialGradient id="lk-halo"><stop offset="0" stop-color="#ffd27a" stop-opacity=".75"/><stop offset="1" stop-color="#ffd27a" stop-opacity="0"/></radialGradient></defs>' +
      '<circle class="halo" cx="29" cy="15" r="15" fill="url(#lk-halo)"/>' +
      // ฐานใบตอง
      '<path d="M6 40 L52 40 L46 50 Q29 55 12 50 Z" fill="#3f8a3a"/>' +
      '<path d="M6 40 l4 -4 4 4 4 -4 4 4 4 -4 4 4 4 -4 4 4 4 -4 4 4 4 -4 2 4" fill="#5aa84f"/>' +
      // กลีบบัว
      '<path d="M10 40 Q12 28 20 30 Q18 36 20 40 Z" fill="#f7b6c8"/>' +
      '<path d="M48 40 Q46 28 38 30 Q40 36 38 40 Z" fill="#f7b6c8"/>' +
      '<path d="M17 40 Q18 25 26 27 Q24 34 25 40 Z" fill="#fbd3df"/>' +
      '<path d="M41 40 Q40 25 32 27 Q34 34 33 40 Z" fill="#fbd3df"/>' +
      '<path d="M23 40 Q24 26 29 23 Q34 26 35 40 Z" fill="#fde8ee"/>' +
      // ธูป
      '<line x1="21" y1="30" x2="18" y2="14" stroke="#8a5a2b" stroke-width="1.2"/>' +
      '<line x1="37" y1="30" x2="40" y2="14" stroke="#8a5a2b" stroke-width="1.2"/>' +
      '<circle cx="18" cy="14" r="1.2" fill="#ff7a3a"/><circle cx="40" cy="14" r="1.2" fill="#ff7a3a"/>' +
      // เทียน
      '<rect x="27" y="20" width="4" height="10" rx="1" fill="#fff4d6"/>' +
      '<path class="flame" d="M29 9 Q32.5 14 29 19 Q25.5 14 29 9 Z" fill="#ffb238"/>' +
      '<path d="M29 13 Q30.5 15.5 29 18 Q27.5 15.5 29 13 Z" fill="#fff1b8"/>' +
    '</svg>';

  function waveSvg(fill, d) {
    return '<svg viewBox="0 0 1440 96" preserveAspectRatio="none"><path fill="' + fill + '" d="' + d + '"/></svg>';
  }
  var WAVE_A = "M0 30 C120 10 240 50 360 30 S600 10 720 30 S960 50 1080 30 S1320 10 1440 30 V96 H0 Z";
  var WAVE_B = "M0 46 C160 30 320 62 480 46 S800 30 960 46 S1280 62 1440 46 V96 H0 Z";

  /* ---------------- สร้างฉาก ---------------- */
  function build() {
    document.body.classList.add("lk-on");

    var layer = document.createElement("div");
    layer.className = "lk-layer";
    layer.setAttribute("aria-hidden", "true");
    layer.innerHTML = '<div class="lk-sky"></div><div class="lk-moon"></div>';
    document.body.insertBefore(layer, document.body.firstChild);

    if (!still) {
      for (var i = 0; i < 7; i++) {
        var l = document.createElement("span");
        l.className = "lk-lantern";
        l.style.left = (8 + Math.random() * 84) + "vw";
        l.style.setProperty("--sway", (Math.random() * 60 - 30) + "px");
        l.style.animationDuration = (18 + Math.random() * 14) + "s";
        l.style.animationDelay = (-Math.random() * 30) + "s";
        layer.appendChild(l);
      }
    }

    var water = document.createElement("div");
    water.className = "lk-water";
    water.setAttribute("aria-hidden", "true");
    var tile = function (d, f) { var s = waveSvg(f, d); return s + s; };
    water.innerHTML =
      '<div class="lk-wave w1">' + tile(WAVE_A, "var(--lk-water1)").replace(/<svg /g, '<svg style="width:50%;float:left" ') + '</div>' +
      '<div class="lk-krathongs"></div>' +
      '<div class="lk-wave w2">' + tile(WAVE_B, "var(--lk-water2)").replace(/<svg /g, '<svg style="width:50%;float:left" ') + '</div>';
    document.body.appendChild(water);

    var pond = water.querySelector(".lk-krathongs");
    function launch(initial) {
      var k = document.createElement("div");
      k.className = "lk-k";
      var dur = 38 + Math.random() * 26;
      k.style.animationDuration = dur + "s";
      if (initial) k.style.animationDelay = (-Math.random() * dur) + "s";
      k.style.bottom = (26 + Math.random() * 16) + "px";
      k.innerHTML = '<div class="bob" style="animation-delay:' + (-Math.random() * 3) + 's">' + KRATHONG + "</div>";
      k.addEventListener("animationend", function (e) { if (e.target === k) k.remove(); });
      pond.appendChild(k);
      return k;
    }
    if (still) {
      // โหมดลดการเคลื่อนไหว: วางกระทงนิ่ง ๆ 3 ใบ
      [18, 50, 78].forEach(function (x) {
        var k = launch(false);
        k.style.animation = "none";
        k.style.transform = "translateX(" + x + "vw)";
      });
    } else {
      for (var j = 0; j < 4; j++) launch(true);
      setInterval(function () { if (pond.children.length < 7) launch(false); }, 9000);
    }

    // แบนเนอร์ใต้หัวข้อ
    // ตำแหน่งแบนเนอร์: ถ้าหน้าไหนมี <div data-lk-banner> จะวางตรงนั้น ไม่งั้นวางใต้ <header>
    var slot = document.querySelector("[data-lk-banner]");
    var header = slot ? null : document.querySelector("header");
    var banner = document.createElement("div");
    banner.className = "lk-banner" + (slot ? " lk-compact" : "");
    banner.innerHTML =
      '<span class="lk-ico" aria-hidden="true">🪷</span>' +
      '<div class="lk-txt"><b>' + FESTIVAL.title + '</b><small>' + FESTIVAL.sub + '</small></div>' +
      (still ? "" : '<button type="button" class="lk-btn">ลอยกระทง</button>') +
      '<button type="button" class="lk-x" aria-label="ซ่อนลูกเล่นเทศกาล" title="ซ่อนลูกเล่นเทศกาล">✕</button>';
    if (slot) slot.appendChild(banner);
    else if (header && header.parentNode) header.parentNode.insertBefore(banner, header.nextSibling);

    var wishes = ["ขอให้งานราบรื่น ไม่มีเคสค้าง", "ขอให้ GPS ออนไลน์ครบทุกคัน", "ขอให้ทุกเที่ยววิ่งถึงปลายทางปลอดภัย",
                  "ลอยความเหนื่อยไปกับสายน้ำ", "ขอให้ระบบไม่ล่มตลอดปี", "ขอให้สุขภาพแข็งแรงทั้งทีม"];
    var wish = document.createElement("div");
    wish.className = "lk-wish";
    document.body.appendChild(wish);
    var wishTimer;
    var btn = banner.querySelector(".lk-btn");
    if (btn) btn.addEventListener("click", function () {
      launch(false).style.animationDuration = "30s";
      wish.textContent = "🪷 " + wishes[Math.floor(Math.random() * wishes.length)];
      wish.classList.add("show");
      clearTimeout(wishTimer);
      wishTimer = setTimeout(function () { wish.classList.remove("show"); }, 2600);
    });

    banner.querySelector(".lk-x").addEventListener("click", function () {
      try { sessionStorage.setItem(HIDE_KEY, "1"); } catch (e) {}
      [layer, water, banner, wish, style].forEach(function (n) { n.remove(); });
      document.body.classList.remove("lk-on");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
