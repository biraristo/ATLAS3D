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
  let E = 0, Eflat = 0, idle = 0, km = 0, cumE = null; const parts = { roll: 0, aero: 0, accel: 0, grade: 0 };
  const pr = r.profile;
  if (pr && pr.dists?.length > 1) {
    const el = smoothElev(pr.elevs, pr.step);
    cumE = new Float64Array(pr.dists.length); // rota boyunca biriken planlanan enerji (navigasyonda karşılaştırma için)
    for (let i = 1; i < pr.dists.length; i++) {
      cumE[i] = E;
      const dx = pr.dists[i] - pr.dists[i - 1], mid = pr.dists[i] - dx / 2; if (dx <= 0 || onFerry(mid)) continue;
      const v = speed(mid), s = segEnergy(body, fuel, v, dx, el[i] - el[i - 1], el[i]), f = segEnergy(body, fuel, v, dx, 0, el[i]);
      E += s.e; Eflat += f.e; idle += s.idle; km += dx / 1000;
      for (const k in parts) parts[k] += s.parts[k];
      cumE[i] = E;
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
    perPerson: VEH.pax > 1 ? (fuelCost + toll) / VEH.pax : null, climbQty: Math.max(0, qty - flatQty), exact: !!pr, k,
    plan: cumE ? { dists: pr.dists, qty: Array.from(cumE, e => e * k) } : null,
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

/* ================= Navigasyonda anlık tüketim =================
   Her GPS güncellemesinde: hız (GPS ya da rota üzerindeki ilerlemeden), birkaç saniyelik ortalamayla yumuşatılır;
   hızlanma iki ölçüm arasındaki hız farkından, eğim rotanın yükseklik profilinden alınır. Tekerdeki anlık güç
   (yuvarlanma + hava + eğim + hızlanma) motor verimine bölünür, rölanti/yardımcı sistem gücü eklenir; aynı kalibrasyonla
   litreye (ya da kWh) çevrilir. Kalan maliyet, planın kalan kısmı × son birkaç kilometredeki "gerçekleşen / planlanan" oranıdır. */
const LIVE = { on: false };
function liveFuelStart() {
  if (dir.mode !== 'car') { LIVE.on = false; return; }
  Object.assign(LIVE, { on: true, t: 0, along: null, v: null, qty: 0, dist: 0, rate: 0, win: [], factor: 1, startAt: Date.now(), maxV: 0, fastSec: 0, cutSec: 0, sec: 0 });
  document.body.classList.add('fuel-on');
}
function planQtyAt(c, d) {
  const P = c?.plan; if (!P) return null;
  const D = P.dists; let lo = 0, hi = D.length - 1;
  if (d <= D[0]) return 0; if (d >= D[hi]) return P.qty[hi];
  while (hi - lo > 1) { const m = (lo + hi) >> 1; if (D[m] <= d) lo = m; else hi = m; }
  return P.qty[lo] + (P.qty[hi] - P.qty[lo]) * (d - D[lo]) / (D[hi] - D[lo] || 1);
}
function liveFuelTick(r, along) {
  if (!LIVE.on) return;
  const now = performance.now() / 1000, dt = LIVE.t ? now - LIVE.t : 0;
  if (LIVE.t && (dt <= 0.2)) return; // aynı anda gelen yinelenen konumlar
  const prevAlong = LIVE.along; LIVE.t = now; LIVE.along = along;
  if (!dt || dt > 15 || prevAlong == null || along < prevAlong - 80) { LIVE.win = []; return; } // ilk ölçüm, uzun kesinti ya da rota değişti
  const body = BODIES[VEH.body], fuel = FUELS[VEH.fuel];
  const vRaw = Number.isFinite(meSpeed) && meSpeed >= 0 ? meSpeed : Math.max(0, (along - prevAlong) / dt);
  const vPrev = LIVE.v ?? vRaw, v = vPrev + (vRaw - vPrev) * Math.min(1, dt / 3); // ~3 sn yumuşatma
  const a = Math.max(-3, Math.min(3, (v - vPrev) / dt)); LIVE.v = v;
  let grade = 0, elev = 0;
  // Eğim ±150 m pencereden: ~30 m'lik arazi verisinin köprü/viyadük gürültüsü anlık değeri sallamasın
  if (r.profile) { const a0 = Math.max(0, along - 150), a1 = Math.min(r.total, along + 150), p0 = profileAt(r.profile, a0), p1 = profileAt(r.profile, a1); grade = a1 > a0 + 50 ? (p1.elev - p0.elev) / (a1 - a0) : 0; elev = (p0.elev + p1.elev) / 2; }
  const rho = 1.225 * Math.exp(-elev / 8500);
  const F = body.m * G * body.crr + 0.5 * rho * body.cda * v * v + body.m * G * Math.max(-0.08, Math.min(0.08, grade)) + body.m * a * 1.05; // 1,05: dönen parçaların ataleti
  const P = F * v, kmh = v * 3.6, eta = fuel.etaLo + (fuel.etaHi - fuel.etaLo) * Math.min(1, kmh / 90);
  let W;
  if (P > 0) W = P / eta + fuel.idleKw * 1000;
  else if (fuel.regen) W = P * fuel.regen * fuel.etaHi + fuel.idleKw * 1000;
  else W = kmh > 15 ? fuel.idleKw * 150 : fuel.idleKw * 1000; // motor freni: yakıt kesilir
  const k = avgK(body, fuel), rate = W * k; // birim/sn (negatif olabilir: elektrikte geri kazanım)
  LIVE.rate = LIVE.rate + (rate - LIVE.rate) * Math.min(1, dt / 5); // gösterge ~5 sn yumuşatılır
  const dq = rate * dt, dd = v * dt;
  LIVE.qty += dq; LIVE.dist += dd; LIVE.sec += dt; LIVE.maxV = Math.max(LIVE.maxV, kmh);
  if (kmh >= 125) LIVE.fastSec += dt; if (P <= 0 && kmh > 15) LIVE.cutSec += dt;
  // Son ~5 km: gerçekleşen / planlanan
  const c = routeCost(r), plan = planQtyAt(c, along);
  LIVE.win.push({ d: dd, q: dq, along, plan });
  const winDist = () => LIVE.win.reduce((s, x) => s + x.d, 0);
  while (LIVE.win.length > 2 && winDist() > 5000) LIVE.win.shift();
  const sd = winDist();
  const first = LIVE.win[0], last = LIVE.win[LIVE.win.length - 1];
  if (first.plan != null && last.plan != null && sd > 3000) {
    const planned = last.plan - first.plan, actual = LIVE.win.reduce((s, x) => s + x.q, 0);
    if (planned > 0.02) LIVE.factor = LIVE.factor + (Math.max(0.7, Math.min(1.5, actual / planned)) - LIVE.factor) * 0.08;
  }
  renderLiveFuel(r, along, c, kmh);
}
const avgK = (body, fuel) => vehAvg() / 1e5 / refPerM(body, fuel);
function liveHint(r, along, kmh) {
  if (kmh < 118) return '';
  // Kalan yolun hızlı (otoyol/bölünmüş yol) kısmı: planlanan hızı 85 km/sa üstü adımlar
  let fastM = 0;
  for (const s of r.steps || []) { const end = s.at + s.distance; if (end <= along || s.duration <= 0) continue; if (s.distance / s.duration * 3.6 >= 85) fastM += end - Math.max(s.at, along); }
  if (fastM < 5000) return '';
  const body = BODIES[VEH.body], fuel = FUELS[VEH.fuel], k = avgK(body, fuel), alt = 110;
  const per = x => segEnergy(body, fuel, x / 3.6, 1000, 0, 0).e * k / 1000; // birim/m
  const extra = (per(kmh) - per(alt)) * fastM * unitPrice().v, late = fastM / (alt / 3.6) - fastM / (kmh / 3.6);
  if (extra < 15) return '';
  return `Bu hızla kalan ${fmtDist(fastM)} hızlı yolda <b>+${fmtTL(extra)}</b> · ${alt} km/sa ile ~${fmtDur(late)} geç varırsınız`;
}
let liveDomAt = 0;
function renderLiveFuel(r, along, c, kmh) {
  const el = $('nav-fuel'); if (!el) return;
  const t = performance.now(); if (t - liveDomAt < 900) return; liveDomAt = t;
  const u = FUELS[VEH.fuel].unit, price = unitPrice().v, v = LIVE.v || 0;
  let now, unitTxt, col;
  if (v < 2) { now = Math.max(0, LIVE.rate * 3600); unitTxt = `${u}/sa`; col = '#9aa0a6'; }
  else {
    now = LIVE.rate / v * 1e5; unitTxt = `${u}/100`;
    const ref = vehAvg(); col = now <= ref * 1.05 ? '#188038' : now <= ref * 1.5 ? '#e37400' : '#d93025';
  }
  const spent = Math.max(0, LIVE.qty) * price;
  const planRem = c?.plan ? Math.max(0, c.qty - planQtyAt(c, along)) : c ? c.qty * Math.max(0, r.total - along) / r.total : null;
  const rem = planRem != null ? planRem * LIVE.factor * price : null;
  const hint = liveHint(r, along, kmh);
  const nowTxt = v >= 2 && LIVE.rate <= 0 ? (FUELS[VEH.fuel].regen ? 'Şarj ediyor' : 'Yakıt kesik') : `${(now < 10 ? nf1 : nf0).format(now)}`;
  el.hidden = false;
  el.innerHTML = `<div class="nf-main">
      <span class="nf-now"><i style="background:${col}"></i><b>${nowTxt}</b>${v >= 2 && LIVE.rate <= 0 ? '' : `<small>${unitTxt}</small>`}</span>
      <span class="nf-k"><small>Harcanan</small><b>${fmtTL(spent)}</b></span>
      ${rem != null ? `<span class="nf-k"><small>Kalan</small><b>~${fmtTL(rem)}</b></span>` : ''}
    </div>${hint ? `<div class="nf-hint">${hint}</div>` : ''}`;
}
function liveFuelStop() {
  const el = $('nav-fuel'); if (el) { el.hidden = true; el.innerHTML = ''; }
  document.body.classList.remove('fuel-on');
  if (!LIVE.on) return; LIVE.on = false;
  if (LIVE.dist < 1000) return;
  const u = FUELS[VEH.fuel].unit, price = unitPrice().v, km = LIVE.dist / 1000, q = Math.max(0, LIVE.qty);
  const per = q / km * 100, mins = LIVE.sec / 60;
  const box = $('nav-sum'); if (!box) return;
  box.innerHTML = `<div class="ns-h"><span class="ms">local_gas_station</span><b>Yolculuk özeti</b><button class="icon-btn" id="ns-close" aria-label="Kapat"><span class="ms">close</span></button></div>
    <div class="ns-grid">
      <span><small>Mesafe</small><b>${fmtDist(LIVE.dist)}</b></span>
      <span><small>Süre</small><b>${fmtDur(LIVE.sec)}</b></span>
      <span><small>${FUELS[VEH.fuel].label}</small><b>${fmtQty(q, u)}</b></span>
      <span><small>Yakıt maliyeti</small><b>${fmtTL(q * price)}</b></span>
      <span><small>Ortalama</small><b>${nf1.format(per)} ${u}/100</b></span>
      <span><small>Ortalama hız</small><b>${nf0.format(km / Math.max(1 / 60, mins / 60))} km/sa</b></span>
    </div>
    <p class="ns-note">${per <= vehAvg() ? 'Ortalama tüketiminizin altında, ekonomik bir sürüş.' : `Ortalamanızdan %${nf0.format(Math.round((per / vehAvg() - 1) * 100))} fazla.`}${LIVE.fastSec > 60 ? ` ${fmtDur(LIVE.fastSec)} boyunca 125 km/sa üstünde gidildi.` : ''}${LIVE.cutSec > 60 ? ` ${fmtDur(LIVE.cutSec)} motor freniyle (yakıtsız) ilerlendi.` : ''} Değerler GPS ve arazi verisinden tahmindir.</p>`;
  box.hidden = false;
  $('ns-close').onclick = () => { box.hidden = true; };
  clearTimeout(liveFuelStop._t); liveFuelStop._t = setTimeout(() => { box.hidden = true; }, 30000);
}
