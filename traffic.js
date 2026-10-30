/* ================= Canlı trafik (TomTom, sunucu tarafında anahtarla) =================
   Anahtar yoksa (cfg.traffic false) bu dosyadaki hiçbir şey görünmez; site trafiksiz çalışır.
   - Katmanlar → "Canlı trafik": yollar akışa göre renklenir, kaza/çalışma simgeleri görünür.
   - Rota kartları: trafikli süre, gecikme, "Trafikte en hızlı" etiketi.
   - Rota üzerinde sıkışık kesimler renkli çizilir ve listelenir.
   - Navigasyonda trafik her 4 dakikada yenilenir, 2 km içindeki sıkışıklık için uyarı verilir. */
const TRAFFIC = { on: false, enabled: store.get('traffic', false), timer: null, navAt: 0, navBusy: false };
const TR_MAG = { 0: ['Yavaş trafik', '#f29900'], 1: ['Yavaş trafik', '#f29900'], 2: ['Sıkışık trafik', '#ea4335'], 3: ['Çok sıkışık', '#a50e0e'], 4: ['Yol kapalı', '#3c4043'] };
// TPEG/TEC olay sebebi kodları
const TR_CAUSE = { 2: ['Kaza', 'car_crash'], 3: ['Yol çalışması', 'construction'], 4: ['Şerit daralması', 'warning'], 5: ['Yol geçilemez', 'block'], 6: ['Kaygan yol', 'warning'],
  8: ['Yangın', 'local_fire_department'], 9: ['Tehlikeli sürüş koşulları', 'warning'], 10: ['Yolda cisim', 'warning'], 11: ['Yolda hayvan', 'warning'], 12: ['Yolda yaya', 'warning'],
  13: ['Arızalı araç', 'car_repair'], 14: ['Ters yönde araç', 'warning'], 15: ['Kaya düşmesi', 'warning'], 16: ['Trafik düzenlemesi', 'warning'] };
function trSecInfo(s) {
  const cz = TR_CAUSE[s.cause];
  if (cz && s.cat !== 'ROAD_CLOSURE') { const c = (TR_MAG[s.mag] || TR_MAG[1])[1]; return [cz[0] + (s.mag >= 2 ? ' · sıkışık' : ''), c, cz[1]]; }
  if (s.cat === 'ROAD_CLOSURE') return ['Yol kapalı', '#3c4043', 'block'];
  if (s.cat === 'ROAD_WORK') return ['Yol çalışması', s.mag >= 2 ? '#ea4335' : '#f29900', 'construction'];
  const [t, c] = TR_MAG[s.mag] || TR_MAG[1];
  return [t, c, 'traffic'];
}
const trTime = r => (dir.mode === 'car' && r.traffic ? r.traffic.travel : r.duration);

