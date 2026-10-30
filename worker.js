// ATLAS3D Cloudflare Worker — anahtarsız harita servisleri için önbellekli API katmanı
//   /api/autocomplete  Photon (yazarken öneri)
//   /api/search        Nominatim (tam arama)
//   /api/reverse       Nominatim (koordinattan adres)
//   /api/lookup        Nominatim (OSM nesne detayı: telefon, web, saatler)
//   /api/route         OSRM (araç / yürüyüş / bisiklet rota)
//   /api/nearby        Nominatim (harita alanında kategori araması)
//   /api/config        isteğe bağlı anahtarlar + ziyaretçinin yaklaşık konumu (Cloudflare)
//   /api/health        durum
const UA = 'ATLAS3D/2.0 (+https://github.com/biraristo/ATLAS3D)';
const NOMINATIM = 'https://nominatim.openstreetmap.org';

const json = (data, status = 200, cache = 'no-store') => new Response(JSON.stringify(data), {
  status, headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': cache }
});

async function cachedFetch(upstream, ttl, ctx, origin) {
  const cache = caches.default;
  const key = new Request(upstream);
  const hit = await cache.match(key);
  if (hit) return hit;
  const r = await fetch(upstream, { headers: { 'User-Agent': UA, 'Referer': origin + '/', 'Accept': 'application/json', 'Accept-Language': 'tr' } });
  if (!r.ok) return json({ error: 'upstream ' + r.status }, 502);
  const res = new Response(await r.text(), {
    headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=' + ttl }
  });
  ctx.waitUntil(cache.put(key, res.clone()));
  return res;
}

const num = (v, d = 5) => { const n = Number(v); return Number.isFinite(n) ? n.toFixed(d) : null; };
const clean = s => (s || '').toString().trim().slice(0, 200);

const routes = {
  async '/api/autocomplete'(p, ctx, origin) {
    const q = clean(p.get('q')); if (q.length < 2) return json({ features: [] });
    let u = 'https://photon.komoot.io/api/?limit=7&lang=default&q=' + encodeURIComponent(q);
    const lat = num(p.get('lat'), 1), lon = num(p.get('lon'), 1);
    if (lat && lon) u += `&lat=${lat}&lon=${lon}&location_bias_scale=0.4`;
    return cachedFetch(u, 86400, ctx, origin);
  },
  async '/api/search'(p, ctx, origin) {
    const q = clean(p.get('q')); if (!q) return json([]);
    let u = `${NOMINATIM}/search?format=jsonv2&limit=10&addressdetails=1&extratags=1&accept-language=tr&q=` + encodeURIComponent(q);
    const vb = clean(p.get('viewbox')); if (/^[-\d.,]+$/.test(vb)) u += '&viewbox=' + vb;
    return cachedFetch(u, 86400, ctx, origin);
  },
  async '/api/reverse'(p, ctx, origin) {
    const lat = num(p.get('lat')), lon = num(p.get('lon')); if (!lat || !lon) return json({ error: 'lat/lon' }, 400);
    const zoom = Math.min(18, Math.max(3, parseInt(p.get('zoom') || '18', 10)));
    return cachedFetch(`${NOMINATIM}/reverse?format=jsonv2&addressdetails=1&extratags=1&namedetails=1&accept-language=tr&zoom=${zoom}&lat=${lat}&lon=${lon}`, 604800, ctx, origin);
  },
  async '/api/lookup'(p, ctx, origin) {
    const ids = clean(p.get('osm_ids')); if (!/^[NWR]\d+$/.test(ids)) return json([], 400);
    return cachedFetch(`${NOMINATIM}/lookup?format=jsonv2&addressdetails=1&extratags=1&namedetails=1&accept-language=tr&osm_ids=${ids}`, 604800, ctx, origin);
  },
  async '/api/route'(p, ctx, origin) {
    const svc = { car: 'routed-car', foot: 'routed-foot', bike: 'routed-bike' }[p.get('mode')];
    const c = (p.get('coords') || '').split(';').map(s => s.split(',').map(v => num(v, 6)));
    if (!svc || c.length !== 2 || c.some(x => x.length !== 2 || x.includes(null))) return json({ error: 'params' }, 400);
    const alt = p.get('alt') === '1' ? '3' : 'false';
    return cachedFetch(`https://routing.openstreetmap.de/${svc}/route/v1/driving/${c.map(x => x.join(',')).join(';')}?overview=full&geometries=geojson&steps=true&alternatives=${alt}`, 600, ctx, origin);
  },
  async '/api/nearby'(p, ctx, origin) {
    const q = clean(p.get('q')); const bb = (p.get('bbox') || '').split(',').map(v => num(v, 3));
    if (!q || bb.length !== 4 || bb.some(v => v === null)) return json([], 400);
    const [w, s, e, n] = bb;
    return cachedFetch(`${NOMINATIM}/search?format=jsonv2&limit=40&bounded=1&addressdetails=1&extratags=1&accept-language=tr&viewbox=${w},${n},${e},${s}&q=` + encodeURIComponent(q), 86400, ctx, origin);
  }
};

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') {
      return json({ status: 'ok', keylessMode: true, runtimeGoogleKeyConfigured: Boolean(env.GOOGLE_MAPS_API_KEY), runtimeMaptilerKeyConfigured: Boolean(env.MAPTILER_API_KEY) });
    }
    if (url.pathname === '/api/config') {
      const cf = request.cf || {};
      return json({
        maptilerKey: env.MAPTILER_API_KEY || '', googleTilesKey: env.GOOGLE_MAPS_API_KEY || '',
        ip: cf.latitude && cf.longitude ? { lat: Number(cf.latitude), lon: Number(cf.longitude), city: cf.city || '' } : null
      });
    }
    const handler = routes[url.pathname];
    if (handler) {
      try { return await handler(url.searchParams, ctx, url.origin); }
      catch (e) { return json({ error: String(e.message || e) }, 502); }
    }
    return env.ASSETS.fetch(request);
  }
};
