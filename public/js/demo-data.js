// API anahtarı yokken arayüzü denemek için hayali veri. Takımlar ve oyuncular gerçek değildir.
(function () {
  function daysFromNow(days, hour = 19) {
    const d = new Date();
    d.setDate(d.getDate() + days);
    d.setHours(hour, 0, 0, 0);
    return d.toISOString();
  }

  function recent(rows) {
    return rows.map(([daysAgo, opponent, isHome, goalsFor, goalsAgainst], i) => ({
      id: 100 + i,
      date: daysFromNow(-daysAgo),
      league: 'Demo Ligi',
      isHome,
      opponent: { name: opponent, logo: '' },
      goalsFor,
      goalsAgainst,
      result: goalsFor > goalsAgainst ? 'G' : goalsFor < goalsAgainst ? 'M' : 'B',
    }));
  }

  const teams = [
    { id: 1, name: 'Demo Spor', logo: '', country: 'Türkiye', league: 'Demo Ligi' },
    { id: 2, name: 'Örnek FK', logo: '', country: 'Türkiye', league: 'Demo Ligi' },
  ];

  function headToHead(rows) {
    const team = (id) => ({ id, name: id === 1 ? 'Demo Spor' : 'Örnek FK', logo: '' });
    return rows.map(([daysAgo, homeId, homeGoals, awayGoals]) => ({
      date: daysFromNow(-daysAgo),
      league: 'Demo Ligi',
      home: team(homeId),
      away: team(homeId === 1 ? 2 : 1),
      goals: { home: homeGoals, away: awayGoals },
    }));
  }

  function standingRows(rows) {
    return rows.map(([rank, id, name, played, win, draw, lose, goalsFor, goalsAgainst]) => ({
      rank,
      team: { id, name, logo: '' },
      played,
      win,
      draw,
      lose,
      goalDiff: goalsFor - goalsAgainst,
      points: win * 3 + draw,
    }));
  }

  function buildReport() {
    return {
      headToHead: headToHead([
        [46, 1, 2, 1],
        [210, 2, 1, 1],
        [390, 1, 0, 2],
        [570, 2, 0, 1],
        [750, 1, 3, 3],
      ]),
      standings: {
        league: 'Demo Ligi',
        rows: standingRows([
          [1, 3, 'Prova SK', 4, 3, 1, 0, 8, 3],
          [2, 4, 'Test Belediye', 4, 2, 2, 0, 7, 4],
          [3, 1, 'Demo Spor', 4, 2, 1, 1, 6, 4],
          [4, 5, 'Kontrol FK', 4, 2, 0, 2, 5, 5],
          [5, 2, 'Örnek FK', 4, 1, 2, 1, 5, 5],
          [6, 6, 'Deneme Gücü', 4, 1, 1, 2, 4, 6],
          [7, 7, 'Taslak Spor', 4, 1, 0, 3, 3, 7],
          [8, 8, 'Mavi Yıldız', 4, 0, 1, 3, 2, 6],
        ]),
      },
      fixture: {
        id: 999,
        date: daysFromNow(1, 20),
        league: 'Demo Ligi',
        round: '5. Hafta',
        venue: { name: 'Demo Arena', city: 'İstanbul' },
      },
      weather: {
        city: 'İstanbul',
        temperature: 18.4,
        precipitationProbability: 65,
        windSpeed: 14,
        description: 'Yağışlı',
        icon: '🌧️',
      },
      oddsStatus: 'ok',
      odds: {
        bookmaker: 'Demo Bahis',
        matchWinner: { home: 2.1, draw: 3.4, away: 3.3 },
        overUnder: [
          { line: '1.5', over: 1.3, under: 3.4 },
          { line: '2.5', over: 1.95, under: 1.85 },
          { line: '3.5', over: 3.2, under: 1.35 },
        ],
      },
      home: {
        id: 1,
        name: 'Demo Spor',
        logo: '',
        recent: recent([
          [4, 'Deneme Gücü', true, 2, 0],
          [11, 'Test Belediye', false, 1, 1],
          [18, 'Prova SK', true, 3, 1],
          [25, 'Kontrol FK', false, 0, 1],
          [32, 'Taslak Spor', true, 2, 2],
          [39, 'Deneme Gücü', false, 1, 0],
          [46, 'Örnek FK', true, 2, 1],
          [53, 'Prova SK', false, 0, 0],
          [60, 'Test Belediye', true, 4, 2],
          [67, 'Kontrol FK', false, 1, 2],
        ]),
        upcoming: [
          { date: daysFromNow(6), league: 'Demo Ligi', isHome: false, opponent: { name: 'Prova SK', logo: '' } },
          { date: daysFromNow(10), league: 'Demo Kupası', isHome: true, opponent: { name: 'Kontrol FK', logo: '' } },
        ],
        absences: [
          { teamId: 1, name: 'Ali Yılmaz', reason: 'Diz sakatlığı', category: 'injury', doubtful: false },
          { teamId: 1, name: 'Mert Kaya', reason: 'Kas sakatlığı', category: 'injury', doubtful: true },
          { teamId: 1, name: 'Burak Demir', reason: 'Sarı kart cezası', category: 'yellow', doubtful: false },
        ],
      },
      away: {
        id: 2,
        name: 'Örnek FK',
        logo: '',
        recent: recent([
          [3, 'Taslak Spor', false, 1, 2],
          [10, 'Kontrol FK', true, 3, 0],
          [17, 'Test Belediye', false, 2, 2],
          [24, 'Deneme Gücü', true, 1, 0],
          [31, 'Prova SK', false, 0, 2],
          [38, 'Taslak Spor', true, 2, 1],
          [45, 'Demo Spor', false, 1, 2],
          [52, 'Kontrol FK', true, 1, 1],
          [59, 'Deneme Gücü', false, 0, 1],
          [66, 'Test Belediye', true, 2, 0],
        ]),
        upcoming: [
          { date: daysFromNow(3), league: 'Demo Kupası', isHome: true, opponent: { name: 'Taslak Spor', logo: '' } },
          { date: daysFromNow(7), league: 'Demo Ligi', isHome: true, opponent: { name: 'Deneme Gücü', logo: '' } },
        ],
        absences: [
          { teamId: 2, name: 'Emre Şahin', reason: 'Arka adale sakatlığı', category: 'injury', doubtful: false },
          { teamId: 2, name: 'Can Aydın', reason: 'Kırmızı kart cezası', category: 'red', doubtful: false },
        ],
      },
      warnings: [],
    };
  }

  window.CO = window.CO || {};
  window.CO.demo = { teams, buildReport };
})();
