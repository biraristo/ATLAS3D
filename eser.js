// ATLAS3D — Tarihî eser katmanı: Kültür Envanteri'nden derlenen ~84 bin eser 2D haritada.
// Uzaktan eser yoğunluğu firuze lekeler olarak görünür (Kültür Envanteri'ndeki gibi); yakınlaşınca
// İznik çinisi renklerinde sekizgen mühürlere dönüşür.
// Kayıp, toprak altında ya da su altındaki eserlerin mührü içi boş çizilir.
// Veri yalnızca düğmeye ilk basıldığında bir kez indirilir (data/heritage/kulturenvanteri.json, tools/build_ke.py üretir).
'use strict';

const ESER_URL = '/data/heritage/kulturenvanteri.json';
// Aile sırası veri dosyasındaki "aile" dizisiyle aynıdır
const ESER_AILE = [
  { id: 'dini', ad: 'Dinî yapılar', renk: '#1f4e96', simge: 'mosque' },
  { id: 'mezar', ad: 'Türbe ve anıtlar', renk: '#6b3d6e', simge: 'deceased' },
  { id: 'askeri', ad: 'Kale ve surlar', renk: '#b0352b', simge: 'castle' },
  { id: 'antik', ad: 'Antik yerler', renk: '#8a5a2b', simge: 'account_balance' },
  { id: 'su', ad: 'Çeşme ve hamamlar', renk: '#11807c', simge: 'water_drop' },
  { id: 'ticari', ad: 'Han ve çarşılar', renk: '#a87412', simge: 'storefront' },
  { id: 'sivil', ad: 'Sivil yapılar', renk: '#5b6b2f', simge: 'house' },
  { id: 'ulasim', ad: 'Köprüler', renk: '#3d5a73', simge: 'kopru' }, // yazı tipinde köprü simgesi yok: elle çizilir
  { id: 'diger', ad: 'Diğer', renk: '#6e6a63', simge: 'location_on' }
];
const ESER_KILISE = new Set(['Kilise', 'Katedral', 'Bazilika', 'Manastır', 'Şapel']);
const ESER_BOS = new Set(['Kayıp', 'Toprak Altında', 'Su Altında']); // içi boş mühür
const ESER_LAYERS = ['eser-tul', 'eser-hale', 'eser-yogun', 'eser-nokta', 'eser-secim'];
const ESER_YOGUN = '#3f979e', ESER_HALE = '#c9dbf6'; // Kültür Envanteri'nin yoğunluk görünümü: firuze leke, açık mavi hare

const eser = { on: false, data: null, loading: null, kapali: new Set(), secili: null, prev: null };

/* ----- Veri ----- */
function eserYukle() {
  if (eser.loading) return eser.loading;
  eser.loading = fetch(ESER_URL).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }).then(d => {
    const S = d.sozluk, tur = S.tur, durum = S.durum;
    const feats = new Array(d.eser.length);
    const sayi = new Array(ESER_AILE.length).fill(0);
    d.eser.forEach((e, i) => {
      const turAd = (e[5] || []).map(t => tur[t]).filter(Boolean);
      const bos = ESER_BOS.has(durum[e[8]]) ? 1 : 0;
      const kilise = e[13] === 0 && turAd.some(t => ESER_KILISE.has(t)) ? 1 : 0;
      sayi[e[13]]++;
      feats[i] = { type: 'Feature', geometry: { type: 'Point', coordinates: [e[2], e[3]] },
        properties: { i, n: e[1], img: `eser-${kilise ? 'kilise' : e[13]}${bos ? '-b' : ''}`, f: e[13] } };
    });
    eser.data = { ...d, feats, sayi };
    return eser.data;
  }).catch(err => { eser.loading = null; throw err; });
  return eser.loading;
}

