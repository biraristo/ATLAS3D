/* ================= Yakıt / enerji maliyeti =================
   Araç profili (gövde tipi, yakıt, ortalama tüketim, yolcu) telefonda saklanır.
   Tüketim fizik tabanlı modelle hesaplanır: rota ~30 m'lik parçalara bölünür ve her parçada
   yuvarlanma direnci, hava direnci (hızın karesi, rakıma göre hava yoğunluğu), eğim (yükseklik profili),
   dur-kalk hızlanması ve motorun boşta/yardımcı sistem tüketimi toplanır. İnişte benzinli/dizel araç
   yakıt keser (negatif tüketim yok), elektrikli araç enerjinin bir kısmını geri kazanır.
   Kalibrasyon: model, aynı aracın düz ve karma bir referans sürüşteki enerjisine bölünür ve kullanıcının
   ortalama tüketimiyle çarpılır. Böylece kullanıcıdan tek bir sayı istenir, sonuç rotanın eğimine ve hızına göre değişir.
   Fiyatlar: EPDK günlük bayi satış fiyatı bülteni (/api/fuel), elektrikte düzenlenebilir DC şarj ortalaması. */
'use strict';

const BODIES = {
  hatchback: { label: 'Hatchback', icon: 'directions_car', m: 1250, cda: 0.62, crr: 0.010, avg: { benzin: 6.5, dizel: 5.3, lpg: 8.3, elektrik: 16 } },
  sedan: { label: 'Sedan', icon: 'directions_car', m: 1450, cda: 0.66, crr: 0.010, avg: { benzin: 7.0, dizel: 5.7, lpg: 8.9, elektrik: 17 } },
  suv: { label: 'SUV', icon: 'directions_car', m: 1750, cda: 0.85, crr: 0.011, avg: { benzin: 8.3, dizel: 6.6, lpg: 10.5, elektrik: 20 } },
  ticari: { label: 'Hafif ticari', icon: 'local_shipping', m: 1650, cda: 0.95, crr: 0.011, avg: { benzin: 8.0, dizel: 6.4, lpg: 10.2, elektrik: 22 } },
  motor: { label: 'Motosiklet', icon: 'two_wheeler', m: 260, cda: 0.55, crr: 0.015, avg: { benzin: 4.2, elektrik: 6 } }
};
const FUELS = {
  benzin: { label: 'Benzin', unit: 'L', idleKw: 5.0, etaLo: 0.20, etaHi: 0.27 },
  dizel: { label: 'Dizel', unit: 'L', idleKw: 4.0, etaLo: 0.24, etaHi: 0.32 },
  lpg: { label: 'LPG', unit: 'L', idleKw: 5.0, etaLo: 0.20, etaHi: 0.27 },
  elektrik: { label: 'Elektrik', unit: 'kWh', idleKw: 0.6, etaLo: 0.85, etaHi: 0.85, regen: 0.6 }
};
const EV_PRICE_DEFAULT = 14.4; // DC hızlı şarj, Ekim 2026 operatör ortalaması (₺/kWh); kullanıcı değiştirebilir
const FUEL_FALLBACK = { benzin: 76.31, dizel: 96.82, lpg: 42.36, date: '2026-10-30', source: 'EPDK bülteni (son bilinen)' };

const VEH = Object.assign({ body: 'sedan', fuel: 'benzin', avg: null, pax: 1, price: null }, store.get('vehicle', {}));
if (!BODIES[VEH.body]) VEH.body = 'sedan';
if (!FUELS[VEH.fuel] || !(VEH.fuel in BODIES[VEH.body].avg)) VEH.fuel = 'benzin';
const saveVeh = () => store.set('vehicle', VEH);
const vehAvg = () => VEH.avg || BODIES[VEH.body].avg[VEH.fuel];

