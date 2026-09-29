// Kupon: seçimler, elle girilen iddaa oranları, otomatik kupon üretme ve paylaşım linki.
// Kupon ve iddaa oranları tarayıcıda (localStorage) saklanır.
(function () {
  const { esc, pct } = CO.util;
  const COUPON_KEY = 'co-coupon';
  const IDDAA_KEY = 'co-iddaa-odds';
  const HISTORY_KEY = 'co-coupon-history';
  const RESULTS_KEY = 'co-fixture-results';
  const MAX_HISTORY = 50;
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
    tab: 'coupon',
    history: read(HISTORY_KEY, []),
    results: read(RESULTS_KEY, {}), // fixtureId -> {home, away}
    checking: false,
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

  // ---------- karne ----------
  // Kaydedilen kuponlar maçlar bitince /api/result ile sonuçlanır; skorlar tarayıcıda saklanır.
  function saveToHistory() {
    if (!state.selections.length) return;
    const sum = summarize(state.selections);
    state.history.unshift({
      id: `k${Date.now()}`,
      savedAt: new Date().toISOString(),
      method: state.method,
      stake: state.stake,
      probability: sum.p,
      totalOdds: sum.odds,
      selections: state.selections.map((sel) => ({
        fixtureId: sel.fixtureId,
        date: sel.date,
        league: sel.league,
        home: sel.home.name,
        away: sel.away.name,
        pickKey: sel.pickKey,
        label: marketOf(sel)?.label ?? sel.pickKey,
        p: probOf(marketOf(sel)),
        odd: oddOf(sel),
      })),
    });
    state.history = state.history.slice(0, MAX_HISTORY);
    write(HISTORY_KEY, state.history);
    state.notice = 'Kupon karneye kaydedildi.';
    state.tab = 'history';
    render();
    checkResults();
  }

  const pendingFixtures = () => {
    const now = Date.now();
    const ids = new Set();
    for (const entry of state.history) {
      for (const sel of entry.selections) {
        // Maç saatinden ~2 saat sonra sonuç beklenir.
        if (!state.results[sel.fixtureId] && new Date(sel.date).getTime() + 2 * 3600_000 < now) ids.add(sel.fixtureId);
      }
    }
    return [...ids];
  };

  async function checkResults() {
    const ids = pendingFixtures();
    if (!ids.length || state.checking) return;
    state.checking = true;
    render();

    let found = 0;
    for (const id of ids) {
      try {
        const res = await fetch(`/api/result/${id}`);
        if (!res.ok) continue;
        const data = await res.json();
        if (data.played && data.result) {
          state.results[id] = data.result;
          found++;
        }
      } catch {
        // Ağ hatası: bir sonraki denemede tekrar bakılır.
      }
    }

    write(RESULTS_KEY, state.results);
    state.checking = false;
    state.notice = found ? `${found} maçın sonucu güncellendi.` : 'Sonuçlanan yeni maç yok.';
    render();
  }

  function evaluate(entry) {
    const picks = entry.selections.map((sel) => {
      const result = state.results[sel.fixtureId];
      return { ...sel, result, hit: result ? CO.model.marketHit(sel.pickKey, result) : null };
    });
    const status = picks.some((p) => p.hit === false) ? 'lost' : picks.every((p) => p.hit === true) ? 'won' : 'pending';
    return { picks, status };
  }

  function historyStats() {
    const stats = {
      total: state.history.length,
      won: 0,
      lost: 0,
      pending: 0,
      picks: 0,
      pickHits: 0,
      byMethod: { form: { picks: 0, hits: 0 }, model: { picks: 0, hits: 0 } },
    };
    for (const entry of state.history) {
      const { picks, status } = evaluate(entry);
      stats[status === 'won' ? 'won' : status === 'lost' ? 'lost' : 'pending']++;
      for (const pick of picks) {
        if (pick.hit === null) continue;
        stats.picks++;
        if (pick.hit) stats.pickHits++;
        const method = stats.byMethod[entry.method] ?? stats.byMethod.form;
        method.picks++;
        if (pick.hit) method.hits++;
      }
    }
    return stats;
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

  const STATUS_LABEL = { won: '✅ Tuttu', lost: '❌ Yattı', pending: '⏳ Bekliyor' };

  function historyView() {
    if (!state.history.length) {
      return `<p class="empty">Karne boş. Bir kupon hazırlayıp <b>Karneye kaydet</b> dersen maçlar bitince
        tutup tutmadığı burada otomatik görünür.</p>`;
    }

    const stats = historyStats();
    const rate = (hits, total) => (total ? `%${Math.round((hits / total) * 100)}` : '–');
    const methodLine = Object.entries(stats.byMethod)
      .filter(([, m]) => m.picks)
      .map(([key, m]) => `${METHODS[key].label}: ${rate(m.hits, m.picks)} (${m.hits}/${m.picks})`)
      .join(' · ');

    const entries = state.history
      .map((entry) => {
        const { picks, status } = evaluate(entry);
        const hits = picks.filter((p) => p.hit === true).length;
        const resolved = picks.filter((p) => p.hit !== null).length;
        return `<li class="k-entry ${status}">
          <div class="k-head">
            <span class="k-status">${STATUS_LABEL[status]}</span>
            <span class="muted">${esc(dateFormat.format(new Date(entry.savedAt)))} · ${entry.selections.length} maç
              · oran ${entry.totalOdds ? entry.totalOdds.toFixed(2) : '–'} · ${hits}/${resolved || '?'} tercih tuttu</span>
            <button type="button" class="c-remove" data-k-remove="${esc(entry.id)}" aria-label="Kuponu karneden sil">×</button>
          </div>
          <ul class="k-picks">${picks
            .map(
              (p) => `<li class="${p.hit === true ? 'hit' : p.hit === false ? 'miss' : 'wait'}">
                <span>${p.hit === true ? '✓' : p.hit === false ? '✗' : '⏳'}</span>
                <span class="k-match">${esc(p.home)} – ${esc(p.away)}</span>
                <b>${esc(p.label)}</b>
                <span class="muted">${p.result ? `${p.result.home}-${p.result.away}` : dateFormat.format(new Date(p.date))}</span>
              </li>`,
            )
            .join('')}</ul>
        </li>`;
      })
      .join('');

    return `
      <div class="c-summary k-summary">
        <div><span>Kupon</span><b>${stats.total}</b></div>
        <div><span>Tutan</span><b class="win-text">${stats.won}</b></div>
        <div><span>Yatan</span><b class="loss-text">${stats.lost}</b></div>
        <div class="c-prob"><span>Tercih isabeti</span><b>${rate(stats.pickHits, stats.picks)}</b></div>
      </div>
      ${methodLine ? `<p class="c-odds-note">Yönteme göre isabet — ${esc(methodLine)}</p>` : ''}
      ${stats.pending ? `<p class="note">${stats.pending} kupon hâlâ bekliyor.</p>` : ''}
      <div class="c-actions">
        <button type="button" class="btn" data-k-refresh ${state.checking ? 'disabled' : ''}>
          ${state.checking ? 'Kontrol ediliyor…' : '🔄 Sonuçları güncelle'}
        </button>
        <button type="button" class="btn danger" data-k-clear>Karneyi temizle</button>
      </div>
      <ul class="k-list">${entries}</ul>`;
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
           <button type="button" class="btn primary" data-k-save>🗒️ Karneye kaydet</button>
           <button type="button" class="btn" data-c-share>🔗 Paylaşım linki</button>
           <button type="button" class="btn danger" data-c-clear>Kuponu temizle</button>
         </div>
         ${state.shareLink ? `<input class="c-link" readonly value="${esc(state.shareLink)}" aria-label="Paylaşım linki">` : ''}`
      : `<p class="empty">Kupon boş. Bir maçın <b>Pazarlar ve oranlar</b> tablosundaki <b>+</b> düğmesiyle tercih ekle.</p>`;

    const pendingCount = state.history.filter((e) => evaluate(e).status === 'pending').length;
    const tabs = `
      <div class="c-tabs" role="tablist">
        <button type="button" data-c-tab="coupon" class="${state.tab === 'coupon' ? 'on' : ''}" aria-pressed="${state.tab === 'coupon'}">
          Kupon${state.selections.length ? ` (${state.selections.length})` : ''}
        </button>
        <button type="button" data-c-tab="history" class="${state.tab === 'history' ? 'on' : ''}" aria-pressed="${state.tab === 'history'}">
          Karne${state.history.length ? ` (${state.history.length}${pendingCount ? `, ${pendingCount} bekliyor` : ''})` : ''}
        </button>
      </div>`;

    drawer.innerHTML = `
      <div class="c-head">
        <h2>${state.tab === 'history' ? '🗒️ Karnem' : '🎫 Kuponum'}</h2>
        <button type="button" class="c-close" data-c-close aria-label="Kuponu kapat">×</button>
      </div>
      ${tabs}
      ${state.notice ? `<p class="c-notice">${esc(state.notice)}</p>` : ''}
      ${state.tab === 'history' ? historyView() : `${sharedBlock}${body}`}
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
    else if ('cTab' in dataset) {
      state.tab = dataset.cTab;
      state.notice = '';
      render();
      if (state.tab === 'history') checkResults();
    } else if ('kSave' in dataset) saveToHistory();
    else if ('kRefresh' in dataset) checkResults();
    else if ('kRemove' in dataset) {
      state.history = state.history.filter((entry) => entry.id !== dataset.kRemove);
      write(HISTORY_KEY, state.history);
      render();
    } else if ('kClear' in dataset) {
      if (window.confirm('Karnedeki tüm kuponlar silinsin mi?')) {
        state.history = [];
        write(HISTORY_KEY, state.history);
        state.notice = '';
        render();
      }
    } else if ('cMethod' in dataset) {
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
