/* ================= Araçlarım: katalogdan araç seçimi, düzenleme, yakıt alımları =================
   Katalog: data/vehicles/*.json — AB Çevre Ajansı (EEA) yeni araç tescil verisinden (2010–2025) üretilir
   (tools/build_vehicles.py). Marka → model → yıl → motor seçilir; seçilen kayıt araçla birlikte bu cihazda saklanır,
   hesap için tekrar indirilmez. Yakıt alımları (depo dolu → depo dolu) gerçek ortalamayı verir ve fizik modelini
   araca/sürücüye göre düzeltir. */
'use strict';

const VCAT = { index: null, makes: new Map() };
const catIndex = () => VCAT.index ||= fetch('/data/vehicles/index.json').then(r => { if (!r.ok) throw new Error('Araç listesi alınamadı'); return r.json(); }).catch(e => { VCAT.index = null; throw e; });
const catMake = f => { if (!VCAT.makes.has(f)) VCAT.makes.set(f, fetch('/data/vehicles/' + f).then(r => { if (!r.ok) throw new Error('Araç listesi alınamadı'); return r.json(); }).catch(e => { VCAT.makes.delete(f); throw e; })); return VCAT.makes.get(f); };
// Türkiye'de çok satılan / satılmış markalar önce
const TR_TOP = ['Renault', 'Fiat', 'Toyota', 'Volkswagen', 'Hyundai', 'Peugeot', 'Dacia', 'Opel', 'Citroën', 'Togg', 'Honda', 'Ford', 'Škoda', 'BMW', 'Mercedes-Benz', 'Audi', 'Kia', 'Nissan', 'Seat', 'Chery', 'BYD', 'Tesla', 'MG', 'Cupra', 'Volvo'];
const BODY_TR = { car: 'Binek', suv: 'SUV', van: 'Ticari / MPV' };
const BODY_KEY = { car: 'sedan', suv: 'suv', van: 'ticari' };
const parseNum = s => { const v = parseFloat(String(s).replace(/\s/g, '').replace(',', '.')); return Number.isFinite(v) && v > 0 ? v : null; };
const trLower = s => String(s).toLocaleLowerCase('tr-TR').normalize('NFKD').replace(/[̀-ͯ]/g, '').replace(/ı/g, 'i');
const panelModeNow = () => (typeof panelMode !== 'undefined' && panelMode === 'dir' ? 'dir' : 'list');
const fuelUnit = c => (c.f === 'elektrik' ? 'kWh' : 'L');
const basisLabel = b => (b === 'n' ? 'NEDC' : 'WLTP');

// Bir katalog kaydı için "gerçek kullanım" tahmini (aynı fizik modeliyle, kişisel düzeltme olmadan)
function catRealEstimate(c) {
  const v = { id: '__est_' + JSON.stringify(c), cat: c, body: BODY_KEY[c.body] || 'sedan', fuel: c.f, pax: 1, fills: [] };
  try { const e = refPer100(v, false); PHYS_CACHE.delete(v.id); return e; } catch (e) { return null; }
}

