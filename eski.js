// ATLAS3D — Eski haritalar: coğrafi olarak yerleştirilmiş tarihî haritaları bugünkü haritanın üstüne bindirir.
// - Şehir ve bölge haritaları: MapWarper'daki açık, yerleştirilmiş haritalardan seçilmiş liste (data/eski/haritalar.json)
// - Roma İmparatorluğu atlası: DARE (Digital Atlas of the Roman Empire), MS 200 civarı
// - Tarihî sınırlar: OpenHistoricalMap; seçilen yıla göre süzülür (zaman kaydırıcısıyla ortak yıl)
'use strict';

const ESKI_URL = '/data/eski/haritalar.json';
const ESKI_ROMA = { tiles: ['https://dh.gu.se/tiles/imperium/{z}/{x}/{y}.png'], maxzoom: 11, attribution: 'Roma atlası © DARE, Johan Åhlfeldt (CC BY-SA)' };
const ESKI_OHM = { tiles: ['https://vtiles.openhistoricalmap.org/maps/ohm/{z}/{x}/{y}.pbf'], maxzoom: 14, attribution: 'Tarihî sınırlar © OpenHistoricalMap (CC0)' };
const eski = { liste: null, tiles: '', secili: null, roma: false, sinir: false, saydam: 0.85, gizli: false };

/* ----- Ortak yıl: eski haritalar ve zaman kaydırıcısı aynı yılı kullanır ----- */
let atlasYil = 1500;
function setAtlasYil(y, kaynak) {
  atlasYil = Math.round(y);
  document.dispatchEvent(new CustomEvent('atlas-yil', { detail: { yil: atlasYil, kaynak } }));
}
const yilYaz = y => y < 0 ? `MÖ ${-y}` : y < 1000 ? `MS ${y}` : String(y);

async function eskiListe() {
  if (eski.liste) return eski.liste;
  const d = await (await fetch(ESKI_URL)).json();
  eski.tiles = d.tiles; eski.liste = d.harita.sort((a, b) => a.yil - b.yil);
  return eski.liste;
}

