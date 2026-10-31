// ATLAS3D — Tarihî eser katmanı: Kültür Envanteri'nden derlenen ~84 bin eser 2D haritada.
// Uzaktan eser yoğunluğu firuze lekeler olarak görünür (Kültür Envanteri'ndeki gibi); yakınlaşınca
// İznik çinisi renklerinde sekizgen mühürlere dönüşür.
// Kayıp, toprak altında ya da su altındaki eserlerin mührü içi boş çizilir.
// Veri yalnızca düğmeye ilk basıldığında bir kez indirilir (data/heritage/kulturenvanteri.json, tools/build_ke.py üretir).
'use strict';

const ESER_URL = '/data/heritage/kulturenvanteri.json';
const HAKKINDA_URL = '/data/heritage/hakkinda.json'; // kişisel gezi notları (tools/build_mymaps.py): eşleşen eserlere metin + yeni eserler
// Aile sırası veri dosyasındaki "aile" dizisiyle aynıdır
const ESER_AILE = [
  { id: 'dini', ad: 'Dinî yapılar', renk: '#1f4e96', simge: 'cami', ms: 'mosque' },
  { id: 'mezar', ad: 'Türbe ve anıtlar', renk: '#6b3d6e', simge: 'turbe', ms: 'deceased' },
  { id: 'askeri', ad: 'Kale ve surlar', renk: '#b0352b', simge: 'kale', ms: 'castle' },
  { id: 'antik', ad: 'Antik yerler', renk: '#8a5a2b', simge: 'antik', ms: 'account_balance' },
  { id: 'su', ad: 'Çeşme ve hamamlar', renk: '#11807c', simge: 'su', ms: 'water_drop' },
  { id: 'ticari', ad: 'Han ve çarşılar', renk: '#a87412', simge: 'han', ms: 'storefront' },
  { id: 'sivil', ad: 'Sivil yapılar', renk: '#5b6b2f', simge: 'konak', ms: 'house' },
  { id: 'ulasim', ad: 'Köprüler', renk: '#3d5a73', simge: 'kopru', ms: 'location_on' },
  { id: 'diger', ad: 'Diğer', renk: '#6e6a63', simge: 'diger', ms: 'location_on' }
];
// Piktogramlar: 24 birimlik kutuda dolu biçimler, boşluklar evenodd ile oyulur (küçük boyda da net okunur)
const ESER_GLYPH = {
  cami: 'M3 21h18v-1.6H3z M5 19.4v-6.2a5 5 0 0 1 10 0v6.2z M9.2 7.2a.8.8 0 1 1 1.6 0v1.1H9.2z M16.6 19.4V8.6l1.15-4.2 1.15 4.2v10.8z M16.1 9.2h3.3v1.1h-3.3z',
  kilise: 'M11.2 2.5h1.6v2h2v1.5h-2v2.1h-1.6V6h-2V4.5h2z M5 21V12.4l7-5 7 5V21z M10.3 21v-3.6a1.7 1.7 0 0 1 3.4 0V21z',
  kale: 'M4 21V8h2.6v2.3h1.7V8h2.6v2.3h1.7V8h2.6v2.3h1.7V8H20v13z M9.6 21v-3.4a2.4 2.4 0 0 1 4.8 0V21z M7 13.2h2v2.2H7z M15 13.2h2v2.2h-2z',
  turbe: 'M6.5 21v-8.6h11V21z M5.4 12.4L12 3.4l6.6 9z M11.3 3.6v-1.6h1.4v1.6z M10.4 21v-3.2a1.6 1.6 0 0 1 3.2 0V21z',
  antik: 'M2.6 9.2L12 3.6l9.4 5.6z M3.2 10.4h17.6v1.6H3.2z M4.8 12.6h2.4v6.2H4.8z M10.8 12.6h2.4v6.2h-2.4z M16.8 12.6h2.4v6.2h-2.4z M2.6 19.4h18.8V21H2.6z',
  su: 'M12 2.8c3.4 4.4 6.4 8 6.4 11.6a6.4 6.4 0 0 1-12.8 0c0-3.6 3-7.2 6.4-11.6z M9 14.6a3 3 0 0 0 3 3v-1.5a1.5 1.5 0 0 1-1.5-1.5z',
  han: 'M2.8 21V8.6h18.4V21z M2.8 7.4V5.6h18.4v1.8z M9 21v-4.4a3 3 0 0 1 6 0V21z M4.8 10.6h2.2v2.4H4.8z M17 10.6h2.2v2.4H17z',
  konak: 'M3 11.2L12 4l9 7.2z M5.4 12.2h13.2v2.4h1.6v1.8H3.8v-1.8h1.6z M6.2 16.4h11.6V21H6.2z M11 21v-3h2v3z M7.6 12.9h2v1.3h-2z M14.4 12.9h2v1.3h-2z',
  kopru: 'M1.8 10.2h20.4v2H1.8z M3 12.2h18V20h-3.2v-1.6a5.8 5.8 0 0 0-11.6 0V20H3z',
  diger: 'M12 3a6.4 6.4 0 0 1 6.4 6.4c0 4.6-6.4 11.6-6.4 11.6S5.6 14 5.6 9.4A6.4 6.4 0 0 1 12 3z M12 7.2a2.2 2.2 0 1 0 0 4.4 2.2 2.2 0 0 0 0-4.4z'
};
const ESER_KILISE = new Set(['Kilise', 'Katedral', 'Bazilika', 'Manastır', 'Şapel']);
const ESER_BOS = new Set(['Kayıp', 'Toprak Altında', 'Su Altında']); // içi boş mühür
const ESER_LAYERS = ['eser-tul', 'eser-hale', 'eser-yogun', 'eser-nokta', 'eser-secim'];
const ESER_YOGUN = '#3f979e', ESER_HALE = '#c9dbf6'; // Kültür Envanteri'nin yoğunluk görünümü: firuze leke, açık mavi hare

