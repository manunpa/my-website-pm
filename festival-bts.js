/* =====================================================================
   ลูกเล่นวันคอนเสิร์ต BTS ที่กรุงเทพฯ (ชั่วคราว 1 วัน) สำหรับหน้า Access Hub และหน้าเข้าสู่ระบบ
   - เปิดเองอัตโนมัติเฉพาะช่วงวันที่กำหนดใน FESTIVAL.start / FESTIVAL.end
   - ทดลองดูนอกช่วงวันได้ด้วยการเติม ?festival=bts ท้าย URL
   - เลิกใช้: ลบบรรทัด <script src="./festival-bts.js"> ใน Access-Hub.html และ index.html
   - ไม่บังเมาส์/คลิกของหน้าเดิม และเคารพการตั้งค่า "ลดการเคลื่อนไหว" ของเครื่อง
   - ภาพทั้งหมดวาดเองแบบทั่วไป (ไฟเวที แท่งไฟ หัวใจสีม่วง) ไม่ใช้โลโก้หรือภาพทางการของศิลปิน
   ===================================================================== */
(function () {
  var FESTIVAL = {
    start: "2026-12-03T00:00:00+07:00",
    end:   "2026-12-04T00:00:00+07:00",   // หมดเขตอัตโนมัติ (ขึ้นแค่วันที่ 3 ธ.ค.)
    title: "💜 BTS WORLD TOUR 'ARIRANG' IN BANGKOK",
    sub:   "คืนนี้ พฤหัสที่ 3 ธันวาคม 2569 · ราชมังคลากีฬาสถาน"
  };

  var forced = window.BTS_FORCE === true || /[?&]festival=bts\b/.test(location.search);
  var now = Date.now();
  if (!forced && (now < Date.parse(FESTIVAL.start) || now >= Date.parse(FESTIVAL.end))) return;

  var HIDE_KEY = "festival-bts-2569-hidden";
  try { if (!forced && sessionStorage.getItem(HIDE_KEY) === "1") return; } catch (e) {}

  var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- CSS ---------------- */
  var css = [
    ":root{--bts-p1:#7b3fe4;--bts-p2:#b07cff;--bts-glow:rgba(160,100,255,.55);--bts-sky:rgba(123,63,228,.16)}",
    ":root[data-theme='dark']{--bts-sky:rgba(123,63,228,.26);--bts-glow:rgba(170,120,255,.45)}",
    "body.bts-on{padding-bottom:104px}",
    ".bts-layer{position:fixed;inset:0;pointer-events:none;z-index:-1;overflow:hidden}",
    ".bts-sky{position:absolute;inset:0;background:radial-gradient(1100px 600px at 50% 115%,var(--bts-sky),transparent 70%),radial-gradient(700px 380px at 85% -10%,var(--bts-sky),transparent 70%)}",
    /* ไฟเวที: ลำแสงส่ายจากด้านล่าง */
    ".bts-beam{position:absolute;bottom:-10vh;width:16vw;min-width:120px;height:120vh;transform-origin:50% 100%;",
    "background:linear-gradient(to top,rgba(176,124,255,.30),rgba(176,124,255,.06) 60%,transparent);",
    "clip-path:polygon(42% 100%,58% 100%,100% 0,0 0);filter:blur(2px);animation:bts-sweep ease-in-out infinite alternate}",
    "@keyframes bts-sweep{from{transform:rotate(var(--a1))}to{transform:rotate(var(--a2))}}",
    /* หัวใจสีม่วงลอยขึ้น */
    ".bts-heart{position:absolute;bottom:-40px;font-size:20px;opacity:0;animation:bts-rise linear infinite;filter:drop-shadow(0 0 8px var(--bts-glow))}",
    "@keyframes bts-rise{0%{transform:translate(0,0) scale(.8);opacity:0}10%{opacity:.85}50%{transform:translate(var(--sway),-50vh) scale(1)}",
    "90%{opacity:.4}100%{transform:translate(0,-105vh) scale(.7);opacity:0}}",
    /* แถวผู้ชม + แท่งไฟด้านล่างจอ */
    ".bts-crowd{position:fixed;left:0;right:0;bottom:0;height:96px;pointer-events:none;z-index:3;overflow:hidden}",
    ".bts-crowd svg.heads{position:absolute;left:0;bottom:0;width:100%;height:58px}",
    ".bts-stick{position:absolute;bottom:34px;width:4px;height:30px;margin-left:-2px;border-radius:2px;background:#3a3550;transform-origin:50% 100%;",
    "animation:bts-wave 1.6s ease-in-out infinite alternate}",
    ".bts-stick::before{content:'';position:absolute;left:50%;top:-14px;width:16px;height:16px;margin-left:-8px;border-radius:50%;",
    "background:radial-gradient(circle at 40% 35%,#fff 0 18%,var(--bts-p2) 45%,var(--bts-p1) 100%);box-shadow:0 0 12px 4px var(--bts-glow)}",
    "@keyframes bts-wave{from{transform:rotate(-14deg)}to{transform:rotate(14deg)}}",
    "body.bts-cheer .bts-stick{animation-duration:.45s}",
    "body.bts-cheer .bts-stick::before{box-shadow:0 0 20px 8px var(--bts-glow);background:radial-gradient(circle at 40% 35%,#fff 0 28%,#d9bfff 50%,var(--bts-p1) 100%)}",
    /* แบนเนอร์ */
    ".bts-banner{display:flex;align-items:center;gap:14px;flex-wrap:wrap;margin:-28px 0 34px;padding:12px 14px 12px 16px;",
    "border:1px solid var(--line,#e2e2de);border-radius:14px;background:var(--surface,#fff);box-shadow:var(--shadow,0 8px 24px -10px rgba(0,0,0,.18));position:relative;z-index:1;",
    "background-image:linear-gradient(90deg,rgba(123,63,228,.10),transparent 60%)}",
    ".bts-banner .bts-ico{font-size:1.6rem;line-height:1}",
    ".bts-banner .bts-txt{flex:1;min-width:180px}.bts-banner.bts-compact{margin:16px 24px 0;box-shadow:none}.bts-banner.bts-compact .bts-txt{min-width:140px}",
    ".bts-banner b{display:block;font-weight:600;font-size:1rem;color:var(--bts-p1)}",
    ":root[data-theme='dark'] .bts-banner b{color:var(--bts-p2)}",
    ".bts-banner small{display:block;color:var(--muted,#7a7a75);font-weight:300;font-size:.82rem}",
    ".bts-btn{font:inherit;font-size:.85rem;font-weight:500;height:36px;padding:0 14px;border-radius:999px;cursor:pointer;",
    "border:1px solid var(--bts-p1);background:var(--bts-p1);color:#fff;transition:transform .2s}",
    ".bts-btn:hover{transform:translateY(-1px)}.bts-btn:active{transform:scale(.97)}",
    ".bts-x{font:inherit;width:32px;height:32px;border-radius:50%;border:1px solid var(--line,#e2e2de);background:transparent;color:var(--muted,#7a7a75);cursor:pointer}",
    ".bts-x:hover{color:var(--text,#1a1a1a);border-color:var(--muted,#7a7a75)}",
    ".bts-msg{position:fixed;left:50%;bottom:112px;transform:translateX(-50%);z-index:4;font-size:.85rem;padding:6px 14px;border-radius:999px;",
    "background:var(--surface,#fff);border:1px solid var(--line,#e2e2de);box-shadow:var(--shadow,0 8px 24px -10px rgba(0,0,0,.18));opacity:0;transition:opacity .4s;pointer-events:none;white-space:nowrap}",
    ".bts-msg.show{opacity:1}",
    "@media(max-width:520px){.bts-banner{margin-top:-16px}.bts-beam{min-width:90px}.bts-msg{white-space:normal;text-align:center;width:max-content;max-width:90vw}}",
    "@media(prefers-reduced-motion:reduce){.bts-heart{display:none}.bts-beam,.bts-stick{animation:none}}"
  ].join("");

  var style = document.createElement("style");
  style.id = "bts-style";
  style.textContent = css;
  document.head.appendChild(style);

  // แถวหัวผู้ชม (เงาดำโค้ง ๆ) วาดเอง
  function headsSvg() {
    var d = "M0 58 V40", x = 0;
    while (x < 1440) {
      var w = 34 + Math.round(Math.random() * 18), h = 22 + Math.round(Math.random() * 12);
      d += " Q" + (x + w / 2) + " " + (40 - h) + " " + (x + w) + " 40";
      x += w;
    }
    d += " V58 Z";
    return '<svg class="heads" viewBox="0 0 1440 58" preserveAspectRatio="none" aria-hidden="true"><path d="' + d + '" fill="#1e1a2e" opacity=".88"/></svg>';
  }

  /* ---------------- สร้างฉาก ---------------- */
  function build() {
    document.body.classList.add("bts-on");

    var layer = document.createElement("div");
    layer.className = "bts-layer";
    layer.setAttribute("aria-hidden", "true");
    layer.innerHTML = '<div class="bts-sky"></div>';
    document.body.insertBefore(layer, document.body.firstChild);

    // ไฟเวที 4 ลำ
    [[12, -28, 8], [36, -12, 22], [64, -22, 12], [88, -8, 28]].forEach(function (b, i) {
      var beam = document.createElement("span");
      beam.className = "bts-beam";
      beam.style.left = "calc(" + b[0] + "vw - 8vw)";
      beam.style.setProperty("--a1", b[1] + "deg");
      beam.style.setProperty("--a2", b[2] + "deg");
      beam.style.animationDuration = (5 + i * 1.3) + "s";
      beam.style.animationDelay = (-i * 1.7) + "s";
      layer.appendChild(beam);
    });

    if (!still) {
      for (var i = 0; i < 9; i++) {
        var h = document.createElement("span");
        h.className = "bts-heart";
        h.textContent = "💜";
        h.style.left = (6 + Math.random() * 88) + "vw";
        h.style.fontSize = (14 + Math.random() * 14) + "px";
        h.style.setProperty("--sway", (Math.random() * 60 - 30) + "px");
        h.style.animationDuration = (14 + Math.random() * 12) + "s";
        h.style.animationDelay = (-Math.random() * 26) + "s";
        layer.appendChild(h);
      }
    }

    // ผู้ชมถือแท่งไฟ
    var crowd = document.createElement("div");
    crowd.className = "bts-crowd";
    crowd.setAttribute("aria-hidden", "true");
    var sticks = "";
    var n = Math.max(10, Math.round(window.innerWidth / 46));
    for (var s = 0; s < n; s++) {
      var left = ((s + 0.5) / n) * 100 + (Math.random() * 2 - 1);
      sticks += '<span class="bts-stick" style="left:' + left.toFixed(2) + 'vw;bottom:' + (28 + Math.round(Math.random() * 12)) +
                'px;animation-delay:' + (-Math.random() * 1.6).toFixed(2) + 's"></span>';
    }
    crowd.innerHTML = sticks + headsSvg();
    document.body.appendChild(crowd);

    // แบนเนอร์: ถ้าหน้าไหนมี <div data-lk-banner> จะวางตรงนั้น ไม่งั้นวางใต้ <header>
    var slot = document.querySelector("[data-lk-banner]");
    var header = slot ? null : document.querySelector("header");
    var banner = document.createElement("div");
    banner.className = "bts-banner" + (slot ? " bts-compact" : "");
    banner.innerHTML =
      '<span class="bts-ico" aria-hidden="true">🎤</span>' +
      '<div class="bts-txt"><b>' + FESTIVAL.title + '</b><small>' + FESTIVAL.sub + '</small></div>' +
      (still ? "" : '<button type="button" class="bts-btn">โบกแท่งไฟ 💜</button>') +
      '<button type="button" class="bts-x" aria-label="ซ่อนลูกเล่นวันนี้" title="ซ่อนลูกเล่นวันนี้">✕</button>';
    if (slot) slot.appendChild(banner);
    else if (header && header.parentNode) header.parentNode.insertBefore(banner, header.nextSibling);

    var cheers = ["บัตรไม่ได้ก็ไม่เป็นไร ส่งใจไปราชมังฯ 💜", "ขอให้งานวันนี้จบไวทันไปคอนเสิร์ต", "ขอให้รถทุกคันถึงปลายทางเหมือนแฟน ๆ ถึงราชมังฯ",
                  "ขอให้วันนี้ไม่มีเคสค้าง", "Borahae 💜", "ขอให้ระบบเสถียรตลอดคืนนี้"];
    var msg = document.createElement("div");
    msg.className = "bts-msg";
    document.body.appendChild(msg);
    var msgTimer, cheerTimer;
    var btn = banner.querySelector(".bts-btn");
    if (btn) btn.addEventListener("click", function () {
      document.body.classList.add("bts-cheer");
      clearTimeout(cheerTimer);
      cheerTimer = setTimeout(function () { document.body.classList.remove("bts-cheer"); }, 2600);
      msg.textContent = cheers[Math.floor(Math.random() * cheers.length)];
      msg.classList.add("show");
      clearTimeout(msgTimer);
      msgTimer = setTimeout(function () { msg.classList.remove("show"); }, 2600);
    });

    banner.querySelector(".bts-x").addEventListener("click", function () {
      try { sessionStorage.setItem(HIDE_KEY, "1"); } catch (e) {}
      [layer, crowd, banner, msg, style].forEach(function (el) { el.remove(); });
      document.body.classList.remove("bts-on", "bts-cheer");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