/* ----- Katmanlar ----- */
function eskiAltKatman() { // bindirmeler bugünkü yer adlarının altında, eserlerin altında kalır
  return map.getStyle().layers.find(l => l.type === 'symbol' && !OWN.has(l.id))?.id;
}
function eskiHaritaGoster(id) {
  const h = eski.liste.find(x => x.id === id); if (!h) return;
  if (map.getLayer('eski-harita')) map.removeLayer('eski-harita');
  if (map.getSource('eski-harita')) map.removeSource('eski-harita');
  map.addSource('eski-harita', { type: 'raster', tiles: [eski.tiles.replace('{id}', id)], tileSize: 256, maxzoom: 19, bounds: h.bbox, attribution: `Eski harita: <a href="${h.kaynak}" target="_blank" rel="noopener">MapWarper</a>` });
  map.addLayer({ id: 'eski-harita', type: 'raster', source: 'eski-harita', paint: { 'raster-opacity': eski.saydam, 'raster-fade-duration': 200 } }, eskiAltKatman());
  OWN.add('eski-harita');
  eski.secili = id; eski.gizli = false;
  map.fitBounds([[h.bbox[0], h.bbox[1]], [h.bbox[2], h.bbox[3]]], { padding: { top: 120, bottom: 190, left: 30, right: 30 }, pitch: 0, bearing: 0, duration: 1600, maxZoom: 15 });
  eskiCubukCiz();
}
function eskiHaritaKapat() {
  if (map.getLayer('eski-harita')) map.removeLayer('eski-harita');
  if (map.getSource('eski-harita')) map.removeSource('eski-harita');
  eski.secili = null; eskiCubukCiz();
}
function eskiRoma(on) {
  eski.roma = on;
  if (on && !map.getSource('eski-roma')) {
    map.addSource('eski-roma', { type: 'raster', tileSize: 256, ...ESKI_ROMA });
    map.addLayer({ id: 'eski-roma', type: 'raster', source: 'eski-roma', paint: { 'raster-opacity': eski.saydam } }, eskiAltKatman());
    OWN.add('eski-roma');
  }
  if (map.getLayer('eski-roma')) map.setLayoutProperty('eski-roma', 'visibility', on ? 'visible' : 'none');
  if (on) map.flyTo({ center: [22, 38], zoom: Math.min(map.getZoom(), 4), pitch: 0, bearing: 0, duration: 1600 });
  eskiCubukCiz();
}
// Yıla göre süzgeç: başlangıcı yoksa çok eski, bitişi yoksa hâlâ geçerli sayılır
const eskiYilFiltre = y => ['all', ['<=', ['coalesce', ['get', 'start_decdate'], -100000], y], ['>', ['coalesce', ['get', 'end_decdate'], 100000], y]];
const ESKI_DUZEY = ['to-number', ['get', 'admin_level'], 9];
const ESKI_FILTRE = {
  devlet: y => ['all', ['<=', ESKI_DUZEY, 2], ['!=', ['get', 'maritime'], 'yes'], eskiYilFiltre(y)],
  ic: y => ['all', ['>', ESKI_DUZEY, 2], ['<=', ESKI_DUZEY, 4], ['!=', ['get', 'maritime'], 'yes'], eskiYilFiltre(y)],
  ad: y => ['all', ['<=', ESKI_DUZEY, 2], eskiYilFiltre(y)]
};
const ESKI_BUGUN = ['boundary_3', 'boundary_2', 'boundary_disputed', 'label_state', 'label_country_3', 'label_country_2', 'label_country_1'];
function eskiSinir(on) {
  eski.sinir = on;
  if (on && !map.getSource('eski-ohm')) {
    map.addSource('eski-ohm', { type: 'vector', ...ESKI_OHM });
    const alt = eskiAltKatman();
    map.addLayer({ id: 'eski-sinir-hale', type: 'line', source: 'eski-ohm', 'source-layer': 'land_ohm_lines', filter: ESKI_FILTRE.devlet(atlasYil),
      paint: { 'line-color': '#f6ecd6', 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 3.5, 8, 8], 'line-opacity': 0.8 } }, alt);
    // Devlet sınırı düz, iç sınırlar kesik (MapLibre'de çizgi deseni veriye göre değişemez: iki katman)
    map.addLayer({ id: 'eski-sinir-ic', type: 'line', source: 'eski-ohm', 'source-layer': 'land_ohm_lines', filter: ESKI_FILTRE.ic(atlasYil),
      paint: { 'line-color': '#8c2f22', 'line-opacity': 0.7, 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 0.5, 8, 1.4], 'line-dasharray': [3, 2] } }, alt);
    map.addLayer({ id: 'eski-sinir', type: 'line', source: 'eski-ohm', 'source-layer': 'land_ohm_lines', filter: ESKI_FILTRE.devlet(atlasYil),
      paint: { 'line-color': '#8c2f22', 'line-width': ['interpolate', ['linear'], ['zoom'], 2, 1.3, 8, 3.2] } }, alt);
    map.addLayer({ id: 'eski-sinir-ad', type: 'symbol', source: 'eski-ohm', 'source-layer': 'land_ohm_centroids', filter: ESKI_FILTRE.ad(atlasYil),
      layout: { 'text-field': ['coalesce', ['get', 'name_tr'], ['get', 'name_en'], ['get', 'name']], 'text-font': ['Noto Sans Italic'], 'text-size': ['interpolate', ['linear'], ['zoom'], 2, 11, 6, 15], 'text-letter-spacing': 0.08, 'text-max-width': 8 },
      paint: { 'text-color': '#7a2418', 'text-halo-color': 'rgba(246,236,214,.9)', 'text-halo-width': 1.5 } });
    ['eski-sinir-hale', 'eski-sinir-ic', 'eski-sinir', 'eski-sinir-ad'].forEach(id => OWN.add(id));
  }
  ['eski-sinir-hale', 'eski-sinir-ic', 'eski-sinir', 'eski-sinir-ad'].forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));
  // Bugünkü sınırlar ve ülke adları tarihî sınırlarla karışmasın
  ESKI_BUGUN.forEach(id => { if (!map.getLayer(id)) return; if (on) map.setLayoutProperty(id, 'visibility', 'none'); });
  if (!on) applyBasemap(); // bugünkü katmanlar özgün görünürlüğüne döner
  eskiCubukCiz();
}
function eskiSinirYil(y) {
  const set = (id, f) => map.getLayer(id) && map.setFilter(id, f);
  set('eski-sinir-hale', ESKI_FILTRE.devlet(y)); set('eski-sinir', ESKI_FILTRE.devlet(y));
  set('eski-sinir-ic', ESKI_FILTRE.ic(y)); set('eski-sinir-ad', ESKI_FILTRE.ad(y));
}
document.addEventListener('atlas-yil', e => { if (eski.sinir) eskiSinirYil(e.detail.yil); if (e.detail.kaynak !== 'eski') eskiCubukCiz(); });
function eskiSaydam(v) {
  eski.saydam = v;
  ['eski-harita', 'eski-roma'].forEach(id => map.getLayer(id) && map.setPaintProperty(id, 'raster-opacity', eski.gizli ? 0 : v));
}

