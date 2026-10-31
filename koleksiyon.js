// ATLAS3D — Koleksiyonlar: bir mimarın, bir rotanın, bir hanedanın ya da bir temanın eserlerini haritada tek başına gösterir.
// Çizgi yalnızca rotalarda ve hatlarda çekilir (güzergâhın kendisi). Sırası net olan koleksiyonlarda "Yolculuğu oynat":
//   - rotalarda güzergâh boyunca, istasyon istasyon
//   - mimarlarda yapım yılına göre (kesin yılı bilinen eser yeterliyse: tools/build_kesin_yil.py)
// Kaynak: Kültür Envanteri temaları ve kültürleri.
'use strict';

const kol = { secili: null, ids: null, oynat: null };
// Çizgisi ve güzergâh sırası olan rotalar/hatlar
const KOL_HAT = ['İpek Yolu', 'Camino de Santiago', 'Hicaz Demiryolu', 'Via Egnatia', 'Taksim Su Yolu', 'Çakmak Hattı', 'İstanbul Surları', 'Galata Surları'];
// Rotalar grubunda listelenen ama çizgisi olmayanlar (sıra belli değil)
const KOL_ROTA = [...KOL_HAT, 'Evliya Çelebi', 'Kültür Rotaları', 'Kurtuluş Savaşı Cepheleri', 'Çanakkale Savaşı', 'Sakarya Meydan Muharebesi', 'Büyük Taarruz',
  'Başkomutanlık Meydan Muharebesi', 'Taş Tepeler', 'Bin Tepeler'];
const kolMimarMi = ad => / (Yapıları|Eserleri)$|Ailesi|Balyan/.test(ad) && !/Akımı/.test(ad);
const KOL_CIZGI_SINIR = 900;
// Yapım sırasıyla oynatma için yeterli kesin yıl: en az 10 eser ve koleksiyonun %30'u
const KOL_KESIN_EN_AZ = 10, KOL_KESIN_ORAN = 0.3;
// Mimar Sinan'ın kendi dönemleri: Şehzade (1548) çıraklık, Süleymaniye (1557) kalfalık, Selimiye (1574) ustalık
const SINAN_DONEM = y => y < 1548 ? 'Çıraklık dönemi' : y < 1559 ? 'Kalfalık dönemi' : 'Ustalık dönemi';

function kolListe() {
  const d = eser.data, S = d.sozluk, tema = new Map(), kultur = new Map();
  d.eser.forEach((e, i) => {
    (e[10] || []).forEach(t => { const ad = S.tema[t]; if (ad) (tema.get(ad) || tema.set(ad, []).get(ad)).push(i); });
    (e[6] || []).forEach(k => { const ad = S.kultur[k]; if (ad && ad !== '?') (kultur.get(ad) || kultur.set(ad, []).get(ad)).push(i); });
  });
  const ozet = (ad, L, tur) => ({ ad, ids: L, tur });
  const temalar = [...tema].map(([ad, L]) => ozet(ad, L, 'tema'));
  return {
    mimar: temalar.filter(t => kolMimarMi(t.ad)).sort((a, b) => b.ids.length - a.ids.length),
    rota: temalar.filter(t => KOL_ROTA.includes(t.ad)).sort((a, b) => b.ids.length - a.ids.length),
    hanedan: [...kultur].filter(([ad, L]) => L.length >= 20 && L.length <= 2500).map(([ad, L]) => ozet(ad, L, 'kultur')).sort((a, b) => b.ids.length - a.ids.length).slice(0, 40),
    diger: temalar.filter(t => !kolMimarMi(t.ad) && !KOL_ROTA.includes(t.ad)).sort((a, b) => b.ids.length - a.ids.length)
  };
}

