// The Odds API: bir ligin yaklaşan tüm maçlarının oranları tek istekte gelir.
// Ücretsiz planda ayda 500 kredi var (her istek pazar sayısı kadar kredi harcar), bu yüzden 6 saat önbelleğe alınır.
import { cached } from './cache.js';
import { COMPETITIONS } from './config.js';
import { normalize } from './text.js';

const BASE_URL = 'https://api.the-odds-api.com/v4';
// Ücretsiz planda aylık 500 kredi var; 12 saatlik önbellek harcamayı düşük tutar.
const CACHE_SECONDS = 12 * 3600;
const MAX_KICKOFF_DIFF_MS = 3 * 3600 * 1000;
const STOP_WORDS = new Set(['fc', 'cf', 'afc', 'sc', 'ac', 'ssc', 'as', 'club', 'de', 'cd', 'ud', 'rc', 'sv', 'fk', 'if', 'ca', 'se', 'ec', 'calcio', 'clube', 'futebol', 'football', 'the', 'and', '1']);

async function fetchLeagueOdds(sport, markets) {
  const url = new URL(`${BASE_URL}/sports/${sport}/odds`);
  url.search = new URLSearchParams({
    regions: 'eu',
    markets,
    oddsFormat: 'decimal',
    dateFormat: 'iso',
    apiKey: process.env.ODDS_API_KEY,
  });
  const res = await fetch(url);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(`The Odds API: ${data.message || `HTTP ${res.status}`}`);
    err.status = res.status;
    throw err;
  }
  const remaining = res.headers.get('x-requests-remaining');
  if (remaining !== null) console.log(`The Odds API kalan kredi: ${remaining}`);
  return data;
}

function leagueOdds(sport) {
  return cached(`odds:${sport}`, CACHE_SECONDS, async () => {
    try {
      return await fetchLeagueOdds(sport, 'h2h,totals');
    } catch (err) {
      // Bazı liglerde alt/üst pazarı olmayabilir: sadece maç sonucu istenir.
      if (err.status === 422) return fetchLeagueOdds(sport, 'h2h');
      throw err;
    }
  });
}

const tokens = (name) => normalize(name).split(' ').filter((t) => t && !STOP_WORDS.has(t));

// "Inter" ile "Internazionale", "Milan" ile "Milano" gibi kısaltmalar da eşleşir.
function similarity(a, b) {
  const A = tokens(a);
  const B = tokens(b);
  if (!A.length || !B.length) return 0;
  const same = (x, y) => x === y || (Math.min(x.length, y.length) >= 4 && (x.startsWith(y) || y.startsWith(x)));
  const shared = A.filter((x) => B.some((y) => same(x, y))).length;
  return shared / Math.min(A.length, B.length);
}

function findEvent(events, homeName, awayName, kickoffIso) {
  const kickoff = new Date(kickoffIso).getTime();
  let best = null;
  for (const event of events) {
    if (Math.abs(new Date(event.commence_time).getTime() - kickoff) > MAX_KICKOFF_DIFF_MS) continue;
    const home = similarity(homeName, event.home_team);
    const away = similarity(awayName, event.away_team);
    if (home < 0.5 || away < 0.5) continue;
    if (!best || home + away > best.score) best = { event, score: home + away };
  }
  return best?.event ?? null;
}

// Her pazar için bütün şirketler taranır ve en yüksek oran seçilir (aynı istekte geldiği için ek kredi harcamaz).
function parseEvent(event) {
  const books = {};

  function best(marketKey, pick) {
    let top = null;
    for (const bookmaker of event.bookmakers ?? []) {
      const outcome = bookmaker.markets?.find((m) => m.key === marketKey)?.outcomes.find(pick);
      const price = Number(outcome?.price);
      if (price > 0 && (!top || price > top.price)) top = { price, title: bookmaker.title };
    }
    return top;
  }

  function odd(field, marketKey, pick) {
    const top = best(marketKey, pick);
    if (top) books[field] = top.title;
    return top?.price ?? null;
  }

  const matchWinner = {
    home: odd('home', 'h2h', (o) => o.name === event.home_team),
    draw: odd('draw', 'h2h', (o) => o.name === 'Draw'),
    away: odd('away', 'h2h', (o) => o.name === event.away_team),
  };

  const overUnder = [1.5, 2.5, 3.5]
    .map((point) => ({
      line: point.toFixed(1),
      over: odd(`over${point}`, 'totals', (o) => o.name === 'Over' && o.point === point),
      under: odd(`under${point}`, 'totals', (o) => o.name === 'Under' && o.point === point),
    }))
    .filter((l) => l.over || l.under);

  if (!matchWinner.home && !overUnder.length) return null;

  const titles = [...new Set(Object.values(books))];
  return {
    bookmaker: titles.length > 1 ? `en iyi oran · ${titles.length} şirket` : titles[0] ?? 'bilinmiyor',
    books,
    matchWinner,
    overUnder,
  };
}

// status: ok | no-key | unsupported | not-found
export async function matchOdds(competitionCode, homeName, awayName, kickoffIso) {
  if (!process.env.ODDS_API_KEY) return { status: 'no-key', odds: null };
  const sport = COMPETITIONS.find((c) => c.code === competitionCode)?.odds;
  if (!sport) return { status: 'unsupported', odds: null };

  const event = findEvent(await leagueOdds(sport), homeName, awayName, kickoffIso);
  const odds = event ? parseEvent(event) : null;
  return odds ? { status: 'ok', odds } : { status: 'not-found', odds: null };
}
