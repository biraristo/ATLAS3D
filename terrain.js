// ATLAS3D — arazi araçları: eğim haritası, eş yükselti eğrileri, yükseklik abartma,
// rotanın 3D önizlemesi, ölçüm profili ve GPS'e göre anlık çıkış/iniş göstergesi.
'use strict';

/* ================= Eğim haritası (DEM'den tarayıcıda hesaplanır, anahtarsız) ================= */
const SLOPE_BANDS = [[5, null], [10, [163, 230, 53]], [20, [250, 204, 21]], [35, [249, 115, 22]], [60, [220, 38, 38]], [Infinity, [126, 34, 206]]];
async function encodePng(imgData) {
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(256, 256); c.getContext('2d').putImageData(imgData, 0, 0);
    return (await c.convertToBlob({ type: 'image/png' })).arrayBuffer();
  }
  const c = document.createElement('canvas'); c.width = c.height = 256; c.getContext('2d').putImageData(imgData, 0, 0);
  return new Promise(ok => c.toBlob(b => b.arrayBuffer().then(ok), 'image/png'));
}
maplibregl.addProtocol('slope', async params => {
  try { return await slopeTile(params); } catch (e) { console.error('slope tile', params.url, e); throw e; }
});
async function slopeTile(params) {
  const [z, x, y] = params.url.replace('slope://', '').split('/').map(Number);
  const src = await DEM.tile(z, x, y);
  const out = new ImageData(256, 256);
  if (src) {
    const n = 2 ** z, lat = Math.atan(Math.sinh(Math.PI * (1 - 2 * (y + 0.5) / n))) * 180 / Math.PI;
    const res = 40075016.686 * Math.cos(lat * Math.PI / 180) / (256 * n);
    const E = new Float32Array(65536), d = src.data;
    for (let i = 0; i < 65536; i++) E[i] = d[i * 4] * 256 + d[i * 4 + 1] + d[i * 4 + 2] / 256 - 32768;
    const k = z >= 12 ? 2 : 1; // ~30 m taban aralığı: SRTM gürültüsünü azaltır
    const g = (xx, yy) => E[Math.max(0, Math.min(255, yy)) * 256 + Math.max(0, Math.min(255, xx))];
    for (let yy = 0; yy < 256; yy++) for (let xx = 0; xx < 256; xx++) {
      // Horn yöntemi (3x3 komşuluk)
      const a = g(xx - k, yy - k), b = g(xx, yy - k), c = g(xx + k, yy - k), dd = g(xx - k, yy), f = g(xx + k, yy), gg = g(xx - k, yy + k), h = g(xx, yy + k), i = g(xx + k, yy + k);
      const dx = ((c + 2 * f + i) - (a + 2 * dd + gg)) / (8 * res * k), dy = ((gg + 2 * h + i) - (a + 2 * b + c)) / (8 * res * k);
      const pct = Math.hypot(dx, dy) * 100;
      const band = SLOPE_BANDS.find(s => pct < s[0])[1];
      if (band) { const o = (yy * 256 + xx) * 4; out.data[o] = band[0]; out.data[o + 1] = band[1]; out.data[o + 2] = band[2]; out.data[o + 3] = pct >= 35 ? 175 : 140; }
    }
  }
  return { data: await encodePng(out) };
}
function ensureSlopeLayer() {
  if (map.getLayer('a3-slope')) return;
  map.addSource('a3-slope', { type: 'raster', tiles: ['slope://{z}/{x}/{y}'], tileSize: 256, minzoom: 9, maxzoom: 13 });
  const before = map.getStyle().layers.find(l => l.type === 'line' && !OWN.has(l.id))?.id;
  map.addLayer({ id: 'a3-slope', type: 'raster', source: 'a3-slope', minzoom: 9, paint: { 'raster-opacity': 0.8, 'raster-fade-duration': 150 } }, before);
  OWN.add('a3-slope');
}

/* ================= Eş yükselti eğrileri (maplibre-contour) ================= */
let contourReady = null;
function ensureContours() {
  if (contourReady) return contourReady;
  contourReady = loadScript('https://unpkg.com/maplibre-contour@0.1.1/dist/index.min.js').then(() => {
    const dem = new mlcontour.DemSource({ url: TERRARIUM[0], encoding: 'terrarium', maxzoom: 13, worker: true });
    dem.setupMaplibre(maplibregl);
    map.addSource('a3-contours', { type: 'vector', maxzoom: 15, tiles: [dem.contourProtocolUrl({
      thresholds: { 9: [200, 1000], 11: [100, 500], 12: [50, 250], 13: [20, 100], 14: [10, 50] },
      elevationKey: 'ele', levelKey: 'level', contourLayer: 'contours' })] });
    const before = map.getStyle().layers.find(l => l.type === 'symbol')?.id;
    map.addLayer({ id: 'a3-contour-line', type: 'line', source: 'a3-contours', 'source-layer': 'contours', minzoom: 9,
      paint: { 'line-color': '#8d6e4a', 'line-opacity': ['match', ['get', 'level'], 1, 0.55, 0.3], 'line-width': ['match', ['get', 'level'], 1, 1.1, 0.6] } }, before);
    map.addLayer({ id: 'a3-contour-label', type: 'symbol', source: 'a3-contours', 'source-layer': 'contours', minzoom: 11, filter: ['>', ['get', 'level'], 0],
      layout: { 'symbol-placement': 'line', 'text-size': 10, 'text-field': ['concat', ['number-format', ['get', 'ele'], {}], ' m'], 'text-font': ['Noto Sans Regular'], 'symbol-spacing': 300 },
      paint: { 'text-color': '#6d5235', 'text-halo-color': 'rgba(255,255,255,.85)', 'text-halo-width': 1.2 } }, before);
    ['a3-contour-line', 'a3-contour-label'].forEach(id => OWN.add(id));
  }).catch(e => { contourReady = null; toast('Eş yükselti eğrileri yüklenemedi'); throw e; });
  return contourReady;
}