/* ----- Rota boyunca seyrek nokta (TomTom rotayı bu noktalardan yeniden kurar) ----- */
function trPoints(r, from = 0) {
  const span = r.total - from; if (span < 50) return null;
  const n = Math.max(2, Math.min(380, Math.ceil(span / 150)));
  const pts = []; let j = 0;
  for (let k = 0; k <= n; k++) {
    const d = from + span * k / n; while (j < r.cum.length - 2 && r.cum[j + 1] < d) j++;
    const seg = r.cum[j + 1] - r.cum[j] || 1, t = Math.max(0, Math.min(1, (d - r.cum[j]) / seg)), a = r.coords[j], b = r.coords[j + 1] || a;
    pts.push([+(a[0] + (b[0] - a[0]) * t).toFixed(5), +(a[1] + (b[1] - a[1]) * t).toFixed(5)]);
  }
  return pts;
}
// Bir noktanın rota üzerindeki mesafesi (ileri doğru arar, sıra korunur)
function trAlong(r, p, startIdx) {
  const c = r.coords, kx = Math.cos(p[1] * Math.PI / 180) * 111320, ky = 110540;
  let best = { d: Infinity, i: startIdx, t: 0 };
  for (let i = startIdx; i < c.length - 1; i++) {
    const ax = (c[i][0] - p[0]) * kx, ay = (c[i][1] - p[1]) * ky, bx = (c[i + 1][0] - p[0]) * kx, by = (c[i + 1][1] - p[1]) * ky;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0, d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best.d) best = { d, i, t };
    if (best.d < 5 && d > 3000) break;
  }
  return { at: r.cum[best.i] + (r.cum[best.i + 1] - r.cum[best.i]) * best.t, i: best.i, off: best.d };
}
async function trFetchRoute(r, from = 0) {
  const points = trPoints(r, from); if (!points) return null;
  const res = await fetch('/api/traffic/route', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ points }) });
  if (!res.ok) throw new Error('trafik ' + res.status);
  const d = await res.json();
  if (!d.travel) return null;
  // TomTom'un kurduğu rota bizimkinden çok farklıysa (ör. yanlış yola sapmışsa) güvenme
  if (d.length && Math.abs(d.length - (r.total - from)) / (r.total - from) > 0.25) return null;
  return trConvert(r, d, from);
}
function trConvert(r, d, from = 0) {
  let idx = 0; const secs = [];
  for (const s of d.sections || []) {
    if (!s.coords?.length) continue;
    const a = trAlong(r, s.coords[0], idx); idx = a.i;
    const b = trAlong(r, s.coords[s.coords.length - 1], idx); idx = b.i;
    if (a.off > 250 || b.off > 250 || b.at - a.at < 30) continue;
    secs.push({ ...s, at: a.at, to: b.at, len: b.at - a.at });
  }
  return { travel: d.travel, delay: d.delay || 0, free: d.noTraffic, length: d.length, sections: secs, from, fetched: Date.now(), dataAt: d.at };
}
async function loadTraffic(routes) {
  if (!TRAFFIC.on || dir.mode !== 'car' || !routes?.length) return;
  // TomTom'dan gelen rotalar trafiği zaten taşır; yalnızca rota üzerindeki konumlara çevir
  for (const r of routes) if (r.traffic && !r.traffic.fetched) r.traffic = trConvert(r, r.traffic);
  const todo = routes.filter(r => !r.trafficPending && !(r.traffic && Date.now() - r.traffic.fetched < 110000));
  if (!todo.length) { if (dir.routes === routes && !navActive) refreshDirResults(); drawTraffic(); return; }
  todo.forEach(r => { r.trafficPending = true; });
  await Promise.all(todo.map(async r => {
    try { r.traffic = await trFetchRoute(r); } catch (e) { console.warn(e); r.traffic = null; }
    r.trafficPending = false;
  }));
  if (!routes.some(r => dir.routes.includes(r)) || (navActive && navRoute && !routes.includes(navRoute))) return;
  if (!navActive) refreshDirResults();
  drawTraffic();
}

/* ----- Rota kartı ve panel ----- */
function trafficSectionHtml(r) {
  if (!TRAFFIC.on || dir.mode !== 'car' || !r.traffic) return '';
  const t = r.traffic, secs = t.sections.filter(s => s.at >= t.from);
  const when = new Date(t.dataAt || t.fetched);
  if (!secs.length) return `<div class="tr-sec"><div class="tr-h"><span class="ms" style="color:#188038">traffic</span><b>Rotada sıkışıklık yok</b><span class="tr-upd">${fmtClock(when)} itibarıyla</span></div></div>`;
  return `<div class="tr-sec">
    <div class="tr-h"><span class="ms">traffic</span><b>Trafik durumu</b><span class="tr-total">+${fmtDur(Math.max(60, t.delay))}</span></div>
    <ol class="tr-list">${secs.map((s, k) => { const [txt, col, ic] = trSecInfo(s); return `<li data-k="${k}"><span class="ms" style="color:${col}">${ic}</span><span class="tl-m"><b>${txt} · ${fmtDist(s.len)}</b><small>${fmtDist(s.at)} sonra${s.speed ? ` · ortalama ${Math.round(s.speed)} km/sa` : ''}</small></span><span class="tl-p" style="color:${col}">${s.delay >= 60 ? '+' + fmtDur(s.delay) : '<1 dk'}</span></li>`; }).join('')}</ol>
    <p class="toll-fine">TomTom canlı trafik verisi · ${fmtClock(when)} itibarıyla. Kesime dokununca haritada gösterilir.</p>
  </div>`;
}
function wireTraffic(box) {
  box.querySelectorAll('.tr-list li').forEach(li => {
    li.onclick = () => {
      const r = dir.routes[dir.sel], s = r.traffic.sections.filter(x => x.at >= r.traffic.from)[+li.dataset.k]; if (!s) return;
      if (isMobile()) setSheet('min');
      viewSegment(s.coords[0], s.coords[s.coords.length - 1]);
    };
  });
}

