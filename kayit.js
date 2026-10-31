// ATLAS3D — Yolculuk kaydı: GPS izini kaydeder, kayıtlı yolculukları saat saat haritada oynatır ve analiz eder.
// - Kayıt düğmesi rakım göstergesinin yanında; kayıt sürerken süre ve mesafe gösterilir, iz haritada canlı çizilir
// - Noktalar IndexedDB'de (atlas3d-kayit) saklanır, kayıt sırasında da sürekli yazılır: uygulama kapansa da iz kaybolmaz
// - Ekran kilidini önlemek için Wake Lock istenir (telefonlarda ekran kapanınca tarayıcı konumu durdurabilir)
// - Analiz: rota analizi ekranı (analysis.js) kayıt kipinde açılır; yükseklikler arazi modelinden
'use strict';

const kyt = { kayit: null, izleme: null, kilit: null, saat: null, oynat: null };
const KYT_DOGRULUK = 50, KYT_MIN_MESAFE = 5, KYT_MIN_SURE = 15000; // m, m, ms

/* ----- Saklama (IndexedDB): her yolculuk tek kayıt { id, ad, bas, son, mod, pts: [[t, lon, lat, gpsRakim, hiz], ...] } ----- */
let kytDb = null;
function kytDbAc() {
  kytDb ??= new Promise((ok, err) => {
    const r = indexedDB.open('atlas3d-kayit', 1);
    r.onupgradeneeded = () => r.result.createObjectStore('yolculuk', { keyPath: 'id' });
    r.onsuccess = () => ok(r.result); r.onerror = () => err(r.error);
  });
  return kytDb;
}
async function kytYaz(y) { const db = await kytDbAc(); return new Promise((ok, err) => { const tx = db.transaction('yolculuk', 'readwrite'); tx.objectStore('yolculuk').put(y); tx.oncomplete = ok; tx.onerror = () => err(tx.error); }); }
async function kytOku(id) { const db = await kytDbAc(); return new Promise(ok => { const q = db.transaction('yolculuk').objectStore('yolculuk').get(id); q.onsuccess = () => ok(q.result || null); q.onerror = () => ok(null); }); }
async function kytHepsi() { const db = await kytDbAc(); return new Promise(ok => { const q = db.transaction('yolculuk').objectStore('yolculuk').getAll(); q.onsuccess = () => ok(q.result || []); q.onerror = () => ok([]); }); }
async function kytSil(id) { const db = await kytDbAc(); return new Promise(ok => { const tx = db.transaction('yolculuk', 'readwrite'); tx.objectStore('yolculuk').delete(id); tx.oncomplete = ok; tx.onerror = ok; }); }