/* ----- Mühür ve yıldız çizimleri (yüksek çözünürlüklü tuval → map.addImage) ----- */
const ESER_PR = 2;
function sekizgen(g, cx, cy, r) {
  g.beginPath();
  for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + k * Math.PI / 4; g.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
  g.closePath();
}
function kopruCiz(g, cx, cy, s, renk) { // tek kemerli taş köprü
  g.save(); g.strokeStyle = renk; g.lineWidth = s * 0.16; g.lineCap = 'round';
  g.beginPath(); g.moveTo(cx - s * 0.62, cy - s * 0.12); g.quadraticCurveTo(cx, cy - s * 0.42, cx + s * 0.62, cy - s * 0.12); g.stroke();
  g.beginPath(); g.moveTo(cx - s * 0.62, cy + s * 0.34); g.lineTo(cx - s * 0.62, cy - s * 0.12); g.moveTo(cx + s * 0.62, cy + s * 0.34); g.lineTo(cx + s * 0.62, cy - s * 0.12); g.stroke();
  g.beginPath(); g.arc(cx, cy + s * 0.34, s * 0.36, Math.PI, 0); g.stroke();
  g.restore();
}
function muhur(renk, simge, bos) {
  const S = 30 * ESER_PR, c = document.createElement('canvas'); c.width = c.height = S;
  const g = c.getContext('2d'), m = S / 2;
  g.shadowColor = 'rgba(40,28,10,.35)'; g.shadowBlur = 3 * ESER_PR; g.shadowOffsetY = 1 * ESER_PR;
  sekizgen(g, m, m, 13 * ESER_PR); g.fillStyle = '#fbf5e6'; g.fill(); // krem kenar
  g.shadowColor = 'transparent';
  sekizgen(g, m, m, 11 * ESER_PR);
  if (bos) { g.fillStyle = '#fbf5e6'; g.fill(); g.lineWidth = 2 * ESER_PR; g.setLineDash([3 * ESER_PR, 2 * ESER_PR]); g.strokeStyle = renk; g.stroke(); g.setLineDash([]); }
  else { g.fillStyle = renk; g.fill(); }
  const ink = bos ? renk : '#fbf5e6';
  if (simge === 'kopru') kopruCiz(g, m, m, 9 * ESER_PR, ink);
  else { g.fillStyle = ink; g.font = `${15 * ESER_PR}px "Material Symbols Outlined"`; g.textAlign = 'center'; g.textBaseline = 'middle'; g.fillText(simge, m, m + 0.5 * ESER_PR); }
  return { width: S, height: S, data: g.getImageData(0, 0, S, S).data };
}
async function eserGorseller() {
  try { await document.fonts.load(`${15 * ESER_PR}px "Material Symbols Outlined"`, 'mosque'); } catch {}
  const add = (id, img) => { if (map.hasImage(id)) map.removeImage(id); map.addImage(id, img, { pixelRatio: ESER_PR }); };
  ESER_AILE.forEach((a, i) => { add(`eser-${i}`, muhur(a.renk, a.simge, false)); add(`eser-${i}-b`, muhur(a.renk, a.simge, true)); });
  add('eser-kilise', muhur(ESER_AILE[0].renk, 'church', false)); add('eser-kilise-b', muhur(ESER_AILE[0].renk, 'church', true));
}

