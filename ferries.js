/* ================= Arabalı feribot hatları: ücret ve sefer bilgisi =================
   Rota bir feribot hattı içeriyorsa (OSRM/TomTom "ferry" adımı) hat tanınır, ücreti geçiş ücretlerine eklenir.
   Ücretler otomobil + sürücü, tek yön. Kaynaklarda doğrulanamayan hatlarda ücret gösterilmez ("?"),
   yerine işletmecinin güncel sefer/ücret sayfasına bağlantı verilir. */
const FERRY_DATE = 'Ocak 2026';
const FERRIES = [
  { name: 'Eskihisar–Topçular feribotu', op: 'İDO', a: [29.428, 40.766], b: [29.452, 40.704], price: 730, freq: '7/24 sefer', url: 'https://www.ido.com.tr/tr/tarife/ucret-tarifesi/' },
  { name: 'Sirkeci–Harem arabalı vapuru', op: 'İDO', a: [28.979, 41.015], b: [29.011, 41.018], price: 200, freq: 'Gün içinde sık sefer', url: 'https://www.ido.com.tr/tr/tarife/ucret-tarifesi/' },
  { name: 'Çanakkale–Eceabat feribotu', op: 'GESTAŞ', a: [26.403, 40.152], b: [26.357, 40.184], price: 725, freq: '7/24 sefer', url: 'https://www.gestas.com.tr' },
  { name: 'Çanakkale–Kilitbahir feribotu', op: 'GESTAŞ', a: [26.403, 40.150], b: [26.380, 40.148], price: null, url: 'https://www.gestas.com.tr' },
  { name: 'Gelibolu–Lapseki feribotu', op: 'GESTAŞ', a: [26.672, 40.409], b: [26.685, 40.343], price: null, url: 'https://www.gestas.com.tr' },
  { name: 'Kabatepe–Gökçeada feribotu', op: 'GESTAŞ', a: [26.271, 40.204], b: [25.948, 40.226], price: null, url: 'https://www.gestas.com.tr' },
  { name: 'Geyikli–Bozcaada feribotu', op: 'GESTAŞ', a: [26.205, 39.800], b: [26.070, 39.835], price: null, url: 'https://www.gestas.com.tr' },
  { name: 'Yenikapı–Bandırma feribotu', op: 'İDO', a: [28.949, 41.002], b: [27.972, 40.354], price: null, url: 'https://www.ido.com.tr/tr/tarife/ucret-tarifesi/' },
  { name: 'Yenikapı–Yalova feribotu', op: 'İDO', a: [28.949, 41.002], b: [29.274, 40.659], price: null, url: 'https://www.ido.com.tr/tr/tarife/ucret-tarifesi/' },
  { name: 'Yenikapı–Bursa (Güzelyalı) feribotu', op: 'İDO', a: [28.949, 41.002], b: [28.885, 40.375], price: null, url: 'https://www.ido.com.tr/tr/tarife/ucret-tarifesi/' },
  { name: 'Üçkuyular–Bostanlı arabalı vapuru', op: 'İZDENİZ', a: [27.067, 38.396], b: [27.096, 38.457], price: null, url: 'https://www.izdeniz.com.tr' }
];
function addFerries(r) {
  const legs = r.steps.filter(s => s.mode === 'ferry' && s.distance > 300);
  if (!legs.length) return;
  r.tolls ||= { total: 0, items: [] };
  for (const s of legs) {
    const end = (() => { let j = 0; while (j < r.cum.length - 1 && r.cum[j] < s.at + s.distance) j++; return r.coords[j]; })();
    const score = f => Math.min(haversine(s.loc, f.a) + haversine(end, f.b), haversine(s.loc, f.b) + haversine(end, f.a));
    const f = FERRIES.slice().sort((x, y) => score(x) - score(y))[0];
    const known = f && score(f) < 8000;
    const mins = Math.round((s.duration || 0) / 60);
    r.tolls.items.push({
      name: known ? f.name : 'Feribot geçişi', kind: 'feribot', km: s.distance / 1000, price: known ? f.price : null, at: s.at,
      note: [known ? f.op : '', mins ? `yaklaşık ${mins} dk geçiş` : '', known && f.freq ? f.freq : '', known && f.price == null ? 'ücret işletmeciden' : ''].filter(Boolean).join(' · '),
      url: known ? f.url : ''
    });
    if (known && f.price) r.tolls.total += f.price;
  }
  r.tolls.items.sort((a, b) => a.at - b.at);
}
