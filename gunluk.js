// ATLAS3D — Gezi günlüğü: gittim / gideceğim işaretleri, konuma göre otomatik "gittim", rozetler,
// eserlere kişisel not ve fotoğraf, yakındaki eserler listesi ve gideceklerden günlük rota (OSRM trip).
// Her şey bu cihazda saklanır: işaretler ve notlar localStorage'da, fotoğraflar IndexedDB'de.
'use strict';

const gunluk = { kayit: store.get('eser_gunluk', {}), rota: null, rotaMod: store.get('gunluk_rota_mod', 'foot') };
// kayit[eserKimligi] = { d: 'gittim' | 'gidecegim', t: zaman, oto: konumdan mı, not: '' }
const gKaydet = () => store.set('eser_gunluk', gunluk.kayit);
const gKimlik = i => String(eser.data.eser[i][0]);
const gIndeks = id => eser.data.eser.findIndex(e => String(e[0]) === String(id));

/* ----- Fotoğraflar: IndexedDB (küçültülmüş JPEG) ----- */
let gDb = null;
function gFotoDb() {
  if (gDb) return gDb;
  gDb = new Promise((ok, err) => {
    const r = indexedDB.open('atlas3d-gunluk', 1);
    r.onupgradeneeded = () => { const s = r.result.createObjectStore('foto', { keyPath: 'k', autoIncrement: true }); s.createIndex('eser', 'eser'); };
    r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error);
  });
  return gDb;
}
async function gFotoListe(id) {
  try {
    const db = await gFotoDb();
    return await new Promise(ok => { const q = db.transaction('foto').objectStore('foto').index('eser').getAll(String(id)); q.onsuccess = () => ok(q.result || []); q.onerror = () => ok([]); });
  } catch { return []; }
}
async function gFotoEkle(id, file) {
  const img = await createImageBitmap(file);
  const k = Math.min(1, 1600 / Math.max(img.width, img.height));
  const c = document.createElement('canvas'); c.width = Math.round(img.width * k); c.height = Math.round(img.height * k);
  c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
  const blob = await new Promise(ok => c.toBlob(ok, 'image/jpeg', 0.82));
  const db = await gFotoDb();
  await new Promise((ok, err) => { const tx = db.transaction('foto', 'readwrite'); tx.objectStore('foto').add({ eser: String(id), blob, t: Date.now() }); tx.oncomplete = ok; tx.onerror = () => err(tx.error); });
}
async function gFotoSil(k) {
  const db = await gFotoDb();
  await new Promise(ok => { const tx = db.transaction('foto', 'readwrite'); tx.objectStore('foto').delete(k); tx.oncomplete = ok; tx.onerror = ok; });
}
async function gFotoSayisi() {
  try { const db = await gFotoDb(); return await new Promise(ok => { const q = db.transaction('foto').objectStore('foto').count(); q.onsuccess = () => ok(q.result); q.onerror = () => ok(0); }); } catch { return 0; }
}

/* ----- İşaretler ve haritadaki halkalar ----- */
function gIsaretle(id, d, oto = false) {
  const r = gunluk.kayit[id] || {};
  if (r.d === d && !oto) delete r.d; else { r.d = d; r.t = Date.now(); r.oto = oto; }
  if (!r.d && !r.not) delete gunluk.kayit[id]; else gunluk.kayit[id] = r;
  gKaydet(); gKatmanGuncelle();
}
function gKatmanGuncelle() {
  if (!map?.getSource || !eser.data) return;
  const feats = [];
  for (const [id, r] of Object.entries(gunluk.kayit)) {
    if (!r.d) continue;
    const i = gIndeks(id); if (i < 0) continue;
    const e = eser.data.eser[i];
    feats.push({ type: 'Feature', geometry: { type: 'Point', coordinates: [e[2], e[3]] }, properties: { d: r.d } });
  }
  const data = { type: 'FeatureCollection', features: feats };
  if (map.getSource('eser-gunluk')) { map.getSource('eser-gunluk').setData(data); return; }
  if (!map.getLayer('eser-nokta')) return;
  map.addSource('eser-gunluk', { type: 'geojson', data });
  // Gittiğim eserler altın, gideceklerim mavi halka; uzaktan da küçük nokta olarak görünür
  map.addLayer({ id: 'eser-gunluk', type: 'circle', source: 'eser-gunluk',
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 3, 3, 10, 6, 14, 15, 18, 19],
      'circle-color': ['match', ['get', 'd'], 'gittim', 'rgba(201,162,39,.25)', 'rgba(26,115,232,.18)'],
      'circle-stroke-width': ['interpolate', ['linear'], ['zoom'], 3, 1.5, 14, 3],
      'circle-stroke-color': ['match', ['get', 'd'], 'gittim', '#c9a227', '#1a73e8'] } }, 'eser-nokta');
  OWN.add('eser-gunluk');
}
const gEski = setEser; // eser katmanı açılınca/kapanınca günlük halkaları da
setEser = async function (on) { await gEski(on); if (map.getLayer('eser-gunluk')) map.setLayoutProperty('eser-gunluk', 'visibility', on ? 'visible' : 'none'); if (on) gKatmanGuncelle(); };
$('eser-btn').onclick = e => { e.stopPropagation(); setEser(!eser.on); };