/* ----- Araç görselleri: Wikimedia Commons (özgür lisanslı), yoksa gövde tipine göre çizim ----- */
const SIL = {
  car: '<svg viewBox="0 0 120 48" aria-hidden="true"><path d="M8 34c0-5 3-7 8-8l14-3 14-10c3-2 6-3 10-3h22c5 0 8 2 12 5l10 8 9 2c5 1 7 4 7 8v4H8z" fill="currentColor" opacity=".18"/><path d="M8 34c0-5 3-7 8-8l14-3 14-10c3-2 6-3 10-3h22c5 0 8 2 12 5l10 8 9 2c5 1 7 4 7 8v4H8zM46 14l-9 9h28V12H55c-4 0-6 0-9 2zm24-2v11h26l-8-7c-3-3-5-4-9-4z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="31" cy="38" r="7" fill="var(--bg)" stroke="currentColor" stroke-width="2"/><circle cx="92" cy="38" r="7" fill="var(--bg)" stroke="currentColor" stroke-width="2"/></svg>',
  suv: '<svg viewBox="0 0 120 48" aria-hidden="true"><path d="M8 35v-7c0-3 2-5 5-6l16-3 9-11c2-2 4-3 7-3h38c4 0 6 1 8 4l8 11 8 2c3 1 5 3 5 6v7H8z" fill="currentColor" opacity=".18"/><path d="M8 35v-7c0-3 2-5 5-6l16-3 9-11c2-2 4-3 7-3h38c4 0 6 1 8 4l8 11 8 2c3 1 5 3 5 6v7H8zM44 9l-8 10h26V8H48c-2 0-3 0-4 1zm23-1v11h31l-7-9c-1-2-2-2-4-2z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="32" cy="38" r="8" fill="var(--bg)" stroke="currentColor" stroke-width="2"/><circle cx="92" cy="38" r="8" fill="var(--bg)" stroke="currentColor" stroke-width="2"/></svg>',
  van: '<svg viewBox="0 0 120 48" aria-hidden="true"><path d="M8 36V12c0-3 2-6 6-6h64c4 0 6 1 8 4l12 12 12 3c3 1 4 3 4 6v5H8z" fill="currentColor" opacity=".18"/><path d="M8 36V12c0-3 2-6 6-6h64c4 0 6 1 8 4l12 12 12 3c3 1 4 3 4 6v5H8zM80 10v14h17l-10-11c-2-2-4-3-7-3z" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"/><circle cx="30" cy="38" r="7" fill="var(--bg)" stroke="currentColor" stroke-width="2"/><circle cx="94" cy="38" r="7" fill="var(--bg)" stroke="currentColor" stroke-width="2"/></svg>'
};
const IMG_MEM = new Map();
function carImg(mk, md, y) {
  const key = `${mk}|${md}|${y || 0}`;
  if (IMG_MEM.has(key)) return IMG_MEM.get(key);
  const cached = store.get('carimg', {})[key];
  const p = cached && Date.now() - cached.t < 30 * 864e5 ? Promise.resolve(cached.d)
    : fetch('/api/carimg?' + new URLSearchParams({ mk, md, y: y || '' })).then(r => (r.ok ? r.json() : null)).then(d => {
      const all = store.get('carimg', {}); all[key] = { t: Date.now(), d: d?.src ? d : null };
      const keys = Object.keys(all); if (keys.length > 80) delete all[keys[0]];
      store.set('carimg', all); return d?.src ? d : null;
    }).catch(() => null);
  IMG_MEM.set(key, p);
  return p;
}
// data-img="marka|model|yıl|gövde" taşıyan öğeleri doldurur; data-credit varsa kaynak satırı eklenir
function hydrateImgs(root) {
  root.querySelectorAll('[data-img]').forEach(el => {
    const [mk, md, y, body] = el.dataset.img.split('|');
    el.innerHTML = `<span class="ci-sil">${SIL[body] || SIL.car}</span>`;
    carImg(mk, md, +y).then(d => {
      if (!d || !el.isConnected) return;
      const img = new Image(); img.alt = `${mk} ${md}`; img.decoding = 'async'; img.referrerPolicy = 'no-referrer';
      img.onload = () => {
        if (!el.isConnected) return;
        el.innerHTML = ''; el.appendChild(img); el.classList.add('has');
        if (el.dataset.credit != null) el.insertAdjacentHTML('beforeend', `<a class="ci-credit" href="https://commons.wikimedia.org/wiki/File:${encodeURIComponent(d.file)}" target="_blank" rel="noopener">Temsilî görsel · Wikimedia Commons</a>`);
      };
      img.src = d.src;
    });
  });
}
const imgAttr = (c, md = c.md, y = c.y, body = c.body) => `data-img="${esc(`${c.mk}|${md}|${y || 0}|${body || 'car'}`)}"`;

// Yakıt türü rengi (kart şeridi ve gösterge)
const fuelKind = v => (v.p === 'bev' ? 'ev' : v.p === 'ice' ? v.f : 'hyb');
const FUEL_KIND_TR = { benzin: 'Benzin', dizel: 'Dizel', lpg: 'LPG', ev: 'Elektrik', hyb: 'Hibrit' };
// Marka işareti: Wikimedia Commons'taki logo (beyaz zemin üzerinde, iki temada da okunur); yüklenemezse harf rozeti
const logoUrl = f => `https://commons.wikimedia.org/wiki/Special:FilePath/${encodeURIComponent(f)}?width=120`;
const brandMark = m => m.logo
  ? `<span class="cp-logo"><img src="${logoUrl(m.logo)}" alt="" loading="lazy" decoding="async" referrerpolicy="no-referrer" onerror="this.parentNode.outerHTML=this.parentNode.dataset.fb" ></span>`.replace('class="cp-logo"', `class="cp-logo" data-fb="${esc(monogram(m.n))}"`)
  : monogram(m.n);
// Marka monogramı: adın baş harflerinden, adına göre sabit renk
const monogram = n => {
  const w = n.replace(/[^A-Za-zÀ-ž0-9 -]/g, '').split(/[\s-]+/).filter(Boolean);
  const t = w.length > 1 ? w[0][0] + w[1][0] : n.slice(0, 2);
  let h = 0; for (const ch of n) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
  return `<span class="cp-mono" style="--mh:${h % 360}">${esc(t)}</span>`;
};