let FUEL_PRICES = store.get('fuelPrices', null) || FUEL_FALLBACK;
const fuelPricesReady = fetch('/api/fuel').then(r => (r.ok ? r.json() : null)).then(d => {
  if (d && (d.benzin || d.dizel || d.lpg)) { FUEL_PRICES = { ...FUEL_FALLBACK, ...Object.fromEntries(Object.entries(d).filter(([, v]) => v != null)), source: 'EPDK' }; store.set('fuelPrices', FUEL_PRICES); }
}).catch(() => {}).finally(() => { if (typeof refreshDirResults === 'function' && dir.routes.length) { clearCostCache(); refreshDirResults(); } });
function unitPrice() {
  if (VEH.price) return { v: VEH.price, src: 'Kendi girdiğiniz fiyat' };
  if (VEH.fuel === 'elektrik') return { v: EV_PRICE_DEFAULT, src: 'DC hızlı şarj ortalaması' };
  const d = FUEL_PRICES.date ? new Date(FUEL_PRICES.date + 'T12:00:00').toLocaleDateString('tr-TR', { day: 'numeric', month: 'long' }) : '';
  return { v: FUEL_PRICES[VEH.fuel], src: `EPDK bülteni${d ? ', ' + d : ''} · Türkiye ortalaması` };
}

/* ----- Fizik modeli ----- */
const G = 9.81;
const STOPS = [[10, 6], [25, 3.5], [40, 2], [55, 1.1], [75, 0.4], [95, 0.12], [120, 0.04]]; // ortalama hız (km/sa) → km başına duruş
const lerpTab = (t, x) => { if (x <= t[0][0]) return t[0][1]; for (let i = 1; i < t.length; i++) if (x <= t[i][0]) { const [a, va] = t[i - 1], [b, vb] = t[i]; return va + (vb - va) * (x - a) / (b - a); } return t[t.length - 1][1]; };
function segEnergy(body, fuel, v, dx, dh, elev) {
  // Tekerleğe gereken iş (J) bileşenleri
  const rho = 1.225 * Math.exp(-(elev || 0) / 8500);
  const roll = body.m * G * body.crr * dx;
  const aero = 0.5 * rho * body.cda * v * v * dx;
  // Dur-kalk: ortalama hız düştükçe km başına duruş artar; her duruşta araç seyir hızından durup yeniden hızlanır
  const kmh = v * 3.6, stopsPerKm = lerpTab(STOPS, kmh), vPeak = Math.min(75, kmh * (kmh < 60 ? 1.5 : 1.15)) / 3.6;
  let accel = 0.5 * body.m * vPeak * vPeak * stopsPerKm * dx / 1000;
  if (fuel.regen) accel *= 1 - fuel.regen * fuel.etaHi;
  const grade = body.m * G * dh;
  const wheel = roll + aero + accel + grade;
  const eta = fuel.etaLo + (fuel.etaHi - fuel.etaLo) * Math.min(1, kmh / 90);
  let e = 0, parts = { roll: 0, aero: 0, accel: 0, grade: 0 };
  if (wheel > 0) {
    e = wheel / eta;
    const pos = roll + aero + accel + Math.max(0, grade);
    parts = { roll: e * roll / pos, aero: e * aero / pos, accel: e * accel / pos, grade: e * Math.max(0, grade) / pos };
  } else if (fuel.regen) e = wheel * fuel.regen * fuel.etaHi; // geri kazanım (negatif)
  const idle = fuel.idleKw * 1000 * dx / v;
  return { e: e + idle, parts, idle };
}
// Referans sürüş: düz yolda %45 şehir içi (30 km/sa), %25 şehirlerarası (75), %30 otoyol (110). Yol bilgisayarındaki ortalama tüketim bu karışıma karşılık gelir.
// Varsayılan ortalamalar katalog (WLTP) değeri değil, gerçek kullanımda görülen tipik değerlerdir.
const REF_MIX = [[30, 0.45], [75, 0.25], [110, 0.30]];
function refPerM(body, fuel) { return REF_MIX.reduce((s, [kmh, w]) => s + w * segEnergy(body, fuel, kmh / 3.6, 1000, 0, 0).e / 1000, 0); } // J/m

