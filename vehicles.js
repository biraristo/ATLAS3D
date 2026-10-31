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

/* ----- Katalog seçici: Marka → Model → Yıl → Motor ----- */
function openCatalogPicker(onPick, { push = true } = {}) {
  const st = { step: 'make', q: '', make: null, data: null, model: null, year: null, err: '' };
  const mode = panelModeNow();
  const render = el => {
    const head = (t, sub) => `<div class="list-head drag-zone cp-head"><button class="icon-btn" id="cp-back" aria-label="Geri"><span class="ms">arrow_back</span></button><div><h2>${t}</h2>${sub ? `<small>${sub}</small>` : ''}</div></div>`;
    const crumbs = [st.make, st.model?.n, st.year?.y].filter(Boolean).map(esc).join(' · ');
    const search = ph => `<div class="cp-search"><span class="ms">search</span><input id="cp-q" placeholder="${ph}" value="${esc(st.q)}" autocomplete="off" enterkeyhint="search"></div>`;
    let html = '';
    if (st.err) html = head('Aracını seç') + `<div class="empty">${esc(st.err)}<br><button class="btn outline" id="cp-retry">Tekrar dene</button></div>`;
    else if (st.step === 'make') {
      if (!VCAT.index || VCAT.index instanceof Promise) {
        html = head('Aracını seç', 'Marka') + '<div class="loading"><div class="spinner"></div>Markalar yükleniyor…</div>';
        catIndex().then(d => { VCAT.index = d; render(el); }).catch(e => { st.err = e.message; render(el); });
      } else {
        const q = trLower(st.q), all = VCAT.index.makes;
        const match = all.filter(m => !q || trLower(m.n).includes(q));
        const top = q ? [] : TR_TOP.map(n => all.find(m => m.n === n)).filter(Boolean);
        const row = m => `<button class="cp-it" data-make="${esc(m.f)}" data-n="${esc(m.n)}"><span class="cp-m"><b>${esc(m.n)}</b><small>${m.models} model</small></span><span class="ms">chevron_right</span></button>`;
        html = head('Aracını seç', '1/4 · Marka') + search('Marka ara (ör. Fiat, Togg)') +
          (top.length ? `<div class="cp-sec">Türkiye'de yaygın</div><div class="cp-grid">${top.map(m => `<button class="cp-chip" data-make="${esc(m.f)}" data-n="${esc(m.n)}">${esc(m.n)}</button>`).join('')}</div><div class="cp-sec">Tüm markalar</div>` : '') +
          `<div class="cp-list">${match.map(row).join('') || '<div class="empty">Marka bulunamadı</div>'}</div>` +
          `<div class="cp-foot"><button class="btn outline" id="cp-manual"><span class="ms">tune</span>Aracım listede yok, elle gireceğim</button>
           <p class="mini-note">Liste, Avrupa'da 2010–2025 arasında satılan binek araçların resmî tip onayı verisinden (AB Çevre Ajansı) oluşturulur. Türkiye'ye özgü bazı adlar eşdeğeriyle eşleştirilmiştir (ör. Egea = Tipo, Taliant = Logan).</p></div>`;
      }
    } else if (st.step === 'model') {
      if (!st.data) html = head(esc(st.make), '2/4 · Model') + '<div class="loading"><div class="spinner"></div>Modeller yükleniyor…</div>';
      else {
        const q = trLower(st.q), ms = st.data.models.filter(m => !q || trLower(m.n).includes(q));
        html = head(esc(st.make), '2/4 · Model') + search('Model ara') + `<div class="cp-list">${ms.map((m, i) => {
          const ys = m.years.map(y => y.y), span = ys.length > 1 ? `${Math.min(...ys)}–${Math.max(...ys)}` : ys[0];
          return `<button class="cp-it" data-model="${st.data.models.indexOf(m)}"><span class="cp-m"><b>${esc(m.n)}</b><small>${BODY_TR[m.body] || ''} · ${span}${m.eq ? ' · ' + esc(m.eq) : ''}</small></span><span class="ms">chevron_right</span></button>`;
        }).join('') || '<div class="empty">Model bulunamadı</div>'}</div>`;
      }
    } else if (st.step === 'year') {
      html = head(esc(`${st.make} ${st.model.n}`), '3/4 · Model yılı') + `<div class="cp-grid yrs">${st.model.years.map((y, i) => `<button class="cp-chip" data-year="${i}">${y.y}</button>`).join('')}</div>
        <p class="mini-note">Aracın ilk tescil (trafiğe çıkış) yılını seçin. Listede yoksa en yakın yılı seçebilirsiniz; aynı kasadaki motorlar genelde birkaç yıl aynı kalır.</p>`;
    } else if (st.step === 'engine') {
      const vs = st.year.v;
      html = head(esc(crumbs), '4/4 · Motor') + `<div class="cp-list">${vs.map((v, i) => {
        const c = { mk: st.make, md: st.model.n, y: st.year.y, body: st.model.body, ...v };
        const real = catRealEstimate(c), u = fuelUnit(v);
        const off = v.c ? `Resmî ${nf1.format(v.c)} ${u}/100 (${basisLabel(v.b)})` : v.p === 'phev' ? `Elektrikli menzil ~${v.er ? nf0.format(v.er) + ' km' : '?'}` : '';
        return `<button class="cp-it eng" data-eng="${i}"><span class="cp-m"><b>${esc(catEngine(c))}</b>
          <small>${off}${real ? ` · gerçekte ≈ <b>${nf1.format(real)} ${v.p === 'phev' ? 'L' : u}</b>${v.p === 'phev' ? ' (batarya boşken)' : ''}` : ''}</small>
          <small>${nf0.format(v.m)} kg${v.r >= 0.25 ? ' · en yaygın' : ''}</small></span><span class="ms">add_circle</span></button>`;
      }).join('')}</div>
        <p class="mini-note">Aynı motorun güç ya da kütle farkı olan sürümleri ayrı listelenir. "Gerçekte" değeri; şehir içi, şehirlerarası ve otoyol karışık sürüşte bu araç için fizik modelinin tahminidir. Yakıt alımlarınızı girdikçe size göre düzelir.</p>`;
    }
    el.innerHTML = html;
    const qi = el.querySelector('#cp-q');
    if (qi) { qi.oninput = () => { st.q = qi.value; const pos = qi.selectionStart; render(el); const n = el.querySelector('#cp-q'); n.focus(); n.setSelectionRange(pos, pos); }; }
    const top = () => { $('panel-body').scrollTop = 0; };
    el.querySelector('#cp-back')?.addEventListener('click', () => {
      if (st.step === 'make' || st.err) { goBack(); return; }
      st.q = ''; st.step = { model: 'make', year: 'model', engine: st.model.years.length === 1 ? 'model' : 'year' }[st.step]; if (st.step === 'make') st.data = null; render(el); top();
    });
    el.querySelector('#cp-retry')?.addEventListener('click', () => { st.err = ''; render(el); });
    el.querySelector('#cp-manual')?.addEventListener('click', () => { onPick(null); goBack(); setSheet('full'); });
    el.querySelectorAll('[data-make]').forEach(b => { b.onclick = () => {
      st.make = b.dataset.n; st.step = 'model'; st.q = ''; st.data = null; render(el); top();
      catMake(b.dataset.make).then(d => { if (st.make !== d.make) return; st.data = d; render(el); }).catch(e => { st.err = e.message; render(el); });
    }; });
    el.querySelectorAll('[data-model]').forEach(b => { b.onclick = () => { st.model = st.data.models[+b.dataset.model]; st.q = ''; st.step = 'year'; if (st.model.years.length === 1) { st.year = st.model.years[0]; st.step = 'engine'; } render(el); top(); }; });
    el.querySelectorAll('[data-year]').forEach(b => { b.onclick = () => { st.year = st.model.years[+b.dataset.year]; st.step = 'engine'; render(el); top(); }; });
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
          <span class="ms gv-i">${BODIES[v.body].icon}</span>
          <div class="gv-m"><b>${esc(v.name)}${v === VEH ? '<em>Seçili</em>' : ''}</b>
            <small>${esc(v.cat ? `${v.cat.mk} ${v.cat.md} ${v.cat.y} · ${catEngine(v.cat)}${v.lpgConv ? ' · LPG' : ''}` : `${BODIES[v.body].label} · ${FUELS[v.fuel].label} · katalog dışı`)}</small>
            <small>Tipik ${nf1.format(vehAvg(v))} ${u}/100 km · 100 km ≈ <b>${fmtTL(per100Cost(v))}</b>${v.tank ? ` · depoyla ~${nf0.format(v.tank / vehAvg(v) * 100)} km` : ''}</small>
            ${pers.n ? `<small class="gv-learn"><span class="ms">insights</span>${pers.n} yakıt alımından öğrenildi · gerçek ${nf1.format(fillStats(v).per100)} ${u}/100</small>` : ''}</div>
          <div class="gv-a">${v === VEH ? '' : `<button class="btn outline sm" data-sel="${v.id}">Seç</button>`}<button class="icon-btn" data-fill="${v.id}" aria-label="Yakıt aldım" title="Yakıt aldım"><span class="ms">local_gas_station</span></button><button class="icon-btn" data-edit="${v.id}" aria-label="Düzenle"><span class="ms">edit</span></button></div>
        </div>`;
      }).join('')}</div>
      <div class="gv-add"><button class="btn primary" id="gv-add"><span class="ms">add</span>Araç ekle</button></div>
      <p class="mini-note">Aracınızı marka, model, yıl ve motoruyla seçerseniz tüketim o araca özel hesaplanır. Yakıt aldığınızda kilometre ve litreyi girerseniz hesap sizin sürüşünüze göre düzelir. Bilgiler yalnızca bu cihazda saklanır.</p>`;
    el.querySelectorAll('[data-sel]').forEach(b => { b.onclick = () => { setActiveVehicle(b.dataset.sel); render(el); toast(`${VEH.name} seçildi`); }; });
    el.querySelectorAll('[data-edit]').forEach(b => { b.onclick = () => editVehicle(GARAGE.list.find(v => v.id === b.dataset.edit)); });
    el.querySelectorAll('[data-fill]').forEach(b => { b.onclick = () => openFills(GARAGE.list.find(v => v.id === b.dataset.fill)); });
    el.querySelectorAll('.gv').forEach(c => { c.onclick = e => { if (!e.target.closest('button')) { setActiveVehicle(c.dataset.id); render(el); } }; });
    $('gv-add').onclick = () => editVehicle(null);
  };
  render.mode = 'list';
  openPanel(render, { mode: 'list', push, sheet: 'full' });
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
    const carBox = c ? `<div class="ve-car"><span class="ms">${BODIES[d.body].icon}</span><div><b>${esc(`${c.mk} ${c.md} ${c.y}`)}</b><small>${esc(catEngine(c))} · ${nf0.format(c.m)} kg</small>
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
        <div class="ve-acts"><button class="btn primary" id="ve-save"><span class="ms">check</span>Kaydet</button><button class="btn outline" id="ve-cancel">Vazgeç</button>${!isNew && GARAGE.list.length > 1 ? '<button class="icon-btn ve-del" id="ve-del" aria-label="Aracı sil"><span class="ms">delete</span></button>' : ''}</div>` : `<div class="ve-acts"><button class="btn outline" id="ve-cancel">Vazgeç</button></div>`}
      </div>`;
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
    $('ve-del')?.addEventListener('click', () => {
      if (!confirm(`${v.name} silinsin mi?`)) return;
      GARAGE.list.splice(GARAGE.list.indexOf(v), 1); if (VEH === v) VEH = GARAGE.list[0];
      saveVeh(); clearCostCache(); goBack();
    });
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
      const odo = parseNum($('fl-odo').value.replace(/\./g, '')), qty = parseNum($('fl-qty').value), tl = parseNum($('fl-tl').value), full = $('fl-full').checked;
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
