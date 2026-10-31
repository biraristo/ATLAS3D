/* ================= Yakıt / enerji maliyeti =================
   Araca özel fizik modeli. Her araç için:
     - Kütle, gövde (hava direnci), lastik direnci, motor hacmi, güç aktarımı (benzinli/dizel, hafif hibrit, tam hibrit,
       şarj edilebilir hibrit, elektrik) katalogdan (AB Çevre Ajansı tip onayı verisi) ya da gövde tipinden gelir.
     - Motor: Willans tipi model. Yakıt gücü = (tekerlek gücü / aktarma verimi + iç sürtünme + yardımcılar) / motor verimi.
       İç sürtünme motor hacmi ve devirle büyür (Chen-Flynn FMEP); böylece büyük motor şehirde, küçük motor yükte farklı davranır.
     - Kalibrasyon: aracın resmî test döngüsü (WLTC 3b ya da NEDC, saniye saniye) modelde sürülür; sürtünme katsayısı,
       sonuç resmî tüketimi verecek şekilde çözülür (soğuk çalıştırma payı ayrılarak). Elektrikli araçta tek çarpan çözülür.
     - Gerçek yol: rota ~30 m parçalara bölünür; her parçada eğim (rakım profili), yol tipine göre gerçekçi seyir hızı,
       dur-kalk, rakım ve sıcaklığa göre hava yoğunluğu, rüzgârın rota yönündeki bileşeni, klima/ısıtma, soğuk çalıştırma
       ve trafik gecikmesi hesaba katılır. Test laboratuvarı ile yol arasındaki ölçemediğimiz fark için sabit bir pay eklenir;
       kullanıcı yakıt alımlarını girdikçe araca özel kişisel katsayı öğrenilir ve belirsizlik aralığı daralır.
   Fiyatlar: EPDK günlük bayi satış fiyatı bülteni (/api/fuel); elektrikte düzenlenebilir şarj fiyatı. */
'use strict';

const G = 9.81;
// Elle tanımlanan (katalogda olmayan) araçlar için tipik değerler; avg: gerçek kullanımda tipik ortalama tüketim
const BODIES = {
  hatchback: { label: 'Hatchback', icon: 'directions_car', m: 1250, cda: 0.62, crr: 0.010, cc: 1300, avg: { benzin: 6.5, dizel: 5.3, lpg: 8.3, elektrik: 16 } },
  sedan: { label: 'Sedan', icon: 'directions_car', m: 1450, cda: 0.66, crr: 0.010, cc: 1500, avg: { benzin: 7.0, dizel: 5.7, lpg: 8.9, elektrik: 17 } },
  suv: { label: 'SUV', icon: 'directions_car', m: 1750, cda: 0.85, crr: 0.011, cc: 1600, avg: { benzin: 8.3, dizel: 6.6, lpg: 10.5, elektrik: 20 } },
  ticari: { label: 'Hafif ticari', icon: 'local_shipping', m: 1650, cda: 0.95, crr: 0.011, cc: 1600, avg: { benzin: 8.0, dizel: 6.4, lpg: 10.2, elektrik: 22 } },
  motor: { label: 'Motosiklet', icon: 'two_wheeler', m: 260, cda: 0.55, crr: 0.015, cc: 400, avg: { benzin: 4.2, elektrik: 6 } }
};
// Enerji içeriği: alt ısıl değer, MJ/L (elektrikte 1 kWh = 3,6 MJ)
const FUELS = {
  benzin: { label: 'Benzin', unit: 'L', mj: 32.0 },
  dizel: { label: 'Dizel', unit: 'L', mj: 35.8 },
  lpg: { label: 'LPG', unit: 'L', mj: 24.6 },
  elektrik: { label: 'Elektrik', unit: 'kWh', mj: 3.6 }
};
const PT_LABEL = { ice: '', mhev: 'Hafif hibrit', hev: 'Hibrit', phev: 'Şarj edilebilir hibrit', bev: 'Elektrikli' };
const LPG_CONV = 1.24; // sonradan LPG takılmış benzinli: aynı enerji için ~%24 daha fazla litre (enerji yoğunluğu 32 / 24,6 × motor verim farkı)
const EV_PRICE_DEFAULT = 14.4; // DC hızlı şarj, Ekim 2026 operatör ortalaması (₺/kWh); kullanıcı değiştirebilir
const FUEL_FALLBACK = { benzin: 76.31, dizel: 96.82, lpg: 42.36, date: '2026-10-30', source: 'EPDK bülteni (son bilinen)' };
const DRIVE_STYLES = { calm: { label: 'Sakin', f: 0.92 }, normal: { label: 'Normal', f: 1 }, fast: { label: 'Hızlı', f: 1.1 } };
const FSET = Object.assign({ style: 'normal', weather: true }, store.get('fuelSettings', {}));
const saveFset = () => store.set('fuelSettings', FSET);

/* ----- Araçlarım: birden fazla araç; hesaplar seçili araca göre ----- */
const fixVeh = v => {
  if (!BODIES[v.body]) v.body = 'sedan';
  if (!FUELS[v.fuel] || (!v.cat && !(v.fuel in BODIES[v.body].avg))) v.fuel = 'benzin';
  v.pax = Math.max(1, Math.min(9, v.pax || 1)); v.name = (v.name || 'Aracım').slice(0, 40);
  if (!Array.isArray(v.fills)) v.fills = [];
  if (v.soc == null) v.soc = 100;
  return v;
};
// Garaj boş olabilir: o zaman listede görünmeyen "tipik binek araç" ile hesaplanır ve kullanıcıdan araç eklemesi istenir
const DEFAULT_VEH = pax => fixVeh({ id: '__default', name: 'Tipik binek araç', body: 'sedan', fuel: 'benzin', avg: null, price: null, tank: null, pax: pax || 1, def: true });
const GARAGE = (() => {
  let list = store.get('vehicles', null), active = store.get('vehicleActive', null);
  if (!Array.isArray(list)) {
    const old = store.get('vehicle', null); // eski tek araç kaydı
    list = old ? [{ id: 'v' + Date.now().toString(36), name: 'Aracım', body: 'sedan', fuel: 'benzin', avg: null, price: null, tank: null, pax: 1, ...old }] : [];
    active = list[0]?.id || null;
  }
  list.forEach(fixVeh);
  return { list, active };
})();
let VEH = GARAGE.list.find(v => v.id === GARAGE.active) || GARAGE.list[0] || DEFAULT_VEH();
const saveVeh = () => { store.set('vehicles', GARAGE.list); store.set('vehicleActive', VEH.def ? null : VEH.id); };
function setActiveVehicle(id) {
  const v = GARAGE.list.find(x => x.id === id); if (!v || v === VEH) return;
  v.pax = VEH.pax; VEH = v; saveVeh();
  clearCostCache();
  if (typeof refreshDirResults === 'function' && dir.routes.length) { const box = $('veh-box'); if (box) { box.innerHTML = vehChipHtml(); wireVehBox(); } refreshDirResults(); }
}
// Araçta tankı dolduran yakıt (PHEV: benzin/dizel; LPG dönüşümlü: LPG)
const vehFuel = (v = VEH) => (v.lpgConv && v.fuel === 'benzin' ? 'lpg' : v.fuel);
const isPhev = (v = VEH) => v.cat?.p === 'phev';

