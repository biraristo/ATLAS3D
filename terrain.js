// ATLAS3D — arazi araçları: eğim haritası, eş yükselti eğrileri, yükseklik abartma,
// rotanın 3D önizlemesi, ölçüm profili ve GPS'e göre anlık çıkış/iniş göstergesi.
'use strict';

/* ================= Eğim haritası (DEM'den tarayıcıda hesaplanır, anahtarsız) ================= */
const SLOPE_BANDS = [[5, null], [10, [163, 230, 53]], [20, [250, 204, 21]], [35, [249, 115, 22]], [60, [220, 38, 38]], [Infinity, [126, 34, 206]]];
// "Doğal" görünüm: keskin bantlar yerine toprak tonlarında yumuşak geçiş; düz yer şeffaf, dik yamaç koyulaşır.
// Renkler arazinin kendi tonlarına yakın (kum → aşı boyası → kiremit → kül moru); gölgelendirme üstte kaldığı için kabartma okunur.
const SLOPE_DOGAL = [[6, [217, 200, 154], 0], [15, [217, 200, 154], 0.26], [30, [201, 162, 107], 0.38], [50, [168, 115, 90], 0.48], [80, [124, 90, 99], 0.56], [120, [93, 74, 90], 0.62]];
function slopeDogal(pct) {
  if (pct <= SLOPE_DOGAL[0][0]) return null;
  let k = 1; while (k < SLOPE_DOGAL.length - 1 && pct > SLOPE_DOGAL[k][0]) k++;
  const [p0, c0, a0] = SLOPE_DOGAL[k - 1], [p1, c1, a1] = SLOPE_DOGAL[k], t = Math.max(0, Math.min(1, (pct - p0) / (p1 - p0)));
  return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t, (a0 + (a1 - a0) * t) * 255];
}
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
  const parca = params.url.replace('slope://', '').split('/'), dogal = parca[0] === 'dogal';
  const [z, x, y] = parca.slice(-3).map(Number);
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
      if (dogal) { const c = slopeDogal(pct); if (c) { const o = (yy * 256 + xx) * 4; out.data[o] = c[0]; out.data[o + 1] = c[1]; out.data[o + 2] = c[2]; out.data[o + 3] = c[3]; } continue; }
      const band = SLOPE_BANDS.find(s => pct < s[0])[1];
      if (band) { const o = (yy * 256 + xx) * 4; out.data[o] = band[0]; out.data[o + 1] = band[1]; out.data[o + 2] = band[2]; out.data[o + 3] = pct >= 35 ? 175 : 140; }
    }
  }
  // PNG'ye kodlayıp yeniden çözmek yerine görüntü doğrudan verilir (karo başına ana iş parçacığında onlarca ms kazanç)
  return { data: typeof createImageBitmap === 'function' ? await createImageBitmap(out) : await encodePng(out) };
}
const slopeTiles = () => [`slope://${opts.slopeStil === 'belirgin' ? 'belirgin' : 'dogal'}/{z}/{x}/{y}`];
// Opaklık: doğalda renk saydamlığı karonun içinde, belirginde katmanla; koyu temada ikisi de hafifler
const slopeOpak = () => (opts.slopeStil === 'belirgin' ? 0.8 : 1) * (typeof isDark === 'function' && isDark() ? 0.62 : 1);
function ensureSlopeLayer() {
  if (map.getLayer('a3-slope')) return;
  map.addSource('a3-slope', { type: 'raster', tiles: slopeTiles(), tileSize: 256, minzoom: 9, maxzoom: 13 });
  // Gölgelendirmenin altına: kabartma gölgesi renklerin üstünde kalır, yamaçlar düz boya gibi değil arazi gibi görünür
  const before = map.getLayer('a3-hillshade') ? 'a3-hillshade' : map.getStyle().layers.find(l => l.type === 'line' && !OWN.has(l.id))?.id;
  map.addLayer({ id: 'a3-slope', type: 'raster', source: 'a3-slope', minzoom: 9, paint: { 'raster-opacity': slopeOpak(), 'raster-fade-duration': 150 } }, before);
  OWN.add('a3-slope');
}
function slopeStilCiz() {
  const dogal = opts.slopeStil !== 'belirgin';
  $('slope-stil').querySelectorAll('[data-s]').forEach(b => { const on = (b.dataset.s === 'dogal') === dogal; b.classList.toggle('on', on); b.setAttribute('aria-pressed', on); });
  $('slope-legend').innerHTML = dogal
    ? '<span><i style="background:#e6dabb"></i>%6–15</span><span><i style="background:#cfae80"></i>%15–30</span><span><i style="background:#b58468"></i>%30–50</span><span><i style="background:#8a6670"></i>%50–80</span><span><i style="background:#5d4a5a"></i>%80+</span>'
    : '<span><i style="background:#a3e635"></i>%5–10</span><span><i style="background:#facc15"></i>%10–20</span><span><i style="background:#f97316"></i>%20–35</span><span><i style="background:#dc2626"></i>%35–60</span><span><i style="background:#7e22ce"></i>%60+</span>';
}
function setSlopeStil(s) {
  opts.slopeStil = s; store.set('opts', opts); slopeStilCiz();
  if (!map?.getSource('a3-slope')) return;
  map.getSource('a3-slope').setTiles(slopeTiles());
  map.setPaintProperty('a3-slope', 'raster-opacity', slopeOpak());
}