/* ----- Haritada: rota üzerindeki sıkışık kesimler ----- */
function drawTraffic() {
  const src = map?.getSource('a3-tr-sec'); if (!src) return;
  const r = navActive ? navRoute : dir.routes[dir.sel];
  const feats = TRAFFIC.on && dir.mode === 'car' && r?.traffic ? r.traffic.sections.map(s => ({ type: 'Feature', properties: { c: trSecInfo(s)[1] }, geometry: { type: 'LineString', coordinates: s.coords } })) : [];
  src.setData({ type: 'FeatureCollection', features: feats });
}
function trAddLayers() {
  if (!map?.getSource || map.getSource('a3-tr-sec')) return;
  const before = map.getStyle().layers.find(l => l.type === 'symbol')?.id;
  const W = (a, b) => ['interpolate', ['linear'], ['zoom'], 8, a, 16, b];
  map.addSource('a3-traffic-flow', { type: 'raster', tiles: [trTiles('flow')], tileSize: 256, minzoom: 5, maxzoom: 18 });
  map.addSource('a3-traffic-inc', { type: 'raster', tiles: [trTiles('incidents')], tileSize: 256, minzoom: 5, maxzoom: 18 });
  map.addSource('a3-tr-sec', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  const vis = TRAFFIC.enabled ? 'visible' : 'none';
  map.addLayer({ id: 'a3-traffic-flow', type: 'raster', source: 'a3-traffic-flow', layout: { visibility: vis }, paint: { 'raster-opacity': 0.95, 'raster-fade-duration': 0 } }, before);
  map.addLayer({ id: 'a3-traffic-inc', type: 'raster', source: 'a3-traffic-inc', minzoom: 10, layout: { visibility: vis }, paint: { 'raster-fade-duration': 0 } });
  map.addLayer({ id: 'a3-tr-sec', type: 'line', source: 'a3-tr-sec', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': ['get', 'c'], 'line-width': W(4, 9) } }, map.getLayer('a3-route-dir') ? 'a3-route-dir' : undefined);
  ['a3-traffic-flow', 'a3-traffic-inc', 'a3-tr-sec'].forEach(id => OWN.add(id));
}
const trTiles = kind => `/api/traffic/${kind}/{z}/{x}/{y}.png?v=${Math.floor(Date.now() / 120000)}`;
function setTrafficLayer(on) {
  TRAFFIC.enabled = on; store.set('traffic', on);
  const el = $('opt-traffic'); if (el) el.checked = on;
  $('traffic-legend').hidden = !on;
  if (!map?.getLayer('a3-traffic-flow')) return;
  ['a3-traffic-flow', 'a3-traffic-inc'].forEach(id => map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));
  clearInterval(TRAFFIC.timer);
  if (on) {
    ['flow', 'incidents'].forEach(k => map.getSource(k === 'flow' ? 'a3-traffic-flow' : 'a3-traffic-inc').setTiles([trTiles(k)]));
    TRAFFIC.timer = setInterval(() => { if (document.hidden) return; ['flow', 'incidents'].forEach(k => map.getSource(k === 'flow' ? 'a3-traffic-flow' : 'a3-traffic-inc')?.setTiles([trTiles(k)])); }, 120000);
  }
}

/* ----- Navigasyon: kalan süre, periyodik yenileme, sıkışıklık uyarısı ----- */
function trafficRemTime(r, along, remaining) {
  const t = r.traffic;
  if (!TRAFFIC.on || dir.mode !== 'car' || !t) return null;
  return t.travel * (remaining / Math.max(1, r.total - t.from));
}
function trafficNavTick(r, along) {
  if (!TRAFFIC.on || dir.mode !== 'car') return;
  const t = r.traffic;
  if (t) for (const s of t.sections) {
    const ahead = s.at - along, key = 'jam:' + Math.round(s.at / 100);
    if (ahead > 0 && ahead <= 2000 && !navAnnounced.has(key) && (s.delay >= 60 || s.cat === 'ROAD_CLOSURE')) {
      navAnnounced.add(key);
      const [txt] = trSecInfo(s);
      toast(`${fmtDist(ahead)} sonra ${txt.toLowerCase()} · ${fmtDist(s.len)}${s.delay >= 60 ? ' · +' + fmtDur(s.delay) : ''}`, 6000);
      setTimeout(() => say(`${fmtDist(ahead).replace(/ m$/, ' metre').replace(/ km$/, ' kilometre')} sonra ${txt.toLowerCase()}. Yaklaşık ${Math.max(1, Math.round(s.delay / 60))} dakika gecikme.`), 5500);
    }
  }
  // Kalan yol için trafiği 4 dakikada bir yenile
  if (TRAFFIC.navBusy || r.trafficPending || Date.now() - (t?.fetched || TRAFFIC.navAt) < 240000 || r.total - along < 1500) return;
  TRAFFIC.navBusy = true; TRAFFIC.navAt = Date.now();
  const oldEta = t ? Date.now() + trafficRemTime(r, along, r.total - along) * 1000 : null;
  trFetchRoute(r, along).then(nt => {
    if (!nt || navRoute !== r) return;
    r.traffic = nt; drawTraffic();
    const newEta = Date.now() + nt.travel * 1000, diff = oldEta ? Math.round((newEta - oldEta) / 60000) : 0;
    if (diff >= 5) { toast(`Trafik nedeniyle varış ${diff} dk gecikti`, 6000); say(`Trafik yoğunlaştı. Varış ${diff} dakika gecikti.`); }
    else if (diff <= -5) toast(`Trafik açıldı: varış ${-diff} dk erken`, 5000);
  }).catch(() => {}).finally(() => { TRAFFIC.navBusy = false; });
}

/* ----- Başlat: anahtar varsa katman anahtarını göster ----- */
cfgReady.then(c => {
  if (!c.traffic) return;
  TRAFFIC.on = true;
  $('opt-traffic-row').hidden = false;
  $('opt-traffic').onchange = e => setTrafficLayer(e.target.checked);
  (function waitMap() {
    if (map?.getLayer?.('a3-route')) { trAddLayers(); setTrafficLayer(TRAFFIC.enabled); if (dir.routes.length && !navActive) loadTraffic(dir.routes); }
    else setTimeout(waitMap, 300);
  })();
});

/* ----- TomTom rotaları: trafiğe göre farklı yol ve ücretli yol içermeyen seçenek ----- */
async function fetchTomTomRoutes(coords, ctrl, mode) {
  if (!(await cfgReady).traffic || mode !== 'car') return null;
  const get = q => fetch('/api/traffic/routes?' + new URLSearchParams({ coords, ...q }), { signal: ctrl.signal }).then(r => (r.ok ? r.json() : null)).catch(() => null);
  const [main, free] = await Promise.all([get({ alt: '2' }), get({ alt: '0', avoid: 'toll' })]);
  return { main: main?.routes || [], free: free?.routes || [] };
}
// İki rotanın ne kadar ortak yol paylaştığı (0–1): b'nin a üzerinde kalan payı
function trCells(r, step) {
  const set = new Set(); let j = 0;
  for (let d = 0; d <= r.total; d += step) {
    while (j < r.cum.length - 2 && r.cum[j + 1] < d) j++;
    const a = r.coords[j], b = r.coords[j + 1] || a, t = Math.max(0, Math.min(1, (d - r.cum[j]) / (r.cum[j + 1] - r.cum[j] || 1)));
    set.add(Math.round((a[0] + (b[0] - a[0]) * t) / 0.002) + ':' + Math.round((a[1] + (b[1] - a[1]) * t) / 0.002));
  }
  return set;
}
function trOverlap(a, b) {
  const A = a._cells || (a._cells = trCells(a, 80)), B = trCells(b, 400);
  let hit = 0;
  for (const k of B) { const [x, y] = k.split(':').map(Number); let ok = false; for (let dx = -1; dx <= 1 && !ok; dx++) for (let dy = -1; dy <= 1 && !ok; dy++) ok = A.has((x + dx) + ':' + (y + dy)); if (ok) hit++; }
  return hit / Math.max(1, B.size);
}
function mergeTomTomRoutes(tt, ctrl, mode, a, b) {
  if (!tt || ctrl !== routeCtrl || dir.mode !== mode || navActive || !dir.routes.length) return;
  const add = [], all = () => [...dir.routes, ...add];
  const differs = (r, lim) => all().every(x => trOverlap(x, r) < lim);
  const tt0 = r => r.traffic?.travel ?? r.duration;
  // Önce ücretli yol içermeyen rota (mevcutların hepsi ücretliyse)
  let freeAdded = false;
  if (tt.free[0] && !all().some(x => x.tolls && !x.tolls.items.some(i => i.kind !== 'feribot'))) {
    const r = prepRoute(tt.free[0]);
    if (r.tolls) { const f = r.tolls.items.filter(i => i.kind === 'feribot'); r.tolls = { ...r.tolls, items: f, total: f.reduce((t, i) => t + (i.price || 0), 0) }; } // TomTom ücretli yollardan kaçındı (feribot hariç)
    if (differs(r, 0.97)) { add.push(r); freeAdded = true; }
  }
  // Sonra trafiğe göre farklı yol: yalnızca gerçekten rekabetçiyse (en hızlıdan en fazla %15 yavaş)
  const best = Math.min(...dir.routes.map(tt0), ...tt.main.map(x => x.traffic?.travel ?? Infinity));
  let n = 0;
  for (const raw of tt.main) {
    if (all().length >= 5) break;
    if ((raw.traffic?.travel ?? Infinity) > best * 1.15) continue;
    const r = prepRoute(raw);
    if (differs(r, 0.8)) { add.push(r); n++; }
  }
  if (!add.length) return;
  dir.routes = [...dir.routes, ...add];
  drawRoutes(); setRouteMarkers(a, b); loadProfiles();
  toast([n ? `Trafiğe göre ${n} rota daha bulundu` : '', freeAdded ? 'Ücretli yol içermeyen rota eklendi' : ''].filter(Boolean).join(' · '), 3500);
}

/* ----- Ulaşılabilir alan: buradan 15 / 30 / 60 dakikada araçla nereye gidilir (trafikle) ----- */
const RANGE = { ll: null, min: 30, ctrl: null };
function ctxExtra(m, ll) {
  if (!TRAFFIC.on) return;
  const b = document.createElement('button'); b.dataset.a = 'range';
  b.innerHTML = '<span class="ms">timelapse</span>Buradan ulaşılabilir alan';
  b.addEventListener('click', () => openRange(ll));
  m.insertBefore(b, m.querySelector('[data-a="measure"]'));
}
function rangeLayers() {
  if (map.getSource('a3-range')) return;
  const before = map.getStyle().layers.find(l => l.type === 'symbol')?.id;
  map.addSource('a3-range', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  map.addLayer({ id: 'a3-range-fill', type: 'fill', source: 'a3-range', paint: { 'fill-color': '#1a73e8', 'fill-opacity': 0.14 } }, before);
  map.addLayer({ id: 'a3-range-line', type: 'line', source: 'a3-range', paint: { 'line-color': '#1a73e8', 'line-width': 2.5 } }, before);
  OWN.add('a3-range-fill'); OWN.add('a3-range-line');
}
let rangeMarker = null;
async function openRange(ll, min = RANGE.min) {
  RANGE.ll = ll; RANGE.min = min; rangeLayers();
  $('range-bar').hidden = false;
  $('range-mins').querySelectorAll('button').forEach(b => b.classList.toggle('on', +b.dataset.m === min));
  $('range-text').textContent = 'Hesaplanıyor…';
  if (!rangeMarker) rangeMarker = new maplibregl.Marker({ element: makeEl('<div class="start-dot"></div>') });
  rangeMarker.setLngLat([ll.lon, ll.lat]).addTo(map);
  RANGE.ctrl?.abort(); const ctrl = RANGE.ctrl = new AbortController();
  try {
    const res = await fetch('/api/traffic/range?' + new URLSearchParams({ lat: ll.lat.toFixed(5), lon: ll.lon.toFixed(5), min }), { signal: ctrl.signal });
    const d = res.ok ? await res.json() : null;
    if (!d?.ring?.length) throw new Error();
    map.getSource('a3-range').setData({ type: 'Feature', properties: {}, geometry: { type: 'Polygon', coordinates: [d.ring] } });
    const bb = new maplibregl.LngLatBounds(); d.ring.forEach(p => bb.extend(p));
    map.fitBounds(bb, { padding: mapPadding(), pitch: 0, bearing: 0, duration: 1000 });
    $('range-text').textContent = `${min < 60 ? min + ' dk' : '1 saat'} içinde araçla (şu anki trafikle)`;
  } catch (e) { if (e.name !== 'AbortError') $('range-text').textContent = 'Alan hesaplanamadı'; }
}
function closeRange() {
  RANGE.ctrl?.abort(); $('range-bar').hidden = true; rangeMarker?.remove();
  map.getSource('a3-range')?.setData({ type: 'FeatureCollection', features: [] });
}
$('range-mins').addEventListener('click', e => { const m = +e.target.closest('button')?.dataset.m; if (m && RANGE.ll) openRange(RANGE.ll, m); });
$('range-end').onclick = closeRange;