const eser = { on: false, data: null, loading: null, kapali: new Set(), secili: null, prev: null };

/* ----- Veri ----- */
function eserYukle() {
  if (eser.loading) return eser.loading;
  const hk = fetch(HAKKINDA_URL).then(r => r.ok ? r.json() : null).catch(() => null); // yoksa katman yine çalışır
  eser.loading = Promise.all([fetch(ESER_URL).then(r => { if (!r.ok) throw new Error('HTTP ' + r.status); return r.json(); }), hk]).then(([d, H]) => {
    eser.hakkinda = H?.ke || {};
    // Kişisel haritadaki yeni eserler aynı satır biçimine eklenir: [14] tür adı, [15] katman (bölge), [16] gezi notu
    (H?.yeni || []).forEach((y, k) => d.eser.push([`m${k}`, y.ad, y.lon, y.lat, '', [], [], [], 0, 0, [], 0, '', y.aile, y.tur, y.katman, y]));
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
const ESER_PR = 3; // retina ekranlarda keskin
function sekizgen(g, cx, cy, r) {
  g.beginPath();
  for (let k = 0; k < 8; k++) { const a = Math.PI / 8 + k * Math.PI / 4; g.lineTo(cx + r * Math.cos(a), cy + r * Math.sin(a)); }
  g.closePath();
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
  const k = 16 * ESER_PR / 24; // piktogram kutusu
  g.translate(m - 12 * k, m - 12 * k); g.scale(k, k);
  g.fillStyle = bos ? renk : '#fbf5e6'; g.fill(new Path2D(ESER_GLYPH[simge]), 'evenodd');
  return { width: S, height: S, data: g.getImageData(0, 0, S, S).data };
}
function eserGorseller() {
  const add = (id, img) => { if (map.hasImage(id)) map.removeImage(id); map.addImage(id, img, { pixelRatio: ESER_PR }); };
  ESER_AILE.forEach((a, i) => { add(`eser-${i}`, muhur(a.renk, a.simge, false)); add(`eser-${i}-b`, muhur(a.renk, a.simge, true)); });
  add('eser-kilise', muhur(ESER_AILE[0].renk, 'kilise', false)); add('eser-kilise-b', muhur(ESER_AILE[0].renk, 'kilise', true));
}

/* ----- Katmanlar ----- */
function eserVeri() {
  const f = eser.data.feats;
  return { type: 'FeatureCollection', features: eser.kapali.size ? f.filter(x => !eser.kapali.has(x.properties.f)) : f };
}
async function eserKatmanlar() {
  if (map.getSource('eser')) return;
  eserGorseller();
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
    applyBasemap(); // haritanın etiketleri geri gelir
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
  }
  if (!map.getSource('eser-secim-src')) map.addSource('eser-secim-src', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
  await eserKatmanlar();
  eserGorunur(true); applyBasemap(); eserBarCiz(); $('eser-bar').hidden = false; // applyBasemap: harita etiketlerini gizler
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
  const turler = e[14] ? [e[14]] : (e[5] || []).map(t => S.tur[t]).filter(Boolean);
  const p = { eser: i, name: e[1], lat: e[3], lon: e[2], cat: turler[0] || a.ad, icon: a.ms };
  hideCtx(); currentPlace = p; eser.secili = i;
  eserSecimGoster([e[2], e[3]]);
  const render = el => eserKart(el, p, e, a, turler);
  render.mode = 'place';
  openPanel(render, { mode: 'place' });
  map.easeTo({ center: [e[2], e[3]], zoom: Math.max(map.getZoom(), 14), padding: mapPadding(), duration: 700 });
}
// Gezi notu: alanlar (dönem, tarih, müellif, mezar no) ve başlıklı metinler; uzun metin katlanır
function eserNotHtml(n, eserAd) {
  const satir = (ic, baslik, deger) => deger ? `<div class="eser-row"><span class="ms">${ic}</span><div><small>${baslik}</small>${esc(deger)}</div></div>` : '';
  const muellif = n.muellif ? n.muellif + (n.unvan ? ` (${n.unvan})` : '') : '';
  const metin = (n.metin || []).map(([b, t]) => {
    const ps = t.split(/\n+/).map(x => x.trim()).filter(Boolean).map(x => `<p>${esc(x).replace(/\*\*(.+?)\*\*/g, '<b>$1</b>')}</p>`).join('');
    const uzun = t.length > 520;
    return `<h3>${esc(b)}</h3><div class="eser-metin${uzun ? ' kisa' : ''}">${ps}</div>${uzun ? '<button class="text-btn eser-devam">Devamını göster</button>' : ''}`;
  }).join('');
  return `<section class="eser-hakkinda">
    ${n.ad && n.ad !== eserAd ? `<div class="eser-not-ad">${esc(n.ad)}</div>` : ''}
    <div class="eser-not-alan">${satir('history_edu', 'Dönem', n.donem)}${satir('event', 'Tarih', n.tarih)}${satir('person', 'Müellif', muellif)}${satir('tag', 'Mezar no', n.kv)}</div>
    ${metin}</section>`;
}
function eserKart(el, p, e, a, turler) {
  const S = eser.data.sozluk;
  const kultur = (e[6] || []).map(k => S.kultur[k]).filter(x => x && x !== '?');
  const yuzyil = (e[7] || []).map(k => S.yuzyil[k]).filter(Boolean);
  const durum = S.durum[e[8]], yer = e[15] ? `${e[15]}, Mısır` : eserYer(e[11]);
  const notlar = e[16] ? [e[16]] : eser.hakkinda[e[0]] || [];
  const glyph = `<svg viewBox="0 0 24 24" width="46" height="46" aria-hidden="true"><path fill="currentColor" fill-rule="evenodd" d="${ESER_GLYPH[ESER_KILISE.has(turler[0]) && a.id === 'dini' ? 'kilise' : a.simge]}"/></svg>`;
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
      ${satir('schedule', 'Yüzyıl', yuzyil.join(', '))}
      ${satir('location_on', 'Konum', yer)}
    </div>
    ${notlar.map(n => eserNotHtml(n, e[1])).join('')}`;
  el.querySelectorAll('.eser-devam').forEach(b => { b.onclick = () => { const m = b.previousElementSibling; const ac = m.classList.toggle('kisa'); b.textContent = ac ? 'Devamını göster' : 'Daha az göster'; }; });
  $('es-dir').onclick = () => openDirections({ to: p });
  $('es-start').onclick = () => openDirections({ to: p, autostart: true });
  $('es-save').onclick = () => { toggleSave(p); eserKart(el, p, e, a, turler); };
  $('es-share').onclick = () => share(p.name, placeUrl(p));
}

/* ----- Bağlantılar ----- */
$('eser-btn').onclick = e => { e.stopPropagation(); setEser(!eser.on); };
