/* ═══════════════════════════════════════════════════════════
   Service Worker — ช่วยน้ำท่วม PWA
   • ทำ App Shell caching เพื่อเปิดแอปได้แม้ไม่มีเน็ต
   • runtime cache สำหรับ CDN (Leaflet / ฟอนต์ / ไอคอน) และไทล์แผนที่
   • รับ Background Sync แล้วส่งข้อความให้หน้าเว็บ flush คิว SOS
   ═══════════════════════════════════════════════════════════ */

const VERSION = 'flood-help-v1';
const SHELL_CACHE = 'shell-' + VERSION;
const RUNTIME_CACHE = 'runtime-' + VERSION;
const TILE_CACHE = 'tiles-' + VERSION;
const TILE_MAX = 300; // จำกัดจำนวนไทล์แผนที่ที่เก็บ

// ไฟล์หลักของแอป (App Shell) — โหลดเก็บไว้ตั้งแต่ติดตั้ง
const SHELL_ASSETS = [
  './',
  './index.html',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './icon-maskable.png'
];

// ─── ติดตั้ง: เก็บ App Shell ───
self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_ASSETS).catch(() => { }))
      .then(() => self.skipWaiting())
  );
});

// ─── เปิดใช้งาน: ล้าง cache เวอร์ชันเก่า ───
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys().then((keys) => Promise.all(
      keys.filter((k) => ![SHELL_CACHE, RUNTIME_CACHE, TILE_CACHE].includes(k))
        .map((k) => caches.delete(k))
    )).then(() => self.clients.claim())
  );
});

// ─── ช่วยจำกัดขนาด cache ───
async function trimCache(name, max) {
  const cache = await caches.open(name);
  const keys = await cache.keys();
  if (keys.length > max) {
    for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
  }
}

// ─── กลยุทธ์ fetch ───
self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);

  // 1) การเปิดหน้าเว็บ (navigation) → network-first, ถ้าล่มใช้ index.html จาก cache
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req).catch(() => caches.match('./index.html').then((r) => r || caches.match('./')))
    );
    return;
  }

  // 2) ไทล์แผนที่ (OpenStreetMap) → cache-first เพื่อให้พื้นที่ที่เคยดูแล้วเปิดออฟไลน์ได้
  if (/tile\.openstreetmap\.org/.test(url.hostname)) {
    event.respondWith(
      caches.open(TILE_CACHE).then((cache) =>
        cache.match(req).then((hit) => hit || fetch(req).then((res) => {
          cache.put(req, res.clone());
          trimCache(TILE_CACHE, TILE_MAX);
          return res;
        }).catch(() => hit))
      )
    );
    return;
  }

  // 3) App Shell / ไฟล์ในโดเมนเดียวกัน → cache-first
  if (url.origin === self.location.origin) {
    event.respondWith(
      caches.match(req).then((hit) => hit || fetch(req).then((res) => {
        const copy = res.clone();
        caches.open(RUNTIME_CACHE).then((c) => c.put(req, copy));
        return res;
      }).catch(() => hit))
    );
    return;
  }

  // 4) CDN ภายนอก (Leaflet, ฟอนต์, Tabler, Nominatim, OSRM) → stale-while-revalidate
  event.respondWith(
    caches.open(RUNTIME_CACHE).then((cache) =>
      cache.match(req).then((hit) => {
        const network = fetch(req).then((res) => {
          if (res && (res.ok || res.type === 'opaque')) cache.put(req, res.clone());
          return res;
        }).catch(() => hit);
        return hit || network;
      })
    )
  );
});

// ─── Background Sync: ปลุกให้หน้าเว็บส่งคำขอที่ค้างไว้ ───
self.addEventListener('sync', (event) => {
  if (event.tag === 'sync-sos') {
    event.waitUntil(
      self.clients.matchAll({ includeUncontrolled: true, type: 'window' })
        .then((clients) => clients.forEach((c) => c.postMessage({ type: 'flush-sos' })))
    );
  }
});

// เผื่อกรณีต้องบังคับอัปเดต
self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});