/* ----- Katalog seçici: Marka → Model → Yıl → Motor ----- */
function openCatalogPicker(onPick, { push = true } = {}) {
  const st = { step: 'make', q: '', make: null, data: null, model: null, year: null, err: '' };
  const STEPS = [['make', 'Marka'], ['model', 'Model'], ['year', 'Yıl'], ['engine', 'Motor']];
  const mode = panelModeNow();
  const render = el => {
    const at = STEPS.findIndex(s => s[0] === st.step);
    const title = st.step === 'make' ? 'Aracını seç' : st.step === 'model' ? st.make : `${st.make} ${st.model.n}`;
    const sub = st.step === 'engine' ? `${st.year.y} model yılı` : st.step === 'year' ? 'Hangi yıl trafiğe çıktı?' : st.step === 'model' ? 'Modelini seç' : 'Markayla başla';
    const head = `<div class="list-head drag-zone cp-head"><button class="icon-btn" id="cp-back" aria-label="Geri"><span class="ms">arrow_back</span></button><div><h2>${esc(title)}</h2><small>${sub}</small></div></div>
      <ol class="cp-steps">${STEPS.map(([k, l], i) => `<li class="${i < at ? 'done' : i === at ? 'on' : ''}">${i < at ? `<button data-go="${k}">${l}</button>` : `<span>${l}</span>`}</li>`).join('')}</ol>`;
    const search = ph => `<label class="cp-search"><span class="ms">search</span><input id="cp-q" placeholder="${ph}" value="${esc(st.q)}" autocomplete="off" enterkeyhint="search"></label>`;
    let html = '';
    if (st.err) html = head + `<div class="empty">${esc(st.err)}<br><button class="btn outline" id="cp-retry">Tekrar dene</button></div>`;
    else if (st.step === 'make') {
      if (!VCAT.index || VCAT.index instanceof Promise) {
        html = head + '<div class="loading"><div class="spinner"></div>Markalar yükleniyor…</div>';
        catIndex().then(d => { VCAT.index = d; render(el); }).catch(e => { st.err = e.message; render(el); });
      } else {
        const q = trLower(st.q), all = VCAT.index.makes;
        const match = all.filter(m => !q || trLower(m.n).includes(q));
        const top = q ? [] : TR_TOP.map(n => all.find(m => m.n === n)).filter(Boolean);
        html = head + search('Marka ara: Fiat, Togg, Renault…') +
          (top.length ? `<h3 class="cp-sec">Türkiye'de yollarda en çok görülenler</h3><div class="cp-brands">${top.map(m => `<button class="cp-brand" data-make="${esc(m.f)}" data-n="${esc(m.n)}">${brandMark(m)}<b>${esc(m.n)}</b><small>${m.models} model</small></button>`).join('')}</div><h3 class="cp-sec">Tüm markalar</h3>` : '') +
          `<div class="cp-list">${match.map(m => `<button class="cp-it" data-make="${esc(m.f)}" data-n="${esc(m.n)}">${brandMark(m)}<span class="cp-m"><b>${esc(m.n)}</b><small>${m.models} model</small></span><span class="ms">chevron_right</span></button>`).join('') || `<div class="empty">"${esc(st.q)}" adında marka yok.<br><small>Aşağıdan aracını elle girebilirsin.</small></div>`}</div>` +
          `<div class="cp-foot"><button class="btn outline" id="cp-manual"><span class="ms">tune</span>Aracım listede yok, elle gireceğim</button>
           <p class="mini-note">Liste, Avrupa'da 2010–2025 arasında satılan binek araçların resmî tip onayı kayıtlarından (AB Çevre Ajansı) gelir. Türkiye'ye özgü bazı adlar eşdeğeriyle eşleştirildi: Egea = Tipo, Taliant = Logan. Logolar ve araç görselleri Wikimedia Commons'tan; markalar sahiplerine aittir.</p></div>`;
      }
    } else if (st.step === 'model') {
      if (!st.data) html = head + '<div class="loading"><div class="spinner"></div>Modeller yükleniyor…</div>';
      else {
        const q = trLower(st.q), ms = st.data.models.filter(m => !q || trLower(m.n).includes(q));
        html = head + search(`${st.make} modeli ara`) + `<div class="cp-list">${ms.map(m => {
          const ys = m.years.map(y => y.y), last = Math.max(...ys), span = ys.length > 1 ? `${Math.min(...ys)}–${last}` : ys[0];
          return `<button class="cp-it cp-model" data-model="${st.data.models.indexOf(m)}"><span class="cp-thumb" ${imgAttr({ mk: st.make, body: m.body }, m.n, last)}></span><span class="cp-m"><b>${esc(m.n)}</b><small>${BODY_TR[m.body] || ''}, ${span}${m.eq ? `<br>${esc(m.eq)}` : ''}</small></span><span class="ms">chevron_right</span></button>`;
        }).join('') || `<div class="empty">"${esc(st.q)}" adında ${esc(st.make)} modeli yok.</div>`}</div>`;
      }
    } else if (st.step === 'year') {
      const last = st.model.years[0].y;
      html = head + `<div class="cp-hero" ${imgAttr({ mk: st.make, body: st.model.body }, st.model.n, last)} data-credit></div>
        <div class="cp-years">${st.model.years.map((y, i) => `<button class="cp-year" data-year="${i}"><b>${y.y}</b><small>${y.v.length} motor</small></button>`).join('')}</div>
        <p class="mini-note">Ruhsattaki ilk tescil yılını seç. Listede yoksa en yakın yılı seç; aynı kasada motorlar genelde birkaç yıl değişmez.</p>`;
    } else if (st.step === 'engine') {
      const vs = st.year.v.map(v => { const c = { mk: st.make, md: st.model.n, y: st.year.y, body: st.model.body, ...v }; return { v, c, real: catRealEstimate(c) }; });
      const max = Math.max(...vs.map(x => x.real || 0)) || 1;
      html = head + `<div class="cp-hero" ${imgAttr({ mk: st.make, body: st.model.body }, st.model.n, st.year.y)} data-credit></div>
        <div class="cp-engs">${vs.map(({ v, c, real }, i) => {
          const k = fuelKind(v), u = v.p === 'phev' ? 'L' : fuelUnit(v);
          const off = v.c ? `Resmî ${nf1.format(v.c)} ${fuelUnit(v)} (${basisLabel(v.b)})` : v.p === 'phev' ? `Elektrikle ~${v.er ? nf0.format(v.er) : '?'} km` : '';
          return `<button class="cp-eng fk-${k}" data-eng="${i}">
            <span class="ce-top"><span class="ce-fuel">${FUEL_KIND_TR[k]}${v.p === 'mhev' ? ' · hafif' : v.p === 'phev' ? ' · şarjlı' : ''}</span>${v.r >= 0.25 ? '<span class="ce-pop">En yaygın</span>' : ''}</span>
            <span class="ce-name"><b>${v.p === 'bev' ? (v.er ? `${nf0.format(v.er)} km menzil` : 'Elektrik motoru') : esc(catEngine(c).replace(/ \d+ HP$/, ''))}</b><span class="ce-hp">${v.kw ? `${hp(v.kw)}<small>HP</small>` : ''}</span></span>
            ${real ? `<span class="ce-gauge"><i style="width:${Math.max(8, real / max * 100).toFixed(0)}%"></i></span>
            <span class="ce-real"><b>${nf1.format(real)}</b> ${u}/100 km gerçek kullanımda${v.p === 'phev' ? ', batarya boşken' : ''}</span>` : ''}
            <span class="ce-meta">${off}${off ? ', ' : ''}${nf0.format(v.m)} kg</span>
          </button>`;
        }).join('')}</div>
        <p class="mini-note">Gerçek kullanım; şehir içi, şehirlerarası ve otoyol karışık sürüşte bu araç için fizik modelinin tahminidir. Yakıt alımlarını girdikçe sana göre düzelir.</p>`;
    }
    el.innerHTML = html;
    hydrateImgs(el);
    const qi = el.querySelector('#cp-q');
    if (qi) { qi.oninput = () => { st.q = qi.value; const pos = qi.selectionStart; render(el); const n = el.querySelector('#cp-q'); n.focus(); n.setSelectionRange(pos, pos); }; }
    const top = () => { $('panel-body').scrollTop = 0; };
    const go = step => { st.q = ''; st.step = step; if (step === 'make') st.data = null; render(el); top(); };
    el.querySelector('#cp-back')?.addEventListener('click', () => {
      if (st.step === 'make' || st.err) { goBack(); return; }
      go({ model: 'make', year: 'model', engine: st.model.years.length === 1 ? 'model' : 'year' }[st.step]);
    });
    el.querySelectorAll('[data-go]').forEach(b => { b.onclick = () => go(b.dataset.go === 'year' && st.model.years.length === 1 ? 'model' : b.dataset.go); });
    el.querySelector('#cp-retry')?.addEventListener('click', () => { st.err = ''; render(el); });
    el.querySelector('#cp-manual')?.addEventListener('click', () => { onPick(null); goBack(); setSheet('full'); });
    el.querySelectorAll('[data-make]').forEach(b => { b.onclick = () => {
      st.make = b.dataset.n; go('model');
      catMake(b.dataset.make).then(d => { if (st.make !== d.make) return; st.data = d; render(el); }).catch(e => { st.err = e.message; render(el); });
    }; });
    el.querySelectorAll('[data-model]').forEach(b => { b.onclick = () => { st.model = st.data.models[+b.dataset.model]; if (st.model.years.length === 1) { st.year = st.model.years[0]; go('engine'); } else go('year'); }; });
    el.querySelectorAll('[data-year]').forEach(b => { b.onclick = () => { st.year = st.model.years[+b.dataset.year]; go('engine'); }; });
    el.querySelectorAll('[data-eng]').forEach(b => { b.onclick = () => {
      const v = st.year.v[+b.dataset.eng];
      const c = { mk: st.make, md: st.model.n, y: st.year.y, body: st.model.body, ...(st.model.eq ? { eq: st.model.eq } : {}), ...v };
      delete c.r; onPick(c); goBack(); setSheet('full');
    }; });
  };
  render.mode = mode;
  openPanel(render, { mode, push, sheet: 'full' });
}