/* ================= Eş yükselti eğrileri (maplibre-contour) ================= */
let contourReady = null;
function ensureContours() {
  if (contourReady) return contourReady;
  contourReady = loadScript('https://unpkg.com/maplibre-contour@0.1.1/dist/index.min.js').then(() => {
    const dem = new mlcontour.DemSource({ url: DEMSRC.url, encoding: 'terrarium', maxzoom: DEMSRC.maxzoom, worker: true });
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
    if (typeof applyMapTheme === 'function') applyMapTheme(); // koyu temada eğri ve etiket renkleri
  }).catch(e => { contourReady = null; toast('Eş yükselti eğrileri yüklenemedi'); throw e; });
  return contourReady;
}

/* ================= Arazi seçenekleri ================= */
// Eğim haritası ve eş yükselti eğrileri varsayılan olarak açıktır; kullanıcı tik ile kapatabilir, seçimi saklanır.
// (Eski sürümlerden kalan "kapalı" kayıtlar bir kez açığa çekilir.) Yükseklik abartma her açılışta 3× başlar.
if (!store.get('anaDefaultsV2', false)) { opts.slope = true; opts.contours = true; store.set('anaDefaultsV2', true); store.set('opts', opts); }
opts.slope ??= true; opts.contours ??= true; opts.exag = 3;
function applyTerrainOpts() {
  if (!map?.getLayer('a3-sat')) return;
  if (opts.slope) ensureSlopeLayer();
  if (map.getLayer('a3-slope')) map.setLayoutProperty('a3-slope', 'visibility', opts.slope ? 'visible' : 'none');
  if (opts.contours) ensureContours().then(() => { ['a3-contour-line', 'a3-contour-label'].forEach(id => map.setLayoutProperty(id, 'visibility', opts.contours ? 'visible' : 'none')); }).catch(() => {});
  else ['a3-contour-line', 'a3-contour-label'].forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', 'none'));
  if (opts.terrain) map.setTerrain({ source: 'dem', exaggeration: opts.exag });
  $('slope-legend').hidden = !opts.slope; $('slope-stil').hidden = !opts.slope;
}
opts.slopeStil ??= 'dogal';
$('opt-slope').checked = opts.slope; $('opt-contours').checked = opts.contours;
$('slope-stil').querySelectorAll('[data-s]').forEach(b => { b.onclick = () => setSlopeStil(b.dataset.s); });
slopeStilCiz();
$('opt-slope').onchange = e => { opts.slope = e.target.checked; store.set('opts', opts); applyTerrainOpts(); };
$('opt-contours').onchange = e => { opts.contours = e.target.checked; store.set('opts', opts); applyTerrainOpts(); };
$('opt-exag').value = opts.exag; $('exag-val').textContent = nf1.format(opts.exag) + '×';
$('opt-exag').oninput = e => {
  opts.exag = +e.target.value; $('exag-val').textContent = nf1.format(opts.exag) + '×';
  if (!opts.terrain) { opts.terrain = true; $('opt-terrain').checked = true; }
  map.setTerrain({ source: 'dem', exaggeration: opts.exag });
};
// 3D arazi anahtarı abartma değerini kullansın
$('opt-terrain').onchange = e => { opts.terrain = e.target.checked; store.set('opts', opts); map.setTerrain(opts.terrain ? { source: 'dem', exaggeration: opts.exag } : null); };
(function waitMap() { if (map?.getLayer?.('a3-sat')) applyTerrainOpts(); else setTimeout(waitMap, 300); })();

