// ATLAS3D — Zaman kaydırıcısı: tarihî eserleri yapım yılına göre süzer, yüzyıllar içinde yayılışlarını oynatır.
// Yıllar tools/build_tarih.py'den (kesin yüzyıl / dönem-kültür aralığı / tür-ülke tahmini). Tarihsiz eserler soluk gri kalır.
// Seçilen yıl eski haritalardaki tarihî sınırlarla ortaktır (setAtlasYil).
'use strict';

const zaman = { acik: false, yil: 1500, mod: 'birikimli', tahmin: true, oynat: null };
// Ölçek: MÖ 3000 – MS 0 sıkıştırılmış (%28), MS 0 – 2025 geniş (%72)
const Z_MIN = -3000, Z_MAX = 2025, Z_KIRIK = 28;
const zX = y => y < 0 ? Z_KIRIK * (Math.max(y, Z_MIN) - Z_MIN) / -Z_MIN : Z_KIRIK + (100 - Z_KIRIK) * Math.min(y, Z_MAX) / Z_MAX;
const zY = x => x < Z_KIRIK ? Z_MIN + (-Z_MIN) * x / Z_KIRIK : (x - Z_KIRIK) / (100 - Z_KIRIK) * Z_MAX;
// Anadolu merkezli dönem adları (kaydırıcının üstünde)
const Z_DONEM = [[-10000, 'Tarihöncesi'], [-3000, 'Erken Tunç Çağı'], [-2000, 'Orta Tunç Çağı · Asur ticaret kolonileri'], [-1650, 'Hitit İmparatorluğu'],
  [-1180, 'Demir Çağı · Frig, Urartu, Geç Hitit'], [-700, 'Lidya ve İyon kentleri'], [-546, 'Pers İmparatorluğu'], [-334, 'Helenistik dönem'],
  [-30, 'Roma İmparatorluğu'], [330, 'Bizans İmparatorluğu'], [1071, 'Selçuklu dönemi'], [1308, 'Beylikler ve erken Osmanlı'],
  [1453, 'Osmanlı klasik dönemi'], [1699, 'Osmanlı · Lale Devri ve yenileşme'], [1839, 'Tanzimat ve son Osmanlı'], [1923, 'Cumhuriyet']];
const zDonem = y => Z_DONEM.reduce((a, d) => y >= d[0] ? d[1] : a, Z_DONEM[0][1]);
const zYilYaz = y => y < 0 ? `MÖ ${-y}` : y < 1000 ? `MS ${y}` : String(y);
const zYuvarla = y => Math.abs(y) >= 1000 || y >= 0 ? Math.round(y / 10) * 10 : Math.round(y / 50) * 50;

/* ----- Süzgeç: eser katmanlarına uygulanır (veriyi yeniden yüklemeden, hızlı) ----- */
function zamanFiltre() {
  const y = zaman.yil, has = ['has', 'y'];
  const yilKosul = zaman.mod === 'birikimli' ? ['<=', ['get', 'y'], y] : ['all', ['>=', ['get', 'y'], y - 50], ['<', ['get', 'y'], y + 50]];
  return ['all', has, yilKosul, ...(zaman.tahmin ? [] : [['<', ['get', 'k'], 2]])];
}
function zamanUygula() {
  if (!map.getLayer('eser-yogun')) return;
  const f = zaman.acik ? zamanFiltre() : null;
  ['eser-hale', 'eser-yogun', 'eser-nokta'].forEach(id => map.setFilter(id, f));
  // tahmini tarihli eserler daha soluk firuze
  map.setPaintProperty('eser-yogun', 'circle-color', zaman.acik ? ['case', ['==', ['get', 'k'], 2], '#8fc7c9', ['==', ['get', 'k'], 1], '#62adb2', ESER_YOGUN] : ESER_YOGUN);
  if (map.getLayer('eser-tarihsiz')) map.setLayoutProperty('eser-tarihsiz', 'visibility', zaman.acik ? 'visible' : 'none');
}
function zamanTarihsizKatman() {
  if (map.getLayer('eser-tarihsiz')) return;
  map.addLayer({ id: 'eser-tarihsiz', type: 'circle', source: 'eser', filter: ['!', ['has', 'y']], maxzoom: 13.2,
    paint: { 'circle-radius': ['interpolate', ['linear'], ['zoom'], 2, 1.6, 8, 3.5, 13, 5], 'circle-color': '#9aa0a6', 'circle-opacity': 0.35 } }, 'eser-hale');
  OWN.add('eser-tarihsiz');
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
    const b = Math.floor(Math.max(p.y, Z_MIN) / 100); h.set(b, (h.get(b) || 0) + 1);
    if (zaman.mod === 'birikimli' ? p.y <= y : p.y >= y - 50 && p.y < y + 50) n++;
  }
  return { n, tarihsiz, h };
}

