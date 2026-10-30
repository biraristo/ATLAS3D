// ATLAS3D — Rota analizi ekranı
// Yakınlaştırılabilir profil, eğim dağılımı, tırmanış/iniş listeleri, en dik kesitler,
// rakım bölgeleri, rota karşılaştırma, navigasyonda kalan yol ve GPX dışa aktarma.
'use strict';

/* ================= Hesaplar ================= */
const AN_BANDS = [
  { max: -8, label: 'Dik iniş', range: '−%8 ve altı', color: '#1e40af' },
  { max: -3, label: 'İniş', range: '−%8 … −%3', color: '#60a5fa' },
  { max: 3, label: 'Düz', range: '−%3 … +%3', color: '#22c55e' },
  { max: 6, label: 'Hafif tırmanış', range: '+%3 … +%6', color: '#facc15' },
  { max: 10, label: 'Dik tırmanış', range: '+%6 … +%10', color: '#f97316' },
  { max: Infinity, label: 'Çok dik tırmanış', range: '+%10 ve üstü', color: '#dc2626' }
];
const AN_ZONES = [
  { max: 500, label: '500 m altı', color: '#86efac' },
  { max: 1000, label: '500–1.000 m', color: '#bef264' },
  { max: 1500, label: '1.000–1.500 m', color: '#d6b26b' },
  { max: 2000, label: '1.500–2.000 m', color: '#a1785b' },
  { max: Infinity, label: '2.000 m üstü', color: '#e7e5e4' }
];
// Bisiklet dünyasında yaygın tırmanış ölçeği: uzunluk (m) × ortalama eğim (%)
const AN_CATS = [
  { min: 80000, label: 'KD', name: 'Kategori dışı', color: '#7e22ce' },
  { min: 64000, label: '1', name: '1. kategori', color: '#dc2626' },
  { min: 32000, label: '2', name: '2. kategori', color: '#ea580c' },
  { min: 16000, label: '3', name: '3. kategori', color: '#d97706' },
  { min: 8000, label: '4', name: '4. kategori', color: '#ca8a04' },
  { min: 0, label: '–', name: 'Kategorisiz', color: '#64748b' }
];
const anCat = score => AN_CATS.find(c => score >= c.min);
const anWord = g => { const a = Math.abs(g); return a < 4 ? 'hafif eğim' : a < 7 ? 'orta eğim' : a < 10 ? 'dik' : 'çok dik'; };

function anIdx(pr, d) { return Math.max(0, Math.min(pr.elevs.length - 1, Math.round(d / pr.step))); }

function analyzeProfile(pr, mode) {
  const e = pr.elevs, s = pr.slopes, n = e.length, step = pr.step, len = pr.len;
  // 1) Eğim dağılımı (km)
  const dist = AN_BANDS.map(b => ({ ...b, m: 0 }));
  for (let i = 0; i < n - 1; i++) dist.find(b => s[i] <= b.max).m += step;
  // 2) Rakım bölgeleri (km)
  const zones = AN_ZONES.map(z => ({ ...z, m: 0 }));
  for (let i = 0; i < n - 1; i++) zones.find(z => (e[i] + e[i + 1]) / 2 < z.max).m += step;
  // 3) Tırmanış ve inişler: histerezisli tepe–çukur taraması
  const H = len > 200000 ? 30 : len > 40000 ? 20 : 12;
  const piv = []; let trend = 0, lo = 0, hi = 0, cand = 0;
  for (let i = 0; i < n; i++) {
    if (trend === 0) {
      if (e[i] < e[lo]) lo = i; if (e[i] > e[hi]) hi = i;
      if (e[hi] - e[lo] >= H) { if (lo < hi) { piv.push(lo); trend = 1; cand = hi; } else { piv.push(hi); trend = -1; cand = lo; } }
    } else if (trend === 1) {
      if (e[i] >= e[cand]) cand = i; else if (e[cand] - e[i] >= H) { piv.push(cand); trend = -1; cand = i; }
    } else {
      if (e[i] <= e[cand]) cand = i; else if (e[i] - e[cand] >= H) { piv.push(cand); trend = 1; cand = i; }
    }
  }
  if (trend !== 0) piv.push(cand);
  const minGain = mode === 'car' ? 60 : 30, climbs = [], descents = [];
  for (let k = 0; k < piv.length - 1; k++) {
    const a = piv[k], b = piv[k + 1], dh = e[b] - e[a], L = (b - a) * step;
    if (L <= 0 || Math.abs(dh) < minGain) continue;
    const avg = dh / L * 100;
    if (Math.abs(avg) < 2) continue;
    const seg = s.slice(a, b + 1);
    const item = { i0: a, i1: b, from: a * step, to: b * step, len: L, dh, avg, max: dh > 0 ? Math.max(...seg) : Math.min(...seg), e0: e[a], e1: e[b], score: L * Math.abs(avg) };
    (dh > 0 ? climbs : descents).push(item);
  }
  climbs.forEach((c, i) => { c.n = i + 1; c.cat = anCat(c.score); });
  descents.forEach((c, i) => { c.n = i + 1; c.cat = anCat(c.score); c.brake = c.len >= 3000 && c.avg <= -5; });
  // 4) En dik kesitler: 1 km (rota yeterince uzunsa) ve ~100–200 m
  const w = Math.round(1000 / step), steep1k = { up: null, down: null };
  if (len >= 1500 && w >= 1) for (let i = 0; i + w < n; i++) {
    const g = (e[i + w] - e[i]) / (w * step) * 100;
    if (!steep1k.up || g > steep1k.up.g) steep1k.up = { g, from: i * step, to: (i + w) * step };
    if (!steep1k.down || g < steep1k.down.g) steep1k.down = { g, from: i * step, to: (i + w) * step };
  }
  const iMaxUp = s.indexOf(pr.maxUp), iMaxDown = s.indexOf(pr.maxDown);
  const iHi = e.indexOf(pr.max), iLo = e.indexOf(pr.min);
  // 5) Yolun karakteri: km başına ortalama iniş-çıkış
  const rough = (pr.ascent + pr.descent) / 2 / Math.max(0.1, len / 1000);
  const character = rough < 6 ? 'Düz' : rough < 15 ? 'Hafif engebeli' : rough < 30 ? 'Engebeli' : rough < 50 ? 'Dağlık' : 'Çok dağlık';
  return { dist, zones, climbs, descents, steep1k, iMaxUp, iMaxDown, iHi, iLo, rough, character };
}