/* ----- Konuma göre otomatik "gittim": bir eserin 70 m yakınına gelince ----- */
let gSonKontrol = 0;
meListeners.add(() => {
  if (!eser.data || !meLngLat || Date.now() - gSonKontrol < 5000) return;
  gSonKontrol = Date.now();
  const [lon, lat] = meLngLat, dLat = 0.0007, dLon = 0.0007 / Math.cos(lat * Math.PI / 180);
  for (const e of eser.data.eser) {
    if (Math.abs(e[3] - lat) > dLat || Math.abs(e[2] - lon) > dLon) continue;
    const id = String(e[0]);
    if (gunluk.kayit[id]?.d === 'gittim') continue;
    if (haversine([lon, lat], [e[2], e[3]]) <= 70) { gIsaretle(id, 'gittim', true); toast(`Gittin: ${e[1]} ✓`, 3500); }
  }
});

/* ----- Eser kartı: işaretler, not, fotoğraflar ----- */
function gKartHtml(id) {
  const r = gunluk.kayit[id] || {};
  const tarih = r.t ? new Date(r.t).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  return `<section class="g-kart">
    <div class="g-isaret">
      <button class="g-pill${r.d === 'gittim' ? ' on gittim' : ''}" data-g="gittim"><span class="ms${r.d === 'gittim' ? ' fill' : ''}">where_to_vote</span>${r.d === 'gittim' ? `Gittim · ${tarih}` : 'Gittim'}</button>
      <button class="g-pill${r.d === 'gidecegim' ? ' on gidecegim' : ''}" data-g="gidecegim"><span class="ms${r.d === 'gidecegim' ? ' fill' : ''}">star</span>Gideceğim</button>
    </div>
    <label class="g-not"><span>Notum</span><textarea rows="2" placeholder="Bu eserle ilgili notun…">${esc(r.not || '')}</textarea></label>
    <div class="g-foto"><span>Fotoğraflarım</span><div class="g-foto-izgara"><label class="g-foto-ekle"><span class="ms">add_a_photo</span><input type="file" accept="image/*" multiple hidden></label></div></div>
  </section>`;
}
function gKartBagla(el, id, yenidenCiz) {
  el.querySelectorAll('[data-g]').forEach(b => { b.onclick = () => { gIsaretle(id, b.dataset.g); yenidenCiz(); }; });
  const ta = el.querySelector('.g-not textarea');
  ta.oninput = debounce(() => {
    const r = gunluk.kayit[id] || {}; r.not = ta.value.trim();
    if (!r.d && !r.not) delete gunluk.kayit[id]; else gunluk.kayit[id] = r;
    gKaydet();
  }, 400);
  const izgara = el.querySelector('.g-foto-izgara');
  const ciz = async () => {
    const fotolar = await gFotoListe(id);
    izgara.querySelectorAll('.g-foto-kucuk').forEach(x => { URL.revokeObjectURL(x.dataset.url); x.remove(); });
    for (const f of fotolar.sort((a, b) => b.t - a.t)) {
      const url = URL.createObjectURL(f.blob), b = document.createElement('button');
      b.className = 'g-foto-kucuk'; b.dataset.url = url; b.style.backgroundImage = `url(${url})`; b.setAttribute('aria-label', 'Fotoğrafı aç');
      b.onclick = () => gFotoGoster(url, async () => { await gFotoSil(f.k); ciz(); });
      izgara.appendChild(b);
    }
  };
  izgara.querySelector('input').onchange = async ev => {
    for (const f of ev.target.files) { try { await gFotoEkle(id, f); } catch { toast('Fotoğraf eklenemedi.'); } }
    if (!gunluk.kayit[id]?.d) gIsaretle(id, 'gittim'); // fotoğraf eklenen yere gidilmiştir
    ciz(); yenidenCiz?.(true);
  };
  ciz();
}
function gFotoGoster(url, sil) {
  const o = document.createElement('div'); o.className = 'g-foto-buyuk';
  o.innerHTML = `<img src="${url}" alt=""><div><button class="icon-btn" data-x="sil" aria-label="Fotoğrafı sil"><span class="ms">delete</span></button><button class="icon-btn" data-x="kapat" aria-label="Kapat"><span class="ms">close</span></button></div>`;
  o.onclick = async ev => {
    const x = ev.target.closest('[data-x]')?.dataset.x;
    if (x === 'sil') { if (confirm('Bu fotoğraf silinsin mi?')) { await sil(); o.remove(); } return; }
    if (x === 'kapat' || ev.target === o) o.remove();
  };
  document.body.appendChild(o);
}

