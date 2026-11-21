/* =====================================================================
   ลูกเล่นงานวิ่ง The Ghost Run 3# ไปวิ่งกาญ! (ชั่วคราว 30 พ.ย. – 2 ธ.ค.) สำหรับหน้า Access Hub และหน้าเข้าสู่ระบบ
   - งานเปิดรับสมัคร 1 ธ.ค. 69 – 6 ม.ค. 70 · วิ่ง 21 ก.พ. 70 ที่ลาน อบจ.กาญจนบุรี · 3 / 5 / 10 / 21 กม.
   - เปิดเองอัตโนมัติเฉพาะช่วงวันที่กำหนดใน FESTIVAL.start / FESTIVAL.end (เวลาไทย)
   - ทดลองดูนอกช่วงวัน: เติม ?festival=ghostrun ท้าย URL (เลือกวันได้ด้วย &ghostday=30 / 1 / 2)
   - เลิกใช้: ลบบรรทัด <script src="./festival-ghostrun.js"> ใน Access-Hub.html และ index.html
   - ไม่บังเมาส์/คลิกของหน้าเดิม และเคารพการตั้งค่า "ลดการเคลื่อนไหว" ของเครื่อง
   - ภาพวาดเองทั้งหมด (ผีผ้าขาวน่ารัก สะพานข้ามแม่น้ำแควแบบเงา ภูเขา) ไม่ใช้โลโก้หรือภาพทางการของงาน
   ===================================================================== */
