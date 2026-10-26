// ATLAS3D Cloudflare Worker
// - Statik dosyaları (index.html, app.js, style.css) sunar
// - /api/search : OpenStreetMap Nominatim yer araması (anahtarsız) için önbellekli proxy
// - /api/config : İsteğe bağlı anahtarlar (MAPTILER_API_KEY, GOOGLE_MAPS_API_KEY) tanımlıysa ön yüze iletir
// - /api/health : Durum kontrolü
const json = (data, status = 200, extra = {}) => new Response(JSON.stringify(data), {
  status,
  headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store', ...extra }
});

async function search(request, url, ctx) {
  const q = (url.searchParams.get('q') || '').trim().slice(0, 200);
  if (!q) return json([], 400);
  const upstream = 'https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=tr&q=' + encodeURIComponent(q);
  const cache = caches.default;
  const cacheKey = new Request(upstream);
  let res = await cache.match(cacheKey);
  if (!res) {
    const r = await fetch(upstream, {
      headers: {
        // Nominatim kullanım politikası: tanımlayıcı User-Agent ve Referer zorunlu
        'User-Agent': 'ATLAS3D/1.0 (+https://github.com/biraristo/ATLAS3D)',
        'Referer': url.origin + '/',
        'Accept': 'application/json'
      }
    });
    if (!r.ok) return json({ error: 'upstream ' + r.status }, 502);
    res = new Response(await r.text(), {
      headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=86400' }
    });
    ctx.waitUntil(cache.put(cacheKey, res.clone()));
  }
  return res;
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') {
      return json({
        status: 'ok',
        keylessMode: true,
        runtimeGoogleKeyConfigured: Boolean(env.GOOGLE_MAPS_API_KEY),
        runtimeMaptilerKeyConfigured: Boolean(env.MAPTILER_API_KEY)
      });
    }
    if (url.pathname === '/api/config') {
      return json({ maptilerKey: env.MAPTILER_API_KEY || '', googleTilesKey: env.GOOGLE_MAPS_API_KEY || '' });
    }
    if (url.pathname === '/api/search') {
      try { return await search(request, url, ctx); }
      catch (e) { return json({ error: String(e.message || e) }, 502); }
    }
    return env.ASSETS.fetch(request);
  }
};
