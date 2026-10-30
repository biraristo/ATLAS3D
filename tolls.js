// ATLAS3D — Otoyol, köprü ve tünel geçiş ücretleri (1. sınıf otomobil, KDV dahil)
// Kaynak: KGM 2026 geçiş ücreti tarifeleri (köprüler ve özel otoyollar 01.07.2026, KGM otoyolları 01.01.2026),
// Avrasya Tüneli 01.07.2026 tarifesi. Ücretler tahminîdir: gerçek ücret giriş–çıkış gişesine göre değişir.
'use strict';
const TOLL_DATE = 'Temmuz 2026';
// KGM işletimindeki otoyollar: resmî gişe çiftlerinden türetilen mesafe → ücret eğrisi (dilim ortancası, artan)
const TOLL_MATRIX = {"anadolu":{"step":10,"curve":[[5.0,40.0],[15.0,49.0],[25.0,49.0],[35.0,49.0],[45.0,49.0],[55.0,49.0],[65.0,73.0],[75.0,73.0],[85.0,73.0],[95.0,73.0],[105.0,89.0],[115.0,89.0],[125.0,89.0],[135.0,205.0],[145.0,205.0],[155.0,205.0],[165.0,221.0],[175.0,221.0],[185.0,221.0],[195.0,246.0],[205.0,246.0],[215.0,285.0],[225.0,285.0],[235.0,289.0],[245.0,289.0],[255.0,289.0],[265.0,289.0],[275.0,289.0],[285.0,289.0],[295.0,289.0],[305.0,289.0],[315.0,289.0],[325.0,289.0],[335.0,289.0],[345.0,305.0],[355.0,305.0],[365.0,305.0],[375.0,305.0],[385.0,338.0]],"max":338.0,"kmax":380.68},"avrupa":{"step":10,"curve":[[5.0,40.0],[15.0,40.0],[25.0,49.0],[35.0,59.0],[45.0,73.0],[55.0,73.0],[65.0,73.0],[75.0,73.0],[85.0,73.0],[95.0,73.0],[105.0,73.0],[115.0,115.0],[125.0,124.5],[135.0,134.0],[145.0,134.0],[155.0,134.0],[165.0,134.0],[175.0,168.0],[185.0,168.0],[195.0,168.0],[205.0,168.0],[215.0,168.0]],"max":168.0,"kmax":211.9},"izmirCesme":{"step":5,"curve":[[7.5,49.0],[12.5,49.0],[17.5,49.0],[22.5,49.0],[27.5,49.0],[32.5,53.0],[37.5,53.0],[47.5,53.0],[57.5,53.0]],"max":53.0,"kmax":56.3},"izmirAydin":{"step":5,"curve":[[12.5,49.0],[22.5,49.0],[37.5,53.0],[42.5,53.0],[47.5,53.0],[57.5,53.0],[67.5,73.0],[92.5,73.0],[97.5,73.0]],"max":73.0,"kmax":99.6},"adanaGaziantep":{"step":10,"curve":[[5.0,36.0],[15.0,36.0],[25.0,45.0],[35.0,45.0],[45.0,45.0],[55.0,45.0],[65.0,65.0],[75.0,65.0],[85.0,65.0],[95.0,65.0],[105.0,73.0],[115.0,73.0],[125.0,102.0],[135.0,102.0],[145.0,102.0],[155.0,102.0],[165.0,102.0],[175.0,102.0]],"max":102.0,"kmax":178.0},"gaziantepUrfa":{"step":5,"curve":[[17.5,36.0],[22.5,45.0],[37.5,45.0],[42.5,54.0],[57.5,65.0],[77.5,65.0],[82.5,75.0],[97.5,75.0],[122.5,102.0]],"max":102.0,"kmax":120.0},"nigdeMersinAdana":{"step":10,"curve":[[5.0,36.0],[15.0,36.0],[25.0,45.0],[35.0,45.0],[45.0,45.0],[55.0,50.5],[65.0,50.5],[75.0,55.0],[85.0,65.0],[95.0,136.0],[105.0,160.0],[115.0,164.0],[125.0,164.0],[135.0,177.0],[145.0,177.0],[155.0,177.0],[165.0,181.0],[175.0,184.0],[185.0,184.0],[195.0,193.0],[205.0,197.0]],"max":197.0,"kmax":201.17}};
// Özel işletmeli otoyollar: uçtan uca ücret ve yaklaşık uzunluk (km)
const TOLL_PRIVATE = {
  o5: { name: 'İstanbul–İzmir Otoyolu (O-5)', e2e: 1725, len: 386, min: 65 },
  o6: { name: 'Malkara–Çanakkale Otoyolu (O-6)', e2e: 310, len: 96, min: 90 },
  kmoAvrupa: { name: 'Kuzey Marmara Otoyolu · Avrupa (O-7)', e2e: 260, len: 139, min: 65 },
  kmoYss: { name: 'Kuzey Marmara Otoyolu · YSS Kuzey Çevre (O-7)', e2e: 600, len: 115, min: 45 },
  kmoAnadolu: { name: 'Kuzey Marmara Otoyolu · Anadolu (O-7)', e2e: 600, len: 169, min: 65 },
  ankaraNigde: { name: 'Ankara–Niğde Otoyolu (O-21)', e2e: 925, len: 330, min: 70 },
  aydinDenizli: { name: 'Aydın–Denizli Otoyolu (O-31)', e2e: 590, len: 163, min: 75 },
  menemen: { name: 'Menemen–Aliağa–Çandarlı Otoyolu (O-33)', e2e: 240, len: 89, min: 60 },
  cesmeli: { name: 'Çeşmeli–Kızkalesi Otoyolu', e2e: 220, len: 52, min: 45 }
};
const TOLL_MATRIX_NAMES = {
  anadolu: 'Anadolu Otoyolu (O-4)', avrupa: 'Avrupa Otoyolu (O-3)', izmirCesme: 'İzmir–Çeşme Otoyolu (O-32)', izmirAydin: 'İzmir–Aydın Otoyolu (O-31)',
  adanaGaziantep: 'Adana–Gaziantep Otoyolu (O-52)', gaziantepUrfa: 'Gaziantep–Şanlıurfa Otoyolu (O-52)', nigdeMersinAdana: 'Niğde–Mersin–Adana Otoyolu (O-21/O-51)'
};
// Köprü ve tünel: geçiş noktası (boğaz/körfez ortası) ve ücret
const TOLL_CROSSINGS = [
  { id: 'temmuz15', name: '15 Temmuz Şehitler Köprüsü', at: [29.03439, 41.04549], price: 59, kind: 'köprü' },
  { id: 'fsm', name: 'Fatih Sultan Mehmet Köprüsü', at: [29.06144, 41.09131], price: 59, kind: 'köprü' },
  { id: 'yss', name: 'Yavuz Sultan Selim Köprüsü', at: [29.11178, 41.20307], price: 110, kind: 'köprü' },
  { id: 'osmangazi', name: 'Osmangazi Köprüsü', at: [29.51600, 40.75530], price: 1170, kind: 'köprü' },
  { id: 'c1915', name: '1915 Çanakkale Köprüsü', at: [26.63750, 40.33930], price: 1170, kind: 'köprü', inO6: true },
  { id: 'avrasya', name: 'Avrasya Tüneli', name_re: /Avrasya Tüneli/i, price: 330, night: 165, kind: 'tünel' }
];