/* ================= Arazi seçenekleri ================= */
opts.slope ??= false; opts.contours ??= true; opts.exag ??= EXAG;
function applyTerrainOpts() {
  if (!map?.getLayer('a3-sat')) return;
  if (opts.slope) ensureSlopeLayer();
  if (map.getLayer('a3-slope')) map.setLayoutProperty('a3-slope', 'visibility', opts.slope ? 'visible' : 'none');
  if (opts.contours) ensureContours().then(() => { ['a3-contour-line', 'a3-contour-label'].forEach(id => map.setLayoutProperty(id, 'visibility', opts.contours ? 'visible' : 'none')); }).catch(() => {});
  else ['a3-contour-line', 'a3-contour-label'].forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', 'none'));
  if (opts.terrain) map.setTerrain({ source: 'dem', exaggeration: opts.exag });
  $('slope-legend').hidden = !opts.slope;
}
$('opt-slope').checked = opts.slope; $('opt-contours').checked = opts.contours; $('opt-exag').value = opts.exag; $('exag-val').textContent = nf1.format(opts.exag) + '×';
$('opt-slope').onchange = e => { opts.slope = e.target.checked; store.set('opts', opts); applyTerrainOpts(); };
$('opt-contours').onchange = e => { opts.contours = e.target.checked; store.set('opts', opts); applyTerrainOpts(); };
$('opt-exag').oninput = e => {
  opts.exag = +e.target.value; $('exag-val').textContent = nf1.format(opts.exag) + '×'; store.set('opts', opts);
  if (!opts.terrain) { opts.terrain = true; $('opt-terrain').checked = true; }
  map.setTerrain({ source: 'dem', exaggeration: opts.exag });
};
// 3D arazi anahtarı abartma değerini kullansın
$('opt-terrain').onchange = e => { opts.terrain = e.target.checked; store.set('opts', opts); map.setTerrain(opts.terrain ? { source: 'dem', exaggeration: opts.exag } : null); };
// "Arazi" altlığı seçilince eş yükselti eğrileri otomatik açılır
const _setBasemap = setBasemap;
setBasemap = id => { _setBasemap(id); if (id === 'terrain' && !opts.contours) { opts.contours = true; $('opt-contours').checked = true; store.set('opts', opts); applyTerrainOpts(); } };
(function waitMap() { if (map?.getLayer?.('a3-sat')) applyTerrainOpts(); else setTimeout(waitMap, 300); })();