/* ----- Rozetler ----- */
function gRozetler() {
  const gittim = Object.entries(gunluk.kayit).filter(([, r]) => r.d === 'gittim').map(([id]) => gIndeks(id)).filter(i => i >= 0);
  const E = eser.data.eser, S = eser.data.sozluk;
  const aile = new Array(ESER_AILE.length).fill(0); gittim.forEach(i => aile[E[i][13]]++);
  const esik = [1, 10, 50, 100, 500];
  const roz = [];
  const kademe = n => esik.filter(x => n >= x).pop() || 0, sonraki = n => esik.find(x => n < x);
  roz.push({ ad: 'Gezgin', renk: '#c9a227', simge: 'diger', n: gittim.length, kademe: kademe(gittim.length), sonraki: sonraki(gittim.length), birim: 'eser' });
  ESER_AILE.forEach((a, k) => { if (aile[k]) roz.push({ ad: a.ad, renk: a.renk, simge: a.simge, n: aile[k], kademe: kademe(aile[k]), sonraki: sonraki(aile[k]), birim: 'eser' }); });
  // Temalar (Mimar Sinan yapıları, UNESCO, Ulu camiler…): başlanan temalarda ilerleme
  const tema = new Map(); gittim.forEach(i => (E[i][10] || []).forEach(t => tema.set(t, (tema.get(t) || 0) + 1)));
  const temaToplam = new Map(); E.forEach(e => (e[10] || []).forEach(t => tema.has(t) && temaToplam.set(t, (temaToplam.get(t) || 0) + 1)));
  const temalar = [...tema].map(([t, n]) => ({ ad: S.tema[t] || 'Tema', n, toplam: temaToplam.get(t) })).sort((a, b) => b.n / b.toplam - a.n / a.toplam);
  // Ülke ve şehir sayısı
  const Y = S.yer, il = new Set(), ulke = new Set();
  gittim.forEach(i => { let y = E[i][11], zincir = []; while (Y[y]) { zincir.push(Y[y][0]); y = Y[y][1]; } if (zincir.length) { ulke.add(zincir[zincir.length - 1]); const z = zincir.filter(x => !/ Bölgesi$/.test(x)); if (z.length >= 2) il.add(z[z.length - 2]); } });
  return { gittim, roz, temalar, il: il.size, ulke: ulke.size };
}

