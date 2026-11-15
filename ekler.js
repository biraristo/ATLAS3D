// ATLAS3D — isteğe bağlı bağlantılar. Her biri yalnızca Cloudflare'de anahtarı tanımlıysa görünür (cfg bayrakları):
//   MapTiler (MAPTILER_KEY)        "Açık hava" topoğrafik altlık
//   Mapillary (MAPILLARY_TOKEN)    sokak fotoğrafı kapsaması; noktaya dokununca fotoğraf
//   Open Charge Map (OCM_KEY)      şarj istasyonları katmanı; elektrikli araçta "yakındaki şarj istasyonları" da buradan gelir
'use strict';

const EK = { mly: false, ocm: false, ocmSeen: new Set(), ocmById: new Map(), mlyMarker: null };
const ekReady = fn => (function wait() { if (map?.getLayer?.('a3-sat')) fn(); else setTimeout(wait, 300); })();

cfgReady.then(c => {
  if (c.maptiler) {
    BASEMAPS.outdoor = { label: 'Açık hava', thumb: '/api/mt/outdoor/11/1196/767' }; BM_ICON.outdoor = 'hiking';
    if (typeof renderLayerPop === 'function') renderLayerPop();
    ekReady(() => {
      map.addSource('a3-mt', { type: 'raster', tiles: [`/api/mt/outdoor/{z}/{x}/{y}${HIDPI ? '?r=2' : ''}`], tileSize: 512, maxzoom: 19, attribution: '© MapTiler © OpenStreetMap katkıda bulunanlar' });
      map.addLayer({ id: 'a3-mt', type: 'raster', source: 'a3-mt', layout: { visibility: 'none' } }, 'a3-sat');
      OWN.add('a3-mt'); applyBasemap();
    });
  }
  if (c.mapillary) {
    $('opt-mly-row').hidden = false;
    $('opt-mly').onchange = e => setMly(e.target.checked);
    ekReady(() => { if (store.get('mly', false)) { $('opt-mly').checked = true; setMly(true); } });
  }
  if (c.ocm) {
    $('opt-ocm-row').hidden = false;
    $('opt-ocm').onchange = e => setOcm(e.target.checked);
    ekReady(() => { map.on('moveend', debounce(ocmLoad, 400)); if (store.get('ocmLayer', false)) { $('opt-ocm').checked = true; setOcm(true); } });
  }
});

