import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { buildFixtureReport, buildMatchReport } from './report.js';
import { loadIndex, searchTeams } from './teamIndex.js';

const app = express();
const PORT = process.env.PORT || 3000;
const hasToken = Boolean(process.env.FOOTBALL_DATA_TOKEN);
const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

app.use(express.static(publicDir));

app.get('/api/status', (req, res) => res.json({ demo: !hasToken, odds: Boolean(process.env.ODDS_API_KEY) }));

app.use('/api', (req, res, next) => {
  if (!hasToken) {
    return res.status(503).json({ error: 'football-data.org anahtarı tanımlı değil (.env içinde FOOTBALL_DATA_TOKEN).' });
  }
  next();
});

app.get('/api/teams', async (req, res, next) => {
  const q = String(req.query.q ?? '').trim();
  if (q.length < 3) return res.status(400).json({ error: 'En az 3 harf yazın.' });
  try {
    const teams = await searchTeams(q);
    res.json(teams.map(({ id, name, logo, country, league }) => ({ id, name, logo, country, league })));
  } catch (err) {
    next(err);
  }
});

app.get('/api/match/:teamId', async (req, res, next) => {
  const teamId = Number(req.params.teamId);
  if (!Number.isInteger(teamId)) return res.status(400).json({ error: 'Geçersiz takım.' });
  try {
    const report = await buildMatchReport(teamId);
    if (!report) {
      return res.status(404).json({ error: 'Bu takımın önümüzdeki 45 gün içinde desteklenen bir ligde maçı bulunamadı.' });
    }
    res.json(report);
  } catch (err) {
    next(err);
  }
});

// Geçmiş ya da ileri tarihli belirli bir maçın raporu
app.get('/api/fixture/:fixtureId', async (req, res, next) => {
  const fixtureId = Number(req.params.fixtureId);
  if (!Number.isInteger(fixtureId)) return res.status(400).json({ error: 'Geçersiz maç.' });
  try {
    const report = await buildFixtureReport(fixtureId);
    if (!report) return res.status(404).json({ error: 'Maç bulunamadı.' });
    res.json(report);
  } catch (err) {
    next(err);
  }
});

app.use((err, req, res, next) => {
  console.error(err);
  res.status(502).json({ error: err.message });
});

app.listen(PORT, () => {
  console.log(`Competition Odds çalışıyor: http://localhost:${PORT}${hasToken ? '' : ' (demo modu)'}`);
  if (!hasToken) return;
  // Takım listesi arka planda hazırlanır; ilk arama beklemek zorunda kalmaz.
  loadIndex()
    .then((teams) => console.log(`${teams.length} takım aramaya hazır.`))
    .catch((err) => console.warn(err.message));
  if (!process.env.ODDS_API_KEY) console.log('ODDS_API_KEY tanımlı değil: oranlar gösterilmeyecek.');
});