/* ----- Fiyatlar ----- */
let FUEL_PRICES = store.get('fuelPrices', null) || FUEL_FALLBACK;
const fuelPricesReady = fetch('/api/fuel').then(r => (r.ok ? r.json() : null)).then(d => {
  if (d && (d.benzin || d.dizel || d.lpg)) { FUEL_PRICES = { ...FUEL_FALLBACK, ...Object.fromEntries(Object.entries(d).filter(([, v]) => v != null)), source: 'EPDK' }; store.set('fuelPrices', FUEL_PRICES); }
}).catch(() => {}).finally(() => { if (typeof refreshDirResults === 'function' && dir.routes.length) { clearCostCache(); refreshDirResults(); } });
const priceDate = () => FUEL_PRICES.date ? new Date(FUEL_PRICES.date + 'T12:00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' }) : '';
function unitPrice(v = VEH) {
  const f = vehFuel(v);
  if (v.price) return { v: v.price, src: 'Kendi girdiğiniz fiyat' };
  if (f === 'elektrik') return { v: EV_PRICE_DEFAULT, src: 'DC hızlı şarj ortalaması' };
  const d = priceDate();
  return { v: FUEL_PRICES[f], src: `EPDK bülteni${d ? ', ' + d : ''} · Türkiye ortalaması` };
}
const elecPrice = (v = VEH) => v.elecPrice || EV_PRICE_DEFAULT; // PHEV'in şarj fiyatı

/* ================= Fizik modeli ================= */
const STOPS = [[10, 6], [25, 3.5], [40, 2], [55, 1.1], [75, 0.4], [95, 0.12], [120, 0.04]]; // ortalama hız (km/sa) → km başına duruş
const lerpTab = (t, x) => { if (x <= t[0][0]) return t[0][1]; for (let i = 1; i < t.length; i++) if (x <= t[i][0]) { const [a, va] = t[i - 1], [b, vb] = t[i]; return va + (vb - va) * (x - a) / (b - a); } return t[t.length - 1][1]; };
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));

// Aracın fizik parametreleri (kalibrasyon hariç). cat: katalog kaydı; yoksa gövde tipinden.
function physBase(v) {
  const c = v.cat;
  if (c) {
    const body = c.body || 'car', y = c.y || 2018;
    const W = c.at ? c.at / 1000 + 0.27 : clamp(1.62 + 0.00024 * (c.m - 1100), 1.6, 2.05);
    const H = { car: 1.46, suv: 1.65, van: 1.85 }[body];
    let cd = { car: y <= 2012 ? 0.32 : 0.30, suv: 0.35, van: 0.36 }[body]; if (c.p === 'bev') cd -= 0.03;
    let crr = y >= 2013 ? 0.0095 : 0.011; crr += body === 'suv' ? 0.0007 : body === 'van' ? 0.001 : 0; if (c.p === 'bev') crr -= 0.0005;
    return { m0: c.m - 75, cda: cd * 0.84 * W * H, crr, cc: (c.cc || 1500) / 1000, pt: c.p, fuel: c.f === 'elektrik' ? 'elektrik' : c.f, year: y, body };
  }
  const b = BODIES[v.body];
  return { m0: b.m, cda: b.cda, crr: b.crr, cc: b.cc / 1000, pt: v.fuel === 'elektrik' ? 'bev' : 'ice', fuel: v.fuel, year: 2016, body: v.body === 'suv' ? 'suv' : v.body === 'ticari' ? 'van' : 'car' };
}
// Güç aktarımına göre motor/sürüş parametreleri
function physEngine(b) {
  const diesel = b.fuel === 'dizel', pt = b.pt;
  if (pt === 'bev') return { ev: true, etaDrive: 0.87, regen: 0.65, etaChg: 0.9, auxW: 300 };
  const e = {
    etaInd: diesel ? 0.45 : 0.41, etaDt: 0.91, idleRpm: diesel ? 780 : 800,
    rpm0: diesel ? 1200 : 1300, rpm1: diesel ? 9 : 10, auxW: 450,
    ss: b.year >= 2014 ? 0.5 : 0, regen: 0, hev: false
  };
  if (pt === 'mhev') { e.ss = 0.75; e.regen = 0.12; }
  if (pt === 'hev' || pt === 'phev') { e.hev = true; e.ss = 1; e.regen = 0.5; e.etaInd = diesel ? 0.45 : 0.43; }
  return e;
}
// Yoğunluk: rakım ve sıcaklık
const airRho = (elev, T = 15) => 1.225 * Math.exp(-(elev || 0) / 8500) * 288.15 / (273.15 + T);
// Ortam: sıcaklık → klima (mekanik/elektrik W), elektrikli araçta ısıtma ve soğuk batarya
function envFor(T, ev) {
  const t = T ?? 15;
  const ac = t > 20 ? Math.min(1500, (t - 20) * 130) : 0;
  const heat = ev && t < 15 ? Math.min(3000, (15 - t) * 170) : 0; // içten yanmalı araçta ısıtma atık ısıdan, bedava
  const batt = ev && t < 10 ? Math.max(0.85, 1 - (10 - t) * 0.008) : 1;
  return { T: t, auxW: ac + heat, batt };
}
const ENV0 = { T: 23, auxW: 0, batt: 1 }; // laboratuvar

// Anlık yakıt gücü (W, yakıtın kimyasal enerjisi; elektrikte şebekeden çekilen güç). fk: sürtünme katsayısı (kalibrasyon).
// split=true iken [sürtünmeden bağımsız kısım, sürtünmeyle orantılı kısım] döner (kalibrasyon doğrusal çözülür).
function fuelPower(P, Pw, v, env, split) {
  const E = P.eng;
  if (E.ev) {
    let pb = Pw >= 0 ? Pw / (E.etaDrive * env.batt) : Pw * E.regen * env.batt;
    pb += E.auxW + env.auxW;
    const g = pb / E.etaChg;
    return split ? [g, 0] : g * P.k;
  }
  const kmh = v * 3.6, n = v < 0.5 ? E.idleRpm : clamp(E.rpm0 + E.rpm1 * kmh, E.idleRpm, 3200), nk = n / 1000;
  const fric = (0.97e5 + 0.15e5 * nk + 0.05e5 * nk * nk) * P.vd * n / 120; // W (FMEP × hacim × devir / 120, 4 zamanlı)
  const aux = E.auxW + env.auxW;
  let a = 0, b = 0; // a: sürtünmesiz, b: sürtünme payı (fk ile çarpılacak)
  if (v < 0.5) { // duruyor: rölanti (dur-kalk sistemi motoru kısmen/tamamen durdurur)
    const on = 1 - E.ss; a = aux * on / E.etaInd; b = fric * on / E.etaInd;
    if (E.hev) a = aux / (E.etaInd * 0.85); // hibritte motor kapalı, yardımcılar bataryadan (sonra motorla şarj)
  } else if (Pw >= 0) {
    const pe = Pw / E.etaDt;
    // Tam hibrit düşük yükte motoru kapatıp elektrikle gider: sürtünme yalnızca motorun çalıştığı oranda
    const on = E.hev ? clamp(0.25 + pe / 20000, 0.25, 1) : 1;
    a = (pe + aux) / E.etaInd; b = fric * on / E.etaInd;
  } else { // yavaşlama: yakıt kesik; hibrit enerjinin bir kısmını geri kazanır (negatif = sonraki yakıttan düşülür)
    a = (Pw * E.regen + (E.hev ? aux : 0)) / E.etaInd;
    b = E.hev ? 0 : fric * 0.15 / E.etaInd; // motor freni sırasında yağlama/rölanti payı
  }
  return split ? [a, b] : (a + b * P.fk) * P.k;
}
const wheelPower = (P, m, v, a, grade, rho, vw = 0) => {
  const vr = v + vw;
  return (m * 1.04 * a + m * G * P.crr + 0.5 * rho * P.cda * vr * Math.abs(vr) + m * G * grade) * v;
};
// Hız-zaman izi üzerinde toplam enerji (J) — [a, b] ayrık
function traceEnergy(P, trace, m, env) {
  let A = 0, B = 0; const rho = airRho(0, env.T);
  for (let i = 0; i < trace.length - 1; i++) {
    const v0 = trace[i] / 3.6, v1 = trace[i + 1] / 3.6, v = (v0 + v1) / 2, acc = v1 - v0;
    const [a, b] = fuelPower(P, wheelPower(P, m, v, acc, 0, rho), v < 0.3 ? 0 : v, env, true);
    A += a; B += b;
  }
  return [A, B];
}
// Mesafe tabanlı parça (rota): ortalama hızda seyir + km başına duruşlarda hızlanma ve rölanti
function segParts(P, m, v, dx, dh, elev, env, vw = 0) {
  const kmh = v * 3.6, stopsPerKm = lerpTab(STOPS, kmh), vPeak = Math.min(75, kmh * (kmh < 60 ? 1.3 : 1.12)) / 3.6;
  const rho = airRho(elev, env.T), t = dx / v, grade = dh / dx;
  const nStops = stopsPerKm * dx / 1000, ke = 0.5 * m * 1.04 * vPeak * vPeak * nStops;
  const roll = m * G * P.crr * dx, aero = 0.5 * rho * P.cda * (v + vw) * Math.abs(v + vw) * dx, gr = m * G * dh;
  const cruise = fuelPower(P, wheelPower(P, m, v, 0, grade, rho, vw), v, env, true);
  // Hızlanma işi: tekerlekte ke; frende aynı enerji kaybolur (hibrit/elektrikte kısmen geri döner).
  // Seyir süresi zaten sayıldığı için burada yalnızca güçteki artış (sürtünme/yardımcı hariç) eklenir.
  let A = cruise[0] * t, B = cruise[1] * t;
  const idleT = nStops * (kmh < 45 ? 18 : 8), idle = fuelPower(P, 0, 0, env, true);
  if (nStops > 0) {
    const vm = vPeak / 2, base = fuelPower(P, 0, vm, env, true)[0], accT = nStops * 8, brkT = nStops * 6;
    A += (fuelPower(P, ke / accT, vm, env, true)[0] - base) * accT + (fuelPower(P, -ke / brkT, vm, env, true)[0] - base) * brkT;
    A += idle[0] * idleT; B += idle[1] * idleT;
  }
  const e = (A + B * (P.fk ?? 1)) * (P.k ?? 1);
  return { e, roll, aero, gr, ke, idleE: (idle[0] + idle[1] * (P.fk ?? 1)) * (P.k ?? 1) * idleT };
}
// Gerçek kullanım referansı: düz yolda %45 şehir içi (30 km/sa), %25 şehirlerarası (75), %30 otoyol (110), 18 °C
const REF_MIX = [[30, 0.45], [75, 0.25], [110, 0.30]];
function refEnergyPerM(P, m) { const env = envFor(18, P.eng.ev); return REF_MIX.reduce((s, [kmh, w]) => s + w * segParts(P, m, kmh / 3.6, 1000, 0, 0, env).e / 1000, 0); }

