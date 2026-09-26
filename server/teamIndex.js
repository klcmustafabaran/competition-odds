// football-data.org'da takım arama ucu yok. Desteklenen liglerin takım listeleri bir kez çekilip
// diske kaydedilir, arama bu liste üzerinde yapılır.
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { COMPETITIONS } from './config.js';
import { competitionTeams } from './footballData.js';
import { normalize } from './text.js';

const SERVER_DIR = path.dirname(fileURLToPath(import.meta.url));
const CACHE_FILE = path.join(SERVER_DIR, '.cache', 'teams.json');
// Yayındaki sunucu her açıldığında listeyi baştan çekmesin diye projeyle gelen hazır liste.
const SEED_FILE = path.join(SERVER_DIR, 'teams-seed.json');
const MAX_AGE_MS = 7 * 24 * 3600 * 1000;

let indexPromise = null;

function toEntry(team, competition) {
  return {
    id: team.id,
    name: team.shortName || team.name,
    fullName: team.name,
    tla: team.tla,
    logo: team.crest,
    venue: team.venue,
    address: team.address,
    areaCode: team.area?.code,
    country: competition.country,
    league: competition.name,
  };
}

async function readList(file, checkAge) {
  try {
    const data = JSON.parse(await fs.readFile(file, 'utf8'));
    if (!data.teams?.length) return null;
    if (checkAge && Date.now() - data.builtAt >= MAX_AGE_MS) return null;
    return data.teams;
  } catch {
    // Dosya yok ya da bozuk: bir sonraki kaynağa geçilir.
  }
  return null;
}

const readCache = () => readList(CACHE_FILE, true);

async function build() {
  const byId = new Map();
  for (const competition of COMPETITIONS.filter((c) => c.index !== false)) {
    try {
      const data = await competitionTeams(competition.code);
      for (const team of data.teams ?? []) {
        if (!byId.has(team.id)) byId.set(team.id, toEntry(team, competition));
      }
    } catch (err) {
      console.warn(`${competition.name} takımları alınamadı: ${err.message}`);
    }
  }

  const teams = [...byId.values()];
  if (!teams.length) throw new Error('Takım listesi alınamadı. FOOTBALL_DATA_TOKEN doğru mu?');

  await fs.mkdir(path.dirname(CACHE_FILE), { recursive: true });
  await fs.writeFile(CACHE_FILE, JSON.stringify({ builtAt: Date.now(), teams }));
  return teams;
}

export function loadIndex() {
  if (!indexPromise) {
    indexPromise = (async () => (await readCache()) ?? (await readList(SEED_FILE, false)) ?? build())().catch((err) => {
      indexPromise = null;
      throw err;
    });
  }
  return indexPromise;
}

export async function getTeam(id) {
  const teams = await loadIndex();
  return teams.find((t) => t.id === id) ?? null;
}

export async function searchTeams(query) {
  const q = normalize(query);
  const teams = await loadIndex();
  return teams
    .map((team) => {
      const names = [team.name, team.fullName, team.tla].filter(Boolean).map(normalize);
      let score = 0;
      if (names.includes(q)) score = 3;
      else if (names.some((n) => n.startsWith(q) || n.split(' ').some((w) => w.startsWith(q)))) score = 2;
      else if (names.some((n) => n.includes(q))) score = 1;
      return { team, score };
    })
    .filter((x) => x.score)
    .sort((a, b) => b.score - a.score || a.team.name.localeCompare(b.team.name, 'tr'))
    .slice(0, 10)
    .map((x) => x.team);
}