/* ----- Katmanlar ----- */
function eserVeri() {
  const f = eser.data.feats;
  return { type: 'FeatureCollection', features: eser.kapali.size ? f.filter(x => !eser.kapali.has(x.properties.f)) : f };
}
async function eserKatmanlar() {
  if (map.getSource('eser')) return;
  await eserGorseller();
  // Parşömen tülü: altlığı soldurur, işaretler öne çıkar; yer adları tülün üstünde kalır
  map.addSource('eser-tul', { type: 'geojson', data: { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-180, -85], [180, -85], [180, 85], [-180, 85], [-180, -85]]] } } });
  const firstSymbol = map.getStyle().layers.find(l => l.type === 'symbol' && !OWN.has(l.id))?.id;
  map.addLayer({ id: 'eser-tul', type: 'fill', source: 'eser-tul', paint: { 'fill-color': isDark() ? '#16130e' : '#f4ead2', 'fill-opacity': basemap === 'satellite' ? 0 : 0.4 } }, firstSymbol);
  map.addSource('eser', { type: 'geojson', data: eserVeri(), buffer: 16, maxzoom: 14 });
  // Uzaktan yoğunluk: her eser firuze bir leke; üst üste binenler tek alana kaynaşır, açık mavi bir hare çevreler.
  // Önce hare (biraz büyük), üstüne dolgu çizilir: iç kenarlar örtülür, yalnızca dış sınır kalır.
  // Yakınlaştırma ifadesi en dışta olmalı: hare yarıçapı ayrı tanımlanır
  const yaricap = ek => ['interpolate', ['exponential', 1.6], ['zoom'], 2, 2.2 + ek, 5, 3.8 + ek, 8, 5.5 + ek, 11, 7 + ek, 13, 8 + ek];
  const R = yaricap(0);
  const fade = (a, b) => ['interpolate', ['linear'], ['zoom'], 11.6, a, 13, b];
  map.addLayer({ id: 'eser-hale', type: 'circle', source: 'eser', maxzoom: 13.2,
    paint: { 'circle-radius': yaricap(2.6), 'circle-color': ESER_HALE, 'circle-opacity': fade(0.95, 0), 'circle-pitch-alignment': 'map' } });
  map.addLayer({ id: 'eser-yogun', type: 'circle', source: 'eser', maxzoom: 13.2,
    paint: { 'circle-radius': R, 'circle-color': ESER_YOGUN, 'circle-opacity': fade(1, 0), 'circle-pitch-alignment': 'map' } });
  map.addLayer({ id: 'eser-secim', type: 'circle', source: 'eser-secim-src', paint: { 'circle-radius': 19, 'circle-color': 'rgba(0,0,0,0)', 'circle-stroke-width': 2.5, 'circle-stroke-color': '#a87412' } });
  // Yakından: mühürler (çakışanlar gizlenir, yakınlaştıkça hepsi görünür)
  map.addLayer({ id: 'eser-nokta', type: 'symbol', source: 'eser', minzoom: 11.6,
    layout: { 'icon-image': ['get', 'img'], 'icon-size': ['interpolate', ['linear'], ['zoom'], 12, 0.72, 15, 0.9, 18, 1.1], 'icon-padding': 0, 'icon-allow-overlap': false,
      'text-field': ['step', ['zoom'], '', 14.5, ['get', 'n']], 'text-font': ['Noto Sans Regular'], 'text-size': 11.5, 'text-offset': [0, 1.5], 'text-anchor': 'top', 'text-optional': true, 'text-max-width': 9 },
    paint: { 'icon-opacity': fade(0, 1), 'text-color': isDark() ? '#efe3c8' : '#3b2a12', 'text-halo-color': isDark() ? 'rgba(20,17,12,.9)' : 'rgba(251,245,230,.95)', 'text-halo-width': 1.6 } });
  ESER_LAYERS.forEach(id => OWN.add(id));
}
function eserTemaUygula() { // tema değişince tül ve yazı renkleri
  if (!map?.getLayer('eser-tul')) return;
  const d = isDark();
  map.setPaintProperty('eser-tul', 'fill-color', d ? '#16130e' : '#f4ead2');
  map.setPaintProperty('eser-tul', 'fill-opacity', basemap === 'satellite' ? 0.22 : 0.5);
  map.setPaintProperty('eser-nokta', 'text-color', d ? '#efe3c8' : '#3b2a12');
  map.setPaintProperty('eser-nokta', 'text-halo-color', d ? 'rgba(20,17,12,.9)' : 'rgba(251,245,230,.95)');
}
function eserGorunur(on) {
  ESER_LAYERS.forEach(id => map.getLayer(id) && map.setLayoutProperty(id, 'visibility', on ? 'visible' : 'none'));
}
function eserSecimGoster(ll) {
  const src = map.getSource('eser-secim-src');
  src?.setData(ll ? { type: 'Feature', geometry: { type: 'Point', coordinates: ll } } : { type: 'FeatureCollection', features: [] });
}

