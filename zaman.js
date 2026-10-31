// ATLAS3D — Zaman kaydırıcısı: tarihî eserleri yapım yılına göre süzer, yüzyıllar içinde yayılışlarını oynatır.
// Yıllar tools/build_tarih.py'den (kesin yüzyıl / dönem-kültür aralığı / tür-ülke tahmini). Tarihsiz eserler zaman modunda gizlenir.
// Seçilen yıl eski haritalardaki tarihî sınırlarla ortaktır (setAtlasYil).
'use strict';

const ZAMAN_GENEL = { center: [30, 39], zoom: 3.3, pitch: 32 }; // Avrupa, Anadolu ve Mısır birlikte
const zaman = { ilk: false, acik: false, yil: 1500, mod: 'birikimli', tahmin: true, oynat: null };
// Ölçek dört parçalı; başlangıç verideki en eski eserdir (ör. Abourma kaya resimleri, MÖ 300.000):
// en eski–MÖ 12000 logaritmik %12 · MÖ 12000–3000 (Neolitik, Göbeklitepe) %18 · MÖ 3000–MS 0 %18 · MS 0–2025 %52
let Z_MIN = -12000;
const Z_MAX = 2025, Z_PALEO = -12000, Z_PALEO_X = 12;
const Z_PARCA = [[-12000, 12], [-3000, 30], [0, 48], [2025, 100]];
const zX = y => {
  y = Math.max(Z_MIN, Math.min(Z_MAX, y));
  if (y < Z_PALEO) return Z_MIN >= Z_PALEO ? 0 : Z_PALEO_X * (1 - Math.log(y / Z_PALEO) / Math.log(Z_MIN / Z_PALEO));
  for (let k = 1; k < Z_PARCA.length; k++) { const [y0, x0] = Z_PARCA[k - 1], [y1, x1] = Z_PARCA[k]; if (y <= y1) return x0 + (x1 - x0) * (y - y0) / (y1 - y0); }
  return 100;
};
const zY = x => {
  if (x < Z_PALEO_X) return Z_MIN >= Z_PALEO ? Z_PALEO : Z_PALEO * Math.pow(Z_MIN / Z_PALEO, 1 - x / Z_PALEO_X);
  for (let k = 1; k < Z_PARCA.length; k++) { const [y0, x0] = Z_PARCA[k - 1], [y1, x1] = Z_PARCA[k]; if (x <= x1) return y0 + (y1 - y0) * (x - x0) / (x1 - x0); }
  return Z_MAX;
};
function zamanBaslangic() { // en eski tarihli eser, bin yıla yuvarlanmış
  let m = 0; for (const f of eser.data.feats) { const y = f.properties.y; if (y != null && y < m) m = y; }
  Z_MIN = Math.floor(Math.min(m, Z_PALEO) / 1000) * 1000;
}
const Z_KOVA = 64; // histogram: kaydırıcı boyunca eşit genişlikte çubuklar
// Anadolu merkezli dönem adları (kaydırıcının üstünde)
const Z_DONEM = [[-3000000, 'Alt Paleolitik · ilk taş aletler'], [-300000, 'Orta Paleolitik'], [-40000, 'Üst Paleolitik · mağara resimleri'], [-20000, 'Epipaleolitik · avcı-toplayıcılar'], [-10000, 'Neolitik · Göbeklitepe, Karahantepe'], [-8500, 'Neolitik · ilk köyler'], [-7500, 'Neolitik · Çatalhöyük'], [-5500, 'Kalkolitik'], [-3000, 'Erken Tunç Çağı'], [-2000, 'Orta Tunç Çağı · Asur ticaret kolonileri'], [-1650, 'Hitit İmparatorluğu'],
  [-1180, 'Demir Çağı · Frig, Urartu, Geç Hitit'], [-700, 'Lidya ve İyon kentleri'], [-546, 'Pers İmparatorluğu'], [-334, 'Helenistik dönem'],
  [-30, 'Roma İmparatorluğu'], [330, 'Bizans İmparatorluğu'], [1071, 'Selçuklu dönemi'], [1308, 'Beylikler ve erken Osmanlı'],
  [1453, 'Osmanlı klasik dönemi'], [1699, 'Osmanlı · Lale Devri ve yenileşme'], [1839, 'Tanzimat ve son Osmanlı'], [1923, 'Cumhuriyet']];
const zDonem = y => Z_DONEM.reduce((a, d) => y >= d[0] ? d[1] : a, Z_DONEM[0][1]);
const zYilYaz = y => y < 0 ? `MÖ ${-y >= 10000 ? nf0.format(-y) : -y}` : y < 1000 ? `MS ${y}` : String(y);
const zYuvarla = y => y < -12000 ? Math.round(y / 1000) * 1000 : y < -3000 ? Math.round(y / 100) * 100 : y < 0 ? Math.round(y / 50) * 50 : Math.round(y / 10) * 10;

