import { COMPETITIONS, COUNTRY_CODES } from './config.js';
import * as fd from './footballData.js';
import { matchOdds } from './oddsApi.js';
import { getTeam } from './teamIndex.js';
import { getMatchWeather } from './weather.js';

const UPCOMING = new Set(['SCHEDULED', 'TIMED', 'IN_PLAY', 'PAUSED']);
const STAGE_TR = {
  LEAGUE_STAGE: 'Lig aşaması',
  GROUP_STAGE: 'Grup aşaması',
  PLAYOFFS: 'Play-off',
  LAST_16: 'Son 16',
  QUARTER_FINALS: 'Çeyrek final',
  SEMI_FINALS: 'Yarı final',
  FINAL: 'Final',
};
const DAY_MS = 86_400_000;
const LIVE_WINDOW_MS = 3 * 3600 * 1000;

const isoDay = (date) => date.toISOString().slice(0, 10);
const displayName = (team) => team.shortName || team.name;
const competitionName = (competition) =>
  COMPETITIONS.find((c) => c.code === competition.code)?.name ?? competition.name;
const byDateAsc = (a, b) => new Date(a.utcDate) - new Date(b.utcDate);

// Geçmiş bir maç incelenirken pencere o maçın tarihine göre kaydırılır.
function matchesAround(teamId, reference = Date.now()) {
  const center = new Date(reference).getTime();
  return fd
    .teamMatches(teamId, isoDay(new Date(center - 180 * DAY_MS)), isoDay(new Date(center + 45 * DAY_MS)))
    .then((data) => data.matches ?? []);
}

