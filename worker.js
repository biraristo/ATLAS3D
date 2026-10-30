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
    const base = `https://routing.openstreetmap.de/${svc}/route/v1/driving/`, q = '?overview=full&geometries=geojson&steps=true';
    if (p.get('alt') !== '1') return cachedFetch(base + c.map(x => x.join(',')).join(';') + q + '&alternatives=false', 600, ctx, origin);
    const key = new Request('https://atlas3d.cache/route-alt/' + svc + '/' + c.map(x => x.join(',')).join(';'));
    const hit = p.get('debug') === '1' ? null : await caches.default.match(key);
    if (hit) return hit;
    let lastErr = '', busy = false;
    const get = async coords => {
      const r = await fetch(base + coords.map(x => x.join(',')).join(';') + q + (coords.length === 2 ? '&alternatives=3' : '&alternatives=false'), { headers: { 'User-Agent': UA } });
      if (!r.ok) { lastErr = 'HTTP ' + r.status; if (r.status === 429 || r.status >= 500) busy = true; return null; }
      const d = await r.json(); if (d.code !== 'Ok') lastErr = d.code; return d.code === 'Ok' ? d : null;
    };
    const main = await get(c);
    if (!main) return json({ code: lastErr === 'NoRoute' ? 'NoRoute' : 'Error', message: lastErr, routes: [] }, lastErr === 'NoRoute' ? 200 : 502);
    const routes = main.routes.slice(0, 3);
    if (routes.length < 3) {
      // Ücretsiz OSRM uzun yolda nadiren alternatif verir: düz çizginin iki yanına ara noktalar koyup farklı güzergâhlar ara
      const [A, B] = c.map(x => x.map(Number)), lat0 = (A[1] + B[1]) / 2 * Math.PI / 180, kx = Math.cos(lat0);
      const dx = (B[0] - A[0]) * kx, dy = B[1] - A[1], L = Math.hypot(dx, dy) || 1e-9, nx = -dy / L, ny = dx / L;
      const vias = [[0.5, 0.05], [0.5, -0.05], [0.5, 0.13], [0.5, -0.13], [0.33, 0.09], [0.67, -0.09], [0.33, -0.09], [0.67, 0.09], [0.5, 0.25], [0.5, -0.25]].map(([t, o]) =>
        [+(A[0] + (B[0] - A[0]) * t + nx * o * L / kx).toFixed(6), +(A[1] + (B[1] - A[1]) * t + ny * o * L).toFixed(6)]);
      const fastest = routes[0];
      const cell = (pt, s) => Math.floor(pt[0] / s) + ':' + Math.floor(pt[1] / s);
      const cellSet = (coords, s) => { const set = new Set(); for (const p of coords) set.add(cell(p, s)); return set; };
      const near = (set, pt, s) => { const x = Math.floor(pt[0] / s), y = Math.floor(pt[1] / s); for (let i = -1; i <= 1; i++) for (let j = -1; j <= 1; j++) if (set.has((x + i) + ':' + (y + j))) return true; return false; };
      const segLen = (a, b) => Math.hypot((b[0] - a[0]) * kx, b[1] - a[1]);
      const overlap = (coords, set) => { let tot = 0, on = 0; for (let i = 1; i < coords.length; i++) { const l = segLen(coords[i - 1], coords[i]); tot += l; if (near(set, coords[i], 0.0012)) on += l; } return tot ? on / tot : 1; };
      const accepted = routes.map(r => cellSet(r.geometry.coordinates, 0.0012));
      // Yola girip aynı yoldan geri çıkan sapma (ara nokta tali yolda kalırsa): sapmanın başladığı indeksi döndür, yoksa -1
      const spurAt = (coords, via) => {
        if (!via) return -1; let iv = 0, best = Infinity;
        coords.forEach((p, i) => { const d = segLen(p, via); if (d < best) { best = d; iv = i; } });
        const span = 0.05, after = []; let acc = 0;
        for (let i = iv; i < coords.length - 1 && acc < span; i++) { acc += segLen(coords[i], coords[i + 1]); after.push(coords[i + 1]); }
        if (after.length < 3) return -1;
        const set = cellSet(after, 0.0004); let j = -1; acc = 0;
        for (let i = iv - 1; i >= 0 && acc < span; i--) { acc += segLen(coords[i], coords[i + 1]); if (near(set, coords[i], 0.0004)) j = i; }
        return j >= 0 && (iv - j) > 2 ? j : -1;
      };
      const spur = (coords, via) => spurAt(coords, via) >= 0;
      const dbg = [];
      const consider = ({ r, via }) => {
        const co = r.geometry.coordinates;
        if (p.get('debug') === '1') dbg.push({ km: Math.round(r.distance / 1000), min: Math.round(r.duration / 60), ratio: +(r.duration / fastest.duration).toFixed(2), ov: accepted.map(s => +overlap(co, s).toFixed(2)), spur: spur(co, via) });
        if (routes.length >= 3 || r.duration > fastest.duration * 1.4 || r.distance > fastest.distance * 1.5) return;
        if (accepted.some(set => overlap(co, set) > 0.78) || spur(co, via)) return;
        r.viaAlt = true; routes.push(r); accepted.push(cellSet(co, 0.0012));
      };
      // Topluluk sunucusunu yormamak için ara noktaları önem sırasıyla üçerli gruplar halinde dene; yeterli alternatif bulununca dur
      for (let k = 0; k < vias.length && routes.length < 3 && !busy; k += 3) {
        const got = (await Promise.all(vias.slice(k, k + 3).map(v => get([A, v, B]).catch(() => null)))).filter(Boolean).map(d => ({ r: d.routes[0], via: d.waypoints?.[1]?.location }));
        // Sapmalı adayı, sapmanın hemen öncesindeki (ana güzergâh üzerindeki) noktadan geçecek şekilde yeniden iste
        const fixes = await Promise.all(got.map(cnd => { const j = spurAt(cnd.r.geometry.coordinates, cnd.via); return j >= 0 && !busy ? get([A, cnd.r.geometry.coordinates[Math.max(0, j - 2)], B]).catch(() => null) : cnd; }));
        fixes.filter(Boolean).map(x => x.routes ? { r: x.routes[0], via: x.waypoints?.[1]?.location } : x).sort((a, b) => a.r.duration - b.r.duration).forEach(consider);
      }
      if (dbg.length) routes.dbg = dbg;
    }
    routes.sort((a, b) => a.duration - b.duration);
    const res = new Response(JSON.stringify({ code: 'Ok', routes, waypoints: main.waypoints, ...(routes.dbg ? { debug: routes.dbg } : {}) }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=' + (busy ? 300 : 86400) } });
    if (p.get('debug') !== '1') ctx.waitUntil(caches.default.put(key, res.clone()));
    return res;
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