/* ================= Mapillary ================= */
function setMly(on) {
  EK.mly = on; store.set('mly', on);
  if (on && !map.getSource('a3-mly')) {
    map.addSource('a3-mly', { type: 'vector', tiles: [location.origin + '/api/mly/tiles/{z}/{x}/{y}'], minzoom: 6, maxzoom: 14 });
    const before = map.getStyle().layers.find(l => l.type === 'symbol')?.id;
    map.addLayer({ id: 'a3-mly-seq', type: 'line', source: 'a3-mly', 'source-layer': 'sequence', minzoom: 6, layout: { 'line-cap': 'round', 'line-join': 'round' },
      paint: { 'line-color': '#05cb63', 'line-opacity': 0.75, 'line-width': ['interpolate', ['linear'], ['zoom'], 8, 1, 16, 3] } }, before);
    map.addLayer({ id: 'a3-mly-img', type: 'circle', source: 'a3-mly', 'source-layer': 'image', minzoom: 14,
      paint: { 'circle-color': '#05cb63', 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.2, 'circle-radius': ['interpolate', ['linear'], ['zoom'], 14, 3, 18, 7] } });
    ['a3-mly-seq', 'a3-mly-img'].forEach(id => OWN.add(id));
  }
  for (const id of ['a3-mly-seq', 'a3-mly-img']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  if (!on) { EK.mlyMarker?.remove(); EK.mlyMarker = null; }
  else if (map.getZoom() < 14) toast('Yeşil çizgiler fotoğraf çekilen yolları gösterir; yaklaşıp bir noktaya dokunun', 4500);
}
async function showMly(id) {
  openPanel(el => { el.innerHTML = '<div class="loading"><div class="spinner"></div>Fotoğraf yükleniyor…</div>'; }, { mode: 'list' });
  try {
    const d = await api('/api/mly/image', { id });
    if (!d.url) throw new Error('Fotoğraf bulunamadı');
    const when = d.at ? new Date(d.at).toLocaleDateString('tr-TR', { year: 'numeric', month: 'long', day: 'numeric' }) : '';
    openPanel(el => {
      el.innerHTML = `<div class="list-head drag-zone"><h2>Sokak fotoğrafı</h2><small>${esc([when, d.by ? '© ' + d.by : ''].filter(Boolean).join(' · '))} · Mapillary</small></div>
        <div class="info"><img class="mly-photo" src="${esc(d.url)}" alt="Sokak fotoğrafı" referrerpolicy="no-referrer">
        <div class="ek-btns"><a class="pri" href="https://www.mapillary.com/app/?pKey=${encodeURIComponent(d.id)}&focus=photo" target="_blank" rel="noopener"><span class="ms">open_in_new</span>Mapillary'de gez${d.pano ? ' (360°)' : ''}</a></div></div>`;
    }, { mode: 'list' });
    if (Number.isFinite(d.lon) && Number.isFinite(d.lat)) {
      EK.mlyMarker ??= new maplibregl.Marker({ element: makeEl('<div class="prof-dot"></div>') });
      EK.mlyMarker.setLngLat([d.lon, d.lat]).addTo(map);
    }
  } catch (err) {
    openPanel(el => { el.innerHTML = `<div class="empty">Fotoğraf alınamadı.<br><small>${esc(err.message)}</small></div>`; }, { mode: 'list' });
  }
}

/* ================= Open Charge Map ================= */
const ocmKw = st => Math.max(0, ...st.conns.map(c => c.kw || 0));
const ocmSummary = st => {
  const kw = ocmKw(st), types = [...new Set(st.conns.map(c => c.t.replace(/ \(.*\)$/, '')))].slice(0, 3).join(', ');
  return [kw ? nf0.format(Math.round(kw)) + ' kW' : '', types].filter(Boolean).join(' · ');
};
function setOcm(on) {
  EK.ocm = on; store.set('ocmLayer', on);
  if (on && !map.getSource('a3-ocm')) {
    map.addSource('a3-ocm', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'a3-ocm', type: 'circle', source: 'a3-ocm',
      paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 7, 3.5, 14, 8], 'circle-stroke-color': '#fff', 'circle-stroke-width': 1.5,
        'circle-color': ['step', ['get', 'kw'], '#16a34a', 22, '#2563eb', 100, '#7c3aed'] } });
    map.addLayer({ id: 'a3-ocm-label', type: 'symbol', source: 'a3-ocm', minzoom: 12, filter: ['>', ['get', 'kw'], 0],
      layout: { 'text-field': ['concat', ['to-string', ['round', ['get', 'kw']]], ' kW'], 'text-size': 11, 'text-font': ['Noto Sans Regular'], 'text-offset': [0, 1.2], 'text-anchor': 'top', 'text-optional': true },
      paint: { 'text-color': '#1f2937', 'text-halo-color': 'rgba(255,255,255,.9)', 'text-halo-width': 1.3 } });
    ['a3-ocm', 'a3-ocm-label'].forEach(id => OWN.add(id));
  }
  for (const id of ['a3-ocm', 'a3-ocm-label']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none');
  if (on) { ocmLoad(); if (map.getZoom() < 7) toast('Şarj istasyonlarını görmek için yaklaşın', 3000); }
}
// Görünen alanın (merkez çevresiyle sınırlı) 0,5°'lik hücreleri bir kez istenir; Worker altı saat önbellekler
async function ocmFetch(w, s, e, n) {
  const d = await api('/api/ocm', { bbox: [w, s, e, n].map(v => v.toFixed(2)).join(',') });
  for (const st of d.stations || []) EK.ocmById.set(st.id, st);
  return d.stations || [];
}
async function ocmLoad() {
  if (!EK.ocm || !map || map.getZoom() < 7) return;
  const c = map.getCenter(), b = map.getBounds(), span = 0.75, S = 0.5;
  const w = Math.max(b.getWest(), c.lng - span), e = Math.min(b.getEast(), c.lng + span), s = Math.max(b.getSouth(), c.lat - span), n = Math.min(b.getNorth(), c.lat + span);
  const jobs = [];
  for (let x = Math.floor(w / S); x <= Math.floor(e / S); x++) for (let y = Math.floor(s / S); y <= Math.floor(n / S); y++) {
    const k = x + ':' + y; if (EK.ocmSeen.has(k)) continue;
    EK.ocmSeen.add(k);
    jobs.push(ocmFetch(x * S, y * S, (x + 1) * S, (y + 1) * S).catch(() => { EK.ocmSeen.delete(k); }));
  }
  if (!jobs.length) return;
  await Promise.all(jobs);
  map.getSource('a3-ocm')?.setData({ type: 'FeatureCollection', features: [...EK.ocmById.values()].map(st => ({ type: 'Feature', properties: { id: st.id, kw: ocmKw(st) }, geometry: { type: 'Point', coordinates: [st.lon, st.lat] } })) });
}
function showOcm(st) {
  const p = { name: st.name, lat: st.lat, lon: st.lon, address: st.addr, icon: 'ev_station', cat: 'Şarj istasyonu' };
  openPanel(el => {
    el.innerHTML = `<div class="list-head drag-zone"><h2>${esc(st.name)}</h2><small>${esc(['Şarj istasyonu', st.op, st.ok === false ? 'çalışmıyor olabilir' : ''].filter(Boolean).join(' · '))}</small></div>
      <div class="info">
        <div class="ek-btns"><button class="pri" id="ocm-dir"><span class="ms">directions</span>Yol tarifi</button>
          <a href="https://openchargemap.org/site/poi/details/${encodeURIComponent(st.id)}" target="_blank" rel="noopener"><span class="ms">open_in_new</span>Open Charge Map</a></div>
        ${st.addr ? `<div class="info-row"><span class="ms">location_on</span><span>${esc(st.addr)}</span></div>` : ''}
        ${st.cost ? `<div class="info-row"><span class="ms">payments</span><span>${esc(st.cost)}</span></div>` : ''}
        ${st.conns.length ? st.conns.map(c => `<div class="ocm-conn"><span>${esc(c.t)}${c.q > 1 ? ' × ' + c.q : ''}</span><b>${c.kw ? nf0.format(Math.round(c.kw)) + ' kW' : '—'}${c.dc ? ' DC' : ''}</b></div>`).join('') : '<div class="mini-note">Soket bilgisi girilmemiş.</div>'}
        <div class="mini-note">Veri: Open Charge Map (topluluk verisi; güncel olmayabilir).</div>
      </div>`;
    $('ocm-dir').onclick = () => openDirections({ to: p });
  }, { mode: 'list' });
}
// Elektrikli araçta "yakındaki şarj istasyonları": merkez çevresindeki istasyonlar, yakından uzağa
async function ocmNearby() {
  openPanel(el => { el.innerHTML = '<div class="loading"><div class="spinner"></div>Şarj istasyonları aranıyor…</div>'; }, { mode: 'list' });
  if (!$('opt-ocm').checked) { $('opt-ocm').checked = true; setOcm(true); }
  try {
    const c = map.getCenter(), d = 0.35;
    const list = await ocmFetch(c.lng - d, c.lat - d * 0.75, c.lng + d, c.lat + d * 0.75);
    const cc = [c.lng, c.lat];
    const places = list.map(st => ({ name: st.name, lat: st.lat, lon: st.lon, address: st.addr, icon: 'ev_station', cat: ocmSummary(st) || 'Şarj istasyonu' }))
      .sort((a, b) => haversine(cc, [a.lon, a.lat]) - haversine(cc, [b.lon, b.lat])).slice(0, 40);
    showList('Şarj istasyonları', places, { sub: 'Open Charge Map', onRefresh: ocmNearby });
  } catch (err) {
    openPanel(el => { el.innerHTML = `<div class="empty">Şarj istasyonları alınamadı.<br><small>${esc(err.message)}</small></div>`; }, { mode: 'list' });
  }
}

/* ================= Haritada tıklama ================= */
function ekTikla(e) {
  const box = [[e.point.x - 7, e.point.y - 7], [e.point.x + 7, e.point.y + 7]];
  if (EK.ocm && map.getLayer('a3-ocm')) {
    const f = map.queryRenderedFeatures(box, { layers: ['a3-ocm'] })[0], st = f && EK.ocmById.get(f.properties.id);
    if (st) { showOcm(st); return true; }
  }
  if (EK.mly && map.getLayer('a3-mly-img')) {
    const f = map.queryRenderedFeatures(box, { layers: ['a3-mly-img', 'a3-mly-seq'] })[0], id = f && (f.layer.id === 'a3-mly-img' ? f.properties.id : f.properties.image_id);
    if (id) { showMly(String(id)); return true; }
  }
  return false;
}