/* ----- Yönlendirme ekranındaki araç kutusu ----- */
function vehChipHtml() {
  if (dir.mode !== 'car') return '';
  return `<button class="veh-chip" id="veh-chip" aria-expanded="${!!dir.vehOpen}"><span class="ms">${BODIES[VEH.body].icon}</span><span class="vc-t">${esc(vehSummary())}</span><span class="ms vc-x">${dir.vehOpen ? 'expand_less' : 'tune'}</span></button>${dir.vehOpen ? vehFormHtml() : ''}`;
}
function vehFormHtml() {
  const seg = (name, items, cur) => `<div class="vf-seg" role="radiogroup">${items.map(([k, l]) => `<button type="button" role="radio" aria-checked="${k === cur}" class="${k === cur ? 'on' : ''}" data-${name}="${k}">${l}</button>`).join('')}</div>`;
  const u = FUELS[vehFuel()].unit;
  return `<div class="veh-form" id="veh-form">
    ${GARAGE.list.length > 1 ? `<label class="vf-l">Araç</label>${seg('veh', GARAGE.list.map(v => [v.id, esc(v.name)]), VEH.id)}` : ''}
    <div class="vf-car"><div><b>${esc(VEH.cat ? `${VEH.cat.mk} ${VEH.cat.md} ${VEH.cat.y}` : VEH.name)}</b><small>${esc(VEH.cat ? catEngine(VEH.cat) : `${BODIES[VEH.body].label} · ${FUELS[VEH.fuel].label} · katalog dışı`)} · tipik ${nf1.format(vehAvg())} ${u}/100${isPhev() ? ' (batarya boşken)' : ''}</small></div>
      <button type="button" class="btn outline sm" id="vf-edit">${VEH.cat ? 'Değiştir' : 'Aracını seç'}</button></div>
    <label class="vf-l">Sürüş tarzı</label>${seg('style', Object.entries(DRIVE_STYLES).map(([k, s]) => [k, s.label]), FSET.style)}
    <div class="vf-grid">
      <div class="vf-f"><span>Yolcu (sürücü dahil)</span><span class="vf-step"><button type="button" id="vf-minus" aria-label="Azalt">−</button><b>${VEH.pax}</b><button type="button" id="vf-plus" aria-label="Artır">+</button></span></div>
      ${isPhev() ? `<label class="vf-f"><span>Başlangıç şarjı</span><span class="vf-in"><input id="vf-soc" inputmode="numeric" value="${nf0.format(VEH.soc)}"><em>%</em></span></label>` : ''}
    </div>
    <label class="vf-tog"><input type="checkbox" id="vf-wx" ${FSET.weather ? 'checked' : ''}><span>Hava durumunu hesaba kat <small>sıcaklık, klima/ısıtma, rüzgâr</small></span></label>
    <p class="vf-note">Hızlı yollarda gerçek seyir hızı yasal sınıra göre tahmin edilir; sürüş tarzı bunu ölçekler. Tüketimi kendi aracınıza göre düzeltmek için menüden <b>Araçlarım → Yakıt aldım</b>.</p>
  </div>`;
}
function wireVehicle(root, rerender) {
  const chip = root.querySelector('#veh-chip'); if (!chip) return;
  const apply = () => { saveVeh(); clearCostCache(); rerender(); };
  chip.onclick = () => { dir.vehOpen = !dir.vehOpen; rerender(); };
  root.querySelectorAll('[data-veh]').forEach(b => { b.onclick = () => { setActiveVehicle(b.dataset.veh); rerender(); }; });
  root.querySelectorAll('[data-style]').forEach(b => { b.onclick = () => { FSET.style = b.dataset.style; saveFset(); apply(); }; });
  root.querySelector('#vf-wx')?.addEventListener('change', e => { FSET.weather = e.target.checked; saveFset(); apply(); });
  root.querySelector('#vf-minus')?.addEventListener('click', () => { VEH.pax = Math.max(1, VEH.pax - 1); apply(); });
  root.querySelector('#vf-plus')?.addEventListener('click', () => { VEH.pax = Math.min(9, VEH.pax + 1); apply(); });
  const soc = root.querySelector('#vf-soc'); if (soc) soc.onchange = () => { const x = parseNum(soc.value); VEH.soc = x == null ? 0 : Math.min(100, Math.round(x)); apply(); };
  root.querySelector('#vf-edit')?.addEventListener('click', () => editVehicle(VEH));
}