/* ----- Ölçüler ----- */
function kytOlcu(y) {
  const p = y.pts; let mesafe = 0, hareket = 0, maks = 0;
  for (let i = 1; i < p.length; i++) {
    const d = haversine([p[i - 1][1], p[i - 1][2]], [p[i][1], p[i][2]]), dt = (p[i][0] - p[i - 1][0]) / 1000;
    mesafe += d;
    const v = dt > 0 ? d / dt : 0; // m/sn
    if (v > 0.5 && dt < 300) hareket += dt; // yürüme hızının çok altındaysa mola sayılır
    if (dt >= 3 && v * 3.6 < 250) maks = Math.max(maks, v * 3.6); // GPS sıçramalarını ele
  }
  const sure = p.length > 1 ? (p[p.length - 1][0] - p[0][0]) / 1000 : 0;
  const ort = hareket > 0 ? mesafe / hareket * 3.6 : 0;
  return { mesafe, sure, hareket, mola: Math.max(0, sure - hareket), ort, maks, mod: ort > 25 ? 'car' : ort > 11 ? 'bike' : 'foot' };
}
const kytSaat = t => new Date(t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
const kytSaatSn = t => new Date(t).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' });
const kytTarih = t => new Date(t).toLocaleDateString('tr-TR', { day: 'numeric', month: 'long', year: 'numeric' });
const kytSure = s => { s = Math.round(s); const h = Math.floor(s / 3600), m = Math.floor(s % 3600 / 60), sn = s % 60; return h ? `${h}:${String(m).padStart(2, '0')}:${String(sn).padStart(2, '0')}` : `${m}:${String(sn).padStart(2, '0')}`; };

/* ----- Haritadaki iz ----- */
function kytIzCiz(pts, kaynak = 'kyt-iz') {
  const veri = { type: 'Feature', geometry: { type: 'LineString', coordinates: pts.map(p => [p[1], p[2]]) } };
  if (map.getSource(kaynak)) { map.getSource(kaynak).setData(veri); return; }
  map.addSource(kaynak, { type: 'geojson', data: veri });
  const renk = kaynak === 'kyt-iz' ? '#d93025' : '#7a3db8';
  map.addLayer({ id: kaynak + '-hale', type: 'line', source: kaynak, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#fff', 'line-width': 7, 'line-opacity': 0.9 } });
  map.addLayer({ id: kaynak, type: 'line', source: kaynak, layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': renk, 'line-width': 4 } });
  OWN.add(kaynak); OWN.add(kaynak + '-hale');
}
function kytIzSil(kaynak) { [kaynak, kaynak + '-hale'].forEach(id => map.getLayer(id) && map.removeLayer(id)); map.getSource(kaynak) && map.removeSource(kaynak); }

/* ----- Kayıt ----- */
async function kytBasla() {
  if (!navigator.geolocation) { toast('Bu cihazda konum servisi yok.'); return; }
  if (!isSecureContext) { toast('Konum için HTTPS gerekli.'); return; }
  const t = Date.now();
  kyt.kayit = { id: 'k' + t, ad: '', bas: t, son: t, pts: [], acik: true };
  kytYaz(kyt.kayit).catch(() => {});
  kyt.izleme = navigator.geolocation.watchPosition(kytKonum, e => { if (e.code === 1) { toast('Konum izni verilmedi; kayıt durduruldu.'); kytBitir(true); } },
    { enableHighAccuracy: true, maximumAge: 0, timeout: 30000 });
  try { kyt.kilit = await navigator.wakeLock?.request('screen'); } catch {}
  document.addEventListener('visibilitychange', kytGorunurluk);
  kyt.saat = setInterval(kytDugmeCiz, 1000);
  document.body.classList.add('kyt-kayit');
  kytDugmeCiz();
  toast('Kayıt başladı. Ekran açık kalacak; telefon kilitlenirse konum durabilir.', 4500);
}
async function kytGorunurluk() { // sekmeye dönünce ekran kilidi yeniden istenir
  if (document.visibilityState === 'visible' && kyt.kayit && (!kyt.kilit || kyt.kilit.released)) { try { kyt.kilit = await navigator.wakeLock?.request('screen'); } catch {} }
}
function kytKonum(pos) {
  const k = kyt.kayit; if (!k) return;
  const c = pos.coords; if (c.accuracy > KYT_DOGRULUK) return;
  const nok = [pos.timestamp || Date.now(), +c.longitude.toFixed(6), +c.latitude.toFixed(6), c.altitude != null ? Math.round(c.altitude) : null, c.speed != null ? +c.speed.toFixed(1) : null];
  const son = k.pts[k.pts.length - 1];
  if (son && haversine([son[1], son[2]], [nok[1], nok[2]]) < KYT_MIN_MESAFE && nok[0] - son[0] < KYT_MIN_SURE) return;
  k.pts.push(nok); k.son = nok[0];
  kytIzCiz(k.pts);
  if (k.pts.length % 5 === 1) kytYaz(k).catch(() => {}); // kayıt sırasında da yazılır: uygulama kapansa iz kalır
}
async function kytBitir(sessiz) {
  const k = kyt.kayit; if (!k) return;
  navigator.geolocation.clearWatch(kyt.izleme); clearInterval(kyt.saat);
  try { await kyt.kilit?.release(); } catch {}
  document.removeEventListener('visibilitychange', kytGorunurluk);
  kyt.kayit = null; document.body.classList.remove('kyt-kayit');
  kytDugmeCiz(); kytIzSil('kyt-iz');
  if (k.pts.length < 2) { await kytSil(k.id); if (!sessiz) toast('Kayıt çok kısa olduğu için saklanmadı.'); return; }
  k.acik = false; k.bas = k.pts[0][0]; k.son = k.pts[k.pts.length - 1][0]; Object.assign(k, kytOlcu(k));
  k.ad = `${kytTarih(k.bas)}, ${kytSaat(k.bas)}`;
  await kytYaz(k);
  // başlangıç yerinin adı (arka planda)
  api('/api/reverse', { lat: k.pts[0][2], lon: k.pts[0][1], zoom: 14 }).then(async r => {
    const a = r?.address || {}, yer = a.suburb || a.neighbourhood || a.town || a.city_district || a.village || a.city;
    if (yer) { k.yer = yer; await kytYaz(k); }
  }).catch(() => {});
  if (!sessiz) { toast(`Yolculuk kaydedildi: ${fmtDist(k.mesafe)}, ${fmtDur(k.sure)}`, 3500); kytDetay(k.id); }
}
// Uygulama kayıt sürerken kapandıysa: yarım kayıt açılışta toparlanır
kytDbAc().then(() => kytHepsi()).then(L => L.filter(y => y.acik).forEach(async y => {
  if (y.pts.length < 2) { await kytSil(y.id); return; }
  y.acik = false; Object.assign(y, kytOlcu(y)); y.ad = `${kytTarih(y.bas)}, ${kytSaat(y.bas)}`; await kytYaz(y);
})).catch(() => {});

/* ----- Kayıt düğmesi (rakım göstergesinin yanında) ----- */
function kytDugmeCiz() {
  const b = $('kyt-btn'), k = kyt.kayit;
  b.classList.toggle('on', !!k);
  if (!k) { b.innerHTML = '<span class="kyt-nokta"></span><small>Rotayı kaydet</small>'; b.setAttribute('aria-label', 'Yolculuk kaydını başlat'); return; }
  let m = 0; for (let i = 1; i < k.pts.length; i++) m += haversine([k.pts[i - 1][1], k.pts[i - 1][2]], [k.pts[i][1], k.pts[i][2]]);
  b.innerHTML = `<span class="kyt-kare"></span><b>${kytSure((Date.now() - k.bas) / 1000)}</b><small>· ${fmtDist(m)}</small>`;
  b.setAttribute('aria-label', 'Kaydı bitir');
}
$('kyt-btn').onclick = e => {
  e.stopPropagation();
  if (!kyt.kayit) { kytBasla(); return; }
  if (confirm('Kayıt bitirilsin mi?')) kytBitir();
};
kytDugmeCiz();
// Düğme rakım kartıyla aynı boyda: kartın yüksekliği içeriğe göre değiştikçe izlenir
if (window.ResizeObserver) new ResizeObserver(([g]) => { const h = Math.round(g.target.getBoundingClientRect().height); if (h) $('kyt-btn').style.height = h + 'px'; }).observe($('hud'));

/* ----- Kayıtlı yolculuklar (sol menüden) ----- */
async function kytListe() {
  const L = (await kytHepsi()).filter(y => !y.acik).sort((a, b) => b.bas - a.bas);
  const ay = new Map(); L.forEach(y => { const k = new Date(y.bas).toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' }); (ay.get(k) || ay.set(k, []).get(k)).push(y); });
  const render = el => {
    el.innerHTML = `<div class="place-head drag-zone"><h1 class="eser-ad">Kayıtlı yolculuklar</h1><div class="sub">${L.length ? `${L.length} yolculuk · ${fmtDist(L.reduce((t, y) => t + y.mesafe, 0))}` : 'Henüz kayıt yok'} · bu cihazda saklanır</div></div>
      ${L.length ? [...ay].map(([baslik, Y]) => `<div class="g-bolum"><h3>${esc(baslik)} <small>${fmtDist(Y.reduce((t, y) => t + y.mesafe, 0))}</small></h3>${Y.map(y => `
        <button class="kyt-satir" data-id="${y.id}"><i class="ms">${MODES[y.mod]?.icon || 'route'}</i><span><b>${esc(y.yer ? `${y.yer} · ${kytSaat(y.bas)}` : y.ad)}</b><small>${new Date(y.bas).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })} · ${fmtDist(y.mesafe)} · ${fmtDur(y.sure)}${y.ort ? ` · ${nf1.format(y.ort)} km/sa` : ''}</small></span><span class="ms">chevron_right</span></button>`).join('')}</div>`).join('')
      : `<div class="g-bos" style="padding:16px 24px">Rakım göstergesinin yanındaki <b style="color:#d93025">●</b> düğmesiyle kayda başla. Bitirince yolculuk burada saklanır; haritada saat saat oynatabilir, eğim ve rakım analizini görebilirsin.</div>`}`;
    el.querySelectorAll('[data-id]').forEach(b => { b.onclick = () => kytDetay(b.dataset.id); });
  };
  render.mode = 'list';
  openPanel(render, { mode: 'list', sheet: 'full' });
}
async function kytDetay(id) {
  const y = await kytOku(id); if (!y) return;
  kytIzCiz(y.pts, 'kyt-gecmis');
  const b = new maplibregl.LngLatBounds(); y.pts.forEach(p => b.extend([p[1], p[2]]));
  const sat = (ic, l, v) => `<div class="kyt-o"><span class="ms">${ic}</span><small>${l}</small><b>${v}</b></div>`;
  const render = el => {
    el.innerHTML = `<div class="place-head drag-zone"><h1 class="eser-ad">${esc(y.yer || 'Yolculuk')}</h1><div class="sub">${kytTarih(y.bas)} · ${kytSaat(y.bas)}–${kytSaat(y.son)} · ${MODES[y.mod]?.label || ''}</div></div>
      <div class="kyt-ozet">${sat('straighten', 'Mesafe', fmtDist(y.mesafe))}${sat('schedule', 'Süre', fmtDur(y.sure))}${sat('speed', 'Ort. hız', nf1.format(y.ort) + ' km/sa')}${sat('bolt', 'En yüksek', nf0.format(y.maks) + ' km/sa')}</div>
      <div class="kyt-eylem">
        <button class="g-rota-btn" id="kyt-oynat"><span class="ms">play_arrow</span>Haritada oynat</button>
        <button class="g-rota-btn ikincil" id="kyt-analiz"><span class="ms">insights</span>Yolculuk analizi</button>
      </div>
      <div class="kyt-eylem">
        <button class="text-btn" id="kyt-ad"><span class="ms">edit</span> Adını değiştir</button>
        <button class="text-btn" id="kyt-gpx"><span class="ms">download</span> GPX</button>
        <button class="text-btn kyt-sil" id="kyt-sil"><span class="ms">delete</span> Sil</button>
      </div>`;
    $('kyt-oynat').onclick = () => kytOynat(y.id);
    $('kyt-analiz').onclick = () => kytAnaliz(y);
    $('kyt-gpx').onclick = async () => { const r = await kytRota(y); if (r) exportGpx(r); };
    $('kyt-ad').onclick = async () => { const a = prompt('Yolculuğun adı', y.yer || ''); if (a == null) return; y.yer = a.trim(); await kytYaz(y); render(el); };
    $('kyt-sil').onclick = async () => { if (!confirm('Bu yolculuk silinsin mi?')) return; await kytSil(y.id); kytIzSil('kyt-gecmis'); closePanel(); kytListe(); };
  };
  render.mode = 'list';
  openPanel(render, { mode: 'list', sheet: 'peek', push: panelMode === 'list' });
  map.fitBounds(b, { padding: mapPadding(), pitch: 0, maxZoom: 16, duration: 1000 });
}
// Analiz için rota biçimi: koordinat, kümülatif mesafe, zaman; yükseklik profili arazi modelinden
async function kytRota(y) {
  const coords = y.pts.map(p => [p[1], p[2]]), cum = [0];
  for (let i = 1; i < coords.length; i++) cum.push(cum[i - 1] + haversine(coords[i - 1], coords[i]));
  const r = { coords, cum, total: cum[cum.length - 1], duration: y.sure, steps: [], legs: [], mode: y.mod, times: y.pts.map(p => p[0]), kayitAd: y.yer ? `${y.yer} ${kytTarih(y.bas)}` : y.ad };
  if (r.total < 20) { toast('Yolculuk analiz için çok kısa.'); return null; }
  toast('Yükseklik profili hazırlanıyor…', 3000);
  try { r.profile = await buildProfile(r); } catch { r.profile = null; }
  if (!r.profile) { toast('Arazi verisi alınamadı. Bağlantını kontrol et.'); return null; }
  return r;
}
async function kytAnaliz(y) {
  const r = await kytRota(y); if (!r) return;
  openAnalysis(r, null, { id: y.id, alt: `${kytTarih(y.bas)} · ${kytSaat(y.bas)}–${kytSaat(y.son)}`, mod: y.mod, sure: y.sure, hareket: y.hareket, mola: y.mola, ort: y.ort, maks: y.maks, bas: kytSaat(y.bas), son: kytSaat(y.son) });
}

/* ----- Saat saat oynatma ----- */
const KYT_HIZ = [10, 30, 60, 300, 1200];
async function kytOynat(id) {
  const y = await kytOku(id); if (!y) return;
  kytOynatDur();
  closePanel();
  kytIzCiz(y.pts, 'kyt-gecmis');
  const cum = [0]; for (let i = 1; i < y.pts.length; i++) cum.push(cum[i - 1] + haversine([y.pts[i - 1][1], y.pts[i - 1][2]], [y.pts[i][1], y.pts[i][2]]));
  const o = kyt.oynat = { y, cum, t: y.pts[0][0], hiz: store.get('kyt_hiz', 60), durdu: false, son: performance.now(), takip: true, raf: 0 };
  if (!map.getSource('kyt-gecen')) {
    map.addSource('kyt-gecen', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'kyt-gecen', type: 'line', source: 'kyt-gecen', layout: { 'line-join': 'round', 'line-cap': 'round' }, paint: { 'line-color': '#3b0f6b', 'line-width': 5 } });
    map.addSource('kyt-ben', { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    map.addLayer({ id: 'kyt-ben', type: 'circle', source: 'kyt-ben', paint: { 'circle-radius': 9, 'circle-color': '#7a3db8', 'circle-stroke-color': '#fff', 'circle-stroke-width': 3 } });
    ['kyt-gecen', 'kyt-ben'].forEach(i => OWN.add(i));
  }
  const b = new maplibregl.LngLatBounds(); y.pts.forEach(p => b.extend([p[1], p[2]]));
  map.fitBounds(b, { padding: { top: 120, bottom: 230, left: 40, right: 40 }, pitch: 0, maxZoom: 16, duration: 900 });
  $('kyt-oynatici').hidden = false; document.body.classList.add('kyt-oynuyor');
  kytOynaticiCiz(); kytKare();
}
// t anındaki konum: iki nokta arasında doğrusal
function kytKonumAt(o, t) {
  const p = o.y.pts; let i = 1; while (i < p.length - 1 && p[i][0] < t) i++;
  const a = p[i - 1], b = p[i], f = b[0] > a[0] ? Math.max(0, Math.min(1, (t - a[0]) / (b[0] - a[0]))) : 1;
  const ll = [a[1] + (b[1] - a[1]) * f, a[2] + (b[2] - a[2]) * f];
  const dt = (b[0] - a[0]) / 1000, d = haversine([a[1], a[2]], [b[1], b[2]]);
  return { i, ll, mesafe: o.cum[i - 1] + d * f, hiz: dt > 0 ? d / dt * 3.6 : 0 };
}
function kytKare(simdi = performance.now()) {
  const o = kyt.oynat; if (!o) return;
  if (!o.durdu) o.t = Math.min(o.y.son, o.t + (simdi - o.son) * o.hiz);
  o.son = simdi;
  const k = kytKonumAt(o, o.t), p = o.y.pts;
  map.getSource('kyt-ben').setData({ type: 'Feature', geometry: { type: 'Point', coordinates: k.ll } });
  map.getSource('kyt-gecen').setData({ type: 'Feature', geometry: { type: 'LineString', coordinates: [...p.slice(0, k.i).map(q => [q[1], q[2]]), k.ll] } });
  if (o.takip && !o.durdu) {
    const s = map.project(k.ll), c = map.getContainer();
    if (s.x < 50 || s.y < 130 || s.x > c.clientWidth - 50 || s.y > c.clientHeight - 240) map.easeTo({ center: k.ll, duration: 500 });
  }
  kytOynaticiGuncelle(k);
  if (o.t >= o.y.son && !o.durdu) { o.durdu = true; kytOynaticiGuncelle(k); }
  o.raf = requestAnimationFrame(kytKare);
}
function kytOynaticiCiz() {
  const o = kyt.oynat, y = o.y;
  $('kyt-oynatici').innerHTML = `
    <div class="ko-ust"><b class="ko-saat" id="ko-saat"></b><span class="ko-bilgi" id="ko-bilgi"></span>
      <button class="icon-btn" id="ko-kapat" aria-label="Oynatmayı kapat"><span class="ms">close</span></button></div>
    <input type="range" id="ko-kay" min="${y.pts[0][0]}" max="${y.son}" step="1000" value="${o.t}" aria-label="Zaman">
    <div class="ko-tik"><span>${kytSaat(y.bas)}</span><span>${kytSaat(y.son)}</span></div>
    <div class="ko-alt">
      <button class="kol-oynat on" id="ko-oynat" aria-label="Duraklat"><span class="ms fill">pause</span></button>
      <div class="zp-mod">${KYT_HIZ.map(h => `<button data-h="${h}" class="${h === o.hiz ? 'on' : ''}">${h >= 60 ? h / 60 + ' dk/sn' : h + '×'}</button>`).join('')}</div>
      <button class="icon-btn" id="ko-analiz" aria-label="Yolculuk analizi"><span class="ms">insights</span></button>
    </div>`;
  $('ko-kapat').onclick = () => kytOynatDur(true);
  $('ko-oynat').onclick = () => { if (o.t >= y.son) o.t = y.pts[0][0]; o.durdu = !o.durdu; o.takip = true; };
  $('ko-kay').oninput = e => { o.t = +e.target.value; o.durdu = true; o.takip = false; const k = kytKonumAt(o, o.t); map.easeTo({ center: k.ll, duration: 200 }); };
  $('kyt-oynatici').querySelectorAll('[data-h]').forEach(b => { b.onclick = () => { o.hiz = +b.dataset.h; store.set('kyt_hiz', o.hiz); $('kyt-oynatici').querySelectorAll('[data-h]').forEach(x => x.classList.toggle('on', x === b)); }; });
  $('ko-analiz').onclick = () => { o.durdu = true; kytAnaliz(y); };
}
function kytOynaticiGuncelle(k) {
  const o = kyt.oynat;
  $('ko-saat').textContent = kytSaatSn(o.t);
  $('ko-bilgi').textContent = `${fmtDist(k.mesafe)} · ${nf0.format(k.hiz)} km/sa${o.y.pts[k.i]?.[3] != null ? ` · ${nf0.format(o.y.pts[k.i][3])} m` : ''}`;
  const s = $('ko-kay'); if (document.activeElement !== s) s.value = o.t;
  const b = $('ko-oynat'), ms = b.querySelector('.ms'), ikon = o.durdu ? 'play_arrow' : 'pause';
  if (ms.textContent !== ikon) { ms.textContent = ikon; b.classList.toggle('on', !o.durdu); b.setAttribute('aria-label', o.durdu ? 'Oynat' : 'Duraklat'); }
}
function kytOynatDur(temizle) {
  const o = kyt.oynat; if (!o) return;
  cancelAnimationFrame(o.raf); kyt.oynat = null;
  $('kyt-oynatici').hidden = true; document.body.classList.remove('kyt-oynuyor');
  if (temizle) { ['kyt-gecen', 'kyt-ben'].forEach(i => map.getSource(i)?.setData({ type: 'FeatureCollection', features: [] })); kytIzSil('kyt-gecmis'); }
}