// Hız: rotanın adım süre/mesafesinden; aracın yasal üst sınırıyla kırpılır
function speedFn(r) {
  const st = r.steps || [], ats = st.map(s => s.at), vmax = (VEH.body === 'ticari' ? 110 : 120) / 3.6;
  return x => {
    let lo = 0, hi = ats.length - 1;
    while (lo < hi) { const m = (lo + hi + 1) >> 1; if (ats[m] <= x) lo = m; else hi = m - 1; }
    for (const j of [lo, lo - 1, lo + 1]) { const s = st[j]; if (s && s.duration > 0 && s.distance > 40) return Math.max(3, Math.min(vmax, s.distance / s.duration)); }
    return 50 / 3.6;
  };
}
function smoothElev(e, step, W = 600) {
  const k = Math.max(1, Math.round(W / 2 / step)), pre = [0];
  for (const v of e) pre.push(pre[pre.length - 1] + v);
  return e.map((_, i) => { const a = Math.max(0, i - k), b = Math.min(e.length, i + k + 1); return (pre[b] - pre[a]) / (b - a); });
}

const COST_CACHE = new WeakMap();
const clearCostCache = () => { for (const r of dir.routes) COST_CACHE.delete(r); };
const vehSig = () => [VEH.body, VEH.fuel, vehAvg(), VEH.pax, unitPrice().v].join('|');
// Rota maliyeti: { qty, unit, per100, price, fuelCost, toll, total, perPerson, shares, climbQty, exact }
function routeCost(r) {
  if (!r || dir.mode !== 'car') return null;
  const sig = vehSig() + '|' + (r.profile ? 'p' : '-') + '|' + (r.traffic?.delay || 0);
  const c = COST_CACHE.get(r); if (c && c.sig === sig) return c;
  const body = BODIES[VEH.body], fuel = FUELS[VEH.fuel], avg = vehAvg(), speed = speedFn(r);
  const ferry = (r.steps || []).filter(s => s.mode === 'ferry').map(s => [s.at, s.at + s.distance]);
  const onFerry = x => ferry.some(([a, b]) => x >= a && x <= b);
  let E = 0, Eflat = 0, idle = 0, km = 0; const parts = { roll: 0, aero: 0, accel: 0, grade: 0 };
  const pr = r.profile;
  if (pr && pr.dists?.length > 1) {
    const el = smoothElev(pr.elevs, pr.step);
    for (let i = 1; i < pr.dists.length; i++) {
      const dx = pr.dists[i] - pr.dists[i - 1], mid = pr.dists[i] - dx / 2; if (dx <= 0 || onFerry(mid)) continue;
      const v = speed(mid), s = segEnergy(body, fuel, v, dx, el[i] - el[i - 1], el[i]), f = segEnergy(body, fuel, v, dx, 0, el[i]);
      E += s.e; Eflat += f.e; idle += s.idle; km += dx / 1000;
      for (const k in parts) parts[k] += s.parts[k];
    }
  } else {
    // Profil henüz yoksa: düz yol varsayımıyla adım adım
    for (const s of r.steps || []) { if (s.mode === 'ferry' || s.distance <= 0) continue; const v = speed(s.at + 1), q = segEnergy(body, fuel, v, s.distance, 0, 0); E += q.e; Eflat += q.e; idle += q.idle; km += s.distance / 1000; for (const k in parts) parts[k] += q.parts[k]; }
  }
  // Trafik gecikmesi: dur-kalk ve rölanti
  const delay = r.traffic?.delay || 0, jam = fuel.idleKw * 1000 * delay * 1.6;
  E += jam; Eflat += jam; idle += jam;
  const k = avg / 1e5 / refPerM(body, fuel); // J → litre (ya da kWh): ortalama tüketim L/100 km = L/100.000 m
  const qty = E * k, flatQty = Eflat * k, p = unitPrice();
  const toll = r.tolls?.total || 0, fuelCost = qty * (p.v || 0);
  const tot = Object.values(parts).reduce((a, b) => a + b, 0) + idle || 1;
  const out = {
    sig, qty, unit: fuel.unit, per100: km ? qty / km * 100 : 0, price: p.v, priceSrc: p.src, fuelCost, toll, total: fuelCost + toll,
    perPerson: VEH.pax > 1 ? (fuelCost + toll) / VEH.pax : null, climbQty: Math.max(0, qty - flatQty), exact: !!pr,
    shares: { aero: parts.aero / tot, roll: parts.roll / tot, grade: parts.grade / tot, accel: parts.accel / tot, idle: idle / tot }
  };
  COST_CACHE.set(r, out);
  return out;
}