/* ----- Panel ----- */
function zamanCiz() {
  const el = $('zaman-panel'); if (!zaman.acik) { el.hidden = true; return; }
  const { n, tarihsiz, h } = zamanSayim();
  const max = Math.max(1, ...h.values());
  let bars = '';
  for (let b = Z_MIN / 100; b < 21; b++) {
    const c = h.get(b) || 0, x0 = zX(b * 100), x1 = zX((b + 1) * 100);
    const on = zaman.mod === 'birikimli' ? (b + 1) * 100 <= zaman.yil + 50 : Math.abs(b * 100 + 50 - zaman.yil) < 50;
    bars += `<i style="left:${x0}%;width:calc(${x1 - x0}% - 1px);height:${c ? Math.max(2, 44 * Math.sqrt(c / max)) : 0}px" class="${on ? 'on' : ''}"></i>`;
  }
  const tick = (y, t) => `<span style="left:${zX(y)}%">${t}</span>`;
  el.hidden = false;
  el.innerHTML = `
    <div class="zp-ust"><span class="zp-yil">${zYilYaz(zaman.yil)}</span><span class="zp-donem">${zDonem(zaman.yil)}</span>
      <button class="icon-btn" id="zp-kapat" aria-label="Zaman kaydırıcısını kapat"><span class="ms">close</span></button></div>
    <div class="zp-sayi"><b>${nf0.format(n)}</b> eser${zaman.mod === 'birikimli' ? ' bu tarihe kadar' : ' bu yüzyılda'}</div>
    <div class="zp-hist">${bars}</div>
    <div class="zp-ray"><input type="range" id="zp-kay" min="0" max="1000" value="${Math.round(zX(zaman.yil) * 10)}" aria-label="Yıl">
      <div class="zp-tik">${tick(-2800, 'MÖ 3000')}${tick(-1000, 'MÖ 1000')}${tick(250, 'MS 1')}${tick(1000, '1000')}${tick(1850, '2000')}</div></div>
    <div class="zp-alt">
      <button class="zp-oynat" id="zp-oynat" aria-label="${zaman.oynat ? 'Durdur' : 'Oynat'}"><span class="ms fill">${zaman.oynat ? 'pause' : 'play_arrow'}</span></button>
      <div class="zp-mod"><button data-m="birikimli" class="${zaman.mod === 'birikimli' ? 'on' : ''}">Birikimli</button><button data-m="yuzyil" class="${zaman.mod === 'yuzyil' ? 'on' : ''}">O yüzyıl</button></div>
      <label class="zp-tahmin"><input type="checkbox" id="zp-tahmin" ${zaman.tahmin ? 'checked' : ''}> Tahminler</label>
    </div>
    <div class="zp-not">${nf0.format(tarihsiz)} eserin tarihi bilinmiyor (gri) · <a href="${zamanOmoUrl()}" target="_blank" rel="noopener">Bu yılı Old Maps Online'da aç</a></div>`;
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
    el.querySelectorAll('.zp-hist i').forEach((b, j) => {
      const bb = Z_MIN / 100 + j;
      b.classList.toggle('on', zaman.mod === 'birikimli' ? (bb + 1) * 100 <= zaman.yil + 50 : Math.abs(bb * 100 + 50 - zaman.yil) < 50);
    });
    const k = $('zp-kay'); if (k && document.activeElement !== k) k.value = Math.round(zX(zaman.yil) * 10);
    const a = el.querySelector('.zp-not a'); if (a) a.href = zamanOmoUrl();
  });
}
document.addEventListener('atlas-yil', e => { if (zaman.acik && e.detail.kaynak === 'eski' && e.detail.yil !== zaman.yil) zamanYil(e.detail.yil, 'atlas'); });

/* ----- Oynat: yüzyıl yüzyıl ilerler; eski çağlarda daha hızlı ----- */
function zamanOynat() {
  if (zaman.yil >= 2020) zamanYil(-3000);
  zaman.oynat = setInterval(() => {
    const adim = zaman.yil < -1000 ? 100 : zaman.yil < 0 ? 50 : 20;
    if (zaman.yil + adim > 2020) { zamanYil(2020); zamanOynatDur(true); return; }
    zamanYil(zaman.yil + adim);
  }, 140);
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
  if (on) { zamanTarihsizKatman(); zaman.yil = zYuvarla(atlasYil); }
  else zamanOynatDur();
  zamanUygula(); zamanCiz();
  if (typeof eserBarCiz === 'function' && eser.data) eserBarCiz();
}
function zamanKapat() { if (zaman.acik) zamanAcKapat(false); }