/* ----- Yolculuk sırası: rotada güzergâh, mimarda yapım yılı; yoksa null ----- */
function kolYolculuk(k) {
  const F = eser.data.feats;
  if (KOL_HAT.includes(k.ad) && k.ids.length >= 2 && k.ids.length <= KOL_CIZGI_SINIR) return { tur: 'rota', sira: kolGuzergah(k.ids) };
  const kesin = k.ids.filter(i => F[i].properties.x);
  if (k.tur === 'tema' && kesin.length >= KOL_KESIN_EN_AZ && kesin.length >= KOL_KESIN_ORAN * k.ids.length)
    return { tur: 'yil', sira: kesin.sort((a, b) => F[a].properties.y - F[b].properties.y), kesin: kesin.length };
  return null;
}

/* ----- Bağlantı ağı (en kısa ağaç, Prim) ve güzergâh sırası ----- */
function kolAgKenar(ids) {
  const E = eser.data.eser, n = ids.length;
  const xy = ids.map(i => [E[i][2] * Math.cos(E[i][3] * Math.PI / 180), E[i][3]]);
  const ic = new Uint8Array(n), en = new Float64Array(n).fill(Infinity), kim = new Int32Array(n).fill(-1), kenar = [];
  en[0] = 0;
  for (let t = 0; t < n; t++) {
    let u = -1; for (let v = 0; v < n; v++) if (!ic[v] && (u < 0 || en[v] < en[u])) u = v;
    ic[u] = 1; if (kim[u] >= 0) kenar.push([u, kim[u]]);
    for (let v = 0; v < n; v++) if (!ic[v]) { const d = (xy[u][0] - xy[v][0]) ** 2 + (xy[u][1] - xy[v][1]) ** 2; if (d < en[v]) { en[v] = d; kim[v] = u; } }
  }
  return kenar;
}
// Ağacın en uzun yolunun bir ucundan başlayıp derinlemesine dolaşır: hat boyunca istasyon istasyon
function kolGuzergah(ids) {
  const E = eser.data.eser, n = ids.length, kom = Array.from({ length: n }, () => []);
  for (const [a, b] of kolAgKenar(ids)) { const d = haversine([E[ids[a]][2], E[ids[a]][3]], [E[ids[b]][2], E[ids[b]][3]]); kom[a].push([b, d]); kom[b].push([a, d]); }
  const enUzak = s => { const dist = new Float64Array(n).fill(-1), yig = [s]; dist[s] = 0; let u = s;
    while (yig.length) { const x = yig.pop(); if (dist[x] > dist[u]) u = x; for (const [y, d] of kom[x]) if (dist[y] < 0) { dist[y] = dist[x] + d; yig.push(y); } } return [u, dist]; };
  const [a] = enUzak(0), [, uzak] = enUzak(a);
  const sira = [], gez = new Uint8Array(n), yig = [a];
  while (yig.length) {
    const x = yig.pop(); if (gez[x]) continue; gez[x] = 1; sira.push(ids[x]);
    // kısa dallar önce, ana hat en son: güzergâh dallara sapıp ana hatta devam eder
    kom[x].filter(([y]) => !gez[y]).sort((p, q) => uzak[q[0]] - uzak[p[0]]).forEach(([y]) => yig.push(y));
  }
  return sira;
}
function kolCizgi() {
  const k = kol.secili, E = eser.data.eser;
  const kenar = k && KOL_HAT.includes(k.ad) && k.ids.length >= 2 && k.ids.length <= KOL_CIZGI_SINIR ? kolAgKenar(k.ids) : [];
  const veri = { type: 'FeatureCollection', features: kenar.map(([a, b]) => ({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[E[k.ids[a]][2], E[k.ids[a]][3]], [E[k.ids[b]][2], E[k.ids[b]][3]]] } })) };
  if (!map.getSource('kol-cizgi')) {
    map.addSource('kol-cizgi', { type: 'geojson', data: veri });
    map.addLayer({ id: 'kol-cizgi', type: 'line', source: 'kol-cizgi', layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.6, 12, 3.5], 'line-opacity': 0.85, 'line-color': '#a8561a' } }, 'eser-nokta');
    // Yolculuk izi: geçilen güzergâh / bir önceki esere ince bağ
    map.addSource('kol-iz', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'kol-iz', type: 'line', source: 'kol-iz', layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 2.5, 12, 5], 'line-color': '#7a2418', 'line-opacity': ['coalesce', ['get', 'o'], 0.9] } }, 'eser-nokta');
    OWN.add('kol-cizgi'); OWN.add('kol-iz');
  } else map.getSource('kol-cizgi').setData(veri);
}

