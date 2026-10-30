/* ================= Google ile zenginleştirme (anahtar sunucuda; GOOGLE_MAPS_API_KEY yoksa hiçbir şey görünmez) =================
   Yer kartı: Google puanı ve yorum sayısı, şu an açık mı, haftalık saatler, telefon, web, fotoğraflar, kısa tanıtım.
   Her konum: Google Sokak Görünümü önizlemesi (dokununca Google Haritalar'da etkileşimli açılır). */
const G = { on: false };
cfgReady.then(c => { G.on = !!c.google; if (G.on && currentPlace && $('panel-body')?.querySelector('.place-head')) gEnrich($('panel-body'), currentPlace); });
const G_DAYS = ['Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi', 'Pazar'];
const G_PRICE = { PRICE_LEVEL_INEXPENSIVE: '₺', PRICE_LEVEL_MODERATE: '₺₺', PRICE_LEVEL_EXPENSIVE: '₺₺₺', PRICE_LEVEL_VERY_EXPENSIVE: '₺₺₺₺' };
const gReal = p => p.name && p.icon !== 'pin_drop' && !/^-?\d+\.\d+, -?\d+\.\d+$/.test(p.name) && p.name !== 'İşaretlenmiş konum' && p.name !== 'Konum';
function gStars(r) {
  let h = '';
  for (let i = 1; i <= 5; i++) h += r >= i - 0.25 ? '<span class="ms fill">star</span>' : r >= i - 0.75 ? '<span class="ms fill">star_half</span>' : '<span class="ms fill g-off">star</span>';
  return h;
}
function gFetch(p, el) {
  const again = () => { if (currentPlace === p && el.isConnected && el.querySelector('.place-head')) gEnrich(el, p); };
  if (p.sv === undefined) {
    p.sv = null;
    fetch('/api/google/sv?' + new URLSearchParams({ lat: p.lat.toFixed(6), lon: p.lon.toFixed(6) })).then(r => r.json()).then(d => { p.sv = d.ok ? d : false; again(); }).catch(() => { p.sv = false; });
  }
  if (p.g === undefined && gReal(p)) {
    p.g = null;
    const city = (p.address || '').split(',').map(s => s.trim()).filter(Boolean).slice(-1)[0] || '';
    fetch('/api/google/place?' + new URLSearchParams({ q: [p.name, city].filter(Boolean).join(' '), lat: p.lat.toFixed(5), lon: p.lon.toFixed(5) }))
      .then(r => r.json()).then(d => { p.g = d.found ? d : false; again(); }).catch(() => { p.g = false; });
  }
}
function gEnrich(el, p) {
  if (!G.on) return;
  gFetch(p, el);
  el.querySelectorAll('.g-x').forEach(n => n.remove());
  const g = p.g || null, sv = p.sv || null;
  // Başlık altı: puan, fiyat, açık/kapalı
  if (g) {
    const head = el.querySelector('.place-head');
    const today = (new Date().getDay() + 6) % 7, th = g.hours[today] ? g.hours[today].replace(/^[^:]+:\s*/, '') : '';
    const status = g.status === 'CLOSED_PERMANENTLY' ? '<span class="closed">Kalıcı olarak kapandı</span>' : g.status === 'CLOSED_TEMPORARILY' ? '<span class="closed">Geçici olarak kapalı</span>'
      : g.openNow === true ? `<span class="open">Açık</span>${th ? ' · ' + esc(th) : ''}` : g.openNow === false ? `<span class="closed">Kapalı</span>${th ? ' · bugün ' + esc(th) : ''}` : '';
    head.insertAdjacentHTML('beforeend', `<div class="g-x g-rate">${g.rating ? `<b>${g.rating.toFixed(1).replace(".", ",")}</b><span class="g-stars" aria-label="5 üzerinden ${nf1.format(g.rating)}">${gStars(g.rating)}</span><span class="g-cnt">(${nf0.format(g.count)})</span>` : ''}${g.price ? `<span class="g-dot">·</span>${G_PRICE[g.price] || ''}` : ''}${!p.cat && g.type ? `<span class="g-dot">·</span>${esc(g.type)}` : ''}</div>${status ? `<div class="g-x g-status">${status}</div>` : ''}${g.summary ? `<p class="g-x g-sum">${esc(g.summary)}</p>` : ''}`);
  }
  // Fotoğraf şeridi: sokak görünümü + Google fotoğrafları
  const tiles = [];
  if (sv) tiles.push(`<a class="g-ph g-sv" href="https://www.google.com/maps/@?api=1&map_action=pano&pano=${encodeURIComponent(sv.pano)}&heading=${sv.heading}" target="_blank" rel="noopener"><img loading="lazy" alt="Sokak görünümü" src="/api/google/svimg?pano=${encodeURIComponent(sv.pano)}&h=${sv.heading}"><span class="g-cap"><span class="ms">streetview</span>Sokak görünümü${sv.date ? ' · ' + esc(sv.date.slice(0, 4)) : ''}</span></a>`);
  if (g) g.photos.forEach(ph => tiles.push(`<a class="g-ph" href="/api/google/photo?n=${encodeURIComponent(ph.n)}&w=1200" target="_blank" rel="noopener"><img loading="lazy" alt="${esc(g.name || p.name)} fotoğrafı" src="/api/google/photo?n=${encodeURIComponent(ph.n)}&w=400">${ph.by ? `<span class="g-by">${esc(ph.by)}</span>` : ''}</a>`));
  if (tiles.length) el.querySelector('.actions')?.insertAdjacentHTML('afterend', `<div class="g-x g-photos">${tiles.join('')}</div>`);
  const hero = el.querySelector('.place-hero');
  if (hero) { const first = g?.photos?.[0]; hero.classList.toggle('g-hero', !!first); hero.style.backgroundImage = first ? `url("/api/google/photo?n=${encodeURIComponent(first.n)}&w=800")` : ''; }
  // Bilgi satırları: OSM'de eksik olanları Google'dan tamamla
  if (g) {
    const info = el.querySelector('.info'), t = p.tags || {}, rows = [];
    if (!t.opening_hours && g.hours.length) rows.push(`<div class="info-row g-x"><span class="ms">schedule</span><ul class="hours">${g.hours.map((h, i) => `<li${i === (new Date().getDay() + 6) % 7 ? ' class="today"' : ''}>${esc(h)}</li>`).join('')}</ul></div>`);
    if (!(t.website || t['contact:website'] || t.url) && g.web) rows.push(`<a class="info-row g-x" href="${esc(g.web)}" target="_blank" rel="noopener"><span class="ms">public</span><span>${esc(g.web.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, ''))}</span></a>`);
    if (!(t.phone || t['contact:phone']) && g.phone) rows.push(`<a class="info-row g-x" href="tel:${esc(g.phone.replace(/\s/g, ''))}"><span class="ms">call</span><span>${esc(g.phone)}</span></a>`);
    if (g.url) rows.push(`<a class="info-row g-x" href="${esc(g.url)}" target="_blank" rel="noopener"><span class="ms">open_in_new</span><span>Google Haritalar'da yorumları gör</span></a>`);
    const link = g.url ? rows.pop() : '';
    const anchor = info?.querySelector('[data-copy]')?.nextElementSibling || info?.firstElementChild;
    if (anchor) anchor.insertAdjacentHTML('beforebegin', rows.join('')); else info?.insertAdjacentHTML('beforeend', rows.join(''));
    if (link) info?.querySelector('.info-row.copy:not(:first-child)')?.insertAdjacentHTML('beforebegin', link);
    const note = el.querySelector('.mini-note'); if (note && !note.dataset.g) { note.dataset.g = 1; note.textContent = 'Adres bilgisi OpenStreetMap topluluğundan; puan, saatler ve fotoğraflar Google\'dan gelir.'; }
  }
}
