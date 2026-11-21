/* =====================================================================
   วันชาติ และวันพ่อแห่งชาติ 5 ธันวาคม (ชั่วคราว) สำหรับหน้า Access Hub และหน้าเข้าสู่ระบบ
   - เปิดเองอัตโนมัติเฉพาะช่วงวันที่กำหนดใน FESTIVAL.start / FESTIVAL.end
   - ทดลองดูนอกช่วงวันได้ด้วยการเติม ?festival=fathersday ท้าย URL
   - เลิกใช้: ลบบรรทัด <script src="./festival-fathersday.js"> ใน Access-Hub.html และ index.html
   - ออกแบบให้เรียบและสุภาพ: โทนเหลือง ดอกพุทธรักษา ไม่มีปุ่มเล่นหรือแอนิเมชันสนุก ๆ
   ===================================================================== */
(function () {
  var FESTIVAL = {
    start: "2026-12-04T00:00:00+07:00",   // ต่อจากธีม BTS (3 ธ.ค.)
    end:   "2026-12-06T00:00:00+07:00",   // หมดเขตอัตโนมัติ (แสดง 4–5 ธ.ค.)
    title: "5 ธันวาคม วันชาติ และวันพ่อแห่งชาติ",
    sub:   "วันศุกร์ที่ 5 ธันวาคม 2569"
  };

  var forced = window.FD_FORCE === true || /[?&]festival=fathersday\b/.test(location.search);
  var now = Date.now();
  if (!forced && (now < Date.parse(FESTIVAL.start) || now >= Date.parse(FESTIVAL.end))) return;

  var HIDE_KEY = "festival-fathersday-2569-hidden";
  try { if (!forced && sessionStorage.getItem(HIDE_KEY) === "1") return; } catch (e) {}

  var css = [
    ":root{--fd-y1:#f6c445;--fd-y2:#fde9a6;--fd-glow:rgba(246,196,69,.20)}",
    ":root[data-theme='dark']{--fd-glow:rgba(246,196,69,.13)}",
    ".fd-layer{position:fixed;inset:0;pointer-events:none;z-index:-1;overflow:hidden}",
    ".fd-sky{position:absolute;inset:0;background:radial-gradient(1000px 520px at 50% -12%,var(--fd-glow),transparent 70%)}",
    ".fd-flowers{position:fixed;bottom:0;width:150px;height:170px;pointer-events:none;z-index:0;opacity:.9}",
    ".fd-flowers.l{left:0}.fd-flowers.r{right:0;transform:scaleX(-1)}",
    ".fd-flowers svg{width:100%;height:100%}",
    ".fd-banner{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:-28px 0 34px;padding:12px 14px 12px 16px;",
    "border:1px solid var(--line,#e2e2de);border-left:4px solid var(--fd-y1);border-radius:14px;background:var(--surface,#fff);",
    "box-shadow:var(--shadow,0 8px 24px -10px rgba(0,0,0,.18));position:relative;z-index:1;background-image:linear-gradient(90deg,rgba(246,196,69,.14),transparent 60%)}",
    ".fd-banner .fd-ico{font-size:1.6rem;line-height:1}",
    ".fd-banner .fd-txt{flex:1;min-width:180px}.fd-banner.fd-compact{margin:16px 24px 0;box-shadow:none}.fd-banner.fd-compact .fd-txt{min-width:140px}",
    ".fd-banner b{display:block;font-weight:600;font-size:1rem}",
    ".fd-banner small{display:block;color:var(--muted,#7a7a75);font-weight:300;font-size:.82rem}",
    ".fd-x{font:inherit;width:32px;height:32px;border-radius:50%;border:1px solid var(--line,#e2e2de);background:transparent;color:var(--muted,#7a7a75);cursor:pointer}",
    ".fd-x:hover{color:var(--text,#1a1a1a);border-color:var(--muted,#7a7a75)}",
    "@media(max-width:640px){.fd-flowers{width:96px;height:110px}.fd-banner{margin-top:-16px}}"
  ].join("");

  var style = document.createElement("style");
  style.id = "fd-style";
  style.textContent = css;
  document.head.appendChild(style);

  // ดอกพุทธรักษาสีเหลือง (วาดเอง แบบเรียบ)
  var CANNA =
    '<svg viewBox="0 0 150 170" aria-hidden="true">' +
      '<path d="M40 170 C42 120 48 90 58 60" stroke="#5c8f3a" stroke-width="4" fill="none"/>' +
      '<path d="M95 170 C92 130 88 105 84 80" stroke="#5c8f3a" stroke-width="4" fill="none"/>' +
      '<path d="M40 170 C10 140 6 110 20 95 C30 120 38 140 42 165 Z" fill="#6fa64a"/>' +
      '<path d="M95 170 C130 145 140 118 128 100 C116 122 104 142 96 166 Z" fill="#6fa64a"/>' +
      '<path d="M60 168 C62 140 70 122 82 112 C78 132 72 150 66 168 Z" fill="#82b85a"/>' +
      // ดอกที่ 1
      '<g transform="translate(58 52)">' +
        '<path d="M0 0 C-18 -10 -22 -30 -10 -40 C-2 -26 2 -14 0 0 Z" fill="#f6c445"/>' +
        '<path d="M0 0 C16 -14 30 -14 34 -2 C20 2 10 2 0 0 Z" fill="#f9d572"/>' +
        '<path d="M0 0 C-4 -20 4 -38 16 -40 C14 -24 8 -10 0 0 Z" fill="#fbe39a"/>' +
        '<path d="M0 0 C-16 4 -28 0 -30 -10 C-16 -10 -8 -6 0 0 Z" fill="#f2b632"/>' +
        '<circle cx="0" cy="-2" r="3" fill="#e0962a"/>' +
      '</g>' +
      // ดอกที่ 2
      '<g transform="translate(86 78) scale(.8)">' +
        '<path d="M0 0 C-18 -10 -22 -30 -10 -40 C-2 -26 2 -14 0 0 Z" fill="#f2b632"/>' +
        '<path d="M0 0 C16 -14 30 -14 34 -2 C20 2 10 2 0 0 Z" fill="#f6c445"/>' +
        '<path d="M0 0 C-4 -20 4 -38 16 -40 C14 -24 8 -10 0 0 Z" fill="#fbe39a"/>' +
        '<circle cx="0" cy="-2" r="3" fill="#e0962a"/>' +
      '</g>' +
    '</svg>';

  function build() {
    var layer = document.createElement("div");
    layer.className = "fd-layer";
    layer.setAttribute("aria-hidden", "true");
    layer.innerHTML = '<div class="fd-sky"></div>';
    document.body.insertBefore(layer, document.body.firstChild);

    var fl = document.createElement("div"); fl.className = "fd-flowers l"; fl.innerHTML = CANNA;
    var fr = document.createElement("div"); fr.className = "fd-flowers r"; fr.innerHTML = CANNA;
    document.body.appendChild(fl); document.body.appendChild(fr);

    var slot = document.querySelector("[data-lk-banner]");
    var header = slot ? null : document.querySelector("header");
    var banner = document.createElement("div");
    banner.className = "fd-banner" + (slot ? " fd-compact" : "");
    banner.innerHTML =
      '<span class="fd-ico" aria-hidden="true">💛</span>' +
      '<div class="fd-txt"><b>' + FESTIVAL.title + '</b><small>' + FESTIVAL.sub + '</small></div>' +
      '<button type="button" class="fd-x" aria-label="ซ่อน" title="ซ่อน">✕</button>';
    if (slot) slot.appendChild(banner);
    else if (header && header.parentNode) header.parentNode.insertBefore(banner, header.nextSibling);

    banner.querySelector(".fd-x").addEventListener("click", function () {
      try { sessionStorage.setItem(HIDE_KEY, "1"); } catch (e) {}
      [layer, fl, fr, banner, style].forEach(function (el) { el.remove(); });
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
