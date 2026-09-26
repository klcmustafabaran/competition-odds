// Kupon: seçimler, elle girilen iddaa oranları, otomatik kupon üretme ve paylaşım linki.
// Kupon ve iddaa oranları tarayıcıda (localStorage) saklanır.
(function () {
  const { esc, pct } = CO.util;
  const COUPON_KEY = 'co-coupon';
  const IDDAA_KEY = 'co-iddaa-odds';
  const SHARE_PREFIX = '#kupon=';
  const MAX_SELECTIONS = 20;
  const MAX_ATTEMPTS_PER_COUPON = 30;
  const VALUE_THRESHOLD = CO.model.VALUE_THRESHOLD;

  const SCOPES = {
    ms: { label: 'Maç sonucu (1/X/2)', test: (m) => m.group === 'ms' },
    au: { label: '2.5 Alt/Üst', test: (m) => m.group === 'au2.5' },
    kg: { label: 'Karşılıklı gol', test: (m) => m.group === 'kg' },
    all: { label: 'Tüm pazarlar', test: () => true },
  };
  const MODES = { best: 'En olası', value: 'Değerli', lotto: 'Loto gibi (rastgele)' };
  const METHODS = {
    form: { label: 'Son maçlar + aralarındaki maçlar', short: 'son maçlara göre' },
    model: { label: 'İstatistik modeli', short: 'modele göre' },
  };
  const METHOD_KEY = 'co-coupon-method';
  const LOTTO_COUNTS = [3, 5, 10];

  const dateFormat = new Intl.DateTimeFormat('tr-TR', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul',
  });

  function read(key, fallback) {
    try {
      return JSON.parse(localStorage.getItem(key)) ?? fallback;
    } catch {
      return fallback;
    }
  }

  function write(key, value) {
    try {
      localStorage.setItem(key, JSON.stringify(value));
    } catch {
      // Kaydedilemezse kupon sadece bu oturumda kalır.
    }
  }

  const saved = read(COUPON_KEY, {});
  const state = {
    selections: Array.isArray(saved.selections) ? saved.selections : [],
    stake: Number(saved.stake) > 0 ? Number(saved.stake) : 10,
    iddaa: read(IDDAA_KEY, {}),
    method: METHODS[read(METHOD_KEY, 'form')] ? read(METHOD_KEY, 'form') : 'form',
    mode: 'best',
    scope: 'ms',
    count: 5,
    generated: [],
    shared: null,
    shareLink: '',
    notice: '',
    open: false,
  };
  const listeners = [];

  const drawer = document.querySelector('#coupon');
  const fab = document.querySelector('#coupon-fab');

  const save = () => write(COUPON_KEY, { selections: state.selections, stake: state.stake });
  const notify = () => listeners.forEach((fn) => fn());
  const maxBy = (items, score) => items.reduce((best, x) => (score(x) > score(best) ? x : best));

  // ---------- iddaa oranları ----------
  const iddaaOdd = (fixtureId, key) => state.iddaa[fixtureId]?.[key] ?? null;

  function setIddaaOdd(fixtureId, key, value) {
    const odds = { ...(state.iddaa[fixtureId] ?? {}) };
    if (value) odds[key] = value;
    else delete odds[key];
    if (Object.keys(odds).length) state.iddaa[fixtureId] = odds;
    else delete state.iddaa[fixtureId];
    write(IDDAA_KEY, state.iddaa);
    render();
  }

  // ---------- hesaplar ----------
  const marketOf = (sel, key = sel.pickKey) => sel.markets.find((m) => m.key === key);

  // Seçili yönteme göre olasılık. Eski kayıtlarda son maç verisi yoksa model olasılığı kullanılır.
  const probOf = (market) => (state.method === 'form' && Number.isFinite(market?.formP) ? market.formP : market?.p ?? 0);

  // Paylaşılan kuponlar kendi içindeki oranları kullanır; kendi kuponunda iddaa oranı girildiyse o öncelikli.
  function oddOf(sel, key = sel.pickKey) {
    const bookOdd = marketOf(sel, key)?.odd ?? null;
    return sel.fromShare ? bookOdd : iddaaOdd(sel.fixtureId, key) ?? bookOdd;
  }

  function summarize(selections, pickFor = (s) => s.pickKey) {
    let p = 1;
    let odds = 1;
    let complete = true;
    for (const sel of selections) {
      const key = pickFor(sel);
      p *= probOf(marketOf(sel, key));
      const odd = oddOf(sel, key);
      if (odd) odds *= odd;
      else complete = false;
    }
    return { count: selections.length, p: selections.length ? p : 0, odds: complete && selections.length ? odds : null };
  }

  function formatProb(p) {
    const percent = p * 100;
    if (percent < 1) return `%${percent.toFixed(2)}`;
    return `%${percent.toFixed(percent < 10 ? 1 : 0)}`;
  }

  // ---------- seçimler ----------
  const has = (fixtureId, key) => state.selections.some((s) => s.fixtureId === fixtureId && s.pickKey === key);

  function changed() {
    state.generated = [];
    state.shareLink = '';
    save();
    render();
    notify();
  }

  // Aynı maçtan tek tercih olur: aynı tercihe tekrar basmak çıkarır, farklı tercih öncekinin yerine geçer.
  function toggle(match, key) {
    const index = state.selections.findIndex((s) => s.fixtureId === match.fixtureId);
    state.notice = '';
    if (index >= 0 && state.selections[index].pickKey === key) {
      state.selections.splice(index, 1);
    } else if (index >= 0) {
      state.selections[index] = { ...match, pickKey: key };
    } else if (state.selections.length >= MAX_SELECTIONS) {
      state.notice = `Kuponda en fazla ${MAX_SELECTIONS} maç olabilir.`;
      state.open = true;
      render();
      return;
    } else {
      state.selections.push({ ...match, pickKey: key });
      bumpFab();
    }
    changed();
  }

  function bumpFab() {
    fab.classList.remove('bump');
    void fab.offsetWidth;
    fab.classList.add('bump');
  }

  // ---------- otomatik kupon ----------
  function choosePick(sel) {
    const candidates = sel.markets.filter(SCOPES[state.scope].test);
    if (!candidates.length) return sel.pickKey;

    if (state.mode === 'value') {
      const priced = candidates.filter((m) => oddOf(sel, m.key));
      if (priced.length) return maxBy(priced, (m) => probOf(m) * oddOf(sel, m.key)).key;
    }
    if (state.mode === 'lotto') {
      // Olasılığa göre ağırlıklı rastgele: %60'lık tercih, %20'likten üç kat sık seçilir.
      const total = candidates.reduce((t, m) => t + probOf(m), 0);
      let r = Math.random() * total;
      for (const m of candidates) {
        r -= probOf(m);
        if (r <= 0) return m.key;
      }
      return candidates.at(-1).key;
    }
    return maxBy(candidates, probOf).key;
  }

  function generate() {
    if (!state.selections.length) return;
    const wanted = state.mode === 'lotto' ? state.count : 1;
    const seen = new Set();
    const coupons = [];
    for (let attempt = 0; coupons.length < wanted && attempt < wanted * MAX_ATTEMPTS_PER_COUPON; attempt++) {
      const picks = Object.fromEntries(state.selections.map((s) => [s.fixtureId, choosePick(s)]));
      const signature = JSON.stringify(picks);
      if (seen.has(signature)) continue;
      seen.add(signature);
      coupons.push({ picks, ...summarize(state.selections, (s) => picks[s.fixtureId]) });
    }
    coupons.sort((a, b) => b.p - a.p);
    state.generated = coupons;

    state.notice = '';
    if (state.mode === 'lotto' && coupons.length < wanted) {
      state.notice = `Bu maç ve pazar seçimiyle en fazla ${coupons.length} farklı kupon oluşturulabildi.`;
    }
    if (state.mode === 'value') {
      const scoped = state.selections.flatMap((s) => s.markets.filter(SCOPES[state.scope].test).map((m) => ({ s, m })));
      const priced = scoped.filter(({ s, m }) => oddOf(s, m.key));
      if (!priced.length) {
        state.notice = 'Oran olmadığı için değer hesaplanamadı, en olası tercihler seçildi. İddaa oranlarını girersen değer hesaplanır.';
      } else if (!priced.some(({ s, m }) => probOf(m) * oddOf(s, m.key) - 1 >= VALUE_THRESHOLD)) {
        state.notice = 'Modelin orandan belirgin şekilde yüksek gördüğü tercih yok; farkı en yüksek olanlar seçildi.';
      }
    }
    render();
  }

  function applyGenerated(index) {
    const coupon = state.generated[index];
    if (!coupon) return;
    state.selections = state.selections.map((s) => ({ ...s, pickKey: coupon.picks[s.fixtureId] ?? s.pickKey }));
    state.notice = 'Üretilen kupon uygulandı.';
    changed();
  }

  // ---------- paylaşım ----------
  function toBase64Url(text) {
    let binary = '';
    for (const byte of new TextEncoder().encode(text)) binary += String.fromCharCode(byte);
    return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
  }

  function fromBase64Url(code) {
    const base64 = code.replace(/-/g, '+').replace(/_/g, '/');
    const binary = atob(base64 + '='.repeat((4 - (base64.length % 4)) % 4));
    return new TextDecoder().decode(Uint8Array.from(binary, (c) => c.charCodeAt(0)));
  }

  function shareLink() {
    const payload = {
      v: 1,
      stake: state.stake,
      s: state.selections.map((sel) => ({
        f: sel.fixtureId,
        d: sel.date,
        l: sel.league,
        h: sel.home.name,
        a: sel.away.name,
        k: sel.pickKey,
        m: sel.markets.map((m) => [
          m.key,
          m.label,
          m.group,
          Math.round(m.p * 10000) / 10000,
          oddOf(sel, m.key),
          Number.isFinite(m.formP) ? Math.round(m.formP * 10000) / 10000 : null,
          m.formHits ?? null,
          m.formTrials ?? null,
        ]),
      })),
    };
    return `${location.origin}${location.pathname}${SHARE_PREFIX}${toBase64Url(JSON.stringify(payload))}`;
  }

  function parseShared(code) {
    const data = JSON.parse(fromBase64Url(code));
    if (data?.v !== 1 || !Array.isArray(data.s)) throw new Error('Geçersiz kupon');
    return {
      stake: Number(data.stake) > 0 ? Number(data.stake) : null,
      selections: data.s.slice(0, MAX_SELECTIONS).map((x) => ({
        fixtureId: x.f,
        date: x.d,
        league: String(x.l ?? ''),
        home: { name: String(x.h ?? '') },
        away: { name: String(x.a ?? '') },
        pickKey: String(x.k),
        fromShare: true,
        markets: (Array.isArray(x.m) ? x.m : []).map(([key, label, group, p, odd, formP, formHits, formTrials]) => ({
          key: String(key),
          label: String(label),
          group: String(group),
          p: Number(p) || 0,
          odd: Number(odd) > 1 ? Number(odd) : null,
          formP: formP === null || formP === undefined || !Number.isFinite(Number(formP)) ? null : Number(formP),
          formHits: Number.isInteger(formHits) ? formHits : null,
          formTrials: Number.isInteger(formTrials) ? formTrials : null,
        })),
      })),
    };
  }

  async function copyShareLink() {
    if (!state.selections.length) return;
    const link = shareLink();
    try {
      await navigator.clipboard.writeText(link);
      state.shareLink = '';
      state.notice = 'Paylaşım linki kopyalandı.';
    } catch {
      state.shareLink = link;
      state.notice = 'Link otomatik kopyalanamadı, aşağıdaki kutudan kopyalayabilirsin.';
    }
    render();
  }

  function importShared() {
    state.selections = state.shared.selections.map(({ fromShare, ...sel }) => sel);
    if (state.shared.stake) state.stake = state.shared.stake;
    state.shared = null;
    state.notice = 'Paylaşılan kupon kaydedildi.';
    changed();
  }

  // ---------- görünüm ----------
  function selectionItem(sel, readOnly) {
    const market = marketOf(sel);
    const odd = oddOf(sel);
    const isIddaa = !sel.fromShare && iddaaOdd(sel.fixtureId, sel.pickKey);
    const options = sel.markets
      .map((m) => `<option value="${esc(m.key)}"${m.key === sel.pickKey ? ' selected' : ''}>${esc(m.label)} · ${pct(probOf(m))}</option>`)
      .join('');
    const evidence =
      state.method === 'form' && market?.formTrials
        ? `<small class="c-evidence">Son maçlar + aralarındaki maçlar: <b>${market.formTrials} maçta ${market.formHits} kez</b> gerçekleşti</small>`
        : '';
    const date = sel.date && !Number.isNaN(new Date(sel.date).getTime()) ? dateFormat.format(new Date(sel.date)) : '';

    return `<li class="c-item">
      <div class="c-match">
        <span>${esc(sel.home.name)} – ${esc(sel.away.name)}</span>
        <small>${esc([date, sel.league].filter(Boolean).join(' · '))}</small>
      </div>
      <div class="c-pick">
        ${readOnly ? `<b>${esc(market?.label ?? '?')}</b>` : `<select data-c-pick="${esc(sel.fixtureId)}" aria-label="Tercih">${options}</select>`}
        <span class="c-p" title="Olasılık (${METHODS[state.method].short})">${market ? pct(probOf(market)) : '–'}</span>
        <span class="c-odd" title="${isIddaa ? 'İddaa oranı' : 'Oran'}">${odd ? odd.toFixed(2) : '–'}${isIddaa ? '<small>iddaa</small>' : ''}</span>
        ${readOnly ? '' : `<button type="button" class="c-remove" data-c-remove="${esc(sel.fixtureId)}" aria-label="Kupondan çıkar">×</button>`}
      </div>
      ${evidence}
    </li>`;
  }

  function summaryBlock(sum) {
    const ev = sum.odds ? sum.p * sum.odds - 1 : null;
    const oneIn = sum.p > 0 ? Math.round(1 / sum.p) : null;
    return `
      <div class="c-summary">
        <div><span>Maç</span><b>${sum.count}</b></div>
        <div><span>Toplam oran</span><b>${sum.odds ? sum.odds.toFixed(2) : '–'}</b></div>
        <div class="c-prob"><span>Tutma olasılığı (${METHODS[state.method].short})</span><b>${formatProb(sum.p)}</b></div>
        <div><span>Model beklentisi</span><b class="${ev === null ? '' : ev >= 0 ? 'win-text' : 'loss-text'}">${
          ev === null ? '–' : `${ev >= 0 ? '+' : ''}${Math.round(ev * 100)}%`
        }</b></div>
      </div>
      ${
        oneIn && sum.count > 1
          ? `<p class="c-odds-note">Bu hesaba göre kupon yaklaşık <b>${oneIn}</b> denemede 1 kez tutar.
             Kuponun tutması için her maçın tutması gerektiğinden olasılıklar çarpılır, maç eklendikçe düşer.</p>`
          : ''
      }`;
  }

  function methodSwitch() {
    return `
      <div class="c-method" role="group" aria-label="Olasılık yöntemi">
        ${Object.entries(METHODS)
          .map(
            ([key, method]) =>
              `<button type="button" data-c-method="${key}" class="${state.method === key ? 'on' : ''}" aria-pressed="${state.method === key}">${method.label}</button>`,
          )
          .join('')}
      </div>`;
  }

  const payoutText = (sum) => (sum.odds ? `${(state.stake * sum.odds).toLocaleString('tr-TR', { maximumFractionDigits: 2 })} ₺` : '–');

  function generatorBlock() {
    const option = (value, label, current) => `<option value="${value}"${value === current ? ' selected' : ''}>${label}</option>`;
    const shortName = (name) => (name.length > 12 ? `${name.slice(0, 11)}…` : name);
    const generated = state.generated.length
      ? `<ol class="c-generated">${state.generated
          .map(
            (g, i) => `<li>
              <div class="c-gen-picks">${state.selections
                .map((s) => `<span>${esc(shortName(s.home.name))}–${esc(shortName(s.away.name))}: <b>${esc(marketOf(s, g.picks[s.fixtureId])?.label ?? '?')}</b></span>`)
                .join('')}</div>
              <div class="c-gen-meta">
                <span>Oran <b>${g.odds ? g.odds.toFixed(2) : '–'}</b> · Olasılık <b>${formatProb(g.p)}</b></span>
                <button type="button" class="btn small" data-c-apply="${i}">Uygula</button>
              </div>
            </li>`,
          )
          .join('')}</ol>`
      : '';

    return `
      <section class="c-gen">
        <h3>Otomatik kupon üret</h3>
        <p class="note">Kupondaki maçlar için tercihleri modele göre seçer.
          <b>En olası</b>: en yüksek olasılık · <b>Değerli</b>: orana göre en avantajlı · <b>Loto gibi</b>: olasılığa göre rastgele.</p>
        <div class="c-gen-controls">
          <label>Yöntem<select data-c-mode>${Object.entries(MODES).map(([v, l]) => option(v, l, state.mode)).join('')}</select></label>
          <label>Pazar<select data-c-scope>${Object.entries(SCOPES).map(([v, s]) => option(v, s.label, state.scope)).join('')}</select></label>
          ${state.mode === 'lotto' ? `<label>Kupon sayısı<select data-c-count>${LOTTO_COUNTS.map((n) => option(String(n), String(n), String(state.count))).join('')}</select></label>` : ''}
        </div>
        <button type="button" class="btn primary" data-c-generate>Üret</button>
        ${generated}
      </section>`;
  }

  function render() {
    fab.querySelector('.count').textContent = state.selections.length;
    fab.setAttribute('aria-expanded', state.open);
    drawer.hidden = !state.open;
    if (!state.open) return;

    const sharedBlock = state.shared
      ? `<section class="c-shared">
          <p><b>Paylaşılan kupon</b> · ${state.shared.selections.length} maç</p>
          <ul class="c-list">${state.shared.selections.map((s) => selectionItem(s, true)).join('')}</ul>
          ${summaryBlock(summarize(state.shared.selections))}
          <div class="c-actions">
            <button type="button" class="btn primary" data-c-import>Kuponuma kaydet</button>
            <button type="button" class="btn" data-c-dismiss>Yok say</button>
          </div>
          <p class="note">Kaydedersen mevcut kuponunun yerine geçer.</p>
        </section>`
      : '';

    const sum = summarize(state.selections);
    const body = state.selections.length
      ? `${methodSwitch()}
         <ul class="c-list">${state.selections.map((s) => selectionItem(s, false)).join('')}</ul>
         ${summaryBlock(sum)}
         <div class="c-stake">
           <label>Tutar (₺)<input type="text" inputmode="decimal" data-c-stake value="${state.stake}"></label>
           <span>Olası kazanç <b data-c-payout>${payoutText(sum)}</b></span>
         </div>
         ${generatorBlock()}
         <div class="c-actions">
           <button type="button" class="btn" data-c-share>🔗 Paylaşım linki</button>
           <button type="button" class="btn danger" data-c-clear>Kuponu temizle</button>
         </div>
         ${state.shareLink ? `<input class="c-link" readonly value="${esc(state.shareLink)}" aria-label="Paylaşım linki">` : ''}`
      : `<p class="empty">Kupon boş. Bir maçın <b>Pazarlar ve oranlar</b> tablosundaki <b>+</b> düğmesiyle tercih ekle.</p>`;

    drawer.innerHTML = `
      <div class="c-head">
        <h2>🎫 Kuponum</h2>
        <button type="button" class="c-close" data-c-close aria-label="Kuponu kapat">×</button>
      </div>
      ${state.notice ? `<p class="c-notice">${esc(state.notice)}</p>` : ''}
      ${sharedBlock}
      ${body}
      <p class="note">Beklenti = tutma olasılığı × toplam oran − 1. Eksi ise model uzun vadede kaybettireceğini hesaplıyor.
        Paylaşım linki uygulamanın açık olduğu bilgisayarda çalışır. Tahminler kesinlik taşımaz, 18 yaş altı için değildir.</p>`;
  }

  function setOpen(open) {
    state.open = open;
    if (!open) state.notice = '';
    render();
    if (open) drawer.querySelector('.c-close')?.focus();
    else fab.focus();
  }

  // ---------- olaylar ----------
  fab.addEventListener('click', () => setOpen(!state.open));

  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && state.open) setOpen(false);
  });

  drawer.addEventListener('click', (e) => {
    const target = e.target.closest('button');
    if (!target) return;
    const { dataset } = target;

    if ('cClose' in dataset) setOpen(false);
    else if ('cMethod' in dataset) {
      state.method = dataset.cMethod;
      write(METHOD_KEY, state.method);
      state.generated = [];
      render();
    }
    else if ('cRemove' in dataset) {
      state.selections = state.selections.filter((s) => String(s.fixtureId) !== dataset.cRemove);
      state.notice = '';
      changed();
    } else if ('cGenerate' in dataset) generate();
    else if ('cApply' in dataset) applyGenerated(Number(dataset.cApply));
    else if ('cShare' in dataset) copyShareLink();
    else if ('cClear' in dataset) {
      if (window.confirm('Kupondaki tüm maçlar silinsin mi?')) {
        state.selections = [];
        state.notice = '';
        changed();
      }
    } else if ('cImport' in dataset) importShared();
    else if ('cDismiss' in dataset) {
      state.shared = null;
      render();
    }
  });

  drawer.addEventListener('change', (e) => {
    const { dataset, value } = e.target;
    if ('cPick' in dataset) {
      const sel = state.selections.find((s) => String(s.fixtureId) === dataset.cPick);
      if (sel) sel.pickKey = value;
      changed();
    } else if ('cMode' in dataset) {
      state.mode = value;
      state.generated = [];
      render();
    } else if ('cScope' in dataset) {
      state.scope = value;
      state.generated = [];
      render();
    } else if ('cCount' in dataset) {
      state.count = Number(value);
      state.generated = [];
      render();
    }
  });

  // Tutar yazılırken tüm panel yeniden çizilmez (imleç kaybolmasın diye).
  drawer.addEventListener('input', (e) => {
    if (!('cStake' in e.target.dataset)) return;
    const value = Number(e.target.value.replace(',', '.'));
    if (!(value > 0)) return;
    state.stake = value;
    save();
    const payout = drawer.querySelector('[data-c-payout]');
    if (payout) payout.textContent = payoutText(summarize(state.selections));
  });

  // ---------- başlangıç ----------
  if (location.hash.startsWith(SHARE_PREFIX)) {
    try {
      state.shared = parseShared(location.hash.slice(SHARE_PREFIX.length));
    } catch {
      state.notice = 'Paylaşım linki okunamadı.';
    }
    state.open = true;
    history.replaceState(null, '', location.pathname + location.search);
  }
  render();

  window.CO.coupon = {
    iddaaOdd,
    setIddaaOdd,
    has,
    toggle,
    onChange: (fn) => listeners.push(fn),
  };
})();