// Modellenmeyen farkın hıza göre dağılımı: kullanıcı raporları farkın çoğunun şehir içinde (sert hızlanma, kısa yol,
// rölanti) oluştuğunu, sabit otoyol sürüşünde küçük kaldığını gösteriyor. Ağırlık referans karışımda ortalama 1 olacak
// şekilde normalize edilir; böylece aracın tipik tüketimi değişmez, yalnızca şehir/otoyol dağılımı düzelir.
const residW = kmh => clamp(1.7 - 0.014 * kmh, 0.3, 1.5);
function residNorm(P) {
  const env = envFor(18, P.eng.ev), m = P.m0 + 90; let num = 0, den = 0;
  for (const [kmh, w] of REF_MIX) { const e = segParts(P, m, kmh / 3.6, 1000, 0, 0, env).e * w; num += e * residW(kmh); den += e; }
  return num / den || 1;
}
// Hızdaki pay / ortalama pay oranı (enerjiyle çarpılır; dönüşümde P.resid zaten var)
const residScale = (P, kmh) => (P.resid > 1 ? (1 + (P.resid - 1) * residW(kmh) / (P.wNorm || 1)) / P.resid : 1);

// Laboratuvar → yol farkının modellenmeyen kısmı (yük, lastik basıncı, test esneklikleri, sürüş). Kaynak: ICCT "From laboratory to road"
// serisinde NEDC farkı 2010'larda %25–40'a çıkar, WLTP'de ~%15'e iner; bunun hız/klima/soğuk çalıştırma kısmını ayrıca modelliyoruz.
function residual(c) {
  if (!c) return 1;
  if (c.b === 'n') return c.p === 'bev' ? 1.2 : c.y <= 2014 ? 1.12 : 1.2;
  return { ice: 1.08, mhev: 1.09, hev: 1.12, phev: 1.1, bev: 1.18 }[c.p] || 1.08;
}
const COLD_SHARE = (c, ev) => ev ? 0 : c?.b === 'n' ? 0.10 : 0.055; // resmî değerdeki soğuk çalıştırma payı