/* ----- Alt çubuk: açık bindirme, saydamlık, karşılaştır, sınır yılı ----- */
function eskiCubukCiz() {
  const bar = $('eski-bar'), acik = eski.secili != null || eski.roma || eski.sinir;
  bar.hidden = !acik; document.body.classList.toggle('eski-acik', acik);
  if (!acik) return;
  const h = eski.secili != null ? eski.liste.find(x => x.id === eski.secili) : null;
  const baslik = h ? [h.ad, `${yilYaz(h.yil)} · ${h.bolge}`, `/data/eski/${h.id}.jpg`] : eski.roma ? ['Roma İmparatorluğu atlası', 'MS 200 civarı', '/data/eski/roma.jpg'] : ['Tarihî sınırlar', yilYaz(atlasYil), '/data/eski/sinir.jpg'];
  const raster = h || eski.roma;
  bar.innerHTML = `
    <div class="eb-ust">
      <img src="${baslik[2]}" alt="">
      <div class="eb-ad"><b>${esc(baslik[0])}</b><small>${esc(baslik[1])}</small></div>
      <button class="icon-btn" id="eb-liste" aria-label="Eski harita listesi"><span class="ms">list</span></button>
      <button class="icon-btn" id="eb-kapat" aria-label="Eski haritayı kapat"><span class="ms">close</span></button>
    </div>
    ${raster ? `<div class="eb-satir"><span class="ms">opacity</span><input type="range" id="eb-saydam" min="0" max="100" value="${Math.round(eski.saydam * 100)}" aria-label="Saydamlık"><button class="eb-kars${eski.gizli ? ' on' : ''}" id="eb-kars">${eski.gizli ? 'Eskiyi göster' : 'Bugüne bak'}</button></div>` : ''}
    ${eski.sinir ? `<div class="eb-satir"><span class="ms">history</span><input type="range" id="eb-yil" min="-1500" max="2020" step="10" value="${atlasYil}" aria-label="Sınır yılı"><b class="eb-yil">${yilYaz(atlasYil)}</b></div>` : ''}`;
  $('eb-liste').onclick = () => eskiPanel();
  $('eb-kapat').onclick = () => { if (h) eskiHaritaKapat(); else if (eski.roma) eskiRoma(false); else eskiSinir(false); };
  const s = $('eb-saydam'); if (s) s.oninput = () => { eski.gizli = false; eskiSaydam(s.value / 100); $('eb-kars').classList.remove('on'); $('eb-kars').textContent = 'Bugüne bak'; };
  const k = $('eb-kars'); if (k) k.onclick = () => { eski.gizli = !eski.gizli; eskiSaydam(eski.saydam); eskiCubukCiz(); };
  const y = $('eb-yil'); if (y) y.oninput = () => { setAtlasYil(+y.value, 'eski'); bar.querySelector('.eb-yil').textContent = yilYaz(+y.value); if (!h && !eski.roma) bar.querySelector('.eb-ad small').textContent = yilYaz(+y.value); };
}