/* ----- Araçlarım listesi ----- */
function openGarage({ push = false } = {}) {
  closeDrawer?.();
  const render = el => {
    el.innerHTML = `<div class="list-head drag-zone"><h2>Araçlarım</h2><small>Rota maliyeti ve anlık tüketim seçili araca göre hesaplanır</small></div>
      <div class="gv-list">${GARAGE.list.map(v => {
        const u = FUELS[vehFuel(v)].unit, pers = personal(v);
        return `<div class="gv ${v === VEH ? 'on' : ''}" data-id="${v.id}">
          ${v.cat ? `<span class="gv-img" ${imgAttr(v.cat)}></span>` : `<span class="gv-img sil">${SIL[{ suv: 'suv', ticari: 'van' }[v.body] || 'car']}</span>`}
          <div class="gv-m"><b>${esc(v.name)}${v === VEH ? '<em>Seçili</em>' : ''}</b>
            <small>${esc(v.cat ? `${v.cat.mk} ${v.cat.md} ${v.cat.y} · ${catEngine(v.cat)}${v.lpgConv ? ' · LPG' : ''}` : `${BODIES[v.body].label} · ${FUELS[v.fuel].label} · katalog dışı`)}</small>
            <small>Tipik ${nf1.format(vehAvg(v))} ${u}/100 km · 100 km ≈ <b>${fmtTL(per100Cost(v))}</b>${v.tank ? ` · depoyla ~${nf0.format(v.tank / vehAvg(v) * 100)} km` : ''}</small>
            ${pers.n ? `<small class="gv-learn"><span class="ms">insights</span>${pers.n} yakıt alımından öğrenildi · gerçek ${nf1.format(fillStats(v).per100)} ${u}/100</small>` : ''}</div>
          <div class="gv-a">${v === VEH ? '' : `<button class="btn outline sm" data-sel="${v.id}">Seç</button>`}<button class="icon-btn" data-fill="${v.id}" aria-label="Yakıt aldım" title="Yakıt aldım"><span class="ms">local_gas_station</span></button><button class="icon-btn" data-edit="${v.id}" aria-label="Düzenle" title="Düzenle"><span class="ms">edit</span></button><button class="icon-btn gv-del" data-del="${v.id}" aria-label="${esc(v.name)} aracını sil" title="Sil"><span class="ms">delete</span></button></div>
        </div>`;
      }).join('')}</div>
      <div class="gv-add"><button class="btn primary" id="gv-add"><span class="ms">add</span>Araç ekle</button></div>
      <p class="mini-note">Aracınızı marka, model, yıl ve motoruyla seçerseniz tüketim o araca özel hesaplanır. Yakıt aldığınızda kilometre ve litreyi girerseniz hesap sizin sürüşünüze göre düzelir. Bilgiler yalnızca bu cihazda saklanır.</p>`;
    el.querySelectorAll('[data-sel]').forEach(b => { b.onclick = () => { setActiveVehicle(b.dataset.sel); render(el); toast(`${VEH.name} seçildi`); }; });
    el.querySelectorAll('[data-edit]').forEach(b => { b.onclick = () => editVehicle(GARAGE.list.find(v => v.id === b.dataset.edit)); });
    hydrateImgs(el);
    el.querySelectorAll('[data-del]').forEach(b => { b.onclick = () => { deleteVehicle(GARAGE.list.find(v => v.id === b.dataset.del)); render(el); }; });
    el.querySelectorAll('[data-fill]').forEach(b => { b.onclick = () => openFills(GARAGE.list.find(v => v.id === b.dataset.fill)); });
    el.querySelectorAll('.gv').forEach(c => { c.onclick = e => { if (!e.target.closest('button')) { setActiveVehicle(c.dataset.id); render(el); } }; });
    $('gv-add').onclick = () => editVehicle(null);
  };
  render.mode = 'list';
  openPanel(render, { mode: 'list', push, sheet: 'full' });
}