/* ----- Aç / kapat ----- */
async function setEser(on) {
  if (!map || on === eser.on) return;
  eser.on = on;
  $('eser-btn').classList.toggle('on', on); $('eser-btn').setAttribute('aria-pressed', on);
  document.body.classList.toggle('eser-acik', on);
  if (!on) {
    eserGorunur(false); $('eser-bar').hidden = true; eserSecimGoster(null);
    if (typeof applyTerrainOpts === 'function') applyTerrainOpts();
    if (eser.prev) map.easeTo({ pitch: eser.prev.pitch, bearing: eser.prev.bearing, duration: 700 });
    if (panelMode === 'place' && currentPlace?.eser != null) closePanel();
    return;
  }
  if (typeof isoOn !== 'undefined' && isoOn) setIso(false);
  eser.prev = { pitch: map.getPitch(), bearing: map.getBearing() };
  map.easeTo({ pitch: 0, bearing: 0, duration: 800 }); // eserler 2D haritada
  for (const id of ['a3-slope', 'a3-contour-line', 'a3-contour-label']) if (map.getLayer(id)) map.setLayoutProperty(id, 'visibility', 'none');
  if (!eser.data) {
    $('eser-btn').classList.add('yukleniyor'); toast('Tarihî eserler yükleniyor…', 8000);
    try { await eserYukle(); }
    catch { toast('Eserler yüklenemedi. Bağlantını kontrol edip yeniden dene.'); eser.on = false; $('eser-btn').classList.remove('on', 'yukleniyor'); document.body.classList.remove('eser-acik'); return; }
    finally { $('eser-btn').classList.remove('yukleniyor'); }
    if (!eser.on) return;
    toast(`${nf0.format(eser.data.eser.length)} eser · kaynak: Kültür Envanteri`, 2500);
  }
  if (!map.getSource('eser-secim-src')) map.addSource('eser-secim-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  await eserKatmanlar();
  eserGorunur(true); eserTemaUygula(); eserBarCiz(); $('eser-bar').hidden = false;
}

/* ----- Filtre şeridi ----- */
const eserKisa = n => n >= 1000 ? nf1.format(n / 1000) + ' B' : String(n);
function eserBarCiz() {
  const bar = $('eser-bar'), s = eser.data.sayi;
  bar.innerHTML = ESER_AILE.map((a, i) => `<button class="eser-chip${eser.kapali.has(i) ? ' kapali' : ''}" data-f="${i}" style="--c:${a.renk}" aria-pressed="${!eser.kapali.has(i)}"><i></i>${a.ad}<small>${eserKisa(s[i])}</small></button>`).join('');
  bar.querySelectorAll('[data-f]').forEach(b => {
    b.onclick = () => {
      const f = +b.dataset.f;
      // Hepsi açıkken bir aileye dokunmak yalnızca onu gösterir; sonra dokunulanlar eklenir/çıkarılır
      if (!eser.kapali.size) ESER_AILE.forEach((_, i) => i !== f && eser.kapali.add(i));
      else if (eser.kapali.has(f)) eser.kapali.delete(f);
      else eser.kapali.add(f);
      if (eser.kapali.size === ESER_AILE.length) eser.kapali.clear(); // hiçbiri kalmadıysa hepsine dön
      map.getSource('eser')?.setData(eserVeri()); eserBarCiz();
    };
  });
}

/* ----- Tıklama ve kart ----- */
function eserTikla(e) {
  if (!eser.on || !map.getLayer('eser-nokta')) return false;
  const box = [[e.point.x - 10, e.point.y - 10], [e.point.x + 10, e.point.y + 10]];
  const z = map.getZoom();
  const f = map.queryRenderedFeatures(box, { layers: z >= 12.4 ? ['eser-nokta'] : ['eser-yogun'] })[0];
  if (!f) return false;
  if (z < 12.4) { // yoğunluk alanına dokunuldu: o bölgeye yakınlaş
    map.easeTo({ center: e.lngLat, zoom: Math.min(Math.max(z + 3, 9), 13.6), duration: 700 });
    return true;
  }
  eserGoster(f.properties.i);
  return true;
}
function eserYer(id) {
  const Y = eser.data.sozluk.yer, out = [];
  while (Y[id]) { out.push(Y[id][0]); id = Y[id][1]; }
  // mahalle › ilçe › il › bölge › ülke: kartta ilk ikisi ve ülke yeter
  const bolgesiz = out.filter(x => !/ Bölgesi$/.test(x));
  return bolgesiz.length > 3 ? [...bolgesiz.slice(0, 2), bolgesiz[bolgesiz.length - 1]].join(', ') : bolgesiz.join(', ');
}
function eserGoster(i) {
  const d = eser.data, S = d.sozluk, e = d.eser[i], a = ESER_AILE[e[13]];
  const turler = (e[5] || []).map(t => S.tur[t]).filter(Boolean);
  const p = { eser: i, name: e[1], lat: e[3], lon: e[2], cat: turler[0] || a.ad, icon: a.simge === 'kopru' ? 'location_on' : a.simge };
  hideCtx(); currentPlace = p; eser.secili = i;
  eserSecimGoster([e[2], e[3]]);
  const render = el => eserKart(el, p, e, a, turler);
  render.mode = 'place';
  openPanel(render, { mode: 'place' });
  map.easeTo({ center: [e[2], e[3]], zoom: Math.max(map.getZoom(), 14), padding: mapPadding(), duration: 700 });
}
function eserKart(el, p, e, a, turler) {
  const S = eser.data.sozluk;
  const kultur = (e[6] || []).map(k => S.kultur[k]).filter(x => x && x !== '?');
  const yuzyil = (e[7] || []).map(k => S.yuzyil[k]).filter(Boolean);
  const durum = S.durum[e[8]], yer = eserYer(e[11]);
  const glyph = a.simge === 'kopru' ? '<svg viewBox="-12 -12 24 24" width="34" height="34" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M-8 -1.5Q0 -6 8 -1.5M-8 5V-1.5M8 5V-1.5"/><path d="M-4.7 5A4.7 4.7 0 0 1 4.7 5"/></svg>'
    : `<span class="ms">${ESER_KILISE.has(turler[0]) ? 'church' : a.simge}</span>`;
  const satir = (ic, baslik, deger) => deger ? `<div class="eser-row"><span class="ms">${ic}</span><div><small>${baslik}</small>${esc(deger)}</div></div>` : '';
  el.innerHTML = `
    <div class="eser-hero" style="--c:${a.renk}"><div class="eser-muhur">${glyph}</div></div>
    <div class="place-head drag-zone">
      <h1 class="eser-ad">${esc(e[1])}</h1>
      ${e[12] ? `<div class="eser-aka">${esc(e[12])}</div>` : ''}
      <div class="eser-turler">${turler.map(t => `<span style="--c:${a.renk}">${esc(t)}</span>`).join('')}${durum && durum !== 'Erişilebilir' ? `<span class="eser-durum">${esc(durum)}</span>` : ''}</div>
    </div>
    <div class="actions">
      <button class="act primary" id="es-dir"><span class="circle"><span class="ms fill">directions</span></span>Yol tarifi</button>
      <button class="act" id="es-start"><span class="circle"><span class="ms">navigation</span></span>Başlat</button>
      <button class="act" id="es-save"><span class="circle"><span class="ms ${isSaved(p) ? 'fill' : ''}">bookmark</span></span>${isSaved(p) ? 'Kaydedildi' : 'Kaydet'}</button>
      <button class="act" id="es-share"><span class="circle"><span class="ms">share</span></span>Paylaş</button>
    </div>
    <div class="info">
      ${satir('history_edu', 'Kültür', kultur.join(', '))}
      ${satir('schedule', 'Dönem', yuzyil.join(', '))}
      ${satir('location_on', 'Konum', yer)}
      <a class="info-row" href="https://kulturenvanteri.com/yer/${encodeURIComponent(e[4])}/" target="_blank" rel="noopener"><span class="ms">open_in_new</span><span>Kültür Envanteri'nde aç<small class="eser-alt">Açıklama, fotoğraflar ve kaynaklar</small></span></a>
    </div>
    <div class="mini-note">Eser bilgileri Kültür Envanteri'nden alındı (${esc(eser.data.tarih)}).</div>`;
  $('es-dir').onclick = () => openDirections({ to: p });
  $('es-start').onclick = () => openDirections({ to: p, autostart: true });
  $('es-save').onclick = () => { toggleSave(p); eserKart(el, p, e, a, turler); };
  $('es-share').onclick = () => share(p.name, placeUrl(p));
}

/* ----- Bağlantılar ----- */
$('eser-btn').onclick = e => { e.stopPropagation(); setEser(!eser.on); };
