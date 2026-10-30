// ATLAS3D Cloudflare Worker — harita servisleri için önbellekli, hız sınırlı API katmanı
//   /api/autocomplete  Photon (+ MAPBOX_TOKEN varsa Mapbox adresleri)
//   /api/search        Nominatim (tam arama)
//   /api/reverse       Nominatim (koordinattan adres)
//   /api/lookup        Nominatim (OSM nesne detayı: telefon, web, saatler)
//   /api/route         OSRM (araç / yürüyüş / bisiklet rota)
//   /api/nearby        Nominatim (harita alanında kategori araması)
//   /api/fuel          EPDK günlük akaryakıt ve LPG bayi satış fiyatı bülteni (Türkiye ortalaması)
//   /api/traffic/*     TomTom (TOMTOM_API_KEY varsa): trafik karoları, trafikli rota, ulaşılabilir alan
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
    return cachedFetch(`${NOMINATIM}/search?format=jsonv2&limit=40&bounded=1&addressdetails=1&extratags=1&accept-language=tr&viewbox=${w},${n},${e},${s}&q=` + encodeURIComponent(q), 86400, ctx, origin);
  }
};


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

// Kötüye kullanım koruması: başka sitelerin tarayıcıdan API'mizi çağırmasını engelle ve IP başına hız sınırı uygula.
// Sınırlayıcılar wrangler.toml'daki [[ratelimits]] bağlarından gelir; tanımlı değilse sınır uygulanmaz.
const crossSite = request => request.headers.get('sec-fetch-site') === 'cross-site';
async function overLimit(request, env, url) {
  const tile = url.pathname.startsWith('/api/traffic/') && url.pathname.endsWith('.png');
  const limiter = tile ? env.TILE_LIMIT : env.API_LIMIT;
  if (!limiter?.limit) return false;
  const ip = request.headers.get('cf-connecting-ip') || 'anon';
  try { const { success } = await limiter.limit({ key: ip }); return !success; } catch { return false; }
}

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    if (url.pathname === '/api/health') {
      return json({ status: 'ok', traffic: Boolean(env.TOMTOM_API_KEY), mapbox: Boolean(env.MAPBOX_TOKEN), rateLimit: Boolean(env.API_LIMIT?.limit) });
    }
    if (url.pathname === '/api/config') {
      const cf = request.cf || {};
      return json({
        traffic: Boolean(env.TOMTOM_API_KEY), mapbox: Boolean(env.MAPBOX_TOKEN),
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
    const handler = routes[url.pathname];
    if (handler) {
      try { return await handler(url.searchParams, ctx, url.origin, env); }
      catch (e) { return json({ error: String(e.message || e) }, 502); }
    }
    if (url.pathname.startsWith('/api/')) return json({ error: 'not-found' }, 404);
    return env.ASSETS.fetch(request);
  }
};