/* ----- Süzgeç: eser katmanlarına uygulanır (veriyi yeniden yüklemeden, hızlı) ----- */
function zamanFiltre() {
  const y = zaman.yil, has = ['has', 'y'];
  const yilKosul = zaman.mod === 'birikimli' ? ['<=', ['get', 'y'], y] : ['all', ['>=', ['get', 'y'], y - 50], ['<', ['get', 'y'], y + 50]];
  return ['all', has, yilKosul, ...(zaman.tahmin ? [] : [['<', ['get', 'k'], 2]])];
}
function zamanUygula() {
  if (!map.getLayer('eser-yogun')) return;
  const parca = [...(zaman.acik ? [zamanFiltre()] : []), ...(typeof kolFiltre === 'function' ? kolFiltre() : [])];
  const f = parca.length ? ['all', ...parca] : null;
  ['eser-hale', 'eser-yogun', 'eser-nokta'].forEach(id => map.setFilter(id, f));
}
/* ----- Sayım ve histogram ----- */
function zamanSayim() {
  const F = eser.data.feats, kap = eser.kapali, y = zaman.yil;
  let n = 0, tarihsiz = 0;
  const h = new Map();
  for (const f of F) {
    const p = f.properties; if (kap.has(p.f)) continue;
    if (p.y == null) { tarihsiz++; continue; }
    if (!zaman.tahmin && p.k === 2) continue;
    const b = Math.min(Z_KOVA - 1, Math.floor(zX(p.y) / 100 * Z_KOVA)); h.set(b, (h.get(b) || 0) + 1);
    if (zaman.mod === 'birikimli' ? p.y <= y : p.y >= y - 50 && p.y < y + 50) n++;
  }
  return { n, tarihsiz, h };
}

