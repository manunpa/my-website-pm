/* ใช้ร่วมกันทุกหน้า: ลงทะเบียน Service Worker + ปรับสีแถบสถานะให้ตรงกับหน้า */
(function () {
  'use strict';

  // ---- ลงทะเบียน Service Worker (เฉพาะ https หรือ localhost) ----
  var secure = location.protocol === 'https:' ||
    location.hostname === 'localhost' || location.hostname === '127.0.0.1';
  if ('serviceWorker' in navigator && secure) {
    window.addEventListener('load', function () {
      navigator.serviceWorker.register('./sw.js', { scope: './', updateViaCache: 'none' })
        .then(function (reg) {
          // แอปที่เปิดค้างไว้นาน (โดยเฉพาะ iOS) ให้เช็กเวอร์ชันใหม่ทุกครั้งที่กลับมาเปิด
          document.addEventListener('visibilitychange', function () {
            if (document.visibilityState === 'visible') reg.update().catch(function () {});
          });
        })
        .catch(function (err) { console.warn('[PWA] ลงทะเบียน Service Worker ไม่สำเร็จ', err); });
    });
  }

  // ---- โหมดแอป (เปิดจากไอคอนหน้าจอโฮม): ล็อกการซูมทั้งหน้าให้เหมือนแอปจริง ----
  // แตะ 2 ที: ปิดด้วย CSS touch-action (pwa.css) · ถ่าง 2 นิ้ว / แตะช่องกรอกแล้ว iPhone ซูมเอง: ปิดตรงนี้
  // แผนที่ Leaflet ยังซูมแผนที่ด้วย 2 นิ้วได้ตามปกติ (แผนที่จัดการนิ้วเอง ไม่ใช่การซูมทั้งหน้า)
  var mq = function (q) { return window.matchMedia && window.matchMedia(q).matches; };
  var isApp = mq('(display-mode: standalone)') || mq('(display-mode: fullscreen)') || navigator.standalone === true;
  if (isApp) {
    document.documentElement.classList.add('pwa-app');
    var vp = document.querySelector('meta[name="viewport"]');
    if (vp && !/maximum-scale/.test(vp.content)) vp.setAttribute('content', vp.content + ', maximum-scale=1, user-scalable=no');
    // iOS ไม่สน user-scalable=no → กันท่าถ่าง 2 นิ้วซูมทั้งหน้าด้วยเหตุการณ์ gesture ของ Safari
    ['gesturestart', 'gesturechange'].forEach(function (ev) {
      document.addEventListener(ev, function (e) { e.preventDefault(); }, { passive: false });
    });
  }

  // ---- ปุ่ม "ติดตั้งเป็นแอป" (Android: Chrome / Samsung Internet) ----
  // เมนู "เพิ่มไปยังหน้าจอหลัก" บางแบบสร้างแค่ทางลัดเปิดเบราว์เซอร์ · ปุ่มนี้เรียกหน้าต่างติดตั้งแอปจริง (WebAPK) ของระบบ
  // แสดงเฉพาะหน้าเข้าสู่ระบบ/หน้า Hub เมื่อเบราว์เซอร์ยืนยันว่าติดตั้งได้ · ติดตั้งแล้ว/เปิดเป็นแอปอยู่ = ไม่แสดง · กด × ซ่อน 7 วัน
  var page = location.pathname.split('/').pop() || 'index.html';
  var installPage = page === 'index.html' || page === 'Access-Hub.html';
  var HIDE_KEY = 'pwaInstallHideUntil', installEvt = null, installBtn = null;
  function hiddenByUser() { try { return Date.now() < +(localStorage.getItem(HIDE_KEY) || 0); } catch (_) { return false; } }
  function hideInstall() { if (installBtn) { installBtn.remove(); installBtn = null; } }
  function showInstall() {
    if (isApp || !installPage || !installEvt || installBtn || hiddenByUser() || !document.body) return;
    var b = document.createElement('div');
    b.setAttribute('role', 'region'); b.setAttribute('aria-label', 'ติดตั้งแอป');
    b.style.cssText = 'position:fixed;left:50%;transform:translateX(-50%);bottom:calc(16px + env(safe-area-inset-bottom));z-index:2147483000;' +
      'display:flex;align-items:center;gap:4px;padding:6px 6px 6px 8px;border-radius:999px;background:#111a2d;color:#fff;' +
      'box-shadow:0 8px 24px rgba(0,0,0,.3);font:600 15px/1.2 system-ui,sans-serif;max-width:calc(100vw - 32px)';
    b.innerHTML = '<button type="button" data-act="install" style="all:unset;cursor:pointer;display:flex;align-items:center;gap:10px;padding:4px 8px">' +
      '<img src="./icons/icon-192.png" alt="" width="32" height="32" style="border-radius:8px;flex:none">' +
      '<span style="white-space:nowrap">ติดตั้งเป็นแอป</span></button>' +
      '<button type="button" data-act="close" aria-label="ไม่ใช่ตอนนี้" style="all:unset;cursor:pointer;width:32px;height:32px;display:grid;place-items:center;border-radius:50%;color:#b4c0d4;font-size:18px">×</button>';
    b.addEventListener('click', function (e) {
      var t = e.target.closest('button'); if (!t) return;
      if (t.dataset.act === 'close') { try { localStorage.setItem(HIDE_KEY, String(Date.now() + 7 * 864e5)); } catch (_) {} hideInstall(); return; }
      var ev = installEvt; if (!ev) return; installEvt = null; hideInstall();
      ev.prompt();
      ev.userChoice.then(function () {}, function () {});
    });
    document.body.appendChild(b); installBtn = b;
  }
  window.addEventListener('beforeinstallprompt', function (e) { e.preventDefault(); installEvt = e; showInstall(); });
  window.addEventListener('appinstalled', function () { installEvt = null; hideInstall(); });
  window.addEventListener('load', showInstall);

  // ---- theme-color ตามพื้นหลังจริงของหน้า (รองรับโหมดมืด/สว่างที่สลับเอง) ----
  function syncThemeColor() {
    var meta = document.querySelector('meta[name="theme-color"]');
    if (!meta || !document.body) return;
    var bg = getComputedStyle(document.body).backgroundColor;
    if (bg && bg !== 'transparent' && bg !== 'rgba(0, 0, 0, 0)') meta.setAttribute('content', bg);
  }
  var timer;
  function later() { clearTimeout(timer); timer = setTimeout(syncThemeColor, 400); }
  window.addEventListener('load', function () {
    syncThemeColor();
    var opts = { attributes: true, attributeFilter: ['class', 'data-theme'] };
    try {
      new MutationObserver(later).observe(document.documentElement, opts);
      new MutationObserver(later).observe(document.body, opts);
    } catch (_) { /* เบราว์เซอร์เก่า: ใช้ค่าเริ่มต้นใน meta */ }
  });
})();