// Aracın kalibre edilmiş modeli (bellekte saklanır)
const PHYS_CACHE = new Map();
function vehPhys(v = VEH) {
  const key = JSON.stringify([v.cat, v.body, v.fuel, v.avg, v.lpgConv]);
  const hit = PHYS_CACHE.get(v.id); if (hit && hit.key === key) return hit;
  const b = physBase(v), eng = physEngine(b);
  const P = { key, ...b, eng, vd: b.cc / 1000, fk: 1, k: 1, resid: 1, coldJ: 0, ev: !!eng.ev, src: 'body' };
  const c = v.cat, mj = FUELS[b.fuel === 'elektrik' ? 'elektrik' : b.fuel].mj * 1e6; // J / birim
  P.unitJ = mj;
  if (c && c.p === 'phev') {
    // Şarj sürdürme (batarya boş): resmî veri yok → hibrit parametreleriyle fizikten; elektrik modu resmî Wh/km'ye kalibre
    P.src = 'phev'; P.resid = residual(c);
    const evP = { ...P, eng: physEngine({ ...b, pt: 'bev' }), ev: true, fk: 1, k: 1 };
    if (c.z) { const m = (c.mt || c.m + 100) - 0, cyc = CYCLES.wltc, [A] = traceEnergy(evP, cyc, m, ENV0), km = cyc.reduce((s, x) => s + x, 0) / 3600; evP.k = c.z * 3600 * km / A; }
    evP.unitJ = 3.6e6; evP.resid = 1.18;
    P.evPart = evP; P.batKWh = c.z && c.er ? c.z * c.er / 1000 : 10; // şebeke tarafı kullanılabilir enerji (yaklaşık)
    P.coldJ = COLD_SHARE(c) * 5 / 100 * 23.27 * mj; // ~5 L/100 hibrit varsayımıyla
  } else if (c && c.c) {
    // Resmî döngüde aynı sonucu verecek sürtünme katsayısı (ya da elektrikte çarpan) çözülür
    const cyc = c.b === 'n' ? CYCLES.nedc : CYCLES.wltc, m = c.mt || c.m + (c.b === 'n' ? 25 : 100);
    const km = cyc.reduce((s, x) => s + x, 0) / 3600;
    const cold = COLD_SHARE(c, P.ev);
    const target = c.c / 100 * km * mj * (1 - cold); // J (sıcak motor)
    const [A, B] = traceEnergy(P, cyc, m, ENV0);
    if (P.ev) P.k = target / A;
    else {
      P.fk = clamp((target - A) / B, 0.25, 2.2);
      P.k = target / (A + B * P.fk);
    }
    P.resid = residual(c); P.coldJ = cold * c.c / 100 * km * mj; P.src = 'cat';
  } else {
    // Katalog dışı: gerçek kullanım ortalamasına (kullanıcının girdiği ya da gövde tipinin tipik değeri) kalibre
    const avg = v.avg || BODIES[v.body].avg[v.fuel], m = b.m0 + 90;
    P.k = (avg / 1e5 * mj) / refEnergyPerM(P, m);
    P.src = v.avg ? 'user' : 'body';
    if (!P.ev) P.coldJ = 0; // ortalama zaten soğuk çalıştırmaları içerir
  }
  if (v.lpgConv && b.fuel === 'benzin') { P.lpg = true; }
  P.wNorm = residNorm(P); if (P.evPart) P.evPart.wNorm = residNorm(P.evPart); // enerji benzine göre hesaplanır, litreye çevirirken LPG katsayısı
  PHYS_CACHE.set(v.id, P);
  return P;
}
// Kişisel katsayı: yakıt alımlarından (ve/veya yol bilgisayarı ortalamasından) — ağırlık km ile artar
function personal(v = VEH) {
  const P = vehPhys(v);
  if (P.src === 'user' || P.src === 'body') {
    const meas = fillStats(v); if (!meas) return { f: 1, w: v.avg ? 0.6 : 0, km: 0, n: 0 };
    const pred = refPer100(v, false), raw = clamp(meas.per100 / pred, 0.6, 1.6), w = meas.km / (meas.km + 800);
    return { f: 1 + w * (raw - 1), w: Math.max(w, v.avg ? 0.6 : 0), km: meas.km, n: meas.n, raw };
  }
  let f = 1, w = 0, km = 0, n = 0, raw = null;
  const meas = fillStats(v);
  if (meas) { raw = clamp(meas.per100 / refPer100(v, false), 0.6, 1.6); km = meas.km; n = meas.n; w = km / (km + 800); f = 1 + w * (raw - 1); }
  else if (v.avg) { raw = clamp(v.avg / refPer100(v, false), 0.6, 1.6); w = 0.6; f = 1 + w * (raw - 1); }
  return { f, w, km, n, raw };
}
// Gerçek kullanım tahmini (L ya da kWh / 100 km) — kişisel katsayı dahil/hariç
function refPer100(v = VEH, withPersonal = true) {
  const P = vehPhys(v), m = P.m0 + 90; // tipik değer: yalnız sürücü (yolcu yükü rotada ayrıca eklenir)
  let e;
  if (P.evPart) e = refEnergyPerM(P, m) * 1e5 / P.unitJ * P.resid; // PHEV: batarya boşken
  else e = (refEnergyPerM(P, m) * 1e5 + P.coldJ * (1 + 0.05 * 5) * 100 / 15) / P.unitJ * P.resid; // ortalama yolculuk ~15 km, 18 °C
  if (P.lpg) e *= LPG_CONV;
  return withPersonal ? e * personal(v).f : e;
}
const vehAvg = (v = VEH) => refPer100(v);
// Yakıt alımlarından gerçek ortalama: depo dolu → depo dolu aralıkları (ilk dolumun litresi sayılmaz)
function fillStats(v = VEH) {
  if (isPhev(v)) return null;
  const f = (v.fills || []).filter(x => x.odo > 0 && x.qty > 0).sort((a, b) => a.odo - b.odo);
  const fulls = f.map((x, i) => (x.full ? i : -1)).filter(i => i >= 0);
  if (fulls.length < 2) return null;
  const i0 = fulls[0], i1 = fulls[fulls.length - 1], km = f[i1].odo - f[i0].odo;
  if (km < 100) return null;
  let qty = 0; for (let i = i0 + 1; i <= i1; i++) qty += f[i].qty;
  return { per100: qty / km * 100, km, n: i1 - i0 };
}
// Belirsizlik (±, oran): kaynak türü, öğrenilen km ve hava bilgisinin olup olmamasına göre
function uncertainty(v = VEH, hasWx = true) {
  const P = vehPhys(v), base = { cat: v.cat?.b === 'n' ? 0.13 : 0.10, phev: 0.18, user: 0.10, body: 0.18 }[P.src] || 0.15;
  const w = personal(v).w;
  return 0.05 + (base - 0.05) * (1 - w) + (hasWx ? 0 : 0.02);
}

/* ----- Rota üzerinde hız ----- */
// OSRM (routing.openstreetmap.de) araç profili hızı yasal sınırın ~0,8'i alır; hızlı yollarda gerçek seyir hızına geri çevrilir,
// sürüş tarzına göre ölçeklenir ve araç sınıfının yasal üst sınırıyla kırpılır. Şehir içi hızlara dokunulmaz.
function speedFn(r, v = VEH) {
  const st = r.steps || [], ats = st.map(s => s.at), style = DRIVE_STYLES[FSET.style]?.f || 1;
  const P = vehPhys(v), cap = (P.body === 'van' ? 110 : 120) * (FSET.style === 'fast' ? 1.12 : 1) / 3.6;
  return x => {
    let lo = 0, hi = ats.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ats[m] <= x) lo = m; else hi = m - 1; }
    for (const j of [lo, lo - 1, lo + 1]) {
      const s = st[j]; if (!(s && s.duration > 0 && s.distance > 40)) continue;
      const osrm = s.distance / s.duration, kmh = osrm * 3.6;
      // TomTom adım süreleri gerçek (trafikli) hızdır: OSRM'deki yasal sınır × 0,8 dönüşümü uygulanmaz
      if (r.provider === 'tomtom') return { v: Math.max(3, Math.min(cap, kmh >= 60 ? osrm * style : osrm)), base: osrm };
      if (kmh < 60) return { v: Math.max(3, osrm), base: osrm };
      const real = kmh >= 75 ? osrm / 0.8 : osrm * (1 + (kmh - 60) / 15 * 0.25); // 60→75 arası yumuşak geçiş
      return { v: Math.max(3, Math.min(cap, real * style)), base: osrm };
    }
    return { v: 50 / 3.6, base: 50 / 3.6 };
  };
}

/* ----- Hava durumu (Open-Meteo, /api/weather) ----- */
const WX = new WeakMap();
function routeWeather(r) {
  if (!FSET.weather || !r?.coords?.length) return null;
  const w = WX.get(r);
  if (w && (w.data || w.pending) && Date.now() - w.t < 30 * 60e3) return w.data || null;
  if (w && !w.data && Date.now() - w.t < 5 * 60e3) return null; // başarısız istek: 5 dk tekrar deneme
  // Yol boyunca en çok 6 nokta
  const n = Math.min(6, Math.max(2, Math.ceil((r.total || 0) / 80000) + 1)), pts = [];
  for (let i = 0; i < n; i++) { const c = r.coords[Math.round(i / (n - 1) * (r.coords.length - 1))]; pts.push(c[1].toFixed(2) + ',' + c[0].toFixed(2)); }
  const ent = { pending: true, t: Date.now(), data: null }; WX.set(r, ent);
  fetch('/api/weather?pts=' + pts.join(';')).then(x => (x.ok ? x.json() : null)).then(d => {
    if (!d?.points?.length) return;
    ent.data = { pts: d.points.map((p, i) => ({ at: i / (n - 1) * (r.total || 0), T: p.t, ws: p.ws, wd: p.wd })) };
    COST_CACHE.delete(r);
    if (typeof refreshDirResults === 'function' && dir.routes.includes(r) && !navActive) refreshDirResults();
  }).catch(() => {}).finally(() => { ent.pending = false; });
  return null;
}
function wxAt(wx, x) {
  if (!wx) return null; const p = wx.pts; if (p.length === 1) return p[0];
  let i = 1; while (i < p.length - 1 && p[i].at < x) i++;
  const a = p[i - 1], b = p[i], t = clamp((x - a.at) / ((b.at - a.at) || 1), 0, 1);
  // rüzgâr vektörü bileşenleriyle karıştırılır
  const ux = (q, f) => q.ws * Math.sin(q.wd * Math.PI / 180) * f, uy = (q, f) => q.ws * Math.cos(q.wd * Math.PI / 180) * f;
  return { T: a.T + (b.T - a.T) * t, ex: ux(a, 1 - t) + ux(b, t), ny: uy(a, 1 - t) + uy(b, t) };
}
// Karşı rüzgâr (m/s, +: karşıdan), araç yüksekliğinde (10 m ölçümün ~%75'i). ex/ny: rüzgârın GELDİĞİ yön vektörü.
const headwind = (w, brg) => w ? 0.75 * (w.ex * Math.sin(brg) + w.ny * Math.cos(brg)) : 0;
const bearingRad = (a, b) => { const k = Math.cos((a[1] + b[1]) / 2 * Math.PI / 180); return Math.atan2((b[0] - a[0]) * k, b[1] - a[1]); };