(function () {
  var FESTIVAL = {
    start: "2026-11-30T00:00:00+07:00",   // ต่อจากธีมงานวิ่ง ATM (หมด 30 พ.ย. 00:00)
    end:   "2026-12-03T00:00:00+07:00",   // หมดเขตอัตโนมัติ (แสดง 30 พ.ย. – 2 ธ.ค.) ต่อด้วยธีม BTS
    open:  "2026-12-01T00:00:00+07:00",   // วันเปิดรับสมัคร
    title: "The Ghost Run 3# ไปวิ่งกาญ!",
    info:  "วิ่ง 21 ก.พ. 70 · ลาน อบจ.กาญจนบุรี · 3 / 5 / 10 / 21 กม.",
    url:   "https://www.thebravo.run/event/TheGhostRun3%E0%B8%9C%E0%B8%B5%E0%B8%A3%E0%B8%B1%E0%B8%81%E0%B8%97%E0%B8%B8%E0%B8%81%E0%B9%80%E0%B8%98%E0%B8%AD%E0%B9%80%E0%B8%9C%E0%B8%A5%E0%B8%AD%E0%B8%A3%E0%B8%B1%E0%B8%81%E0%B8%97%E0%B8%B8%E0%B8%81%E0%B8%97%E0%B8%B5?id=MTE1"
  };

  var forced = /[?&]festival=ghostrun\b/.test(location.search);
  var now = Date.now();
  if (!forced && (now < Date.parse(FESTIVAL.start) || now >= Date.parse(FESTIVAL.end))) return;

  var HIDE_KEY = "festival-ghostrun-2569-hidden";
  try { if (!forced && sessionStorage.getItem(HIDE_KEY) === "1") return; } catch (e) {}

  // ข้อความตามวัน (ทดลองด้วย &ghostday=30 / 1 / 2)
  var m = location.search.match(/[?&]ghostday=(\d+)/);
  var day = m ? +m[1] : +new Date(now + 7 * 3600e3).toISOString().slice(8, 10);
  var status = day === 30 ? "พรุ่งนี้เปิดรับสมัคร! 1 ธ.ค. – 6 ม.ค. 70"
             : day === 1  ? "เปิดรับสมัครวันนี้! ถึง 6 ม.ค. 70"
             :              "เปิดรับสมัครแล้ว ถึง 6 ม.ค. 70";
  var opened = forced ? day !== 30 : now >= Date.parse(FESTIVAL.open);

  var still = window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------------- CSS ---------------- */
  var css = [
    ":root{--gr-red:#b3121b;--gr-red2:#e23b3b;--gr-glow:rgba(226,59,59,.22);--gr-ink:#2a0f14;--gr-fog:rgba(255,255,255,.55)}",
    ":root[data-theme='dark']{--gr-glow:rgba(226,59,59,.30);--gr-ink:#6b2a33;--gr-fog:rgba(255,255,255,.10)}",
    "body.gr-on{padding-bottom:110px}",
    ".gr-layer{position:fixed;inset:0;pointer-events:none;z-index:-1;overflow:hidden}",
    ".gr-sky{position:absolute;inset:0;background:radial-gradient(1200px 520px at 50% 118%,var(--gr-glow),transparent 70%),radial-gradient(520px 300px at 88% -8%,var(--gr-glow),transparent 70%)}",
    ".gr-moon{position:absolute;top:7vh;right:7vw;width:64px;height:64px;border-radius:50%;background:radial-gradient(circle at 38% 36%,#fff5f0,#ffd2c8 55%,#f29b8d);",
    "box-shadow:0 0 40px 12px rgba(242,155,141,.35);opacity:.9}",
    /* ผีลอยบนฟ้า */
    ".gr-float{position:absolute;width:44px;opacity:.0;animation:gr-drift linear infinite}",
    ".gr-float svg{display:block;width:100%;animation:gr-bob 2.6s ease-in-out infinite alternate}",
    "@keyframes gr-drift{0%{transform:translate(0,0);opacity:0}12%{opacity:.75}88%{opacity:.75}100%{transform:translate(var(--dx),var(--dy));opacity:0}}",
    "@keyframes gr-bob{from{transform:translateY(-6px) rotate(-6deg)}to{transform:translateY(6px) rotate(6deg)}}",
    /* ฉากด้านล่าง: ภูเขา + สะพานข้ามแม่น้ำแคว + ผีวิ่ง */
    ".gr-scene{position:fixed;left:0;right:0;bottom:0;height:104px;pointer-events:none;z-index:3;overflow:hidden}",
    ".gr-scene svg.gr-land{position:absolute;left:0;bottom:0;width:100%;height:100%}",
    ".gr-fog{position:absolute;left:-10%;right:-10%;bottom:0;height:46px;background:linear-gradient(to top,var(--gr-fog),transparent);filter:blur(6px)}",
    ".gr-runner{position:absolute;bottom:47px;left:0;width:30px;animation:gr-run linear infinite}",
    ".gr-runner svg{display:block;width:100%;animation:gr-bob .45s ease-in-out infinite alternate}",
    "@keyframes gr-run{from{transform:translateX(-60px)}to{transform:translateX(calc(100vw + 60px))}}",
    "body.gr-boo .gr-runner{animation-duration:3.2s!important}",
    "body.gr-boo .gr-float{opacity:.95}",
    /* แบนเนอร์ */
    ".gr-banner{display:flex;align-items:center;gap:12px;flex-wrap:wrap;margin:-28px 0 34px;padding:12px 14px 12px 16px;",
    "border:1px solid var(--line,#e2e2de);border-radius:14px;background:var(--surface,#fff);box-shadow:var(--shadow,0 8px 24px -10px rgba(0,0,0,.18));position:relative;z-index:1;",
    "background-image:linear-gradient(90deg,rgba(179,18,27,.10),transparent 60%)}",
    ".gr-banner .gr-ico{width:34px;flex-shrink:0}.gr-banner .gr-ico svg{display:block;width:100%}",
    ".gr-banner .gr-txt{flex:1;min-width:180px}.gr-banner.gr-compact{margin:16px 24px 0;box-shadow:none}.gr-banner.gr-compact .gr-txt{min-width:140px}",
    ".gr-banner b{display:block;font-weight:600;font-size:1rem;color:var(--gr-red)}",
    ":root[data-theme='dark'] .gr-banner b{color:var(--gr-red2)}",
    ".gr-banner .gr-st{display:inline-block;margin:2px 0 1px;padding:1px 9px;border-radius:999px;font-size:.78rem;font-weight:600;color:#fff;background:var(--gr-red)}",
    ".gr-banner .gr-st.pulse{animation:gr-pulse 1.6s ease-in-out infinite}",
    "@keyframes gr-pulse{50%{box-shadow:0 0 0 6px rgba(226,59,59,.18)}}",
    ".gr-banner small{display:block;color:var(--muted,#7a7a75);font-weight:300;font-size:.82rem}",
    ".gr-btns{display:flex;gap:8px;align-items:center}",
    ".gr-btn{font:inherit;font-size:.85rem;font-weight:500;height:36px;padding:0 14px;border-radius:999px;cursor:pointer;display:inline-flex;align-items:center;text-decoration:none;",
    "border:1px solid var(--gr-red);background:var(--gr-red);color:#fff;transition:transform .2s;white-space:nowrap}",
    ".gr-btn.ghost{background:transparent;color:var(--gr-red)}:root[data-theme='dark'] .gr-btn.ghost{color:var(--gr-red2);border-color:var(--gr-red2)}",
    ".gr-btn:hover{transform:translateY(-1px)}.gr-btn:active{transform:scale(.97)}",
    ".gr-x{font:inherit;width:32px;height:32px;border-radius:50%;border:1px solid var(--line,#e2e2de);background:transparent;color:var(--muted,#7a7a75);cursor:pointer;flex-shrink:0}",
    ".gr-x:hover{color:var(--text,#1a1a1a);border-color:var(--muted,#7a7a75)}",
    ".gr-msg{position:fixed;left:50%;bottom:118px;transform:translateX(-50%);z-index:4;font-size:.85rem;padding:6px 14px;border-radius:999px;",
    "background:var(--surface,#fff);border:1px solid var(--line,#e2e2de);box-shadow:var(--shadow,0 8px 24px -10px rgba(0,0,0,.18));opacity:0;transition:opacity .4s;pointer-events:none;white-space:nowrap}",
    ".gr-msg.show{opacity:1}",
    "@media(max-width:520px){.gr-banner{margin-top:-16px}.gr-moon{width:46px;height:46px}.gr-msg{white-space:normal;text-align:center;width:max-content;max-width:90vw}}",
    /* จอเตี้ย (มือถือแนวนอน/หน้าล็อกอินสั้น): ฉากล่างเตี้ยลง ไม่บังฟอร์ม */
    "@media(max-height:700px){.gr-scene{height:70px}.gr-runner{bottom:31px;width:24px}body.gr-on{padding-bottom:76px}.gr-msg{bottom:84px}}",
    "@media(prefers-reduced-motion:reduce){.gr-float,.gr-runner{display:none}.gr-st.pulse{animation:none}}"
  ].join("");

  var style = document.createElement("style");
  style.id = "gr-style";
  style.textContent = css;
  document.head.appendChild(style);

  // ผีผ้าขาวน่ารัก (วาดเอง) — heart=true ถือหัวใจสีแดง "ผีรักทุกเธอ"
  function ghost(heart) {
    return '<svg viewBox="0 0 40 46" aria-hidden="true">' +
      '<path d="M20 2C9.5 2 4 10.5 4 21.5V42l5.3-4 5.3 4 5.4-4 5.4 4 5.3-4L36 42V21.5C36 10.5 30.5 2 20 2z" fill="#fff" stroke="#3a1d22" stroke-opacity=".25" stroke-width="1.4"/>' +
      '<ellipse cx="14.5" cy="19" rx="2.6" ry="3.4" fill="#2a0f14"/><ellipse cx="25.5" cy="19" rx="2.6" ry="3.4" fill="#2a0f14"/>' +
      '<circle cx="15.3" cy="17.8" r=".9" fill="#fff"/><circle cx="26.3" cy="17.8" r=".9" fill="#fff"/>' +
      '<ellipse cx="11" cy="25" rx="2.4" ry="1.4" fill="#ff8a8a" opacity=".55"/><ellipse cx="29" cy="25" rx="2.4" ry="1.4" fill="#ff8a8a" opacity=".55"/>' +
      '<path d="M17.5 26.5q2.5 2.4 5 0" fill="none" stroke="#2a0f14" stroke-width="1.5" stroke-linecap="round"/>' +
      (heart ? '<path d="M33 30c-1.6-2.2-5-1.2-4.6 1.6.3 2 2.6 3.4 4.6 5 2-1.6 4.3-3 4.6-5 .4-2.8-3-3.8-4.6-1.6z" fill="#e23b3b"/>' : "") +
      '</svg>';
  }

  // ภูเขา + สะพานเหล็กโค้ง (เงา) ข้ามแม่น้ำ — วาดเองแบบเรียบ ๆ
  function landSvg() {
    var W = 1440, deck = 58, arches = "", piers = "";
    for (var x = 120; x < W - 120; x += 150) {
      arches += "M" + x + " " + deck + " Q" + (x + 75) + " " + (deck - 34) + " " + (x + 150) + " " + deck + " ";
      for (var k = 1; k < 5; k++) {
        var px = x + k * 30, t = k / 5, ty = deck - 34 * 2 * t * (1 - t);  // ความสูงโค้งที่จุดนั้น
        arches += "M" + px + " " + deck + " L" + px + " " + ty.toFixed(1) + " ";
      }
      piers += '<rect x="' + (x - 4) + '" y="' + deck + '" width="8" height="' + (104 - deck) + '" />';
    }
    piers += '<rect x="' + (W - 124) + '" y="' + deck + '" width="8" height="' + (104 - deck) + '" />';
    return '<svg class="gr-land" viewBox="0 0 1440 104" preserveAspectRatio="xMidYMax slice" aria-hidden="true">' +
      '<path d="M0 60 L90 30 L170 52 L260 18 L360 50 L470 26 L560 48 L700 14 L820 46 L930 24 L1040 50 L1150 20 L1260 48 L1360 30 L1440 44 V104 H0Z" fill="var(--gr-red)" opacity=".10"/>' +
      '<path d="M0 104 V' + (deck + 14) + ' Q720 ' + (deck + 6) + ' 1440 ' + (deck + 14) + ' V104Z" fill="var(--gr-red)" opacity=".08"/>' +
      '<g fill="var(--gr-ink)" opacity=".78">' + piers + '<rect x="100" y="' + (deck - 3) + '" width="' + (W - 200) + '" height="5"/></g>' +
      '<path d="' + arches + '" fill="none" stroke="var(--gr-ink)" stroke-opacity=".78" stroke-width="3"/>' +
      '</svg>';
  }

  /* ---------------- สร้างฉาก ---------------- */
  function build() {
    document.body.classList.add("gr-on");

    var layer = document.createElement("div");
    layer.className = "gr-layer";
    layer.setAttribute("aria-hidden", "true");
    layer.innerHTML = '<div class="gr-sky"></div><div class="gr-moon"></div>';
    document.body.insertBefore(layer, document.body.firstChild);

    if (!still) {
      for (var i = 0; i < 6; i++) {
        var f = document.createElement("span");
        f.className = "gr-float";
        f.innerHTML = ghost(i % 2 === 0);
        f.style.left = (4 + Math.random() * 86) + "vw";
        f.style.top = (12 + Math.random() * 55) + "vh";
        f.style.width = (30 + Math.random() * 22) + "px";
        f.style.setProperty("--dx", (Math.random() * 160 - 80) + "px");
        f.style.setProperty("--dy", (-60 - Math.random() * 120) + "px");
        f.style.animationDuration = (12 + Math.random() * 10) + "s";
        f.style.animationDelay = (-Math.random() * 20) + "s";
        layer.appendChild(f);
      }
    }

    // ฉากล่าง: สะพาน + หมอก + ผีวิ่งข้ามสะพาน
    var scene = document.createElement("div");
    scene.className = "gr-scene";
    scene.setAttribute("aria-hidden", "true");
    var runners = "";
    if (!still) {
      [[22, 0, true], [27, -9, false], [19, -15, true], [31, -4, false]].forEach(function (r) {
        runners += '<span class="gr-runner" style="animation-duration:' + r[0] + 's;animation-delay:' + r[1] + 's">' + ghost(r[2]) + '</span>';
      });
    }
    scene.innerHTML = landSvg() + runners + '<div class="gr-fog"></div>';
    document.body.appendChild(scene);

    // แบนเนอร์: ถ้าหน้าไหนมี <div data-lk-banner> จะวางตรงนั้น ไม่งั้นวางใต้ <header>
    var slot = document.querySelector("[data-lk-banner]");
    var header = slot ? null : document.querySelector("header");
    var banner = document.createElement("div");
    banner.className = "gr-banner" + (slot ? " gr-compact" : "");
    banner.innerHTML =
      '<span class="gr-ico" aria-hidden="true">' + ghost(true) + '</span>' +
      '<div class="gr-txt"><b>' + FESTIVAL.title + '</b><span class="gr-st' + (day === 1 ? " pulse" : "") + '">' + status + '</span><small>' + FESTIVAL.info + '</small></div>' +
      '<div class="gr-btns">' +
        '<a class="gr-btn" href="' + FESTIVAL.url + '" target="_blank" rel="noopener">' + (opened ? "สมัคร / ดูรายละเอียด ↗" : "ดูรายละเอียดงาน ↗") + '</a>' +
        (still ? "" : '<button type="button" class="gr-btn ghost">เรียกผี 👻</button>') +
      '</div>' +
      '<button type="button" class="gr-x" aria-label="ซ่อนลูกเล่นวันนี้" title="ซ่อนลูกเล่นวันนี้">✕</button>';
    if (slot) slot.appendChild(banner);
    else if (header && header.parentNode) header.parentNode.insertBefore(banner, header.nextSibling);

    var boos = ["ผีรักทุกเธอ เผลอรักทุกที 👻", "ตี 4 ปล่อยตัว ผีตื่นเช้ากว่าคน", "ไปวิ่งกาญ! 21 ก.พ. นี้ เจอกันที่ลาน อบจ.",
                "ฮาล์ฟ 21 กม. ตัดเวลา 3 ชม. ผียังวิ่งทัน", "ขอให้วันนี้ไม่มีเคสผีหลอกในระบบ", "ขอให้ GPS ทุกคันไม่หลอนวันนี้"];
    var msg = document.createElement("div");
    msg.className = "gr-msg";
    document.body.appendChild(msg);
    var msgTimer, booTimer;
    var boo = banner.querySelector(".gr-btn.ghost");
    if (boo) boo.addEventListener("click", function () {
      document.body.classList.add("gr-boo");
      clearTimeout(booTimer);
      booTimer = setTimeout(function () { document.body.classList.remove("gr-boo"); }, 3200);
      msg.textContent = boos[Math.floor(Math.random() * boos.length)];
      msg.classList.add("show");
      clearTimeout(msgTimer);
      msgTimer = setTimeout(function () { msg.classList.remove("show"); }, 2800);
    });

    banner.querySelector(".gr-x").addEventListener("click", function () {
      try { sessionStorage.setItem(HIDE_KEY, "1"); } catch (e) {}
      [layer, scene, banner, msg, style].forEach(function (el) { el.remove(); });
      document.body.classList.remove("gr-on", "gr-boo");
    });
  }

  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", build);
  else build();
})();