/* ----- Günlük paneli: istatistik, rozetler, gideceklerim (rota), gittiklerim ----- */
async function gunlukPanel() {
  if (!eser.data) return;
  const foto = await gFotoSayisi();
  const render = el => {
    const R = gRozetler(), E = eser.data.eser;
    const gidecek = Object.entries(gunluk.kayit).filter(([, r]) => r.d === 'gidecegim').map(([id, r]) => [gIndeks(id), r]).filter(([i]) => i >= 0);
    const gittim = Object.entries(gunluk.kayit).filter(([, r]) => r.d === 'gittim').map(([id, r]) => [gIndeks(id), r]).filter(([i]) => i >= 0).sort((a, b) => b[1].t - a[1].t);
    const satir = ([i, r]) => { const e = E[i], a = ESER_AILE[e[13]]; return `<button class="g-satir" data-i="${i}"><i style="--c:${a.renk}"><svg viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="${ESER_GLYPH[a.simge]}"/></svg></i><span><b>${esc(e[1])}</b><small>${esc(eserYer(e[11]) || e[15] || '')}${r.t && r.d === 'gittim' ? ' · ' + new Date(r.t).toLocaleDateString('tr-TR') : ''}${r.not ? ' · 📝' : ''}</small></span></button>`; };
    const rozet = r => `<div class="g-rozet${r.kademe ? '' : ' kilitli'}" style="--c:${r.renk}"><i><svg viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="${ESER_GLYPH[r.simge]}"/></svg>${r.kademe ? `<em>${r.kademe}</em>` : ''}</i><b>${esc(r.ad)}</b><small>${r.n}${r.sonraki ? ' / ' + r.sonraki : ''} ${r.birim}</small></div>`;
    el.innerHTML = `
      <div class="place-head drag-zone"><h1 class="eser-ad">Gezi günlüğüm</h1>
        <div class="g-stat"><span><b>${R.gittim.length}</b>eser</span><span><b>${R.il}</b>şehir</span><span><b>${R.ulke}</b>ülke</span><span><b>${foto}</b>fotoğraf</span></div></div>
      <div class="g-bolum"><h3>Rozetler</h3><div class="g-rozetler">${R.roz.map(rozet).join('')}</div>
        ${R.temalar.length ? `<div class="g-temalar">${R.temalar.slice(0, 6).map(t => `<div class="g-tema"><span>${esc(t.ad)}</span><small>${t.n} / ${t.toplam}</small><i><b style="width:${Math.min(100, 100 * t.n / t.toplam)}%"></b></i></div>`).join('')}</div>` : ''}</div>
      <div class="g-bolum"><h3>Gideceklerim <small>${gidecek.length}</small></h3>
        ${gidecek.length >= 2 ? `<div class="g-rota-bar"><div class="zp-mod"><button data-mod="foot" class="${gunluk.rotaMod === 'foot' ? 'on' : ''}">Yürüyüş</button><button data-mod="car" class="${gunluk.rotaMod === 'car' ? 'on' : ''}">Araç</button></div><button class="g-rota-btn" id="g-rota"><span class="ms">route</span>En kısa rotayı çiz</button></div>` : ''}
        ${gidecek.length ? gidecek.map(satir).join('') : '<div class="g-bos">Bir eser kartında "Gideceğim"e dokun; burada toplanır ve günlük rotaya dönüşür.</div>'}</div>
      <div class="g-bolum"><h3>Gittiklerim <small>${gittim.length}</small></h3>
        ${gittim.length ? gittim.slice(0, 200).map(satir).join('') : '<div class="g-bos">Bir esere gittiğinde kartından işaretle; konumun açıksa 70 m yakınına gelince kendiliğinden işaretlenir.</div>'}</div>`;
    el.querySelectorAll('[data-i]').forEach(b => { b.onclick = () => eserGoster(+b.dataset.i); });
    el.querySelectorAll('[data-mod]').forEach(b => { b.onclick = () => { gunluk.rotaMod = b.dataset.mod; store.set('gunluk_rota_mod', gunluk.rotaMod); render(el); }; });
    const rb = $('g-rota'); if (rb) rb.onclick = () => gRotaCiz(gidecek.map(([i]) => i));
  };
  render.mode = 'list';
  openPanel(render, { mode: 'list', sheet: 'full' });
}

