(function () {
  const $ = (sel) => document.querySelector(sel);
  const input = $('#search');
  const suggestions = $('#suggestions');
  const favoritesBox = $('#favorites');
  const result = $('#result');

  // current: ekrandaki maçın kupon için gereken bilgileri (pazarlar, olasılıklar, oranlar)
  const state = { demo: false, teams: [], query: '', favorites: [], reportTeams: {}, current: null, report: null, viewStack: [] };

  // ---------- yardımcılar ----------
  const { esc, pct, logo } = CO.util;
  const normalize = (s) =>
    s.toLocaleLowerCase('tr').replace(/ı/g, 'i').normalize('NFD').replace(/[̀-ͯ]/g, '');

  const longDate = new Intl.DateTimeFormat('tr-TR', {
    weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit', timeZone: 'Europe/Istanbul',
  });
  const shortDate = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: 'short', timeZone: 'Europe/Istanbul' });
  const yearDate = new Intl.DateTimeFormat('tr-TR', { day: '2-digit', month: '2-digit', year: 'numeric', timeZone: 'Europe/Istanbul' });

  const RESULT_CLASS = { G: 'win', B: 'draw', M: 'loss' };

  function summarize(matches) {
    const n = matches.length;
    const counts = { G: 0, B: 0, M: 0 };
    matches.forEach((m) => counts[m.result]++);
    const avg = (key) => (n ? (matches.reduce((t, m) => t + m[key], 0) / n).toFixed(1) : '–');
    return { n, counts, goalsFor: avg('goalsFor'), goalsAgainst: avg('goalsAgainst') };
  }

  const formBadges = (matches) =>
    `<div class="form">${matches.map((m) => `<span class="res ${RESULT_CLASS[m.result]}">${m.result}</span>`).join('')}</div>`;

  async function getJson(url) {
    const res = await fetch(url);
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error || `Sunucu hatası (${res.status})`);
    return data;
  }

  // ---------- veri ----------
  async function detectMode() {
    try {
      if (location.protocol === 'file:') throw new Error('file');
      state.demo = (await getJson('/api/status')).demo;
    } catch {
      state.demo = true;
    }
    $('#demo-badge').hidden = !state.demo;
    $('#demo-hint').hidden = !state.demo;
  }

  async function fetchTeams(query) {
    if (state.demo) return CO.demo.teams.filter((t) => normalize(t.name).includes(normalize(query)));
    return getJson(`/api/teams?q=${encodeURIComponent(query)}`);
  }

  async function fetchReport(teamId) {
    if (state.demo) return CO.demo.buildReport(teamId);
    return getJson(`/api/match/${teamId}`);
  }

  // ---------- favoriler (tarayıcıda saklanır) ----------
  // Demo ve gerçek takım numaraları farklı olduğu için ayrı saklanır.
  const favoritesKey = () => `co-favorites-${state.demo ? 'demo' : 'live'}`;

  function loadFavorites() {
    try {
      const list = JSON.parse(localStorage.getItem(favoritesKey()));
      return Array.isArray(list) ? list : [];
    } catch {
      return [];
    }
  }

  function saveFavorites() {
    try {
      localStorage.setItem(favoritesKey(), JSON.stringify(state.favorites));
    } catch {
      // Gizli sekme gibi durumlarda kaydedilemez; favoriler bu oturumla sınırlı kalır.
    }
  }

  const isFavorite = (id) => state.favorites.some((f) => f.id === id);

  function setFavorites(list) {
    state.favorites = list;
    saveFavorites();
    renderFavorites();
    syncStars();
  }

  function toggleFavorite(team) {
    setFavorites(
      isFavorite(team.id)
        ? state.favorites.filter((f) => f.id !== team.id)
        : [...state.favorites, { id: team.id, name: team.name, logo: team.logo || '' }],
    );
  }

  function starAttributes(on) {
    return { text: on ? '★' : '☆', title: on ? 'Favorilerden çıkar' : 'Favorilere ekle' };
  }

  function favButton(team) {
    const on = isFavorite(team.id);
    const { text, title } = starAttributes(on);
    return `<button type="button" class="fav${on ? ' on' : ''}" data-fav-toggle="${team.id}" aria-pressed="${on}" title="${title}" aria-label="${esc(team.name)}: ${title}">${text}</button>`;
  }

  function syncStars() {
    document.querySelectorAll('[data-fav-toggle]').forEach((button) => {
      const on = isFavorite(Number(button.dataset.favToggle));
      const { text, title } = starAttributes(on);
      button.classList.toggle('on', on);
      button.setAttribute('aria-pressed', on);
      button.title = title;
      button.textContent = text;
    });
  }

  function renderFavorites() {
    favoritesBox.hidden = !state.favorites.length;
    favoritesBox.innerHTML =
      '<span class="muted small">★ Favoriler</span>' +
      state.favorites
        .map(
          (f) => `<span class="fav-chip">
            <button type="button" data-fav-open="${f.id}">${logo(f, 'sm')}${esc(f.name)}</button>
            <button type="button" class="remove" data-fav-remove="${f.id}" aria-label="${esc(f.name)} favorilerden çıkar">×</button>
          </span>`,
        )
        .join('');
  }

  // ---------- arama ----------
  let debounce;
  input.addEventListener('input', () => {
    clearTimeout(debounce);
    const query = input.value.trim();
    if (query.length < 3) {
      suggestions.hidden = true;
      return;
    }
    debounce = setTimeout(() => runSearch(query), 350);
  });

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' && state.teams.length && !suggestions.hidden) selectTeam(state.teams[0]);
    if (e.key === 'Escape') suggestions.hidden = true;
  });

  async function runSearch(query) {
    state.query = query;
    suggestions.innerHTML = '<li class="empty">Aranıyor…</li>';
    suggestions.hidden = false;
    try {
      const teams = await fetchTeams(query);
      if (query !== state.query) return;
      state.teams = teams;
      suggestions.innerHTML = teams.length
        ? teams
            .map(
              (t, i) => `<li><button type="button" data-index="${i}">${logo(t, 'sm')}
                <span><strong>${esc(t.name)}</strong><small>${esc([t.league, t.country].filter(Boolean).join(' · '))}</small></span>
              </button></li>`,
            )
            .join('')
        : '<li class="empty">Takım bulunamadı</li>';
    } catch (err) {
      if (query === state.query) suggestions.innerHTML = `<li class="empty error-text">${esc(err.message)}</li>`;
    }
  }

  suggestions.addEventListener('click', (e) => {
    const button = e.target.closest('button[data-index]');
    if (button) selectTeam(state.teams[Number(button.dataset.index)]);
  });

  document.addEventListener('click', (e) => {
    if (!e.target.closest('.search')) suggestions.hidden = true;

    const toggle = e.target.closest('[data-fav-toggle]');
    if (toggle) {
      const team = state.reportTeams[toggle.dataset.favToggle];
      if (team) toggleFavorite(team);
      return;
    }
    const open = e.target.closest('[data-fav-open]');
    if (open) {
      const team = state.favorites.find((f) => f.id === Number(open.dataset.favOpen));
      if (team) selectTeam(team);
      return;
    }
    const remove = e.target.closest('[data-fav-remove]');
    if (remove) {
      setFavorites(state.favorites.filter((f) => f.id !== Number(remove.dataset.favRemove)));
      return;
    }
    if (e.target.closest('[data-back]')) {
      const previous = state.viewStack.pop();
      if (previous) renderReport(previous);
      return;
    }
    const row = e.target.closest('[data-fixture]');
    if (row) openFixture(Number(row.dataset.fixture));
  });

  // Klavyeyle de açılabilsin
  document.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    const row = e.target.closest?.('[data-fixture]');
    if (!row) return;
    e.preventDefault();
    openFixture(Number(row.dataset.fixture));
  });

  async function selectTeam(team) {
    input.value = team.name;
    suggestions.hidden = true;
    state.viewStack = [];
    await showReport(() => fetchReport(team.id));
  }

  // Geçmiş maça tıklanınca önceki ekran yığına konur, "geri" ile oraya dönülür.
  async function openFixture(fixtureId) {
    if (state.demo) return;
    if (state.report) state.viewStack.push(state.report);
    await showReport(() => getJson(`/api/fixture/${fixtureId}`));
  }

  async function showReport(loader) {
    result.innerHTML = '<div class="card loading">Maç bilgileri yükleniyor…</div>';
    window.scrollTo({ top: 0, behavior: 'smooth' });
    try {
      renderReport(await loader());
    } catch (err) {
      result.innerHTML = `<div class="card error">${esc(err.message)}</div>`;
    }
  }

  // ---------- görünüm ----------
  function renderHead(report) {
    const { fixture, home, away, weather: w } = report;
    const middle = report.played
      ? `<div class="played-score"><b>${report.result.home}</b><span>-</span><b>${report.result.away}</b></div>`
      : '<div class="vs">VS</div>';
    const venue = [fixture.venue.name, fixture.venue.city].filter(Boolean).join(' · ') || 'Stat bilgisi yok';
    const weatherChip = w
      ? `<span class="chip">${w.icon} ${esc(w.description)} · ${Math.round(w.temperature)}°C · Yağış %${w.precipitationProbability} · Rüzgar ${Math.round(w.windSpeed)} km/s</span>`
      : '<span class="chip muted">Hava durumu maça 15 günden az kala görünür</span>';
    const side = (team, role, label) =>
      `<div class="side">${logo(team, 'xl')}
        <div class="name-row"><strong>${esc(team.name)}</strong>${favButton(team)}</div>
        <span class="role ${role}">${label}</span></div>`;

    return `
      <section class="card match-head">
        <p class="meta">${esc(fixture.league)} · ${esc(fixture.round)}</p>
        <p class="kickoff">${longDate.format(new Date(fixture.date))}</p>
        <div class="versus">
          ${side(home, 'home', 'Ev sahibi')}
          ${middle}
          ${side(away, 'away', 'Misafir')}
        </div>
        ${report.played ? `<p class="played-note">Bu maç oynandı. Aşağıdaki veriler <b>maç öncesindeki</b> duruma göre hesaplandı.</p>` : ''}
        <div class="chips"><span class="chip">🏟️ ${esc(venue)}</span>${weatherChip}</div>
      </section>`;
  }

  const ODDS_MESSAGES = {
    played: 'Maç oynandığı için oran bilgisi alınamıyor.',
    'no-key': 'Oran anahtarı (ODDS_API_KEY) eklenmediği için oranlar gösterilmiyor.',
    unsupported: 'Bu organizasyon için oran kaynağı yok.',
    'not-found': 'Bu maç için henüz oran açıklanmadı.',
  };
  const oddsMessage = (report) => ODDS_MESSAGES[report.oddsStatus] ?? 'Oranlar alınamadı.';

  // Oynanmış maçta tercihin tutup tutmadığı (geçmişe dönük analiz için).
  function marketHit(key, result) {
    const total = result.home + result.away;
    if (key === 'MS1') return result.home > result.away;
    if (key === 'MS2') return result.home < result.away;
    if (key === 'MSX') return result.home === result.away;
    if (key === 'KGV') return result.home > 0 && result.away > 0;
    if (key === 'KGY') return !(result.home > 0 && result.away > 0);
    const line = Number(key.slice(1));
    return key.startsWith('U') ? total > line : total < line;
  }

  // Fark: model olasılığı x oran - 1. İddaa oranı girildiyse o, yoksa bahis şirketi oranı kullanılır.
  const edgeOf = (p, odd) => (odd ? p * odd - 1 : null);
  const edgeText = (edge) => (edge === null ? '–' : `${edge > 0 ? '+' : ''}${Math.round(edge * 100)}%`);
  const isValue = (edge) => edge !== null && edge >= CO.model.VALUE_THRESHOLD;

  function pickButtonState(button, picked) {
    button.classList.toggle('on', picked);
    button.setAttribute('aria-pressed', picked);
    button.title = picked ? 'Kupondan çıkar' : 'Kupona ekle';
    button.textContent = picked ? '✓' : '+';
  }

  function syncPickButtons() {
    if (!state.current) return;
    document.querySelectorAll('[data-add-pick]').forEach((button) => {
      pickButtonState(button, CO.coupon.has(state.current.fixtureId, button.dataset.addPick));
    });
  }

  function updateMarketRow(row) {
    const market = state.current.markets.find((m) => m.key === row.dataset.market);
    const edge = edgeOf(market.p, CO.coupon.iddaaOdd(state.current.fixtureId, market.key) ?? market.odd);
    row.querySelector('.edge-cell').textContent = edgeText(edge);
    row.classList.toggle('value', isValue(edge));
  }

  function renderPrediction(report, prediction) {
    const { probs } = prediction;
    const segment = (cls, label, p) =>
      `<div class="seg ${cls}" style="flex-grow:${p}"><span>${label}</span><b>${pct(p)}</b></div>`;
    const fixtureId = report.fixture.id;

    const rows = state.current.markets
      .map((m) => {
        const iddaa = CO.coupon.iddaaOdd(fixtureId, m.key);
        const edge = edgeOf(m.p, iddaa ?? m.odd);
        const picked = CO.coupon.has(fixtureId, m.key);
        const hit = report.played ? marketHit(m.key, report.result) : null;
        return `<tr data-market="${m.key}" class="${isValue(edge) ? 'value' : ''}${hit ? ' hit' : ''}">
          ${report.played ? `<td class="hit-cell">${hit ? '✓' : '✗'}</td>` : ''}
          <td>${esc(m.label)}</td>
          <td>${pct(m.p)}</td>
          <td title="${m.formHits}/${m.formTrials} maçta gerçekleşti">${pct(m.formP)} <small class="muted">${m.formHits}/${m.formTrials}</small></td>
          <td>${m.odd ? m.odd.toFixed(2) : '–'}</td>
          <td><input class="odd-input" type="text" inputmode="decimal" data-iddaa="${m.key}" value="${iddaa ? iddaa.toFixed(2) : ''}" placeholder="–" aria-label="${esc(m.label)} iddaa oranı"></td>
          <td class="edge-cell">${edgeText(edge)}</td>
          <td><button type="button" class="add-pick${picked ? ' on' : ''}" data-add-pick="${m.key}" aria-pressed="${picked}" title="${picked ? 'Kupondan çıkar' : 'Kupona ekle'}">${picked ? '✓' : '+'}</button></td>
        </tr>`;
      })
      .join('');

    const table = `
      <div class="table-wrap"><table class="markets">
        <thead><tr>${report.played ? '<th><span class="sr-only">Tuttu mu</span></th>' : ''}<th>Pazar</th><th>Model</th><th>Son maçlar</th><th>Oran</th><th>İddaa</th><th>Fark</th><th><span class="sr-only">Kupon</span></th></tr></thead>
        <tbody>${rows}</tbody>
      </table></div>
      <p class="note">
        ${report.odds ? `Oran: ${esc(report.odds.bookmaker)}.` : esc(oddsMessage(report))}
        <b>Son maçlar</b>: iki takımın son 5 maçı ve aralarındaki maçlarda bu sonucun kaç kez gerçekleştiği.
        <b>İddaa</b> sütununa oranı kendin yazabilirsin, fark (model olasılığına göre) ona göre hesaplanır.
        Yeşil satır: model, oranın ima ettiğinden en az %5 yüksek olasılık görüyor. <b>+</b> ile kupona ekle.
      </p>`;

    return `
      <section class="card prediction">
        <h2>Tahmin modeli</h2>
        <div class="prob-bar">
          ${segment('home', '1', probs.home)}${segment('draw', 'X', probs.draw)}${segment('away', '2', probs.away)}
        </div>
        <div class="stats">
          <div><b>${prediction.lambdaHome.toFixed(2)}</b><span>Beklenen gol (ev)</span></div>
          <div><b>${prediction.lambdaAway.toFixed(2)}</b><span>Beklenen gol (misafir)</span></div>
          <div><b>${pct(prediction.btts)}</b><span>KG var</span></div>
        </div>
        <h3>En olası skorlar</h3>
        <div class="scores">${prediction.topScores.map((s) => `<span class="chip">${s.score} <b>${pct(s.p)}</b></span>`).join('')}</div>
        <h3>Pazarlar ve oranlar</h3>
        ${table}
      </section>`;
  }

  const SIDE_LABEL = { home: 'Ev sahibi lehine', away: 'Misafir lehine', neutral: 'Nötr' };

  function renderFactorBody(factor) {
    if (factor.single) {
      return `<div class="factor-single"><b>${esc(factor.single.main)}</b><small>${esc(factor.single.sub)}</small></div>`;
    }
    if (factor.values) {
      const cell = (v, cls) => `<div class="${cls}"><b>${esc(v.main)}</b><small>${esc(v.sub)}</small></div>`;
      return `<div class="factor-values">
        ${cell(factor.values.home, 'fv-home')}<span class="fv-vs">vs</span>${cell(factor.values.away, 'fv-away')}
      </div>`;
    }
    return factor.bars
      .map((bar) => {
        const max = Math.max(bar.home, bar.away) || 1;
        return `<div class="cmp">
          <span class="cmp-label">${esc(bar.label)}</span>
          <div class="cmp-row">
            <b class="home-text">${bar.home.toFixed(1)}</b>
            <div class="cmp-track left"><div class="cmp-fill home" style="width:${(bar.home / max) * 100}%"></div></div>
            <div class="cmp-track"><div class="cmp-fill away" style="width:${(bar.away / max) * 100}%"></div></div>
            <b class="away-text">${bar.away.toFixed(1)}</b>
          </div>
        </div>`;
      })
      .join('');
  }

  function renderAnalysis(report, analysis) {
    const { summary, tally, factors, highlights } = analysis;

    const verdict = `
      <div class="verdict side-${summary.side}">
        <div class="verdict-top">
          <span class="verdict-title">${esc(summary.title)}</span>
          <span class="verdict-pct">${summary.pct}</span>
          <span class="confidence ${summary.confidence.key}">Güven: ${summary.confidence.label}</span>
        </div>
        <p>${esc(summary.text)}</p>
      </div>`;

    const tug = `
      <div class="tug">
        <div class="tug-labels"><b class="home-text">${esc(report.home.name)}</b><b class="away-text">${esc(report.away.name)}</b></div>
        <div class="tug-bar">
          <div class="tug-seg home" style="flex-grow:${tally.home}"></div>
          <div class="tug-seg neutral" style="flex-grow:${tally.neutral}"></div>
          <div class="tug-seg away" style="flex-grow:${tally.away}"></div>
        </div>
        <p class="tug-caption">
          <span class="home-text">${tally.home} faktör ev sahibi lehine</span> ·
          <span class="away-text">${tally.away} misafir lehine</span> ·
          <span>${tally.neutral} nötr</span>
        </p>
      </div>`;

    const highlightBox = highlights.length
      ? `<div class="highlight">
          <div class="highlight-title">💡 Dikkat çeken</div>
          ${highlights
            .map((h) => `<p><b>${esc(h.label)}</b> <span class="edge">${h.edge}</span><br>${esc(h.text)}</p>`)
            .join('')}
        </div>`
      : `<div class="highlight quiet"><div class="highlight-title">💡 Oranlar</div><p>${
          analysis.oddsAvailable ? 'Model ile oranlar arasında belirgin bir fark yok.' : esc(oddsMessage(report))
        }</p></div>`;

    const cards = factors
      .map(
        (f) => `<div class="factor side-${f.side}">
          <div class="factor-head">
            <span class="factor-icon">${f.icon}</span>
            <span class="factor-title">${esc(f.title)}</span>
            <span class="factor-side">${SIDE_LABEL[f.side]}</span>
          </div>
          ${renderFactorBody(f)}
          ${f.detail ? `<p class="factor-detail">${esc(f.detail)}</p>` : ''}
        </div>`,
      )
      .join('');

    return `
      <section class="card analysis">
        <h2>Maç analizi</h2>
        ${verdict}
        ${tug}
        ${highlightBox}
        <div class="factors">${cards}</div>
        ${analysis.lowData ? '<p class="warning-text">⚠️ Veri az olduğu için tahminin güvenilirliği düşük.</p>' : ''}
        <p class="note">Bu değerlendirme geçmiş verilere dayalı istatistiksel bir tahmindir, kesin sonuç değildir.</p>
      </section>`;
  }

  function renderHeadToHead(report) {
    const list = report.headToHead ?? [];
    if (!list.length) {
      return `<section class="card"><h2>Aralarındaki son maçlar</h2>
        <p class="empty">Bu iki takımın aralarındaki maç bulunamadı. Veri kaynağı yalnızca kapsanan liglerin
        son birkaç sezonunu içeriyor; kupa maçları ve daha eski karşılaşmalar burada görünmez.</p></section>`;
    }

    let homeWins = 0;
    let awayWins = 0;
    let draws = 0;
    for (const f of list) {
      if (f.goals.home === f.goals.away) draws++;
      else if ((f.goals.home > f.goals.away ? f.home.id : f.away.id) === report.home.id) homeWins++;
      else awayWins++;
    }

    const rows = list
      .map((f) => {
        const homeWon = f.goals.home > f.goals.away;
        const awayWon = f.goals.away > f.goals.home;
        return `<li data-tip="${esc(f.league)} · ${esc(longDate.format(new Date(f.date)))}${f.id ? ' · analiz için tıkla' : ''}"
          ${f.id ? `data-fixture="${f.id}" role="button" tabindex="0" class="clickable"` : ''}>
          <span class="muted date">${yearDate.format(new Date(f.date))}</span>
          <span class="h2h-team${homeWon ? ' winner' : ''}">${esc(f.home.name)}</span>
          <span class="score">${f.goals.home}-${f.goals.away}</span>
          <span class="h2h-team right${awayWon ? ' winner' : ''}">${esc(f.away.name)}</span>
        </li>`;
      })
      .join('');

    return `
      <section class="card">
        <h2>Aralarındaki son maçlar</h2>
        <div class="stats">
          <div><b class="home-text">${homeWins}</b><span>${esc(report.home.name)} galibiyeti</span></div>
          <div><b>${draws}</b><span>Beraberlik</span></div>
          <div><b class="away-text">${awayWins}</b><span>${esc(report.away.name)} galibiyeti</span></div>
        </div>
        <ul class="h2h">${rows}</ul>
      </section>`;
  }

  function renderStandings(report) {
    const standings = report.standings;
    if (!standings) {
      return '<section class="card"><h2>Puan durumu</h2><p class="empty">Bu maç için puan durumu yok (kupa maçı olabilir).</p></section>';
    }

    const rows = standings.rows
      .map((r) => {
        const cls = r.team.id === report.home.id ? 'home-row' : r.team.id === report.away.id ? 'away-row' : '';
        return `<tr class="${cls}">
          <td>${r.rank}</td>
          <td class="team-cell">${logo(r.team, 'sm')}<span>${esc(r.team.name)}</span></td>
          <td>${r.played}</td><td>${r.win}</td><td>${r.draw}</td><td>${r.lose}</td>
          <td>${r.goalDiff > 0 ? '+' : ''}${r.goalDiff}</td><td><b>${r.points}</b></td>
        </tr>`;
      })
      .join('');

    return `
      <section class="card standings">
        <h2>Puan durumu <small class="muted">${esc(standings.league)}</small></h2>
        <div class="table-wrap"><table>
          <thead><tr><th>#</th><th>Takım</th><th>O</th><th>G</th><th>B</th><th>M</th><th>Av</th><th>P</th></tr></thead>
          <tbody>${rows}</tbody>
        </table></div>
        <p class="note"><span class="dot home-dot"></span> Ev sahibi &nbsp; <span class="dot away-dot"></span> Misafir</p>
      </section>`;
  }

  function absenceList(title, list, category) {
    const body = list.length
      ? `<ul class="people">${list
          .map((a) => `<li><span>${esc(a.name)}</span><small>${esc(a.reason)}${a.doubtful ? ' · şüpheli' : ''}</small></li>`)
          .join('')}</ul>`
      : '<p class="empty">Yok</p>';
    return `<section><h3><span class="dot ${category}"></span>${title}</h3>${body}</section>`;
  }

  function recordStats(s) {
    return `
      <div class="stats">
        <div><b class="win-text">${s.counts.G}</b><span>Galibiyet</span></div>
        <div><b>${s.counts.B}</b><span>Beraberlik</span></div>
        <div><b class="loss-text">${s.counts.M}</b><span>Mağlubiyet</span></div>
        <div><b>${s.goalsFor}</b><span>Attığı gol / maç</span></div>
        <div><b>${s.goalsAgainst}</b><span>Yediği gol / maç</span></div>
      </div>`;
  }

  function renderTeam(team, role) {
    const atHome = role === 'home';
    const last5 = team.recent.slice(0, 5);
    const overall = summarize(last5);
    const venueMatches = team.recent.filter((m) => m.isHome === atHome).slice(0, 5);
    const venue = summarize(venueMatches);

    const last10 = team.recent.slice(0, 10);
    const n = last10.length;
    const overs = [1.5, 2.5, 3.5].map((line) => ({
      line,
      count: last10.filter((m) => m.goalsFor + m.goalsAgainst > line).length,
    }));
    const btts = last10.filter((m) => m.goalsFor > 0 && m.goalsAgainst > 0).length;
    const byCategory = (c) => team.absences.filter((a) => a.category === c);
    const absenceSections = team.absences
      ? `${absenceList('Sakat oyuncular', byCategory('injury'), 'injury')}
         ${absenceList('Sarı kart cezalıları', byCategory('yellow'), 'yellow')}
         ${absenceList('Kırmızı kart cezalıları', byCategory('red'), 'red')}`
      : `<section><h3><span class="dot injury"></span>Sakat ve cezalı oyuncular</h3>
         <p class="empty">Ücretsiz veri kaynağında bu bilgi bulunmuyor.</p></section>`;

    // Hangi organizasyonda oynandığı (lig, kupa vb.) fare imlecinin yanında görünür.
    const matchRow = (m) => `
      <li data-tip="${esc(m.league)} · ${esc(longDate.format(new Date(m.date)))}${m.id ? ' · analiz için tıkla' : ''}"
        ${m.id ? `data-fixture="${m.id}" role="button" tabindex="0" class="clickable"` : ''}>
        <span class="muted">${shortDate.format(new Date(m.date))}</span>
        <span class="tag">${m.isHome ? 'İç' : 'Dış'}</span>
        <span class="opp">${esc(m.opponent.name)}</span>
        ${m.result ? `<span class="score">${m.goalsFor}-${m.goalsAgainst}</span><span class="res ${RESULT_CLASS[m.result]}">${m.result}</span>` : `<span class="muted small">${esc(m.league)}</span>`}
      </li>`;

    return `
      <article class="card team">
        <header class="team-head">
          ${logo(team, 'lg')}
          <div><span class="role ${role}">${atHome ? 'Ev sahibi' : 'Misafir'}</span><h2>${esc(team.name)}</h2></div>
          ${formBadges(last5)}
        </header>

        <section>
          <h3>Son 5 maç</h3>
          ${last5.length ? `<ul class="matches">${last5.map(matchRow).join('')}</ul>` : '<p class="empty">Veri yok</p>'}
        </section>

        <section>
          <h3>Kazanma / kaybetme <small class="muted">(son 5)</small></h3>
          ${recordStats(overall)}
        </section>

        <section class="venue-form">
          <h3>${atHome ? '🏠 İç saha formu' : '✈️ Dış saha formu'} <small class="muted">(son ${venue.n})</small></h3>
          ${
            venue.n
              ? `${formBadges(venueMatches)}
                 <ul class="matches">${venueMatches.map(matchRow).join('')}</ul>
                 ${recordStats(venue)}`
              : `<p class="empty">${atHome ? 'İç saha' : 'Deplasman'} maçı verisi yok</p>`
          }
        </section>

        <section>
          <h3>Alt / üst <small class="muted">(son ${n} maç)</small></h3>
          <div class="stats">
            ${overs.map((o) => `<div><b>${o.count}/${n}</b><span>${o.line} üst</span></div>`).join('')}
            <div><b>${btts}/${n}</b><span>KG var</span></div>
          </div>
        </section>

        ${absenceSections}

        <section>
          <h3>Sonraki maçlar</h3>
          ${team.upcoming.length ? `<ul class="matches">${team.upcoming.map(matchRow).join('')}</ul>` : '<p class="empty">Planlanmış maç yok</p>'}
        </section>
      </article>`;
  }

  function renderReport(report) {
    const prediction = CO.model.predict(report);
    const rows = CO.model.marketRows(prediction, report.odds);
    const analysis = CO.analysis.build(report, prediction, rows);
    const warnings = report.warnings.length
      ? `<div class="card warning">${report.warnings.map(esc).join('<br>')}</div>`
      : '';

    state.reportTeams = {};
    for (const team of [report.home, report.away]) {
      state.reportTeams[team.id] = { id: team.id, name: team.name, logo: team.logo };
    }
    state.current = {
      fixtureId: report.fixture.id,
      date: report.fixture.date,
      league: report.fixture.league,
      home: state.reportTeams[report.home.id],
      away: state.reportTeams[report.away.id],
      markets: CO.model.marketList(prediction, report.odds, report),
    };

    state.report = report;
    const back = state.viewStack.length
      ? '<button type="button" class="btn back" data-back>← Önceki maça dön</button>'
      : '';

    result.innerHTML = `
      ${back}
      ${warnings}
      ${renderHead(report)}
      <div class="grid-2">${renderPrediction(report, prediction)}${renderAnalysis(report, analysis)}</div>
      <div class="grid-2">${renderHeadToHead(report)}${renderStandings(report)}</div>
      <div class="grid-2">${renderTeam(report.home, 'home')}${renderTeam(report.away, 'away')}</div>`;
  }

  // ---------- imlecin yanında beliren ipucu ----------
  const tooltip = document.createElement('div');
  tooltip.className = 'tip';
  tooltip.hidden = true;
  document.body.append(tooltip);

  const TIP_OFFSET = 14;

  function moveTooltip(e) {
    const { width, height } = tooltip.getBoundingClientRect();
    const left = Math.min(e.clientX + TIP_OFFSET, window.innerWidth - width - 8);
    const top = e.clientY + height + TIP_OFFSET > window.innerHeight ? e.clientY - height - TIP_OFFSET : e.clientY + TIP_OFFSET;
    tooltip.style.transform = `translate(${Math.max(8, left)}px, ${Math.max(8, top)}px)`;
  }

  document.addEventListener('mouseover', (e) => {
    const target = e.target.closest('[data-tip]');
    if (!target) return;
    tooltip.textContent = target.dataset.tip;
    tooltip.hidden = false;
    moveTooltip(e);
  });

  document.addEventListener('mousemove', (e) => {
    if (!tooltip.hidden) moveTooltip(e);
  });

  document.addEventListener('mouseout', (e) => {
    if (e.target.closest('[data-tip]') && !e.relatedTarget?.closest('[data-tip]')) tooltip.hidden = true;
  });

  // ---------- kupon ve iddaa oranları ----------
  result.addEventListener('click', (e) => {
    const button = e.target.closest('[data-add-pick]');
    if (button && state.current) CO.coupon.toggle(state.current, button.dataset.addPick);
  });

  result.addEventListener('input', (e) => {
    const field = e.target.closest('[data-iddaa]');
    if (!field || !state.current) return;
    const raw = field.value.replace(',', '.').trim();
    const value = Number(raw);
    const valid = raw !== '' && Number.isFinite(value) && value > 1;
    field.classList.toggle('invalid', raw !== '' && !valid);
    CO.coupon.setIddaaOdd(state.current.fixtureId, field.dataset.iddaa, valid ? Math.round(value * 100) / 100 : null);
    updateMarketRow(field.closest('tr'));
  });

  CO.coupon.onChange(syncPickButtons);

  detectMode().then(() => {
    state.favorites = loadFavorites();
    renderFavorites();
  });
})();
