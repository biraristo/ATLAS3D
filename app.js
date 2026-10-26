// ATLAS3D — anahtarsız (API key gerektirmeyen) açık harita altyapısı ile 3D arazi haritası.
// Varsayılan kaynaklar: MapLibre GL JS, Esri World Imagery, OpenTopoMap, CARTO, AWS Terrain Tiles (Terrarium), Nominatim.
// İsteğe bağlı: Cloudflare ortam değişkenlerinde MAPTILER_API_KEY / GOOGLE_MAPS_API_KEY varsa ek katmanlar görünür.
'use strict';
const $ = id => document.getElementById(id);
const BOLU = [31.6, 40.745];
const VIEW = { pitch: 70, bearing: -32 };
let watchId = null, following = false, lastPosition = null, marker = null, noticeTimer = null;

function notify(text, delay = 4500) {
  const n = $('notice');
  n.textContent = text; n.hidden = false;
  clearTimeout(noticeTimer);
  if (delay) noticeTimer = setTimeout(() => { n.hidden = true; }, delay);
}

if (!window.maplibregl) {
  notify('Harita kütüphanesi yüklenemedi. İnternet bağlantınızı kontrol edip sayfayı yenileyin.', 0);
  throw new Error('maplibre-gl missing');
}

const ESRI = 'https://server.arcgisonline.com/ArcGIS/rest/services';
const raster = (tiles, attribution, extra = {}) => ({ type: 'raster', tiles, tileSize: 256, attribution, ...extra });

const style = {
  version: 8,
  sources: {
    satellite: raster([`${ESRI}/World_Imagery/MapServer/tile/{z}/{y}/{x}`],
      'Uydu © Esri, Maxar, Earthstar Geographics', { maxzoom: 19 }),
    hillshadeDem: {
      type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 15,
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png']
    },
    labels: raster([`${ESRI}/Reference/World_Boundaries_and_Places/MapServer/tile/{z}/{y}/{x}`], '', { maxzoom: 19 }),
    roads: raster([`${ESRI}/Reference/World_Transportation/MapServer/tile/{z}/{y}/{x}`], '', { maxzoom: 19 }),
    topo: raster(['https://a.tile.opentopomap.org/{z}/{x}/{y}.png', 'https://b.tile.opentopomap.org/{z}/{x}/{y}.png', 'https://c.tile.opentopomap.org/{z}/{x}/{y}.png'],
      'Harita © <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA), © <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>', { maxzoom: 17 }),
    street: raster([`${ESRI}/World_Street_Map/MapServer/tile/{z}/{y}/{x}`],
      'Sokak haritası © Esri, HERE, Garmin, © OpenStreetMap katkıda bulunanlar', { maxzoom: 19 }),
    dem: {
      type: 'raster-dem', encoding: 'terrarium', tileSize: 256, maxzoom: 15,
      tiles: ['https://s3.amazonaws.com/elevation-tiles-prod/terrarium/{z}/{x}/{y}.png'],
      attribution: 'Yükseklik: <a href="https://registry.opendata.aws/terrain-tiles/">AWS Terrain Tiles</a>'
    }
  },
  layers: [
    { id: 'bg', type: 'background', paint: { 'background-color': '#0d1620' } },
    { id: 'satellite', type: 'raster', source: 'satellite', layout: { visibility: 'none' } },
    { id: 'topo', type: 'raster', source: 'topo', layout: { visibility: 'none' } },
    { id: 'street', type: 'raster', source: 'street', layout: { visibility: 'none' } },
    { id: 'hillshade', type: 'hillshade', source: 'hillshadeDem', layout: { visibility: 'none' },
      paint: { 'hillshade-exaggeration': 0.35, 'hillshade-shadow-color': '#1b2633' } },
    { id: 'roads', type: 'raster', source: 'roads', layout: { visibility: 'none' } },
    { id: 'labels', type: 'raster', source: 'labels', layout: { visibility: 'none' } }
  ],
  sky: {
    'sky-color': '#7fb4e6', 'horizon-color': '#cfe3f5', 'fog-color': '#dfeaf3',
    'sky-horizon-blend': 0.6, 'horizon-fog-blend': 0.5, 'fog-ground-blend': 0.6, 'atmosphere-blend': 0.8
  }
};

// Katman tanımları: hangi stil katmanları görünür olacak
const LAYERS = {
  satellite: ['satellite'],
  hybrid: ['satellite', 'roads', 'labels'],
  topo: ['topo', 'hillshade'],
  street: ['street', 'hillshade']
};
const ALL_LAYER_IDS = ['satellite', 'topo', 'street', 'hillshade', 'roads', 'labels'];

const map = new maplibregl.Map({
  container: 'map', style, center: BOLU, zoom: 11.6, ...VIEW,
  maxPitch: 85, attributionControl: { compact: true }
});
map.addControl(new maplibregl.NavigationControl({ showCompass: true, visualizePitch: true }), 'top-left');
map.addControl(new maplibregl.ScaleControl({ unit: 'metric' }), 'bottom-right');