function smoothElev(e, step, W = 600) {
  const k = Math.max(1, Math.round(W / 2 / step)), pre = [0];
  for (const v of e) pre.push(pre[pre.length - 1] + v);
  return e.map((_, i) => { const a = Math.max(0, i - k), b = Math.min(e.length, i + k + 1); return (pre[b] - pre[a]) / (b - a); });
}

/* ----- Rota maliyeti ----- */
const COST_CACHE = new WeakMap();
const clearCostCache = () => { PHYS_CACHE.clear(); if (typeof dir !== 'undefined') for (const r of dir.routes) COST_CACHE.delete(r); };
const vehSig = () => JSON.stringify([VEH.id, VEH.cat, VEH.body, VEH.fuel, VEH.avg, VEH.pax, VEH.lpgConv, VEH.soc, VEH.fills?.length, unitPrice().v, elecPrice(), FSET.style, FSET.weather]);
// Çıktı: { qty, unit, per100, price, fuelCost, toll, total, lo, hi, perPerson, shares, climbQty, exact, elec?, notes }
function routeCost(r) {
  if (!r || dir.mode !== 'car') return null;
  const wx = routeWeather(r);
  const sig = vehSig() + '|' + (r.profile ? 'p' : '-') + '|' + (r.traffic?.delay || 0) + '|' + (wx ? 'w' : '-');
  const c = COST_CACHE.get(r); if (c && c.sig === sig) return c;
  const P = vehPhys(), pers = personal(), m = P.m0 + 75 * VEH.pax + 15, speed = speedFn(r);
  const ferry = (r.steps || []).filter(s => s.mode === 'ferry').map(s => [s.at, s.at + s.distance]);
  const onFerry = x => ferry.some(([a, b]) => x >= a && x <= b);
  const evP = P.evPart;
  let E = 0, Eflat = 0, idle = 0, km = 0, Tsum = 0, Tn = 0, wSum = 0, segs = [];
  const parts = { roll: 0, aero: 0, accel: 0, grade: 0 };
  const add = (x, dx, dh, el, brg) => {
    const w = wxAt(wx, x), env = envFor(w?.T, P.ev), sp = speed(x), vw = w ? headwind(w, brg) : 0;
    const s = segParts(P, m, sp.v, dx, dh, el, env, vw), f = segParts(P, m, sp.v, dx, 0, el, env, vw), rs = residScale(P, sp.v * 3.6);
    E += s.e * rs; Eflat += f.e * rs; idle += s.idleE * rs; km += dx / 1000; Tsum += env.T * dx; Tn += dx; wSum += vw * dx;
    parts.roll += s.roll; parts.aero += Math.max(0, s.aero); parts.grade += Math.max(0, s.gr); parts.accel += s.ke;
    if (evP) segs.push({ e: s.e * rs, ev: segParts(evP, m, sp.v, dx, dh, el, envFor(w?.T, true), vw).e * residScale(evP, sp.v * 3.6) });
  };
  const pr = r.profile;
  if (pr && pr.dists?.length > 1) {
    const el = smoothElev(pr.elevs, pr.step);
    for (let i = 1; i < pr.dists.length; i++) {
      const dx = pr.dists[i] - pr.dists[i - 1], mid = pr.dists[i] - dx / 2; if (dx <= 0 || onFerry(mid)) continue;
      add(mid, dx, el[i] - el[i - 1], el[i], pr.pts ? bearingRad(pr.pts[i - 1], pr.pts[i]) : 0);
    }
  } else {
    // Profil henüz yoksa: düz yol varsayımıyla adım adım
    for (const s of r.steps || []) { if (s.mode !== 'ferry' && s.distance > 0) add(s.at + s.distance / 2, s.distance, 0, 0, 0); }
  }
  const Tavg = Tn ? Tsum / Tn : null;
  // Trafik gecikmesi: dur-kalk ve rölanti (hibrit/elektrikte yalnızca yardımcı sistemler)
  const delay = r.provider === 'tomtom' ? 0 : r.traffic?.delay || 0, envAvg = envFor(wx ? Tavg : null, P.ev);
  const jamW = (fuelPower(P, 0, 0, envAvg) + Math.max(0, fuelPower(P, 2500, 4, envAvg))) / 2, jam = jamW * delay;
  const rj = residScale(P, 15); E += jam * rj; Eflat += jam * rj; idle += jam * rj;
  if (evP) segs.push({ e: jam, ev: (fuelPower(evP, 0, 0, envFor(Tavg, true)) + fuelPower(evP, 2500, 4, envFor(Tavg, true))) / 2 * delay });
  // Soğuk çalıştırma: sıcaklık düştükçe artar
  const cold = P.coldJ * (1 + 0.05 * Math.max(0, 23 - (wx ? Tavg : 15)));
  E += cold; Eflat += cold;
  const conv = P.resid * pers.f / P.unitJ * (P.lpg ? LPG_CONV : 1);
  let qty = E * conv, flatQty = Eflat * conv, elec = null;
  const p = unitPrice();
  if (evP) {
    // Şarj edilebilir hibrit: önce batarya (başlangıç şarjı kadar), sonra benzin/dizel
    let avail = P.batKWh * clamp(VEH.soc, 0, 100) / 100 * 3.6e6, eUsed = 0, fUsed = 0;
    for (const s of segs) {
      const need = s.ev * evP.resid * pers.f;
      if (avail > 0 && need > 0) { const take = Math.min(avail, need), frac = take / need; avail -= take; eUsed += take; fUsed += s.e * (1 - frac); }
      else if (need <= 0 && eUsed > 0) { avail -= need; eUsed += need; }
      else fUsed += s.e;
    }
    fUsed += cold * (fUsed > 0 ? 1 : 0);
    qty = fUsed * conv; flatQty = Math.min(flatQty, qty);
    elec = { kwh: Math.max(0, eUsed) / 3.6e6, price: elecPrice() };
    elec.cost = elec.kwh * elec.price;
  }
  const toll = r.tolls?.total || 0, fuelCost = qty * (p.v || 0) + (elec?.cost || 0);
  const u = uncertainty(VEH, !!wx);
  const posTot = parts.roll + parts.aero + parts.grade + parts.accel;
  const idleShare = clamp(idle / Math.max(1, E), 0, 0.6);
  const sh = k => (1 - idleShare) * parts[k] / (posTot || 1);
  const out = {
    sig, qty, unit: FUELS[vehFuel()].unit, per100: km ? qty / km * 100 : 0, price: p.v, priceSrc: p.src, fuelCost, toll, total: fuelCost + toll,
    lo: (fuelCost) * (1 - u) + toll, hi: fuelCost * (1 + u) + toll, unc: u, elec,
    perPerson: VEH.pax > 1 ? (fuelCost + toll) / VEH.pax : null, climbQty: Math.max(0, qty - flatQty), exact: !!pr,
    shares: { aero: sh('aero'), roll: sh('roll'), grade: sh('grade'), accel: sh('accel'), idle: idleShare },
    T: wx ? Tavg : null, wind: wx && Tn ? wSum / Tn : null, km, coldQty: cold * conv
  };
  COST_CACHE.set(r, out);
  return out;
}

