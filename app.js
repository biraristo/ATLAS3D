// ATLAS3D Haritalar — Google Haritalar tarzı, anahtarsız 3D harita uygulaması
// Altyapı: MapLibre GL JS · OpenFreeMap vektör karoları (3D binalar) · AWS Terrain Tiles (3D arazi)
// Esri World Imagery (uydu) · Photon + Nominatim (arama) · OSRM / routing.openstreetmap.de (yol tarifi)
'use strict';

/* ================= Yardımcılar ================= */
const $ = id => document.getElementById(id);
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const isMobile = () => matchMedia('(max-width:720px)').matches;
const store = {
  get(k, d) { try { const v = localStorage.getItem('a3_' + k); return v ? JSON.parse(v) : d; } catch { return d; } },
  set(k, v) { try { localStorage.setItem('a3_' + k, JSON.stringify(v)); } catch {} }
};
function toast(msg, ms = 3000) {
  const t = $('toast'); t.textContent = msg; t.hidden = false;
  clearTimeout(toast._t); toast._t = setTimeout(() => { t.hidden = true; }, ms);
}
function debounce(fn, ms) { let t; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; }
function haversine(a, b) {
  const R = 6371008.8, r = Math.PI / 180;
  const dLat = (b[1] - a[1]) * r, dLon = (b[0] - a[0]) * r;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[1] * r) * Math.cos(b[1] * r) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}
function bearingOf(a, b) {
  const r = Math.PI / 180, y = Math.sin((b[0] - a[0]) * r) * Math.cos(b[1] * r);
  const x = Math.cos(a[1] * r) * Math.sin(b[1] * r) - Math.sin(a[1] * r) * Math.cos(b[1] * r) * Math.cos((b[0] - a[0]) * r);
  return (Math.atan2(y, x) / r + 360) % 360;
}
const nf1 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 1 });
const nf0 = new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 });
function fmtDist(m) {
  if (m < 50) return nf0.format(Math.round(m / 5) * 5) + ' m';
  if (m < 1000) return nf0.format(Math.round(m / 10) * 10) + ' m';
  return (m < 10000 ? nf1 : nf0).format(m / 1000) + ' km';
}
function fmtDur(s) {
  const m = Math.max(1, Math.round(s / 60));
  if (m < 60) return m + ' dk';
  const h = Math.floor(m / 60), r = m % 60;
  if (h >= 24) return Math.floor(h / 24) + ' gün ' + (h % 24) + ' sa';
  return h + ' sa' + (r ? ' ' + r + ' dk' : '');
}
const fmtClock = d => d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
async function api(path, params, signal) {
  const res = await fetch(path + '?' + new URLSearchParams(params), { signal });
  if (!res.ok) throw new Error('Sunucu hatası (' + res.status + ')');
  return res.json();
}

/* ================= Kategoriler ================= */
const CAT = {
  restaurant: ['Restoran', 'restaurant'], fast_food: ['Fast food', 'fastfood'], food_court: ['Yemek alanı', 'restaurant'],
  cafe: ['Kafe', 'local_cafe'], bar: ['Bar', 'local_bar'], pub: ['Bar', 'local_bar'], ice_cream: ['Dondurmacı', 'icecream'],
  hotel: ['Otel', 'hotel'], motel: ['Motel', 'hotel'], hostel: ['Hostel', 'hotel'], guest_house: ['Pansiyon', 'hotel'], apartment: ['Apart', 'hotel'],
  fuel: ['Benzin istasyonu', 'local_gas_station'], charging_station: ['Şarj istasyonu', 'ev_station'],
  supermarket: ['Süpermarket', 'local_grocery_store'], convenience: ['Market', 'local_grocery_store'], bakery: ['Fırın', 'bakery_dining'],
  butcher: ['Kasap', 'local_grocery_store'], greengrocer: ['Manav', 'local_grocery_store'], mall: ['AVM', 'local_mall'], department_store: ['Mağaza', 'local_mall'],
  clothes: ['Giyim', 'checkroom'], shoes: ['Ayakkabı', 'checkroom'], electronics: ['Elektronik', 'devices'], mobile_phone: ['Telefoncu', 'devices'],
  hairdresser: ['Kuaför', 'content_cut'], car_repair: ['Oto servis', 'car_repair'], car: ['Oto galeri', 'directions_car'],
  pharmacy: ['Eczane', 'local_pharmacy'], hospital: ['Hastane', 'local_hospital'], clinic: ['Klinik', 'local_hospital'], doctors: ['Doktor', 'local_hospital'], dentist: ['Diş hekimi', 'dentistry'],
  atm: ['ATM', 'local_atm'], bank: ['Banka', 'account_balance'], parking: ['Otopark', 'local_parking'],
  place_of_worship: ['İbadethane', 'mosque'], mosque: ['Cami', 'mosque'],
  school: ['Okul', 'school'], university: ['Üniversite', 'school'], college: ['Yüksekokul', 'school'], kindergarten: ['Anaokulu', 'school'],
  police: ['Polis', 'local_police'], fire_station: ['İtfaiye', 'local_fire_department'], post_office: ['PTT', 'local_post_office'],
  townhall: ['Belediye', 'account_balance'], courthouse: ['Adliye', 'account_balance'],
  museum: ['Müze', 'museum'], attraction: ['Turistik yer', 'attractions'], viewpoint: ['Seyir noktası', 'landscape'], monument: ['Anıt', 'attractions'],
  memorial: ['Anıt', 'attractions'], castle: ['Kale', 'castle'], ruins: ['Ören yeri', 'attractions'], artwork: ['Sanat eseri', 'attractions'],
  park: ['Park', 'park'], garden: ['Bahçe', 'park'], playground: ['Oyun alanı', 'park'], nature_reserve: ['Doğa koruma alanı', 'park'], forest: ['Orman', 'park'], wood: ['Orman', 'park'],
  stadium: ['Stadyum', 'stadium'], sports_centre: ['Spor merkezi', 'fitness_center'], fitness_centre: ['Spor salonu', 'fitness_center'], pitch: ['Saha', 'stadium'], swimming_pool: ['Yüzme havuzu', 'pool'],
  cinema: ['Sinema', 'movie'], theatre: ['Tiyatro', 'theater_comedy'], library: ['Kütüphane', 'local_library'],
  bus_station: ['Otogar', 'directions_bus'], bus_stop: ['Otobüs durağı', 'directions_bus'], station: ['İstasyon', 'train'], halt: ['İstasyon', 'train'],
  subway: ['Metro', 'subway'], tram_stop: ['Tramvay durağı', 'tram'], ferry_terminal: ['İskele', 'directions_boat'], aerodrome: ['Havalimanı', 'flight'], airport: ['Havalimanı', 'flight'],
  city: ['Şehir', 'location_city'], town: ['İlçe', 'location_city'], village: ['Köy', 'location_on'], hamlet: ['Mezra', 'location_on'],
  suburb: ['Mahalle', 'location_on'], neighbourhood: ['Mahalle', 'location_on'], quarter: ['Mahalle', 'location_on'], province: ['İl', 'location_city'], state: ['İl', 'location_city'],
  administrative: ['İdari bölge', 'location_city'], country: ['Ülke', 'public'],
  lake: ['Göl', 'water'], water: ['Su', 'water'], river: ['Nehir', 'water'], reservoir: ['Baraj gölü', 'water'], bay: ['Koy', 'water'], beach: ['Plaj', 'beach_access'],
  peak: ['Zirve', 'landscape'], volcano: ['Volkan', 'landscape'], valley: ['Vadi', 'landscape'], island: ['Ada', 'landscape'],
  motorway: ['Otoyol', 'add_road'], trunk: ['Yol', 'add_road'], primary: ['Ana yol', 'add_road'], secondary: ['Yol', 'add_road'], tertiary: ['Yol', 'add_road'],
  residential: ['Sokak', 'add_road'], unclassified: ['Yol', 'add_road'], service: ['Yol', 'add_road'], living_street: ['Sokak', 'add_road'], pedestrian: ['Yaya yolu', 'directions_walk'],
  house: ['Adres', 'home'], building: ['Bina', 'apartment'], yes: ['Bina', 'apartment']
};
function catOf(value, tags = {}) {
  if (value === 'place_of_worship' && /muslim/.test(tags.religion || '')) value = 'mosque';
  const c = CAT[value];
  return c ? { label: c[0], icon: c[1] } : { label: '', icon: 'location_on' };
}

const NEARBY = [
  { id: 'restaurant', label: 'Restoranlar', icon: 'restaurant', q: 'restaurant' },
  { id: 'hotel', label: 'Oteller', icon: 'hotel', q: 'hotel' },
  { id: 'cafe', label: 'Kafeler', icon: 'local_cafe', q: 'cafe' },
  { id: 'fuel', label: 'Benzin', icon: 'local_gas_station', q: 'fuel' },
  { id: 'market', label: 'Marketler', icon: 'local_grocery_store', q: 'supermarket' },
  { id: 'pharmacy', label: 'Eczaneler', icon: 'local_pharmacy', q: 'pharmacy' },
  { id: 'hospital', label: 'Hastaneler', icon: 'local_hospital', q: 'hospital' },
  { id: 'atm', label: 'ATM', icon: 'local_atm', q: 'atm' },
  { id: 'parking', label: 'Otopark', icon: 'local_parking', q: 'parking' },
  { id: 'mosque', label: 'Camiler', icon: 'mosque', q: 'mosque' },
  { id: 'attraction', label: 'Gezilecek yerler', icon: 'attractions', q: 'tourist attraction' }
];

/* ================= Harita ================= */
const TR_VIEW = { center: [35.2, 39.0], zoom: 5.2, pitch: 0, bearing: 0 };
const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const TERRARIUM = ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'];
const EXAG = 1.2;
const OWN = new Set(); // bizim eklediğimiz katmanlar
let styleLayerIds = [], baseVisibility = {};
let basemap = store.get('basemap', 'default');
const opts = store.get('opts', { terrain: true, buildings: true, labels: true });
let cfg = {};
const cfgReady = fetch('/api/config', { cache: 'no-store' }).then(r => r.ok ? r.json() : {}).catch(() => ({})).then(d => (cfg = d || {}));