/* ----- Biçimlendirme ----- */
const fmtQty = (q, u) => (q < 10 ? nf1 : nf0).format(q) + ' ' + u;
const vehSummary = () => `${BODIES[VEH.body].label} · ${FUELS[VEH.fuel].label} · ${nf1.format(vehAvg())} ${FUELS[VEH.fuel].unit}/100 km${VEH.pax > 1 ? ` · ${VEH.pax} kişi` : ''}`;
const SHARE_INFO = [['aero', 'Hava direnci', '#4285f4'], ['roll', 'Yuvarlanma', '#34a853'], ['grade', 'Yokuşlar', '#ea4335'], ['accel', 'Hızlanma', '#fbbc04'], ['idle', 'Rölanti ve sistemler', '#9aa0a6']];

// Seçili rotanın maliyet kartı: yakıt, geçiş, toplam ve yakıtın nereye gittiği
function costSectionHtml(r) {
  const c = routeCost(r); if (!c) return '';
  const bar = SHARE_INFO.map(([k, , col]) => c.shares[k] > 0.005 ? `<i style="width:${(c.shares[k] * 100).toFixed(1)}%;background:${col}"></i>` : '').join('');
  const leg = SHARE_INFO.filter(([k]) => c.shares[k] >= 0.02).map(([k, l, col]) => `<span><i style="background:${col}"></i>${l} %${nf0.format(Math.round(c.shares[k] * 100))}</span>`).join('');
  return `<section class="cost-sec">
    <div class="cost-h"><b>Yolculuk maliyeti</b><span class="cost-total">${fmtTL(c.total)}</span></div>
    <div class="cost-rows">
      <div class="cost-row"><span class="ms">${VEH.fuel === 'elektrik' ? 'ev_station' : 'local_gas_station'}</span><span class="cr-m"><b>${FUELS[VEH.fuel].label} · ${fmtQty(c.qty, c.unit)}</b><small>${nf1.format(c.per100)} ${c.unit}/100 km · ${nf1.format(c.price)} ₺/${c.unit}</small></span><span class="cr-p">${fmtTL(c.fuelCost)}</span></div>
      <div class="cost-row"><span class="ms">toll</span><span class="cr-m"><b>Geçiş ücretleri</b><small>${r.tolls?.items.length ? r.tolls.items.length + ' ücretli geçiş' : 'Ücretli geçiş yok'}</small></span><span class="cr-p">${fmtTL(c.toll)}</span></div>
      ${c.perPerson ? `<div class="cost-row pp"><span class="ms">group</span><span class="cr-m"><b>Kişi başı</b><small>${VEH.pax} kişi</small></span><span class="cr-p">${fmtTL(c.perPerson)}</span></div>` : ''}
    </div>
    ${c.exact ? `<div class="cost-mix"><div class="cm-h">Yakıt nereye gidiyor${c.climbQty >= 0.1 ? `<small>Düz yola göre +${fmtQty(c.climbQty, c.unit)}</small>` : ''}</div><div class="cm-bar">${bar}</div><div class="cm-leg">${leg}</div></div>` : '<div class="cost-wait"><span class="spinner sm"></span>Eğime göre hesaplanıyor…</div>'}
    <p class="toll-fine">${esc(c.priceSrc)}. Tüketim; eğim, hız, hızlanma ve rölanti dikkate alınarak fiziksel modelle tahmin edilir. Sürüş tarzı, klima ve yük sonucu değiştirebilir.</p>
  </section>`;
}

