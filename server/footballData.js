import { cached } from './cache.js';

const BASE_URL = 'https://api.football-data.org/v4';
// Ücretsiz plan dakikada 10 istek verir; bir pay bırakılır.
const REQUESTS_PER_MINUTE = 9;
const MINUTE = 60_000;
const HOUR = 3600;
const DAY = 24 * HOUR;

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const recentRequests = [];

async function waitForSlot() {
  for (;;) {
    const now = Date.now();
    while (recentRequests.length && now - recentRequests[0] >= MINUTE) recentRequests.shift();
    if (recentRequests.length < REQUESTS_PER_MINUTE) {
      recentRequests.push(now);
      return;
    }
    await sleep(MINUTE - (now - recentRequests[0]) + 50);
  }
}

async function fetchJson(url, attempt = 0) {
  await waitForSlot();
  const res = await fetch(url, { headers: { 'X-Auth-Token': process.env.FOOTBALL_DATA_TOKEN } });

  if (res.status === 429 && attempt < 2) {
    const resetSeconds = Number(res.headers.get('X-RequestCounter-Reset')) || 60;
    await sleep(resetSeconds * 1000 + 500);
    return fetchJson(url, attempt + 1);
  }

  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(`football-data.org: ${data.message || `HTTP ${res.status}`}`);
  return data;
}

function request(path, params, ttlSeconds) {
  const url = new URL(BASE_URL + path);
  for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value);
  return cached(url.toString(), ttlSeconds, () => fetchJson(url));
}

export const competitionTeams = (code) => request(`/competitions/${code}/teams`, {}, DAY);

// Tek istekte takımın hem oynanmış hem planlanmış maçları gelir.
export const teamMatches = (teamId, dateFrom, dateTo) =>
  request(`/teams/${teamId}/matches`, { dateFrom, dateTo }, HOUR / 2);

export const match = (matchId) => request(`/matches/${matchId}`, {}, HOUR).then((data) => data.match ?? data);

export const headToHead = (matchId, limit = 10) => request(`/matches/${matchId}/head2head`, { limit }, 6 * HOUR);

export const standings = (code) => request(`/competitions/${code}/standings`, {}, HOUR);
