/* Service Worker ของ Access Hub
 *
 * - ไฟล์ในโดเมนเดียวกัน (HTML/JS/CSS/ไอคอน): Network-First
 *   ดึงจากเน็ตก่อนเสมอ (ข้าม HTTP cache ของเบราว์เซอร์) แล้วเก็บสำเนาไว้
 *   ถ้าเน็ตล่ม/ช้าเกินกำหนด จึงใช้สำเนาใน Cache แทน
 * - Request ข้ามโดเมน (Firebase, Apps Script, Google Fonts, CDN, แผนที่ ฯลฯ)
 *   ไม่ถูกแตะเลย ปล่อยให้เบราว์เซอร์จัดการเอง ข้อมูลสดจึงไม่ถูก Cache
 *
 * อัปเดตเวอร์ชัน: เปลี่ยน VERSION ทุกครั้งที่อยากล้าง Cache เก่าทิ้งทั้งหมด
 */
const VERSION = '2026-11-23.1';
const PREFIX = 'access-hub-';
const CACHE = PREFIX + VERSION;

// ไฟล์ตั้งต้นที่ควรมีไว้ใช้ตอนออฟไลน์ (ถ้าไฟล์ใดโหลดไม่ได้ จะข้ามไป ไม่ทำให้ติดตั้งล้ม)
const PRECACHE = [
  './',
  './index.html',
  './Access-Hub.html',
  './manifest.json',
  './pwa.css',
  './pwa.js',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

// หน้าเว็บรอเน็ตได้นานสุดเท่านี้ ถ้ามีสำเนาใน Cache อยู่แล้วจะใช้สำเนาก่อน
const NAV_TIMEOUT_MS = 4000;

self.addEventListener('install', (event) => {
  event.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    await Promise.all(PRECACHE.map(async (url) => {
      try {
        const res = await fetch(url, { cache: 'no-cache' });
        if (res.ok) await cache.put(url, res);
      } catch (_) { /* ออฟไลน์ตอนติดตั้ง: ข้ามไฟล์นี้ */ }
    }));
    await self.skipWaiting();
  })());
});

self.addEventListener('activate', (event) => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys
      .filter((k) => k.startsWith(PREFIX) && k !== CACHE)
      .map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  // ข้ามโดเมน / ไม่ใช่ http(s) → ไม่ยุ่ง (ไม่ Cache API ภายนอก)
  if (url.origin !== self.location.origin) return;
  // ไม่ Cache ตัว Service Worker เอง
  if (url.pathname.endsWith('/sw.js')) return;

  event.respondWith(networkFirst(event, req));
});

async function networkFirst(event, req) {
  const cache = await caches.open(CACHE);
  const isPage = req.mode === 'navigate';

  const network = fetch(req, { cache: 'no-cache' }).then((res) => {
    // เก็บเฉพาะคำตอบที่สมบูรณ์จากโดเมนตัวเอง
    if (res && res.ok && res.type === 'basic') {
      const copy = res.clone();
      event.waitUntil(cache.put(req, copy).catch(() => {}));
    }
    return res;
  });

  if (isPage) {
    const cached = await matchCached(cache, req);
    if (cached) {
      // สัญญาณช้า: รอไม่เกิน NAV_TIMEOUT_MS แล้วใช้สำเนา (เน็ตยังโหลดต่อเบื้องหลังเพื่ออัปเดต Cache)
      const timeout = new Promise((resolve) => setTimeout(() => resolve(cached), NAV_TIMEOUT_MS));
      event.waitUntil(network.catch(() => {}));
      return Promise.race([network.catch(() => cached), timeout]);
    }
  }

  try {
    return await network;
  } catch (err) {
    const cached = await matchCached(cache, req);
    if (cached) return cached;
    if (isPage) {
      const home = (await cache.match('./')) || (await cache.match('./index.html'));
      if (home) return home;
      return offlinePage();
    }
    throw err;
  }
}

// หาในเวอร์ชันปัจจุบันก่อน ไม่เจอค่อยลองแบบไม่สน ?query (เช่น auth.js?v=...)
async function matchCached(cache, req) {
  return (await cache.match(req)) || (await cache.match(req, { ignoreSearch: true }));
}

function offlinePage() {
  const html = '<!doctype html><html lang="th"><meta charset="utf-8">' +
    '<meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover">' +
    '<title>ออฟไลน์</title>' +
    '<body style="margin:0;min-height:100vh;display:grid;place-items:center;' +
    'font-family:system-ui,sans-serif;background:#111a2d;color:#e1e7f0;text-align:center;padding:24px">' +
    '<div><h1 style="font-size:1.3rem">ไม่มีการเชื่อมต่ออินเทอร์เน็ต</h1>' +
    '<p style="opacity:.75">ตรวจสอบสัญญาณแล้วลองใหม่อีกครั้ง</p>' +
    '<button onclick="location.reload()" style="font:inherit;padding:10px 20px;border-radius:999px;' +
    'border:0;background:#f8d21c;color:#111a2d;font-weight:600">ลองใหม่</button></div></body></html>';
  return new Response(html, { status: 503, headers: { 'Content-Type': 'text/html; charset=utf-8' } });
}