// Araç sil: son araç silinirse yerine boş bir "Aracım" konur (hesaplar her zaman bir araçla yapılır)
function deleteVehicle(v) {
  if (!v || !confirm(`${v.name} silinsin mi? Yakıt alımı kayıtları da silinir.`)) return false;
  GARAGE.list.splice(GARAGE.list.indexOf(v), 1);
  if (!GARAGE.list.length) GARAGE.list.push(fixVeh({ id: 'v' + Date.now().toString(36), name: 'Aracım', body: 'sedan', fuel: 'benzin', pax: 1 }));
  if (VEH === v) VEH = GARAGE.list[0];
  PHYS_CACHE.delete(v.id); saveVeh(); clearCostCache(); toast(`${v.name} silindi`);
  if (typeof refreshDirResults === 'function' && dir.routes.length) refreshDirResults();
  return true;
}

/* ----- Araç ekle / düzenle ----- */
function editVehicle(v, { pick = true } = {}) {
  const isNew = !v;
  const d = v ? JSON.parse(JSON.stringify(v)) : fixVeh({ id: 'v' + Date.now().toString(36), name: '', body: 'sedan', fuel: 'benzin', avg: null, price: null, tank: null, pax: VEH?.pax || 1, fills: [] });
  if (isNew) { d.name = ''; d.autoName = true; }
  let manual = !!v && !v.cat;
  const mode = panelModeNow();
  const setCat = c => {
    if (!c) { manual = true; d.cat = null; return; }
    manual = false; d.cat = c; d.body = BODY_KEY[c.body] || 'sedan'; d.fuel = c.f; d.avg = null; d.price = null;
    if (c.p !== 'phev') d.elecPrice = null;
    if (!d.lpgConv || c.f !== 'benzin') d.lpgConv = false;
    if (!d.name || d.autoName) { d.name = `${c.md} ${c.y}`.slice(0, 40); d.autoName = true; }
  };
  const render = el => {
    const c = d.cat, body = BODIES[d.body], u = FUELS[vehFuel(d)].unit;
    const seg = (name, items, cur) => `<div class="vf-seg">${items.map(([k, l]) => `<button type="button" class="${k === cur ? 'on' : ''}" data-${name}="${k}">${l}</button>`).join('')}</div>`;
    const tmp = { ...d, id: '__edit' }; PHYS_CACHE.delete('__edit');
    const est = c || manual ? refPer100(tmp, false) : null;
    const carBox = c ? `<div class="ve-car"><span class="ve-img" ${imgAttr(c)}></span><div><b>${esc(`${c.mk} ${c.md} ${c.y}`)}</b><small>${esc(catEngine(c))} · ${nf0.format(c.m)} kg</small>
        <small>${c.c ? `Resmî ${nf1.format(c.c)} ${fuelUnit(c)}/100 km (${basisLabel(c.b)})` : c.p === 'phev' ? `Batarya ~${nf0.format(c.z && c.er ? c.z * c.er / 1000 : 10)} kWh · elektrikli menzil ~${c.er ? nf0.format(c.er) : '?'} km` : ''}${est ? ` · gerçek kullanımda ≈ <b>${nf1.format(est)} ${u}/100</b>` : ''}</small>${c.eq ? `<small>Hesap ${esc(c.eq)} verisiyle</small>` : ''}</div>
        <button type="button" class="btn outline sm" id="ve-pick">Değiştir</button></div>`
      : manual ? `<div class="ve-pick"><button type="button" class="btn outline" id="ve-pick"><span class="ms">search</span>Katalogdan seç (marka, model, motor)</button></div>` : `<div class="ve-pick"><button type="button" class="btn primary" id="ve-pick"><span class="ms">search</span>Marka, model ve motoru seç</button><button type="button" class="btn outline" id="ve-manual">Elle gir</button></div>`;
    el.innerHTML = `<div class="list-head drag-zone"><h2>${isNew ? 'Araç ekle' : 'Aracı düzenle'}</h2><small>${c ? 'Tüketim bu araca özel hesaplanır' : manual ? 'Katalog dışı araç: tipik değerler ya da kendi ortalamanız' : 'Aracını seç; tüketim, kütle ve motor bilgisi otomatik gelir'}</small></div>
      <div class="ve-form">
        ${carBox}
        ${c || manual ? `
        <label class="vf-f"><span>Araç adı</span><span class="vf-in"><input id="ve-name" maxlength="40" placeholder="ör. Egea, İş aracı" value="${esc(d.name)}"></span></label>
        ${manual ? `<label class="vf-l">Araç tipi</label>${seg('body', Object.entries(BODIES).map(([k, b]) => [k, b.label]), d.body)}
        <label class="vf-l">Yakıt</label>${seg('fuel', Object.keys(FUELS).filter(f => f in body.avg).map(f => [f, FUELS[f].label]), d.fuel)}` : ''}
        ${c && c.f === 'benzin' && c.p !== 'phev' ? `<label class="vf-tog"><input type="checkbox" id="ve-lpg" ${d.lpgConv ? 'checked' : ''}><span>Sonradan LPG taktırıldı <small>LPG ile kullanıyorum; litre ~%${nf0.format((LPG_CONV - 1) * 100)} artar, fiyat LPG'den</small></span></label>` : ''}
        <div class="vf-grid">
          <label class="vf-f"><span>${c ? 'Yol bilgisayarı ortalaması' : 'Ortalama tüketim'}</span><span class="vf-in"><input id="ve-avg" inputmode="decimal" placeholder="${c ? 'isteğe bağlı' : nf1.format(body.avg[d.fuel] || 0)}" value="${d.avg ? nf1.format(d.avg) : ''}"><em>${u}/100</em></span></label>
          <label class="vf-f"><span>${vehFuel(d) === 'elektrik' ? 'Batarya' : 'Depo hacmi'}</span><span class="vf-in"><input id="ve-tank" inputmode="decimal" placeholder="isteğe bağlı" value="${d.tank ? nf0.format(d.tank) : ''}"><em>${u}</em></span></label>
          <label class="vf-f"><span>${vehFuel(d) === 'elektrik' ? 'Şarj fiyatı' : 'Yakıt fiyatı'}</span><span class="vf-in"><input id="ve-price" inputmode="decimal" placeholder="${nf1.format(unitPrice({ ...d, price: null }).v || 0)}" value="${d.price ? nf1.format(d.price) : ''}"><em>₺/${u}</em></span></label>
          ${c?.p === 'phev' ? `<label class="vf-f"><span>Şarj fiyatı</span><span class="vf-in"><input id="ve-eprice" inputmode="decimal" placeholder="${nf1.format(EV_PRICE_DEFAULT)}" value="${d.elecPrice ? nf1.format(d.elecPrice) : ''}"><em>₺/kWh</em></span></label>` : ''}
        </div>
        <p class="vf-note">${c ? 'Yol bilgisayarı ortalamasını girerseniz hesap sürüşünüze göre düzeltilir; en doğrusu yakıt alımlarını girmektir.' : 'Tüketimi aracınızın yol bilgisayarından girin; boş bırakırsanız araç tipinin tipik değeri kullanılır.'} Fiyat boşsa ${esc(unitPrice({ ...d, price: null }).src)}.</p>
        <div class="ve-acts"><button class="btn primary" id="ve-save"><span class="ms">check</span>Kaydet</button><button class="btn outline" id="ve-cancel">Vazgeç</button>${!isNew ? '<button class="btn outline ve-del" id="ve-del"><span class="ms">delete</span>Sil</button>' : ''}</div>` : `<div class="ve-acts"><button class="btn outline" id="ve-cancel">Vazgeç</button></div>`}
      </div>`;
    hydrateImgs(el);
    const read = () => {
      if (!$('ve-name')) return;
      const nm = $('ve-name').value.trim(); if (nm !== d.name) { d.name = nm; d.autoName = false; }
      d.avg = parseNum($('ve-avg').value); d.tank = parseNum($('ve-tank').value); d.price = parseNum($('ve-price').value);
      d.elecPrice = $('ve-eprice') ? parseNum($('ve-eprice').value) : d.elecPrice;
      d.lpgConv = !!$('ve-lpg')?.checked;
      if (d.avg > 60) d.avg = null; if (d.price > 500) d.price = null; if (d.tank > 200) d.tank = null; if (d.elecPrice > 100) d.elecPrice = null;
    };
    $('ve-pick')?.addEventListener('click', () => { read(); openCatalogPicker(cc => { setCat(cc); }, { push: true }); });
    $('ve-manual')?.addEventListener('click', () => { manual = true; render(el); });
    $('ve-lpg')?.addEventListener('change', () => { read(); d.price = null; render(el); });
    el.querySelectorAll('[data-body]').forEach(b => { b.onclick = () => { read(); d.body = b.dataset.body; if (!(d.fuel in BODIES[d.body].avg)) d.fuel = 'benzin'; d.avg = null; render(el); }; });
    el.querySelectorAll('[data-fuel]').forEach(b => { b.onclick = () => { read(); if (d.fuel !== b.dataset.fuel) { d.fuel = b.dataset.fuel; d.avg = null; d.price = null; d.tank = null; } render(el); }; });
    $('ve-cancel').onclick = () => goBack();
    $('ve-save')?.addEventListener('click', () => {
      read(); if (!d.name) d.name = c ? `${c.md} ${c.y}` : `${BODIES[d.body].label} ${GARAGE.list.length + (isNew ? 1 : 0)}`;
      if (!c) d.cat = null;
      fixVeh(d);
      if (isNew) { GARAGE.list.push(d); VEH = d; } else { Object.assign(v, d); }
      PHYS_CACHE.delete(d.id); saveVeh(); clearCostCache(); goBack(); toast(isNew ? `${d.name} eklendi ve seçildi` : 'Araç kaydedildi');
      if (dir.routes.length) refreshDirResults();
    });
    $('ve-del')?.addEventListener('click', () => { if (deleteVehicle(v)) goBack(); });
  };
  render.mode = mode;
  openPanel(render, { mode, push: true, sheet: 'full' });
  // Yeni araçta doğrudan seçiciye geç
  if (isNew && pick) openCatalogPicker(cc => { setCat(cc); }, { push: true });
}

