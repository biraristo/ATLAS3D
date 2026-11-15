// ATLAS3D Cloudflare Worker — harita servisleri için önbellekli, hız sınırlı API katmanı
//   /api/autocomplete  Photon (+ MAPBOX_TOKEN varsa Mapbox adresleri)
//   /api/search        Nominatim (tam arama)
//   /api/reverse       Nominatim (koordinattan adres)
//   /api/lookup        Nominatim (OSM nesne detayı: telefon, web, saatler)
//   /api/route         OSRM (araç / yürüyüş / bisiklet rota)
//   /api/trip          OSRM trip: en çok 12 durağı en kısa sıraya dizer (günlük eser rotası)
//   /api/nearby        Overpass (OSM etiketleriyle kategori araması; saat, telefon, web dahil), olmazsa Nominatim
//   /api/match         Valhalla (FOSSGIS): kaydedilen GPS izini yollara oturtur, geçilen sokakların adlarını verir
//   /api/fuel          EPDK günlük akaryakıt ve LPG bayi satış fiyatı bülteni (Türkiye ortalaması)
//   /api/traffic/*     TomTom (TOMTOM_API_KEY varsa): trafik karoları, trafikli rota, ulaşılabilir alan
//   /api/weather       Open-Meteo: rota boyunca sıcaklık ve rüzgâr (yakıt hesabı)
//   /api/mly/*         Mapillary (MAPILLARY_TOKEN varsa): sokak fotoğrafı kapsama karoları ve fotoğraf bilgisi
//   /api/ocm           Open Charge Map (OCM_KEY varsa): harita alanındaki şarj istasyonları
//   /api/mt/*          MapTiler (MAPTILER_KEY varsa): açık hava (topoğrafik) harita karoları
//   /api/config        özellik bayrakları + ziyaretçinin yaklaşık konumu (Cloudflare)
//   /api/health        durum
import { connect } from 'cloudflare:sockets';

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
  if (!r.ok) return json({ error: 'upstream ' + r.status }, r.status === 429 ? 503 : 502);
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
  async '/api/trip'(p, ctx, origin) {
    const svc = { car: 'routed-car', foot: 'routed-foot', bike: 'routed-bike' }[p.get('mode')];
    const c = (p.get('coords') || '').split(';').map(s => s.split(',').map(v => num(v, 6)));
    if (!svc || c.length < 2 || c.length > 12 || c.some(x => x.length !== 2 || x.includes(null))) return json({ error: 'params' }, 400);
    // ilk durak başlangıç (konum ya da ilk eser), dönüş yok; geri kalan sıra OSRM'den
    return cachedFetch(`https://routing.openstreetmap.de/${svc}/trip/v1/driving/${c.map(x => x.join(',')).join(';')}?roundtrip=false&source=first&overview=full&geometries=geojson`, 600, ctx, origin);
  },
  async '/api/route'(p, ctx, origin, env) {
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
    // Araçta TomTom bağlıysa alternatifleri o verir; topluluk OSRM sunucusunu ara nokta denemeleriyle yorma
    const viaSearch = !(svc === 'routed-car' && env?.TOMTOM_API_KEY);
    if (viaSearch && routes.length < 3) {
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
      // En fazla iki grup (6 ara nokta) denenir; istek sayısı tek rota başına sınırlı kalır
      for (let k = 0; k < 6 && routes.length < 3 && !busy; k += 3) {
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
    // Herkese açık Overpass sunucuları sık sık dolu: 6 sn içinde yanıt yoksa Nominatim gösterilir,
    // Overpass arka planda bitip önbelleğe yazılır; aynı alan bir sonraki aramada zengin sonuçla gelir
    if (OVERPASS_Q[q]) {
      const is = overpassNearby(q, bb, ctx).catch(() => null);
      ctx.waitUntil(is);
      const ov = await Promise.race([is, new Promise(r => setTimeout(() => r(null), 6000))]);
      if (ov) return ov;
    }
    return cachedFetch(`${NOMINATIM}/search?format=jsonv2&limit=40&bounded=1&addressdetails=1&extratags=1&accept-language=tr&viewbox=${w},${n},${e},${s}&q=` + encodeURIComponent(q), OVERPASS_Q[q] ? 3600 : 86400, ctx, origin);
  },
  // Araç görseli: Wikipedia'nın sayfa görseli (yalnız özgür lisanslı Wikimedia Commons dosyaları). 30 gün önbellek.
  // Model adı başlıkta geçmeyen sonuç kabul edilmez; aynı modelin kuşak sayfaları arasından yıla en yakın görsel seçilir.
  async '/api/carimg'(p, ctx) {
    const mk = clean(p.get('mk')).slice(0, 40), md = clean(p.get('md')).slice(0, 60), y = parseInt(p.get('y') || '0', 10);
    if (!mk || !md) return json({ error: 'params' }, 400);
    const key = new Request(`https://atlas3d.cache/carimg/v1/${encodeURIComponent(mk)}/${encodeURIComponent(md)}/${y || 0}`);
    const hit = await caches.default.match(key); if (hit) return hit;
    const norm = s => s.toLowerCase().normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, ' ').trim();
    // Türkçe adlandırma → Wikipedia adı
    const names = md.split(' / ').map(n => n.replace(/ Serisi$/, ' Series').replace(/-Serisi$/, '-Class').replace(/^Hatch \/ Cabrio.*/, 'Hatch').replace(/ \(.*\)$/, ''));
    const make = mk === 'KGM (SsangYong)' ? 'SsangYong' : mk === 'MINI' ? 'Mini' : mk;
    let best = null;
    for (const n of names) {
      const u = 'https://en.wikipedia.org/w/api.php?action=query&format=json&generator=search&gsrlimit=8&prop=pageimages&piprop=thumbnail|name&pithumbsize=640&gsrsearch=' + encodeURIComponent(`${make} ${n}`);
      const r = await fetch(u, { headers: { 'User-Agent': UA } }); if (!r.ok) continue;
      const pages = Object.values((await r.json())?.query?.pages || {}).filter(pg => pg.thumbnail?.source && pg.pageimage && !/logo|\.svg$/i.test(pg.pageimage));
      const want = norm(`${make} ${n}`);
      const ok = pages.filter(pg => norm(pg.title).startsWith(want));
      if (!ok.length) continue;
      const yearOf = pg => { const m = (pg.pageimage + ' ' + pg.title).match(/(19[89]\d|20[0-3]\d)/g); return m ? +m[0] : null; };
      // Başlıkta model adından sonra kuşak dışında bir şey varsa (ör. "Golf Sportsvan", "i20 WRC") farklı araçtır: geri plana at
      // (parantez içi kasa kodu serbest: "BMW 3 Series (E90)")
      const extra = pg => norm(pg.title.replace(/\(.*?\)/g, ' ')).slice(want.length).trim().split(' ').filter(Boolean).some(w => !/^(mk\d+|[ivx]+|19\d\d|20\d\d|first|second|third|fourth|fifth|sixth|seventh|eighth|generation|facelift)$/.test(w)) ? 100 : 0;
      const score = pg => extra(pg) + (y && yearOf(pg) ? Math.abs(yearOf(pg) - y) : 50);
      ok.sort((a, b) => score(a) - score(b) || a.index - b.index);
      // Genel sayfa (ör. "Volkswagen Golf") yıl bilgisi yoksa en güncel kuşağı gösterir; kuşak sayfası yıla daha yakınsa o seçilir
      const c = ok[0];
      best = { src: c.thumbnail.source, file: c.pageimage, title: c.title, page: 'https://en.wikipedia.org/wiki/' + encodeURIComponent(c.title.replace(/ /g, '_')) };
      break;
    }
    const res = json(best || { src: null }, 200, 'public, max-age=' + (best ? 2592000 : 86400));
    ctx.waitUntil(caches.default.put(key, res.clone()));
    return res;
  },
  // Rota boyunca anlık hava: sıcaklık (°C), 10 m rüzgâr hızı (m/s) ve geldiği yön (°). Open-Meteo, anahtarsız. 20 dk önbellek.
  async '/api/weather'(p, ctx) {
    const pts = (p.get('pts') || '').split(';').slice(0, 8).map(s => s.split(',').map(v => num(v, 2)));
    if (!pts.length || pts.some(x => x.length !== 2 || x.includes(null) || Math.abs(x[0]) > 90 || Math.abs(x[1]) > 180)) return json({ error: 'pts' }, 400);
    const u = `https://api.open-meteo.com/v1/forecast?latitude=${pts.map(x => x[0]).join(',')}&longitude=${pts.map(x => x[1]).join(',')}&current=temperature_2m,wind_speed_10m,wind_direction_10m&wind_speed_unit=ms&timezone=auto`;
    const key = new Request(u);
    const hit = await caches.default.match(key); if (hit) return hit;
    const r = await fetch(u, { headers: { 'User-Agent': UA } });
    if (!r.ok) return json({ error: 'upstream ' + r.status }, 502);
    const d = await r.json(), arr = Array.isArray(d) ? d : [d];
    const points = arr.map(x => ({ t: x.current?.temperature_2m, ws: x.current?.wind_speed_10m, wd: x.current?.wind_direction_10m })).filter(x => Number.isFinite(x.t));
    if (points.length !== pts.length) return json({ error: 'incomplete' }, 502);
    const res = json({ points, source: 'Open-Meteo' }, 200, 'public, max-age=1200');
    ctx.waitUntil(caches.default.put(key, res.clone()));
    return res;
  }
};


