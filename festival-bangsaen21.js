/* =====================================================================
   ลูกเล่นงานวิ่ง Bangsaen21 (ชั่วคราว) สำหรับหน้า Access Hub และหน้าเข้าสู่ระบบ
   - เปิดเองอัตโนมัติเฉพาะช่วงวันที่กำหนดใน FESTIVAL.start / FESTIVAL.end (19–20 ธ.ค.)
     ช่วงนี้ธีมคริสต์มาสจะหยุดแสดงชั่วคราว (ดู SKIP ใน festival-christmas.js)
   - ข้อความเปลี่ยนตามวัน: 19 = วันก่อนแข่ง / 20 = วันแข่ง
   - ทดลองดูนอกช่วงวันได้ด้วยการเติม ?festival=bangsaen21 ท้าย URL (เติม &bsday=19|20 เพื่อดูแต่ละวัน)
   - เลิกใช้: ลบบรรทัด <script src="./festival-bangsaen21.js"> ใน Access-Hub.html และ index.html
   - สไตล์ได้แรงบันดาลใจจากเว็บงาน (ลายเส้นแบน สีฟ้าทะเล-ดำ-ขาว ธีมทะเลบางแสน)
     แต่ภาพวาดเองทั้งหมด ไม่ใช้โลโก้หรือภาพประกอบทางการของงาน
   ===================================================================== */