// "Sir Matt Busby Way Manchester M16 0RA" -> ["Manchester", "Way Manchester"]
function cityCandidates(address) {
  if (!address) return [];
  const words = address
    .replace(/,/g, ' ')
    .split(/\s+/)
    .filter((w) => /^[\p{L}'-]{3,}$/u.test(w));
  const last = words.at(-1);
  return last ? [last, words.slice(-2).join(' ')] : [];
}

function fromTeamView(match, teamId) {
  const isHome = match.homeTeam.id === teamId;
  const opponent = isHome ? match.awayTeam : match.homeTeam;
  const { home, away } = match.score.fullTime;
  const goalsFor = isHome ? home : away;
  const goalsAgainst = isHome ? away : home;
  return {
    id: match.id,
    date: match.utcDate,
    league: competitionName(match.competition),
    isHome,
    opponent: { id: opponent.id, name: displayName(opponent), logo: opponent.crest },
    goalsFor,
    goalsAgainst,
    result: goalsFor > goalsAgainst ? 'G' : goalsFor < goalsAgainst ? 'M' : 'B',
  };
}

function buildTeam(team, matches, kickoff, fixtureId) {
  const recent = matches
    .filter((m) => m.status === 'FINISHED' && m.score.fullTime.home !== null && new Date(m.utcDate) < kickoff)
    .sort((a, b) => byDateAsc(b, a))
    .slice(0, 20)
    .map((m) => fromTeamView(m, team.id));

  const upcoming = matches
    .filter((m) => UPCOMING.has(m.status) && m.id !== fixtureId && new Date(m.utcDate) > kickoff)
    .sort(byDateAsc)
    .slice(0, 3)
    .map((m) => {
      const { id, date, league, isHome, opponent } = fromTeamView(m, team.id);
      return { id, date, league, isHome, opponent };
    });

  // Ücretsiz kaynakta sakat/cezalı bilgisi yok; null arayüzde "veri yok" olarak gösterilir.
  return { id: team.id, name: displayName(team), logo: team.crest, recent, upcoming, absences: null };
}

function parseHeadToHead(data) {
  const pick = (t) => ({ id: t.id, name: displayName(t), logo: t.crest });
  return (data.matches ?? [])
    .filter((m) => m.status === 'FINISHED' && m.score.fullTime.home !== null)
    .sort((a, b) => byDateAsc(b, a))
    .map((m) => ({
      id: m.id,
      date: m.utcDate,
      league: competitionName(m.competition),
      home: pick(m.homeTeam),
      away: pick(m.awayTeam),
      goals: { home: m.score.fullTime.home, away: m.score.fullTime.away },
    }));
}

// Bir tablodaki toplam maç başına gol (takım başına): lig ortalaması ve ev/deplasman katsayıları için.
function goalsPerMatch(table) {
  if (!table?.length) return null;
  const played = table.reduce((t, r) => t + (r.playedGames ?? 0), 0);
  const goals = table.reduce((t, r) => t + (r.all?.goalsFor ?? r.goalsFor ?? 0), 0);
  return played > 0 ? goals / played : null;
}

function parseStandings(data, homeId, awayId, leagueName) {
  const standings = data.standings ?? [];
  const groups = standings.filter((s) => s.type === 'TOTAL');
  const group = groups.find((g) => g.table.some((r) => r.team.id === homeId || r.team.id === awayId));
  if (!group) return null;

  // Ligin kendi ev sahibi avantajı: sabit varsayım yerine HOME/AWAY tablolarından hesaplanır.
  const sameGroup = (s) => s.group === group.group;
  const homeTable = standings.find((s) => s.type === 'HOME' && sameGroup(s))?.table;
  const awayTable = standings.find((s) => s.type === 'AWAY' && sameGroup(s))?.table;

  return {
    league: group.group ? `${leagueName} · ${group.group.replace('GROUP_', 'Grup ')}` : leagueName,
    context: {
      leagueAvgGoals: goalsPerMatch(group.table),
      homeAvgGoals: goalsPerMatch(homeTable),
      awayAvgGoals: goalsPerMatch(awayTable),
    },
    rows: group.table.map((r) => ({
      rank: r.position,
      team: { id: r.team.id, name: displayName(r.team), logo: r.team.crest },
      played: r.playedGames,
      win: r.won,
      draw: r.draw,
      lose: r.lost,
      goalsFor: r.goalsFor,
      goalsAgainst: r.goalsAgainst,
      goalDiff: r.goalDifference,
      points: r.points,
    })),
  };
}

export async function buildMatchReport(teamId) {
  const ownMatches = await matchesAround(teamId);
  const fx = ownMatches
    .filter((m) => UPCOMING.has(m.status) && new Date(m.utcDate).getTime() > Date.now() - LIVE_WINDOW_MS)
    .sort(byDateAsc)[0];
  if (!fx) return null;
  return buildReport(fx, teamId, ownMatches);
}

// Geçmiş (ya da başka bir) maçın raporu: her şey o maçın öncesindeki duruma göre hesaplanır.
export async function buildFixtureReport(fixtureId) {
  const fx = await fd.match(fixtureId);
  if (!fx?.id) return null;
  return buildReport(fx, fx.homeTeam.id, await matchesAround(fx.homeTeam.id, fx.utcDate));
}

async function buildReport(fx, teamId, ownMatches) {
  const warnings = [];
  const settle = async (label, promise, fallback) => {
    try {
      return await promise;
    } catch (err) {
      warnings.push(`${label} alınamadı: ${err.message}`);
      return fallback;
    }
  };

  const homeId = fx.homeTeam.id;
  const awayId = fx.awayTeam.id;
  const otherId = homeId === teamId ? awayId : homeId;
  const leagueName = competitionName(fx.competition);
  const isCup = fx.competition.type === 'CUP';

  const played = !UPCOMING.has(fx.status);

  const [otherMatches, h2h, table, homeInfo] = await Promise.all([
    settle('Rakibin maçları', matchesAround(otherId, fx.utcDate), []),
    settle('Aralarındaki maçlar', fd.headToHead(fx.id), {}),
    isCup ? {} : settle('Puan durumu', fd.standings(fx.competition.code), {}),
    getTeam(homeId).catch(() => null),
  ]);

  const [oddsResult, weather] = await Promise.all([
    // Oran servisi yalnızca oynanmamış maçları verir.
    played ? { status: 'played', odds: null } : settle('Oranlar', matchOdds(fx.competition.code, fx.homeTeam.name, fx.awayTeam.name, fx.utcDate), null),
    // Hava durumu ikincil bilgidir; alınamazsa kullanıcıya uyarı gösterilmez, alan boş kalır.
    getMatchWeather(cityCandidates(homeInfo?.address), fx.utcDate, COUNTRY_CODES[homeInfo?.areaCode]).catch(() => null),
  ]);

  const matchesByTeam = { [teamId]: ownMatches, [otherId]: otherMatches };
  const kickoff = new Date(fx.utcDate);

  return {
    fixture: {
      id: fx.id,
      date: fx.utcDate,
      league: leagueName,
      round: fx.matchday ? `${fx.matchday}. Hafta` : STAGE_TR[fx.stage] ?? '',
      venue: { name: homeInfo?.venue ?? null, city: weather?.city ?? cityCandidates(homeInfo?.address)[0] ?? null },
    },
    played,
    // Oynanmış maçlarda gerçek sonuç: tahminle karşılaştırmak için.
    result: played ? { home: fx.score.fullTime.home, away: fx.score.fullTime.away } : null,
    weather,
    odds: oddsResult?.odds ?? null,
    oddsStatus: oddsResult?.status ?? 'error',
    headToHead: parseHeadToHead(h2h),
    standings: parseStandings(table, homeId, awayId, leagueName),
    home: buildTeam(fx.homeTeam, matchesByTeam[homeId], kickoff, fx.id),
    away: buildTeam(fx.awayTeam, matchesByTeam[awayId], kickoff, fx.id),
    warnings,
  };
}