/* ----- Süzgeç: zaman süzgeciyle birleşir (zaman.js zamanUygula çağırır) ----- */
function kolFiltre() {
  const ids = kol.oynat ? kol.oynat.gorunen : kol.ids;
  return ids ? [['in', ['get', 'i'], ['literal', ids]]] : [];
}

function kolSec(k) {
  kolDur(true);
  map.getSource('kol-iz')?.setData({ type: 'FeatureCollection', features: [] }); // biten yolculuğun izi de silinir
  kol.secili = k; kol.ids = k ? k.ids : null;
  if (typeof zamanUygula === 'function') zamanUygula();
  kolCizgi();
  $('kol-bar').hidden = !k; document.body.classList.toggle('kol-acik', !!k);
  if (!k) return;
  kolSigdir(k.ids, 1500);
  kolBarCiz();
}
function kolSigdir(ids, sure) {
  const E = eser.data.eser, b = new maplibregl.LngLatBounds();
  ids.forEach(i => b.extend([E[i][2], E[i][3]]));
  map.fitBounds(b, { padding: { top: 170, bottom: 150, left: 40, right: 40 }, pitch: 0, bearing: 0, maxZoom: 15, duration: sure });
}
function kolBarAlt() {
  const k = kol.secili, o = kol.oynat, F = eser.data.feats;
  const i = o.sira[o.adim - 1], e = i != null ? eser.data.eser[i] : null, p = i != null ? F[i].properties : null;
  return o.tur === 'yil' ? `<b class="kol-yil">${p ? p.y : ''}</b> ${e ? esc(e[1]) : ''}${k.ad === 'Mimar Sinan Yapıları' && p ? ` · <em>${SINAN_DONEM(p.y)}</em>` : ''}`
    : `<b class="kol-yil">${o.adim}/${o.sira.length}</b> ${e ? esc(e[1]) : ''}`;
}
function kolBarCiz() {
  const k = kol.secili; if (!k) return;
  const F = eser.data.feats, yol = kolYolculuk(k), o = kol.oynat;
  const kesin = k.ids.map(i => F[i].properties).filter(p => p.x).map(p => p.y);
  const ilk = Math.min(...kesin), son = Math.max(...kesin), yy = y => y < 0 ? `MÖ ${-y}` : String(y);
  const alt = o ? kolBarAlt() : `${nf0.format(k.ids.length)} eser${kesin.length ? ` · ${yy(ilk)}–${yy(son)}` : ''}`;
  $('kol-bar').innerHTML = `<div class="kb-ust"><span class="ms">${k.tur === 'kultur' ? 'account_balance' : KOL_ROTA.includes(k.ad) ? 'route' : 'architecture'}</span>
    <div><b>${esc(k.ad)}</b><small>${alt}</small></div>
    ${yol && !o ? `<button class="kol-oynat" id="kol-oynat" aria-label="Yolculuğu oynat" title="${yol.tur === 'yil' ? `Yapım sırasıyla (${yol.kesin} eserin yılı kesin)` : 'Güzergâh boyunca'}"><span class="ms fill">play_arrow</span></button>` : ''}
    <button class="icon-btn" id="kol-liste" aria-label="Koleksiyon listesi"><span class="ms">list</span></button>
    <button class="icon-btn" id="kol-kapat" aria-label="Koleksiyonu kapat"><span class="ms">close</span></button></div>
    ${o ? `<div class="kb-kontrol">
      <button class="icon-btn" id="kol-geri" aria-label="Önceki eser" ${o.adim <= 1 ? 'disabled' : ''}><span class="ms fill">skip_previous</span></button>
      <button class="kol-oynat${o.durdu ? '' : ' on'}" id="kol-duraklat" aria-label="${o.durdu ? 'Devam et' : 'Duraklat'}"><span class="ms fill">${o.durdu ? 'play_arrow' : 'pause'}</span></button>
      <button class="icon-btn" id="kol-ileri" aria-label="Sonraki eser" ${o.adim >= o.sira.length ? 'disabled' : ''}><span class="ms fill">skip_next</span></button>
      <i class="kb-ilerleme"><b style="width:${100 * o.adim / o.sira.length}%"></b></i>
      <button class="kb-hiz" id="kol-hiz" aria-label="Hız">${kolHizYaz(o.hiz)}</button>
      <button class="icon-btn" id="kol-bitir" aria-label="Yolculuğu bitir"><span class="ms fill">stop</span></button>
    </div>` : ''}`;
  $('kol-kapat').onclick = () => kolSec(null);
  $('kol-liste').onclick = () => kolEserListe(k);
  const ob = $('kol-oynat'); if (ob) ob.onclick = () => kolOynat();
  if (o) {
    // adım düğmeleri oynatmayı duraklatır: tek tek, istediğin hızda ilerle
    $('kol-geri').onclick = () => { kolDuraklat(true); kolAdim(-1); };
    $('kol-ileri').onclick = () => { kolDuraklat(true); kolAdim(1); };
    $('kol-duraklat').onclick = () => kolDuraklat();
    $('kol-hiz').onclick = () => kolHiz();
    $('kol-bitir').onclick = () => kolDur();
  }
}

