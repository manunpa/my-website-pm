/* =====================================================================
   ลูกเล่นคริสต์มาส (ชั่วคราว) สำหรับหน้า Access Hub และหน้าเข้าสู่ระบบ
   - เปิดเองอัตโนมัติเฉพาะช่วงวันที่กำหนดใน FESTIVAL.start / FESTIVAL.end
   - ทดลองดูนอกช่วงวันได้ด้วยการเติม ?festival=christmas ท้าย URL
   - เลิกใช้: ลบบรรทัด <script src="./festival-christmas.js"> ใน Access-Hub.html และ index.html
   - ไม่บังเมาส์/คลิกของหน้าเดิม และเคารพการตั้งค่า "ลดการเคลื่อนไหว" ของเครื่อง
   ===================================================================== */
(function () {
  var FESTIVAL = {
    start: "2026-12-06T00:00:00+07:00",   // ต่อจากธีมวันพ่อ (4–5 ธ.ค.)
    end:   "2026-12-27T00:00:00+07:00",   // หมดเขตอัตโนมัติ (แสดง 6–26 ธ.ค. ยกเว้นช่วง SKIP) ต่อด้วยธีมปีใหม่
    title: "Merry Christmas 🎄",
    sub:   "สุขสันต์วันคริสต์มาส · ศุกร์ที่ 25 ธันวาคม 2569"
  };

  var forced = window.XM_FORCE === true || /[?&]festival=christmas\b/.test(location.search);
  var now = Date.now();
  if (!forced && (now < Date.parse(FESTIVAL.start) || now >= Date.parse(FESTIVAL.end))) return;
  // หยุดชั่วคราวช่วงที่มีธีมอื่นแทรกคิว: 19–20 ธ.ค. งานวิ่ง Bangsaen21 (festival-bangsaen21.js)
  var SKIP = [["2026-12-19T00:00:00+07:00", "2026-12-21T00:00:00+07:00"]];
  if (!forced && SKIP.some(function (s) { return now >= Date.parse(s[0]) && now < Date.parse(s[1]); })) return;

  var HIDE_KEY = "festival-christmas-2569-hidden";
  try { if (!forced && sessionStorage.getItem(HIDE_KEY) === "1") return; } catch (e) {}

  var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  var css = [
    /* โหมดสว่าง: หิมะสีฟ้าอ่อน (สีขาวล้วนจะกลืนกับพื้นหลังขาว) / โหมดมืด: หิมะขาว */
    ":root{--xm-red:#d6394b;--xm-green:#1f8a54;--xm-snow:#b9d3f0;--xm-flake-glow:rgba(80,130,200,.55);--xm-ground:#dfeaf7;--xm-sky:rgba(120,170,230,.16)}",
    ":root[data-theme='dark']{--xm-snow:#ffffff;--xm-flake-glow:rgba(160,190,230,.9);--xm-ground:#e9f0f8;--xm-sky:rgba(90,140,220,.18)}",
    "body.xm-on{padding-bottom:84px}",
    ".xm-layer{position:fixed;inset:0;pointer-events:none;z-index:-1;overflow:hidden}",
    ".xm-sky{position:absolute;inset:0;background:radial-gradient(900px 500px at 15% -10%,var(--xm-sky),transparent 70%)}",
    /* หิมะ: ลอยอยู่หน้าเนื้อหาแต่ไม่บังคลิก */
    ".xm-snowfall{position:fixed;inset:0;pointer-events:none;z-index:2;overflow:hidden}",
    ".xm-flake{position:absolute;top:-12px;border-radius:50%;background:var(--xm-snow);opacity:.85;box-shadow:0 0 4px var(--xm-flake-glow);",
    "animation:xm-fall linear infinite}",
    "@keyframes xm-fall{0%{transform:translate(0,-12px)}50%{transform:translate(var(--drift),50vh)}100%{transform:translate(0,105vh)}}",
    /* กองหิมะด้านล่าง + ต้นคริสต์มาส */
    ".xm-ground{position:fixed;left:0;right:0;bottom:0;height:80px;pointer-events:none;z-index:3}",
    ".xm-ground svg.snow{position:absolute;left:0;bottom:0;width:100%;height:44px}",
    ".xm-tree{position:absolute;right:4vw;bottom:14px;width:86px;height:110px}",
    ".xm-tree svg{width:100%;height:100%;overflow:visible}",
    ".xm-tree .bulb{animation:xm-twinkle 1.4s ease-in-out infinite alternate}",
    ".xm-tree .star{transform-origin:43px 10px;animation:xm-star 2.4s ease-in-out infinite}",
    "@keyframes xm-twinkle{from{opacity:.35}to{opacity:1}}",
    "@keyframes xm-star{0%,100%{transform:scale(1)}50%{transform:scale(1.18)}}",
    ".xm-gift{position:absolute;bottom:14px;width:30px;height:28px}",
    /* แบนเนอร์ */
    ".xm-banner{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:-28px 0 34px;padding:12px 14px 12px 16px;",
    "border:1px solid var(--line,#e2e2de);border-radius:14px;background:var(--surface,#fff);box-shadow:var(--shadow,0 8px 24px -10px rgba(0,0,0,.18));position:relative;z-index:1;",
    "background-image:linear-gradient(90deg,rgba(214,57,75,.10),rgba(31,138,84,.06) 50%,transparent 75%)}",
    ".xm-banner .xm-ico{font-size:1.6rem;line-height:1}",
    ".xm-banner .xm-txt{flex:1;min-width:180px}.xm-banner.xm-compact{margin:16px 24px 0;box-shadow:none}.xm-banner.xm-compact .xm-txt{min-width:140px}",
    ".xm-banner b{display:block;font-weight:600;font-size:1rem;color:var(--xm-red)}",
    ".xm-banner small{display:block;color:var(--muted,#7a7a75);font-weight:300;font-size:.82rem}",
    ".xm-btn{font:inherit;font-size:.85rem;font-weight:500;height:36px;padding:0 14px;border-radius:999px;cursor:pointer;",
    "border:1px solid var(--xm-green);background:var(--xm-green);color:#fff;transition:transform .2s}",
    ".xm-btn:hover{transform:translateY(-1px)}.xm-btn:active{transform:scale(.97)}",
    ".xm-x{font:inherit;width:32px;height:32px;border-radius:50%;border:1px solid var(--line,#e2e2de);background:transparent;color:var(--muted,#7a7a75);cursor:pointer}",
    ".xm-x:hover{color:var(--text,#1a1a1a);border-color:var(--muted,#7a7a75)}",
    ".xm-msg{position:fixed;left:50%;bottom:96px;transform:translateX(-50%);z-index:4;font-size:.85rem;padding:6px 14px;border-radius:999px;",
    "background:var(--surface,#fff);border:1px solid var(--line,#e2e2de);box-shadow:var(--shadow,0 8px 24px -10px rgba(0,0,0,.18));opacity:0;transition:opacity .4s;pointer-events:none;white-space:nowrap}",
    ".xm-msg.show{opacity:1}",
    ".xm-pop{position:fixed;z-index:4;pointer-events:none;font-size:18px;animation:xm-pop 1.4s ease-out forwards}",
    "@keyframes xm-pop{0%{transform:translate(0,0) scale(.6);opacity:1}100%{transform:translate(var(--dx),var(--dy)) scale(1);opacity:0}}",
    "@media(max-width:520px){.xm-banner{margin-top:-16px}.xm-tree{width:64px;height:82px}.xm-msg{white-space:normal;text-align:center;width:max-content;max-width:90vw}}",
    "@media(prefers-reduced-motion:reduce){.xm-snowfall{display:none}.xm-tree .bulb,.xm-tree .star{animation:none}}"
  ].join("");

  var style = document.createElement("style");
  style.id = "xm-style";
  style.textContent = css;
  document.head.appendChild(style);

  var BULBS = [[30,40,"#ffd54a"],[52,48,"#ff6b6b"],[38,60,"#6bc3ff"],[58,70,"#ffd54a"],[26,78,"#ff6b6b"],[46,84,"#6bc3ff"],[64,88,"#ffd54a"],[34,92,"#6bc3ff"]];
  var TREE =
    '<svg viewBox="0 0 86 110" aria-hidden="true">' +
      '<rect x="37" y="92" width="12" height="14" rx="2" fill="#7a4b2a"/>' +
      '<path d="M43 14 L14 56 H28 L8 82 H24 L4 98 H82 L62 82 H78 L58 56 H72 Z" fill="var(--xm-green)"/>' +
      '<path d="M43 14 L30 34 Q43 40 56 34 Z" fill="#2aa868" opacity=".6"/>' +
      BULBS.map(function (b, i) { return '<circle class="bulb" cx="' + b[0] + '" cy="' + b[1] + '" r="3.2" fill="' + b[2] + '" style="animation-delay:' + (i * .23).toFixed(2) + 's"/>'; }).join("") +
      '<path class="star" d="M43 2 L46 9 L53 9.5 L47.5 14 L49.5 21 L43 17 L36.5 21 L38.5 14 L33 9.5 L40 9 Z" fill="#ffd54a"/>' +
    '</svg>';
  function gift(color, ribbon) {
    return '<svg viewBox="0 0 30 28" aria-hidden="true"><rect x="2" y="9" width="26" height="18" rx="2" fill="' + color + '"/>' +
      '<rect x="1" y="6" width="28" height="6" rx="2" fill="' + color + '" opacity=".85"/>' +
      '<rect x="13" y="6" width="4" height="21" fill="' + ribbon + '"/><path d="M15 6 C10 0 5 3 9 6 Z M15 6 C20 0 25 3 21 6 Z" fill="' + ribbon + '"/></svg>';
  }
  var SNOW_A = "M0 26 C120 12 240 30 360 20 S600 8 720 22 S960 34 1080 20 S1320 10 1440 22 V44 H0 Z";

  function build() {
    document.body.classList.add("xm-on");

    var layer = document.createElement("div");
    layer.className = "xm-layer";
    layer.setAttribute("aria-hidden", "true");
    layer.innerHTML = '<div class="xm-sky"></div>';
    document.body.insertBefore(layer, document.body.firstChild);

    var snowfall = document.createElement("div");
    snowfall.className = "xm-snowfall";
    snowfall.setAttribute("aria-hidden", "true");
    if (!still) {
      var flakes = "";
      var n = Math.min(60, Math.max(24, Math.round(window.innerWidth / 24)));
      for (var i = 0; i < n; i++) {
        var size = (2 + Math.random() * 4).toFixed(1);
        flakes += '<span class="xm-flake" style="left:' + (Math.random() * 100).toFixed(2) + 'vw;width:' + size + 'px;height:' + size +
          'px;--drift:' + (Math.random() * 60 - 30).toFixed(0) + 'px;animation-duration:' + (9 + Math.random() * 10).toFixed(1) +
          's;animation-delay:' + (-Math.random() * 19).toFixed(1) + 's;opacity:' + (.5 + Math.random() * .45).toFixed(2) + '"></span>';
      }
      snowfall.innerHTML = flakes;
    }
    document.body.appendChild(snowfall);

    var ground = document.createElement("div");
    ground.className = "xm-ground";
    ground.setAttribute("aria-hidden", "true");
    ground.innerHTML =
      '<svg class="snow" viewBox="0 0 1440 44" preserveAspectRatio="none"><path d="' + SNOW_A + '" fill="var(--xm-ground)" stroke="#c4d6ec" stroke-width="1.5"/></svg>' +
      '<div class="xm-tree">' + TREE + '</div>' +
      '<div class="xm-gift" style="right:calc(4vw + 84px)">' + gift("#d6394b", "#ffd54a") + '</div>' +
      '<div class="xm-gift" style="right:calc(4vw + 112px);transform:scale(.8);transform-origin:bottom">' + gift("#1f8a54", "#fff") + '</div>';
    document.body.appendChild(ground);

    var slot = document.querySelector("[data-lk-banner]");
    var header = slot ? null : document.querySelector("header");
    var banner = document.createElement("div");
    banner.className = "xm-banner" + (slot ? " xm-compact" : "");
    banner.innerHTML =
      '<span class="xm-ico" aria-hidden="true">🎅</span>' +
      '<div class="xm-txt"><b>' + FESTIVAL.title + '</b><small>' + FESTIVAL.sub + '</small></div>' +
      '<button type="button" class="xm-btn">แกะของขวัญ 🎁</button>' +
      '<button type="button" class="xm-x" aria-label="ซ่อนลูกเล่นเทศกาล" title="ซ่อนลูกเล่นเทศกาล">✕</button>';
    if (slot) slot.appendChild(banner);
    else if (header && header.parentNode) header.parentNode.insertBefore(banner, header.nextSibling);

    var gifts = ["🎁 ได้รับ: วันหยุดยาวแบบไม่มีเคสด่วน", "🎁 ได้รับ: GPS ออนไลน์ครบทุกคัน", "🎁 ได้รับ: กาแฟฟรี 1 แก้ว (จากใจ)",
                 "🎁 ได้รับ: ระบบไม่ล่มตลอดเทศกาล", "🎁 ได้รับ: รถทุกคันถึงบ้านปลอดภัย", "🎁 ได้รับ: รอยยิ้มจากทีม"];
    var msg = document.createElement("div");
    msg.className = "xm-msg";
    document.body.appendChild(msg);
    var msgTimer;
    banner.querySelector(".xm-btn").addEventListener("click", function (e) {
      msg.textContent = gifts[Math.floor(Math.random() * gifts.length)];
      msg.classList.add("show");
      clearTimeout(msgTimer);
      msgTimer = setTimeout(function () { msg.classList.remove("show"); }, 2800);
      if (still) return;
      var r = e.currentTarget.getBoundingClientRect();
      var items = ["✨", "⭐", "❄️", "🎉", "✨", "⭐"];
      for (var i = 0; i < 10; i++) {
        var p = document.createElement("span");
        p.className = "xm-pop";
        p.textContent = items[i % items.length];
        p.style.left = (r.left + r.width / 2 - 9) + "px";
        p.style.top = (r.top + r.height / 2 - 9) + "px";
        var ang = (Math.PI * 2 * i) / 10, dist = 50 + Math.random() * 40;
        p.style.setProperty("--dx", (Math.cos(ang) * dist).toFixed(0) + "px");
        p.style.setProperty("--dy", (Math.sin(ang) * dist).toFixed(0) + "px");
        document.body.appendChild(p);
        setTimeout(function (el) { return function () { el.remove(); }; }(p), 1500);
      }
    });

    banner.querySelector(".xm-x").addEventListener("click", function () {
      try { sessionStorage.setItem(HIDE_KEY, "1"); } catch (e) {}
      [layer, snowfall, ground, banner, msg, style].forEach(function (el) { el.remove(); });
      document.body.classList.remove("xm-on");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