/* ================= Ekran durumu ================= */
const AN = { open: false, r: null, pr: null, a: null, d0: 0, d1: 0, cursor: null, along: null, nav: false, showAllC: false, showAllD: false };

function openAnalysis(r, along = null) {
  if (!r?.profile) { toast('Yükseklik profili henüz hazır değil'); return; }
  Object.assign(AN, { open: true, r, pr: r.profile, a: analyzeProfile(r.profile, dir.mode), d0: 0, d1: r.profile.len, cursor: null, along: navActive ? along : null, nav: navActive, showAllC: false, showAllD: false });
  AN.prevFocus = document.activeElement;
  $('an-sub').textContent = `${dir.from?.name || 'Başlangıç'} → ${dir.to?.name || 'Hedef'} · ${MODES[dir.mode].label}`;
  $('analysis').hidden = false; body.classList.add('an-open');
  renderAnalysis(); // görünür olduktan sonra çiz: grafik genişliği doğru ölçülsün
  $('an-body').scrollTop = 0;
  $('an-sheet').focus({ preventScroll: true }); // ekran okuyucu ve klavye için odak panele
  try { history.pushState({ an: 1 }, ''); } catch {}
}
function closeAnalysis(fromPop = false) {
  if (!AN.open) return;
  AN.open = false; $('analysis').hidden = true; body.classList.remove('an-open'); profMarker?.remove();
  if (!fromPop && history.state?.an) { try { history.back(); } catch {} }
  AN.prevFocus?.focus?.();
}
addEventListener('popstate', () => { if (AN.open) closeAnalysis(true); });
$('an-close').onclick = () => closeAnalysis();
$('an-bg').onclick = () => closeAnalysis();
document.addEventListener('keydown', e => { if (e.key === 'Escape' && AN.open) closeAnalysis(); });
$('an-gpx').onclick = () => exportGpx(AN.r);
$('nav-terrain').onclick = () => { if (navRoute) openAnalysis(navRoute, navAlong); };
$('nav-terrain').setAttribute('role', 'button'); $('nav-terrain').tabIndex = 0;
$('nav-terrain').onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); $('nav-terrain').click(); } };

// Navigasyon sürerken analiz açıksa konumu canlı güncelle
let anTickAt = 0;
function analysisTick(along) {
  if (!AN.open || !AN.nav) return;
  AN.along = along;
  const now = Date.now(); if (now - anTickAt < 2000) return; anTickAt = now;
  drawChart(); const rem = $('an-rem'); if (rem) rem.outerHTML = remainingHtml();
}

/* ================= Bölümler ================= */
const km = m => fmtDist(m);
const mm = v => nf0.format(Math.round(v) || 0) + ' m';
const atKm = m => (m < 1000 ? nf0.format(Math.round(m)) + ' m' : nf1.format(m / 1000) + ' km');

