// ATLAS3D — Koleksiyonlar: bir mimarın, bir rotanın, bir hanedanın ya da bir temanın eserlerini haritada tek başına gösterir
// ve yakın eserleri bir bağlantı ağıyla birleştirir; ağın rengi yapım sırasını gösterir (açık erken, koyu geç). Kaynak: Kültür Envanteri temaları ve kültürleri.
'use strict';

const kol = { secili: null, ids: null };
const KOL_ROTA = ['İpek Yolu', 'Camino de Santiago', 'Hicaz Demiryolu', 'Evliya Çelebi', 'Via Egnatia', 'Taksim Su Yolu', 'Kültür Rotaları', 'Çakmak Hattı',
  'İstanbul Surları', 'Galata Surları', 'Kurtuluş Savaşı Cepheleri', 'Çanakkale Savaşı', 'Sakarya Meydan Muharebesi', 'Büyük Taarruz', 'Başkomutanlık Meydan Muharebesi', 'Taş Tepeler', 'Bin Tepeler'];
const kolMimarMi = ad => / (Yapıları|Eserleri)$|Ailesi|Balyan/.test(ad) && !/Akımı/.test(ad);
const KOL_CIZGI_SINIR = 700; // bundan büyük koleksiyonlarda çizgi çekilmez (yalnızca süzme)

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

/* ----- Süzgeç: zaman süzgeciyle birleşir (zaman.js zamanUygula çağırır) ----- */
function kolFiltre() { return kol.ids ? [['in', ['get', 'i'], ['literal', kol.ids]]] : []; }

function kolSec(k) {
  kol.secili = k; kol.ids = k ? k.ids : null;
  if (typeof zamanUygula === 'function') zamanUygula();
  kolCizgi();
  $('kol-bar').hidden = !k; document.body.classList.toggle('kol-acik', !!k);
  if (!k) return;
  const E = eser.data.eser, b = new maplibregl.LngLatBounds();
  k.ids.forEach(i => b.extend([E[i][2], E[i][3]]));
  map.fitBounds(b, { padding: { top: 150, bottom: 140, left: 40, right: 40 }, pitch: 0, bearing: 0, maxZoom: 15, duration: 1500 });
  const yillar = k.ids.map(i => eser.data.feats[i].properties).filter(p => p.y != null && p.k === 0).map(p => p.y); // yalnızca kesin tarihler
  const ilk = Math.min(...yillar), son = Math.max(...yillar), yy = y => y < 0 ? `MÖ ${-y}` : String(y);
  $('kol-bar').innerHTML = `<span class="ms">${k.tur === 'kultur' ? 'account_balance' : KOL_ROTA.includes(k.ad) ? 'route' : 'architecture'}</span>
    <div><b>${esc(k.ad)}</b><small>${nf0.format(k.ids.length)} eser${yillar.length ? ` · ${yy(ilk)}–${yy(son)}` : ''}</small></div>
    <button class="icon-btn" id="kol-liste" aria-label="Koleksiyon listesi"><span class="ms">list</span></button>
    <button class="icon-btn" id="kol-kapat" aria-label="Koleksiyonu kapat"><span class="ms">close</span></button>`;
  $('kol-kapat').onclick = () => kolSec(null);
  $('kol-liste').onclick = () => kolEserListe(k);
}