let terrainOn = true;
function applyTerrain() {
  map.setTerrain(terrainOn ? { source: 'dem', exaggeration: 1.3 } : null);
  $('terrain').classList.toggle('active', terrainOn);
}

let activeLayer = localStorage.getItem('atlas3d_layer') || 'hybrid';
function setLayer(id) {
  if (id === 'google') { enableGoogle3D(); return; }
  if (id === 'maptiler') { enableMaptiler(); return; }
  disableGoogle3D();
  const visible = LAYERS[id] || LAYERS.hybrid;
  for (const l of [...ALL_LAYER_IDS, 'maptiler']) {
    if (map.getLayer(l)) map.setLayoutProperty(l, 'visibility', visible.includes(l) ? 'visible' : 'none');
  }
  activeLayer = id; $('layer').value = id;
  try { localStorage.setItem('atlas3d_layer', id); } catch {}
}

map.on('load', () => {
  applyTerrain();
  setLayer(LAYERS[activeLayer] ? activeLayer : 'hybrid');
  notify('3D arazi hazır.', 2500);
  updateTerrain();
});

let lastErr = 0;
map.on('error', e => {
  console.error('Harita:', e.error);
  if (Date.now() - lastErr < 8000) return; // tek bir eksik karo yüzünden bildirim yağmuru olmasın
  lastErr = Date.now();
  const msg = String(e.error?.message || '');
  if (/429/.test(msg)) notify('Karo sunucusu istekleri sınırladı, birazdan tekrar deneyin.', 6000);
});

function updateTerrain() {
  const c = following && lastPosition ? lastPosition : [map.getCenter().lng, map.getCenter().lat];
  let h = null;
  try { h = map.terrain ? map.queryTerrainElevation(c) / (map.terrain.exaggeration || 1) : null; } catch {}
  $('altitude').textContent = Number.isFinite(h) ? Math.round(h) + ' m' : (terrainOn ? '—' : '3D kapalı');
  $('coords').textContent = c[1].toFixed(4) + ', ' + c[0].toFixed(4);
}
map.on('moveend', updateTerrain);
map.on('idle', updateTerrain);

$('layer').onchange = e => setLayer(e.target.value);
$('terrain').onclick = () => { terrainOn = !terrainOn; applyTerrain(); if (!terrainOn) map.easeTo({ pitch: 0, duration: 600 }); else map.easeTo({ ...VIEW, duration: 800 }); updateTerrain(); };
$('reset').onclick = () => { if (!terrainOn) { terrainOn = true; applyTerrain(); } map.easeTo({ ...VIEW, duration: 800 }); };
$('bolu').onclick = () => { setFollowing(false); $('status').textContent = 'Bolu Dağı'; map.flyTo({ center: BOLU, zoom: 11.6, ...VIEW, duration: 1800 }); };

// ---------- GPS ----------
function setFollowing(v) {
  following = v; $('follow').classList.toggle('active', v);
  if (v && lastPosition) map.easeTo({ center: lastPosition, zoom: 15, pitch: VIEW.pitch, duration: 1000 });
}
$('follow').onclick = () => watchId === null ? startLocation(true) : setFollowing(!following);
$('locate').onclick = () => startLocation(true);

function startLocation(follow) {
  if (!navigator.geolocation) { notify('Bu cihazda konum servisi bulunamadı.', 0); return; }
  if (!window.isSecureContext) { notify('GPS için HTTPS gerekli.', 0); return; }
  if (watchId !== null) { setFollowing(follow); return; }
  setFollowing(follow);
  $('gps').textContent = 'GPS aranıyor';
  watchId = navigator.geolocation.watchPosition(pos => {
    const { latitude, longitude, accuracy, heading } = pos.coords;
    lastPosition = [longitude, latitude];
    $('gps').textContent = 'GPS ±' + Math.round(accuracy) + ' m';
    $('status').textContent = 'Canlı konum';
    if (!marker) marker = new maplibregl.Marker({ color: '#45b6ff' }).setLngLat(lastPosition).addTo(map);
    else marker.setLngLat(lastPosition);
    if (following) map.easeTo({ center: lastPosition, zoom: Math.max(map.getZoom(), 14.5), pitch: VIEW.pitch,
      ...(Number.isFinite(heading) ? { bearing: heading } : {}), duration: 700 });
    updateTerrain();
  }, err => {
    $('gps').textContent = 'GPS kullanılamıyor';
    notify('Konum alınamadı: ' + err.message, 6000);
    if (watchId !== null) navigator.geolocation.clearWatch(watchId);
    watchId = null; setFollowing(false);
  }, { enableHighAccuracy: true, maximumAge: 2000, timeout: 15000 });
}