function renderAnalysis() {
  const { r, pr, a } = AN;
  const net = pr.elevs[pr.elevs.length - 1] - pr.elevs[0];
  const tiles = [
    ['straighten', 'Mesafe', km(pr.len), ''],
    ['schedule', 'Süre', fmtDur(r.duration), pr.tAdj ? 'eğime göre ~' + fmtDur(pr.tAdj) : 'trafiksiz'],
    ['arrow_upward', 'Tırmanış', mm(pr.ascent), '', '#dc2626'],
    ['arrow_downward', 'İniş', mm(pr.descent), '', '#2563eb'],
    ['landscape', 'En yüksek', mm(pr.max), atKm(a.iHi * pr.step) + "'de"],
    ['water', 'En alçak', mm(pr.min), atKm(a.iLo * pr.step) + "'de"],
    [net > 0 ? 'trending_up' : net < 0 ? 'trending_down' : 'trending_flat', 'Net fark', (net > 0 ? '+' : net < 0 ? '−' : '') + mm(Math.abs(net)), 'varış − başlangıç'],
    ['terrain', 'Yolun karakteri', a.character, nf0.format(Math.round(a.rough)) + ' m/km iniş-çıkış']
  ];
  $('an-body').innerHTML = `
    <section class="an-sec full">
      <div class="an-tiles">${tiles.map(([ic, l, v, sub, c]) => `<div class="an-tile"><span class="ms" ${c ? `style="color:${c}"` : ''}>${ic}</span><small>${l}</small><b>${esc(v)}</b>${sub ? `<em>${esc(sub)}</em>` : ''}</div>`).join('')}</div>
    </section>
    ${AN.nav ? remainingHtml() : ''}
    <section class="an-sec full">
      <div class="an-h"><h3>Yükseklik profili</h3>
        <div class="an-tools">
          <button class="an-tool" id="an-zout" aria-label="Uzaklaştır"><span class="ms">zoom_out</span></button>
          <button class="an-tool" id="an-zin" aria-label="Yakınlaştır"><span class="ms">zoom_in</span></button>
          <button class="an-tool" id="an-fit" aria-label="Tüm rota"><span class="ms">fit_screen</span></button>
        </div>
      </div>
      <div class="an-range" id="an-range"></div>
      <div class="an-chart" id="an-chart"><div class="an-tip" id="an-tip" hidden></div></div>
      <div class="an-ov" id="an-ov" aria-label="Tüm rota: görünen aralığı kaydırmak için sürükleyin"></div>
      <p class="an-hint">${isMobile() ? 'Parmağını grafikte gezdir · iki parmakla yakınlaştır · alttaki şeridi sürükle' : 'Fareyle gez · tekerlekle yakınlaştır · sürükleyerek kaydır · çift tıkla sıfırla'}</p>
    </section>
    ${compareHtml()}
    <section class="an-sec">
      <div class="an-h"><h3>Eğim dağılımı</h3><small>yolun ne kadarı hangi eğimde</small></div>
      <div class="an-stack">${a.dist.filter(b => b.m > 0).map(b => `<i style="flex:${b.m};background:${b.color}" title="${b.label}"></i>`).join('')}</div>
      <div class="an-table">${a.dist.map(b => { const p = b.m / pr.len * 100; return `<div class="an-row"><span class="an-sw" style="background:${b.color}"></span><span class="an-l"><b>${b.label}</b><small>${b.range}</small></span><span class="an-bar"><i style="width:${Math.max(p, b.m ? 1 : 0).toFixed(1)}%;background:${b.color}"></i></span><span class="an-v"><b>${km(b.m)}</b><small>%${nf0.format(Math.round(p))}</small></span></div>`; }).join('')}</div>
    </section>
    <section class="an-sec">
      <div class="an-h"><h3>En dik kesitler</h3></div>
      <div class="an-steep">
        ${a.steep1k.up && a.steep1k.up.g > 0.5 ? steepCard('trending_up', 'En dik 1 km çıkış', a.steep1k.up.g, a.steep1k.up.from, a.steep1k.up.to) : ''}
        ${a.steep1k.down && a.steep1k.down.g < -0.5 ? steepCard('trending_down', 'En dik 1 km iniş', a.steep1k.down.g, a.steep1k.down.from, a.steep1k.down.to) : ''}
        ${steepCard('north_east', 'En dik nokta (çıkış)', pr.maxUp, Math.max(0, a.iMaxUp * pr.step - 100), Math.min(pr.len, a.iMaxUp * pr.step + 100))}
        ${steepCard('south_east', 'En dik nokta (iniş)', pr.maxDown, Math.max(0, a.iMaxDown * pr.step - 100), Math.min(pr.len, a.iMaxDown * pr.step + 100))}
      </div>
    </section>
    ${segListHtml('climbs')}
    ${segListHtml('descents')}
    <section class="an-sec">
      <div class="an-h"><h3>Rakım bölgeleri</h3><small>rotanın hangi yükseklikte geçtiği</small></div>
      <div class="an-stack">${a.zones.filter(z => z.m > 0).map(z => `<i style="flex:${z.m};background:${z.color}"></i>`).join('')}</div>
      <div class="an-table">${a.zones.filter(z => z.m > 0).map(z => { const p = z.m / pr.len * 100; return `<div class="an-row"><span class="an-sw" style="background:${z.color}"></span><span class="an-l"><b>${z.label}</b></span><span class="an-bar"><i style="width:${Math.max(p, 1).toFixed(1)}%;background:${z.color}"></i></span><span class="an-v"><b>${km(z.m)}</b><small>%${nf0.format(Math.round(p))}</small></span></div>`; }).join('')}</div>
      ${a.zones.slice(2).some(z => z.m > 0) ? `<div class="an-note"><span class="ms">ac_unit</span><span>Rotanın <b>${km(a.zones.slice(2).reduce((t, z) => t + z.m, 0))}</b>'si 1.000 m'nin üzerinde. Kışın bu kesimlerde kar ve buzlanma riskini hesaba katın.</span></div>` : ''}
    </section>
    <section class="an-sec an-last">
      <div class="an-actions">
        <button class="btn outline" id="an-gpx2"><span class="ms">download</span>GPX olarak indir</button>
        ${AN.nav ? '' : '<button class="btn outline" id="an-fly"><span class="ms">3d_rotation</span>3D önizle</button>'}
      </div>
      <p class="an-fine">Yükseklikler ~30 m çözünürlüklü arazi modelinden, ${km(pr.step)} aralıkla örneklenir.${pr.fixedSegs ? ` Tünel veya viyadük olduğu düşünülen ${pr.fixedSegs} kesimde arazi yerine düz geçiş varsayıldı.` : ''} Köprü ve tünellerde yol eğimi yine de farklı olabilir. Tırmanış kategorileri bisiklette yaygın uzunluk × eğim ölçeğine göredir.</p>
    </section>`;
  wireAnalysis();
  drawChart(); drawOverview();
}

