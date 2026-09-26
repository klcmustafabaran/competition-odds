// Poisson gol modeli.
// Ev sahibinin iç saha, misafirin dış saha maçlarındaki attığı/yediği gol ortalamasından beklenen gol
// (lambda) hesaplanır, skor olasılıkları Poisson dağılımıyla bulunur.
// Az veri olduğunda iç/dış saha değerleri takımın genel ortalamasına, genel ortalama da lig ortalamasına çekilir.
(function () {
  const LEAGUE_AVG_GOALS = 1.35;
  const VENUE_BOOST = 1.1; // iç sahada daha çok gol atılır, deplasmanda daha çok yenir
  const VENUE_DAMP = 0.9;
  const PRIOR_MATCHES = 5;
  const RECENT_MATCHES = 10;
  const MAX_GOALS = 10;
  const PENALTY_PER_ABSENCE = 0.02;
  const MAX_ABSENCE_PENALTY = 0.1;
  const VALUE_THRESHOLD = 0.05;

  function poisson(k, lambda) {
    let p = Math.exp(-lambda);
    for (let i = 1; i <= k; i++) p *= lambda / i;
    return p;
  }

  function shrink(value, n, prior) {
    const weight = n / (n + PRIOR_MATCHES);
    return weight * value + (1 - weight) * prior;
  }

  const average = (matches, key) => matches.reduce((t, m) => t + m[key], 0) / matches.length;

  function overallRates(team) {
    const matches = team.recent.slice(0, RECENT_MATCHES);
    const n = matches.length;
    if (!n) return { scored: LEAGUE_AVG_GOALS, conceded: LEAGUE_AVG_GOALS, n: 0 };
    return {
      scored: shrink(average(matches, 'goalsFor'), n, LEAGUE_AVG_GOALS),
      conceded: shrink(average(matches, 'goalsAgainst'), n, LEAGUE_AVG_GOALS),
      n,
    };
  }

  function venueRates(team, atHome) {
    const overall = overallRates(team);
    const scoredPrior = overall.scored * (atHome ? VENUE_BOOST : VENUE_DAMP);
    const concededPrior = overall.conceded * (atHome ? VENUE_DAMP : VENUE_BOOST);
    const matches = team.recent.filter((m) => m.isHome === atHome).slice(0, RECENT_MATCHES);
    const n = matches.length;
    if (!n) return { scored: scoredPrior, conceded: concededPrior, n: 0, overallN: overall.n };
    return {
      scored: shrink(average(matches, 'goalsFor'), n, scoredPrior),
      conceded: shrink(average(matches, 'goalsAgainst'), n, concededPrior),
      n,
      overallN: overall.n,
    };
  }

  // Eksik oyuncuların önemi bilinmediği için küçük ve sınırlı bir düşüş uygulanır.
  function absencePenalty(team) {
    if (!team.absences) return 0; // veri kaynağında eksik oyuncu bilgisi yok
    const weight = team.absences.reduce((t, a) => t + (a.doubtful ? 0.5 : 1), 0);
    return Math.min(MAX_ABSENCE_PENALTY, weight * PENALTY_PER_ABSENCE);
  }

  function predict(report) {
    const h = venueRates(report.home, true);
    const a = venueRates(report.away, false);
    const lambdaHome = ((h.scored + a.conceded) / 2) * (1 - absencePenalty(report.home));
    const lambdaAway = ((a.scored + h.conceded) / 2) * (1 - absencePenalty(report.away));

    let home = 0;
    let draw = 0;
    let away = 0;
    let btts = 0;
    const totals = new Array(MAX_GOALS * 2 + 1).fill(0);
    const scores = [];

    for (let i = 0; i <= MAX_GOALS; i++) {
      for (let j = 0; j <= MAX_GOALS; j++) {
        const p = poisson(i, lambdaHome) * poisson(j, lambdaAway);
        if (i > j) home += p;
        else if (i < j) away += p;
        else draw += p;
        if (i > 0 && j > 0) btts += p;
        totals[i + j] += p;
        scores.push({ score: `${i}-${j}`, p });
      }
    }

    const mass = home + draw + away;
    const overUnder = [1.5, 2.5, 3.5].map((line) => {
      const under = totals.slice(0, Math.ceil(line)).reduce((t, p) => t + p, 0) / mass;
      return { line: line.toFixed(1), over: 1 - under, under };
    });
    scores.sort((x, y) => y.p - x.p);

    return {
      lambdaHome,
      lambdaAway,
      probs: { home: home / mass, draw: draw / mass, away: away / mass },
      overUnder,
      btts: btts / mass,
      topScores: scores.slice(0, 3).map((s) => ({ score: s.score, p: s.p / mass })),
      sampleSize: Math.min(h.overallN, a.overallN),
      venueSampleSize: Math.min(h.n, a.n),
    };
  }

  // Model olasılığını oranla karşılaştırır.
  // implied: oranın ima ettiği olasılık (bahis şirketi marjı çıkarılmış)
  // edge: model olasılığı x oran - 1 (pozitifse model, oranın düşündüğünden yüksek olasılık görüyor)
  function marketRows(prediction, odds) {
    const rows = [];
    if (!odds) return rows;

    const addGroup = (items) => {
      const complete = items.every((x) => x.odd);
      const overround = complete ? items.reduce((t, x) => t + 1 / x.odd, 0) : null;
      for (const x of items) {
        rows.push({
          ...x,
          implied: complete ? 1 / x.odd / overround : null,
          edge: x.odd ? x.model * x.odd - 1 : null,
        });
      }
    };

    const mw = odds.matchWinner;
    if (mw && (mw.home || mw.draw || mw.away)) {
      addGroup([
        { label: 'MS 1', model: prediction.probs.home, odd: mw.home },
        { label: 'MS X', model: prediction.probs.draw, odd: mw.draw },
        { label: 'MS 2', model: prediction.probs.away, odd: mw.away },
      ]);
    }
    for (const line of odds.overUnder) {
      const m = prediction.overUnder.find((x) => x.line === line.line);
      if (!m) continue;
      addGroup([
        { label: `${line.line} Üst`, model: m.over, odd: line.over },
        { label: `${line.line} Alt`, model: m.under, odd: line.under },
      ]);
    }
    return rows;
  }

  // ---------- son maçlar + aralarındaki maçlar ----------
  // Her tercih için: ev sahibinin son 5 maçı, misafirin son 5 maçı ve aralarındaki maçlarda
  // o sonucun kaç kez gerçekleştiği sayılır. 5 maçlık örnekte "5/5 = %100" gibi uç değerler çıkmasın diye
  // sonuç, FORM_PRIOR_MATCHES maç ağırlığıyla modelin olasılığına yaklaştırılır.
  const FORM_MATCHES = 5;
  const FORM_PRIOR_MATCHES = 2;

  function formEvidence(report) {
    const perspective = (m) => ({ gf: m.goalsFor, ga: m.goalsAgainst });
    // Aralarındaki maçlar ev sahibi takımın gözünden: MS 1 = ev sahibi kazandı.
    const h2h = (report.headToHead ?? []).map((f) =>
      f.home.id === report.home.id ? { gf: f.goals.home, ga: f.goals.away } : { gf: f.goals.away, ga: f.goals.home },
    );
    return {
      home: report.home.recent.slice(0, FORM_MATCHES).map(perspective),
      away: report.away.recent.slice(0, FORM_MATCHES).map(perspective),
      h2h,
    };
  }

  // Her pazar için [ev sahibinin maçlarında, misafirin maçlarında, aralarındaki maçlarda] gerçekleşme testi.
  function formTests(key) {
    const total = (m) => m.gf + m.ga;
    if (key === 'MS1') return [(m) => m.gf > m.ga, (m) => m.gf < m.ga, (m) => m.gf > m.ga];
    if (key === 'MS2') return [(m) => m.gf < m.ga, (m) => m.gf > m.ga, (m) => m.gf < m.ga];
    if (key === 'MSX') return Array(3).fill((m) => m.gf === m.ga);
    if (key === 'KGV') return Array(3).fill((m) => m.gf > 0 && m.ga > 0);
    if (key === 'KGY') return Array(3).fill((m) => !(m.gf > 0 && m.ga > 0));
    const line = Number(key.slice(1));
    return Array(3).fill(key.startsWith('U') ? (m) => total(m) > line : (m) => total(m) < line);
  }

  function formProbability(evidence, key, modelP) {
    const [homeTest, awayTest, h2hTest] = formTests(key);
    const count = (matches, test) => matches.filter(test).length;
    const hits = count(evidence.home, homeTest) + count(evidence.away, awayTest) + count(evidence.h2h, h2hTest);
    const trials = evidence.home.length + evidence.away.length + evidence.h2h.length;
    return { formP: (hits + FORM_PRIOR_MATCHES * modelP) / (trials + FORM_PRIOR_MATCHES), formHits: hits, formTrials: trials };
  }

  // Kupon ve oran tablosu için tüm pazarlar: model olasılığı, son maçlara göre olasılık ve (varsa) bahis şirketi oranı.
  // group: aynı maçta birbirinin alternatifi olan tercihler (ör. MS 1 / X / 2).
  function marketList(prediction, odds, report) {
    const mw = odds?.matchWinner;
    const books = odds?.books ?? {};
    const bookLine = (line) => odds?.overUnder?.find((l) => l.line === line);
    const markets = [
      { key: 'MS1', group: 'ms', label: 'MS 1', p: prediction.probs.home, odd: mw?.home, book: books.home },
      { key: 'MSX', group: 'ms', label: 'MS X', p: prediction.probs.draw, odd: mw?.draw, book: books.draw },
      { key: 'MS2', group: 'ms', label: 'MS 2', p: prediction.probs.away, odd: mw?.away, book: books.away },
    ];
    for (const ou of prediction.overUnder) {
      const line = Number(ou.line);
      markets.push(
        { key: `U${ou.line}`, group: `au${ou.line}`, label: `${ou.line} Üst`, p: ou.over, odd: bookLine(ou.line)?.over, book: books[`over${line}`] },
        { key: `A${ou.line}`, group: `au${ou.line}`, label: `${ou.line} Alt`, p: ou.under, odd: bookLine(ou.line)?.under, book: books[`under${line}`] },
      );
    }
    markets.push(
      { key: 'KGV', group: 'kg', label: 'KG Var', p: prediction.btts, odd: null },
      { key: 'KGY', group: 'kg', label: 'KG Yok', p: 1 - prediction.btts, odd: null },
    );
    const evidence = formEvidence(report);
    return markets.map((m) => ({ ...m, odd: m.odd ?? null, ...formProbability(evidence, m.key, m.p) }));
  }

  window.CO = window.CO || {};
  window.CO.model = { predict, marketRows, marketList, VALUE_THRESHOLD };
})();