/* ----- Panel ----- */
function zKovaOn(b) { // kova seçili yıla göre yanıyor mu
  const yb = zY(b * 100 / Z_KOVA), ys = zY((b + 1) * 100 / Z_KOVA);
  return zaman.mod === 'birikimli' ? yb <= zaman.yil : ys > zaman.yil - 50 && yb <= zaman.yil + 50;
}
function zamanCiz() {
  const el = $('zaman-panel'); if (!zaman.acik) { el.hidden = true; return; }
  const { n, tarihsiz, h } = zamanSayim();
  const max = Math.max(1, ...h.values());
  let bars = '';
  for (let b = 0; b < Z_KOVA; b++) {
    const c = h.get(b) || 0, x0 = b * 100 / Z_KOVA;
    bars += `<i style="left:${x0}%;width:calc(${100 / Z_KOVA}% - 1px);height:${c ? Math.max(2, 44 * Math.sqrt(c / max)) : 0}px" class="${zKovaOn(b) ? 'on' : ''}"></i>`;
  }
  const tick = (y, t) => `<span style="left:${zX(y)}%">${t}</span>`;
  el.hidden = false;
  el.innerHTML = `
    <div class="zp-ust"><span class="zp-yil">${zYilYaz(zaman.yil)}</span><span class="zp-donem">${zDonem(zaman.yil)}</span>
      <button class="icon-btn" id="zp-kapat" aria-label="Zaman kaydırıcısını kapat"><span class="ms">close</span></button></div>
    <div class="zp-sayi"><b>${nf0.format(n)}</b> eser${zaman.mod === 'birikimli' ? ' bu tarihe kadar' : ' bu yüzyılda'}</div>
    <div class="zp-hist">${bars}<span class="zp-gobekli" style="left:${zX(-9600)}%">Göbeklitepe</span></div>
    <div class="zp-ray"><input type="range" id="zp-kay" min="0" max="1000" value="${Math.round(zX(zaman.yil) * 10)}" aria-label="Yıl">
      <div class="zp-tik"><span style="left:0;transform:none">${zYilYaz(Z_MIN)}</span>${tick(-3000, 'MÖ 3000')}${tick(0, 'MS 1')}${tick(1000, '1000')}${tick(1880, '2000')}</div></div>
    <div class="zp-alt">
      <button class="zp-oynat" id="zp-oynat" aria-label="${zaman.oynat ? 'Durdur' : 'Oynat'}"><span class="ms fill">${zaman.oynat ? 'pause' : 'play_arrow'}</span></button>
      <div class="zp-mod"><button data-m="birikimli" class="${zaman.mod === 'birikimli' ? 'on' : ''}">Birikimli</button><button data-m="yuzyil" class="${zaman.mod === 'yuzyil' ? 'on' : ''}">O yüzyıl</button></div>
      <label class="zp-tahmin"><input type="checkbox" id="zp-tahmin" ${zaman.tahmin ? 'checked' : ''}> Tahminler</label>
    </div>
    <div class="zp-not">${nf0.format(tarihsiz)} eserin tarihi bilinmediği için gizli · <a href="${zamanOmoUrl()}" target="_blank" rel="noopener">Bu yılı Old Maps Online'da aç</a></div>`;
  $('zp-kapat').onclick = () => zamanAcKapat(false);
  const k = $('zp-kay');
  k.oninput = () => { zamanOynatDur(); zamanYil(zY(k.value / 10)); };
  $('zp-oynat').onclick = () => zaman.oynat ? zamanOynatDur(true) : zamanOynat();
  el.querySelectorAll('[data-m]').forEach(b => { b.onclick = () => { zaman.mod = b.dataset.m; zamanUygula(); zamanCiz(); }; });
  $('zp-tahmin').onchange = e => { zaman.tahmin = e.target.checked; zamanUygula(); zamanCiz(); };
}
function zamanOmoUrl() {
  const c = map.getCenter();
  return `https://www.oldmapsonline.org/en/#position=${Math.max(3, Math.round(map.getZoom()))}/${c.lat.toFixed(2)}/${c.lng.toFixed(2)}&year=${Math.max(1, zaman.yil)}`;
}
let zamanCizBekle = 0;
function zamanYil(y, kaynak) {
  zaman.yil = zYuvarla(y);
  zamanUygula();
  if (kaynak !== 'atlas') setAtlasYil(zaman.yil, 'zaman'); // tarihî sınırlar da bu yıla geçer
  cancelAnimationFrame(zamanCizBekle);
  zamanCizBekle = requestAnimationFrame(() => {
    // kaydırırken yalnızca metin ve çubuklar güncellenir; kaydırıcının kendisi yeniden çizilmez
    const el = $('zaman-panel'); if (!el || el.hidden) return;
    const { n, h } = zamanSayim();
    el.querySelector('.zp-yil').textContent = zYilYaz(zaman.yil);
    el.querySelector('.zp-donem').textContent = zDonem(zaman.yil);
    el.querySelector('.zp-sayi b').textContent = nf0.format(n);
    el.querySelectorAll('.zp-hist i').forEach((b, j) => b.classList.toggle('on', zKovaOn(j)));
    const k = $('zp-kay'); if (k && document.activeElement !== k) k.value = Math.round(zX(zaman.yil) * 10);
    const a = el.querySelector('.zp-not a'); if (a) a.href = zamanOmoUrl();
  });
}
document.addEventListener('atlas-yil', e => { if (zaman.acik && e.detail.kaynak === 'eski' && e.detail.yil !== zaman.yil) zamanYil(e.detail.yil, 'atlas'); });

/* ----- Oynat: yüzyıl yüzyıl ilerler; eski çağlarda daha hızlı ----- */
function zamanOynat() {
  if (zaman.yil >= 2020) zamanYil(Z_MIN);
  zaman.oynat = setInterval(() => {
    const x = zX(zaman.yil) + 0.3; // kaydırıcıda eşit adım: eski çağlar hızlı, tarihî dönemler yavaş geçer
    if (x >= 100 || zaman.yil >= 2020) { zamanYil(2020); zamanOynatDur(true); return; }
    zamanYil(Math.max(zY(x), zaman.yil + 10));
  }, 120);
  zamanCiz();
}
function zamanOynatDur(ciz) {
  if (!zaman.oynat) return;
  clearInterval(zaman.oynat); zaman.oynat = null;
  if (ciz) zamanCiz();
}

/* ----- Aç / kapat ----- */
function zamanAcKapat(on = !zaman.acik) {
  if (on && !eser.on) return;
  zaman.acik = on;
  document.body.classList.toggle('zaman-acik', on);
  if (on) {
    zamanBaslangic(); zaman.yil = zYuvarla(atlasYil);
    // İlk açılışta genel görünüm: eserlerin yayılışı bir bakışta izlensin (alt panel haritayı kapatmasın)
    if (!zaman.ilk) { zaman.ilk = true; map.flyTo({ ...ZAMAN_GENEL, bearing: 0, padding: { top: 120, bottom: isMobile() ? 260 : 40, left: isMobile() ? 0 : 440, right: 0 }, duration: 1800, essential: true }); }
  }
  else zamanOynatDur();
  zamanUygula(); zamanCiz();
  if (typeof eserBarCiz === 'function' && eser.data) eserBarCiz();
}
function zamanKapat() { if (zaman.acik) zamanAcKapat(false); }