function remainingHtml() {
  const { pr, a } = AN; if (AN.along == null) return '';
  const i = anIdx(pr, AN.along), remLen = Math.max(0, pr.len - AN.along);
  const up = pr.ascent - pr.cumUp[i], down = pr.descent - pr.cumDown[i];
  const cur = a.climbs.find(c => c.from <= AN.along && c.to > AN.along);
  const next = a.climbs.find(c => c.from > AN.along);
  const nextD = a.descents.find(c => c.to > AN.along);
  let line = '';
  if (cur) line = `<b>Şu an tırmanıştasın:</b> zirveye ${km(cur.to - AN.along)} ve ${mm(cur.e1 - pr.elevs[i])} kaldı (ortalama ${fmtPct1(cur.avg)}).`;
  else if (next) line = `<b>Sıradaki tırmanış ${km(next.from - AN.along)} sonra:</b> ${km(next.len)} boyunca +${mm(next.dh)}, ortalama ${fmtPct1(next.avg)}.`;
  else line = 'Önünde kayda değer bir tırmanış yok.';
  const brake = nextD && nextD.brake && nextD.from - AN.along < 30000 ? `<div class="an-note warn"><span class="ms">warning</span><span>${nextD.from > AN.along ? km(nextD.from - AN.along) + ' sonra' : 'Şu an'} ${km(nextD.len)} süren uzun bir iniş var (ortalama ${fmtPct1(nextD.avg)}). Düşük vites ve motor freni kullanın.</span></div>` : '';
  return `<section class="an-sec full an-rem" id="an-rem">
    <div class="an-h"><h3>Kalan yol</h3><small>${km(AN.along)} geride kaldı</small></div>
    <div class="an-tiles three">
      <div class="an-tile"><span class="ms">straighten</span><small>Kalan</small><b>${km(remLen)}</b></div>
      <div class="an-tile"><span class="ms" style="color:#dc2626">arrow_upward</span><small>Kalan tırmanış</small><b>${mm(up)}</b></div>
      <div class="an-tile"><span class="ms" style="color:#2563eb">arrow_downward</span><small>Kalan iniş</small><b>${mm(down)}</b></div>
    </div>
    <p class="an-line">${line}</p>${brake}
  </section>`;
}

function steepCard(icon, title, g, from, to) {
  return `<button class="an-sc" data-from="${from}" data-to="${to}"><span class="ms" style="color:${slopeColor(g)}">${icon}</span><span><small>${title}</small><b style="color:${slopeColor(g)}">${fmtPct1(g)}</b><em>${atKm(from)}–${atKm(to)}</em></span></button>`;
}

function compareHtml() {
  if (AN.nav || dir.routes.length < 2 || !dir.routes.every(x => x.profile)) return '';
  const rows = dir.routes.map((x, i) => {
    const xa = x === AN.r ? AN.a : analyzeProfile(x.profile, dir.mode);
    const steepKm = xa.dist[0].m + xa.dist[4].m + xa.dist[5].m;
    return { i, x, steepKm, up: x.profile.ascent, down: x.profile.descent, maxUp: x.profile.maxUp };
  });
  const best = k => Math.min(...rows.map(r => r[k]));
  const fastest = Math.min(...rows.map(r => r.x.duration));
  return `<section class="an-sec full">
    <div class="an-h"><h3>Rotaları karşılaştır</h3><small>seçmek için dokun</small></div>
    <div class="an-cmp" role="table">
      <div class="an-cmp-r an-cmp-h" role="row"><span role="columnheader">Rota</span><span role="columnheader">Süre</span><span role="columnheader">Tırmanış</span><span role="columnheader">Dik yol</span><span role="columnheader">En dik</span></div>
      ${rows.map(r => `<button class="an-cmp-r ${r.x === AN.r ? 'on' : ''}" data-i="${r.i}" role="row">
        <span role="cell"><b>${r.i + 1}</b> · ${km(r.x.total)}</span>
        <span role="cell" class="${r.x.duration === fastest ? 'best' : ''}">${fmtDur(r.x.duration)}</span>
        <span role="cell" class="${r.up === best('up') ? 'best' : ''}">${mm(r.up)}</span>
        <span role="cell" class="${r.steepKm === best('steepKm') ? 'best' : ''}">${km(r.steepKm)}</span>
        <span role="cell" class="${r.maxUp === best('maxUp') ? 'best' : ''}">${fmtSlope(r.maxUp)}</span>
      </button>`).join('')}
    </div>
    <p class="an-fine" style="margin-top:8px">Yeşil değer o sütunun en iyisi. "Dik yol": %6 üzeri çıkış ve %8 üzeri iniş toplamı.</p>
  </section>`;
}