/* ----- Yolculuğu oynat: hız ayarlı, duraklatılabilir, adım adım ileri/geri ----- */
const KOL_HIZ = [0.25, 0.5, 1, 2, 4];
const kolHizYaz = h => h === 0.25 ? '¼×' : h === 0.5 ? '½×' : h + '×';
function kolOynat() {
  const k = kol.secili, yol = kolYolculuk(k); if (!yol) return;
  const n = yol.sira.length;
  kol.oynat = { ...yol, adim: 0, gorunen: [], iz: [], zaman: null, durdu: false,
    temel: Math.max(110, Math.min(900, 26000 / n)), // 1× hızda adım süresi: uzun koleksiyonlar daha hızlı akar
    hiz: store.get('kol_hiz', 1) };
  map.getSource('kol-iz')?.setData({ type: 'FeatureCollection', features: [] });
  if (map.getLayer('kol-cizgi')) map.setPaintProperty('kol-cizgi', 'line-opacity', 0.25); // güzergâh silik, geçilen kısım koyu
  if (typeof zamanUygula === 'function') zamanUygula();
  kolSigdir(yol.sira, 900);
  kolBarCiz(); kolAdim(1); kolZamanla();
}
function kolZamanla() {
  const o = kol.oynat; if (!o) return;
  clearTimeout(o.zaman);
  if (o.durdu) return;
  o.zaman = setTimeout(() => { if (!kol.oynat) return; if (o.adim >= o.sira.length) { kolDur(); return; } kolAdim(1); kolZamanla(); }, o.temel / o.hiz);
}
// yon: +1 bir sonraki eser, -1 bir önceki
function kolAdim(yon) {
  const o = kol.oynat, E = eser.data.eser; if (!o) return;
  if (yon > 0) {
    if (o.adim >= o.sira.length) return;
    const i = o.sira[o.adim], once = o.adim ? o.sira[o.adim - 1] : null;
    o.adim++; o.gorunen.push(i);
    if (once != null) o.iz.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[E[once][2], E[once][3]], [E[i][2], E[i][3]]] }, properties: {} });
  } else {
    if (o.adim <= 1) return;
    o.adim--; o.gorunen.pop(); o.iz.pop();
  }
  const i = o.sira[o.adim - 1];
  zamanUygula();
  eserSecimGoster([E[i][2], E[i][3]]);
  // rotada geçilen yol kalır; yapım yolculuğunda yalnızca son birkaç bağ, giderek silikleşir
  const goster = o.tur === 'rota' ? o.iz : o.iz.slice(-4).map((f, j, L) => ({ ...f, properties: { o: 0.2 + 0.7 * (j + 1) / L.length } }));
  map.getSource('kol-iz').setData({ type: 'FeatureCollection', features: goster });
  // görünüm dışına çıkan eserde kamera kayar
  const p = map.project([E[i][2], E[i][3]]), c = map.getContainer();
  if (p.x < 40 || p.y < 200 || p.x > c.clientWidth - 40 || p.y > c.clientHeight - 150) map.easeTo({ center: [E[i][2], E[i][3]], duration: Math.min(800, o.temel / o.hiz * 0.9) });
  if (document.getElementById('kol-geri')) kolBarGuncelle(); else kolBarCiz();
}
// Oynatma sırasında şerit yeniden çizilmez (düğmeler parmağın altından kaybolmasın): yalnızca yazı, ilerleme ve düğme durumları
function kolBarGuncelle() {
  const o = kol.oynat; if (!o) return;
  const sm = document.querySelector('#kol-bar .kb-ust small'); if (sm) sm.innerHTML = kolBarAlt();
  const b = document.querySelector('#kol-bar .kb-ilerleme b'); if (b) b.style.width = `${100 * o.adim / o.sira.length}%`;
  $('kol-geri').disabled = o.adim <= 1; $('kol-ileri').disabled = o.adim >= o.sira.length;
  const d = $('kol-duraklat'); d.classList.toggle('on', !o.durdu); d.setAttribute('aria-label', o.durdu ? 'Devam et' : 'Duraklat'); d.querySelector('.ms').textContent = o.durdu ? 'play_arrow' : 'pause';
  $('kol-hiz').textContent = kolHizYaz(o.hiz);
}
function kolDuraklat(d = !kol.oynat?.durdu) { const o = kol.oynat; if (!o) return; o.durdu = d; if (!d && o.adim >= o.sira.length) { kolDur(true); kolOynat(); return; } kolZamanla(); kolBarGuncelle(); }
function kolHiz() { const o = kol.oynat; if (!o) return; o.hiz = KOL_HIZ[(KOL_HIZ.indexOf(o.hiz) + 1) % KOL_HIZ.length] || 1; store.set('kol_hiz', o.hiz); kolZamanla(); kolBarGuncelle(); }
function kolDur(sessiz) {
  const o = kol.oynat; if (!o) return;
  clearTimeout(o.zaman); kol.oynat = null;
  if (map.getLayer('kol-cizgi')) map.setPaintProperty('kol-cizgi', 'line-opacity', 0.85);
  if (sessiz || o.tur === 'yil') map.getSource('kol-iz')?.setData({ type: 'FeatureCollection', features: [] }); // rotada geçilen yol kalır
  eserSecimGoster(null);
  if (typeof zamanUygula === 'function') zamanUygula(); // koleksiyonun tamamı geri gelir
  if (!sessiz) kolBarCiz();
}