(function () {
  var FESTIVAL = {
    start: "2026-12-19T00:00:00+07:00",
    end:   "2026-12-21T00:00:00+07:00",   // หมดเขตอัตโนมัติ (แสดง 19–20 ธ.ค.) แล้วคริสต์มาสกลับมาแสดงต่อ
    title: "Bangsaen21 · 12 Years of Greatness",
    days: {
      19: "พรุ่งนี้ อาทิตย์ 20 ธ.ค. · ฮาล์ฟมาราธอน 21.1 กม. เลียบชายหาดบางแสน · วันนี้วันสุดท้ายรับบิบ (บางแสน เฮอริเทจ)",
      20: "วันนี้ ฮาล์ฟมาราธอน 21.1 กม. เลียบชายหาดบางแสน · ออกตัวและเข้าเส้นชัยหน้าโรงแรมบางแสน เฮอริเทจ"
    },
    roadNote: "⚠️ ถนนเลียบหาดบางแสนอาจปิดช่วงเช้าวันแข่ง · รถที่วิ่งในชลบุรีควรเลี่ยงพื้นที่บางแสน"
  };

  var forced = window.BS_FORCE === true || /[?&]festival=bangsaen21\b/.test(location.search);
  var now = Date.now();
  if (!forced && (now < Date.parse(FESTIVAL.start) || now >= Date.parse(FESTIVAL.end))) return;

  var HIDE_KEY = "festival-bangsaen21-2026-hidden";
  try { if (!forced && sessionStorage.getItem(HIDE_KEY) === "1") return; } catch (e) {}

  var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  var dm = location.search.match(/[?&]bsday=(19|20)\b/);
  var day = forced && dm ? Number(dm[1]) : new Date(Date.now() + 7 * 3600 * 1000).getUTCDate();
  if (!FESTIVAL.days[day]) day = 19;
  var raceDay = day === 20;

  /* ---------------- CSS ---------------- */
  var css = [
    ":root{--bs-blue:#2aa8e0;--bs-ink:#14161c;--bs-paper:#ffffff;--bs-sky:rgba(42,168,224,.14)}",
    ":root[data-theme='dark']{--bs-ink:#e8eef6;--bs-paper:#151a22;--bs-sky:rgba(42,168,224,.16)}",
    "body.bs-on{padding-bottom:112px}",
    ".bs-layer{position:fixed;inset:0;pointer-events:none;z-index:-1;overflow:hidden}",
    ".bs-sky{position:absolute;inset:0;background:radial-gradient(1000px 520px at 85% -12%,var(--bs-sky),transparent 70%)}",
    /* แถบภาพประกอบด้านล่าง: ภูเขา ทะเล ถนนเลียบหาด ต้นมะพร้าว เรือใบ พระอาทิตย์ นักวิ่ง */
    /* พื้นหลังโปร่ง: เห็นเนื้อหาหน้าเว็บทะลุได้ (เช่น ช่องรหัสผ่าน/ปุ่มเข้าสู่ระบบบนจอเตี้ย) มีแค่ลายเส้นทับ */
    ".bs-scene{position:fixed;left:0;right:0;bottom:0;height:108px;pointer-events:none;z-index:3;overflow:hidden}",
    "@media(max-height:700px){.bs-scene{height:84px}.bs-scene svg.land{height:84px}.bs-sun{top:2px;width:26px;height:26px}body.bs-on{padding-bottom:90px}}",
    ".bs-scene svg.land{position:absolute;left:0;bottom:0;width:100%;height:100%}",
    ".bs-wave{position:absolute;left:0;bottom:30px;width:200%;height:16px;animation:bs-flow 14s linear infinite}",
    ".bs-wave svg{width:50%;height:100%;float:left}",
    "@keyframes bs-flow{to{transform:translateX(-50%)}}",
    ".bs-sun{position:absolute;top:8px;right:12vw;width:34px;height:34px;animation:bs-spin 24s linear infinite}",
    "@keyframes bs-spin{to{transform:rotate(360deg)}}",
    ".bs-boat{position:absolute;bottom:40px;left:0;width:40px;height:34px;animation:bs-sail 60s linear infinite}",
    ".bs-boat svg{width:100%;height:100%;animation:bs-bob 3s ease-in-out infinite alternate}",
    "@keyframes bs-sail{from{transform:translateX(-50px)}to{transform:translateX(calc(100vw + 50px))}}",
    "@keyframes bs-bob{from{transform:translateY(0) rotate(-3deg)}to{transform:translateY(-3px) rotate(3deg)}}",
    ".bs-runner{position:absolute;bottom:4px;left:0;width:28px;height:30px;animation:bs-run linear infinite}",
    ".bs-runner svg{width:100%;height:100%;overflow:visible}",
    ".bs-runner .la,.bs-runner .ab{transform-origin:14px 15px;animation:bs-swing .38s ease-in-out infinite alternate}",
    ".bs-runner .lb,.bs-runner .aa{transform-origin:14px 15px;animation:bs-swing .38s ease-in-out infinite alternate-reverse}",
    ".bs-runner .aa,.bs-runner .ab{transform-origin:14px 9px}",
    "@keyframes bs-run{from{transform:translateX(-40px)}to{transform:translateX(calc(100vw + 40px))}}",
    "@keyframes bs-swing{from{transform:rotate(-35deg)}to{transform:rotate(35deg)}}",
    /* แบนเนอร์ */
    ".bs-banner{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:-28px 0 34px;padding:12px 14px 12px 16px;",
    "border:2px solid var(--bs-ink);border-radius:14px;background:var(--surface,#fff);position:relative;z-index:1;",
    "box-shadow:4px 4px 0 var(--bs-blue)}",
    ".bs-banner .bs-ico{width:40px;height:40px;flex-shrink:0}",
    ".bs-banner .bs-txt{flex:1;min-width:200px}.bs-banner.bs-compact{margin:16px 24px 0}.bs-banner.bs-compact .bs-txt{min-width:140px}",
    ".bs-banner b{display:block;font-weight:800;font-size:1.02rem;letter-spacing:.3px;text-transform:uppercase;color:var(--bs-ink)}",
    ".bs-banner b em{font-style:normal;color:var(--bs-blue)}",
    ".bs-banner small{display:block;color:var(--muted,#7a7a75);font-weight:300;font-size:.82rem}",
    ".bs-banner .bs-road-note{display:block;margin-top:5px;font-size:.78rem;font-weight:500;color:#b45309}",
    ":root[data-theme='dark'] .bs-banner .bs-road-note{color:#f6ad55}",
    ".bs-btn{font:inherit;font-size:.85rem;font-weight:600;height:36px;padding:0 14px;border-radius:999px;cursor:pointer;",
    "border:2px solid var(--bs-ink);background:var(--bs-blue);color:#fff;transition:transform .2s}",
    ".bs-btn:hover{transform:translateY(-1px)}.bs-btn:active{transform:scale(.97)}",
    ".bs-x{font:inherit;width:32px;height:32px;border-radius:50%;border:1px solid var(--line,#e2e2de);background:transparent;color:var(--muted,#7a7a75);cursor:pointer}",
    ".bs-x:hover{color:var(--text,#1a1a1a);border-color:var(--muted,#7a7a75)}",
    ".bs-msg{position:fixed;left:50%;bottom:122px;transform:translateX(-50%);z-index:4;font-size:.85rem;padding:6px 14px;border-radius:999px;",
    "background:var(--surface,#fff);border:2px solid var(--bs-ink);box-shadow:3px 3px 0 var(--bs-blue);opacity:0;transition:opacity .4s;pointer-events:none;white-space:nowrap}",
    ".bs-msg.show{opacity:1}",
    "@media(max-width:520px){.bs-banner{margin-top:-16px}.bs-msg{white-space:normal;text-align:center;width:max-content;max-width:90vw}}",
    "@media(prefers-reduced-motion:reduce){.bs-wave,.bs-sun,.bs-boat,.bs-boat svg,.bs-runner,.bs-runner *{animation:none !important}}"
  ].join("");

  var style = document.createElement("style");
  style.id = "bs-style";
  style.textContent = css;
  document.head.appendChild(style);

  /* ---------------- ภาพ (วาดเอง ลายเส้นแบน สีฟ้า-ดำ) ---------------- */
  var INK = "var(--bs-ink)", BLUE = "var(--bs-blue)", PAPER = "var(--bs-paper)";
  // ภูมิทัศน์: ภูเขา (ซ้าย) ศาลเจ้า ต้นมะพร้าว ร่มชายหาด ถนนเลียบหาดคดเคี้ยว ทะเล
  var LAND =
    '<svg class="land" viewBox="0 0 1440 108" preserveAspectRatio="none" aria-hidden="true">' +
      // ทะเล
      '<rect x="0" y="62" width="1440" height="26" fill="' + BLUE + '" opacity=".22"/>' +
      // ภูเขา
      '<path d="M30 62 L120 10 L160 34 L190 18 L270 62 Z" fill="' + PAPER + '" stroke="' + INK + '" stroke-width="2"/>' +
      '<path d="M120 10 L108 28 L124 24 L132 34 L142 26 L160 34 Z M190 18 L182 30 L196 28 L206 36 Z" fill="' + BLUE + '"/>' +
      // ศาลเจ้า/เก๋ง
      '<g stroke="' + INK + '" stroke-width="2" fill="' + PAPER + '">' +
        '<rect x="330" y="34" width="36" height="28"/><path d="M322 34 L348 22 L374 34 Z" fill="' + BLUE + '"/>' +
        '<rect x="340" y="44" width="16" height="18" fill="' + BLUE + '" opacity=".5"/></g>' +
      // ต้นมะพร้าว
      '<g stroke="' + INK + '" stroke-width="2" fill="none">' +
        '<path d="M560 62 C562 44 566 32 574 22"/>' +
        '<path d="M574 22 C560 16 548 20 542 28 M574 22 C566 10 556 8 548 10 M574 22 C584 12 596 12 602 18 M574 22 C590 22 598 30 600 38" stroke="' + BLUE + '" stroke-width="3"/></g>' +
      // ร่มชายหาด + เก้าอี้
      '<g stroke="' + INK + '" stroke-width="2">' +
        '<path d="M690 30 Q712 14 734 30 Z" fill="' + BLUE + '"/><line x1="712" y1="22" x2="712" y2="62"/>' +
        '<path d="M722 62 L734 50 L748 50 M728 56 L744 56" fill="none"/></g>' +
      // ตึกริมทะเล
      '<g stroke="' + INK + '" stroke-width="2" fill="' + PAPER + '">' +
        '<rect x="900" y="26" width="34" height="36"/><rect x="938" y="16" width="26" height="46"/><rect x="968" y="34" width="30" height="28"/></g>' +
      '<g fill="' + BLUE + '"><rect x="906" y="32" width="6" height="6"/><rect x="920" y="32" width="6" height="6"/><rect x="944" y="22" width="6" height="6"/><rect x="954" y="34" width="6" height="6"/></g>' +
      // ศาลาริมหาด
      '<g stroke="' + INK + '" stroke-width="2" fill="' + PAPER + '"><path d="M1180 40 L1206 28 L1232 40 Z" fill="' + BLUE + '"/>' +
        '<line x1="1186" y1="40" x2="1186" y2="62"/><line x1="1226" y1="40" x2="1226" y2="62"/></g>' +
      // ถนนเลียบหาด (ล่างสุด) + เส้นกลางถนน
      '<rect x="0" y="88" width="1440" height="20" fill="' + INK + '"/>' +
      '<line x1="0" y1="98" x2="1440" y2="98" stroke="' + PAPER + '" stroke-width="2" stroke-dasharray="18 14"/>' +
    '</svg>';
  var WAVE = '<svg viewBox="0 0 720 16" preserveAspectRatio="none"><path d="M0 8 Q30 0 60 8 T120 8 T180 8 T240 8 T300 8 T360 8 T420 8 T480 8 T540 8 T600 8 T660 8 T720 8" stroke="' + BLUE + '" stroke-width="2.5" fill="none"/></svg>';
  var SUN = '<svg viewBox="0 0 34 34" aria-hidden="true"><circle cx="17" cy="17" r="7" fill="' + PAPER + '" stroke="' + INK + '" stroke-width="2"/>' +
    '<g stroke="' + INK + '" stroke-width="2" stroke-linecap="round"><line x1="17" y1="2" x2="17" y2="6"/><line x1="17" y1="28" x2="17" y2="32"/><line x1="2" y1="17" x2="6" y2="17"/><line x1="28" y1="17" x2="32" y2="17"/>' +
    '<line x1="6.5" y1="6.5" x2="9.3" y2="9.3"/><line x1="24.7" y1="24.7" x2="27.5" y2="27.5"/><line x1="6.5" y1="27.5" x2="9.3" y2="24.7"/><line x1="24.7" y1="9.3" x2="27.5" y2="6.5"/></g></svg>';
  var BOAT = '<svg viewBox="0 0 40 34" aria-hidden="true"><path d="M20 2 L20 24 L6 24 Z" fill="' + PAPER + '" stroke="' + INK + '" stroke-width="2"/>' +
    '<path d="M22 6 L34 24 L22 24 Z" fill="' + BLUE + '" stroke="' + INK + '" stroke-width="2"/><path d="M4 26 H36 L32 32 H8 Z" fill="' + INK + '"/></svg>';
  function runnerSvg(shirt) {
    return '<svg viewBox="0 0 28 30" aria-hidden="true">' +
      '<g class="la"><path d="M14 15 L11 22 L12 28" stroke="' + PAPER + '" stroke-width="2.6" stroke-linecap="round" fill="none"/></g>' +
      '<g class="lb"><path d="M14 15 L17 22 L16 28" stroke="' + PAPER + '" stroke-width="2.6" stroke-linecap="round" fill="none"/></g>' +
      '<g class="ab"><path d="M14 9 L10 13 L12 16" stroke="' + PAPER + '" stroke-width="2.2" stroke-linecap="round" fill="none"/></g>' +
      '<rect x="11" y="7" width="6" height="9" rx="2" fill="' + shirt + '"/>' +
      '<g class="aa"><path d="M14 9 L18 13 L16 16" stroke="' + PAPER + '" stroke-width="2.2" stroke-linecap="round" fill="none"/></g>' +
      '<circle cx="14.5" cy="3.8" r="3" fill="' + PAPER + '"/></svg>';
  }
  // ไอคอนแบนเนอร์: ลิงน้อยถือป้าย 21 (วาดเอง แบบเรียบง่าย)
  var MONKEY = '<svg class="bs-ico" viewBox="0 0 40 40" aria-hidden="true">' +
    '<circle cx="9" cy="16" r="5" fill="' + BLUE + '" stroke="' + INK + '" stroke-width="1.6"/><circle cx="31" cy="16" r="5" fill="' + BLUE + '" stroke="' + INK + '" stroke-width="1.6"/>' +
    '<circle cx="20" cy="18" r="12" fill="' + BLUE + '" stroke="' + INK + '" stroke-width="1.8"/>' +
    '<ellipse cx="20" cy="22" rx="8" ry="6.5" fill="' + PAPER + '" stroke="' + INK + '" stroke-width="1.4"/>' +
    '<circle cx="16" cy="15" r="1.6" fill="' + INK + '"/><circle cx="24" cy="15" r="1.6" fill="' + INK + '"/>' +
    '<path d="M16.5 24 Q20 27 23.5 24" stroke="' + INK + '" stroke-width="1.4" fill="none" stroke-linecap="round"/>' +
    '<rect x="11" y="31" width="18" height="8" rx="2" fill="' + PAPER + '" stroke="' + INK + '" stroke-width="1.4"/>' +
    '<text x="20" y="37.4" text-anchor="middle" font-size="6.5" font-weight="800" fill="' + INK + '" font-family="sans-serif">21</text></svg>';

  function build() {
    document.body.classList.add("bs-on");

    var layer = document.createElement("div");
    layer.className = "bs-layer";
    layer.setAttribute("aria-hidden", "true");
    layer.innerHTML = '<div class="bs-sky"></div>';
    document.body.insertBefore(layer, document.body.firstChild);

    var scene = document.createElement("div");
    scene.className = "bs-scene";
    scene.setAttribute("aria-hidden", "true");
    scene.innerHTML = LAND +
      '<div class="bs-wave">' + WAVE + WAVE + '</div>' +
      '<div class="bs-sun">' + SUN + '</div>' +
      '<div class="bs-boat">' + BOAT + '</div>';
    document.body.appendChild(scene);

    var SHIRTS = ["#2aa8e0", "#ffffff", "#f59e0b", "#22c55e", "#ef4444"];
    function addRunner(opts) {
      var r = document.createElement("div");
      r.className = "bs-runner";
      r.innerHTML = runnerSvg(opts.shirt || SHIRTS[Math.floor(Math.random() * SHIRTS.length)]);
      r.style.animationDuration = (opts.dur || (14 + Math.random() * 10)) + "s";
      if (opts.delay !== undefined) r.style.animationDelay = opts.delay + "s";
      if (opts.once) {
        r.style.animationIterationCount = "1";
        r.addEventListener("animationend", function (e) { if (e.target === r) r.remove(); });
      }
      scene.appendChild(r);
      return r;
    }
    if (still) {
      [24, 52, 76].forEach(function (x) { var r = addRunner({}); r.style.transform = "translateX(" + x + "vw)"; });
    } else {
      for (var i = 0; i < 5; i++) addRunner({ delay: -Math.random() * 24 });
    }

    var slot = document.querySelector("[data-lk-banner]");
    var header = slot ? null : document.querySelector("header");
    var banner = document.createElement("div");
    banner.className = "bs-banner" + (slot ? " bs-compact" : "");
    banner.innerHTML = MONKEY +
      '<div class="bs-txt"><b>Bang<em>saen21</em> · 12 Years of Greatness</b><small>' + FESTIVAL.days[day] + '</small>' +
      (raceDay ? '<span class="bs-road-note">' + FESTIVAL.roadNote + '</span>' : '') + '</div>' +
      (still ? "" : '<button type="button" class="bs-btn">เชียร์ริมหาด 🌊</button>') +
      '<button type="button" class="bs-x" aria-label="ซ่อนลูกเล่นงานวิ่ง" title="ซ่อนลูกเล่นงานวิ่ง">✕</button>';
    if (slot) slot.appendChild(banner);
    else if (header && header.parentNode) header.parentNode.insertBefore(banner, header.nextSibling);

    var cheers = ["สู้ ๆ อีก 21 กม. ก็ถึงแล้ว! 🏁", "ลมทะเลเย็น ๆ วิ่งสบาย 🌊", "ระวังลิงเขาสามมุขแย่งน้ำนะ 🐒",
                  "ขอให้รถทุกคันเลี่ยงถนนปิดได้ราบรื่น", "Sub 2 ไปเลย!", "ขอให้ทุกเที่ยววิ่งถึงเส้นชัยปลอดภัย"];
    var msg = document.createElement("div");
    msg.className = "bs-msg";
    document.body.appendChild(msg);
    var msgTimer;
    var btn = banner.querySelector(".bs-btn");
    if (btn) btn.addEventListener("click", function () {
      addRunner({ dur: 5, once: true, shirt: "#2aa8e0" });
      msg.textContent = cheers[Math.floor(Math.random() * cheers.length)];
      msg.classList.add("show");
      clearTimeout(msgTimer);
      msgTimer = setTimeout(function () { msg.classList.remove("show"); }, 2600);
    });

    banner.querySelector(".bs-x").addEventListener("click", function () {
      try { sessionStorage.setItem(HIDE_KEY, "1"); } catch (e) {}
      [layer, scene, banner, msg, style].forEach(function (el) { el.remove(); });
      document.body.classList.remove("bs-on");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