// Yapım sırası: tarihi olanlar yıla göre; tarihsizler en sona, bir öncekine en yakın sırayla
function kolSira(ids) {
  const F = eser.data.feats, E = eser.data.eser;
  const tarihli = ids.filter(i => F[i].properties.y != null).sort((a, b) => F[a].properties.y - F[b].properties.y);
  const kalan = ids.filter(i => F[i].properties.y == null);
  const sira = [...tarihli];
  let son = sira.length ? sira[sira.length - 1] : kalan.shift();
  if (!sira.length && son != null) sira.push(son);
  while (kalan.length) {
    let en = 0, ed = Infinity;
    kalan.forEach((i, k) => { const d = haversine([E[son][2], E[son][3]], [E[i][2], E[i][3]]); if (d < ed) { ed = d; en = k; } });
    son = kalan.splice(en, 1)[0]; sira.push(son);
  }
  return sira;
}
// Bağlantı ağı: en kısa toplam uzunluklu ağaç (Prim). Zikzak yapmaz; yakın eserler birbirine bağlanır.
// Her kenar iki ucunun yapım yılına göre renklenir: açık altın erken, koyu kırmızı geç; tarihsiz kenar gri.
function kolAg(ids) {
  const E = eser.data.eser, F = eser.data.feats, n = ids.length;
  const xy = ids.map(i => [E[i][2] * Math.cos(E[i][3] * Math.PI / 180), E[i][3]]);
  const ic = new Uint8Array(n), en = new Float64Array(n).fill(Infinity), kim = new Int32Array(n).fill(-1), kenar = [];
  en[0] = 0;
  for (let t = 0; t < n; t++) {
    let u = -1; for (let v = 0; v < n; v++) if (!ic[v] && (u < 0 || en[v] < en[u])) u = v;
    ic[u] = 1;
    if (kim[u] >= 0) {
      const a = ids[u], b = ids[kim[u]], ya = F[a].properties.y, yb = F[b].properties.y;
      kenar.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: [[E[a][2], E[a][3]], [E[b][2], E[b][3]]] },
        properties: ya != null && yb != null ? { y: Math.max(ya, yb) } : {} });
    }
    for (let v = 0; v < n; v++) if (!ic[v]) { const d = (xy[u][0] - xy[v][0]) ** 2 + (xy[u][1] - xy[v][1]) ** 2; if (d < en[v]) { en[v] = d; kim[v] = u; } }
  }
  return kenar;
}
function kolCizgi() {
  const k = kol.secili;
  const kenar = k && k.ids.length >= 2 && k.ids.length <= KOL_CIZGI_SINIR ? kolAg(k.ids) : [];
  const ys = kenar.map(f => f.properties.y).filter(y => y != null), y0 = Math.min(...ys, 0), y1 = Math.max(...ys, 1);
  const veri = { type: 'FeatureCollection', features: kenar };
  const renk = ys.length ? ['case', ['has', 'y'], ['interpolate', ['linear'], ['get', 'y'], y0, '#e8c46a', (y0 + y1) / 2, '#c26a1a', y1 === y0 ? y0 + 1 : y1, '#7a2418'], '#a8a39a'] : '#c26a1a';
  if (!map.getSource('kol-cizgi')) {
    map.addSource('kol-cizgi', { type: 'geojson', data: veri });
    map.addLayer({ id: 'kol-cizgi', type: 'line', source: 'kol-cizgi', layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: { 'line-width': ['interpolate', ['linear'], ['zoom'], 3, 1.6, 12, 3.5], 'line-opacity': 0.9, 'line-color': renk } }, 'eser-nokta');
    OWN.add('kol-cizgi');
  } else { map.getSource('kol-cizgi').setData(veri); map.setPaintProperty('kol-cizgi', 'line-color', renk); }
}

/* ----- Paneller ----- */
function kolPanel() {
  if (!eser.data) return;
  const L = kolListe();
  const satir = k => `<button class="kol-satir" data-tur="${k.tur}" data-ad="${esc(k.ad)}"><b>${esc(k.ad)}</b><small>${nf0.format(k.ids.length)}</small></button>`;
  const grup = (baslik, ic, liste) => liste.length ? `<div class="g-bolum"><h3><span class="ms">${ic}</span>${baslik}</h3><div class="kol-izgara">${liste.map(satir).join('')}</div></div>` : '';
  const render = el => {
    el.innerHTML = `<div class="place-head drag-zone"><h1 class="eser-ad">Koleksiyonlar</h1><div class="sub">Bir mimarın, rotanın ya da hanedanın eserleri haritada tek başına; yakın eserler birbirine bağlanır, renk yapım sırasını gösterir.</div></div>
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
  const E = eser.data.eser, F = eser.data.feats, sira = kolSira(k.ids), yy = y => y < 0 ? `MÖ ${-y}` : String(y);
  const render = el => {
    el.innerHTML = `<div class="place-head drag-zone"><h1 class="eser-ad">${esc(k.ad)}</h1><div class="sub">${nf0.format(k.ids.length)} eser · yapım sırasıyla</div></div>
      <div class="g-bolum">${sira.slice(0, 400).map((i, n) => { const e = E[i], a = ESER_AILE[e[13]], y = F[i].properties.y;
        return `<button class="g-satir" data-i="${i}"><i style="--c:${a.renk}"><svg viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="${ESER_GLYPH[a.simge]}"/></svg></i><span><b>${esc(e[1])}</b><small>${y != null ? (F[i].properties.k === 2 ? '~' : '') + yy(y) + ' · ' : ''}${esc(eserYer(e[11]))}</small></span></button>`; }).join('')}</div>`;
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