/* ----- Günlük rota: gideceklerden en kısa sıra (başlangıç: konumun, yoksa ilk eser) ----- */
async function gRotaCiz(indeksler) {
  let pts = indeksler.slice(0, 11).map(i => ({ i, lon: eser.data.eser[i][2], lat: eser.data.eser[i][3] }));
  let bas = null;
  try { const me = meLngLat || null; if (me) bas = { lon: me[0], lat: me[1], ben: true }; } catch {}
  if (!bas) { // konum yoksa haritanın merkezine en yakın eserden başla
    const c = map.getCenter(); pts.sort((a, b) => haversine([c.lng, c.lat], [a.lon, a.lat]) - haversine([c.lng, c.lat], [b.lon, b.lat])); bas = pts.shift();
  }
  const tum = [bas, ...pts];
  toast('Rota hesaplanıyor…', 4000);
  try {
    const r = await fetch('/api/trip?' + new URLSearchParams({ mode: gunluk.rotaMod, coords: tum.map(p => `${p.lon.toFixed(6)},${p.lat.toFixed(6)}`).join(';') }));
    const d = await r.json(); if (d.code !== 'Ok') throw new Error(d.code);
    const sira = d.waypoints.map((w, k) => ({ ...tum[k], s: w.waypoint_index })).sort((a, b) => a.s - b.s);
    gunluk.rota = { sira, trip: d.trips[0] };
    gRotaKatman(); gRotaPanel();
  } catch { toast('Rota hesaplanamadı. Bağlantını kontrol edip yeniden dene.'); }
}
function gRotaKatman() {
  const { sira, trip } = gunluk.rota;
  const nokta = { type: 'FeatureCollection', features: sira.map((p, k) => ({ type: 'Feature', geometry: { type: 'Point', coordinates: [p.lon, p.lat] }, properties: { n: p.ben ? '' : String(k + (sira[0].ben ? 0 : 1)) } })) };
  const cizgi = { type: 'Feature', geometry: trip.geometry };
  if (map.getSource('g-rota')) { map.getSource('g-rota').setData(cizgi); map.getSource('g-rota-n').setData(nokta); }
  else {
    map.addSource('g-rota', { type: 'geojson', data: cizgi }); map.addSource('g-rota-n', { type: 'geojson', data: nokta });
    map.addLayer({ id: 'g-rota-hale', type: 'line', source: 'g-rota', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#fff', 'line-width': 8 } });
    map.addLayer({ id: 'g-rota', type: 'line', source: 'g-rota', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#1a73e8', 'line-width': 4.5 } });
    map.addLayer({ id: 'g-rota-n', type: 'circle', source: 'g-rota-n', paint: { 'circle-radius': 11, 'circle-color': '#1a73e8', 'circle-stroke-color': '#fff', 'circle-stroke-width': 2 } });
    map.addLayer({ id: 'g-rota-no', type: 'symbol', source: 'g-rota-n', layout: { 'text-field': ['get', 'n'], 'text-font': ['Noto Sans Bold'], 'text-size': 12, 'text-allow-overlap': true }, paint: { 'text-color': '#fff' } });
    ['g-rota-hale', 'g-rota', 'g-rota-n', 'g-rota-no'].forEach(id => OWN.add(id));
  }
  const b = new maplibregl.LngLatBounds(); trip.geometry.coordinates.forEach(c => b.extend(c));
  map.fitBounds(b, { padding: mapPadding(), pitch: 0, duration: 1200, maxZoom: 16 });
}
function gRotaTemizle() { ['g-rota-no', 'g-rota-n', 'g-rota', 'g-rota-hale'].forEach(id => map.getLayer(id) && map.removeLayer(id)); ['g-rota', 'g-rota-n'].forEach(id => map.getSource(id) && map.removeSource(id)); gunluk.rota = null; }
function gRotaPanel() {
  const { sira, trip } = gunluk.rota, E = eser.data.eser;
  const sure = s => s < 3600 ? `${Math.max(1, Math.round(s / 60))} dk` : `${Math.floor(s / 3600)} sa ${Math.round(s % 3600 / 60)} dk`;
  const render = el => {
    el.innerHTML = `
      <div class="place-head drag-zone"><h1 class="eser-ad">Günlük rota</h1>
        <div class="sub">${sira.length - (sira[0].ben ? 1 : 0)} eser · ${fmtDist(trip.distance)} · ${gunluk.rotaMod === 'foot' ? 'yürüyerek' : 'araçla'} ${sure(trip.duration)} (ziyaret süresi hariç)</div></div>
      <div class="g-bolum">${sira.map((p, k) => {
        const bacak = k ? trip.legs[k - 1] : null;
        const no = p.ben ? '' : String(k + (sira[0].ben ? 0 : 1));
        return `${bacak ? `<div class="g-bacak"><span class="ms">${gunluk.rotaMod === 'foot' ? 'directions_walk' : 'directions_car'}</span>${fmtDist(bacak.distance)} · ${sure(bacak.duration)}<button class="text-btn" data-yol="${k}">Yol tarifi</button></div>` : ''}
          <div class="g-durak">${p.ben ? '<i class="ben"><span class="ms">my_location</span></i><b>Konumun</b>' : `<i>${no}</i><button class="g-durak-ad" data-i="${p.i}">${esc(E[p.i][1])}</button>`}</div>`;
      }).join('')}</div>
      <div class="g-bolum"><button class="g-rota-btn ikincil" id="g-rota-sil"><span class="ms">close</span>Rotayı kaldır</button></div>`;
    el.querySelectorAll('[data-i]').forEach(b => { b.onclick = () => eserGoster(+b.dataset.i); });
    el.querySelectorAll('[data-yol]').forEach(b => { b.onclick = () => { const k = +b.dataset.yol, a = sira[k - 1], c = sira[k]; dir.mode = gunluk.rotaMod; openDirections({ from: a.ben ? { me: true, name: 'Konumunuz' } : { name: E[a.i][1], lat: a.lat, lon: a.lon }, to: { name: E[c.i][1], lat: c.lat, lon: c.lon } }); }; });
    $('g-rota-sil').onclick = () => { gRotaTemizle(); closePanel(); };
  };
  render.mode = 'list';
  openPanel(render, { mode: 'list', sheet: 'peek' });
}

/* ----- Yakındaki eserler: konumun ya da harita merkezinden mesafeye göre ----- */
function yakinPanel() {
  if (!eser.data) return;
  const c = meLngLat ? { lng: meLngLat[0], lat: meLngLat[1] } : map.getCenter();
  const E = eser.data.eser, F = eser.data.feats, dLat = 0.05, dLon = 0.05 / Math.cos(c.lat * Math.PI / 180);
  const yakin = [];
  for (let i = 0; i < E.length; i++) {
    const e = E[i]; if (Math.abs(e[3] - c.lat) > dLat || Math.abs(e[2] - c.lng) > dLon) continue;
    if (eser.kapali.has(e[13])) continue;
    const p = F[i].properties;
    if (typeof zaman !== 'undefined' && zaman.acik && (p.y == null || (zaman.mod === 'birikimli' ? p.y > zaman.yil : Math.abs(p.y - zaman.yil) >= 50))) continue;
    yakin.push([haversine([c.lng, c.lat], [e[2], e[3]]), i]);
  }
  yakin.sort((a, b) => a[0] - b[0]);
  const render = el => {
    el.innerHTML = `
      <div class="place-head drag-zone"><h1 class="eser-ad">Yakındaki eserler</h1><div class="sub">${meLngLat ? 'Konumuna' : 'Haritanın ortasına'} göre · ${yakin.length > 60 ? 'en yakın 60' : yakin.length} eser</div></div>
      <div class="g-bolum">${yakin.slice(0, 60).map(([d, i]) => {
        const e = E[i], a = ESER_AILE[e[13]], r = gunluk.kayit[String(e[0])] || {};
        return `<div class="g-satir-sar"><button class="g-satir" data-i="${i}"><i style="--c:${a.renk}"><svg viewBox="0 0 24 24"><path fill="currentColor" fill-rule="evenodd" d="${ESER_GLYPH[a.simge]}"/></svg></i><span><b>${esc(e[1])}</b><small>${fmtDist(d)} · ${esc((e[14]) || (e[5] || []).map(t => eser.data.sozluk.tur[t]).filter(Boolean)[0] || a.ad)}${r.d === 'gittim' ? ' · ✓ gittin' : ''}</small></span></button>
          <button class="icon-btn g-yildiz${r.d === 'gidecegim' ? ' on' : ''}" data-yildiz="${e[0]}" aria-label="Gideceklerime ekle"><span class="ms${r.d === 'gidecegim' ? ' fill' : ''}">star</span></button></div>`;
      }).join('') || '<div class="g-bos">5 km içinde eser yok. Haritayı başka bir yere kaydırıp yeniden dene.</div>'}</div>`;
    el.querySelectorAll('[data-i]').forEach(b => { b.onclick = () => eserGoster(+b.dataset.i); });
    el.querySelectorAll('[data-yildiz]').forEach(b => { b.onclick = () => { gIsaretle(b.dataset.yildiz, 'gidecegim'); render(el); }; });
  };
  render.mode = 'list';
  openPanel(render, { mode: 'list', sheet: 'peek' });
}

// Üst çubuktaki Günlüğüm düğmesi: eser katmanı kapalıyken de açılır (veri gerekirse yüklenir)
$('gunluk-btn').onclick = async e => {
  e.stopPropagation();
  if (!eser.data) { toast('Günlük yükleniyor…', 4000); try { await eserYukle(); } catch { toast('Yüklenemedi. Bağlantını kontrol edip yeniden dene.'); return; } }
  gunlukPanel();
};
