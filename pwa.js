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