/* ----- Biçimlendirme ----- */
const nf2 = new Intl.NumberFormat('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
const fmtQty = (q, u) => (q < 10 ? nf1 : nf0).format(q) + ' ' + u;
const hp = kw => Math.round(kw * 1.36);
// Katalog aracının kısa adı ve motor etiketi
function catEngine(c) {
  if (!c) return '';
  const fuel = c.p === 'bev' ? 'Elektrik' : FUELS[c.f]?.label || '';
  const parts = [];
  if (c.cc && c.p !== 'bev') {
    // Satış adındaki hacim: 1248 cm³ → 1,3; 1242 → 1,2; 1498 → 1,5 (üst onluğa çok yakınsa yukarı)
    const x = c.cc / 1000, up = Math.ceil(x * 10) / 10, l = up - x < 0.055 ? up : Math.round(x * 10) / 10;
    parts.push(l.toFixed(1).replace('.', ','));
  }
  parts.push(c.p === 'ice' || c.p === 'bev' ? fuel : `${fuel} ${PT_LABEL[c.p].toLowerCase()}`);
  if (c.kw) parts.push(hp(c.kw) + ' HP');
  return parts.join(' ');
}
const vehSpec = (v = VEH) => {
  const u = FUELS[vehFuel(v)].unit;
  if (v.cat) return `${v.cat.mk} ${v.cat.md} ${v.cat.y} · ${catEngine(v.cat)}${v.lpgConv ? ' · LPG' : ''} · ≈${nf1.format(vehAvg(v))} ${u}/100`;
  return `${BODIES[v.body].label} · ${FUELS[v.fuel].label} · ${nf1.format(vehAvg(v))} ${u}/100 km`;
};
const vehSummary = () => `${VEH.name} · ${VEH.cat ? catEngine(VEH.cat) : FUELS[VEH.fuel].label}${VEH.pax > 1 ? ` · ${VEH.pax} kişi` : ''}`;
const SHARE_INFO = [['aero', 'Hava direnci', '#4285f4'], ['roll', 'Yuvarlanma', '#34a853'], ['grade', 'Yokuşlar', '#ea4335'], ['accel', 'Hızlanma', '#fbbc04'], ['idle', 'Rölanti ve sistemler', '#9aa0a6']];

// Seçili rotanın maliyet kartı: yakıt, geçiş, toplam, aralık ve yakıtın nereye gittiği
function costSectionHtml(r) {
  const c = routeCost(r); if (!c) return '';
  const bar = SHARE_INFO.map(([k, , col]) => c.shares[k] > 0.005 ? `<i style="width:${(c.shares[k] * 100).toFixed(1)}%;background:${col}"></i>` : '').join('');
  const leg = SHARE_INFO.filter(([k]) => c.shares[k] >= 0.02).map(([k, l, col]) => `<span><i style="background:${col}"></i>${l} %${nf0.format(Math.round(c.shares[k] * 100))}</span>`).join('');
  const f = vehFuel(), ev = f === 'elektrik';
  const cond = [];
  if (c.T != null) cond.push(`${nf0.format(Math.round(c.T))} °C`);
  if (c.wind != null && Math.abs(c.wind) >= 1) cond.push(c.wind > 0 ? `karşı rüzgâr ${nf0.format(Math.round(c.wind * 3.6))} km/sa` : `arka rüzgâr ${nf0.format(Math.round(-c.wind * 3.6))} km/sa`);
  if (FSET.style !== 'normal') cond.push(`${DRIVE_STYLES[FSET.style].label.toLowerCase()} sürüş`);
  const pers = personal();
  return `<section class="cost-sec">
    <div class="cost-h"><b>Yolculuk maliyeti</b><span class="cost-total">${fmtTL(c.total)}<small class="cost-range">${fmtTL(c.lo)} – ${fmtTL(c.hi)}</small></span></div>
    <div class="cost-rows">
      ${c.qty > 0.005 || !c.elec ? `<div class="cost-row"><span class="ms">${ev ? 'ev_station' : 'local_gas_station'}</span><span class="cr-m"><b>${FUELS[f].label} · ${fmtQty(c.qty, c.unit)}</b><small>${nf1.format(c.per100)} ${c.unit}/100 km · ${nf1.format(c.price)} ₺/${c.unit}</small></span><span class="cr-p">${fmtTL(c.qty * c.price)}</span></div>` : ''}
      ${c.elec ? `<div class="cost-row"><span class="ms">bolt</span><span class="cr-m"><b>Batarya · ${fmtQty(c.elec.kwh, 'kWh')}</b><small>Başlangıç şarjı %${nf0.format(VEH.soc)} · ${nf1.format(c.elec.price)} ₺/kWh</small></span><span class="cr-p">${fmtTL(c.elec.cost)}</span></div>` : ''}
      <div class="cost-row"><span class="ms">toll</span><span class="cr-m"><b>Geçiş ücretleri</b><small>${r.tolls?.items.length ? r.tolls.items.length + ' ücretli geçiş' : 'Ücretli geçiş yok'}</small></span><span class="cr-p">${fmtTL(c.toll)}</span></div>
      ${c.perPerson ? `<div class="cost-row pp"><span class="ms">group</span><span class="cr-m"><b>Kişi başı</b><small>${VEH.pax} kişi</small></span><span class="cr-p">${fmtTL(c.perPerson)}</span></div>` : ''}
    </div>
    ${c.exact ? `<div class="cost-mix"><div class="cm-h">Yakıt nereye gidiyor${c.climbQty >= 0.1 ? `<small>Düz yola göre +${fmtQty(c.climbQty, c.unit)}</small>` : ''}</div><div class="cm-bar">${bar}</div><div class="cm-leg">${leg}</div></div>` : '<div class="cost-wait"><span class="spinner sm"></span>Eğime göre hesaplanıyor…</div>'}
    <p class="toll-fine">${esc(VEH.cat ? `${VEH.cat.mk} ${VEH.cat.md} ${VEH.cat.y}, ${catEngine(VEH.cat)}` : VEH.name)}${cond.length ? ' · ' + cond.join(' · ') : ''}. Aralık ±%${nf0.format(Math.round(c.unc * 100))}${pers.n ? `, ${pers.n} yakıt alımından öğrenildi` : VEH.cat ? '; yakıt alımlarınızı girdikçe daralır' : ''}. ${esc(c.priceSrc)}.</p>
  </section>`;
}

/* ================= Navigasyonda anlık tüketim =================
   Her GPS güncellemesinde hız ve hızlanma ölçülür, eğim rotanın yükseklik profilinden alınır; aynı araç modeli
   (kalibrasyon, sıcaklık, klima, rüzgâr) anlık güce uygulanır. Toplam maliyet = harcanan yakıt + geçilen gişeler. */
const LIVE = { on: false };
function liveFuelStart() {
  if (dir.mode !== 'car') { LIVE.on = false; return; }
  const r = dir.routes[dir.sel], wx = r && routeWeather(r);
  Object.assign(LIVE, { on: true, t: 0, along: null, v: null, qty: 0, kwh: 0, soc: VEH.soc, dist: 0, rate: 0, startAt: Date.now(), maxV: 0, fastSec: 0, cutSec: 0, sec: 0, tolls: new Map(), wx, cold: false, pred: r ? routeCost(r) : null });
  document.body.classList.add('fuel-on');
}
function liveFuelTick(r, along) {
  if (!LIVE.on) return;
  const now = performance.now() / 1000, dt = LIVE.t ? now - LIVE.t : 0;
  if (LIVE.t && (dt <= 0.2)) return;
  const prevAlong = LIVE.along; LIVE.t = now; LIVE.along = along;
  if (!dt || dt > 15 || prevAlong == null || along < prevAlong - 80) return;
  const P = vehPhys(), pers = personal(), m = P.m0 + 75 * VEH.pax + 15;
  const vRaw = Number.isFinite(meSpeed) && meSpeed >= 0 ? meSpeed : Math.max(0, (along - prevAlong) / dt);
  const vPrev = LIVE.v ?? vRaw, v = vPrev + (vRaw - vPrev) * Math.min(1, dt / 3);
  const a = Math.max(-3, Math.min(3, (v - vPrev) / dt)); LIVE.v = v;
  let grade = 0, elev = 0, brg = 0;
  if (r.profile) {
    const a0 = Math.max(0, along - 150), a1 = Math.min(r.total, along + 150), p0 = profileAt(r.profile, a0), p1 = profileAt(r.profile, a1);
    grade = a1 > a0 + 50 ? (p1.elev - p0.elev) / (a1 - a0) : 0; elev = (p0.elev + p1.elev) / 2;
    if (p0.pt && p1.pt) brg = bearingRad(p0.pt, p1.pt);
  }
  const w = wxAt(LIVE.wx, along), env = envFor(w?.T, P.ev), vw = w ? headwind(w, brg) : 0;
  const Pw = wheelPower(P, m, v, a, Math.max(-0.08, Math.min(0.08, grade)), airRho(elev, env.T), vw);
  const kmh = v * 3.6;
  // Soğuk çalıştırma ilk km'lerde yayılır
  if (!LIVE.cold && P.coldJ) { LIVE.cold = true; LIVE.qty += P.coldJ * (1 + 0.05 * Math.max(0, 23 - env.T)) * P.resid * pers.f / P.unitJ * (P.lpg ? LPG_CONV : 1); }
  let rate; // birim/sn (yakıt litresi ya da kWh)
  const fConv = P.resid * pers.f / P.unitJ * (P.lpg ? LPG_CONV : 1);
  if (P.evPart && LIVE.soc > 0.5) {
    const pe = fuelPower(P.evPart, Pw, v < 0.5 ? 0 : v, envFor(w?.T, true)) * P.evPart.resid * pers.f; // W şebeke
    const kwh = pe * dt / 3.6e6; LIVE.kwh += kwh; LIVE.soc = Math.max(0, LIVE.soc - kwh / P.batKWh * 100);
    rate = 0;
  } else rate = fuelPower(P, Pw, v < 0.5 ? 0 : v, env) * fConv * residScale(P, Math.max(15, kmh));
  LIVE.rate = LIVE.rate + (rate - LIVE.rate) * Math.min(1, dt / 5);
  LIVE.qty += rate * dt; LIVE.dist += v * dt; LIVE.sec += dt; LIVE.maxV = Math.max(LIVE.maxV, kmh);
  if (kmh >= 125) LIVE.fastSec += dt; if (Pw <= 0 && kmh > 15) LIVE.cutSec += dt;
  for (const it of r.tolls?.items || []) if (it.price > 0 && along >= it.at && along - it.at < 3000 && !LIVE.tolls.has(it.name)) LIVE.tolls.set(it.name, it.price);
  renderLiveFuel(r, along, kmh);
}
function liveHint(r, along, kmh) {
  if (kmh < 118) return '';
  let fastM = 0;
  for (const s of r.steps || []) { const end = s.at + s.distance; if (end <= along || s.duration <= 0) continue; if (s.distance / s.duration * 3.6 >= 85) fastM += end - Math.max(s.at, along); }
  if (fastM < 5000) return '';
  const P = vehPhys(), m = P.m0 + 75 * VEH.pax + 15, env = envFor(LIVE.wx ? wxAt(LIVE.wx, along)?.T : null, P.ev), alt = 110;
  const conv = P.resid * personal().f / P.unitJ * (P.lpg ? LPG_CONV : 1);
  const per = x => segParts(P, m, x / 3.6, 1000, 0, 0, env).e * residScale(P, x) * conv / 1000; // birim/m
  const extra = (per(kmh) - per(alt)) * fastM * unitPrice().v, late = fastM / (alt / 3.6) - fastM / (kmh / 3.6);
  if (extra < 15) return '';
  return `Bu hızla kalan ${fmtDist(fastM)} hızlı yolda <b>+${fmtTL(extra)}</b> · ${alt} km/sa ile ~${fmtDur(late)} geç varırsınız`;
}
let liveDomAt = 0;
function renderLiveFuel(r, along, kmh) {
  const el = $('nav-fuel'); if (!el) return;
  const t = performance.now(); if (t - liveDomAt < 900) return; liveDomAt = t;
  const f = vehFuel(), u = FUELS[f].unit, price = unitPrice().v, v = LIVE.v || 0, onBatt = isPhev() && LIVE.soc > 0.5;
  let now, unitTxt, col;
  const stopped = v < 2;
  if (stopped) { now = Math.max(0, LIVE.rate * 3600); unitTxt = `${u}/sa`; col = '#9aa0a6'; }
  else { now = LIVE.rate / v * 1e5; unitTxt = `${u}/100`; const ref = vehAvg(); col = now <= ref * 1.05 ? '#188038' : now <= ref * 1.5 ? '#e37400' : '#d93025'; }
  const used = Math.max(0, LIVE.qty), spent = used * price + LIVE.kwh * elecPrice(), tolls = liveTolls();
  const hint = liveHint(r, along, kmh);
  const coasting = !stopped && LIVE.rate <= 0 && !onBatt;
  const nowTxt = onBatt ? 'Elektrikle' : stopped ? 'Duruyor' : coasting ? (f === 'elektrik' ? 'Şarj ediyor' : 'Yakıt kesik') : `${(now < 10 ? nf1 : nf0).format(now)}`;
  const nowSub = onBatt ? `batarya %${nf0.format(LIVE.soc)}` : stopped ? (f === 'elektrik' ? '' : `rölanti ${nf1.format(now)} ${unitTxt}`) : coasting ? '' : unitTxt;
  el.hidden = false;
  el.innerHTML = `<div class="nf-main">
      <span class="nf-now ${stopped || coasting || onBatt ? 'txt' : ''}"><i style="background:${onBatt ? '#188038' : col}"></i><b>${nowTxt}</b>${nowSub ? `<small>${nowSub}</small>` : ''}</span>
      <span class="nf-k"><small>${isPhev() ? 'Yakıt/şarj' : 'Yakıt'}</small><b>${(used < 1 ? nf2 : used < 10 ? nf1 : nf0).format(used)} ${u}${LIVE.kwh > 0.05 ? ` + ${nf1.format(LIVE.kwh)} kWh` : ''}</b></span>
      <span class="nf-k"><small>Yakıt ücreti</small><b>${fmtTL(spent)}</b></span>
      <span class="nf-k tot" title="Yakıt ücreti + geçilen köprü/otoyol ücretleri"><small>Toplam</small><b>${fmtTL(spent + tolls)}</b></span>
    </div>${hint ? `<div class="nf-hint">${hint}</div>` : ''}`;
}
const liveTolls = () => [...(LIVE.tolls?.values() || [])].reduce((a, b) => a + b, 0);
function liveFuelStop() {
  const el = $('nav-fuel'); if (el) { el.hidden = true; el.innerHTML = ''; }
  document.body.classList.remove('fuel-on');
  if (!LIVE.on) return; LIVE.on = false;
  if (LIVE.dist < 1000) return;
  const f = vehFuel(), u = FUELS[f].unit, price = unitPrice().v, km = LIVE.dist / 1000, q = Math.max(0, LIVE.qty);
  const per = q / km * 100, mins = LIVE.sec / 60, fuelCost = q * price + LIVE.kwh * elecPrice();
  saveTrip({ t: Date.now(), to: dir.to?.name || '', dist: LIVE.dist, sec: LIVE.sec, qty: q, kwh: LIVE.kwh || 0, unit: u, fuel: f, fuelCost, tolls: liveTolls(), total: fuelCost + liveTolls(), veh: VEH.name, vid: VEH.id });
  if (isPhev()) { VEH.soc = Math.round(LIVE.soc); saveVeh(); }
  const box = $('nav-sum'); if (!box) return;
  const ref = vehAvg();
  box.innerHTML = `<div class="ns-h"><span class="ms">local_gas_station</span><b>Yolculuk özeti</b><button class="icon-btn" id="ns-close" aria-label="Kapat"><span class="ms">close</span></button></div>
    <div class="ns-grid">
      <span><small>Mesafe</small><b>${fmtDist(LIVE.dist)}</b></span>
      <span><small>Süre</small><b>${fmtDur(LIVE.sec)}</b></span>
      <span><small>${FUELS[f].label}</small><b>${fmtQty(q, u)}${LIVE.kwh > 0.05 ? ` + ${nf1.format(LIVE.kwh)} kWh` : ''}</b></span>
      <span><small>Yakıt ücreti</small><b>${fmtTL(fuelCost)}</b></span>
      <span><small>Geçiş ücretleri</small><b>${fmtTL(liveTolls())}</b></span>
      <span><small>Toplam maliyet</small><b>${fmtTL(fuelCost + liveTolls())}</b></span>
    </div>
    <p class="ns-note">Ortalama ${nf1.format(per)} ${u}/100 km, ${nf0.format(km / Math.max(1 / 60, mins / 60))} km/sa. ${per <= ref ? 'Aracınızın tipik tüketiminin altında, ekonomik bir sürüş.' : `Tipik tüketimden %${nf0.format(Math.round((per / ref - 1) * 100))} fazla.`}${LIVE.fastSec > 60 ? ` ${fmtDur(LIVE.fastSec)} boyunca 125 km/sa üstünde gidildi.` : ''}${LIVE.cutSec > 60 ? ` ${fmtDur(LIVE.cutSec)} motor freniyle (yakıtsız) ilerlendi.` : ''} Değerler GPS, arazi ve hava verisinden tahmindir; yakıt alımlarınızı <b>Araçlarım</b>'a girerseniz hesaplar size göre düzelir.</p>`;
  box.hidden = false;
  $('ns-close').onclick = () => { box.hidden = true; };
  clearTimeout(liveFuelStop._t); liveFuelStop._t = setTimeout(() => { box.hidden = true; }, 30000);
}

/* ================= Yolculuk geçmişi ================= */
const trips = () => store.get('trips', []);
function saveTrip(t) { const all = trips(); all.unshift(t); store.set('trips', all.slice(0, 200)); }
const tripTotal = t => t.total ?? ((t.fuelCost || 0) + (t.tolls || 0));
function openTrips() {
  const render = el => {
    const all = trips(), now = new Date(), m0 = new Date(now.getFullYear(), now.getMonth(), 1).getTime();
    const month = all.filter(t => t.t >= m0), sum = k => month.reduce((s, t) => s + (t[k] || 0), 0);
    const fuelL = month.filter(t => t.unit !== 'kWh').reduce((s, t) => s + t.qty, 0);
    el.innerHTML = `<div class="list-head drag-zone"><h2>Yolculuk geçmişi</h2><small>Navigasyonla yapılan yolculuklar · bu cihazda saklanır</small></div>
      ${all.length ? `<div class="tr-sum"><div class="ts-h">${now.toLocaleDateString('tr-TR', { month: 'long', year: 'numeric' })}</div>
        <div class="ts-g"><span><small>Yolculuk</small><b>${month.length}</b></span><span><small>Mesafe</small><b>${fmtDist(sum('dist'))}</b></span><span><small>Yakıt</small><b>${nf1.format(fuelL)} L</b></span><span><small>Toplam</small><b>${fmtTL(month.reduce((s, t) => s + tripTotal(t), 0))}</b></span></div></div>
        <div class="tr-list">${all.map(t => `<div class="tr-it"><span class="ms">${t.fuel === 'elektrik' ? 'ev_station' : 'local_gas_station'}</span>
          <div class="tr-m"><b>${t.to ? esc(t.to) : 'Yolculuk'}</b><small>${new Date(t.t).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short' })} ${fmtClock(new Date(t.t))} · ${fmtDist(t.dist)} · ${fmtDur(t.sec)}</small>
          <small>${esc(t.veh || '')} · ${fmtQty(t.qty, t.unit)}${t.kwh > 0.05 ? ` + ${nf1.format(t.kwh)} kWh` : ''} · ${nf1.format(t.qty / Math.max(0.1, t.dist / 1000) * 100)} ${t.unit}/100${t.tolls ? ` · geçiş ${fmtTL(t.tolls)}` : ''}</small></div>
          <span class="tr-p">${fmtTL(tripTotal(t))}</span></div>`).join('')}</div>
        <div class="gv-add"><button class="btn outline" id="tr-clear"><span class="ms">delete</span>Geçmişi temizle</button></div>`
      : '<div class="empty">Henüz yolculuk yok.<br><small>Bir rotada <b>Başlat</b>\'a dokunun; navigasyon bitince yakıt ve maliyet burada listelenir.</small></div>'}`;
    $('tr-clear')?.addEventListener('click', () => { if (confirm('Tüm yolculuk geçmişi silinsin mi?')) { store.set('trips', []); render(el); } });
  };
  render.mode = 'list';
  openPanel(render, { mode: 'list', sheet: 'full' });
}

/* ================= Akaryakıt fiyatları ================= */
const per100Cost = (v = VEH) => vehAvg(v) * (unitPrice(v).v || 0);
function openPrices() {
  const render = el => {
    const f = vehFuel();
    const rows = [['benzin', 'Benzin (95 oktan)', 'local_gas_station', FUEL_PRICES.benzin, 'L'], ['dizel', 'Motorin', 'local_gas_station', FUEL_PRICES.dizel, 'L'], ['lpg', 'Otogaz (LPG)', 'local_gas_station', FUEL_PRICES.lpg, 'L'], ['elektrik', 'Elektrik · DC hızlı şarj', 'ev_station', EV_PRICE_DEFAULT, 'kWh']];
    el.innerHTML = `<div class="list-head drag-zone"><h2>Akaryakıt fiyatları</h2><small>EPDK günlük bülteni · Türkiye ortalaması · ${esc(priceDate())}</small></div>
      <div class="pr-list">${rows.map(([k, l, ic, v, u]) => `<div class="pr-it ${k === f ? 'on' : ''}"><span class="ms">${ic}</span><span class="pr-m"><b>${l}</b>${k === 'elektrik' ? '<small>Operatör ortalaması, istasyona göre değişir</small>' : ''}${k === f ? `<small>${esc(VEH.name)} bu yakıtı kullanıyor${VEH.price ? ` · kendi fiyatınız ${nf1.format(VEH.price)} ₺` : ''}</small>` : ''}</span><span class="pr-p">${v ? nf1.format(v) + ' ₺' : '—'}<small>/${u}</small></span></div>`).join('')}</div>
      <div class="pr-card"><span class="ms">${BODIES[VEH.body].icon}</span><div><b>${esc(VEH.name)} ile 100 km ≈ ${fmtTL(per100Cost())}</b><small>${esc(vehSpec())} · ${esc(unitPrice().src)}</small></div></div>
      <div class="gv-add"><button class="btn outline" id="pr-edit"><span class="ms">edit</span>Aracım için fiyatı değiştir</button></div>
      <p class="mini-note">Pompa fiyatı il ve istasyona göre birkaç lira farklı olabilir. Fiyatlar her gün EPDK'nın açık bülten servisinden alınır.</p>`;
    $('pr-edit').onclick = () => editVehicle(VEH);
  };
  render.mode = 'list';
  openPanel(render, { mode: 'list', sheet: 'full' });
}
