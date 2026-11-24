/* =====================================================================
   ลูกเล่นงานวิ่ง Amazing Thailand Marathon Bangkok 2026 (ชั่วคราว) สำหรับหน้า Access Hub และหน้าเข้าสู่ระบบ
   - เปิดเองอัตโนมัติเฉพาะช่วงวันที่กำหนดใน FESTIVAL.start / FESTIVAL.end (25–29 พ.ย.)
   - ข้อความในแบนเนอร์เปลี่ยนตามวัน: 25 ก่อนเปิดรับอุปกรณ์ / 26–27 รับอุปกรณ์ / 28 ฮาล์ฟมาราธอน / 29 มาราธอน 10K Family Run
   - ทดลองดูนอกช่วงวันได้ด้วยการเติม ?festival=atm ท้าย URL (เติม &atmday=25|26|27|28|29 เพื่อดูข้อความแต่ละวัน)
   - เลิกใช้: ลบบรรทัด <script src="./festival-atm.js"> ใน Access-Hub.html และ index.html
   - ข้อมูลอ้างอิงจากเว็บไซต์ทางการ amazingthailandmarathon.com (ณ 21 พ.ย. 2569)
   - ภาพวาดเองทั้งหมด (นักวิ่ง เส้นขอบฟ้าเมือง) ไม่ใช้โลโก้หรือภาพทางการของงาน
   ===================================================================== */
