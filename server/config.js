// football-data.org ücretsiz planındaki organizasyonlar ve The Odds API'deki karşılıkları.
// index: false olanların takımları aramaya eklenmez (Şampiyonlar Ligi takımları zaten ulusal liglerde var).
const FREE_COMPETITIONS = [
  { code: 'PL', name: 'Premier Lig', country: 'İngiltere', odds: 'soccer_epl' },
  { code: 'ELC', name: 'Championship', country: 'İngiltere', odds: 'soccer_efl_champ' },
  { code: 'PD', name: 'La Liga', country: 'İspanya', odds: 'soccer_spain_la_liga' },
  { code: 'SA', name: 'Serie A', country: 'İtalya', odds: 'soccer_italy_serie_a' },
  { code: 'BL1', name: 'Bundesliga', country: 'Almanya', odds: 'soccer_germany_bundesliga' },
  { code: 'FL1', name: 'Ligue 1', country: 'Fransa', odds: 'soccer_france_ligue_one' },
  { code: 'DED', name: 'Eredivisie', country: 'Hollanda', odds: 'soccer_netherlands_eredivisie' },
  { code: 'PPL', name: 'Primeira Liga', country: 'Portekiz', odds: 'soccer_portugal_primeira_liga' },
  { code: 'BSA', name: 'Brezilya Serie A', country: 'Brezilya', odds: 'soccer_brazil_campeonato' },
  { code: 'CL', name: 'Şampiyonlar Ligi', country: 'Avrupa', odds: 'soccer_uefa_champs_league', index: false },
];

// Ücretli planlarda açılan ligler. .env içindeki EXTRA_LEAGUES ile etkinleşir, örnek:
// EXTRA_LEAGUES=EL1,EL2
// Ücretsiz planda bu ligler HTTP 403 döndürür, bu yüzden varsayılan olarak kapalıdır.
const PAID_COMPETITIONS = [
  { code: 'EL1', name: 'League One', country: 'İngiltere', odds: 'soccer_england_league1' },
  { code: 'EL2', name: 'League Two', country: 'İngiltere', odds: 'soccer_england_league2' },
];

const enabledExtras = (process.env.EXTRA_LEAGUES ?? '')
  .split(',')
  .map((code) => code.trim().toUpperCase())
  .filter(Boolean);

export const COMPETITIONS = [
  ...FREE_COMPETITIONS,
  ...PAID_COMPETITIONS.filter((c) => enabledExtras.includes(c.code)),
];

// football-data.org ülke kodu -> Open-Meteo'nun beklediği ISO ülke kodu (hava durumu için şehir aramasında)
export const COUNTRY_CODES = {
  ENG: 'GB', WAL: 'GB', SCO: 'GB', ESP: 'ES', ITA: 'IT', DEU: 'DE', GER: 'DE',
  FRA: 'FR', MON: 'MC', MCO: 'MC', NLD: 'NL', NED: 'NL', POR: 'PT', PRT: 'PT', BRA: 'BR',
};