function segListHtml(kind) {
  const { a } = AN, list = a[kind], up = kind === 'climbs';
  const all = up ? AN.showAllC : AN.showAllD;
  const sorted = [...list].sort((x, y) => y.score - x.score);
  const shown = all ? list : list.filter(x => sorted.indexOf(x) < 6);
  return `<section class="an-sec">
    <div class="an-h"><h3>${up ? 'Tırmanışlar' : 'İnişler'}</h3><small>${list.length ? list.length + (up ? ' tırmanış' : ' iniş') + (list.length > shown.length ? ' · en önemli ' + shown.length + ' tanesi' : '') : ''}</small></div>
    ${list.length ? `<div class="an-segs">${shown.map(c => `
      <div class="an-seg" data-kind="${kind}" data-n="${c.n}" tabindex="0" role="button" aria-label="${up ? 'Tırmanış' : 'İniş'} ${c.n}: grafikte göster">
        <span class="an-cat" style="background:${c.cat.color}" title="${c.cat.name}">${up ? c.cat.label : '<span class="ms">south_east</span>'}</span>
        <span class="an-seg-m">
          <b>${km(c.len)} · ${c.dh > 0 ? '+' : '−'}${mm(Math.abs(c.dh))} · ort. ${fmtPct1(c.avg)}</b>
          <small>${atKm(c.from)}'de başlar · ${mm(c.e0)} → ${mm(c.e1)} · en dik ${fmtSlope(c.max)} · ${anWord(c.avg)}${up && c.cat.label !== '–' ? ' · ' + c.cat.name : ''}</small>
          ${!up && c.brake && dir.mode === 'car' ? '<small class="warn">Uzun iniş: düşük vites ve motor freni önerilir</small>' : ''}
        </span>
        <button class="an-map" data-kind="${kind}" data-n="${c.n}" aria-label="Haritada göster"><span class="ms">map</span></button>
      </div>`).join('')}</div>
      ${list.length > shown.length || all && list.length > 6 ? `<button class="text-btn an-more" data-kind="${kind}">${all ? 'Daha az göster' : 'Tümünü göster (' + list.length + ')'}</button>` : ''}`
    : `<p class="an-empty">${up ? 'Bu rotada kayda değer bir tırmanış yok.' : 'Bu rotada kayda değer bir iniş yok.'}</p>`}
  </section>`;
}

function wireAnalysis() {
  $('an-zin').onclick = () => zoomBy(0.5);
  $('an-zout').onclick = () => zoomBy(2);
  $('an-fit').onclick = () => setRange(0, AN.pr.len);
  $('an-gpx2').onclick = () => exportGpx(AN.r);
  $('an-fly')?.addEventListener('click', () => { const r = AN.r; closeAnalysis(); setTimeout(() => flyover(r), 250); });
  const byN = (kind, n) => AN.a[kind].find(c => c.n === +n);
  $('an-body').querySelectorAll('.an-seg').forEach(el => {
    const go = () => { const c = byN(el.dataset.kind, el.dataset.n); focusRange(c.from, c.to); };
    el.onclick = e => { if (!e.target.closest('.an-map')) go(); };
    el.onkeydown = e => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); go(); } };
  });
  $('an-body').querySelectorAll('.an-map').forEach(b => { b.onclick = e => { e.stopPropagation(); const c = byN(b.dataset.kind, b.dataset.n); showOnMap(c.from, c.to); }; });
  $('an-body').querySelectorAll('.an-sc').forEach(b => { b.onclick = () => focusRange(+b.dataset.from, +b.dataset.to); });
  $('an-body').querySelectorAll('.an-more').forEach(b => { b.onclick = () => { if (b.dataset.kind === 'climbs') AN.showAllC = !AN.showAllC; else AN.showAllD = !AN.showAllD; const y = $('an-body').scrollTop; renderAnalysis(); $('an-body').scrollTop = y; }; });
  $('an-body').querySelectorAll('.an-cmp-r[data-i]').forEach(b => { b.onclick = () => { selectRoute(+b.dataset.i); const r = dir.routes[+b.dataset.i]; Object.assign(AN, { r, pr: r.profile, a: analyzeProfile(r.profile, dir.mode), d0: 0, d1: r.profile.len, cursor: null }); const y = $('an-body').scrollTop; renderAnalysis(); $('an-body').scrollTop = y; }; });
  wireChart();
}

function focusRange(from, to) {
  const pad = Math.max((to - from) * 0.35, 150);
  setRange(from - pad, to + pad);
  AN.cursor = (from + to) / 2; drawChart();
  $('an-chart').scrollIntoView({ behavior: 'smooth', block: 'center' });
}
function showOnMap(from, to) {
  const pr = AN.pr, a = profileAt(pr, from).pt, b = profileAt(pr, to).pt;
  closeAnalysis();
  if (isMobile() && !navActive) setSheet('min');
  if (navActive) navFollow = false;
  setTimeout(() => map.fitBounds([a, b], { padding: mapPadding(), pitch: 65, bearing: bearingOf(a, b) - 90, maxZoom: 16.5, duration: 1400 }), 200);
  if (navActive) toast('Konuma dönmek için sağ alttaki ortala düğmesine dokunun', 4000);
}