(function () {
  var FESTIVAL = {
    start: "2026-11-25T00:00:00+07:00",   // ต่อจากลอยกระทง (หมด 25 พ.ย. 00:00)
    end:   "2026-11-30T00:00:00+07:00",   // หมดเขตอัตโนมัติ (แสดง 26–29 พ.ย.)
    title: "🏃 Amazing Thailand Marathon Bangkok 2026",
    // ข้อความย่อยตามวัน (วันที่ตามเวลาไทย)
    days: {
      25: "วิ่งผ่าเมือง ซีซั่น 9 · พรุ่งนี้เริ่มรับเสื้อและบิบที่ศูนย์ฯ สิริกิติ์ (QSNCC) · วิ่งจริง 28–29 พ.ย.",
      26: "วิ่งผ่าเมือง ซีซั่น 9 · รับเสื้อและบิบที่ศูนย์ฯ สิริกิติ์ (QSNCC) 11:00–20:00 · วิ่งจริง 28–29 พ.ย.",
      27: "พรุ่งนี้ ฮาล์ฟมาราธอน 21.1 กม. · วันนี้วันสุดท้ายรับบิบฮาล์ฟฯ ที่ QSNCC 11:00–20:00",
      28: "วันนี้ ฮาล์ฟมาราธอน 21.1 กม. ออกตัว 04:00 หน้า MBK → เส้นชัยสนามหลวง",
      29: "วันนี้ มาราธอน 42.195 กม. 02:00 · 10 กม. 06:00 · Family Run 07:00 · ออกตัวหน้าศาลฎีกา สนามหลวง"
    },
    // แจ้งเตือนสำหรับรถ: วันแข่ง 28–29 ปิดถนน 100%
    roadNote: "⚠️ ปิดถนนเส้นทางวิ่ง 100% ช่วงเช้า (สนามหลวง ราชดำเนิน ปทุมวัน) · วางแผนให้รถเลี่ยงพื้นที่ชั้นใน"
  };

  var forced = window.ATM_FORCE === true || /[?&]festival=atm\b/.test(location.search);
  var now = Date.now();
  if (!forced && (now < Date.parse(FESTIVAL.start) || now >= Date.parse(FESTIVAL.end))) return;

  var HIDE_KEY = "festival-atm-2026-hidden";
  try { if (!forced && sessionStorage.getItem(HIDE_KEY) === "1") return; } catch (e) {}

  var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  // วันที่ตามเวลาไทย (UTC+7) หรือวันที่บังคับดูตัวอย่าง
  var dm = location.search.match(/[?&]atmday=(2[5-9])\b/);
  var day = forced && dm ? Number(dm[1]) : new Date(Date.now() + 7 * 3600 * 1000).getUTCDate();
  if (!FESTIVAL.days[day]) day = 25;
  var raceDay = day === 28 || day === 29;

  /* ---------------- CSS ---------------- */
  var css = [
    ":root{--atm-o:#ff6b2c;--atm-t:#0fa3a3;--atm-road:#3b3f4a;--atm-sky:rgba(255,140,60,.14);--atm-city:rgba(40,52,74,.16)}",
    ":root[data-theme='dark']{--atm-sky:rgba(255,120,50,.12);--atm-city:rgba(170,190,220,.10);--atm-road:#2a2d35}",
    "body.atm-on{padding-bottom:96px}",
    ".atm-layer{position:fixed;inset:0;pointer-events:none;z-index:-1;overflow:hidden}",
    ".atm-sky{position:absolute;inset:0;background:radial-gradient(1000px 520px at 80% -12%,var(--atm-sky),transparent 70%)}",
    /* ถนน + เส้นขอบฟ้าเมือง + นักวิ่ง */
    ".atm-street{position:fixed;left:0;right:0;bottom:0;height:92px;pointer-events:none;z-index:3;overflow:hidden}",
    ".atm-street svg.city{position:absolute;left:0;bottom:30px;width:100%;height:62px}",
    ".atm-road{position:absolute;left:0;right:0;bottom:0;height:32px;background:var(--atm-road)}",
    ".atm-road::before{content:'';position:absolute;left:0;right:0;top:15px;height:3px;",
    "background:repeating-linear-gradient(90deg,#f5f5f5 0 26px,transparent 26px 52px);opacity:.75}",
    ".atm-road::after{content:'';position:absolute;left:0;right:0;top:0;height:3px;background:var(--atm-o)}",
    ".atm-runner{position:absolute;bottom:20px;left:0;width:34px;height:48px;animation:atm-run linear infinite}",
    ".atm-runner svg{width:100%;height:100%;overflow:visible}",
    ".atm-runner .leg-a,.atm-runner .arm-b{transform-origin:17px 26px;animation:atm-swing .42s ease-in-out infinite alternate}",
    ".atm-runner .leg-b,.atm-runner .arm-a{transform-origin:17px 26px;animation:atm-swing .42s ease-in-out infinite alternate-reverse}",
    ".atm-runner .arm-a,.atm-runner .arm-b{transform-origin:17px 15px}",
    ".atm-runner .body{animation:atm-bounce .21s ease-in-out infinite alternate}",
    "@keyframes atm-run{from{transform:translateX(-60px)}to{transform:translateX(calc(100vw + 60px))}}",
    "@keyframes atm-swing{from{transform:rotate(-32deg)}to{transform:rotate(32deg)}}",
    "@keyframes atm-bounce{from{transform:translateY(0)}to{transform:translateY(-2px)}}",
    ".atm-finish{position:absolute;right:3vw;bottom:24px;width:70px;height:62px}",
    ".atm-finish svg{width:100%;height:100%}",
    /* แบนเนอร์ */
    ".atm-banner{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:-28px 0 34px;padding:12px 14px 12px 16px;",
    "border:1px solid var(--line,#e2e2de);border-left:4px solid var(--atm-o);border-radius:14px;background:var(--surface,#fff);",
    "box-shadow:var(--shadow,0 8px 24px -10px rgba(0,0,0,.18));position:relative;z-index:1;background-image:linear-gradient(90deg,rgba(255,107,44,.10),rgba(15,163,163,.05) 55%,transparent 80%)}",
    ".atm-banner .atm-ico{font-size:1.6rem;line-height:1}",
    ".atm-banner .atm-txt{flex:1;min-width:200px}.atm-banner.atm-compact{margin:16px 24px 0;box-shadow:none}.atm-banner.atm-compact .atm-txt{min-width:140px}",
    ".atm-banner b{display:block;font-weight:600;font-size:1rem;color:var(--atm-o)}",
    ".atm-banner small{display:block;color:var(--muted,#7a7a75);font-weight:300;font-size:.82rem}",
    ".atm-banner .atm-road-note{display:block;margin-top:5px;font-size:.78rem;font-weight:500;color:#b45309}",
    ":root[data-theme='dark'] .atm-banner .atm-road-note{color:#f6ad55}",
    ".atm-btn{font:inherit;font-size:.85rem;font-weight:500;height:36px;padding:0 14px;border-radius:999px;cursor:pointer;",
    "border:1px solid var(--atm-o);background:var(--atm-o);color:#fff;transition:transform .2s}",
    ".atm-btn:hover{transform:translateY(-1px)}.atm-btn:active{transform:scale(.97)}",
    ".atm-x{font:inherit;width:32px;height:32px;border-radius:50%;border:1px solid var(--line,#e2e2de);background:transparent;color:var(--muted,#7a7a75);cursor:pointer}",
    ".atm-x:hover{color:var(--text,#1a1a1a);border-color:var(--muted,#7a7a75)}",
    ".atm-msg{position:fixed;left:50%;bottom:104px;transform:translateX(-50%);z-index:4;font-size:.85rem;padding:6px 14px;border-radius:999px;",
    "background:var(--surface,#fff);border:1px solid var(--line,#e2e2de);box-shadow:var(--shadow,0 8px 24px -10px rgba(0,0,0,.18));opacity:0;transition:opacity .4s;pointer-events:none;white-space:nowrap}",
    ".atm-msg.show{opacity:1}",
    "@media(max-width:520px){.atm-banner{margin-top:-16px}.atm-finish{width:52px;height:46px}.atm-msg{white-space:normal;text-align:center;width:max-content;max-width:90vw}}",
    "@media(prefers-reduced-motion:reduce){.atm-runner,.atm-runner *{animation:none !important}}"
  ].join("");

  var style = document.createElement("style");
  style.id = "atm-style";
  style.textContent = css;
  document.head.appendChild(style);

  /* ---------------- ภาพ (วาดเอง) ---------------- */
  // นักวิ่ง: หัว ลำตัว แขนขาแกว่ง เสื้อสีต่างกัน
  function runnerSvg(shirt) {
    return '<svg viewBox="0 0 34 48" aria-hidden="true"><g class="body">' +
      '<g class="leg-a"><path d="M17 26 L13 37 L15 46" stroke="#2b2f3a" stroke-width="3.2" stroke-linecap="round" fill="none"/></g>' +
      '<g class="leg-b"><path d="M17 26 L21 37 L19 46" stroke="#454b5a" stroke-width="3.2" stroke-linecap="round" fill="none"/></g>' +
      '<g class="arm-b"><path d="M17 15 L12 21 L15 26" stroke="#c98a5a" stroke-width="2.6" stroke-linecap="round" fill="none"/></g>' +
      '<rect x="13" y="12" width="8" height="15" rx="3" fill="' + shirt + '"/>' +
      '<rect x="14.5" y="16" width="5" height="4" rx="1" fill="#fff" opacity=".9"/>' +
      '<g class="arm-a"><path d="M17 15 L22 21 L19 26" stroke="#d99a6a" stroke-width="2.6" stroke-linecap="round" fill="none"/></g>' +
      '<circle cx="18" cy="7.5" r="4.6" fill="#d99a6a"/><path d="M13.6 6.5 Q18 1.5 22.4 6 L22.4 7 Q18 4.6 13.6 7.6 Z" fill="#2b2f3a"/>' +
      '</g></svg>';
  }
  // เส้นขอบฟ้ากรุงเทพฯ แบบเงา (ตึก + ยอดวัด + เสาชิงช้า) วาดแบบทั่วไป
  var CITY =
    '<svg class="city" viewBox="0 0 1440 62" preserveAspectRatio="none" aria-hidden="true"><g fill="var(--atm-city)">' +
      '<rect x="20" y="22" width="60" height="40"/><rect x="90" y="8" width="40" height="54"/><rect x="140" y="28" width="70" height="34"/>' +
      '<path d="M250 62 V40 L262 30 L268 6 L274 30 L286 40 V62 Z"/>' +                       // ยอดปรางค์
      '<rect x="320" y="14" width="36" height="48"/><rect x="362" y="30" width="50" height="32"/>' +
      '<path d="M450 62 V26 H456 V62 Z M486 62 V26 H492 V62 Z M444 24 H498 V30 H444 Z"/>' +   // เสาชิงช้า
      '<rect x="540" y="4" width="30" height="58"/><rect x="576" y="20" width="56" height="42"/>' +
      '<path d="M670 62 V44 L690 34 L700 12 L710 34 L730 44 V62 Z"/>' +                        // ยอดวัด
      '<rect x="770" y="18" width="44" height="44"/><rect x="820" y="32" width="60" height="30"/><rect x="890" y="10" width="34" height="52"/>' +
      '<path d="M960 62 V36 L975 26 L979 2 L983 26 L998 36 V62 Z"/>' +
      '<rect x="1040" y="24" width="64" height="38"/><rect x="1110" y="6" width="38" height="56"/><rect x="1156" y="30" width="52" height="32"/>' +
      '<path d="M1240 62 V42 L1256 34 L1262 14 L1268 34 L1284 42 V62 Z"/>' +
      '<rect x="1310" y="16" width="46" height="46"/><rect x="1364" y="28" width="60" height="34"/>' +
    '</g></svg>';
  var FINISH =
    '<svg viewBox="0 0 70 62" aria-hidden="true">' +
      '<rect x="4" y="8" width="4" height="54" fill="#6b7280"/><rect x="62" y="8" width="4" height="54" fill="#6b7280"/>' +
      '<rect x="2" y="4" width="66" height="14" rx="2" fill="var(--atm-o)"/>' +
      '<text x="35" y="14.5" text-anchor="middle" font-size="8.5" font-weight="700" fill="#fff" font-family="sans-serif">FINISH</text>' +
      '<path d="M8 40 Q35 46 62 40" stroke="#fff" stroke-width="2" fill="none" stroke-dasharray="4 3"/>' +
    '</svg>';

  function build() {
    document.body.classList.add("atm-on");

    var layer = document.createElement("div");
    layer.className = "atm-layer";
    layer.setAttribute("aria-hidden", "true");
    layer.innerHTML = '<div class="atm-sky"></div>';
    document.body.insertBefore(layer, document.body.firstChild);

    var street = document.createElement("div");
    street.className = "atm-street";
    street.setAttribute("aria-hidden", "true");
    street.innerHTML = CITY + '<div class="atm-road"></div><div class="atm-finish">' + FINISH + '</div>';
    document.body.appendChild(street);

    var SHIRTS = ["#ff6b2c", "#0fa3a3", "#3b82f6", "#e11d48", "#a855f7", "#22c55e", "#f59e0b"];
    function addRunner(opts) {
      var r = document.createElement("div");
      r.className = "atm-runner";
      r.innerHTML = runnerSvg(opts.shirt || SHIRTS[Math.floor(Math.random() * SHIRTS.length)]);
      r.style.animationDuration = (opts.dur || (16 + Math.random() * 14)) + "s";
      if (opts.delay !== undefined) r.style.animationDelay = opts.delay + "s";
      r.style.bottom = (16 + Math.round(Math.random() * 8)) + "px";
      if (opts.once) {
        r.style.animationIterationCount = "1";
        r.addEventListener("animationend", function (e) { if (e.target === r) r.remove(); });
      }
      street.appendChild(r);
      return r;
    }
    if (still) {
      // โหมดลดการเคลื่อนไหว: นักวิ่งยืนนิ่ง 3 คน
      [20, 48, 70].forEach(function (x) { var r = addRunner({}); r.style.transform = "translateX(" + x + "vw)"; });
    } else {
      for (var i = 0; i < 6; i++) addRunner({ delay: -Math.random() * 28 });
    }

    var slot = document.querySelector("[data-lk-banner]");
    var header = slot ? null : document.querySelector("header");
    var banner = document.createElement("div");
    banner.className = "atm-banner" + (slot ? " atm-compact" : "");
    banner.innerHTML =
      '<span class="atm-ico" aria-hidden="true">🏅</span>' +
      '<div class="atm-txt"><b>' + FESTIVAL.title + '</b><small>' + FESTIVAL.days[day] + '</small>' +
      (raceDay ? '<span class="atm-road-note">' + FESTIVAL.roadNote + '</span>' : '') + '</div>' +
      (still ? "" : '<button type="button" class="atm-btn">ส่งแรงเชียร์ 📣</button>') +
      '<button type="button" class="atm-x" aria-label="ซ่อนลูกเล่นงานวิ่ง" title="ซ่อนลูกเล่นงานวิ่ง">✕</button>';
    if (slot) slot.appendChild(banner);
    else if (header && header.parentNode) header.parentNode.insertBefore(banner, header.nextSibling);

    var cheers = ["สู้ ๆ อีกนิดเดียวถึงเส้นชัย! 🏁", "ขอให้ทุกเที่ยววิ่งถึงเส้นชัยเหมือนนักวิ่ง", "Fast & Flat ไปเลย!",
                  "ขอให้รถทุกคันเลี่ยงถนนปิดได้ราบรื่น", "พักน้ำบ้างนะ 💧", "ขอให้ทำ PB กันทุกคน!"];
    var msg = document.createElement("div");
    msg.className = "atm-msg";
    document.body.appendChild(msg);
    var msgTimer;
    var btn = banner.querySelector(".atm-btn");
    if (btn) btn.addEventListener("click", function () {
      // นักวิ่งคนใหม่วิ่งผ่านเร็ว ๆ 1 รอบ
      addRunner({ dur: 6, once: true, shirt: "#ff6b2c" });
      msg.textContent = "📣 " + cheers[Math.floor(Math.random() * cheers.length)];
      msg.classList.add("show");
      clearTimeout(msgTimer);
      msgTimer = setTimeout(function () { msg.classList.remove("show"); }, 2600);
    });

    banner.querySelector(".atm-x").addEventListener("click", function () {
      try { sessionStorage.setItem(HIDE_KEY, "1"); } catch (e) {}
      [layer, street, banner, msg, style].forEach(function (el) { el.remove(); });
      document.body.classList.remove("atm-on");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