/* ================= Yakındakiler: Overpass =================
   Nominatim kategori aramada metin eşleştirdiği için az ve eksik sonuç verir. Overpass doğrudan OSM etiketlerini sorar:
   alandaki tüm restoranlar, açılış saatleri, telefon, web sitesi. Yanıt Nominatim biçimine çevrilir (arayüz aynı kalır). */
const OVERPASS = ['https://overpass-api.de/api/interpreter', 'https://maps.mail.ru/osm/tools/overpass/api/interpreter'];
const OVERPASS_Q = {
  restaurant: ['["amenity"~"^(restaurant|fast_food|food_court)$"]'],
  hotel: ['["tourism"~"^(hotel|motel|guest_house|hostel|apartment)$"]'],
  cafe: ['["amenity"~"^(cafe|ice_cream)$"]'],
  fuel: ['["amenity"="fuel"]'],
  supermarket: ['["shop"~"^(supermarket|convenience|greengrocer|butcher|bakery)$"]'],
  pharmacy: ['["amenity"="pharmacy"]'],
  hospital: ['["amenity"~"^(hospital|clinic)$"]'],
  atm: ['["amenity"="atm"]', '["amenity"="bank"]'],
  parking: ['["amenity"="parking"]["access"!~"^(private|no)$"]'],
  mosque: ['["amenity"="place_of_worship"]["religion"="muslim"]'],
  'tourist attraction': ['["tourism"~"^(attraction|museum|viewpoint|gallery)$"]', '["historic"~"^(castle|monument|ruins|archaeological_site|memorial)$"]["name"]'],
  'charging station': ['["amenity"="charging_station"]']
};
const OV_KEYS = ['amenity', 'shop', 'tourism', 'historic', 'leisure'];
async function overpassNearby(q, bb, ctx) {
  const [w, s, e, n] = bb;
  const cacheKey = new Request(`https://atlas3d.cache/ov/v1/${encodeURIComponent(q)}/${bb.join(',')}`);
  const hit = await caches.default.match(cacheKey); if (hit) return hit;
  const body = `[out:json][timeout:12];(${OVERPASS_Q[q].map(f => `nwr${f}(${s},${w},${n},${e});`).join('')});out center tags 120;`;
  let d = null;
  for (const u of OVERPASS) {
    try {
      const r = await fetch(u, { method: 'POST', headers: { 'User-Agent': UA, 'content-type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(body), signal: AbortSignal.timeout(9000) });
      if (r.ok) { d = await r.json(); break; }
    } catch {}
  }
  if (!d?.elements) return null;
  const out = d.elements.map(el => {
    const t = el.tags || {}, lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
    const key = OV_KEYS.find(k => t[k]) || 'amenity';
    const name = t['name:tr'] || t.name || t.brand || t.operator || '';
    return { lat: String(lat), lon: String(lon), name, category: key, type: t[key] || 'yes', osm_type: el.type, osm_id: el.id, extratags: t, display_name: name,
      address: { road: t['addr:street'] || '', house_number: t['addr:housenumber'] || '', suburb: t['addr:neighbourhood'] || t['addr:suburb'] || '', town: t['addr:district'] || '', province: t['addr:city'] || t['addr:province'] || '' } };
  }).filter(x => Number.isFinite(+x.lat) && Number.isFinite(+x.lon))
    .map(x => ({ x, d: Math.hypot((+x.lon - (w + e) / 2) * Math.cos((s + n) / 2 * Math.PI / 180), +x.lat - (s + n) / 2) + (x.name ? 0 : 1) })) // merkeze yakın ve adlı olanlar önce
    .sort((a, b) => a.d - b.d).slice(0, 80).map(o => o.x);
  if (!out.length) return null; // boşsa Nominatim'e de bak
  const res = new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=21600', 'x-source': 'overpass' } });
  ctx.waitUntil(caches.default.put(cacheKey, res.clone()));
  return res;
}

/* ================= Yolculuk kaydını yollara oturtma: Valhalla (FOSSGIS, anahtarsız) =================
   POST /api/match { mode: car|bike|foot, pts: [[lon, lat, unixSn], ...] }
   İz 350 noktalık parçalar halinde trace_attributes'a gönderilir (sunucuyu yormamak için sırayla).
   Yanıt: line (yola oturmuş çizgi), yollar [{ ad, m }] (sırayla geçilen sokaklar), nok [[lon, lat, yolNo] | null] (her GPS noktasının yoldaki yeri) */
const VALHALLA = 'https://valhalla1.openstreetmap.de/trace_attributes';
const COSTING = { car: 'auto', bike: 'bicycle', foot: 'pedestrian' };
function decode6(str) {
  const out = []; let i = 0, lat = 0, lon = 0;
  const next = () => { let r = 0, sh = 0, b; do { b = str.charCodeAt(i++) - 63; r |= (b & 31) << sh; sh += 5; } while (b >= 32); return r & 1 ? ~(r >> 1) : r >> 1; };
  while (i < str.length) { lat += next(); lon += next(); out.push([lon / 1e6, lat / 1e6]); }
  return out;
}
async function matchTrace(request, ctx) {
  const body = await request.json().catch(() => null);
  const costing = COSTING[body?.mode] || 'auto';
  const pts = Array.isArray(body?.pts) ? body.pts.filter(p => Array.isArray(p) && p.length >= 2 && Number.isFinite(p[0]) && Number.isFinite(p[1]) && Math.abs(p[0]) <= 180 && Math.abs(p[1]) <= 90) : [];
  if (pts.length < 2 || pts.length > 6000) return json({ error: 'pts' }, 400);
  const sig = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(costing + pts.map(p => p[0].toFixed(5) + ',' + p[1].toFixed(5)).join(';')));
  const cacheKey = new Request('https://atlas3d.cache/match/v1/' + [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join(''));
  const hit = await caches.default.match(cacheKey); if (hit) return hit;

  const N = 350, line = [], yollar = [], nok = new Array(pts.length).fill(null);
  let sonAd = null, eslesen = 0;
  for (let a = 0; a < pts.length - 1; a += N - 1) {
    const parca = pts.slice(a, a + N);
    if (parca.length < 2) break;
    const zamanli = parca.every(p => Number.isFinite(p[2]));
    const req = {
      shape: parca.map(p => ({ lon: p[0], lat: p[1], ...(zamanli ? { time: Math.round(p[2]) } : {}) })),
      costing, shape_match: 'map_snap', ...(zamanli ? { use_timestamps: true } : {}),
      trace_options: { search_radius: 60, gps_accuracy: 20, breakage_distance: 2000 },
      filters: { attributes: ['edge.names', 'edge.length', 'edge.road_class', 'edge.begin_shape_index', 'edge.end_shape_index', 'shape', 'matched.point', 'matched.type', 'matched.edge_index'], action: 'include' }
    };
    const r = await fetch(VALHALLA, { method: 'POST', headers: { 'User-Agent': UA, 'content-type': 'application/json' }, body: JSON.stringify(req), signal: AbortSignal.timeout(20000) });
    if (!r.ok) {
      if (r.status === 429) return json({ error: 'busy' }, 503);
      continue; // eşleşmeyen parça (ör. yol dışı yürüyüş): ham iz kalır
    }
    const d = await r.json(), shape = d.shape ? decode6(d.shape) : [], edges = d.edges || [];
    // Sokaklar: art arda aynı addaki kenarlar birleşir; isimsiz kenarlar bir önceki sokağa yazılmaz
    const kenarYol = edges.map(e => {
      const ad = (e.names || [])[0] || null, m = (e.length || 0) * 1000;
      if (!ad) { sonAd = null; return -1; }
      if (ad === sonAd && yollar.length) { yollar[yollar.length - 1].m += m; return yollar.length - 1; }
      sonAd = ad; yollar.push({ ad, m, sinif: e.road_class || '' }); return yollar.length - 1;
    });
    line.push(...(line.length ? shape.slice(1) : shape));
    (d.matched_points || []).forEach((m, k) => {
      if (m.type === 'unmatched' || !Number.isFinite(m.lat)) return;
      const i = a + k; if (nok[i] && k === 0) return; // parça başı bir önceki parçanın sonuyla aynı nokta
      nok[i] = [+m.lon.toFixed(6), +m.lat.toFixed(6), Number.isInteger(m.edge_index) ? (kenarYol[m.edge_index] ?? -1) : -1];
      eslesen++;
    });
  }
  if (!line.length) return json({ error: 'nomatch' }, 422);
  const out = { line: line.map(c => [+c[0].toFixed(6), +c[1].toFixed(6)]), yollar: yollar.map(y => ({ ...y, m: Math.round(y.m) })), nok, oran: +(eslesen / pts.length).toFixed(2), kaynak: 'Valhalla · OpenStreetMap' };
  const res = new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=2592000' } });
  ctx.waitUntil(caches.default.put(cacheKey, res.clone()));
  return res;
}

// Yazarken öneri: Photon (mekanlar, OSM) + Mapbox (adres, sokak, kapı numarası) birlikte
const MB_TYPE = { address: 'house', street: 'street', neighborhood: 'suburb', locality: 'suburb', place: 'city', district: 'county', region: 'state', postcode: 'postcode', country: 'country' };
async function mergedAutocomplete(p, env, ctx, origin) {
  const q = clean(p.get('q')); if (q.length < 2) return json({ features: [] });
  const lat = num(p.get('lat'), 2), lon = num(p.get('lon'), 2);
  const cacheKey = new Request(`https://atlas3d.cache/ac/${encodeURIComponent(q.toLowerCase())}/${lat},${lon}`);
  const hit = await caches.default.match(cacheKey); if (hit) return hit;
  let pu = 'https://photon.komoot.io/api/?limit=7&lang=default&q=' + encodeURIComponent(q);
  if (lat && lon) pu += `&lat=${num(p.get('lat'), 1)}&lon=${num(p.get('lon'), 1)}&location_bias_scale=0.4`;
  let mu = `https://api.mapbox.com/search/geocode/v6/forward?q=${encodeURIComponent(q)}&autocomplete=true&language=tr&limit=5&access_token=${env.MAPBOX_TOKEN}`;
  if (lat && lon) mu += `&proximity=${lon},${lat}`;
  const [ph, mb] = await Promise.all([
    fetch(pu, { headers: { 'User-Agent': UA, 'Referer': origin + '/' } }).then(r => (r.ok ? r.json() : null)).catch(() => null),
    fetch(mu).then(r => (r.ok ? r.json() : null)).catch(() => null)
  ]);
  const photon = ph?.features || [];
  const mapbox = (mb?.features || []).map(f => {
    const pr = f.properties || {}, c = pr.context || {};
    return { type: 'Feature', geometry: { type: 'Point', coordinates: [pr.coordinates?.longitude ?? f.geometry.coordinates[0], pr.coordinates?.latitude ?? f.geometry.coordinates[1]] },
      properties: { source: 'mapbox', name: pr.feature_type === 'address' ? '' : pr.name, street: c.street?.name || c.address?.street_name || (pr.feature_type === 'street' ? pr.name : ''),
        housenumber: c.address?.address_number || '', district: c.neighborhood?.name || c.locality?.name || '', city: c.place?.name || c.district?.name || '',
        state: c.region?.name || '', country: c.country?.name || '', osm_value: MB_TYPE[pr.feature_type] || 'yes',
        extent: pr.bbox ? [pr.bbox[0], pr.bbox[3], pr.bbox[2], pr.bbox[1]] : undefined } };
  });
  // Rakam içeren (adres gibi) aramalarda Mapbox önde; diğerlerinde mekanlar (Photon) önde
  const addrFirst = /\d/.test(q), first = addrFirst ? mapbox : photon, second = addrFirst ? photon : mapbox;
  const out = [], near = (a, b) => Math.abs(a[0] - b[0]) + Math.abs(a[1] - b[1]) < 0.004;
  for (const f of [...first, ...second]) {
    const key = (f.properties.name || f.properties.street || '').toLowerCase();
    if (out.some(o => near(o.geometry.coordinates, f.geometry.coordinates) && (o.properties.name || o.properties.street || '').toLowerCase() === key)) continue;
    out.push(f); if (out.length >= 8) break;
  }
  const res = new Response(JSON.stringify({ type: 'FeatureCollection', features: out }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=86400' } });
  ctx.waitUntil(caches.default.put(cacheKey, res.clone()));
  return res;
}

// TomTom rota yanıtını uygulamanın kullandığı OSRM biçimine çevir
const TT_MAN = {
  DEPART: ['depart'], ARRIVE: ['arrive'], ARRIVE_LEFT: ['arrive', 'left'], ARRIVE_RIGHT: ['arrive', 'right'],
  STRAIGHT: ['continue', 'straight'], FOLLOW: ['continue', 'straight'],
  TURN_RIGHT: ['turn', 'right'], TURN_LEFT: ['turn', 'left'], BEAR_RIGHT: ['turn', 'slight right'], BEAR_LEFT: ['turn', 'slight left'],
  SHARP_RIGHT: ['turn', 'sharp right'], SHARP_LEFT: ['turn', 'sharp left'], KEEP_RIGHT: ['fork', 'right'], KEEP_LEFT: ['fork', 'left'],
  MAKE_UTURN: ['turn', 'uturn'], TRY_MAKE_UTURN: ['turn', 'uturn'],
  ENTER_MOTORWAY: ['on ramp'], ENTER_FREEWAY: ['on ramp'], ENTER_HIGHWAY: ['on ramp'], ENTRANCE_RAMP: ['on ramp'],
  TAKE_EXIT: ['off ramp', 'right'], MOTORWAY_EXIT_RIGHT: ['off ramp', 'right'], MOTORWAY_EXIT_LEFT: ['off ramp', 'left'],
  ROUNDABOUT_CROSS: ['roundabout', 'straight'], ROUNDABOUT_RIGHT: ['roundabout', 'right'], ROUNDABOUT_LEFT: ['roundabout', 'left'], ROUNDABOUT_BACK: ['roundabout', 'left'],
  SWITCH_PARALLEL_ROAD: ['fork', 'right'], SWITCH_MAIN_ROAD: ['fork', 'left'], TAKE_FERRY: ['notification', 'straight']
};
function ttBearing(a, b) {
  const r = Math.PI / 180, y = Math.sin((b[0] - a[0]) * r) * Math.cos(b[1] * r);
  const x = Math.cos(a[1] * r) * Math.sin(b[1] * r) - Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos((b[0] - a[0]) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
function ttToOsrm(rt, avoid) {
  const pts = (rt.legs || []).flatMap((l, i) => (i ? (l.points || []).slice(1) : l.points || [])).map(p => [p.longitude, p.latitude]);
  const s = rt.summary || {}, ins = rt.guidance?.instructions || [];
  const steps = ins.map((it, k) => {
    const nx = ins[k + 1], [type, mod0] = TT_MAN[it.maneuver] || ['continue', 'straight'];
    let mod = mod0;
    if (type === 'on ramp') mod = (it.turnAngleInDecimalDegrees || 0) < 0 ? 'left' : 'right';
    const pi = Math.min(it.pointIndex ?? 0, pts.length - 1), loc = [it.point?.longitude ?? pts[pi][0], it.point?.latitude ?? pts[pi][1]];
    return {
      maneuver: { type, modifier: mod, location: loc, bearing_after: pts[pi + 1] ? ttBearing(pts[pi], pts[pi + 1]) : 0, exit: it.roundaboutExitNumber },
      name: it.street || '', ref: (it.roadNumbers || []).join(' / '), destinations: it.signpostText || '', mode: it.maneuver === 'TAKE_FERRY' ? 'ferry' : 'driving',
      distance: nx ? nx.routeOffsetInMeters - it.routeOffsetInMeters : 0, duration: nx ? nx.travelTimeInSeconds - it.travelTimeInSeconds : 0
    };
  });
  const roads = [...new Set(ins.filter(i => i.roadNumbers?.length).map(i => i.roadNumbers[0]))].slice(0, 2).join(', ');
  const tolls = (rt.sections || []).filter(x => x.sectionType === 'TOLL_ROAD').length;
  return {
    provider: 'tomtom', avoidToll: avoid, hasTollSections: tolls > 0,
    geometry: { type: 'LineString', coordinates: pts }, distance: s.lengthInMeters, duration: s.noTrafficTravelTimeInSeconds ?? s.travelTimeInSeconds,
    legs: [{ summary: roads, steps }],
    traffic: {
      length: s.lengthInMeters, travel: s.travelTimeInSeconds, delay: s.trafficDelayInSeconds || 0, noTraffic: s.noTrafficTravelTimeInSeconds ?? null,
      historic: s.historicTrafficTravelTimeInSeconds ?? null, trafficLength: s.trafficLengthInMeters || 0,
      sections: (rt.sections || []).filter(x => x.sectionType === 'TRAFFIC').map(x => ({
        cat: x.simpleCategory || 'OTHER', speed: x.effectiveSpeedInKmh ?? null, delay: x.delayInSeconds || 0, mag: x.magnitudeOfDelay ?? 0,
        cause: x.tec?.causes?.[0]?.mainCauseCode ?? null, coords: pts.slice(x.startPointIndex, (x.endPointIndex ?? x.startPointIndex) + 1)
      })),
      at: Date.now()
    }
  };
}

/* ================= Yakıt fiyatları (EPDK) =================
   Kaynak: EPDK "Petrol / LPG Piyasası Bayi Satış Fiyatı Bülteni" açık REST servisleri (apigateway.epdk.gov.tr).
   Servis tarihi GET isteğinin gövdesinde istiyor; fetch() gövdeli GET göndermediği için ham HTTPS soketi kullanılır.
   Bülten o gün yayımlanmadıysa önceki günlere bakılır. Sonuç 3 saat önbellekte tutulur. */
const EPDK_HOST = 'apigateway.epdk.gov.tr';
function concatBytes(chunks) { const n = chunks.reduce((s, c) => s + c.length, 0), out = new Uint8Array(n); let o = 0; for (const c of chunks) { out.set(c, o); o += c.length; } return out; }
function dechunk(bytes) {
  const out = []; let i = 0;
  while (i < bytes.length) {
    let j = i; while (j < bytes.length - 1 && !(bytes[j] === 13 && bytes[j + 1] === 10)) j++;
    const size = parseInt(new TextDecoder().decode(bytes.slice(i, j)).split(';')[0].trim(), 16);
    if (!size) break;
    out.push(bytes.slice(j + 2, j + 2 + size)); i = j + 2 + size + 2;
  }
  return concatBytes(out);
}
async function getWithBody(host, path, body, timeoutMs = 8000) {
  const sock = connect({ hostname: host, port: 443 }, { secureTransport: 'on' });
  const timer = setTimeout(() => { try { sock.close(); } catch {} }, timeoutMs);
  try {
    const data = new TextEncoder().encode(body);
    const w = sock.writable.getWriter();
    await w.write(new TextEncoder().encode(`GET ${path} HTTP/1.1\r\nHost: ${host}\r\nUser-Agent: ${UA}\r\nAccept: application/json\r\nContent-Type: application/json\r\nContent-Length: ${data.length}\r\nConnection: close\r\n\r\n`));
    await w.write(data); w.releaseLock();
    const rd = sock.readable.getReader(), chunks = [];
    for (;;) { const { value, done } = await rd.read(); if (done) break; chunks.push(value); }
    const all = concatBytes(chunks);
    let h = 0; while (h < all.length - 3 && !(all[h] === 13 && all[h + 1] === 10 && all[h + 2] === 13 && all[h + 3] === 10)) h++;
    const head = new TextDecoder().decode(all.slice(0, h)), status = +(head.match(/^HTTP\/1\.[01] (\d{3})/) || [])[1];
    let payload = all.slice(h + 4);
    if (/\r\ntransfer-encoding:\s*chunked/i.test(head)) payload = dechunk(payload);
    return { status, text: new TextDecoder().decode(payload) };
  } finally { clearTimeout(timer); try { await sock.close(); } catch {} }
}
const trDate = d => new Intl.DateTimeFormat('tr-TR', { timeZone: 'Europe/Istanbul', day: '2-digit', month: '2-digit', year: 'numeric' }).format(d); // gg.aa.yyyy
async function epdkBulletin(service, want) {
  for (let back = 0; back < 6; back++) {
    const day = trDate(new Date(Date.now() - back * 86400000));
    const r = await getWithBody(EPDK_HOST, `/${service}/`, JSON.stringify({ raporTarihi: day }));
    if (r.status !== 200) continue;
    const rows = (JSON.parse(r.text).data || []);
    const out = {}; let date = null;
    for (const [key, name] of Object.entries(want)) { const row = rows.find(x => x['Yakıt'] === name); if (row && row.Fiyat > 0) { out[key] = Math.round(row.Fiyat * 100) / 100; date = row.Tarih; } }
    if (Object.keys(out).length) return { ...out, date };
  }
  return null;
}
async function fuelPrices(ctx) {
  const key = new Request('https://atlas3d.cache/fuel/v1');
  const hit = await caches.default.match(key); if (hit) return hit;
  const [pet, lpg] = await Promise.all([
    epdkBulletin('petrolBayiSatisFiyatBulten', { benzin: 'Kurşunsuz Benzin 95 Oktan', dizel: 'Motorin' }).catch(() => null),
    epdkBulletin('lpgBayiSatisFiyatBultenGunluk', { lpg: 'Otogaz' }).catch(() => null)
  ]);
  if (!pet && !lpg) return json({ error: 'epdk-unavailable' }, 502);
  const body = { source: 'EPDK günlük bayi satış fiyatı bülteni (Türkiye ortalaması)', date: pet?.date || lpg?.date, benzin: pet?.benzin ?? null, dizel: pet?.dizel ?? null, lpg: lpg?.lpg ?? null, at: Date.now() };
  const res = new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=3600' } });
  if (pet && lpg) ctx.waitUntil(caches.default.put(key, new Response(JSON.stringify(body), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=10800' } })));
  return res;
}

/* ================= Canlı trafik (TomTom) =================
   Anahtar (TOMTOM_API_KEY) yalnızca Cloudflare'de gizli değişken olarak tutulur, tarayıcıya gitmez.
   /api/traffic/flow/{z}/{x}/{y}.png        trafik akış karosu (2 dk önbellek)
   /api/traffic/incidents/{z}/{x}/{y}.png   kaza / yol çalışması karosu (2 dk önbellek)
   POST /api/traffic/route  { points: [[lon,lat],...] }  → güzergâhın trafikli süresi ve sıkışık kesimleri */
async function traffic(request, url, env, ctx) {
  const key = env.TOMTOM_API_KEY;
  if (!key) return json({ error: 'traffic-disabled' }, 404);
  const base = (env.TOMTOM_BASE || 'https://api.tomtom.com').replace(/\/$/, '');
  const tile = url.pathname.match(/^\/api\/traffic\/(flow|incidents)\/(\d{1,2})\/(\d+)\/(\d+)\.png$/);
  if (tile) {
    const [, kind, z, x, y] = tile;
    if (+z < 5 || +z > 18) return new Response(null, { status: 204 });
    const cacheKey = new Request(`https://atlas3d.cache/traffic/${kind}/${z}/${x}/${y}`);
    const hit = await caches.default.match(cacheKey); if (hit) return hit;
    const up = kind === 'flow'
      ? `${base}/traffic/map/4/tile/flow/relative0/${z}/${x}/${y}.png?tileSize=256&key=${key}`
      : `${base}/traffic/map/4/tile/incidents/s3/${z}/${x}/${y}.png?tileSize=256&key=${key}`;
    const r = await fetch(up);
    if (!r.ok) { const t = (await r.text()).slice(0, 300).replaceAll(key, '***'); return new Response(null, { status: r.status === 403 || r.status === 429 ? 204 : 502, headers: { 'x-upstream': r.status + ' ' + t.replace(/[^\x20-\x7e]/g, ' ') } }); }
    const res = new Response(r.body, { headers: { 'content-type': 'image/png', 'cache-control': 'public, max-age=120' } });
    ctx.waitUntil(caches.default.put(cacheKey, res.clone()));
    return res;
  }
  if (url.pathname === '/api/traffic/route' && request.method === 'POST') {
    const body = await request.json().catch(() => null);
    const pts = Array.isArray(body?.points) ? body.points.filter(p => Array.isArray(p) && p.length === 2 && p.every(Number.isFinite)).slice(0, 400) : [];
    if (pts.length < 2) return json({ error: 'points' }, 400);
    const sig = await crypto.subtle.digest('SHA-1', new TextEncoder().encode(pts.map(p => p[0].toFixed(4) + ',' + p[1].toFixed(4)).join(';')));
    const cacheKey = new Request('https://atlas3d.cache/traffic/route/' + [...new Uint8Array(sig)].map(b => b.toString(16).padStart(2, '0')).join(''));
    const hit = await caches.default.match(cacheKey); if (hit) return hit;
    const a = pts[0], b = pts[pts.length - 1];
    const up = `${base}/routing/1/calculateRoute/${a[1]},${a[0]}:${b[1]},${b[0]}/json?key=${key}&traffic=true&travelMode=car&sectionType=traffic&computeTravelTimeFor=all&routeRepresentation=polyline`;
    const r = await fetch(up, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ supportingPoints: pts.map(p => ({ latitude: p[1], longitude: p[0] })) }) });
    if (!r.ok) return json({ error: 'upstream ' + r.status, detail: (await r.text()).slice(0, 400).replaceAll(key, '***') }, r.status === 429 ? 429 : 502);
    const d = await r.json(), route = d.routes?.[0];
    if (!route) return json({ error: 'no-route' }, 502);
    const points = (route.legs || []).flatMap(l => l.points || []).map(p => [p.longitude, p.latitude]);
    const s = route.summary || {};
    const out = {
      length: s.lengthInMeters, travel: s.travelTimeInSeconds, delay: s.trafficDelayInSeconds || 0,
      noTraffic: s.noTrafficTravelTimeInSeconds ?? null, historic: s.historicTrafficTravelTimeInSeconds ?? null, trafficLength: s.trafficLengthInMeters || 0,
      sections: (route.sections || []).filter(x => x.sectionType === 'TRAFFIC').map(x => ({
        cat: x.simpleCategory || 'OTHER', speed: x.effectiveSpeedInKmh ?? null, delay: x.delayInSeconds || 0, mag: x.magnitudeOfDelay ?? 0,
        cause: x.tec?.causes?.[0]?.mainCauseCode ?? null, coords: points.slice(x.startPointIndex, (x.endPointIndex ?? x.startPointIndex) + 1)
      })),
      at: Date.now()
    };
    const res = new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=120' } });
    ctx.waitUntil(caches.default.put(cacheKey, res.clone()));
    return res;
  }
  // TomTom'un kendi rotaları (trafiğe göre alternatifler / ücretli yollardan kaçınan rota), OSRM biçimine çevrilmiş
  if (url.pathname === '/api/traffic/routes') {
    const c = (url.searchParams.get('coords') || '').split(';').map(p => p.split(',').map(Number));
    if (c.length !== 2 || !c.every(p => p.length === 2 && p.every(Number.isFinite))) return json({ error: 'coords' }, 400);
    const avoid = url.searchParams.get('avoid') === 'toll', alts = Math.max(0, Math.min(3, +url.searchParams.get('alt') || 0));
    const cacheKey = new Request(`https://atlas3d.cache/traffic/routes/${c.flat().map(v => v.toFixed(5)).join(',')}/${avoid ? 't' : ''}${alts}`);
    const hit = await caches.default.match(cacheKey); if (hit) return hit;
    const up = `${base}/routing/1/calculateRoute/${c[0][1]},${c[0][0]}:${c[1][1]},${c[1][0]}/json?key=${key}&traffic=true&travelMode=car&maxAlternatives=${alts}` +
      `&instructionsType=coded&sectionType=traffic&sectionType=tollRoad&computeTravelTimeFor=all&routeRepresentation=polyline${avoid ? '&avoid=tollRoads' : ''}`;
    const r = await fetch(up);
    if (!r.ok) return json({ code: 'Error', error: 'upstream ' + r.status, detail: (await r.text()).slice(0, 300).replaceAll(key, '***') }, r.status === 429 ? 429 : 502);
    const d = await r.json();
    const out = { code: 'Ok', routes: (d.routes || []).map(rt => ttToOsrm(rt, avoid)) };
    const res = new Response(JSON.stringify(out), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=120' } });
    ctx.waitUntil(caches.default.put(cacheKey, res.clone()));
    return res;
  }
  // Ulaşılabilir alan: verilen sürede (trafikle) gidilebilecek bölgenin sınırı
  if (url.pathname === '/api/traffic/range') {
    const lat = +url.searchParams.get('lat'), lon = +url.searchParams.get('lon'), min = Math.max(5, Math.min(120, +url.searchParams.get('min') || 30));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) return json({ error: 'coords' }, 400);
    const cacheKey = new Request(`https://atlas3d.cache/traffic/range/${lat.toFixed(4)},${lon.toFixed(4)}/${min}`);
    const hit = await caches.default.match(cacheKey); if (hit) return hit;
    const up = `${base}/routing/1/calculateReachableRange/${lat},${lon}/json?key=${key}&timeBudgetInSec=${min * 60}&traffic=true&travelMode=car`;
    const r = await fetch(up);
    if (!r.ok) return json({ error: 'upstream ' + r.status, detail: (await r.text()).slice(0, 300).replaceAll(key, '***') }, r.status === 429 ? 429 : 502);
    const d = await r.json();
    const ring = (d.reachableRange?.boundary || []).map(p => [p.longitude, p.latitude]);
    if (ring.length) ring.push(ring[0]);
    const res = new Response(JSON.stringify({ min, ring, at: Date.now() }), { headers: { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'public, max-age=300' } });
    ctx.waitUntil(caches.default.put(cacheKey, res.clone()));
    return res;
  }
  return json({ error: 'not-found' }, 404);
}

/* ================= İsteğe bağlı bağlantılar =================
   Anahtarlar yalnızca Cloudflare'de gizli değişken olarak tutulur; tarayıcı yalnızca bu uçları görür. Anahtar yoksa uç 404 döner ve arayüzde görünmez. */
const edgeCached = async (cacheKey, ctx, make) => {
  const key = new Request('https://atlas3d.cache/' + cacheKey);
  const hit = await caches.default.match(key); if (hit) return hit;
  const res = await make();
  if (res.status === 200) ctx.waitUntil(caches.default.put(key, res.clone()));
  return res;
};

// Mapillary: kapsama karoları (yeşil çizgiler ve fotoğraf noktaları) ve tek fotoğrafın bilgisi
async function mapillary(url, env, ctx) {
  const key = env.MAPILLARY_TOKEN;
  if (!key) return json({ error: 'mapillary-disabled' }, 404);
  const t = url.pathname.match(/^\/api\/mly\/tiles\/(\d{1,2})\/(\d+)\/(\d+)$/);
  if (t) {
    const [, z, x, y] = t;
    if (+z > 14) return new Response(null, { status: 204 });
    return edgeCached(`mly/t/${z}/${x}/${y}`, ctx, async () => {
      const r = await fetch(`https://tiles.mapillary.com/maps/vtp/mly1_public/2/${z}/${x}/${y}?access_token=${encodeURIComponent(key)}`);
      if (!r.ok) return new Response(null, { status: 204, headers: { 'x-upstream': String(r.status), 'cache-control': 'public, max-age=300' } });
      return new Response(r.body, { headers: { 'content-type': 'application/x-protobuf', 'cache-control': 'public, max-age=86400' } });
    });
  }
  if (url.pathname === '/api/mly/image') {
    const id = url.searchParams.get('id') || '';
    if (!/^\d{5,25}$/.test(id)) return json({ error: 'id' }, 400);
    return edgeCached(`mly/i/${id}`, ctx, async () => {
      const r = await fetch(`https://graph.mapillary.com/${id}?fields=id,thumb_1024_url,captured_at,compass_angle,computed_geometry,geometry,creator,is_pano`, { headers: { Authorization: 'OAuth ' + key } });
      if (!r.ok) return json({ error: 'upstream ' + r.status }, r.status === 404 ? 404 : 502);
      const d = await r.json(), g = d.computed_geometry || d.geometry;
      // Küçük resim adresleri süreli olduğu için kısa önbellek
      return json({ id: d.id, url: d.thumb_1024_url || null, at: d.captured_at || null, angle: d.compass_angle ?? null, lon: g?.coordinates?.[0] ?? null, lat: g?.coordinates?.[1] ?? null, by: d.creator?.username || '', pano: Boolean(d.is_pano) }, 200, 'public, max-age=1800');
    });
  }
  return json({ error: 'not-found' }, 404);
}

// Open Charge Map: sınır kutusundaki şarj istasyonları, sadeleştirilmiş
const OCM_CONN = { 1: 'Type 1 (J1772)', 2: 'CHAdeMO', 25: 'Type 2', 1036: 'Type 2 (kablolu)', 32: 'CCS (Type 1)', 33: 'CCS (Type 2)', 27: 'Tesla Supercharger', 30: 'Tesla', 28: 'Schuko', 23: 'Schuko' };
async function chargeMap(p, env, ctx) {
  const key = env.OCM_KEY;
  if (!key) return json({ error: 'ocm-disabled' }, 404);
  const bb = (p.get('bbox') || '').split(',').map(Number); // batı, güney, doğu, kuzey
  if (bb.length !== 4 || !bb.every(Number.isFinite) || bb[2] <= bb[0] || bb[3] <= bb[1] || bb[2] - bb[0] > 2.5 || bb[3] - bb[1] > 2.5) return json({ error: 'bbox' }, 400);
  const [w, s, e, n] = bb.map(v => v.toFixed(2));
  return edgeCached(`ocm/v1/${w},${s},${e},${n}`, ctx, async () => {
    const r = await fetch(`https://api.openchargemap.io/v3/poi/?output=json&maxresults=300&compact=false&verbose=false&boundingbox=(${n},${w}),(${s},${e})`, { headers: { 'X-API-Key': key, 'User-Agent': UA } });
    if (!r.ok) return json({ error: 'upstream ' + r.status }, r.status === 429 ? 503 : 502);
    const list = await r.json();
    const stations = (Array.isArray(list) ? list : []).map(x => {
      const a = x.AddressInfo || {};
      return {
        id: x.ID, name: a.Title || 'Şarj istasyonu', lat: a.Latitude, lon: a.Longitude,
        addr: [a.AddressLine1, a.Town, a.StateOrProvince].filter(Boolean).join(', '),
        op: x.OperatorInfo?.Title && !/unknown/i.test(x.OperatorInfo.Title) ? x.OperatorInfo.Title : '',
        cost: (x.UsageCost || '').slice(0, 120), ok: x.StatusType?.IsOperational ?? null, pts: x.NumberOfPoints || null,
        conns: (x.Connections || []).map(c => ({ t: c.ConnectionType?.Title || OCM_CONN[c.ConnectionTypeID] || 'Soket', kw: c.PowerKW || null, q: c.Quantity || 1, dc: c.CurrentTypeID === 30 }))
      };
    }).filter(st => Number.isFinite(st.lat) && Number.isFinite(st.lon));
    return json({ stations, source: 'Open Charge Map' }, 200, 'public, max-age=21600');
  });
}

// MapTiler: raster harita karoları (512 px; r=2 ile retina)
const MT_STYLES = { outdoor: 'outdoor-v2' };
async function mapTiler(url, env, ctx) {
  const key = env.MAPTILER_KEY;
  if (!key) return json({ error: 'maptiler-disabled' }, 404);
  const t = url.pathname.match(/^\/api\/mt\/([a-z]+)\/(\d{1,2})\/(\d+)\/(\d+)$/);
  if (!t || !MT_STYLES[t[1]]) return json({ error: 'not-found' }, 404);
  const [, st, z, x, y] = t, hi = url.searchParams.get('r') === '2';
  if (+z > 20) return new Response(null, { status: 204 });
  return edgeCached(`mt/${st}/${hi ? 2 : 1}/${z}/${x}/${y}`, ctx, async () => {
    const r = await fetch(`https://api.maptiler.com/maps/${MT_STYLES[st]}/${z}/${x}/${y}${hi ? '@2x' : ''}.png?key=${encodeURIComponent(key)}`, { headers: { Referer: url.origin + '/' } });
    if (!r.ok) return new Response(null, { status: r.status === 403 || r.status === 429 ? 204 : 502, headers: { 'x-upstream': String(r.status) } });
    return new Response(r.body, { headers: { 'content-type': r.headers.get('content-type') || 'image/png', 'cache-control': 'public, max-age=86400' } });
  });
}

// Kötüye kullanım koruması: başka sitelerin tarayıcıdan API'mizi çağırmasını engelle ve IP başına hız sınırı uygula.
// Sınırlayıcılar wrangler.toml'daki [[ratelimits]] bağlarından gelir; tanımlı değilse sınır uygulanmaz.
const crossSite = request => request.headers.get('sec-fetch-site') === 'cross-site';
async function overLimit(request, env, url) {
  const tile = (url.pathname.startsWith('/api/traffic/') && url.pathname.endsWith('.png')) || url.pathname.startsWith('/api/mly/tiles/') || url.pathname.startsWith('/api/mt/');
  const limiter = tile ? env.TILE_LIMIT : env.API_LIMIT;
  if (!limiter?.limit) return false;
  const ip = request.headers.get('cf-connecting-ip') || 'anon';
  try { const { success } = await limiter.limit({ key: ip }); return !success; } catch { return false; }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') {
      return json({ status: 'ok', traffic: Boolean(env.TOMTOM_API_KEY), mapbox: Boolean(env.MAPBOX_TOKEN), mapillary: Boolean(env.MAPILLARY_TOKEN), ocm: Boolean(env.OCM_KEY), maptiler: Boolean(env.MAPTILER_KEY), rateLimit: Boolean(env.API_LIMIT?.limit) });
    }
    if (url.pathname === '/api/config') {
      const cf = request.cf || {};
      return json({
        traffic: Boolean(env.TOMTOM_API_KEY), mapbox: Boolean(env.MAPBOX_TOKEN),
        mapillary: Boolean(env.MAPILLARY_TOKEN), ocm: Boolean(env.OCM_KEY), maptiler: Boolean(env.MAPTILER_KEY),
        ip: cf.latitude && cf.longitude ? { lat: Number(cf.latitude), lon: Number(cf.longitude), city: cf.city || '' } : null
      });
    }
    if (url.pathname.startsWith('/api/')) {
      if (crossSite(request)) return json({ error: 'forbidden' }, 403);
      if (await overLimit(request, env, url)) return new Response(JSON.stringify({ error: 'rate-limited' }), { status: 429, headers: { 'content-type': 'application/json; charset=utf-8', 'retry-after': '30', 'cache-control': 'no-store' } });
    }
    if (url.pathname === '/api/autocomplete' && env.MAPBOX_TOKEN) {
      try { return await mergedAutocomplete(url.searchParams, env, ctx, url.origin); } catch (e) { /* aşağıdaki Photon'a düş */ }
    }
    if (url.pathname === '/api/fuel') {
      try { return await fuelPrices(ctx); } catch (e) { return json({ error: String(e.message || e) }, 502); }
    }
    if (url.pathname.startsWith('/api/traffic/')) {
      try { return await traffic(request, url, env, ctx); }
      catch (e) { return json({ error: String(e.message || e) }, 502); }
    }
    if (url.pathname === '/api/match' && request.method === 'POST') { try { return await matchTrace(request, ctx); } catch (e) { return json({ error: String(e.message || e) }, 502); } }
    if (url.pathname.startsWith('/api/mly/')) { try { return await mapillary(url, env, ctx); } catch (e) { return json({ error: String(e.message || e) }, 502); } }
    if (url.pathname === '/api/ocm') { try { return await chargeMap(url.searchParams, env, ctx); } catch (e) { return json({ error: String(e.message || e) }, 502); } }
    if (url.pathname.startsWith('/api/mt/')) { try { return await mapTiler(url, env, ctx); } catch (e) { return json({ error: String(e.message || e) }, 502); } }
    const handler = routes[url.pathname];
    if (handler) {
      try { return await handler(url.searchParams, ctx, url.origin, env); }
      catch (e) { return json({ error: String(e.message || e) }, 502); }
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'not-found' }, 404);
    return env.ASSETS.fetch(request);
  }
};