/* ================= Etkileşimli grafik ================= */
function setRange(d0, d1) {
  const L = AN.pr.len, minSpan = Math.min(L, Math.max(300, AN.pr.step * 12));
  let span = Math.max(minSpan, Math.min(L, d1 - d0)), c = (d0 + d1) / 2;
  d0 = Math.max(0, Math.min(L - span, c - span / 2)); AN.d0 = d0; AN.d1 = d0 + span;
  drawChart(); drawOverview();
}
function zoomBy(f, around) {
  const c = around ?? (AN.cursor != null && AN.cursor >= AN.d0 && AN.cursor <= AN.d1 ? AN.cursor : (AN.d0 + AN.d1) / 2);
  setRange(c - (c - AN.d0) * f, c + (AN.d1 - c) * f);
}
function niceStep(range, target) {
  const raw = range / Math.max(1, target), p = 10 ** Math.floor(Math.log10(raw)), r = raw / p;
  return (r < 1.5 ? 1 : r < 3 ? 2 : r < 7 ? 5 : 10) * p;
}
function chartGeom() {
  const el = $('an-chart'), W = Math.max(280, el.clientWidth), H = el.clientHeight || 230;
  return { W, H, L: 46, R: 10, T: 24, B: 24 };
}
function drawChart() {
  const el = $('an-chart'); if (!el || !AN.pr) return;
  const { pr, a } = AN, { W, H, L, R, T, B } = chartGeom(), w = W - L - R, h = H - T - B;
  const i0 = Math.max(0, Math.floor(AN.d0 / pr.step)), i1 = Math.min(pr.elevs.length - 1, Math.ceil(AN.d1 / pr.step));
  let emin = Infinity, emax = -Infinity;
  for (let i = i0; i <= i1; i++) { emin = Math.min(emin, pr.elevs[i]); emax = Math.max(emax, pr.elevs[i]); }
  const span0 = Math.max(30, emax - emin), ys = niceStep(span0, 4);
  const ymin = Math.max(emin >= -5 ? 0 : -Infinity, Math.floor((emin - span0 * 0.08) / ys) * ys), ymax = Math.ceil((emax + span0 * 0.12) / ys) * ys;
  const X = d => L + (d - AN.d0) / (AN.d1 - AN.d0) * w, Y = v => T + h - (v - ymin) / (ymax - ymin) * h;
  // Seyreltme: piksel başına en fazla iki nokta (tepe ve çukurlar korunur)
  const pts = [], per = Math.max(1, Math.floor((i1 - i0) / (w * 1.5)));
  for (let i = i0; i <= i1; i += per) {
    if (per === 1) { pts.push(i); continue; }
    let lo = i, hi = i; for (let k = i; k < Math.min(i1 + 1, i + per); k++) { if (pr.elevs[k] < pr.elevs[lo]) lo = k; if (pr.elevs[k] > pr.elevs[hi]) hi = k; }
    pts.push(...(lo < hi ? [lo, hi] : [hi, lo]));
  }
  if (pts[pts.length - 1] !== i1) pts.push(i1);
  const line = pts.map((i, k) => (k ? 'L' : 'M') + X(pr.dists[i]).toFixed(1) + ' ' + Y(pr.elevs[i]).toFixed(1)).join('');
  const area = line + `L${X(pr.dists[pts[pts.length - 1]]).toFixed(1)} ${T + h}L${X(pr.dists[pts[0]]).toFixed(1)} ${T + h}Z`;
  // Eğim renkleri: görünen aralıktaki kararlı bölümler (keskin geçişli)
  const stops = [];
  for (const run of pr.runs) {
    const s0 = pr.dists[run.i0], s1 = pr.dists[run.i1];
    if (s1 < AN.d0 || s0 > AN.d1) continue;
    const c = slopeColor(run.s), o0 = Math.max(0, (s0 - AN.d0) / (AN.d1 - AN.d0)), o1 = Math.min(1, (s1 - AN.d0) / (AN.d1 - AN.d0));
    stops.push(`<stop offset="${(o0 * 100).toFixed(3)}%" stop-color="${c}"/><stop offset="${(o1 * 100).toFixed(3)}%" stop-color="${c}"/>`);
  }
  // Izgaralar
  let grid = '';
  for (let v = ymin; v <= ymax + 0.01; v += ys) grid += `<line x1="${L}" x2="${L + w}" y1="${Y(v)}" y2="${Y(v)}" class="g"/><text x="${L - 6}" y="${Y(v) + 4}" text-anchor="end" class="ax">${nf0.format(v)}</text>`;
  const xs = niceStep(AN.d1 - AN.d0, Math.max(3, Math.round(w / 90)));
  for (let d = Math.ceil(AN.d0 / xs) * xs; d <= AN.d1 + 0.01; d += xs) { const xx = X(d), anchor = xx < L + 24 ? 'start' : xx > L + w - 24 ? 'end' : 'middle';
    grid += `<line x1="${xx}" x2="${xx}" y1="${T}" y2="${T + h}" class="g v"/><text x="${xx}" y="${H - 6}" text-anchor="${anchor}" class="ax">${xs >= 1000 ? nf0.format(d / 1000) + ' km' : atKm(d)}</text>`; }
  // Tırmanış işaretleri (üst şerit)
  let marks = '';
  for (const c of a.climbs) {
    if (c.to < AN.d0 || c.from > AN.d1) continue;
    const x0 = Math.max(L, X(c.from)), x1 = Math.min(L + w, X(c.to));
    marks += `<rect x="${x0}" y="6" width="${Math.max(2, x1 - x0)}" height="5" rx="2.5" fill="${c.cat.color}" opacity=".9"/>`;
    if (x1 - x0 > 26 && c.cat.label !== '–') marks += `<text x="${(x0 + x1) / 2}" y="20" text-anchor="middle" class="cl" fill="${c.cat.color}">${c.cat.label === 'KD' ? 'KD' : 'K' + c.cat.label}</text>`;
  }
  // En yüksek nokta
  const dHi = a.iHi * pr.step;
  if (dHi >= AN.d0 && dHi <= AN.d1) marks += `<path d="M${X(dHi) - 5} ${Y(pr.max) - 5} L${X(dHi)} ${Y(pr.max) - 13} L${X(dHi) + 5} ${Y(pr.max) - 5} Z" fill="#0f172a"/>`;
  // Navigasyon konumu ve geçilen kısım
  let navm = '';
  if (AN.along != null && AN.along > AN.d0) {
    const xa = Math.min(L + w, X(AN.along));
    navm += `<rect x="${L}" y="${T}" width="${xa - L}" height="${h}" fill="#ffffff" opacity=".55"/>`;
    if (AN.along <= AN.d1) { const p = profileAt(pr, AN.along); navm += `<line x1="${xa}" x2="${xa}" y1="${T}" y2="${T + h}" stroke="#1a73e8" stroke-width="2"/><circle cx="${xa}" cy="${Y(p.elev)}" r="6" fill="#1a73e8" stroke="#fff" stroke-width="2.5"/>`; }
  }
  // İmleç
  let cur = '';
  const tip = $('an-tip');
  if (AN.cursor != null && AN.cursor >= AN.d0 && AN.cursor <= AN.d1) {
    const p = profileAt(pr, AN.cursor), xc = X(AN.cursor), yc = Y(p.elev);
    cur = `<line x1="${xc}" x2="${xc}" y1="${T}" y2="${T + h}" stroke="#0f172a" stroke-width="1.5"/><circle cx="${xc}" cy="${yc}" r="5.5" fill="#fff" stroke="#0f172a" stroke-width="2.5"/>`;
    tip.hidden = false;
    tip.innerHTML = `<b>${nf0.format(Math.round(p.elev))} m</b><span style="color:${slopeColor(p.slope)}">${fmtSlope(p.slope)} ${p.slope > 2 ? 'tırmanış' : p.slope < -2 ? 'iniş' : 'düz'}</span><small>${atKm(AN.cursor)}</small>`;
    const tw = tip.offsetWidth || 120;
    tip.style.left = Math.max(4, Math.min(W - tw - 4, xc - tw / 2)) + 'px';
    if (!profMarker) profMarker = new maplibregl.Marker({ element: makeEl('<div class="prof-dot"></div>') });
    profMarker.setLngLat(p.pt).addTo(map);
  } else { tip.hidden = true; }
  const svg = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" role="img" aria-label="Yükseklik profili, ${atKm(AN.d0)} ile ${atKm(AN.d1)} arası">
    <defs><linearGradient id="an-g" gradientUnits="userSpaceOnUse" x1="${L}" x2="${L + w}" y1="0" y2="0">${stops.join('')}</linearGradient>
    <clipPath id="an-clip"><rect x="${L}" y="0" width="${w}" height="${H}"/></clipPath></defs>
    ${grid}<g clip-path="url(#an-clip)"><path d="${area}" fill="url(#an-g)" opacity=".38"/><path d="${line}" fill="none" stroke="url(#an-g)" stroke-width="2.6" stroke-linejoin="round"/>${navm}${cur}</g>${marks}</svg>`;
  const old = el.querySelector('svg'); if (old) old.outerHTML = svg; else el.insertAdjacentHTML('afterbegin', svg);
  $('an-range').textContent = AN.d0 <= 0 && AN.d1 >= pr.len ? `Tüm rota · ${km(pr.len)}` : `${atKm(AN.d0)} – ${atKm(AN.d1)} · ${km(AN.d1 - AN.d0)} görünüyor`;
}
function drawOverview() {
  const el = $('an-ov'); if (!el) return;
  const { pr } = AN, W = Math.max(280, el.clientWidth), H = 40, L = 46, R = 10, w = W - L - R;
  const step = Math.max(1, Math.floor(pr.elevs.length / w));
  const X = d => L + d / pr.len * w, Y = v => 4 + (1 - (v - pr.min) / Math.max(1, pr.max - pr.min)) * (H - 8);
  let d = ''; for (let i = 0; i < pr.elevs.length; i += step) d += (i ? 'L' : 'M') + X(pr.dists[i]).toFixed(1) + ' ' + Y(pr.elevs[i]).toFixed(1);
  const full = AN.d0 <= 0 && AN.d1 >= pr.len;
  el.innerHTML = `<svg width="${W}" height="${H}" viewBox="0 0 ${W} ${H}" aria-hidden="true">
    <path d="${d}L${L + w} ${H}L${L} ${H}Z" fill="#cbd5e1"/>
    ${full ? '' : `<rect x="${L}" y="0" width="${X(AN.d0) - L}" height="${H}" fill="#ffffff" opacity=".7"/><rect x="${X(AN.d1)}" y="0" width="${L + w - X(AN.d1)}" height="${H}" fill="#ffffff" opacity=".7"/><rect x="${X(AN.d0)}" y="1" width="${Math.max(4, X(AN.d1) - X(AN.d0))}" height="${H - 2}" rx="4" fill="none" stroke="#1a73e8" stroke-width="2"/>`}
    ${AN.along != null ? `<line x1="${X(AN.along)}" x2="${X(AN.along)}" y1="0" y2="${H}" stroke="#1a73e8" stroke-width="2"/>` : ''}
  </svg>`;
}
function wireChart() {
  const el = $('an-chart'), ov = $('an-ov');
  const dAt = clientX => { const r = el.getBoundingClientRect(), { W, L, R } = chartGeom(); const f = (clientX - r.left - L) / (W - L - R); return AN.d0 + Math.max(0, Math.min(1, f)) * (AN.d1 - AN.d0); };
  const ptrs = new Map(); let pinch = null, drag = null, lastTap = 0;
  el.addEventListener('pointerdown', e => {
    el.setPointerCapture(e.pointerId); ptrs.set(e.pointerId, e.clientX);
    if (ptrs.size === 2) { const [x1, x2] = [...ptrs.values()]; pinch = { dist: Math.abs(x1 - x2) || 1, d0: AN.d0, d1: AN.d1, c: dAt((x1 + x2) / 2) }; drag = null; }
    else if (e.pointerType === 'mouse') { drag = { x: e.clientX, d0: AN.d0, d1: AN.d1, moved: false }; }
    else { AN.cursor = dAt(e.clientX); drawChart(); }
    const now = Date.now(); if (e.pointerType !== 'mouse' && now - lastTap < 300 && ptrs.size === 1) setRange(0, AN.pr.len); lastTap = now;
  });
  el.addEventListener('pointermove', e => {
    if (ptrs.has(e.pointerId)) ptrs.set(e.pointerId, e.clientX);
    if (pinch && ptrs.size >= 2) {
      const [x1, x2] = [...ptrs.values()], f = pinch.dist / (Math.abs(x1 - x2) || 1);
      const span = (pinch.d1 - pinch.d0) * f, rel = (pinch.c - pinch.d0) / (pinch.d1 - pinch.d0);
      setRange(pinch.c - span * rel, pinch.c + span * (1 - rel)); return;
    }
    if (drag && e.buttons) {
      const r = el.getBoundingClientRect(), { W, L, R } = chartGeom(), dx = (e.clientX - drag.x) / (W - L - R) * (drag.d1 - drag.d0);
      if (Math.abs(e.clientX - drag.x) > 3) { drag.moved = true; el.classList.add('grabbing'); setRange(drag.d0 - dx, drag.d1 - dx); }
      return;
    }
    if (e.pointerType === 'mouse' || ptrs.has(e.pointerId)) { AN.cursor = dAt(e.clientX); drawChart(); }
  });
  const end = e => { ptrs.delete(e.pointerId); if (ptrs.size < 2) pinch = null; if (!ptrs.size) { drag = null; el.classList.remove('grabbing'); } };
  el.addEventListener('pointerup', end); el.addEventListener('pointercancel', end);
  el.addEventListener('pointerleave', e => { if (e.pointerType === 'mouse' && !drag) { AN.cursor = null; drawChart(); profMarker?.remove(); } });
  el.addEventListener('wheel', e => { e.preventDefault(); zoomBy(e.deltaY > 0 ? 1.25 : 0.8, dAt(e.clientX)); }, { passive: false });
  el.addEventListener('dblclick', () => setRange(0, AN.pr.len));
  // Genel bakış şeridi: sürükleyerek görünen aralığı taşı
  let ovDrag = false;
  const ovMove = e => {
    const r = ov.getBoundingClientRect(), L = 46, w = r.width - L - 10, f = Math.max(0, Math.min(1, (e.clientX - r.left - L) / w));
    const span = AN.d1 - AN.d0; if (span >= AN.pr.len) return;
    const c = f * AN.pr.len; setRange(c - span / 2, c + span / 2);
  };
  ov.addEventListener('pointerdown', e => { ov.setPointerCapture(e.pointerId); ovDrag = true; ovMove(e); });
  ov.addEventListener('pointermove', e => { if (ovDrag) ovMove(e); });
  ov.addEventListener('pointerup', () => { ovDrag = false; }); ov.addEventListener('pointercancel', () => { ovDrag = false; });
}
addEventListener('resize', debounce(() => { if (AN.open) { drawChart(); drawOverview(); } }, 150));

/* ================= GPX dışa aktarma (rakımlı) ================= */
async function exportGpx(r) {
  if (!r) return;
  const pr = r.profile, name = `${dir.from?.name || 'Başlangıç'} - ${dir.to?.name || 'Hedef'}`;
  const xmlEsc = s => String(s).replace(/[<>&"']/g, c => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', '"': '&quot;', "'": '&apos;' }[c]));
  const pts = r.coords.map((c, i) => {
    const ele = pr ? profileAt(pr, r.cum[i]).elev : null;
    return `<trkpt lat="${c[1].toFixed(6)}" lon="${c[0].toFixed(6)}">${ele != null ? `<ele>${ele.toFixed(1)}</ele>` : ''}</trkpt>`;
  }).join('\n');
  const gpx = `<?xml version="1.0" encoding="UTF-8"?>\n<gpx version="1.1" creator="ATLAS3D" xmlns="http://www.topografix.com/GPX/1/1">\n<metadata><name>${xmlEsc(name)}</name><time>${new Date().toISOString()}</time></metadata>\n<trk><name>${xmlEsc(name)}</name><type>${dir.mode}</type><trkseg>\n${pts}\n</trkseg></trk>\n</gpx>\n`;
  const fname = ('atlas3d-' + name).toLocaleLowerCase('tr').replace(/[^a-z0-9çğıöşü]+/gi, '-').replace(/^-|-$/g, '').slice(0, 60) + '.gpx';
  const file = new File([gpx], fname, { type: 'application/gpx+xml' });
  if (isMobile() && navigator.canShare?.({ files: [file] })) { try { await navigator.share({ files: [file], title: name }); return; } catch (e) { if (e.name === 'AbortError') return; } }
  const url = URL.createObjectURL(file), a = document.createElement('a');
  a.href = url; a.download = fname; document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 4000);
  toast('GPX dosyası indirildi');
}