/* ================= Rotanın 3D önizlemesi =================
   Hız seçilebilir (¼×–8×); duraklatınca ya da haritaya dokununca kamera serbest kalır, etraf gezilir, "devam" ile rotaya dönülür.
   Kaydırıcıyla rotanın herhangi bir yerine atlanır. "Eserler" açıkken rotanın 1,2 km yakınındaki tarihî eserler haritada görünür,
   yaklaşanlar sağ/sol yönüyle alt şeritte listelenir; dokununca uçuş durur ve eser kartı açılır. */
const FLY_HIZ = [0.25, 0.5, 1, 2, 4, 8], FLY_YAKIN = 1200;
let flyRaf = null, fly = null;
function stopFlyover() {
  if (flyRaf) cancelAnimationFrame(flyRaf); flyRaf = null;
  $('fly-bar').hidden = true; $('fly-eser').hidden = true; body.classList.remove('flying', 'fly-durdu');
  flyArac(null); if (fly) map.setPadding({ top: 0, bottom: 0, left: 0, right: 0 });
  removeEventListener('keydown', flyKey);
  if (fly?.eser) flyEserGizle();
  fly = null;
}
const flyKey = e => {
  if (!fly || /INPUT|TEXTAREA/.test(document.activeElement?.tagName) && document.activeElement.type !== 'range') return;
  if (e.key === 'Escape') stopFlyover();
  else if (e.key === ' ') { e.preventDefault(); flyDurdur(!fly.durdu); }
  else if (e.key === '+' || e.key === '=') flyHizSec(Math.min(FLY_HIZ.length - 1, FLY_HIZ.indexOf(fly.hiz) + 1));
  else if (e.key === '-') flyHizSec(Math.max(0, FLY_HIZ.indexOf(fly.hiz) - 1));
};
function flyover(r) {
  if (!r) return; stopFlyover();
  if (!opts.terrain) { opts.terrain = true; $('opt-terrain').checked = true; map.setTerrain({ source: 'dem', exaggeration: opts.exag }); }
  const len = r.total, dur = Math.min(90000, Math.max(18000, 18000 + len / 1000 * 900)); // 1× hızda toplam süre
  const look = Math.min(2500, Math.max(150, len * 0.025)), zoom = Math.max(12.3, Math.min(16.2, 16.6 - Math.log2(look / 150)));
  const ptAt = d => { let lo = 0, hi = r.cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (r.cum[m] < d) lo = m + 1; else hi = m; } const j = Math.max(0, lo - 1);
    const s = r.cum[j + 1] - r.cum[j] || 1, t = Math.max(0, Math.min(1, (d - r.cum[j]) / s)), A = r.coords[j], B = r.coords[Math.min(j + 1, r.coords.length - 1)];
    return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]; };
  fly = { r, len, v: len / dur, hiz: store.get('flyHiz', 1), d: 0, durdu: false, donus: false, son: null, look, zoom, ptAt,
    bearing: bearingOf(ptAt(0), ptAt(look)), eser: store.get('flyEser', true), yakin: null, eserKey: '' };
  if (isMobile()) setSheet('min');
  body.classList.add('flying'); $('fly-bar').hidden = false;
  $('fly-hiz').innerHTML = FLY_HIZ.map((h, k) => `<button data-k="${k}">${h < 1 ? (h === 0.25 ? '¼' : '½') : h}×</button>`).join('');
  $('fly-hiz').querySelectorAll('[data-k]').forEach(b => { b.onclick = () => flyHizSec(+b.dataset.k); });
  flyHizSec(Math.max(0, FLY_HIZ.indexOf(fly.hiz)));
  flyEserDugme();
  map.jumpTo({ center: ptAt(0), zoom, pitch: 68, bearing: fly.bearing, padding: flyPad() });
  flyArac(ptAt(0), bearingOf(ptAt(0), ptAt(20)));
  if (fly.eser) flyEserHazirla();
  flyRaf = requestAnimationFrame(flyKare);
  addEventListener('keydown', flyKey);
}
function flyKare(ts) {
  const f = fly; if (!f) return;
  const dt = f.son == null ? 0 : Math.min(100, ts - f.son); f.son = ts;
  if (!f.durdu && !f.donus) {
    f.d = Math.min(f.len, f.d + dt * f.v * f.hiz);
    const c = f.ptAt(f.d), target = bearingOf(c, f.ptAt(Math.min(f.len, f.d + f.look)));
    const db = ((target - f.bearing + 540) % 360) - 180; f.bearing = (f.bearing + db * Math.min(1, 0.04 * dt / 16.7) + 360) % 360;
    map.jumpTo({ center: c, zoom: f.zoom, pitch: 68, bearing: f.bearing, padding: flyPad() });
    flyArac(c, bearingOf(c, f.ptAt(Math.min(f.len, f.d + 25))));
  }
  flyBilgi();
  if (f.d >= f.len && !f.durdu) { flyDurdur(true); $('fly-info').innerHTML = `<b>Rota sonu</b> · ${fmtDist(f.len)}`; }
  flyRaf = requestAnimationFrame(flyKare);
}
function flyBilgi() {
  const f = fly, p = f.r.profile ? profileAt(f.r.profile, f.d) : null;
  if (!f.durdu || f.d < f.len) $('fly-info').innerHTML = (f.durdu ? '<span class="fly-serbest">Duraklatıldı · etrafı gezebilirsin</span> · ' : '') + `<b>${fmtDist(f.d)}</b> / ${fmtDist(f.len)}` +
    (p && !f.durdu ? ` · ${nf0.format(Math.round(p.elev))} m · <span style="color:${slopeColor(p.slope)}">${fmtSlope(p.slope)} ${p.slope > 2 ? 'tırmanış' : p.slope < -2 ? 'iniş' : 'düz'}</span>` : '');
  const s = $('fly-seek'); if (document.activeElement !== s) s.value = Math.round(f.d / f.len * 1000);
  if (f.yakin) flyEserListe();
}
// Duraklat: kamera kullanıcıya kalır (döndür, eğ, yakınlaş). Devam: kamera rotadaki yerine uçar, oradan sürer.
function flyDurdur(durdur) {
  const f = fly; if (!f || f.durdu === durdur) return;
  f.durdu = durdur;
  body.classList.toggle('fly-durdu', durdur);
  const b = $('fly-play'); b.innerHTML = `<span class="ms fill">${durdur ? 'play_arrow' : 'pause'}</span>`; b.setAttribute('aria-label', durdur ? 'Devam et' : 'Duraklat');
  if (durdur) return;
  if (f.d >= f.len) f.d = 0;
  if (panelMode === 'place' && currentPlace?.eser != null) closePanel();
  if (typeof eserSecimGoster === 'function') eserSecimGoster(null);
  const c = f.ptAt(f.d); f.bearing = bearingOf(c, f.ptAt(Math.min(f.len, f.d + f.look)));
  f.donus = true;
  map.flyTo({ center: c, zoom: f.zoom, pitch: 68, bearing: f.bearing, padding: flyPad(), duration: 1000, essential: true });
  map.once('moveend', () => { if (fly === f) { f.donus = false; f.son = null; } });
}
function flyHizSec(k) {
  if (!fly) return; fly.hiz = FLY_HIZ[k]; store.set('flyHiz', fly.hiz);
  $('fly-hiz').querySelectorAll('[data-k]').forEach(b => b.classList.toggle('on', +b.dataset.k === k));
}
$('fly-play').onclick = () => flyDurdur(!fly?.durdu);
$('fly-stop').onclick = () => { stopFlyover(); fitRoute(); };
$('fly-seek').oninput = e => {
  const f = fly; if (!f) return;
  f.d = +e.target.value / 1000 * f.len; f.durdu = false; flyDurdur(true); // atlarken duraklar; kamera yeni yere gider
  const c = f.ptAt(f.d); f.bearing = bearingOf(c, f.ptAt(Math.min(f.len, f.d + f.look)));
  map.jumpTo({ center: c, zoom: f.zoom, pitch: 68, bearing: f.bearing, padding: flyPad() }); flyArac(c, bearingOf(c, f.ptAt(Math.min(f.len, f.d + 25))));
};
// Haritaya dokunmak ya da tekerlek: uçuş durur, kamera serbest. Eser mührüne dokunulduysa kart açılsın; boş yere ilk dokunuş yalnızca duraklatsın.
$('map').addEventListener('pointerdown', e => {
  if (!fly || fly.durdu) return;
  flyDurdur(true);
  const r = map.getCanvas().getBoundingClientRect(), x = e.clientX - r.left, y = e.clientY - r.top;
  const eserVar = map.getLayer('eser-nokta') && map.queryRenderedFeatures([[x - 10, y - 10], [x + 10, y + 10]], { layers: ['eser-nokta'] }).length;
  if (!eserVar) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 450); }
});
$('map').addEventListener('wheel', () => { if (fly && !fly.durdu) flyDurdur(true); }, { passive: true });

