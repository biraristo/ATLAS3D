// ATLAS3D service worker: uygulama kabuğu ve harita karoları için önbellek.
// Kabuk dosyaları "önce ağ" ile gelir (güncellemeler hemen yansır), çevrimdışıyken önbellekten açılır.
// Harita/arazi karoları "önce önbellek" ile gelir: gezilen bölgeler hızlı ve çevrimdışı da açılır.
const VERSION = 'v7'; // kabuk dosya listesi değişince artırın: eski önbellekler silinir
const SHELL = 'atlas3d-shell-' + VERSION;
const LIBS = 'atlas3d-libs-' + VERSION;
const TILES = 'atlas3d-tiles-' + VERSION;
const TILE_LIMIT = 2500;
const SHELL_FILES = ['/', '/style.css', '/app.js', '/terrain.js', '/analysis.js', '/tolls.js', '/ferries.js', '/traffic.js', '/fuel.js', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(SHELL_FILES.map(u => new Request(u, { cache: 'reload' })))).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil((async () => {
    const keep = [SHELL, LIBS, TILES];
    for (const k of await caches.keys()) if (k.startsWith('atlas3d-') && !keep.includes(k)) await caches.delete(k);
    await self.clients.claim();
  })());
});

const isTile = u =>
  (u.hostname === 'tiles.openfreemap.org' && !/\/styles\/|\/planet$/.test(u.pathname)) ||
  u.hostname === 's3.amazonaws.com' && u.pathname.startsWith('/elevation-tiles-prod/') ||
  u.hostname === 'server.arcgisonline.com';
const isLib = u => ['unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net'].includes(u.hostname);

async function networkFirst(req, cacheName, timeout = 4000) {
  const cache = await caches.open(cacheName);
  try {
    const res = await Promise.race([fetch(req), new Promise((_, rej) => setTimeout(() => rej(new Error('timeout')), timeout))]);
    if (res.ok) cache.put(req, res.clone());
    return res;
  } catch (err) {
    const hit = await cache.match(req, { ignoreSearch: req.mode === 'navigate' }) || (req.mode === 'navigate' ? await cache.match('/') : null);
    if (hit) return hit;
    throw err;
  }
}

async function cacheFirst(req, cacheName, trim) {
  const cache = await caches.open(cacheName);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) { await cache.put(req, res.clone()); if (trim && Math.random() < 0.02) trimCache(cache, TILE_LIMIT); }
  return res;
}

async function trimCache(cache, max) {
  const keys = await cache.keys();
  for (let i = 0; i < keys.length - max; i++) await cache.delete(keys[i]);
}

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const u = new URL(req.url);
  if (u.origin === self.location.origin) {
    if (u.pathname.startsWith('/api/')) return; // arama ve rota her zaman canlı
    e.respondWith(networkFirst(req, SHELL));
  } else if (isTile(u)) {
    e.respondWith(cacheFirst(req, TILES, true));
  } else if (isLib(u)) {
    e.respondWith(cacheFirst(req, LIBS));
  } else if (u.hostname === 'tiles.openfreemap.org') {
    e.respondWith(networkFirst(req, LIBS)); // stil ve karo listesi: güncel olanı al, yoksa önbellek
  }
});