/* ----- Araç ayarları ----- */
function vehChipHtml() {
  if (dir.mode !== 'car') return '';
  return `<button class="veh-chip" id="veh-chip" aria-expanded="${!!dir.vehOpen}"><span class="ms">${BODIES[VEH.body].icon}</span><span class="vc-t">${esc(vehSummary())}</span><span class="ms vc-x">${dir.vehOpen ? 'expand_less' : 'tune'}</span></button>${dir.vehOpen ? vehFormHtml() : ''}`;
}
function vehFormHtml() {
  const body = BODIES[VEH.body], fuels = Object.keys(FUELS).filter(f => f in body.avg), u = FUELS[VEH.fuel].unit, p = unitPrice();
  const seg = (name, items, cur) => `<div class="vf-seg" role="radiogroup">${items.map(([k, l]) => `<button type="button" role="radio" aria-checked="${k === cur}" class="${k === cur ? 'on' : ''}" data-${name}="${k}">${l}</button>`).join('')}</div>`;
  return `<div class="veh-form" id="veh-form">
    <label class="vf-l">Araç tipi</label>${seg('body', Object.entries(BODIES).map(([k, b]) => [k, b.label]), VEH.body)}
    <label class="vf-l">Yakıt</label>${seg('fuel', fuels.map(f => [f, FUELS[f].label]), VEH.fuel)}
    <div class="vf-grid">
      <label class="vf-f"><span>Ortalama tüketim</span><span class="vf-in"><input id="vf-avg" inputmode="decimal" placeholder="${nf1.format(body.avg[VEH.fuel])}" value="${VEH.avg ? nf1.format(VEH.avg) : ''}"><em>${u}/100 km</em></span></label>
      <label class="vf-f"><span>${VEH.fuel === 'elektrik' ? 'Şarj fiyatı' : 'Yakıt fiyatı'}</span><span class="vf-in"><input id="vf-price" inputmode="decimal" placeholder="${nf1.format(VEH.fuel === 'elektrik' ? EV_PRICE_DEFAULT : FUEL_PRICES[VEH.fuel])}" value="${VEH.price ? nf1.format(VEH.price) : ''}"><em>₺/${u}</em></span></label>
      <div class="vf-f"><span>Yolcu</span><span class="vf-step"><button type="button" id="vf-minus" aria-label="Azalt">−</button><b>${VEH.pax}</b><button type="button" id="vf-plus" aria-label="Artır">+</button></span></div>
    </div>
    <p class="vf-note">Tüketimi aracınızın yol bilgisayarından girin; boş bırakırsanız tipik değer kullanılır. Fiyat boşsa ${esc(p.src)}.</p>
  </div>`;
}
const parseNum = s => { const v = parseFloat(String(s).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(v) && v > 0 ? v : null; };
function wireVehicle(root, rerender) {
  const chip = root.querySelector('#veh-chip'); if (!chip) return;
  const apply = () => { saveVeh(); clearCostCache(); rerender(); };
  chip.onclick = () => { dir.vehOpen = !dir.vehOpen; rerender(); };
  root.querySelectorAll('[data-body]').forEach(b => { b.onclick = () => { VEH.body = b.dataset.body; if (!(VEH.fuel in BODIES[VEH.body].avg)) VEH.fuel = 'benzin'; VEH.avg = null; apply(); }; });
  root.querySelectorAll('[data-fuel]').forEach(b => { b.onclick = () => { if (VEH.fuel !== b.dataset.fuel) { VEH.fuel = b.dataset.fuel; VEH.avg = null; VEH.price = null; } apply(); }; });
  const num = (id, key, max) => { const el = root.querySelector('#' + id); if (el) el.onchange = () => { const v = parseNum(el.value); VEH[key] = v && v <= max ? v : null; apply(); }; };
  num('vf-avg', 'avg', 60); num('vf-price', 'price', 500);
  root.querySelector('#vf-minus')?.addEventListener('click', () => { VEH.pax = Math.max(1, VEH.pax - 1); apply(); });
  root.querySelector('#vf-plus')?.addEventListener('click', () => { VEH.pax = Math.min(9, VEH.pax + 1); apply(); });
}