/* ----- Araç: rotada giden araba (harita katmanı olarak çizilir: araziye oturur, yönü yola göre döner) -----
   HTML işaret arazi yüksekliğini bilmediği için abartılı arazide yoldan kopuk görünüyordu. Sembol katmanı yolun üstünde, yolla birlikte eğik durur. */
// Kamera aracın biraz arkasından bakar: araç ekranın alt üçte birinde, önündeki yol görünür
const flyPad = () => ({ top: Math.round(innerHeight * 0.38), bottom: 0, left: 0, right: 0 });
function flyAracGorsel() {
  const W = 44, H = 84, PR = 3, c = document.createElement('canvas'); c.width = W * PR; c.height = H * PR;
  const g = c.getContext('2d'); g.scale(PR, PR);
  const yuvarlak = (x, y, w, h, r) => { g.beginPath(); g.roundRect(x, y, w, h, r); };
  g.shadowColor = 'rgba(0,0,0,.45)'; g.shadowBlur = 5; g.shadowOffsetY = 2;
  yuvarlak(7, 5, 30, 74, 11); g.fillStyle = '#ffffff'; g.fill();               // beyaz kenar: uyduda da seçilir
  g.shadowColor = 'transparent';
  yuvarlak(9, 7, 26, 70, 9); g.fillStyle = '#1a73e8'; g.fill();               // gövde (araç yukarıyı, yani gidiş yönünü gösterir)
  const gr = g.createLinearGradient(9, 0, 35, 0); gr.addColorStop(0, 'rgba(255,255,255,0)'); gr.addColorStop(.5, 'rgba(255,255,255,.22)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
  yuvarlak(9, 7, 26, 70, 9); g.fillStyle = gr; g.fill();                       // tavan parlaklığı
  g.fillStyle = '#0b2a52';
  g.beginPath(); g.moveTo(12, 27); g.quadraticCurveTo(22, 20, 32, 27); g.lineTo(30, 35); g.quadraticCurveTo(22, 32, 14, 35); g.closePath(); g.fill(); // ön cam
  g.beginPath(); g.moveTo(13, 60); g.quadraticCurveTo(22, 63, 31, 60); g.lineTo(32, 66); g.quadraticCurveTo(22, 70, 12, 66); g.closePath(); g.fill(); // arka cam
  g.fillRect(10.5, 37, 2.2, 19); g.fillRect(31.3, 37, 2.2, 19);               // yan camlar
  g.fillStyle = '#fff7c2'; yuvarlak(11, 8.5, 6, 3.2, 1.5); g.fill(); yuvarlak(27, 8.5, 6, 3.2, 1.5); g.fill();   // farlar
  g.fillStyle = '#e53935'; yuvarlak(11, 73.5, 6, 2.4, 1); g.fill(); yuvarlak(27, 73.5, 6, 2.4, 1); g.fill();     // stoplar
  return { img: g.getImageData(0, 0, W * PR, H * PR), PR };
}
function flyArac(ll, yon = 0) {
  if (!map) return;
  if (!ll) { map.getSource('fly-arac')?.setData({ type: 'FeatureCollection', features: [] }); return; }
  const veri = { type: 'Feature', properties: { yon }, geometry: { type: 'Point', coordinates: ll } };
  if (map.getSource('fly-arac')) { map.getSource('fly-arac').setData(veri); return; }
  if (!map.hasImage('fly-arac')) { const { img, PR } = flyAracGorsel(); map.addImage('fly-arac', { width: img.width, height: img.height, data: img.data }, { pixelRatio: PR }); }
  map.addSource('fly-arac', { type: 'geojson', data: veri });
  map.addLayer({ id: 'fly-arac', type: 'symbol', source: 'fly-arac', layout: {
    'icon-image': 'fly-arac', 'icon-rotate': ['get', 'yon'], 'icon-rotation-alignment': 'map', 'icon-pitch-alignment': 'map',
    'icon-size': ['interpolate', ['linear'], ['zoom'], 10, 1.1, 13, 1.45, 16, 1.7], 'icon-allow-overlap': true, 'icon-ignore-placement': true } });
  OWN.add('fly-arac');
}

/* ----- Uçuşta tarihî eserler ----- */
function flyEserDugme() { const b = $('fly-eser-btn'); b.classList.toggle('on', !!fly?.eser); b.setAttribute('aria-pressed', !!fly?.eser); }
$('fly-eser-btn').onclick = () => {
  if (!fly) return; fly.eser = !fly.eser; store.set('flyEser', fly.eser); flyEserDugme();
  if (fly.eser) flyEserHazirla(); else { flyEserGizle(); fly.yakin = null; $('fly-eser').hidden = true; }
};
async function flyEserHazirla() {
  const f = fly;
  try { await eserYukle(); } catch { toast('Tarihî eserler yüklenemedi'); return; }
  if (fly !== f || !f.eser) return;
  await eserRotaKatman();
  f.yakin ??= rotaEserBul(f.ptAt, f.len);
  flyEserListe();
}
// Rota boyunca eser mühürleri (uçuşta ve navigasyonda): parşömen tülü olmadan, harita etiketleri yerinde kalır
async function eserRotaKatman() {
  if (!map.getSource('eser-secim-src')) map.addSource('eser-secim-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  await eserKatmanlar();
  eser.ucus = true; eserGorunur(true);
  if (!eser.on) map.setLayoutProperty('eser-tul', 'visibility', 'none'); // uydu/arazi görüntüsü soldurulmasın
}
function flyEserGizle() {
  eser.ucus = false;
  if (!eser.on && typeof eserGorunur === 'function') { eserGorunur(false); eserSecimGoster(null); }
}
// Rotayı 150 m'de bir örnekle, örnekleri ~2 km'lik ızgaraya koy; her eseri komşu hücrelerdeki örneklerle karşılaştır
function rotaEserBul(ptAt, len) {
  const ADIM = 150, H = 0.02, ornek = [], izgara = new Map();
  for (let d = 0; d <= len; d += ADIM) {
    const p = ptAt(d), k = Math.floor(p[0] / H) + ':' + Math.floor(p[1] / H);
    (izgara.get(k) || izgara.set(k, []).get(k)).push(ornek.length); ornek.push({ p, d });
  }
  const out = [], E = eser.data.eser;
  for (let i = 0; i < E.length; i++) {
    const lon = E[i][2], lat = E[i][3], gx = Math.floor(lon / H), gy = Math.floor(lat / H), kx = Math.cos(lat * Math.PI / 180) * 111320;
    let en = Infinity, s = -1;
    for (let a = -1; a <= 1; a++) for (let b = -1; b <= 1; b++) for (const j of izgara.get((gx + a) + ':' + (gy + b)) || []) {
      const q = ornek[j].p, dd = Math.hypot((lon - q[0]) * kx, (lat - q[1]) * 110540); if (dd < en) { en = dd; s = j; }
    }
    if (en > FLY_YAKIN) continue;
    const A = ornek[s].p, B = ornek[Math.min(ornek.length - 1, s + 1)].p, C = ornek[Math.max(0, s - 1)].p;
    const yx = (B[0] - C[0]), yy = (B[1] - C[1]), ex = lon - A[0], ey = lat - A[1];
    out.push({ i, d: ornek[s].d, m: en, sol: yx * ey - yy * ex > 0 });
  }
  return out.sort((a, b) => a.d - b.d);
}
// Alt şerit: önümüzdeki 4 km'deki (ve az önce geçilen) en yakın 4 eser. L: rotaEserBul listesi, d: rotada gelinen yer (m)
function eserSerit(L, d, st, tikla) {
  let lo = 0, hi = L.length; while (lo < hi) { const m = (lo + hi) >> 1; if (L[m].d < d - 300) lo = m + 1; else hi = m; }
  const sec = []; for (let k = lo; k < L.length && L[k].d < d + 4000 && sec.length < 4; k++) sec.push(L[k]);
  const key = sec.map(x => x.i).join(','), el = $('fly-eser');
  if (key === st.eserKey) {
    el.querySelectorAll('[data-i]').forEach(b => { const x = sec.find(s => s.i === +b.dataset.i); if (x) b.querySelector('em').textContent = eserUzak(x, d); });
    return;
  }
  st.eserKey = key; el.hidden = !sec.length;
  el.innerHTML = sec.map(x => { const e = eser.data.eser[x.i], a = ESER_AILE[e[13]];
    return `<button data-i="${x.i}" style="--c:${a.renk}"><span class="ms">${x.sol ? 'west' : 'east'}</span><span class="fe-ad">${esc(e[1])}</span><em>${eserUzak(x, d)}</em></button>`; }).join('');
  el.querySelectorAll('[data-i]').forEach(b => { b.onclick = () => tikla(+b.dataset.i); });
}
const eserUzak = (x, d) => { const ileri = x.d - d; return `${x.sol ? 'Solda' : 'Sağda'} · ${ileri > 50 ? fmtDist(ileri) + ' sonra' : 'şimdi'} · yoldan ${fmtDist(x.m)}`; };
function flyEserListe() { const f = fly; if (f?.yakin) eserSerit(f.yakin, f.d, f, i => { flyDurdur(true); eserGoster(i); }); }

/* ----- Navigasyonda tarihî eserler -----
   Rotanın 1,2 km yakınındaki eserler haritada görünür; önümüzdeki 4 km'dekiler yönüyle alt şeritte.
   Dokununca kart açılır (kamera takibi bırakılır; "ortala" ile karta kapanıp sürüşe dönülür). Katmanlar menüsünden kapatılabilir. */
const navEser = { on: store.get('navEser', true), L: null, r: null, eserKey: '', hazir: false };
const rotaPtAt = r => d => { let lo = 0, hi = r.cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (r.cum[m] < d) lo = m + 1; else hi = m; } const j = Math.max(0, lo - 1);
  const s = r.cum[j + 1] - r.cum[j] || 1, t = Math.max(0, Math.min(1, (d - r.cum[j]) / s)), A = r.coords[j], B = r.coords[Math.min(j + 1, r.coords.length - 1)];
  return [A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]; };
async function navEserHazirla() {
  if (!navEser.on || !navActive || navEser.hazir) return;
  navEser.hazir = true;
  try { await eserYukle(); await eserRotaKatman(); }
  catch { navEser.hazir = false; return; }
  if (!navActive || !navEser.on) { navEserKapat(); return; }
  navEser.r = navRoute; navEser.L = rotaEserBul(rotaPtAt(navRoute), navRoute.total); navEser.eserKey = '';
  navEser.hazir = false;
}
function navEserTick(along) {
  if (!navEser.on) return;
  if (!body.classList.contains('panel-open')) body.classList.remove('nav-kart');
  if (navEser.r !== navRoute) { navEser.L = null; navEserHazirla(); return; } // yeni ya da yeniden hesaplanan rota
  if (navEser.L) eserSerit(navEser.L, along, navEser, i => { navFollow = false; body.classList.add('nav-kart'); eserGoster(i); });
}
function navEserKapat() {
  $('fly-eser').hidden = true; navEser.eserKey = ''; navEser.r = null; navEser.L = null; navEser.hazir = false;
  body.classList.remove('nav-kart'); flyEserGizle();
}
$('opt-roteser').checked = navEser.on;
$('opt-roteser').onchange = e => {
  navEser.on = e.target.checked; store.set('navEser', navEser.on);
  if (!navActive) return;
  if (navEser.on) navEserHazirla(); else navEserKapat();
};

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