/* ================= Rotanın 3D önizlemesi ================= */
let flyRaf = null;
function stopFlyover() {
  if (flyRaf) cancelAnimationFrame(flyRaf); flyRaf = null;
  $('fly-bar').hidden = true; body.classList.remove('flying'); profMarker?.remove();
  removeEventListener('keydown', flyKey);
}
const flyKey = e => { if (e.key === 'Escape') stopFlyover(); };
function flyover(r) {
  if (!r) return; stopFlyover();
  if (!opts.terrain) { opts.terrain = true; $('opt-terrain').checked = true; map.setTerrain({ source: 'dem', exaggeration: opts.exag }); }
  const len = r.total, dur = Math.min(90000, Math.max(18000, 18000 + len / 1000 * 900));
  const look = Math.min(2500, Math.max(150, len * 0.025)), zoom = Math.max(12.3, Math.min(16.2, 16.6 - Math.log2(look / 150)));
  const ptAt = d => { let j = 0, lo = 0, hi = r.cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (r.cum[m] < d) lo = m + 1; else hi = m; } j = Math.max(0, lo - 1);
    const s = r.cum[j + 1] - r.cum[j] || 1, t = Math.max(0, Math.min(1, (d - r.cum[j]) / s)), A = r.coords[j], B = r.coords[Math.min(j + 1, r.coords.length - 1)];
    return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]; };
  let bearing = bearingOf(ptAt(0), ptAt(look)), t0 = null;
  if (isMobile()) setSheet('min');
  body.classList.add('flying'); $('fly-bar').hidden = false;
  if (!profMarker) profMarker = new maplibregl.Marker({ element: makeEl('<div class="prof-dot"></div>') });
  map.jumpTo({ center: ptAt(0), zoom, pitch: 68, bearing });
  const frame = ts => {
    t0 ??= ts; const f = Math.min(1, (ts - t0) / dur), e = f < 0.5 ? 2 * f * f : 1 - (-2 * f + 2) ** 2 / 2;
    const d = e * len, c = ptAt(d), target = bearingOf(c, ptAt(Math.min(len, d + look)));
    let db = ((target - bearing + 540) % 360) - 180; bearing = (bearing + db * 0.04 + 360) % 360;
    map.jumpTo({ center: c, zoom, pitch: 68, bearing });
    profMarker.setLngLat(c).addTo(map);
    const p = r.profile ? profileAt(r.profile, d) : null;
    $('fly-info').innerHTML = `<b>${fmtDist(d)}</b> / ${fmtDist(len)}` + (p ? ` · ${nf0.format(Math.round(p.elev))} m · <span style="color:${slopeColor(p.slope)}">${fmtSlope(p.slope)} ${p.slope > 2 ? 'tırmanış' : p.slope < -2 ? 'iniş' : 'düz'}</span>` : '');
    $('fly-prog').style.width = (f * 100).toFixed(1) + '%';
    if (f < 1) flyRaf = requestAnimationFrame(frame); else { stopFlyover(); fitRoute(); }
  };
  flyRaf = requestAnimationFrame(frame);
  addEventListener('keydown', flyKey);
}
$('fly-stop').onclick = () => { stopFlyover(); fitRoute(); };
$('map').addEventListener('pointerdown', () => { if (flyRaf) stopFlyover(); });
$('map').addEventListener('wheel', () => { if (flyRaf) stopFlyover(); }, { passive: true });

/* ================= Ölçüm profili ================= */
$('measure-prof').onclick = async () => {
  if (measurePts.length < 2) { toast('Profil için en az iki nokta ekleyin'); return; }
  const coords = measurePts.map(p => [...p]), cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
  const r = { coords, cum, total: cum[cum.length - 1] };
  openPanel(el => { el.innerHTML = '<div class="loading"><div class="spinner"></div>Profil hesaplanıyor…</div>'; }, { mode: 'list' });
  try {
    const pr = await buildProfile(r, r.total < 40000 ? 13 : 12);
    if (!pr) throw new Error();
    openPanel(el => {
      el.innerHTML = `<div class="list-head drag-zone"><h2>Arazi kesiti</h2><small>${fmtDist(r.total)} · ${measurePts.length} nokta (kuş uçuşu)</small></div>
        <div class="profile">${profileStatsHtml(pr)}${profileSvg(pr, 'mprof')}<div class="ptip" id="mprof-tip">Grafikte gezdirin: haritada konumu gösterir</div></div>
        <div class="mini-note">Kesit, işaretlediğiniz noktalar arasındaki düz çizgi boyunca arazi yüksekliğini gösterir.</div>`;
      wireProfile(pr, 'mprof');
    }, { mode: 'list' });
  } catch { openPanel(el => { el.innerHTML = '<div class="empty">Yükseklik verisi alınamadı.</div>'; }, { mode: 'list' }); }
};

/* ================= GPS'e göre anlık çıkış / iniş ================= */
const gpsTrail = []; let gpsHudUntil = 0, gpsBusy = false;
meListeners.add(async () => {
  if (!meLngLat || gpsBusy) return; gpsBusy = true;
  try {
    const here = [...meLngLat], elev = await DEM.at(here[0], here[1], 13);
    if (elev == null) return;
    // Yerinde dururken GPS titremesi izi doldurmasın: en az 8 m hareket edince yeni nokta
    const last = gpsTrail[gpsTrail.length - 1];
    if (!last || haversine(last.p, here) >= 8) gpsTrail.push({ p: here, e: elev, t: Date.now() }); else { last.e = elev; last.t = Date.now(); }
    while (gpsTrail.length > 60 || (gpsTrail.length && Date.now() - gpsTrail[0].t > 180000)) gpsTrail.shift();
    // ~40 m ve üzeri yol katedilmişse eğimi hesapla
    let ref = null, dist = 0;
    for (let i = gpsTrail.length - 2; i >= 0; i--) { dist += haversine(gpsTrail[i].p, gpsTrail[i + 1].p); if (dist >= 40) { ref = gpsTrail[i]; break; } }
    const g = ref ? (elev - ref.e) / dist * 100 : null;
    if (navActive) return;
    gpsHudUntil = Date.now() + 20000;
    HUD.trail = gpsTrail.map(x => x.e);
    HUD.trailDist = gpsTrail.reduce((s, x, k) => k ? s + haversine(gpsTrail[k - 1].p, x.p) : 0, 0);
    setHud({ source: 'gps', elev, grade: g, sub: ref ? `Son ${fmtDist(dist)}'de ${elev - ref.e >= 0 ? '+' : '−'}${nf0.format(Math.abs(Math.round(elev - ref.e)))} m` : 'Konum alındı, rakım canlı izleniyor' });
  } finally { gpsBusy = false; }
});