/* ----- Paneller ----- */
function kolPanel() {
  if (!eser.data) return;
  const L = kolListe();
  const satir = k => { const yol = kolYolculuk(k); return `<button class="kol-satir" data-tur="${k.tur}" data-ad="${esc(k.ad)}">${yol ? '<span class="ms fill kol-oynat-im">play_circle</span>' : ''}<b>${esc(k.ad)}</b><small>${nf0.format(k.ids.length)}</small></button>`; };
  const grup = (baslik, ic, liste) => liste.length ? `<div class="g-bolum"><h3><span class="ms">${ic}</span>${baslik}</h3><div class="kol-izgara">${liste.map(satir).join('')}</div></div>` : '';
  const render = el => {
    el.innerHTML = `<div class="place-head drag-zone"><h1 class="eser-ad">Koleksiyonlar</h1><div class="sub">Bir mimarın, rotanın ya da hanedanın eserleri haritada tek başına. <span class="ms fill kol-oynat-im">play_circle</span> işaretlilerde yolculuk oynatılabilir.</div></div>
      ${grup('Mimarlar', 'architecture', L.mimar)}${grup('Rotalar ve hatlar', 'route', L.rota)}${grup('Hanedan ve kültürler', 'account_balance', L.hanedan)}${grup('Temalar', 'collections_bookmark', L.diger)}`;
    el.querySelectorAll('.kol-satir').forEach(b => { b.onclick = () => {
      const liste = b.dataset.tur === 'kultur' ? L.hanedan : [...L.mimar, ...L.rota, ...L.diger];
      closePanel(); kolSec(liste.find(k => k.ad === b.dataset.ad));
    }; });
  };
  render.mode = 'list';
  openPanel(render, { mode: 'list', sheet: 'full' });
  requestAnimationFrame(() => setSheet('full')); // çipe dokunuş harita tıklamasıyla yarışmasın
}
function kolEserListe(k) {
  const E = eser.data.eser, F = eser.data.feats, yol = kolYolculuk(k), yy = y => y < 0 ? `MÖ ${-y}` : String(y);
  // sıra: yolculuk sırası (varsa), ardından kalanlar şehre göre
  const ilk = yol ? yol.sira : [], kalan = k.ids.filter(i => !ilk.includes(i)).sort((a, b) => eserYer(E[a][11]).localeCompare(eserYer(E[b][11]), 'tr'));
  const sira = [...ilk, ...kalan];
  const render = el => {
    el.innerHTML = `<div class="place-head drag-zone"><h1 class="eser-ad">${esc(k.ad)}</h1><div class="sub">${nf0.format(k.ids.length)} eser · ${yol ? (yol.tur === 'yil' ? 'yapım sırasıyla' : 'güzergâh sırasıyla') : 'şehre göre'}</div></div>
      <div class="g-bolum">${sira.slice(0, 500).map((i, n) => { const e = E[i], a = ESER_AILE[e[13]], p = F[i].properties;
        return `<button class="g-satir" data-i="${i}"><i style="--c:${a.renk}"><svg viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="${ESER_GLYPH[a.simge]}"/></svg></i><span><b>${esc(e[1])}</b><small>${p.x ? yy(p.y) + ' · ' : ''}${esc(eserYer(e[11]))}</small></span></button>`; }).join('')}</div>`;
    el.querySelectorAll('[data-i]').forEach(b => { b.onclick = () => eserGoster(+b.dataset.i); });
  };
  render.mode = 'list';
  openPanel(render, { mode: 'list', sheet: 'peek' });
}

/* ----- Kartta: eserin temaları dokunulabilir çip olarak ----- */
function kolKartHtml(e) {
  const S = eser.data.sozluk, t = (e[10] || []).map(x => S.tema[x]).filter(Boolean);
  if (!t.length) return '';
  return `<div class="kol-kart"><span class="ms">collections_bookmark</span><div>${t.map(ad => `<button class="kol-cip" data-kol="${esc(ad)}">${esc(ad)}</button>`).join('')}</div></div>`;
}
function kolKartBagla(el) {
  el.querySelectorAll('[data-kol]').forEach(b => { b.onclick = () => {
    const L = kolListe(), k = [...L.mimar, ...L.rota, ...L.diger].find(x => x.ad === b.dataset.kol);
    if (k) { closePanel(); kolSec(k); }
  }; });
}