// ---------- Yer arama (Nominatim, anahtarsız; Worker üzerinden /api/search) ----------
let lastSearch = 0;
$('search').onsubmit = async e => {
  e.preventDefault();
  const q = $('q').value.trim(); const list = $('results');
  if (!q) return;
  if (Date.now() - lastSearch < 1100) return;
  lastSearch = Date.now();
  list.hidden = false; list.innerHTML = '<li>Aranıyor…</li>';
  try {
    const res = await fetch('/api/search?q=' + encodeURIComponent(q));
    if (!res.ok) throw new Error('HTTP ' + res.status);
    const items = await res.json();
    list.innerHTML = '';
    if (!items.length) { list.innerHTML = '<li>Sonuç bulunamadı</li>'; return; }
    for (const it of items) {
      const li = document.createElement('li'); li.tabIndex = 0; li.textContent = it.display_name;
      const go = () => {
        list.hidden = true; setFollowing(false);
        $('status').textContent = it.name || it.display_name.split(',')[0];
        const bb = it.boundingbox?.map(Number);
        if (bb && bb.every(Number.isFinite) && (bb[1] - bb[0]) > 0.002) {
          map.fitBounds([[bb[2], bb[0]], [bb[3], bb[1]]], { padding: 60, maxZoom: 13.5, pitch: 60, bearing: map.getBearing(), duration: 1800 });
        } else map.flyTo({ center: [+it.lon, +it.lat], zoom: 15, pitch: VIEW.pitch, duration: 1800 });
      };
      li.onclick = go; li.onkeydown = ev => { if (ev.key === 'Enter') go(); };
      list.appendChild(li);
    }
  } catch (err) {
    list.innerHTML = '<li>Arama yapılamadı: ' + String(err.message).slice(0, 80) + '</li>';
  }
};
document.addEventListener('click', e => { if (!$('search').contains(e.target)) $('results').hidden = true; });

// ---------- İsteğe bağlı anahtarlı katmanlar (Cloudflare ortam değişkenleri) ----------
let cfg = { maptilerKey: '', googleTilesKey: '' };
fetch('/api/config', { cache: 'no-store' }).then(r => r.ok ? r.json() : null).then(d => {
  if (!d) return; cfg = d;
  const sel = $('layer');
  if (cfg.maptilerKey) sel.add(new Option('MapTiler Uydu', 'maptiler'));
  if (cfg.googleTilesKey) sel.add(new Option('Google 3D', 'google'));
}).catch(() => {});

function enableMaptiler() {
  if (!cfg.maptilerKey) return;
  if (!map.getSource('maptiler')) {
    map.addSource('maptiler', { type: 'raster', tileSize: 256, maxzoom: 20,
      url: 'https://api.maptiler.com/tiles/satellite-v2/tiles.json?key=' + encodeURIComponent(cfg.maptilerKey) });
    map.addLayer({ id: 'maptiler', type: 'raster', source: 'maptiler' }, 'hillshade');
  }
  disableGoogle3D();
  for (const l of ALL_LAYER_IDS) map.setLayoutProperty(l, 'visibility', ['roads', 'labels'].includes(l) ? 'visible' : 'none');
  map.setLayoutProperty('maptiler', 'visibility', 'visible');
  activeLayer = 'maptiler';
}

let googleViewer = null;
function loadScript(src) {
  return new Promise((ok, fail) => { const s = document.createElement('script'); s.src = src; s.onload = ok; s.onerror = fail; document.head.appendChild(s); });
}
async function enableGoogle3D() {
  if (!cfg.googleTilesKey) return;
  const prev = activeLayer;
  try {
    if (!window.Cesium) {
      notify('Google 3D yükleniyor…', 0);
      const base = 'https://cesium.com/downloads/cesiumjs/releases/1.131/Build/Cesium/';
      const link = document.createElement('link'); link.rel = 'stylesheet'; link.href = base + 'Widgets/widgets.css'; document.head.appendChild(link);
      await loadScript(base + 'Cesium.js');
    }
    const box = $('google-3d'); box.hidden = false; document.body.classList.add('google-mode');
    if (!googleViewer) {
      googleViewer = new Cesium.Viewer(box, { globe: false, baseLayer: false, animation: false, timeline: false, geocoder: false,
        homeButton: false, sceneModePicker: false, navigationHelpButton: false, infoBox: false, selectionIndicator: false,
        fullscreenButton: false, baseLayerPicker: false });
      googleViewer.scene.skyAtmosphere.show = true;
      const ts = await Cesium.createGooglePhotorealistic3DTileset({ key: cfg.googleTilesKey }, { showCreditsOnScreen: true });
      googleViewer.scene.primitives.add(ts);
    }
    const c = map.getCenter();
    googleViewer.camera.flyTo({ destination: Cesium.Cartesian3.fromDegrees(c.lng, c.lat, 4200),
      orientation: { heading: Cesium.Math.toRadians(map.getBearing()), pitch: Cesium.Math.toRadians(-45), roll: 0 }, duration: 1.5 });
    notify('Google Photorealistic 3D açıldı.', 3000);
  } catch (e) {
    console.error('Google 3D:', e); disableGoogle3D();
    notify('Google 3D yüklenemedi: ' + String(e.message || e).slice(0, 120), 8000);
    $('layer').value = prev;
  }
}
function disableGoogle3D() {
  $('google-3d').hidden = true; document.body.classList.remove('google-mode');
  if (map.getLayer('maptiler')) map.setLayoutProperty('maptiler', 'visibility', 'none');
}
