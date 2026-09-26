// Rapor verisinden ve model sonucundan maç analizini üretir:
// kısa özet + güven etiketi, faktör kartları (hangi takımın lehine olduğuyla), dikkat çeken oran farkları.
(function () {
  const pct = (p) => `%${Math.round(p * 100)}`;
  const fmt = (n) => n.toFixed(1);
  const capitalize = (s) => s.charAt(0).toLocaleUpperCase('tr') + s.slice(1);
  const DAY_MS = 86_400_000;

  function record(matches) {
    const c = { G: 0, B: 0, M: 0 };
    matches.forEach((m) => c[m.result]++);
    return c;
  }

  function averages(matches) {
    const n = matches.length;
    if (!n) return null;
    return {
      n,
      gf: matches.reduce((t, m) => t + m.goalsFor, 0) / n,
      ga: matches.reduce((t, m) => t + m.goalsAgainst, 0) / n,
    };
  }

  // Ev sahibi değeri misafirinkinden en az "threshold" kadar büyükse ev sahibi lehine.
  function sideOf(homeScore, awayScore, threshold) {
    if (homeScore - awayScore >= threshold) return 'home';
    if (awayScore - homeScore >= threshold) return 'away';
    return 'neutral';
  }

  // ---------- faktörler ----------
  function venueFactor(report) {
    const h = averages(report.home.recent.filter((m) => m.isHome).slice(0, 5));
    const a = averages(report.away.recent.filter((m) => !m.isHome).slice(0, 5));
    if (!h || !a) return null;
    return {
      icon: '🏟️',
      title: 'İç saha vs deplasman',
      side: sideOf(h.gf - h.ga, a.gf - a.ga, 0.5),
      bars: [
        { label: 'Attığı gol / maç', home: h.gf, away: a.gf },
        { label: 'Yediği gol / maç', home: h.ga, away: a.ga },
      ],
      detail: `Ev sahibi iç sahada son ${h.n}, misafir deplasmanda son ${a.n} maç`,
      reason: { home: 'iç saha formu güçlü', away: 'deplasman formu güçlü' },
    };
  }

  function standingsFactor(report) {
    const rows = report.standings?.rows;
    if (!rows) return null;
    const h = rows.find((r) => r.team.id === report.home.id);
    const a = rows.find((r) => r.team.id === report.away.id);
    if (!h || !a) return null;
    return {
      icon: '📊',
      title: 'Puan durumu',
      side: sideOf(a.rank, h.rank, 1),
      values: {
        home: { main: `${h.rank}.`, sub: `${h.points} puan` },
        away: { main: `${a.rank}.`, sub: `${a.points} puan` },
      },
      detail: `${rows.length} takımlı tabloda puan farkı ${Math.abs(h.points - a.points)}`,
      reason: 'puan tablosunda üstte',
    };
  }

  function formFactor(report) {
    const info = (team) => {
      const matches = team.recent.slice(0, 5);
      const c = record(matches);
      return { c, n: matches.length, points: c.G * 3 + c.B };
    };
    const h = info(report.home);
    const a = info(report.away);
    if (!h.n || !a.n) return null;
    return {
      icon: '🔥',
      title: 'Son 5 maç formu',
      side: sideOf(h.points, a.points, 2),
      values: {
        home: { main: `${h.points} P`, sub: `${h.c.G}G ${h.c.B}B ${h.c.M}M` },
        away: { main: `${a.points} P`, sub: `${a.c.G}G ${a.c.B}B ${a.c.M}M` },
      },
      reason: 'son maçlarda daha formda',
    };
  }

  function headToHeadFactor(report) {
    const list = report.headToHead ?? [];
    if (!list.length) {
      return {
        icon: '⚔️',
        title: 'Aralarındaki maçlar',
        side: 'neutral',
        single: { main: '–', sub: 'Kapsanan liglerde aralarında maç yok' },
      };
    }
    let homeWins = 0;
    let awayWins = 0;
    let draws = 0;
    let goals = 0;
    for (const f of list) {
      goals += f.goals.home + f.goals.away;
      if (f.goals.home === f.goals.away) draws++;
      else if ((f.goals.home > f.goals.away ? f.home.id : f.away.id) === report.home.id) homeWins++;
      else awayWins++;
    }
    return {
      icon: '⚔️',
      title: 'Aralarındaki maçlar',
      side: sideOf(homeWins, awayWins, 1),
      values: {
        home: { main: `${homeWins}`, sub: 'galibiyet' },
        away: { main: `${awayWins}`, sub: 'galibiyet' },
      },
      detail: `Son ${list.length} maç · ${draws} beraberlik · maç başı ${fmt(goals / list.length)} gol`,
      reason: 'aralarındaki maçlarda üstün',
    };
  }

  function goalsFactor(report) {
    const h = averages(report.home.recent.slice(0, 10));
    const a = averages(report.away.recent.slice(0, 10));
    if (!h || !a) return null;
    return {
      icon: '⚽',
      title: 'Genel gol ortalaması',
      side: sideOf(h.gf - h.ga, a.gf - a.ga, 0.4),
      bars: [
        { label: 'Attığı gol / maç', home: h.gf, away: a.gf },
        { label: 'Yediği gol / maç', home: h.ga, away: a.ga },
      ],
      detail: `Son ${h.n === a.n ? h.n : `${h.n} ve ${a.n}`} maç (iç + dış saha)`,
      reason: 'gol averajı daha iyi',
    };
  }

  function absenceFactor(report) {
    if (!report.home.absences || !report.away.absences) return null;
    const info = (team) => {
      const injured = team.absences.filter((x) => x.category === 'injury').length;
      return {
        weight: team.absences.reduce((t, x) => t + (x.doubtful ? 0.5 : 1), 0),
        count: team.absences.length,
        injured,
        suspended: team.absences.length - injured,
      };
    };
    const h = info(report.home);
    const a = info(report.away);
    return {
      icon: '🚑',
      title: 'Eksik oyuncular',
      // Daha az eksiği olan takımın lehine
      side: sideOf(a.weight, h.weight, 1),
      values: {
        home: { main: `${h.count}`, sub: `${h.injured} sakat · ${h.suspended} cezalı` },
        away: { main: `${a.count}`, sub: `${a.injured} sakat · ${a.suspended} cezalı` },
      },
      detail: 'Şüpheli oyuncular yarım eksik sayılır',
      reason: 'kadrosu daha eksiksiz',
    };
  }

  function fixtureFactor(report) {
    const kickoff = new Date(report.fixture.date);
    const nextAfter = (team) => team.upcoming.find((u) => new Date(u.date) > kickoff) ?? null;
    const hNext = nextAfter(report.home);
    const aNext = nextAfter(report.away);
    if (!hNext && !aNext) return null;

    const gap = (next) => (next ? (new Date(next.date) - kickoff) / DAY_MS : null);
    const busy = (days) => days !== null && days <= 4;
    const hGap = gap(hNext);
    const aGap = gap(aNext);
    const value = (next, days) =>
      next ? { main: `${Math.max(1, Math.round(days))} gün`, sub: `sonra ${next.opponent.name}` } : { main: '–', sub: 'planlı maç yok' };

    const busyTeams = [busy(hGap) && report.home.name, busy(aGap) && report.away.name].filter(Boolean);
    return {
      icon: '📅',
      title: 'Fikstür yoğunluğu',
      side: busy(hGap) && !busy(aGap) ? 'away' : busy(aGap) && !busy(hGap) ? 'home' : 'neutral',
      values: { home: value(hNext, hGap), away: value(aNext, aGap) },
      detail: busyTeams.length
        ? `${busyTeams.join(' ve ')} 4 gün içinde tekrar oynayacak, rotasyon ihtimali var`
        : 'İki takımın da sonraki maça kadar yeterli dinlenme süresi var',
      reason: 'rakibi yoğun fikstürde',
    };
  }

  function weatherFactor(report) {
    const w = report.weather;
    if (!w) return null;
    const notes = [];
    if (w.precipitationProbability >= 60) notes.push('yağış');
    if (w.windSpeed >= 30) notes.push('kuvvetli rüzgar');
    if (w.temperature >= 30) notes.push('sıcak hava');
    if (w.temperature <= 3) notes.push('soğuk hava');
    return {
      icon: w.icon,
      title: 'Hava durumu',
      side: 'neutral',
      single: {
        main: `${Math.round(w.temperature)}°C`,
        sub: `${w.description} · Yağış %${w.precipitationProbability} · Rüzgar ${Math.round(w.windSpeed)} km/s`,
      },
      detail: notes.length
        ? `${capitalize(notes.join(', '))}: zemin ve oyun temposu etkilenebilir`
        : 'Oyunu belirgin şekilde etkilemesi beklenmez',
    };
  }

  // ---------- özet ----------
  const reasonFor = (factor, side) => (typeof factor.reason === 'string' ? factor.reason : factor.reason?.[side]);

  function confidence(prediction, margin) {
    if (prediction.sampleSize < 5 || prediction.venueSampleSize < 3) return { label: 'Düşük', key: 'low' };
    if (margin >= 0.2) return { label: 'Yüksek', key: 'high' };
    if (margin >= 0.08) return { label: 'Orta', key: 'mid' };
    return { label: 'Düşük', key: 'low' };
  }

  function summarize(report, prediction, factors) {
    const { probs } = prediction;
    const outcomes = [
      { side: 'home', p: probs.home, name: report.home.name },
      { side: 'draw', p: probs.draw },
      { side: 'away', p: probs.away, name: report.away.name },
    ].sort((x, y) => y.p - x.p);
    const [best, second] = outcomes;
    const margin = best.p - second.p;
    const conf = confidence(prediction, margin);

    if (best.side === 'draw' || margin < 0.08) {
      const label = best.side === 'draw' ? 'beraberlik' : `${best.name} galibiyeti`;
      return {
        side: 'neutral',
        title: 'Dengeli maç',
        pct: pct(best.p),
        text: `En yüksek olasılık ${label}, ancak sonuçlar arasında belirgin bir fark yok.`,
        confidence: conf,
      };
    }

    const other = best.side === 'home' ? 'away' : 'home';
    const pros = factors.filter((f) => f.side === best.side && reasonFor(f, best.side)).slice(0, 2);
    const con = factors.find((f) => f.side === other && reasonFor(f, other));

    let text = pros.length
      ? `${capitalize(pros.map((f) => reasonFor(f, best.side)).join(', '))}.`
      : 'Model olasılıklarına göre önde.';
    if (con) text += ` Ancak ${report[other].name} lehine: ${reasonFor(con, other)}.`;

    return { side: best.side, title: `${best.name} favori`, pct: pct(best.p), text, confidence: conf };
  }

  function build(report, prediction, marketRows) {
    const factors = [
      venueFactor(report),
      standingsFactor(report),
      formFactor(report),
      headToHeadFactor(report),
      goalsFactor(report),
      absenceFactor(report),
      fixtureFactor(report),
      weatherFactor(report),
    ].filter(Boolean);

    const tally = { home: 0, away: 0, neutral: 0 };
    factors.forEach((f) => tally[f.side]++);

    const highlights = marketRows
      .filter((r) => r.edge !== null && r.edge >= CO.model.VALUE_THRESHOLD)
      .map((r) => ({
        label: r.label,
        edge: `+${Math.round(r.edge * 100)}%`,
        text: `Model ${pct(r.model)} olasılık veriyor, ${r.odd.toFixed(2)} oranı ise ${pct(r.implied ?? 1 / r.odd)} ima ediyor.`,
      }));

    return {
      summary: summarize(report, prediction, factors),
      tally,
      factors,
      highlights,
      oddsAvailable: marketRows.length > 0,
      lowData: prediction.sampleSize < 5 || prediction.venueSampleSize < 3,
    };
  }

  window.CO = window.CO || {};
  window.CO.analysis = { build };
})();
