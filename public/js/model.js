// Poisson gol modeli. Beklenen gol (lambda) iki kaynağın birleşimidir:
//  1) Lig tablosu: takımın sezonluk hücum/savunma gücü ve ligin kendi ev sahibi avantajı
//  2) Son maçlar: ev sahibinin iç saha, misafirin dış saha performansı (rakip gücüne göre düzeltilmiş)
// Skor olasılıkları Poisson dağılımıyla hesaplanır. Veri azaldıkça değerler lig ortalamasına çekilir.
(function () {
  const LEAGUE_AVG_GOALS = 1.35; // tablo yoksa varsayılan
  const VENUE_BOOST = 1.1; // tablo yoksa varsayılan ev sahibi avantajı
  const VENUE_DAMP = 0.9;
  const PRIOR_MATCHES = 5;
  const STRENGTH_PRIOR_MATCHES = 5;
  const RECENT_MATCHES = 10;
  const MAX_TABLE_WEIGHT = 0.6; // tablo ile form arasındaki en yüksek tablo ağırlığı
  const TABLE_FULL_WEIGHT_AFTER = 10; // bu kadar maç oynandıysa tablo tam ağırlığa ulaşır
  const MAX_GOALS = 10;
  const PENALTY_PER_ABSENCE = 0.02;
  const MAX_ABSENCE_PENALTY = 0.1;
  const VALUE_THRESHOLD = 0.05;

  const clamp = (value, min, max) => Math.min(max, Math.max(min, value));

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

  // Lig tablosundan takım güçleri ve ligin gerçek ev sahibi avantajı.
  // attack/defence 1.00 = lig ortalaması; 1.20 hücum = ligin %20 üstünde gol atıyor.
  function leagueStrengths(report) {
    const rows = report.standings?.rows ?? [];
    const context = report.standings?.context ?? {};
    const leagueAvg = context.leagueAvgGoals > 0 ? context.leagueAvgGoals : LEAGUE_AVG_GOALS;
    const homeFactor = context.homeAvgGoals > 0 ? clamp(context.homeAvgGoals / leagueAvg, 0.9, 1.35) : VENUE_BOOST;
    const awayFactor = context.awayAvgGoals > 0 ? clamp(context.awayAvgGoals / leagueAvg, 0.7, 1.1) : VENUE_DAMP;

    const teams = {};
    for (const row of rows) {
      if (!row.played || row.goalsFor == null || row.goalsAgainst == null) continue;
      // Az maç oynandıysa güç 1.00'e (lig ortalamasına) yaklaştırılır.
      const weight = row.played / (row.played + STRENGTH_PRIOR_MATCHES);
      const attack = 1 + weight * (row.goalsFor / row.played / leagueAvg - 1);
      const defence = 1 + weight * (row.goalsAgainst / row.played / leagueAvg - 1);
      teams[row.team.id] = { attack: clamp(attack, 0.5, 1.8), defence: clamp(defence, 0.5, 1.8), played: row.played };
    }

    return { leagueAvg, homeFactor, awayFactor, teams, hasTable: Object.keys(teams).length > 0 };
  }

  // "3 gol attı" ile "ligin en kötü savunmasına 3 gol attı" aynı değil: rakip gücüne göre düzeltilir.
  function adjustedMatches(team, strengths) {
    return team.recent.map((m) => {
      const opponent = strengths.teams[m.opponent?.id];
      if (!opponent) return m;
      return { ...m, goalsFor: m.goalsFor / opponent.defence, goalsAgainst: m.goalsAgainst / opponent.attack };
    });
  }

  function overallRates(matches, strengths) {
    const recent = matches.slice(0, RECENT_MATCHES);
    const n = recent.length;
    if (!n) return { scored: strengths.leagueAvg, conceded: strengths.leagueAvg, n: 0 };
    return {
      scored: shrink(average(recent, 'goalsFor'), n, strengths.leagueAvg),
      conceded: shrink(average(recent, 'goalsAgainst'), n, strengths.leagueAvg),
      n,
    };
  }

  function venueRates(matches, atHome, strengths) {
    const overall = overallRates(matches, strengths);
    const scoredFactor = atHome ? strengths.homeFactor : strengths.awayFactor;
    const concededFactor = atHome ? strengths.awayFactor : strengths.homeFactor;
    const scoredPrior = overall.scored * scoredFactor;
    const concededPrior = overall.conceded * concededFactor;

    const venue = matches.filter((m) => m.isHome === atHome).slice(0, RECENT_MATCHES);
    const n = venue.length;
    if (!n) return { scored: scoredPrior, conceded: concededPrior, n: 0, overallN: overall.n };
    return {
      scored: shrink(average(venue, 'goalsFor'), n, scoredPrior),
      conceded: shrink(average(venue, 'goalsAgainst'), n, concededPrior),
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
    const strengths = leagueStrengths(report);
    const h = venueRates(adjustedMatches(report.home, strengths), true, strengths);
    const a = venueRates(adjustedMatches(report.away, strengths), false, strengths);

    // 1) Son maçlara dayalı beklenti
    const formHome = (h.scored + a.conceded) / 2;
    const formAway = (a.scored + h.conceded) / 2;

    // 2) Lig tablosuna dayalı beklenti (iki takım da tabloda varsa)
    const homeStrength = strengths.teams[report.home.id];
    const awayStrength = strengths.teams[report.away.id];
    let lambdaHome = formHome;
    let lambdaAway = formAway;
    let tableWeight = 0;

    if (homeStrength && awayStrength) {
      const tableHome = strengths.leagueAvg * homeStrength.attack * awayStrength.defence * strengths.homeFactor;
      const tableAway = strengths.leagueAvg * awayStrength.attack * homeStrength.defence * strengths.awayFactor;
      const played = Math.min(homeStrength.played, awayStrength.played);
      tableWeight = Math.min(1, played / TABLE_FULL_WEIGHT_AFTER) * MAX_TABLE_WEIGHT;
      lambdaHome = tableWeight * tableHome + (1 - tableWeight) * formHome;
      lambdaAway = tableWeight * tableAway + (1 - tableWeight) * formAway;
    }

    lambdaHome *= 1 - absencePenalty(report.home);
    lambdaAway *= 1 - absencePenalty(report.away);

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
      basis: {
        tableWeight,
        leagueAvg: strengths.leagueAvg,
        homeFactor: strengths.homeFactor,
        awayFactor: strengths.awayFactor,
        home: homeStrength ?? null,
        away: awayStrength ?? null,
      },
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
  window.CO.model = { predict, marketRows, marketList, leagueStrengths, VALUE_THRESHOLD };
})();