function tollSystem(s) {
  const ref = (s.ref || '').toUpperCase(), name = s.name || '', [lon, lat] = s.loc || [0, 0];
  const has = r => new RegExp('(^|[^0-9A-Z])' + r + '(?![0-9])').test(ref);
  if (/\bO-?(1|2|20|22|30|54)\b/.test(ref) && !/\bO-?(3|4|5|6|7|21|31|32|33|51|52|53)\b/.test(ref)) return null; // ücretsiz çevre yolları
  if (has('O-4') || /Anadolu Otoyolu/i.test(name)) return /Kuzey Marmara/i.test(name) ? null : { m: 'anadolu' };
  if (has('O-3') || /Avrupa Otoyolu|Edirne.?İstanbul Otoyolu/i.test(name)) return { m: 'avrupa' };
  if (has('O-5') || /İstanbul.?(İzmir|Bursa) Otoyolu|Gebze.?Orhangazi/i.test(name)) return { p: 'o5' };
  if (has('O-6') || /Malkara|Kınalı.?Çanakkale Otoyolu/i.test(name)) return { p: 'o6' };
  if (has('O-7') || /Kuzey Marmara Otoyolu/i.test(name)) return { p: lon < 28.80 ? 'kmoAvrupa' : lon < 29.30 ? 'kmoYss' : 'kmoAnadolu' };
  if (has('O-21') || /Ankara.?(Niğde|Tarsus) Otoyolu/i.test(name)) return lat > 38.0 ? { p: 'ankaraNigde' } : { m: 'nigdeMersinAdana' };
  if (has('O-51')) return lon > 34.2 || /Tarsus|Adana|Mersin/i.test(name) ? { m: 'nigdeMersinAdana' } : { p: 'cesmeli' };
  if (has('O-52') || has('O-53') || /Tarsus.?Adana.?Gaziantep|Gaziantep.?Şanlıurfa/i.test(name)) return lon < 37.3 ? { m: 'adanaGaziantep' } : { m: 'gaziantepUrfa' };
  if (has('O-31') || /İzmir.?Aydın|Aydın.?Denizli/i.test(name)) return lon < 27.86 ? { m: 'izmirAydin' } : { p: 'aydinDenizli' };
  if (has('O-32') || /İzmir.?Çeşme/i.test(name)) return { m: 'izmirCesme' };
  if (has('O-33') || /Çandarlı/i.test(name)) return { p: 'menemen' };
  return null;
}
const round5 = v => Math.round(v / 5) * 5;
function priceMatrix(key, km) {
  const t = TOLL_MATRIX[key]; if (!t) return 0;
  if (km >= t.kmax) return t.max;
  const pt = t.curve.find(p => km <= p[0] + t.step / 2);
  return Math.round(pt ? pt[1] : t.max);
}
function pricePrivate(key, km, bridgeIncluded) {
  const s = TOLL_PRIVATE[key];
  if (key === 'o6' && bridgeIncluded) return 1170 + Math.max(0, round5(s.e2e * Math.max(0, km - 4.6) / s.len));
  return Math.min(s.e2e, Math.max(s.min, round5(s.e2e * km / s.len)));
}
// Rota çizgisi bir noktanın (köprü ortası) yakınından geçiyor mu? Segment–nokta uzaklığıyla (uzun köprü segmentleri için)
function routeIndexNear(coords, pt, meters) {
  const k = Math.cos(pt[1] * Math.PI / 180) * 111320, lim2 = meters * meters;
  for (let i = 1; i < coords.length; i++) {
    const ax = (coords[i - 1][0] - pt[0]) * k, ay = (coords[i - 1][1] - pt[1]) * 110540, bx = (coords[i][0] - pt[0]) * k, by = (coords[i][1] - pt[1]) * 110540;
    const dx = bx - ax, dy = by - ay, L = dx * dx + dy * dy, u = L ? Math.max(0, Math.min(1, -(ax * dx + ay * dy) / L)) : 0;
    const x = ax + u * dx, y = ay + u * dy;
    if (x * x + y * y < lim2) return i;
  }
  return -1;
}
// Rota için ücret dökümü: { total, items: [{ name, kind, km, price, at, note }] }
function computeTolls(r, departAt = new Date()) {
  const items = [];
  const c1915 = TOLL_CROSSINGS.find(c => c.id === 'c1915'), crosses1915 = routeIndexNear(r.coords, c1915.at, 250) >= 0;
  // 1) Her adımın kapsadığı yol parçalarını tek tek, bulundukları yere göre ücretli sisteme ata
  //    (tek bir "devam edin" adımı yüzlerce km sürebilir ve işletmeci değişebilir: ör. İzmir–Aydın → Aydın–Denizli)
  const runs = []; let run = null;
  const idxAt = d => { let lo = 0, hi = r.cum.length - 1; while (lo < hi) { const m = (lo + hi) >> 1; if (r.cum[m] < d) lo = m + 1; else hi = m; } return lo; };
  for (const st of r.steps) {
    if (!(st.distance > 0)) continue;
    const i0 = idxAt(st.at), i1 = Math.min(r.coords.length - 1, idxAt(st.at + st.distance));
    for (let i = Math.max(1, i0 + 1); i <= Math.max(i0 + 1, i1) && i < r.coords.length; i++) {
      const a = r.coords[i - 1], b = r.coords[i], seg = r.cum[i] - r.cum[i - 1];
      const sys = tollSystem({ ref: st.ref, name: st.name, loc: [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2] }), key = sys && (sys.m || sys.p);
      if (run && run.key !== key) { runs.push(run); run = null; }
      if (!sys) continue;
      if (!run) run = { key, m: sys.m, p: sys.p, km: 0, at: r.cum[i - 1], end: r.cum[i - 1] };
      run.km += seg / 1000; run.end = r.cum[i];
    }
  }
  if (run) runs.push(run);
  // 2) Kavşak/rampa gibi kısa kopuklukları (< 2,5 km) birleştir: otoyoldan çıkılmadıysa tek giriş–çıkış
  const merged = [];
  for (const x of runs) {
    const prev = merged[merged.length - 1];
    if (prev && prev.key === x.key && x.at - prev.end < 2500) { prev.km += x.km + (x.at - prev.end) / 1000; prev.end = x.end; }
    else merged.push({ ...x });
  }
  // 3) Ücretlendir
  for (const x of merged) {
    if (x.km < 2) continue;
    const bridgeIn = x.p === 'o6' && crosses1915;
    const price = x.m ? priceMatrix(x.m, x.km) : pricePrivate(x.p, x.km, bridgeIn);
    items.push({ name: x.m ? TOLL_MATRIX_NAMES[x.m] : TOLL_PRIVATE[x.p].name + (bridgeIn ? ' · köprü dahil' : ''), kind: 'otoyol', km: x.km, price, at: x.at, o6bridge: bridgeIn });
  }
  // Köprü ve tüneller
  for (const c of TOLL_CROSSINGS) {
    if (c.inO6 && items.some(i => i.o6bridge)) continue;
    let hit = false, at = 0;
    if (c.at) { const k = routeIndexNear(r.coords, c.at, 250); if (k >= 0) { hit = true; at = r.cum[k]; } }
    else if (c.name_re) { const st = r.steps.find(s => c.name_re.test(s.name || '')); if (st) { hit = true; at = st.at; } }
    if (!hit) continue;
    let price = c.price, note = '';
    if (c.night) { const t = new Date(departAt.getTime() + (r.duration * at / Math.max(1, r.total)) * 1000), h = t.getHours(); if (h < 5) { price = c.night; note = 'gece tarifesi'; } else note = 'gece 00–05 arası ₺' + c.night; }
    items.push({ name: c.name, kind: c.kind, price, at, note });
  }
  items.sort((a, b) => a.at - b.at);
  return { total: items.reduce((s, i) => s + i.price, 0), items };
}
const fmtTL = v => '₺' + new Intl.NumberFormat('tr-TR', { maximumFractionDigits: 0 }).format(Math.round(v));