/* ----- Liste paneli ----- */
async function eskiPanel() {
  await eskiListe();
  const b = map.getBounds(), gorunur = h => !(h.bbox[2] < b.getWest() || h.bbox[0] > b.getEast() || h.bbox[3] < b.getSouth() || h.bbox[1] > b.getNorth());
  const kart = h => `<button class="eski-kart${eski.secili === h.id ? ' on' : ''}" data-id="${h.id}"><img src="/data/eski/${h.id}.jpg" alt="" loading="lazy"><span><b>${esc(h.ad)}</b><small>${yilYaz(h.yil)} · ${esc(h.bolge)}</small>${h.not ? `<em>${esc(h.not)}</em>` : ''}</span></button>`;
  const burada = eski.liste.filter(gorunur), diger = eski.liste.filter(h => !gorunur(h));
  const bolgeler = [...new Set(diger.map(h => h.bolge))];
  const render = el => {
    el.innerHTML = `
      <div class="place-head drag-zone"><h1 class="eser-ad">Eski haritalar</h1><div class="sub">Bugünkü haritanın üstüne bindirilir; saydamlığı alttan ayarlayabilirsin.</div>
        <a class="eski-omo" href="https://www.oldmapsonline.org/en/#position=${Math.max(3, Math.round(map.getZoom()))}/${map.getCenter().lat.toFixed(2)}/${map.getCenter().lng.toFixed(2)}&year=${Math.max(1, atlasYil)}" target="_blank" rel="noopener"><span class="ms">open_in_new</span>Bu bölgenin 500 bin haritası: Old Maps Online</a></div>
      <div class="eski-grup"><h3>Tüm bölge</h3>
        <button class="eski-kart${eski.roma ? ' on' : ''}" data-ozel="roma"><img src="/data/eski/roma.jpg" alt=""><span><b>Roma İmparatorluğu atlası</b><small>MS 200 civarı · Akdeniz</small><em>Antik kentler, yollar ve eyaletler</em></span></button>
        <button class="eski-kart${eski.sinir ? ' on' : ''}" data-ozel="sinir"><img src="/data/eski/sinir.jpg" alt=""><span><b>Tarihî sınırlar</b><small>Yıla göre · ${yilYaz(atlasYil)}</small><em>Devletlerin o yıldaki sınırları; zaman kaydırıcısıyla birlikte değişir</em></span></button>
      </div>
      ${burada.length ? `<div class="eski-grup"><h3>Bu görünümde</h3>${burada.map(kart).join('')}</div>` : ''}
      ${bolgeler.map(r => `<div class="eski-grup"><h3>${esc(r)}</h3>${diger.filter(h => h.bolge === r).map(kart).join('')}</div>`).join('')}`;
    el.querySelectorAll('[data-id]').forEach(k => { k.onclick = () => { closePanel(); eskiHaritaGoster(+k.dataset.id); }; });
    el.querySelectorAll('[data-ozel]').forEach(k => { k.onclick = () => { closePanel(); if (k.dataset.ozel === 'roma') eskiRoma(!eski.roma); else eskiSinir(!eski.sinir); }; });
  };
  render.mode = 'eski';
  openPanel(render, { mode: 'eski', sheet: 'full' });
}

$('eski-ac').onclick = e => { e.stopPropagation(); $('layers-pop').hidden = true; $('layers-btn').classList.remove('on'); eskiPanel(); };