async function buildStyle() {
  let style;
  try { style = await (await fetch('https://tiles.openfreemap.org/styles/liberty')).json(); }
  catch { style = { version: 8, sources: {}, layers: [{ id: 'background', type: 'background', paint: { 'background-color': '#f2efe9' } }] }; }
  styleLayerIds = style.layers.map(l => l.id);
  for (const l of style.layers) baseVisibility[l.id] = l.layout?.visibility || 'visible';
  const NAME = ['coalesce', ['get', 'name:tr'], ['get', 'name:latin'], ['get', 'name']];
  for (const l of style.layers) {
    const tf = l.layout?.['text-field'];
    if (tf && JSON.stringify(tf).includes('name:latin')) l.layout['text-field'] = NAME;
    if (l.id === 'water' && l.paint) l.paint['fill-color'] = '#aadaff';
    if (l.id === 'building-3d' && l.paint) { l.paint['fill-extrusion-color'] = '#e2e0dc'; l.paint['fill-extrusion-opacity'] = 0.85; }
  }
  Object.assign(style.sources, {
    dem: { type: 'raster-dem', encoding: 'terrarium', tiles: TERRARIUM, tileSize: 256, maxzoom: 13 },
    hsdem: { type: 'raster-dem', encoding: 'terrarium', tiles: TERRARIUM, tileSize: 256, maxzoom: 12 },
    sat: { type: 'raster', tiles: [`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 19, attribution: 'Uydu © Esri, Maxar, Earthstar Geographics' },
    satroads: { type: 'raster', tiles: [`${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`], tileSize: 256, maxzoom: 19 }
  });
  const firstLine = style.layers.find(l => l.type === 'line')?.id;
  const firstSymbol = style.layers.find(l => l.type === 'symbol')?.id;
  const insert = (layer, before) => { const i = style.layers.findIndex(l => l.id === before); style.layers.splice(i < 0 ? style.layers.length : i, 0, layer); OWN.add(layer.id); };
  insert({ id: 'a3-hillshade', type: 'hillshade', source: 'hsdem', paint: { 'hillshade-exaggeration': 0.25, 'hillshade-shadow-color': '#5a5040', 'hillshade-highlight-color': '#ffffff', 'hillshade-accent-color': '#5a5040' } }, firstLine);
  insert({ id: 'a3-sat', type: 'raster', source: 'sat', layout: { visibility: 'none' } }, firstSymbol);
  insert({ id: 'a3-satroads', type: 'raster', source: 'satroads', layout: { visibility: 'none' }, paint: { 'raster-opacity': 0.85 } }, firstSymbol);
  if (opts.terrain) style.terrain = { source: 'dem', exaggeration: EXAG }; else delete style.terrain;
  style.sky = { 'sky-color': '#9ccbf5', 'horizon-color': '#e7f1fb', 'fog-color': '#f2f5f8', 'sky-horizon-blend': 0.5, 'horizon-fog-blend': 0.6, 'fog-ground-blend': 0.85, 'atmosphere-blend': ['interpolate', ['linear'], ['zoom'], 0, 1, 10, 1, 12, 0] };
  return style;
}

function initialView() {
  if (/^#[\d.]+\/-?[\d.]+\/-?[\d.]+/.test(location.hash)) return null; // URL'deki görünüm kullanılır
  return store.get('view', null);
}

let map, userMoved = false;
const savedView = initialView();
buildStyle().then(style => {
  map = new maplibregl.Map({
    container: 'map', style, hash: true, ...(savedView || TR_VIEW),
    maxPitch: 80, pixelRatio: Math.min(devicePixelRatio || 1, 2), fadeDuration: 120,
    attributionControl: { compact: true }, cancelPendingTileRequestsWhileZooming: true
  });
  map.addControl(new maplibregl.ScaleControl({ unit: 'metric', maxWidth: 90 }), 'bottom-right');
  map.on('load', onMapLoad);
  map.on('error', e => console.warn('Harita:', e.error?.message || e));
  wireMap();
  // İlk açılışta ziyaretçinin yaklaşık konumuna aç (URL'de veya kayıtlı görünüm yoksa)
  if (!savedView && !location.hash && !/[?&](p|to|action)=/.test(location.search)) {
    cfgReady.then(c => { if (c.ip && !userMoved) map.jumpTo({ center: [c.ip.lon, c.ip.lat], zoom: 11.5, pitch: 45 }); });
  }
});

function onMapLoad() {
  // Üst üste binen kamera animasyonları arazi yüksekliğini dondurabiliyor (MapLibre); hareket bitince çöz
  const unfreeze = () => { if (map.terrain && map._elevationFreeze && !map.isMoving()) { map._elevationFreeze = false; map.once('render', refreshMarkers); map.triggerRepaint(); } };
  map.on('moveend', unfreeze); map.on('idle', unfreeze);
  // Telif bilgisi mobilde kapalı (i) düğmesiyle başlasın
  map.getContainer().querySelector('.maplibregl-ctrl-attrib')?.classList.remove('maplibregl-compact-show');
  applyBasemap();
  addOwnSourcesAndLayers();
  handleUrlParams();
  updateTilt(); updateCompass();
  cfgReady.then(c => { if (c.googleTilesKey) addGoogleBasemap(); });
  map.on('moveend', debounce(() => {
    if (navActive) return;
    const c = map.getCenter();
    store.set('view', { center: [+c.lng.toFixed(5), +c.lat.toFixed(5)], zoom: +map.getZoom().toFixed(2), pitch: Math.round(map.getPitch()), bearing: Math.round(map.getBearing()) });
  }, 500));
}

/* ----- Altlık / katmanlar ----- */
const BASEMAPS = {
  default: { label: 'Varsayılan', thumb: `${ESRI}/World_Street_Map/MapServer/tile/12/1535/2393` },
  satellite: { label: 'Uydu', thumb: `${ESRI}/World_Imagery/MapServer/tile/12/1535/2393` },
  terrain: { label: 'Arazi', thumb: 'https://a.tile.opentopomap.org/12/2393/1535.png' }
};
function applyBasemap() {
  if (!map?.getLayer('a3-sat')) return;
  const sat = basemap === 'satellite';
  for (const id of styleLayerIds) {
    const l = map.getLayer(id); if (!l) continue;
    let vis = baseVisibility[id];
    if (l.type === 'symbol') vis = opts.labels ? vis : 'none';
    else if (l.type === 'background') vis = 'visible';
    else if (sat) vis = 'none';
    if (id === 'building-3d') vis = !sat && opts.buildings ? 'visible' : 'none';
    if (id === 'building') vis = !sat ? 'visible' : 'none';
    map.setLayoutProperty(id, 'visibility', vis);
  }
  map.setLayoutProperty('a3-sat', 'visibility', sat ? 'visible' : 'none');
  map.setLayoutProperty('a3-satroads', 'visibility', sat && opts.labels ? 'visible' : 'none');
  map.setLayoutProperty('a3-hillshade', 'visibility', sat ? 'none' : 'visible');
  map.setPaintProperty('a3-hillshade', 'hillshade-exaggeration', basemap === 'terrain' ? 0.75 : 0.22);
  // Katman düğmesinde "diğer" seçenek görünür (Google gibi)
  const other = sat ? 'default' : 'satellite';
  $('layers-thumb').style.backgroundImage = `url(${BASEMAPS[other].thumb})`;
  $('layers-btn').dataset.other = other;
  document.querySelectorAll('.bm').forEach(b => b.classList.toggle('on', b.dataset.id === basemap));
}
function setBasemap(id) {
  if (id === 'google') { openGoogle3D(); return; }
  basemap = id; store.set('basemap', id); applyBasemap();
}
function renderLayerPop() {
  const row = $('basemaps'); row.innerHTML = '';
  for (const [id, b] of Object.entries(BASEMAPS)) {
    const btn = document.createElement('button'); btn.className = 'bm'; btn.dataset.id = id;
    btn.innerHTML = `<span class="t" style="background-image:url(${b.thumb})"></span>${b.label}`;
    btn.onclick = () => setBasemap(id);
    row.appendChild(btn);
  }
  $('opt-terrain').checked = opts.terrain; $('opt-buildings').checked = opts.buildings; $('opt-labels').checked = opts.labels;
}
renderLayerPop();
$('layers-btn').onclick = e => {
  e.stopPropagation();
  if (isMobile()) { $('layers-pop').hidden = !$('layers-pop').hidden; return; }
  setBasemap($('layers-btn').dataset.other || 'satellite'); // masaüstünde Google gibi tek tıkla uydu/harita
};
$('layers').addEventListener('mouseenter', () => { if (!isMobile()) $('layers-pop').hidden = false; });
$('layers').addEventListener('mouseleave', () => { if (!isMobile()) $('layers-pop').hidden = true; });
document.addEventListener('click', e => { if (!$('layers').contains(e.target)) $('layers-pop').hidden = true; });
$('opt-terrain').onchange = e => {
  opts.terrain = e.target.checked; store.set('opts', opts);
  map.setTerrain(opts.terrain ? { source: 'dem', exaggeration: EXAG } : null);
};
$('opt-buildings').onchange = e => { opts.buildings = e.target.checked; store.set('opts', opts); applyBasemap(); };
$('opt-labels').onchange = e => { opts.labels = e.target.checked; store.set('opts', opts); applyBasemap(); };

/* ================= Yükseklik verisi (Terrarium DEM, anahtarsız) ================= */
const DEM = (() => {
  const cache = new Map(); // "z/x/y" -> Promise<ImageData|null>
  function tile(z, x, y) {
    const key = `${z}/${x}/${y}`;
    if (!cache.has(key)) cache.set(key, new Promise(ok => {
      const i = new Image(); i.crossOrigin = 'anonymous';
      i.onload = () => { const c = document.createElement('canvas'); c.width = c.height = 256; const g = c.getContext('2d', { willReadFrequently: true }); g.drawImage(i, 0, 0); ok(g.getImageData(0, 0, 256, 256)); };
      i.onerror = () => ok(null);
      i.src = TERRARIUM[0].replace('{z}', z).replace('{x}', x).replace('{y}', y);
    }));
    return cache.get(key);
  }
  function proj(lon, lat, z) {
    const n = 2 ** z, s = Math.sin(lat * Math.PI / 180);
    return [(lon + 180) / 360 * n, (0.5 - Math.log((1 + s) / (1 - s)) / (4 * Math.PI)) * n];
  }
  async function at(lon, lat, z = 13) {
    const [xf, yf] = proj(lon, lat, z), x = Math.floor(xf), y = Math.floor(yf);
    const d = await tile(z, x, y); if (!d) return null;
    // Çift doğrusal enterpolasyon
    const px = (xf - x) * 256 - 0.5, py = (yf - y) * 256 - 0.5;
    const x0 = Math.max(0, Math.min(255, Math.floor(px))), y0 = Math.max(0, Math.min(255, Math.floor(py)));
    const x1 = Math.min(255, x0 + 1), y1 = Math.min(255, y0 + 1), fx = Math.max(0, Math.min(1, px - x0)), fy = Math.max(0, Math.min(1, py - y0));
    const v = (xx, yy) => { const o = (yy * 256 + xx) * 4; return d.data[o] * 256 + d.data[o + 1] + d.data[o + 2] / 256 - 32768; };
    return (v(x0, y0) * (1 - fx) + v(x1, y0) * fx) * (1 - fy) + (v(x0, y1) * (1 - fx) + v(x1, y1) * fx) * fy;
  }
  async function many(pts, z) { return Promise.all(pts.map(p => at(p[0], p[1], z))); }
  // Arazi eğimi (%) ve bakı: ~30 m aralıklı dört komşu örnek
  async function slopeAt(lon, lat, z = 13) {
    const dLat = 30 / 111320, dLon = 30 / (111320 * Math.cos(lat * Math.PI / 180));
    const [c, e, w, n, s] = await many([[lon, lat], [lon + dLon, lat], [lon - dLon, lat], [lon, lat + dLat], [lon, lat - dLat]], z);
    if ([c, e, w, n, s].some(v => v == null)) return { elev: c, slope: null };
    const gx = (e - w) / 60, gy = (n - s) / 60;
    const slope = Math.hypot(gx, gy) * 100, aspect = (Math.atan2(gx, gy) * 180 / Math.PI + 360) % 360; // yokuş yukarı yönü
    return { elev: c, slope, aspect };
  }
  return { at, many, slopeAt, tile };
})();
const elevationAt = (lon, lat) => DEM.at(lon, lat, 13).then(h => { if (h == null) throw new Error('DEM'); return h; });
const SLOPE_COLORS = [[-15, '#1e40af'], [-8, '#2563eb'], [-3, '#60a5fa'], [-1, '#22c55e'], [1, '#22c55e'], [3, '#a3e635'], [6, '#facc15'], [10, '#f97316'], [15, '#dc2626']];
function slopeColor(s) {
  if (!Number.isFinite(s)) return '#4285f4';
  const C = SLOPE_COLORS; if (s <= C[0][0]) return C[0][1]; if (s >= C[C.length - 1][0]) return C[C.length - 1][1];
  for (let i = 1; i < C.length; i++) if (s <= C[i][0]) {
    const t = (s - C[i - 1][0]) / (C[i][0] - C[i - 1][0]); const h = c => [1, 3, 5].map(k => parseInt(c.slice(k, k + 2), 16));
    const A = h(C[i - 1][1]), B = h(C[i][1]); return 'rgb(' + A.map((v, k) => Math.round(v + (B[k] - v) * t)).join(',') + ')';
  }
}
// Türkçe yüzde yazımı: işaret + % + sayı (ör. +%8, −%5, %0)
const fmtSlope = s => { const v = Math.round(s); return (v > 0 ? '+' : v < 0 ? '−' : '') + '%' + nf0.format(Math.abs(v)); };
const fmtInt = v => { const r = Math.round(v) || 0; return (r < 0 ? '−' : '') + nf0.format(Math.abs(r)); };
const fmtPct1 = s => { const v = Math.round(s * 10) / 10; return (v > 0 ? '+' : v < 0 ? '−' : '') + '%' + nf1.format(Math.abs(v)); };
const ARROW = s => s > 2 ? 'trending_up' : s < -2 ? 'trending_down' : 'trending_flat';

/* ---- Rota profili ---- */
async function buildProfile(r, z0) {
  const len = r.total; if (!len) return null;
  // Uzun rotalarda da yokuşlar kaybolmasın: en fazla 3000 örnek; karo yakınlığı mesafeye göre
  const N = Math.min(3000, Math.max(60, Math.round(len / 30)));
  const z = z0 ?? (len < 40000 ? 13 : len < 200000 ? 12 : len < 500000 ? 11 : 10);
  const dists = [], pts = [];
  let j = 0;
  for (let i = 0; i <= N; i++) {
    const d = len * i / N; while (j < r.cum.length - 2 && r.cum[j + 1] < d) j++;
    const seg = r.cum[j + 1] - r.cum[j] || 1, t = Math.max(0, Math.min(1, (d - r.cum[j]) / seg));
    const A = r.coords[j], B = r.coords[Math.min(j + 1, r.coords.length - 1)];
    pts.push([A[0] + (B[0] - A[0]) * t, A[1] + (B[1] - A[1]) * t]); dists.push(d);
  }
  const raw = await DEM.many(pts, z);
  if (raw.every(v => v == null)) return null;
  for (let i = 0; i < raw.length; i++) if (raw[i] == null) raw[i] = raw[i - 1] ?? raw.find(v => v != null) ?? 0;
  const step = len / N, car = dir.mode === 'car';
  // Gürültü filtresi: araçta ~100 m, yayada ~60 m pencereli yumuşatma (köprü/yarma sıçramalarını da bastırır)
  const W = Math.max(1, Math.round((car ? 100 : 60) / step));
  const elevs = raw.map((_, i) => { let s = 0, n = 0; for (let k = -W; k <= W; k++) { const v = raw[i + k]; if (v != null) { s += v; n++; } } return s / n; });
  // Tünel ve viyadük düzeltmesi (araç): arazi modeli tünelde dağın üstünü, viyadükte vadinin dibini ölçer.
  // Hızlı yolda kısa, %9'u aşan tümsek/çukur görülür ama giriş–çıkış arası genel eğim makulse düz geçişle değiştirilir.
  let fixedSegs = 0;
  if (car && r.steps?.length) {
    const spd = new Float32Array(elevs.length); let si = 0;
    for (let i = 0; i < elevs.length; i++) {
      while (si < r.steps.length - 1 && r.steps[si + 1].at <= dists[i]) si++;
      const st = r.steps[si]; spd[i] = st.duration > 0 ? st.distance / st.duration * 3.6 : 0;
    }
    const K0 = Math.max(1, Math.round(75 / step)), T = 9, gap = Math.max(1, Math.round(400 / step));
    const g = i => { const a = Math.max(0, i - K0), b = Math.min(elevs.length - 1, i + K0); return (elevs[b] - elevs[a]) / ((b - a) * step) * 100; };
    const sus = elevs.map((_, i) => spd[i] >= 55 && Math.abs(g(i)) > T);
    // Şüpheli kümeleri topla; bir tümseğin çıkış ve iniş yamaçları ayrı kümeler olabilir, birlikte de dene
    const cl = [];
    for (let i = 0; i < sus.length; i++) {
      if (!sus[i]) continue;
      let j = i, last = i;
      while (j < sus.length && j - last <= gap) { if (sus[j]) last = j; j++; }
      cl.push({ a: Math.max(0, i - K0), b: Math.min(elevs.length - 1, last + K0) });
      i = last;
    }
    for (let c = 0; c < cl.length; c++) {
      for (let d = c; d < cl.length; d++) {
        const a = cl[c].a, b = cl[d].b, L = (b - a) * step;
        if (L > 8000) break;
        if (b > a + 1 && Math.abs(elevs[b] - elevs[a]) / L * 100 <= T) {
          for (let k = a + 1; k < b; k++) elevs[k] = elevs[a] + (elevs[b] - elevs[a]) * (k - a) / (b - a);
          fixedSegs++; c = d; break;
        }
      }
    }
  }
  // Eğim: araçta ~200 m, yayada ~100 m'lik merkezli fark
  const K = Math.max(1, Math.round((car ? 100 : 50) / step));
  const slopes = elevs.map((_, i) => { const a = Math.max(0, i - K), b = Math.min(elevs.length - 1, i + K); return b > a ? (elevs[b] - elevs[a]) / ((b - a) * step) * 100 : 0; });
  // Toplam tırmanış/iniş: 3 m eşikli histerezis (gürültü şişirmesini önler)
  let ascent = 0, descent = 0, ref = elevs[0]; const cumUp = [0], cumDown = [0];
  for (let i = 1; i < elevs.length; i++) {
    const d = elevs[i] - ref;
    if (d >= 3) { ascent += d; ref = elevs[i]; } else if (d <= -3) { descent -= d; ref = elevs[i]; }
    cumUp.push(ascent); cumDown.push(descent);
  }
  // Eğim bantlarına göre istikrarlı bölümler: kısa parçalar komşusuna katılır (haritada titremesiz renk)
  const BAND = s => s <= -8 ? -3 : s <= -3 ? -2 : s < 3 ? 0 : s < 6 ? 1 : s < 10 ? 2 : 3;
  const runSlope = (i0, i1) => i1 > i0 ? (elevs[i1] - elevs[i0]) / ((i1 - i0) * step) * 100 : slopes[i0];
  let runs = [];
  for (let i = 0; i < slopes.length; i++) {
    const b = BAND(slopes[i]), last = runs[runs.length - 1];
    if (last && last.b === b) last.i1 = i; else runs.push({ b, i0: i, i1: i });
  }
  const minRun = Math.max(2, Math.round((car ? 250 : 120) / step));
  for (let pass = 0; pass < 4; pass++) {
    const out = [];
    for (const r0 of runs) {
      const last = out[out.length - 1];
      if (last && (r0.i1 - r0.i0 + 1 < minRun || last.b === r0.b)) { last.i1 = r0.i1; last.b = BAND(runSlope(last.i0, last.i1)); }
      else if (last && last.i1 - last.i0 + 1 < minRun) { last.i1 = r0.i1; last.b = BAND(runSlope(last.i0, last.i1)); }
      else out.push({ ...r0 });
    }
    runs = out;
  }
  runs.forEach(r0 => { r0.s = runSlope(r0.i0, r0.i1); r0.b = BAND(r0.s); });
  // Uzun ve dik bölümler (araçta %6+, yaya/bisiklette %8+; en az 200 m)
  const th = car ? 6 : 8, steep = [];
  for (const r0 of runs) {
    if (Math.abs(r0.s) < th) continue;
    const prev = steep[steep.length - 1];
    if (prev && Math.sign(prev.grade) === Math.sign(r0.s) && dists[r0.i0] - prev.to < 150) { prev.to = dists[r0.i1]; prev.i1 = r0.i1; }
    else steep.push({ from: dists[r0.i0], to: dists[r0.i1], i0: r0.i0, i1: r0.i1, grade: r0.s });
  }
  for (const s of steep) {
    s.len = s.to - s.from; s.dh = elevs[s.i1] - elevs[s.i0]; s.grade = s.dh / Math.max(1, s.len) * 100; s.pt = pts[s.i0];
    const seg = slopes.slice(s.i0, s.i1 + 1); s.max = s.grade > 0 ? Math.max(...seg) : Math.min(...seg);
  }
  for (let i = steep.length - 1; i >= 0; i--) if (steep[i].len < 200 || Math.abs(steep[i].grade) < th) steep.splice(i, 1);
  // Eğime göre süre: yaya için Tobler, bisiklet için basit güç modeli
  let tAdj = null;
  if (dir.mode === 'foot' || dir.mode === 'bike') {
    tAdj = 0;
    for (let i = 1; i < elevs.length; i++) {
      const g = (elevs[i] - elevs[i - 1]) / step;
      const v = dir.mode === 'foot' ? 6 * Math.exp(-3.5 * Math.abs(g + 0.05)) : g > 0 ? Math.max(5, 18 / (1 + g * 14)) : Math.min(32, 18 * (1 - g * 6));
      tAdj += step / (v / 3.6);
    }
  }
  return { dists, elevs, slopes, runs, pts, step, len, fixedSegs, ascent, descent, cumUp, cumDown, steep, tAdj, min: Math.min(...elevs), max: Math.max(...elevs), maxUp: Math.max(...slopes), maxDown: Math.min(...slopes) };
}
function profileAt(pr, d) {
  const i = Math.max(0, Math.min(pr.elevs.length - 1, Math.round(d / pr.step)));
  return { i, elev: pr.elevs[i], slope: pr.slopes[Math.min(pr.slopes.length - 1, i + 1)], pt: pr.pts[i], upLeft: pr.ascent - pr.cumUp[i], downLeft: pr.descent - pr.cumDown[i] };
}
function profileGradientStops(pr) {
  if (!pr.runs) return [[0, '#4285f4'], [1, '#4285f4']];
  const stops = []; let last = -1;
  for (const r of pr.runs) {
    const c = slopeColor(r.s), a = Math.max(last + 1e-6, pr.dists[r.i0] / pr.len), b = Math.max(a + 1e-6, Math.min(1, pr.dists[r.i1] / pr.len));
    if (a >= 1) break; stops.push([a, c], [b, c]); last = b;
  }
  if (!stops.length) stops.push([0, '#4285f4'], [1, '#4285f4']);
  return stops.filter(s => s[0] <= 1);
}
function profileSvg(pr, id = 'prof') {
  const W = 360, H = 120, L = 34, B = 18, T = 8, w = W - L - 6, h = H - T - B;
  const span = Math.max(20, pr.max - pr.min), y = e => T + h - (e - pr.min) / span * h, x = d => L + d / pr.len * w;
  const line = pr.elevs.map((e, i) => (i ? 'L' : 'M') + x(pr.dists[i]).toFixed(1) + ' ' + y(e).toFixed(1)).join('');
  const area = line + `L${(L + w).toFixed(1)} ${T + h}L${L} ${T + h}Z`;
  const stops = profileGradientStops(pr).map(([o, c]) => `<stop offset="${(o * 100).toFixed(2)}%" stop-color="${c}"/>`).join('');
  const ticks = [pr.min, pr.min + span / 2, pr.max].map(e => `<text x="${L - 4}" y="${y(e) + 4}" text-anchor="end" class="ax">${fmtInt((e))}</text><line x1="${L}" x2="${L + w}" y1="${y(e)}" y2="${y(e)}" class="grid"/>`).join('');
  const xt = [0, 0.25, 0.5, 0.75, 1].map(f => `<text x="${x(pr.len * f)}" y="${H - 4}" text-anchor="${f === 0 ? 'start' : f === 1 ? 'end' : 'middle'}" class="ax">${fmtDist(pr.len * f)}</text>`).join('');
  return `<svg class="prof" id="${id}" viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" data-l="${L}" data-w="${w}">
    <defs><linearGradient id="${id}-g" x1="0" x2="1" y1="0" y2="0">${stops}</linearGradient></defs>
    ${ticks}<path d="${area}" fill="url(#${id}-g)" opacity=".55"/><path d="${line}" fill="none" stroke="url(#${id}-g)" stroke-width="2"/>
    ${xt}<line id="${id}-cur" x1="0" x2="0" y1="${T}" y2="${T + h}" class="cur" hidden/><circle id="${id}-dot" r="4" class="curdot" hidden/></svg>`;
}
function profileStatsHtml(pr) {
  return `<div class="pstats">
    <div><span class="ms" style="color:#dc2626">arrow_upward</span><b>${fmtInt((pr.ascent))} m</b><small>tırmanış</small></div>
    <div><span class="ms" style="color:#2563eb">arrow_downward</span><b>${fmtInt((pr.descent))} m</b><small>iniş</small></div>
    <div><span class="ms">landscape</span><b>${fmtInt(pr.min)}–${fmtInt((pr.max))} m</b><small>rakım</small></div>
    <div><span class="ms" style="color:${slopeColor(pr.maxUp)}">trending_up</span><b>${fmtSlope(pr.maxUp)}</b><small>en dik çıkış</small></div>
    <div><span class="ms" style="color:${slopeColor(pr.maxDown)}">trending_down</span><b>${fmtSlope(pr.maxDown)}</b><small>en dik iniş</small></div>
    <div><span class="ms">${ARROW((pr.elevs[pr.elevs.length - 1] - pr.elevs[0]) / pr.len * 100)}</span><b>${(pr.elevs[pr.elevs.length - 1] - pr.elevs[0]) > 0 ? '+' : ''}${fmtInt((pr.elevs[pr.elevs.length - 1] - pr.elevs[0]))} m</b><small>net fark</small></div>
  </div>`;
}
let profMarker = null;
function wireProfile(pr, id = 'prof') {
  const svg = $(id); if (!svg) return;
  const L = +svg.dataset.l, w = +svg.dataset.w, cur = $(id + '-cur'), dot = $(id + '-dot'), tip = $(id + '-tip');
  const move = ev => {
    const r = svg.getBoundingClientRect(), cx = (ev.touches ? ev.touches[0].clientX : ev.clientX) - r.left;
    const f = Math.max(0, Math.min(1, (cx / r.width * 360 - L) / w)), d = f * pr.len, p = profileAt(pr, d);
    const X = L + f * w; cur.setAttribute('x1', X); cur.setAttribute('x2', X); cur.hidden = false;
    const H = 120, T = 8, h = H - T - 18, span = Math.max(20, pr.max - pr.min);
    dot.setAttribute('cx', X); dot.setAttribute('cy', T + h - (p.elev - pr.min) / span * h); dot.hidden = false;
    if (tip) tip.innerHTML = `<b>${fmtDist(d)}</b> · ${nf0.format(Math.round(p.elev))} m · <span style="color:${slopeColor(p.slope)}">${fmtSlope(p.slope)}</span> ${p.slope > 1 ? 'tırmanış' : p.slope < -1 ? 'iniş' : 'düz'}`;
    if (!profMarker) profMarker = new maplibregl.Marker({ element: makeEl('<div class="prof-dot"></div>') });
    profMarker.setLngLat(p.pt).addTo(map);
  };
  const leave = () => { cur.hidden = true; dot.hidden = true; profMarker?.remove(); if (tip) tip.innerHTML = 'Grafikte gezdirin: haritada konumu gösterir'; };
  svg.addEventListener('mousemove', move); svg.addEventListener('touchmove', move, { passive: true }); svg.addEventListener('touchstart', move, { passive: true });
  svg.addEventListener('mouseleave', leave); svg.addEventListener('touchend', leave);
}

function terrainElevation(lngLat) {
  try {
    if (!map.terrain) return null;
    const h = map.queryTerrainElevation(lngLat);
    return Number.isFinite(h) ? h / (map.terrain.exaggeration || 1) : null;
  } catch { return null; }
}

/* ----- Kendi katmanlarımız: rota ve ölçüm ----- */
const EMPTY = { type: 'FeatureCollection', features: [] };
function addOwnSourcesAndLayers() {
  const before = map.getStyle().layers.find(l => l.type === 'symbol')?.id;
  map.addSource('a3-routes', { type: 'geojson', data: EMPTY });
  map.addSource('a3-route-sel', { type: 'geojson', data: EMPTY, lineMetrics: true });
  map.addSource('a3-measure', { type: 'geojson', data: EMPTY });
  const add = (layer, b = before) => { map.addLayer(layer, b); OWN.add(layer.id); };
  const W = (a, b) => ['interpolate', ['linear'], ['zoom'], 8, a, 16, b];
  const round = { 'line-join': 'round', 'line-cap': 'round' };
  add({ id: 'a3-route-alt-casing', type: 'line', source: 'a3-routes', filter: ['==', ['get', 'sel'], false], layout: round, paint: { 'line-color': '#7f9cd6', 'line-width': W(6, 12) } });
  add({ id: 'a3-route-alt', type: 'line', source: 'a3-routes', filter: ['==', ['get', 'sel'], false], layout: round, paint: { 'line-color': '#bccefb', 'line-width': W(4, 9) } });
  add({ id: 'a3-route-casing', type: 'line', source: 'a3-route-sel', layout: round, paint: { 'line-color': '#ffffff', 'line-width': W(8, 15), 'line-opacity': 0.9 } });
  add({ id: 'a3-route', type: 'line', source: 'a3-route-sel', layout: round, paint: { 'line-color': '#4285f4', 'line-width': W(5, 10) } });
  add({ id: 'a3-route-dir', type: 'symbol', source: 'a3-route-sel', layout: { 'symbol-placement': 'line', 'symbol-spacing': 90, 'text-field': '▶', 'text-size': 11, 'text-keep-upright': false, 'text-allow-overlap': true, 'text-ignore-placement': true, 'text-font': ['Noto Sans Bold'] }, paint: { 'text-color': '#ffffff', 'text-opacity': 0.9 } }, undefined);
  add({ id: 'a3-measure-line', type: 'line', source: 'a3-measure', layout: { 'line-cap': 'round' }, paint: { 'line-color': '#202124', 'line-width': 2.5, 'line-dasharray': [2, 1.5] } }, undefined);
  for (const id of ['a3-route-alt', 'a3-route-alt-casing']) {
    map.on('click', id, e => { const i = e.features?.[0]?.properties?.i; if (i != null && !navActive) { selectRoute(+i); e.preventDefault(); } });
    map.on('mouseenter', id, () => { map.getCanvas().style.cursor = 'pointer'; });
    map.on('mouseleave', id, () => { map.getCanvas().style.cursor = ''; });
  }
}

/* ----- İşaretler ----- */
const PIN_SVG = c => `<svg class="pin" viewBox="0 0 27 43"><path d="M13.5 0C6 0 0 6 0 13.4c0 10 13.5 29.6 13.5 29.6S27 23.4 27 13.4C27 6 21 0 13.5 0z" fill="${c}"/><path d="M13.5 1C6.6 1 1 6.6 1 13.4c0 9 11 26 12.5 28C15 39.4 26 22.4 26 13.4 26 6.6 20.4 1 13.5 1z" fill="none" stroke="rgba(0,0,0,.25)"/><circle cx="13.5" cy="13.5" r="4.8" fill="#3c0a06" opacity=".85"/></svg>`;
function makeEl(html) { const d = document.createElement('div'); d.innerHTML = html.trim(); return d.firstElementChild; }
let placeMarker = null, startMarker = null, endMarker = null, meMarker = null, currentPlace = null;
let resultMarkers = [], measureMarkers = [];
function setPlaceMarker(lngLat) {
  if (!placeMarker) placeMarker = new maplibregl.Marker({ element: makeEl(PIN_SVG('#ea4335')), anchor: 'bottom' });
  placeMarker.setLngLat(lngLat).addTo(map);
}
// Kamera yüksekliği düzeltildikten sonra DOM işaretçilerini yeniden konumlandır
function refreshMarkers() { [meMarker, placeMarker, startMarker, endMarker, profMarker, ...resultMarkers, ...measureMarkers].forEach(m => { if (m?._map) m.setLngLat(m.getLngLat()); }); }
function clearPlaceMarker() { placeMarker?.remove(); }
function clearResultMarkers() { resultMarkers.forEach(m => m.remove()); resultMarkers = []; }

/* ================= Panel ve mobil alt sayfa ================= */
const panel = $('panel'), body = document.body;
let viewStack = [], panelMode = null;
function sheetHeights() { const H = innerHeight; return { min: 132, peek: Math.round(H * 0.42), full: H - 64 }; }
let sheetState = 'peek';
function setSheet(state, px) {
  if (!isMobile() || panel.hidden) { document.documentElement.style.setProperty('--sheet-h', '0px'); body.classList.remove('sheet-full'); return; }
  sheetState = state;
  const h = px ?? sheetHeights()[state];
  document.documentElement.style.setProperty('--sheet-h', h + 'px');
  body.classList.toggle('sheet-full', state === 'full');
}
function openPanel(render, { mode = 'place', push = false, sheet = 'peek' } = {}) {
  render.mode = render.mode || mode;
  if (push && viewStack.length) viewStack.push(render); else viewStack = [render];
  if (panelMode === 'dir' && mode !== 'dir') clearRoute();
  panelMode = mode;
  panel.hidden = false; panel.classList.toggle('dir-mode', mode === 'dir');
  body.classList.add('panel-open'); body.classList.remove('panel-collapsed');
  body.classList.toggle('dir-open', mode === 'dir');
  $('panel-collapse').hidden = false;
  render($('panel-body'));
  $('panel-body').scrollTop = 0;
  setSheet(sheet);
}
function rerenderTop() { const r = viewStack[viewStack.length - 1]; if (r) r($('panel-body')); }
function goBack() {
  if (viewStack.length > 1) {
    viewStack.pop(); const r = viewStack[viewStack.length - 1]; panelMode = r.mode;
    clearPlaceMarker(); r($('panel-body')); $('panel-body').scrollTop = 0; setSheet('peek');
  } else closePanel();
}
function closePanel() {
  if (panelMode === 'dir') clearRoute();
  panel.hidden = true; panelMode = null; viewStack = []; currentPlace = null;
  body.classList.remove('panel-open', 'dir-open', 'panel-collapsed', 'sheet-full');
  $('panel-collapse').hidden = true;
  clearPlaceMarker(); clearResultMarkers(); setActiveChip(null);
  setSheet('peek');
}
$('panel-close').onclick = () => { closePanel(); qInput.value = ''; syncClear(); };
$('panel-collapse').onclick = () => body.classList.toggle('panel-collapsed');

// Mobil alt sayfayı sürükleme
(function sheetDrag() {
  let startY = 0, startH = 0, dragging = false, moved = false;
  panel.addEventListener('pointerdown', e => {
    if (!isMobile() || panelMode === null) return;
    if (!e.target.closest('.sheet-handle,.place-head,.list-head,.drag-zone')) return;
    if (e.target.closest('button,input,a')) return;
    dragging = true; moved = false; startY = e.clientY; startH = panel.getBoundingClientRect().height;
    panel.style.transition = 'none'; panel.setPointerCapture(e.pointerId);
  });
  panel.addEventListener('pointermove', e => {
    if (!dragging) return;
    const dy = startY - e.clientY; if (Math.abs(dy) > 6) moved = true;
    const { min, full } = sheetHeights();
    document.documentElement.style.setProperty('--sheet-h', Math.max(min - 60, Math.min(full, startH + dy)) + 'px');
  });
  const end = () => {
    if (!dragging) return; dragging = false; panel.style.transition = '';
    const h = panel.getBoundingClientRect().height, hs = sheetHeights();
    if (!moved) { setSheet(sheetState === 'full' ? 'peek' : 'full'); return; }
    if (h < hs.min - 30 && panelMode !== 'dir') { closePanel(); return; }
    setSheet(Object.entries(hs).sort((a, b) => Math.abs(a[1] - h) - Math.abs(b[1] - h))[0][0]);
  };
  panel.addEventListener('pointerup', end); panel.addEventListener('pointercancel', end);
  addEventListener('resize', debounce(() => setSheet(sheetState), 150));
})();

function mapPadding() {
  if (isMobile()) {
    const sh = panel.hidden ? 0 : Math.min(sheetHeights().peek, parseInt(getComputedStyle(document.documentElement).getPropertyValue('--sheet-h')) || 0);
    return { top: 110, bottom: sh + 30, left: 40, right: 40 };
  }
  const left = !panel.hidden && !body.classList.contains('panel-collapsed') ? 408 + 60 : 60;
  return { top: 90, bottom: 60, left, right: 80 };
}

/* ================= Arama ve öneriler ================= */
const qInput = $('q');
function syncClear() { $('clear-btn').hidden = !qInput.value; }
let acCtrl = null;
const uniq = a => a.filter(Boolean).filter((v, i, x) => x.indexOf(v) === i);
function placeFromPhoton(f) {
  const p = f.properties, [lon, lat] = f.geometry.coordinates;
  const street = [p.street, p.housenumber].filter(Boolean).join(' No:');
  const name = p.name || street || p.city || p.state || 'Konum';
  const parts = uniq([p.name ? street : '', p.district || p.locality, p.city || p.county, p.state, p.country !== 'Türkiye' ? p.country : '']).filter(v => v !== name);
  const cat = catOf(p.osm_value, {});
  return { name, lat, lon, address: parts.join(', '), cat: cat.label, icon: cat.icon,
    osm: p.osm_type && p.osm_id ? p.osm_type + p.osm_id : null, extent: p.extent, type: p.osm_value };
}
function placeFromNominatim(r) {
  const a = r.address || {}, t = r.extratags || {};
  const type = r.type === 'yes' ? r.category : r.type;
  const cat = catOf(type, t);
  const street = [a.road, a.house_number].filter(Boolean).join(' No:');
  const area = a.neighbourhood || a.suburb || a.quarter || a.village || '';
  const district = a.town || a.city_district || a.district || a.county || '';
  const city = a.province || a.state || a.city || '';
  const name = r.name || r.namedetails?.name || street || area || r.display_name?.split(',')[0] || 'Konum';
  const address = uniq([street, area, uniq([district, city]).join('/')]).filter(v => v !== name).join(', ') || r.display_name?.replace(/, Türkiye$/, '') || '';
  const bb = r.boundingbox?.map(Number);
  return { name, lat: +r.lat, lon: +r.lon, address, cat: cat.label, icon: cat.icon, tags: t,
    osm: r.osm_type && r.osm_id ? r.osm_type[0].toUpperCase() + r.osm_id : null,
    extent: bb && bb.every(Number.isFinite) ? [bb[2], bb[1], bb[3], bb[0]] : null, type, postcode: a.postcode };
}
function suggestionItems(features) {
  return features.map(placeFromPhoton).filter((p, i, a) => a.findIndex(q => q.name === p.name && q.address === p.address) === i);
}
function renderSuggest(box, items, { onPick, head, extra = [] } = {}) {
  box.innerHTML = '';
  const all = [...extra, ...items];
  if (head && items.length) box.insertAdjacentHTML('beforeend', `<div class="sg-head">${esc(head)}</div>`);
  all.forEach(it => {
    const d = document.createElement('div'); d.className = 'sg';
    d.innerHTML = `<span class="ms">${esc(it.sgIcon || it.icon || 'location_on')}</span><div><b>${esc(it.name)}</b>${it.address ? `<small>${esc(it.address)}</small>` : ''}</div>`;
    d.onmousedown = ev => ev.preventDefault();
    d.onclick = () => onPick(it);
    box.appendChild(d);
  });
  box.hidden = !all.length;
  return all.length;
}
function keyNav(input, box, onEnter) {
  input.addEventListener('keydown', e => {
    const items = [...box.querySelectorAll('.sg')];
    let i = items.findIndex(x => x.classList.contains('active'));
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); if (!items.length || box.hidden) return;
      items[i]?.classList.remove('active');
      i = e.key === 'ArrowDown' ? (i + 1) % items.length : (i - 1 + items.length) % items.length;
      items[i].classList.add('active');
    } else if (e.key === 'Enter') {
      e.preventDefault();
      if (i >= 0 && !box.hidden) items[i].click(); else onEnter();
    } else if (e.key === 'Escape') { box.hidden = true; input.blur(); }
  });
}
async function autocomplete(q, box, o) {
  acCtrl?.abort(); acCtrl = new AbortController();
  const c = map?.getCenter();
  try {
    const d = await api('/api/autocomplete', { q, ...(c ? { lat: c.lat, lon: c.lng } : {}) }, acCtrl.signal);
    return renderSuggest(box, suggestionItems(d.features || []), o);
  } catch (e) { if (e.name !== 'AbortError') console.warn(e); return 0; }
}
const recent = () => store.get('recent', []);
function addRecent(p) {
  const r = recent().filter(x => !(Math.abs(x.lat - p.lat) < 1e-5 && Math.abs(x.lon - p.lon) < 1e-5));
  r.unshift({ name: p.name, lat: p.lat, lon: p.lon, address: p.address, icon: p.icon, osm: p.osm, cat: p.cat });
  store.set('recent', r.slice(0, 10));
}
async function showMainSuggest() {
  const box = $('suggest'), q = qInput.value.trim();
  let n;
  if (q.length >= 2) n = await autocomplete(q, box, { onPick: pickFromSearch });
  else n = renderSuggest(box, recent().map(x => ({ ...x, sgIcon: 'history' })), { onPick: pickFromSearch, head: 'Son aramalar' });
  $('searchbox').classList.toggle('open', !!n && document.activeElement === qInput);
  if (document.activeElement !== qInput) box.hidden = true;
}
function hideMainSuggest() { $('suggest').hidden = true; $('searchbox').classList.remove('open'); }
const debSuggest = debounce(showMainSuggest, 220);
qInput.addEventListener('focus', showMainSuggest);
qInput.addEventListener('input', () => { syncClear(); debSuggest(); });
qInput.addEventListener('blur', () => setTimeout(hideMainSuggest, 150));
keyNav(qInput, $('suggest'), () => fullSearch(qInput.value.trim()));
$('search-btn').onclick = () => fullSearch(qInput.value.trim());
$('clear-btn').onclick = () => { qInput.value = ''; syncClear(); qInput.focus(); if (panelMode === 'place' || panelMode === 'list') closePanel(); };
function pickFromSearch(p) {
  hideMainSuggest(); qInput.value = p.name; syncClear(); qInput.blur();
  showPlace({ ...p }, { fly: true });
}
async function fullSearch(q) {
  if (!q || !map) return;
  hideMainSuggest(); qInput.blur();
  // Koordinat girildiyse doğrudan git
  const m = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*[,; ]\s*(-?\d+(?:\.\d+)?)\s*$/);
  if (m) {
    const lat = +m[1], lon = +m[2];
    if (Math.abs(lat) <= 90 && Math.abs(lon) <= 180) return showPlace({ name: `${lat.toFixed(6)}, ${lon.toFixed(6)}`, lat, lon, icon: 'pin_drop', needsReverse: true, keepName: true }, { fly: true });
  }
  openPanel(el => { el.innerHTML = '<div class="loading"><div class="spinner"></div>Aranıyor…</div>'; }, { mode: 'list' });
  try {
    const b = map.getBounds();
    const res = await api('/api/search', { q, viewbox: [b.getWest(), b.getNorth(), b.getEast(), b.getSouth()].map(v => v.toFixed(4)).join(',') });
    let places = res.map(placeFromNominatim);
    if (!places.length) {
      const d = await api('/api/autocomplete', { q, lat: map.getCenter().lat, lon: map.getCenter().lng });
      places = suggestionItems(d.features || []);
    }
    if (places.length === 1) return showPlace(places[0], { fly: true });
    showList(`"${q}" için sonuçlar`, places, { fit: true });
  } catch (e) {
    openPanel(el => { el.innerHTML = `<div class="empty">Arama yapılamadı.<br><small>${esc(e.message)}</small></div>`; }, { mode: 'list' });
  }
}

/* ================= Yer kartı ================= */
const saved = () => store.get('saved', []);
const same = (a, b) => Math.abs(a.lat - b.lat) < 1e-5 && Math.abs(a.lon - b.lon) < 1e-5;
const isSaved = p => saved().some(x => same(x, p));
function toggleSave(p) {
  let s = saved();
  if (isSaved(p)) { s = s.filter(x => !same(x, p)); toast('Kaydedilenlerden kaldırıldı'); }
  else { s.unshift({ name: p.name, lat: p.lat, lon: p.lon, address: p.address, icon: p.icon, osm: p.osm, cat: p.cat }); toast('Kaydedildi'); }
  store.set('saved', s);
}
const DAYS = { Mo: 'Pzt', Tu: 'Sal', We: 'Çar', Th: 'Per', Fr: 'Cum', Sa: 'Cmt', Su: 'Paz', PH: 'Resmî tatil' };
function fmtHours(oh) {
  if (!oh) return null;
  if (/^24\/7$/.test(oh.trim())) return ['24 saat açık'];
  return oh.split(/\s*;\s*/).map(s => s.replace(/\b(Mo|Tu|We|Th|Fr|Sa|Su|PH)\b/g, d => DAYS[d]).replace(/\boff\b/g, 'kapalı').replace(/,(?=\S)/g, ', ')).slice(0, 8);
}
function flyToPlace(p) {
  const big = p.extent && (Math.abs(p.extent[2] - p.extent[0]) > 0.004 || Math.abs(p.extent[1] - p.extent[3]) > 0.004);
  const pad = mapPadding();
  if (big) map.fitBounds([[p.extent[0], p.extent[3]], [p.extent[2], p.extent[1]]], { padding: pad, maxZoom: 16, pitch: Math.max(map.getPitch(), 40), duration: 1600 });
  else map.flyTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 16.5), pitch: Math.max(map.getPitch(), 55), padding: pad, duration: 1600, essential: true });
}
function showPlace(p, { fly = false, push = false } = {}) {
  if (!map) return;
  hideCtx(); currentPlace = p;
  setPlaceMarker([p.lon, p.lat]);
  const render = el => renderPlace(el, p);
  render.mode = 'place';
  openPanel(render, { mode: 'place', push });
  if (fly) flyToPlace(p);
  const isTop = () => viewStack[viewStack.length - 1] === render;
  if (p.needsReverse) {
    p.needsReverse = false;
    api('/api/reverse', { lat: p.lat, lon: p.lon, zoom: 18 }).then(r => {
      if (r && !r.error) {
        const n = placeFromNominatim(r);
        p.address = n.address; p.postcode = n.postcode;
        if (!p.keepName) { p.name = n.name; p.cat = n.cat; p.icon = n.icon; p.tags = n.tags; p.osm = n.osm; }
        else if (n.name === p.name) { p.tags = n.tags; p.osm = n.osm; }
        if (p.name && p.icon !== 'pin_drop') addRecent(p);
      }
      if (isTop()) render($('panel-body'));
    }).catch(() => {});
  } else {
    addRecent(p);
    if (p.osm && !p.tags) {
      api('/api/lookup', { osm_ids: p.osm }).then(r => {
        if (r?.[0]) { const n = placeFromNominatim(r[0]); p.tags = n.tags; if (!p.address) p.address = n.address; p.postcode = n.postcode; if (!p.cat) { p.cat = n.cat; p.icon = n.icon; } }
        if (isTop()) render($('panel-body'));
      }).catch(() => {});
    }
  }
  if (p.elev == null) DEM.slopeAt(p.lon, p.lat).then(({ elev, slope }) => { if (elev == null) throw 0; p.elev = elev; p.slope = slope; const e = $('elev'); if (e && isTop()) e.innerHTML = nf0.format(Math.round(elev)) + ' m' + (slope != null ? ` <small style="color:#5f6368;font-weight:400">· arazi eğimi ${fmtSlope(slope).replace('+', '')}</small>` : ''); }).catch(() => { const e = $('elev'); if (e && isTop()) e.textContent = '—'; });
}
function renderPlace(el, p) {
  const t = p.tags || {};
  const hours = fmtHours(t.opening_hours);
  const phone = t.phone || t['contact:phone'], web = t.website || t['contact:website'] || t.url;
  const sub = [p.cat, t.cuisine ? t.cuisine.split(';').join(', ') : ''].filter(Boolean).join(' · ');
  const back = viewStack.length > 1 ? `<button class="icon-btn" id="pl-back" aria-label="Geri" style="margin:-6px 0 4px -10px"><span class="ms">arrow_back</span></button>` : '';
  const coord = `${p.lat.toFixed(6)}, ${p.lon.toFixed(6)}`;
  el.innerHTML = `
    <div class="place-hero"><span class="ms">${esc(p.icon || 'location_on')}</span></div>
    <div class="place-head drag-zone">${back}
      <h1>${esc(p.name)}</h1>
      ${sub ? `<div class="sub">${esc(sub)}</div>` : ''}
      ${hours && hours[0] === '24 saat açık' ? '<div class="open">24 saat açık</div>' : ''}
    </div>
    <div class="actions">
      <button class="act primary" id="pl-dir"><span class="circle"><span class="ms fill">directions</span></span>Yol tarifi</button>
      <button class="act" id="pl-start"><span class="circle"><span class="ms">navigation</span></span>Başlat</button>
      <button class="act" id="pl-save"><span class="circle"><span class="ms ${isSaved(p) ? 'fill' : ''}">bookmark</span></span>${isSaved(p) ? 'Kaydedildi' : 'Kaydet'}</button>
      <button class="act" id="pl-near"><span class="circle"><span class="ms">travel_explore</span></span>Yakında</button>
      <button class="act" id="pl-share"><span class="circle"><span class="ms">share</span></span>Paylaş</button>
    </div>
    <div class="info">
      ${p.address ? `<div class="info-row copy" data-copy="${esc(p.address)}"><span class="ms">location_on</span><span>${esc(p.address)}${p.postcode ? ' ' + esc(p.postcode) : ''}</span></div>` : ''}
      ${hours ? `<div class="info-row"><span class="ms">schedule</span><ul class="hours">${hours.map(h => `<li>${esc(h)}</li>`).join('')}</ul></div>` : ''}
      ${web ? `<a class="info-row" href="${esc(/^https?:/.test(web) ? web : 'https://' + web)}" target="_blank" rel="noopener"><span class="ms">public</span><span>${esc(web.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</span></a>` : ''}
      ${phone ? `<a class="info-row" href="tel:${esc(phone.split(';')[0].replace(/\s/g, ''))}"><span class="ms">call</span><span>${esc(phone.split(';')[0])}</span></a>` : ''}
      <div class="info-row copy" data-copy="${coord}"><span class="ms">pin_drop</span><span>${coord}</span></div>
      <div class="info-row"><span class="ms">landscape</span><span>Rakım: <b id="elev">${p.elev != null ? nf0.format(Math.round(p.elev)) + ' m' : '…'}</b></span></div>
      ${t.wheelchair === 'yes' ? '<div class="info-row"><span class="ms">accessible</span><span>Tekerlekli sandalye ile erişilebilir</span></div>' : ''}
    </div>
    <div class="mini-note">Bilgiler OpenStreetMap topluluğundan gelir; eksik veya eski olabilir.</div>`;
  $('pl-back')?.addEventListener('click', goBack);
  $('pl-dir').onclick = () => openDirections({ to: p });
  $('pl-start').onclick = () => openDirections({ to: p, autostart: true });
  $('pl-save').onclick = () => { toggleSave(p); renderPlace(el, p); };
  $('pl-near').onclick = () => { map.easeTo({ center: [p.lon, p.lat], zoom: Math.max(map.getZoom(), 15), padding: mapPadding() }); map.once('moveend', () => nearby(NEARBY[0])); };
  $('pl-share').onclick = () => share(p.name, placeUrl(p));
  el.querySelectorAll('[data-copy]').forEach(r => { r.onclick = () => copy(r.dataset.copy); });
}
function placeUrl(p) {
  const u = new URL(location.origin + '/');
  u.searchParams.set('p', `${p.lat.toFixed(6)},${p.lon.toFixed(6)}`); u.searchParams.set('n', p.name);
  return u + `#17/${p.lat.toFixed(5)}/${p.lon.toFixed(5)}/${Math.round(map.getBearing())}/${Math.round(map.getPitch())}`;
}
async function copy(text) { try { await navigator.clipboard.writeText(text); toast('Panoya kopyalandı'); } catch { toast(text, 5000); } }
async function share(title, url) {
  if (navigator.share && isMobile()) { try { await navigator.share({ title, url }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  copy(url);
}

/* ================= Sonuç listesi (arama / yakındakiler / kaydedilenler) ================= */
function showList(title, places, { fit = false, sub = '', onRefresh = null } = {}) {
  if (!map) return;
  clearPlaceMarker(); clearResultMarkers();
  const center = meLngLat || [map.getCenter().lng, map.getCenter().lat];
  const drawMarkers = () => {
    clearResultMarkers();
    places.forEach(p => {
      const elm = makeEl(`<div class="res-dot" title="${esc(p.name)}"><span class="ms fill">${esc(p.icon || 'location_on')}</span></div>`);
      elm.onclick = e => { e.stopPropagation(); showPlace(p, { fly: true, push: true }); };
      resultMarkers.push(new maplibregl.Marker({ element: elm }).setLngLat([p.lon, p.lat]).addTo(map));
    });
  };
  const render = el => {
    el.innerHTML = `<div class="list-head drag-zone"><h2>${esc(title)}</h2><small>${places.length ? places.length + ' sonuç' : ''}${sub ? ' · ' + esc(sub) : ''}</small>
      ${onRefresh ? '<div style="margin-top:8px"><button class="btn outline" id="ls-refresh"><span class="ms">refresh</span>Bu alanda ara</button></div>' : ''}</div>
      ${places.length ? '' : '<div class="empty">Sonuç bulunamadı. Haritayı kaydırıp ya da uzaklaştırıp tekrar deneyin.</div>'}
      ${places.map((p, i) => `<div class="item" data-i="${i}"><span class="ms">${esc(p.icon || 'location_on')}</span><div><b>${esc(p.name)}</b><small>${esc([p.cat, p.address].filter(Boolean).join(' · '))}</small>${p.tags?.opening_hours ? `<small>${esc(fmtHours(p.tags.opening_hours)[0])}</small>` : ''}</div><span class="dist">${fmtDist(haversine(center, [p.lon, p.lat]))}</span></div>`).join('')}`;
    el.querySelectorAll('.item').forEach(it => {
      const i = +it.dataset.i, p = places[i];
      it.onclick = () => showPlace(p, { fly: true, push: true });
      it.onmouseenter = () => resultMarkers[i]?.getElement().classList.add('hl');
      it.onmouseleave = () => resultMarkers[i]?.getElement().classList.remove('hl');
    });
    $('ls-refresh')?.addEventListener('click', onRefresh);
    drawMarkers();
  };
  render.mode = 'list';
  openPanel(render, { mode: 'list' });
  if (fit && places.length > 1) {
    const b = new maplibregl.LngLatBounds(); places.forEach(p => b.extend([p.lon, p.lat]));
    map.fitBounds(b, { padding: mapPadding(), maxZoom: 15, duration: 1200 });
  } else if (fit && places.length === 1) map.flyTo({ center: [places[0].lon, places[0].lat], zoom: 15, padding: mapPadding() });
}

/* ----- Kategori çipleri ----- */
function setActiveChip(id) { document.querySelectorAll('.chip').forEach(c => c.classList.toggle('on', c.dataset.id === id)); }
NEARBY.forEach(n => {
  const b = document.createElement('button'); b.className = 'chip'; b.dataset.id = n.id;
  b.innerHTML = `<span class="ms">${n.icon}</span>${n.label}`;
  b.onclick = () => nearby(n);
  $('chips').appendChild(b);
});
async function nearby(n) {
  if (!map) return;
  openPanel(el => { el.innerHTML = `<div class="loading"><div class="spinner"></div>${esc(n.label)} aranıyor…</div>`; }, { mode: 'list' });
  setActiveChip(n.id);
  if (map.getZoom() < 12.5) map.jumpTo({ zoom: 13.5 });
  // Eğik görünümde ufka kadar uzanan alanı merkez çevresiyle sınırla
  const b = map.getBounds(), c = map.getCenter(), span = 0.08;
  const w = Math.max(b.getWest(), c.lng - span), e = Math.min(b.getEast(), c.lng + span);
  const s = Math.max(b.getSouth(), c.lat - span * 0.75), nn = Math.min(b.getNorth(), c.lat + span * 0.75);
  try {
    const res = await api('/api/nearby', { q: n.q, bbox: [w, s, e, nn].map(v => v.toFixed(3)).join(',') });
    const places = res.map(placeFromNominatim).map(p => ({ ...p, icon: p.icon === 'location_on' ? n.icon : p.icon, cat: p.cat || n.label.replace(/lar$|ler$/, '') }));
    const cc = [c.lng, c.lat];
    places.sort((a, b2) => haversine(cc, [a.lon, a.lat]) - haversine(cc, [b2.lon, b2.lat]));
    showList(n.label, places, { onRefresh: () => nearby(n) });
    setActiveChip(n.id);
  } catch (err) {
    openPanel(el => { el.innerHTML = `<div class="empty">Yakındaki yerler alınamadı.<br><small>${esc(err.message)}</small></div>`; }, { mode: 'list' });
  }
}

/* ================= Haritayla etkileşim ================= */
let suppressClick = false;
const isLabel = f => f.layer.type === 'symbol' && f.properties?.name && !OWN.has(f.layer.id);
function wireMap() {
  map.on('dragstart', () => { userMoved = true; hideCtx(); });
  map.on('zoomstart', () => { userMoved = true; });
  map.on('rotate', updateCompass); map.on('pitch', updateTilt);
  map.on('moveend', hudCenter); map.once('load', hudCenter);
  map.on('mousemove', e => { if (!isMobile()) hudCursor(e); });
  map.on('mouseout', () => hudCenter());
  map.on('click', e => {
    if (e.defaultPrevented || suppressClick) return;
    hideCtx(); $('layers-pop').hidden = true;
    if (measuring) { addMeasurePoint([e.lngLat.lng, e.lngLat.lat]); return; }
    if (navActive) return;
    // Haritadaki bir yere (POI / yer adı) tıklandı mı?
    const feats = map.queryRenderedFeatures([[e.point.x - 6, e.point.y - 6], [e.point.x + 6, e.point.y + 6]]).filter(isLabel);
    if (feats.length && panelMode !== 'dir') {
      const f = feats[0], pr = f.properties;
      const ll = f.geometry.type === 'Point' ? f.geometry.coordinates : [e.lngLat.lng, e.lngLat.lat];
      const isPlace = f.sourceLayer === 'place';
      const cat = catOf(pr.subclass || pr.class);
      showPlace({ name: pr['name:tr'] || pr['name:latin'] || pr.name, lat: ll[1], lon: ll[0], cat: cat.label, icon: cat.icon, needsReverse: !isPlace, keepName: true }, { fly: false });
      if (isPlace) map.flyTo({ center: ll, zoom: Math.max(map.getZoom() + 2, pr.class === 'city' ? 11 : 13), duration: 1200, padding: mapPadding() });
      else map.easeTo({ center: ll, padding: mapPadding(), duration: 600 });
      return;
    }
    // Boş noktaya tıklama: Google gibi açık kart kapanır; kart yoksa nokta işaretlenir
    if (panelMode === 'dir') return;
    if (panelMode === 'place' || panelMode === 'list') { if (panelMode === 'place' && viewStack.length > 1) goBack(); else closePanel(); return; }
    showPlace({ name: 'İşaretlenmiş konum', lat: e.lngLat.lat, lon: e.lngLat.lng, icon: 'pin_drop', needsReverse: true }, { fly: false });
  });
  map.on('mousemove', e => {
    if (measuring) { map.getCanvas().style.cursor = 'crosshair'; return; }
    if (navActive) return;
    map.getCanvas().style.cursor = map.queryRenderedFeatures(e.point).some(isLabel) ? 'pointer' : '';
  });
  map.on('contextmenu', e => { e.preventDefault(); showCtx(e.point, e.lngLat); });
  // Mobilde uzun basma = bağlam menüsü
  let lp = null, lpStart = null;
  map.on('touchstart', e => {
    clearTimeout(lp);
    if (e.originalEvent.touches.length !== 1 || navActive) return;
    lpStart = e.point;
    lp = setTimeout(() => { suppressClick = true; setTimeout(() => { suppressClick = false; }, 500); showCtx(e.point, e.lngLat); navigator.vibrate?.(15); }, 550);
  });
  map.on('touchmove', e => { if (lpStart && (Math.abs(e.point.x - lpStart.x) > 8 || Math.abs(e.point.y - lpStart.y) > 8)) clearTimeout(lp); });
  map.on('touchend', () => clearTimeout(lp));
  map.on('movestart', () => clearTimeout(lp));
}

/* ----- Bağlam menüsü ----- */
function showCtx(point, lngLat) {
  const m = $('ctx'), ll = { lat: lngLat.lat, lon: lngLat.lng };
  const coord = `${ll.lat.toFixed(5)}, ${ll.lon.toFixed(5)}`;
  const pt = () => ({ name: coord, ...ll, icon: 'pin_drop', needsReverse: true, keepName: true });
  m.innerHTML = `
    <button data-a="copy"><span class="ms">content_copy</span><span class="coord">${coord}</span></button>
    <button data-a="from"><span class="ms">trip_origin</span>Buradan yol tarifi</button>
    <button data-a="to"><span class="ms">location_on</span>Buraya yol tarifi</button>
    <button data-a="what"><span class="ms">help</span>Burada ne var?</button>
    <button data-a="near"><span class="ms">travel_explore</span>Yakındaki restoranlar</button>
    <button data-a="measure"><span class="ms">straighten</span>Mesafe ölç</button>
    <button data-a="share"><span class="ms">share</span>Bu konumu paylaş</button>`;
  m.hidden = false;
  const r = map.getContainer().getBoundingClientRect();
  m.style.left = Math.max(8, Math.min(point.x + r.left, innerWidth - m.offsetWidth - 8)) + 'px';
  m.style.top = Math.max(8, Math.min(point.y + r.top, innerHeight - m.offsetHeight - 8)) + 'px';
  m.onclick = ev => {
    const a = ev.target.closest('button')?.dataset.a; if (!a) return; hideCtx();
    if (a === 'copy') copy(coord);
    if (a === 'from') { if (panelMode === 'dir') { dir.from = pt(); rerenderTop(); if (dir.to) computeRoute(); } else openDirections({ from: pt() }); }
    if (a === 'to') { if (panelMode === 'dir') { dir.to = pt(); rerenderTop(); if (dir.from) computeRoute(); } else openDirections({ to: pt() }); }
    if (a === 'what') showPlace({ ...pt(), name: 'İşaretlenmiş konum', keepName: false }, { fly: false });
    if (a === 'near') { map.easeTo({ center: [ll.lon, ll.lat], zoom: Math.max(15, map.getZoom()) }); map.once('moveend', () => nearby(NEARBY[0])); }
    if (a === 'measure') { startMeasure(); addMeasurePoint([ll.lon, ll.lat]); }
    if (a === 'share') share(coord, placeUrl({ ...pt() }));
  };
}
function hideCtx() { $('ctx').hidden = true; }
document.addEventListener('keydown', e => { if (e.key === 'Escape') { hideCtx(); if (measuring) endMeasure(); } });
document.addEventListener('pointerdown', e => { if (!$('ctx').hidden && !$('ctx').contains(e.target)) hideCtx(); });

/* ----- Kontroller ----- */
function updateCompass() { $('compass-icon').style.transform = `rotate(${-map.getBearing()}deg)`; }
function updateTilt() { $('tilt').textContent = map.getPitch() > 10 ? '2D' : '3D'; }
$('compass').onclick = () => map?.easeTo({ bearing: 0, duration: 500 });
$('zoom-in').onclick = () => map?.zoomIn();
$('zoom-out').onclick = () => map?.zoomOut();
$('tilt').onclick = () => {
  if (!map) return;
  if (map.getPitch() > 10) map.easeTo({ pitch: 0, bearing: 0, duration: 700 });
  else map.easeTo({ pitch: 60, bearing: map.getBearing() || -20, duration: 900 });
};

/* ----- Konumum ----- */
let meLngLat = null, meHeading = null, meSpeed = null, watchId = null;
const meListeners = new Set();
function ensureMe() {
  return new Promise((resolve, reject) => {
    if (meLngLat) { resolve(meLngLat); return; }
    if (!navigator.geolocation) { reject(new Error('Bu cihazda konum servisi yok.')); return; }
    if (!isSecureContext) { reject(new Error('Konum için HTTPS gerekli.')); return; }
    let done = false;
    const onPos = pos => {
      const c = pos.coords; meLngLat = [c.longitude, c.latitude];
      meSpeed = c.speed; if (Number.isFinite(c.heading) && (c.speed ?? 0) > 0.8) meHeading = c.heading;
      updateMeMarker(); meListeners.forEach(f => f());
      if (!done) { done = true; resolve(meLngLat); }
    };
    const onErr = err => {
      if (!done) { done = true; reject(new Error(err.code === 1 ? 'Konum izni verilmedi. Tarayıcı ayarlarından bu siteye konum izni verin.' : 'Konum alınamadı.')); }
      if (watchId != null) navigator.geolocation.clearWatch(watchId); watchId = null;
    };
    if (watchId == null) watchId = navigator.geolocation.watchPosition(onPos, onErr, { enableHighAccuracy: true, maximumAge: 1000, timeout: 20000 });
    else meListeners.add(function once() { meListeners.delete(once); if (!done) { done = true; resolve(meLngLat); } });
  });
}
function updateMeMarker() {
  if (!meLngLat || !map) return;
  if (!meMarker) meMarker = new maplibregl.Marker({ element: makeEl('<div class="me-dot"></div>'), rotationAlignment: 'map', pitchAlignment: 'viewport', opacityWhenCovered: '1' }).setLngLat(meLngLat).addTo(map);
  meMarker.setLngLat(meLngLat);
  const elm = meMarker.getElement();
  if (navActive) {
    if (!elm.classList.contains('nav')) { elm.classList.add('nav'); elm.innerHTML = '<svg viewBox="0 0 26 26" width="38" height="38"><circle cx="13" cy="13" r="12" fill="#fff" stroke="rgba(0,0,0,.15)"/><path d="M13 3.5l7 17.5-7-4-7 4z" fill="#1a73e8"/></svg>'; }
    meMarker.setRotation(navBearing ?? 0);
  } else if (elm.classList.contains('nav')) { elm.classList.remove('nav'); elm.innerHTML = ''; meMarker.setRotation(0); }
}
async function locateMe() {
  $('locate').classList.add('on');
  try {
    const ll = await ensureMe();
    map.flyTo({ center: ll, zoom: Math.max(map.getZoom(), 16), padding: mapPadding(), duration: 1400 });
  } catch (e) { $('locate').classList.remove('on'); toast(e.message, 5000); }
}
$('locate').onclick = locateMe;

/* ================= Yol tarifi ================= */
const MODES = { car: { label: 'Araç', icon: 'directions_car', svc: 'routed-car' }, foot: { label: 'Yürüyüş', icon: 'directions_walk', svc: 'routed-foot' }, bike: { label: 'Bisiklet', icon: 'directions_bike', svc: 'routed-bike' } };
const dir = { from: null, to: null, mode: store.get('mode', 'car'), routes: [], sel: 0, showSteps: false, loading: false, error: '' };
const ME = { name: 'Konumunuz', me: true, icon: 'my_location' };
function openDirections({ from, to, autostart = false } = {}) {
  if (!map) return;
  hideMainSuggest(); hideCtx(); clearResultMarkers(); clearPlaceMarker();
  dir.from = from || ME; dir.to = to || null; dir.routes = []; dir.sel = 0; dir.showSteps = false; dir.error = '';
  const render = el => renderDir(el);
  render.mode = 'dir';
  openPanel(render, { mode: 'dir', sheet: isMobile() ? 'full' : 'peek' });
  if (dir.from && dir.to) computeRoute().then(ok => { if (ok && autostart) startNav(); });
  else setTimeout(() => $(dir.to ? 'dir-from' : 'dir-to')?.focus(), 60);
}
$('dir-btn').onclick = () => openDirections(panelMode === 'place' && currentPlace ? { to: currentPlace } : {});
function renderDir(el) {
  el.innerHTML = `
    <div class="dir-head">
      <div class="dir-top">
        <button class="icon-btn" id="dir-close" aria-label="Kapat"><span class="ms">arrow_back</span></button>
        <div class="modes">${Object.entries(MODES).map(([k, m]) => `<button class="mode ${dir.mode === k ? 'on' : ''}" data-m="${k}" title="${m.label}"><span class="ms">${m.icon}</span>${dir.mode === k ? m.label : ''}</button>`).join('')}</div>
      </div>
      <div class="dir-fields">
        <div class="dir-dots"><span class="dot"></span><span class="vd"></span><span class="ms fill">location_on</span></div>
        <div class="dir-inputs">
          <div class="dir-in"><input id="dir-from" placeholder="Başlangıç noktası seçin" value="${esc(dir.from?.name || '')}" autocomplete="off"><div class="suggest" id="sg-from" hidden></div></div>
          <div class="dir-in"><input id="dir-to" placeholder="Hedef seçin" value="${esc(dir.to?.name || '')}" autocomplete="off"><div class="suggest" id="sg-to" hidden></div></div>
        </div>
        <button class="icon-btn" id="dir-swap" aria-label="Yer değiştir"><span class="ms">swap_vert</span></button>
      </div>
    </div>
    <div id="dir-results">${dirResultsHtml()}</div>`;
  $('dir-close').onclick = () => closePanel();
  el.querySelectorAll('.mode').forEach(b => { b.onclick = () => { dir.mode = b.dataset.m; store.set('mode', dir.mode); renderDir(el); if (dir.from && dir.to) computeRoute(); }; });
  $('dir-swap').onclick = () => { [dir.from, dir.to] = [dir.to, dir.from]; renderDir(el); if (dir.from && dir.to) computeRoute(); };
  for (const which of ['from', 'to']) {
    const input = $('dir-' + which), box = $('sg-' + which);
    const pick = p => {
      dir[which] = p.me ? ME : { ...p }; box.hidden = true; input.value = dir[which].name; input.blur();
      if (dir.from && dir.to) computeRoute(); else $(which === 'from' ? 'dir-to' : 'dir-from').focus();
    };
    const show = () => {
      const q = input.value.trim();
      if (q.length >= 2 && q !== dir[which]?.name) autocomplete(q, box, { onPick: pick });
      else renderSuggest(box, recent().slice(0, 5).map(x => ({ ...x, sgIcon: 'history' })), { onPick: pick, extra: [{ ...ME, sgIcon: 'my_location' }] });
    };
    input.addEventListener('focus', () => { input.select(); show(); if (isMobile()) setSheet('full'); });
    input.addEventListener('input', debounce(show, 220));
    input.addEventListener('blur', () => setTimeout(() => { box.hidden = true; if (input.value !== (dir[which]?.name || '')) input.value = dir[which]?.name || ''; }, 160));
    keyNav(input, box, async () => {
      const q = input.value.trim(); if (!q) return;
      try { const d = await api('/api/autocomplete', { q, lat: map.getCenter().lat, lon: map.getCenter().lng }); const it = suggestionItems(d.features || []); if (it[0]) pick(it[0]); else toast('Yer bulunamadı'); } catch { toast('Arama yapılamadı'); }
    });
  }
  wireDirResults();
}
function dirResultsHtml() {
  if (dir.loading) return '<div class="loading"><div class="spinner"></div>Rota hesaplanıyor…</div>';
  if (dir.error) return `<div class="empty">${esc(dir.error)}</div>`;
  if (!dir.routes.length) return `<div class="empty">Başlangıç ve hedef seçin.<br><small>Haritada sağ tıklayarak (mobilde basılı tutarak) da nokta seçebilirsiniz.</small></div>`;
  const now = Date.now(), fastest = Math.min(...dir.routes.map(r => r.duration));
  const opt = dir.routes.map((r, i) => `
    <div class="route-opt ${i === dir.sel ? 'on' : ''}" data-i="${i}">
      <span class="ms">${MODES[dir.mode].icon}</span>
      <div style="flex:1">
        <div><span class="t ${r.duration > fastest * 1.15 ? 'slow' : ''}">${fmtDur(r.duration)}</span><span class="d">${fmtDist(r.distance)}</span></div>
        <div class="via">${r.summaryText ? esc(r.summaryText) + ' üzerinden' : ''}${i === 0 && dir.routes.length > 1 ? ' · En hızlı rota' : ''}</div>
        <div class="via">Tahmini varış: ${fmtClock(new Date(now + r.duration * 1000))}</div>
        ${r.tolls ? `<div class="via toll-line">${r.tolls.total > 0 ? `<span class="toll-chip"><span class="ms">toll</span>${fmtTL(r.tolls.total)} geçiş ücreti</span>` : '<span class="toll-chip free"><span class="ms">money_off</span>Ücretsiz</span>'}${dir.routes.length > 1 && dir.routes.some(x => x.tolls && x.tolls.total !== r.tolls.total) && r.tolls.total === Math.min(...dir.routes.map(x => x.tolls?.total ?? Infinity)) ? '<span class="toll-best">En ucuz</span>' : ''}</div>` : ''}
        ${r.profile ? `<div class="via climb"><span style="color:#dc2626">↑ ${nf0.format(Math.round(r.profile.ascent))} m</span> <span style="color:#2563eb">↓ ${nf0.format(Math.round(r.profile.descent))} m</span>${r.profile.steep.length ? ` · ${r.profile.steep.length} dik bölüm` : ''}${r.profile.tAdj ? ` · eğime göre ~${fmtDur(r.profile.tAdj)}` : ''}</div>` : ''}
        ${i === dir.sel ? `<div class="btns"><button class="btn primary" id="nav-start"><span class="ms">navigation</span>Başlat</button><button class="btn outline" id="steps-toggle"><span class="ms">list</span>${dir.showSteps ? 'Adımları gizle' : 'Adımlar'}</button><button class="btn outline" id="fly-btn" title="Rotayı 3D önizle"><span class="ms">3d_rotation</span>3D önizle</button><button class="btn outline" id="dir-share" aria-label="Paylaş"><span class="ms">share</span></button></div>` : ''}
      </div>
    </div>`).join('');
  const r = dir.routes[dir.sel], pr = r.profile;
  const prof = pr ? `<div class="profile"><div class="prof-head"><div class="section-title" style="padding:0">Yükseklik profili</div><button class="text-btn" id="ana-open"><span class="ms" style="font-size:18px;vertical-align:-4px">insights</span> Ayrıntılı analiz</button></div>${profileStatsHtml(pr)}${profileSvg(pr)}<div class="ptip" id="prof-tip">Grafikte gezdirin: haritada konumu gösterir</div>
    <div class="legend"><span><i style="background:#2563eb"></i>iniş</span><span><i style="background:#22c55e"></i>düz</span><span><i style="background:#facc15"></i>hafif tırmanış</span><span><i style="background:#f97316"></i>dik</span><span><i style="background:#dc2626"></i>çok dik</span></div></div>`
    : (pr === null ? '' : '<div class="loading" style="padding:16px"><div class="spinner"></div>Yükseklik profili hesaplanıyor…</div>');
  const steepHtml = pr && pr.steep.length ? `<div class="section-title" style="padding:10px 24px 2px">Dik bölümler</div><div class="steep-list">${pr.steep.map((s, i) => `<div class="steep" data-k="${i}"><span class="ms" style="color:${slopeColor(s.grade)}">${s.grade > 0 ? 'trending_up' : 'trending_down'}</span><div><b>${fmtDist(s.len)} boyunca ortalama ${fmtSlope(s.grade)} ${s.grade > 0 ? 'tırmanış' : 'iniş'}</b><small>${fmtDist(s.from)} sonra başlar · ${s.dh > 0 ? '+' : ''}${nf0.format(Math.round(s.dh))} m · en dik ${fmtSlope(s.max)}</small></div></div>`).join('')}</div>` : '';
  const dE = v => v == null ? '' : Math.abs(v) < 3 ? '' : ` · <span style="color:${v > 0 ? '#dc2626' : '#2563eb'}">${v > 0 ? '↑' : '↓'} ${nf0.format(Math.round(Math.abs(v)))} m</span>`;
  const steps = dir.showSteps ? `<div class="step-sum">${esc(dir.from.name)} → ${esc(dir.to.name)}</div><ol class="steps">${r.steps.map((s, i) => `<li class="step" data-s="${i}"><span class="ms">${s.icon}</span><div>${esc(s.text)}<div class="sd">${s.distance > 0 ? fmtDist(s.distance) : ''}${dE(s.dElev)}</div></div></li>`).join('')}</ol>` : '';
  const tollHtml = r.tolls && dir.mode === 'car' ? tollSectionHtml(r) : '';
  const altNote = dir.altPending ? '<div class="alt-pending"><span class="spinner sm"></span>Alternatif rotalar aranıyor…</div>' : '';
  return opt + altNote + tollHtml + prof + steepHtml + steps + '<div class="mini-note">Süreler trafik içermez. Yükseklik verisi ~30 m çözünürlüklü arazi modelinden hesaplanır.</div>';
}
function tollSectionHtml(r) {
  const t = r.tolls;
  if (!t.items.length) return `<div class="toll-sec"><div class="toll-h"><span class="ms" style="color:#188038">money_off</span><b>Bu rota ücretsiz</b></div><p class="toll-fine">Rotada ücretli otoyol, köprü veya tünel yok.</p></div>`;
  const icon = k => k === 'köprü' ? 'architecture' : k === 'tünel' ? 'subway' : 'toll';
  return `<div class="toll-sec">
    <div class="toll-h"><span class="ms">toll</span><b>Geçiş ücretleri</b><span class="toll-total">${fmtTL(t.total)}</span></div>
    <ol class="toll-list">${t.items.map(i => `<li><span class="ms">${icon(i.kind)}</span><span class="tl-m"><b>${esc(i.name)}</b><small>${fmtDist(i.at)} sonra${i.km ? ' · ' + nf0.format(Math.round(i.km)) + ' km ücretli yol' : ''}${i.note ? ' · ' + esc(i.note) : ''}</small></span><span class="tl-p">${fmtTL(i.price)}</span></li>`).join('')}</ol>
    <p class="toll-fine">1. sınıf otomobil, KGM ${TOLL_DATE} tarifesi. Ödeme HGS veya OGS ile otomatik alınır; gişelerde nakit kabul edilmez. Ücret, girdiğin ve çıktığın gişeye göre biraz farklı olabilir.</p>
  </div>`;
}
function wireDirResults() {
  const box = $('dir-results'); if (!box) return;
  box.querySelectorAll('.route-opt').forEach(o => { o.onclick = e => { if (!e.target.closest('button')) selectRoute(+o.dataset.i); }; });
  $('nav-start')?.addEventListener('click', startNav);
  $('steps-toggle')?.addEventListener('click', () => { dir.showSteps = !dir.showSteps; refreshDirResults(); if (isMobile() && dir.showSteps) setSheet('full'); });
  $('dir-share')?.addEventListener('click', () => {
    const u = new URL(location.origin + '/');
    if (!dir.from.me) { u.searchParams.set('from', `${dir.from.lat.toFixed(6)},${dir.from.lon.toFixed(6)}`); u.searchParams.set('fn', dir.from.name); }
    u.searchParams.set('to', `${dir.to.lat.toFixed(6)},${dir.to.lon.toFixed(6)}`); u.searchParams.set('tn', dir.to.name); u.searchParams.set('mode', dir.mode);
    share('Yol tarifi: ' + dir.to.name, u.toString());
  });
  $('fly-btn')?.addEventListener('click', () => flyover(dir.routes[dir.sel]));
  $('ana-open')?.addEventListener('click', () => openAnalysis(dir.routes[dir.sel]));
  box.querySelectorAll('.steep').forEach(el => {
    el.onclick = () => {
      const r = dir.routes[dir.sel], s = r.profile.steep[+el.dataset.k];
      const a = profileAt(r.profile, s.from).pt, b = profileAt(r.profile, s.to).pt;
      if (isMobile()) setSheet('min');
      viewSegment(a, b);
    };
  });
  box.querySelectorAll('.step').forEach(s => {
    s.onclick = () => {
      const st = dir.routes[dir.sel].steps[+s.dataset.s];
      if (isMobile()) setSheet('min');
      map.flyTo({ center: st.loc, zoom: 17.5, pitch: 60, bearing: st.bearing ?? map.getBearing(), padding: mapPadding(), duration: 1200 });
    };
  });
}
function refreshDirResults() { const b = $('dir-results'); if (b) { b.innerHTML = dirResultsHtml(); wireDirResults(); const pr = dir.routes[dir.sel]?.profile; if (pr) wireProfile(pr); } }
let routeCtrl = null;
async function resolvePoint(p) { if (p.me) { const ll = await ensureMe(); return { ...p, lat: ll[1], lon: ll[0] }; } return p; }
async function computeRoute({ quiet = false, fromOverride = null } = {}) {
  routeCtrl?.abort(); const ctrl = routeCtrl = new AbortController();
  if (!quiet) { dir.loading = true; dir.error = ''; refreshDirResults(); }
  try {
    const a = fromOverride || await resolvePoint(dir.from), b = await resolvePoint(dir.to);
    if (haversine([a.lon, a.lat], [b.lon, b.lat]) < 5) throw new Error('Başlangıç ve hedef aynı yer.');
    const coords = `${a.lon.toFixed(6)},${a.lat.toFixed(6)};${b.lon.toFixed(6)},${b.lat.toFixed(6)}`;
    // Önce en hızlı rota (hızlı yanıt), alternatifler ardından arka planda
    const res = await fetch('/api/route?' + new URLSearchParams({ mode: dir.mode, alt: '0', coords }), { signal: ctrl.signal });
    if (!res.ok) throw new Error('Rota servisi yanıt vermedi (' + res.status + '). Biraz sonra tekrar deneyin.');
    const d = await res.json();
    if (d.code !== 'Ok' || !d.routes?.length) throw new Error('Bu iki nokta arasında rota bulunamadı.');
    dir.routes = d.routes.map(prepRoute);
    dir.sel = 0; dir.loading = false; dir.error = '';
    drawRoutes(); setRouteMarkers(a, b); loadProfiles();
    if (!quiet) { dir.altPending = true; refreshDirResults(); if (isMobile()) setSheet('peek'); fitRoute(); loadAlternatives(coords, ctrl, a, b); }
    return true;
  } catch (e) {
    if (e.name === 'AbortError') return false;
    dir.loading = false;
    if (!quiet) { dir.routes = []; dir.error = e.message; drawRoutes(); refreshDirResults(); }
    return false;
  }
}
// Bir rota kesitini (a → b) yandan, 3D olarak göster. fitBounds eğik görünümde ve büyük
// kenar boşluklarında güvenilmez sonuç verebildiği için zoom doğrudan mesafeden hesaplanır.
function viewSegment(a, b) {
  if (!a || !b || !map) return;
  if (map._elevationFreeze) map._elevationFreeze = false;
  map.stop();
  const mid = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], len = Math.max(150, haversine(a, b));
  const pad = mapPadding(), usable = Math.max(200, Math.min(innerWidth - pad.left - pad.right, (innerHeight - pad.top - pad.bottom) * 1.6));
  const zoom = Math.max(8, Math.min(16.5, Math.log2(156543.03 * Math.cos(mid[1] * Math.PI / 180) * usable * 0.55 / len)));
  map.flyTo({ center: mid, zoom, pitch: 60, bearing: (bearingOf(a, b) - 90 + 360) % 360, padding: pad, duration: 1400, essential: true });
}
async function loadAlternatives(coords, ctrl, a, b) {
  const mode = dir.mode, first = dir.routes[0];
  try {
    const res = await fetch('/api/route?' + new URLSearchParams({ mode, alt: '1', coords }), { signal: ctrl.signal });
    const d = res.ok ? await res.json() : null;
    // Kullanıcı bu arada rotayı değiştirdiyse, navigasyona başladıysa veya başka rota seçtiyse dokunma
    if (!d?.routes?.length || ctrl !== routeCtrl || dir.mode !== mode || dir.routes[0] !== first || navActive) return;
    if (d.routes.length > 1) {
      const sel = dir.routes[dir.sel];
      dir.routes = d.routes.map(prepRoute);
      dir.sel = 0; drawRoutes(); setRouteMarkers(a, b); loadProfiles();
      if (sel !== first) selectRoute(0);
      toast(`${d.routes.length - 1} alternatif rota bulundu`, 2500);
    }
  } catch (e) { if (e.name === 'AbortError') return; }
  finally { if (ctrl === routeCtrl) { dir.altPending = false; if (!navActive) refreshDirResults(); } }
}
function fitRoute() {
  const r = dir.routes[dir.sel]; if (!r) return;
  const b = new maplibregl.LngLatBounds(); r.coords.forEach(c => b.extend(c));
  map.fitBounds(b, { padding: mapPadding(), pitch: 30, bearing: 0, duration: 1200, maxZoom: 17 });
}
function selectRoute(i) { dir.sel = i; dir.showSteps = false; drawRoutes(); refreshDirResults(); }
function drawRoutes() {
  const src = map?.getSource('a3-routes'), sel = map?.getSource('a3-route-sel'); if (!src || !sel) return;
  const feats = dir.routes.map((r, i) => ({ type: 'Feature', properties: { i, sel: i === dir.sel, mode: dir.mode }, geometry: { type: 'LineString', coordinates: r.coords } })).filter(f => !f.properties.sel);
  src.setData({ type: 'FeatureCollection', features: feats });
  const r = dir.routes[dir.sel];
  sel.setData(r ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: r.coords } } : EMPTY);
  if (r?.profile) map.setPaintProperty('a3-route', 'line-gradient', ['interpolate', ['linear'], ['line-progress'], ...profileGradientStops(r.profile).flat()]);
  else map.setPaintProperty('a3-route', 'line-gradient', ['interpolate', ['linear'], ['line-progress'], 0, '#4285f4', 1, '#4285f4']);
}
async function loadProfiles() {
  const routes = dir.routes;
  await Promise.all(routes.map(async r => { try { r.profile = await buildProfile(r); } catch (e) { console.warn('profil', e); r.profile = null; } }));
  if (dir.routes !== routes) return;
  for (const r of routes) if (r.profile) for (const s of r.steps) { const a = profileAt(r.profile, s.at), b = profileAt(r.profile, Math.min(r.total, s.at + s.distance)); s.dElev = b.elev - a.elev; }
  drawRoutes(); refreshDirResults();
}
function setRouteMarkers(a, b) {
  if (!startMarker) startMarker = new maplibregl.Marker({ element: makeEl('<div class="start-dot"></div>') });
  if (!endMarker) endMarker = new maplibregl.Marker({ element: makeEl(PIN_SVG('#ea4335')), anchor: 'bottom' });
  endMarker.setLngLat([b.lon, b.lat]).addTo(map);
  if (a.me || a.name === 'Konumunuz') startMarker.remove(); else startMarker.setLngLat([a.lon, a.lat]).addTo(map);
}
function clearRoute() {
  routeCtrl?.abort(); dir.routes = []; profMarker?.remove();
  map?.getSource('a3-routes')?.setData(EMPTY); map?.getSource('a3-route-sel')?.setData(EMPTY); startMarker?.remove(); endMarker?.remove();
}

/* ----- Türkçe yönlendirme metinleri ----- */
const MOD = { uturn: ['U dönüşü yapın', 'u_turn_left'], 'sharp right': ['Keskin sağa dönün', 'turn_sharp_right'], right: ['Sağa dönün', 'turn_right'], 'slight right': ['Hafif sağa dönün', 'turn_slight_right'],
  straight: ['Düz devam edin', 'straight'], 'slight left': ['Hafif sola dönün', 'turn_slight_left'], left: ['Sola dönün', 'turn_left'], 'sharp left': ['Keskin sola dönün', 'turn_sharp_left'] };
const COMPASS = ['Kuzey', 'Kuzeydoğu', 'Doğu', 'Güneydoğu', 'Güney', 'Güneybatı', 'Batı', 'Kuzeybatı'];
const isLeft = m => /left/.test(m || '');
function instruction(s) {
  const m = s.maneuver, mod = m.modifier, road = s.name || s.ref || '', on = road ? ` — ${road}` : '';
  const T = MOD[mod] || MOD.straight;
  switch (m.type) {
    case 'depart': return [`${COMPASS[Math.round((m.bearing_after || 0) / 45) % 8]} yönüne ilerleyin${on}`, 'navigation'];
    case 'arrive': return [mod === 'left' ? 'Hedefiniz solda' : mod === 'right' ? 'Hedefiniz sağda' : 'Hedefinize ulaştınız', 'flag'];
    case 'roundabout': case 'rotary': return [`Döner kavşakta ${m.exit ? m.exit + '. çıkıştan ' : ''}çıkın${on}`, isLeft(mod) ? 'roundabout_left' : 'roundabout_right'];
    case 'exit roundabout': case 'exit rotary': return [`Döner kavşaktan çıkın${on}`, 'roundabout_right'];
    case 'merge': return [`Yola katılın${on}`, 'merge'];
    case 'on ramp': return [`${isLeft(mod) ? 'Soldaki' : 'Sağdaki'} bağlantı yoluna girin${on}`, isLeft(mod) ? 'ramp_left' : 'ramp_right'];
    case 'off ramp': return [`${isLeft(mod) ? 'Soldan' : 'Sağdan'} çıkışa girin${s.destinations ? ' — ' + s.destinations : on}`, isLeft(mod) ? 'ramp_left' : 'ramp_right'];
    case 'fork': return [`Yol ayrımında ${isLeft(mod) ? 'solda' : 'sağda'} kalın${on}`, isLeft(mod) ? 'fork_left' : 'fork_right'];
    case 'end of road': return [`Yolun sonunda ${isLeft(mod) ? 'sola' : 'sağa'} dönün${on}`, T[1]];
    case 'new name': case 'continue': case 'notification':
      return mod && mod !== 'straight' ? [T[0] + on, T[1]] : [`Devam edin${on}`, 'straight'];
    default: return [T[0] + on, T[1]];
  }
}
function prepRoute(r) {
  const coords = r.geometry.coordinates;
  const cum = [0]; for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
  const steps = []; let ci = 0;
  // Ara noktalı (üretilmiş alternatif) rotalarda ara noktadaki "varış/kalkış" adımları gösterilmez
  const nl = r.legs.length;
  r.summaryText = [...new Set(r.legs.flatMap(l => (l.summary || '').split(', ')).filter(Boolean))].slice(0, 2).join(', ');
  for (const [li, leg] of r.legs.entries()) for (const s of leg.steps) {
    if ((s.maneuver.type === 'arrive' && li < nl - 1) || (s.maneuver.type === 'depart' && li > 0)) continue;
    const [text, icon] = instruction(s);
    const loc = s.maneuver.location; let best = ci, bd = Infinity;
    for (let j = ci; j < coords.length; j++) { const d = Math.abs(coords[j][0] - loc[0]) + Math.abs(coords[j][1] - loc[1]); if (d < bd) { bd = d; best = j; } if (d < 1e-7) break; }
    ci = best;
    steps.push({ text, icon, name: s.name || '', ref: s.ref || '', distance: s.distance, duration: s.duration, loc, at: cum[best], bearing: s.maneuver.bearing_after, type: s.maneuver.type });
  }
  const out = { ...r, coords, cum, steps, total: cum[cum.length - 1] };
  if (typeof computeTolls === 'function') try { out.tolls = computeTolls(out); } catch (e) { console.warn('ücret', e); }
  return out;
}

/* ================= Navigasyon ================= */
let navAlong = 0, navCamAt = 0, navActive = false, navBearing = null, navRoute = null, navAnnounced = new Set(), navOff = 0, navFollow = true, navMuted = store.get('muted', false), wakeLock = null, navLastIdx = 0, rerouting = false;
async function startNav() {
  if (!dir.routes[dir.sel]) return;
  try { await ensureMe(); } catch (e) { toast(e.message + ' Navigasyon için konum gerekli.', 6000); return; }
  if (haversine(meLngLat, dir.routes[dir.sel].coords[0]) > 300) {
    toast('Rota konumunuzdan başlayacak şekilde yenileniyor…', 2500);
    dir.from = ME; if (!(await computeRoute({ quiet: true }))) { toast('Rota yenilenemedi.'); return; }
    refreshDirResults();
  }
  navRoute = dir.routes[dir.sel]; navActive = true; navAnnounced = new Set(); navOff = 0; navFollow = true; navLastIdx = 0;
  body.classList.add('navigating'); hideCtx(); document.documentElement.style.setProperty('--sheet-h', '0px');
  $('nav-top').hidden = false; $('nav-bottom').hidden = false;
  $('nav-mute-icon').textContent = navMuted ? 'volume_off' : 'volume_up';
  try { wakeLock = await navigator.wakeLock?.request('screen'); } catch {}
  meListeners.add(navTick); navTick(true);
  say(navRoute.steps[0]?.text.replace(' — ', ', ') || 'Navigasyon başladı');
}
function stopNav() {
  if (typeof AN !== 'undefined' && AN.open && AN.nav) closeAnalysis();
  navActive = false; meListeners.delete(navTick);
  body.classList.remove('navigating');
  ['nav-top', 'nav-bottom', 'nav-next', 'nav-terrain'].forEach(id => { $(id).hidden = true; });
  try { wakeLock?.release(); } catch {} wakeLock = null;
  window.speechSynthesis?.cancel(); updateMeMarker(); setSheet(sheetState); fitRoute();
}
$('nav-exit').onclick = stopNav;
$('nav-recenter').onclick = () => { navFollow = true; navTick(true); };
$('nav-mute').onclick = () => { navMuted = !navMuted; store.set('muted', navMuted); $('nav-mute-icon').textContent = navMuted ? 'volume_off' : 'volume_up'; if (navMuted) window.speechSynthesis?.cancel(); };
document.getElementById('map').addEventListener('pointerdown', () => { if (navActive) navFollow = false; });
function say(text) {
  if (navMuted || !window.speechSynthesis) return;
  const u = new SpeechSynthesisUtterance(text); u.lang = 'tr-TR';
  const v = speechSynthesis.getVoices().find(v => /^tr/i.test(v.lang)); if (v) u.voice = v;
  speechSynthesis.cancel(); speechSynthesis.speak(u);
}
function snap(r, p) {
  const c = r.coords, kx = Math.cos(p[1] * Math.PI / 180) * 111320, ky = 110540;
  let best = { d: Infinity, i: 0, t: 0 };
  const scan = (a, b) => { for (let i = a; i < b; i++) {
    const ax = (c[i][0] - p[0]) * kx, ay = (c[i][1] - p[1]) * ky, bx = (c[i + 1][0] - p[0]) * kx, by = (c[i + 1][1] - p[1]) * ky;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy; const t = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
    const d = Math.hypot(ax + t * dx, ay + t * dy);
    if (d < best.d) best = { d, i, t };
  } };
  scan(Math.max(0, navLastIdx - 30), Math.min(c.length - 1, navLastIdx + 500));
  if (best.d > 80) scan(0, c.length - 1);
  navLastIdx = best.i;
  const a = c[best.i], b = c[Math.min(best.i + 1, c.length - 1)];
  return { off: best.d, along: r.cum[best.i] + haversine(a, b) * best.t, pos: [a[0] + (b[0] - a[0]) * best.t, a[1] + (b[1] - a[1]) * best.t], segBearing: bearingOf(a, b) };
}
async function navTick(force) {
  if (!navActive || !meLngLat) return;
  const r = navRoute, s = snap(r, meLngLat);
  navOff = s.off > (dir.mode === 'car' ? 50 : 35) ? navOff + 1 : 0;
  if (navOff >= 3 && !rerouting) {
    rerouting = true; $('nav-text').textContent = 'Rota yeniden hesaplanıyor…'; say('Rota yeniden hesaplanıyor');
    const ok = await computeRoute({ quiet: true, fromOverride: { lat: meLngLat[1], lon: meLngLat[0], name: 'Konumunuz', me: true } });
    rerouting = false; navOff = 0;
    if (ok) { navRoute = dir.routes[0]; dir.sel = 0; navAnnounced = new Set(); navLastIdx = 0; drawRoutes(); }
    return;
  }
  const along = s.along, remaining = Math.max(0, r.total - along); navAlong = along;
  if (typeof analysisTick === 'function') analysisTick(along);
  let nextIdx = r.steps.findIndex((st, i) => i > 0 && st.at > along + 3);
  if (nextIdx < 0) nextIdx = r.steps.length - 1;
  const next = r.steps[nextIdx], toNext = Math.max(0, next.at - along);
  $('nav-icon').textContent = next.icon;
  $('nav-dist').textContent = fmtDist(toNext);
  $('nav-text').textContent = next.text;
  const after = r.steps[nextIdx + 1];
  if (after && after.at - next.at < 150) { $('nav-next').hidden = false; $('nav-next').innerHTML = `Ardından <span class="ms">${after.icon}</span>`; }
  else $('nav-next').hidden = true;
  const remTime = r.duration * (remaining / Math.max(1, r.total));
  if (r.profile && typeof navTerrainHtml === 'function') {
    $('nav-terrain').hidden = false;
    $('nav-terrain').innerHTML = navTerrainHtml(r, along);
  }
  if (r.profile) for (const [k, st] of r.profile.steep.entries()) {
    const ahead = st.from - along, key = 'steep:' + k, warnAt = dir.mode === 'car' ? 500 : 150;
    if (ahead > 0 && ahead <= warnAt && !navAnnounced.has(key)) {
      navAnnounced.add(key);
      const pct = 'yüzde ' + Math.round(Math.abs(st.grade)), L = fmtDist(st.len).replace(/ m$/, ' metre').replace(/ km$/, ' kilometre');
      toast(`Dikkat: ${fmtDist(ahead)} sonra ${fmtDist(st.len)} boyunca ${fmtSlope(st.grade)} ${st.grade > 0 ? 'tırmanış' : 'iniş'}`, 6000);
      setTimeout(() => say(`Dikkat, ${st.grade > 0 ? 'dik yokuş' : 'dik iniş'}. ${L} boyunca ${pct} eğim.`), 2500);
    }
  }
  if (r.tolls && dir.mode === 'car') for (const [k, it] of r.tolls.items.entries()) {
    const ahead = it.at - along, key = 'toll:' + k;
    if (ahead > 0 && ahead <= 1500 && !navAnnounced.has(key)) {
      navAnnounced.add(key);
      toast(`${fmtDist(ahead)} sonra ücretli: ${it.name} · ${fmtTL(it.price)}`, 6000);
      setTimeout(() => say(`${fmtDist(ahead).replace(/ m$/, ' metre').replace(/ km$/, ' kilometre')} sonra ücretli ${it.kind === 'otoyol' ? 'otoyol' : it.kind}: ${it.name.replace(/\s*\(.*?\)/g, '')}. Yaklaşık ${Math.round(it.price)} lira.`), 4000);
    }
  }
  $('nav-time').textContent = fmtDur(remTime);
  $('nav-rest').textContent = `${fmtDist(remaining)} · ${fmtClock(new Date(Date.now() + remTime * 1000))}`;
  const th = dir.mode === 'car' ? [700, 200, 35] : [120, 25];
  th.forEach((d, k) => {
    const key = nextIdx + ':' + k;
    if (toNext <= d && !navAnnounced.has(key) && (k === th.length - 1 || toNext > th[k + 1])) {
      navAnnounced.add(key);
      const txt = next.text.replace(' — ', ', ');
      say(k === th.length - 1 ? 'Şimdi, ' + txt : `${fmtDist(toNext).replace(/ m$/, ' metre').replace(/ km$/, ' kilometre')} sonra, ${txt}`);
    }
  });
  if (remaining < 25) { say('Hedefinize ulaştınız'); toast('Hedefinize ulaştınız' + (dir.to?.name ? ': ' + dir.to.name : ''), 5000); stopNav(); return; }
  navBearing = meHeading ?? s.segBearing;
  updateMeMarker();
  // Kamera: üst üste binen animasyonlar arazi yüksekliğini dondurmasın (sık GPS güncellemesi, özellikle iPhone)
  const now = performance.now();
  if (navFollow && (force === true || now - navCamAt > 700)) {
    navCamAt = now + (force === true ? 300 : 0);
    if (map._elevationFreeze && map.terrain) map._elevationFreeze = false; // yarıda kalan animasyondan kalan donmayı çöz
    map.easeTo({ center: s.off < 30 ? s.pos : meLngLat, bearing: navBearing, pitch: 62,
    zoom: dir.mode === 'car' ? ((meSpeed ?? 0) > 20 ? 16.3 : 17.2) : 18,
    padding: { top: innerHeight * 0.4, bottom: 90, left: 20, right: 20 }, duration: force === true ? 900 : 600, easing: t => t });
  }
  if (force === true) setTimeout(() => { if (map._elevationFreeze && !map.isMoving()) { map._elevationFreeze = false; map.once('render', refreshMarkers); map.triggerRepaint(); } }, 1200);
}

/* ================= Arazi göstergesi (merkez / imleç) ================= */
let hudSeq = 0;
async function updateHud(lngLat, label) {
  const seq = ++hudSeq;
  try {
    const { elev, slope, aspect } = await DEM.slopeAt(lngLat[0], lngLat[1], map.getZoom() > 11 ? 13 : 11);
    if (seq !== hudSeq || elev == null) return;
    const dirName = aspect == null ? '' : COMPASS[Math.round(aspect / 45) % 8];
    setHud({ source: label === 'İmleç' ? 'cursor' : 'center', elev, terrain: slope, aspect,
      sub: slope == null ? '' : slope < 3 ? 'Düz arazi' : `Yamaç ${dirName.toLowerCase()} yönüne doğru yükseliyor` });
  } catch {}
}
const hudCenter = debounce(() => { if (!map || navActive || Date.now() < (typeof gpsHudUntil === 'number' ? gpsHudUntil : 0)) return; const c = map.getCenter(); updateHud([c.lng, c.lat], 'Merkez'); }, 250);
const hudCursor = debounce(e => { if (navActive) return; updateHud([e.lngLat.lng, e.lngLat.lat], 'İmleç'); }, 120);

/* ================= Mesafe ölçme ================= */
let measuring = false, measurePts = [];
function startMeasure() {
  closeDrawer(); if (measuring) endMeasure();
  measuring = true; measurePts = []; $('measure-bar').hidden = false; updateMeasure();
}
function addMeasurePoint(ll) {
  measurePts.push(ll);
  const idx = measurePts.length - 1;
  const m = new maplibregl.Marker({ element: makeEl('<div class="measure-dot"></div>'), draggable: true }).setLngLat(ll).addTo(map);
  m.on('drag', () => { const p = m.getLngLat(); measurePts[idx] = [p.lng, p.lat]; updateMeasure(); });
  measureMarkers.push(m); updateMeasure();
}
function updateMeasure() {
  let d = 0; for (let i = 1; i < measurePts.length; i++) d += haversine(measurePts[i - 1], measurePts[i]);
  $('measure-text').textContent = measurePts.length < 2 ? 'Haritaya dokunarak noktalar ekleyin' : 'Toplam: ' + fmtDist(d);
  map?.getSource('a3-measure')?.setData(measurePts.length > 1 ? { type: 'Feature', properties: {}, geometry: { type: 'LineString', coordinates: measurePts } } : EMPTY);
}
function endMeasure() {
  measuring = false; $('measure-bar').hidden = true; measureMarkers.forEach(m => m.remove()); measureMarkers = []; measurePts = [];
  map?.getSource('a3-measure')?.setData(EMPTY); if (map) map.getCanvas().style.cursor = '';
}
$('measure-end').onclick = endMeasure;
$('measure-undo').onclick = () => { measurePts.pop(); measureMarkers.pop()?.remove(); updateMeasure(); };

/* ================= Menü çekmecesi ================= */
function openDrawer() { $('drawer').hidden = false; $('drawer-bg').hidden = false; }
function closeDrawer() { $('drawer').hidden = true; $('drawer-bg').hidden = true; }
$('menu-btn').onclick = openDrawer; $('drawer-close').onclick = closeDrawer; $('drawer-bg').onclick = closeDrawer;
$('drawer').onclick = e => {
  const a = e.target.closest('[data-act]')?.dataset.act; if (!a) return; closeDrawer();
  if (a === 'saved') showList('Kaydedilenler', saved(), { fit: true, sub: 'bu cihazda saklanır' });
  if (a === 'recent') showList('Son aramalar', recent(), { fit: true });
  if (a === 'measure') startMeasure();
  if (a === 'mylocation') locateMe();
  if (a === 'install') installApp();
  if (a === 'share') share('ATLAS3D Haritalar', location.href);
  if (a === 'about') openPanel(el => { el.innerHTML = `<div class="list-head drag-zone"><h2>Veri kaynakları</h2><small>Tüm servisler anahtarsız ve ücretsizdir</small></div>
    <div class="info">
      <div class="info-row"><span class="ms">map</span><span>Harita ve 3D binalar: OpenFreeMap · © OpenMapTiles · © OpenStreetMap katkıda bulunanlar</span></div>
      <div class="info-row"><span class="ms">satellite_alt</span><span>Uydu: Esri, Maxar, Earthstar Geographics</span></div>
      <div class="info-row"><span class="ms">landscape</span><span>3D arazi: AWS Terrain Tiles (Mapzen)</span></div>
      <div class="info-row"><span class="ms">search</span><span>Arama: Photon (Komoot) ve Nominatim</span></div>
      <div class="info-row"><span class="ms">directions</span><span>Yol tarifi: OSRM · routing.openstreetmap.de (FOSSGIS)</span></div>
      <div class="info-row"><span class="ms">info</span><span>Canlı trafik, işletme yorumları/fotoğrafları ve sokak görünümü bu açık kaynaklarda bulunmaz.</span></div>
    </div>`; }, { mode: 'list' });
};

/* ================= URL parametreleri ================= */
function parseLL(s) { const m = (s || '').split(',').map(Number); return m.length === 2 && m.every(Number.isFinite) ? { lat: m[0], lon: m[1] } : null; }
function handleUrlParams() {
  const u = new URLSearchParams(location.search);
  const p = parseLL(u.get('p')), to = parseLL(u.get('to')), from = parseLL(u.get('from'));
  // Ana ekran kısayolları
  if (u.get('action') === 'directions') openDirections({});
  if (u.get('action') === 'locate') locateMe();
  if (to) {
    if (MODES[u.get('mode')]) dir.mode = u.get('mode');
    openDirections({ to: { ...to, name: u.get('tn') || 'Hedef' }, from: from ? { ...from, name: u.get('fn') || 'Başlangıç' } : ME });
  } else if (p) {
    showPlace({ ...p, name: u.get('n') || 'Paylaşılan konum', icon: 'location_on', needsReverse: true, keepName: !!u.get('n') }, { fly: !location.hash });
  }
  if (location.search) history.replaceState(null, '', location.pathname + location.hash);
}

/* ================= İsteğe bağlı: Google Photorealistic 3D (GOOGLE_MAPS_API_KEY tanımlıysa) ================= */
let gViewer = null;
function addGoogleBasemap() { BASEMAPS.google = { label: 'Google 3D', thumb: BASEMAPS.satellite.thumb }; renderLayerPop(); applyBasemap(); }
function loadScript(src) { return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = fail; document.head.appendChild(s); }); }
async function openGoogle3D() {
  let box = $('g3d');
  if (!box) {
    box = makeEl('<div id="g3d" style="position:fixed;inset:0;z-index:28;background:#000"><button class="ctrl" id="g3d-close" style="position:absolute;z-index:2;top:calc(12px + var(--safe-t));right:12px" aria-label="Kapat"><span class="ms">close</span></button><div id="g3d-view" style="position:absolute;inset:0"></div></div>');
    document.body.appendChild(box); $('g3d-close').onclick = () => { box.hidden = true; };
  }
  box.hidden = false;
  try {
    if (!window.Cesium) {
      toast('Google 3D yükleniyor…', 4000);
      const base = 'https://cesium.com/downloads/cesiumjs/releases/1.131/Build/Cesium/';
      const l = document.createElement('link'); l.rel = 'stylesheet'; l.href = base + 'Widgets/widgets.css'; document.head.appendChild(l);
      await loadScript(base + 'Cesium.js');
    }
    if (!gViewer) {
      gViewer = new Cesium.Viewer('g3d-view', { globe: false, baseLayer: false, animation: false, timeline: false, geocoder: false, homeButton: false, sceneModePicker: false, navigationHelpButton: false, infoBox: false, selectionIndicator: false, fullscreenButton: false, baseLayerPicker: false });
      gViewer.scene.primitives.add(await Cesium.createGooglePhotorealistic3DTileset({ key: cfg.googleTilesKey }, { showCreditsOnScreen: true }));
    }
    const c = map.getCenter();
    gViewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(c.lng, c.lat, 1200), orientation: { heading: Cesium.Math.toRadians(map.getBearing()), pitch: Cesium.Math.toRadians(-40), roll: 0 }, duration: 1.2 });
  } catch (e) { box.hidden = true; toast('Google 3D açılamadı: ' + (e.message || e), 6000); }
}

/* ================= Telefona uygulama olarak kurulum (PWA) ================= */
let installEvt = null;
const isStandalone = () => matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;
const isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
if ('serviceWorker' in navigator && isSecureContext) {
  addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(e => console.warn('Service worker:', e)));
}
addEventListener('beforeinstallprompt', e => {
  e.preventDefault(); installEvt = e; $('install-item').hidden = false;
  if (isMobile() && !store.get('installHint', false)) { store.set('installHint', true); setTimeout(() => toast('İpucu: menüden ATLAS3D\'yi uygulama olarak yükleyebilirsin', 5000), 4000); }
});
addEventListener('appinstalled', () => { installEvt = null; $('install-item').hidden = true; toast('ATLAS3D ana ekrana eklendi'); });
if (!isStandalone() && (isIOS || isMobile())) $('install-item').hidden = false;
async function installApp() {
  if (installEvt) {
    installEvt.prompt();
    const { outcome } = await installEvt.userChoice;
    installEvt = null; $('install-item').hidden = outcome === 'accepted';
    return;
  }
  openPanel(el => {
    el.innerHTML = `<div class="list-head drag-zone"><h2>Ana ekrana ekle</h2><small>ATLAS3D tarayıcı çubuğu olmadan, uygulama gibi tam ekran açılır</small></div>
      <div class="info">${isIOS ? `
        <div class="info-row"><span class="ms">ios_share</span><span><b>1.</b> Safari'de alttaki <b>Paylaş</b> düğmesine dokun.</span></div>
        <div class="info-row"><span class="ms">add_box</span><span><b>2.</b> Listeden <b>Ana Ekrana Ekle</b>'yi seç.</span></div>
        <div class="info-row"><span class="ms">install_mobile</span><span><b>3.</b> Sağ üstte <b>Ekle</b>'ye dokun. Simge ana ekranında belirir.</span></div>` : `
        <div class="info-row"><span class="ms">menu</span><span><b>1.</b> Tarayıcının menüsünü (⋮) aç.</span></div>
        <div class="info-row"><span class="ms">install_mobile</span><span><b>2.</b> <b>Uygulamayı yükle</b> ya da <b>Ana ekrana ekle</b>'yi seç.</span></div>`}
      </div>
      <div class="mini-note">${isIOS ? 'iPhone ve iPad\'de Safari ile ekle. ' : ''}Kurulumdan sonra uygulamayı ana ekrandaki ATLAS3D simgesinden aç.</div>`;
  }, { mode: 'list' });
}