/* ----- Yakıt alımları: depo dolu → depo dolu ile gerçek ortalama ----- */
function openFills(v) {
  if (!v) return;
  const render = el => {
    const u = FUELS[vehFuel(v)].unit, fs = (v.fills || []).slice().sort((a, b) => b.odo - a.odo), st = fillStats(v), pers = personal(v);
    const last = fs[0], pred = refPer100(v, false);
    el.innerHTML = `<div class="list-head drag-zone"><h2>Yakıt alımları</h2><small>${esc(v.name)} · depoyu her doldurduğunuzda kilometre sayacını ve aldığınız miktarı girin</small></div>
      ${isPhev(v) ? '<p class="mini-note">Şarj edilebilir hibritte yakıt ve şarj birlikte kullanıldığı için yakıt alımından öğrenme yapılmaz; kayıtlar yalnızca listelenir.</p>' : ''}
      <div class="fl-card">${st ? `<div class="fl-big"><b>${nf1.format(st.per100)}</b><small>${u}/100 km gerçek ortalamanız</small></div>
        <div class="fl-sub">${st.n} dolum aralığı · ${fmtDist(st.km * 1000)} · model tahmini ${nf1.format(pred)} ${u}/100 · ${Math.abs(pers.f - 1) < 0.01 ? 'model sürüşünüzle uyumlu, düzeltme gerekmedi' : `hesaplara uygulanan düzeltme <b>${pers.f >= 1 ? '+' : '−'}%${nf0.format(Math.abs(Math.round((pers.f - 1) * 100)))}</b>`}</div>`
        : `<div class="fl-sub">Gerçek ortalamanın hesaplanması için en az iki kez <b>depoyu tamamen doldurmanız</b> ve aradaki kilometrenin 100 km'yi geçmesi gerekir. Ara dolumlar (depo dolmadan) da girilebilir; toplama eklenir.</div>`}</div>
      <div class="ve-form fl-form">
        <div class="vf-grid">
          <label class="vf-f"><span>Kilometre sayacı</span><span class="vf-in"><input id="fl-odo" inputmode="numeric" placeholder="${last ? nf0.format(last.odo + 400) : 'ör. 84.250'}"><em>km</em></span></label>
          <label class="vf-f"><span>Alınan ${vehFuel(v) === 'elektrik' ? 'enerji' : 'yakıt'}</span><span class="vf-in"><input id="fl-qty" inputmode="decimal" placeholder="ör. 38,5"><em>${u}</em></span></label>
          <label class="vf-f"><span>Ödenen (isteğe bağlı)</span><span class="vf-in"><input id="fl-tl" inputmode="decimal" placeholder="—"><em>₺</em></span></label>
          <label class="vf-tog sm"><input type="checkbox" id="fl-full" checked><span>Depoyu doldurdum</span></label>
        </div>
        <div class="ve-acts"><button class="btn primary" id="fl-add"><span class="ms">add</span>Ekle</button></div>
      </div>
      <div class="fl-list">${fs.map(f => `<div class="fl-it"><span class="ms">${f.full ? 'local_gas_station' : 'water_drop'}</span><span class="fl-m"><b>${nf0.format(f.odo)} km · ${nf1.format(f.qty)} ${u}</b><small>${new Date(f.t).toLocaleDateString('tr-TR', { day: 'numeric', month: 'short', year: 'numeric' })}${f.tl ? ` · ${fmtTL(f.tl)} (${nf2.format(f.tl / f.qty)} ₺/${u})` : ''}${f.full ? '' : ' · ara dolum'}</small></span><button class="icon-btn" data-del="${f.t}" aria-label="Sil"><span class="ms">close</span></button></div>`).join('')}</div>`;
    $('fl-add').onclick = () => {
      const odo = parseNum($('fl-odo').value.replace(/[.,\s]/g, '')), qty = parseNum($('fl-qty').value), tl = parseNum($('fl-tl').value), full = $('fl-full').checked;
      if (!odo || !qty) { toast('Kilometre ve miktarı girin'); return; }
      if (qty > 250) { toast('Miktar çok büyük görünüyor'); return; }
      if ((v.fills || []).some(f => f.odo === odo)) { toast('Bu kilometrede kayıt zaten var'); return; }
      v.fills = [...(v.fills || []), { t: Date.now(), odo, qty, tl: tl || null, full }];
      // Pompa fiyatı girildiyse ve araç fiyatı boşsa bilgi olarak göster (otomatik değiştirmez)
      PHYS_CACHE.delete(v.id); saveVeh(); clearCostCache(); render(el);
      toast(fillStats(v) ? 'Kaydedildi, hesaplar güncellendi' : 'Kaydedildi');
    };
    el.querySelectorAll('[data-del]').forEach(b => { b.onclick = () => { v.fills = v.fills.filter(f => String(f.t) !== b.dataset.del); saveVeh(); clearCostCache(); render(el); }; });
  };
  render.mode = 'list';
  openPanel(render, { mode: 'list', push: true, sheet: 'full' });
}
