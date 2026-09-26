import { cached } from './cache.js';

// WMO hava durumu kodları -> [açıklama, ikon]
const WEATHER_CODES = {
  0: ['Açık', '☀️'],
  1: ['Az bulutlu', '🌤️'],
  2: ['Parçalı bulutlu', '⛅'],
  3: ['Kapalı', '☁️'],
  45: ['Sisli', '🌫️'],
  48: ['Kırağılı sis', '🌫️'],
  51: ['Hafif çisenti', '🌦️'],
  53: ['Çisenti', '🌦️'],
  55: ['Yoğun çisenti', '🌧️'],
  61: ['Hafif yağış', '🌦️'],
  63: ['Yağışlı', '🌧️'],
  65: ['Kuvvetli yağış', '🌧️'],
  71: ['Hafif kar', '🌨️'],
  73: ['Kar', '🌨️'],
  75: ['Yoğun kar', '❄️'],
  80: ['Sağanak', '🌦️'],
  81: ['Kuvvetli sağanak', '🌧️'],
  82: ['Şiddetli sağanak', '⛈️'],
  95: ['Gök gürültülü fırtına', '⛈️'],
  96: ['Dolu ile fırtına', '⛈️'],
  99: ['Dolu ile fırtına', '⛈️'],
};

async function getJson(url, ttlSeconds) {
  return cached(url, ttlSeconds, async () => {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Open-Meteo HTTP ${res.status}`);
    return res.json();
  });
}

async function geocode(candidates, countryCode) {
  // Adresten çıkarılan birden fazla aday sırayla denenir; ülke kodu aynı adlı başka şehirleri eler.
  for (const name of candidates) {
    const params = new URLSearchParams({ count: '1', language: 'tr', name });
    if (countryCode) params.set('countryCode', countryCode);
    const url = `https://geocoding-api.open-meteo.com/v1/search?${params}`;
    const data = await getJson(url, 30 * 24 * 3600);
    if (data.results?.length) return data.results[0];
  }
  return null;
}

export async function getMatchWeather(cityCandidates, kickoffIso, countryCode) {
  const candidates = cityCandidates.filter(Boolean);
  if (!candidates.length) return null;

  const kickoff = new Date(kickoffIso);
  const daysAhead = (kickoff - Date.now()) / 86_400_000;
  // Open-Meteo en fazla ~16 gün sonrasını tahmin eder.
  if (daysAhead > 15 || daysAhead < -1) return null;

  const place = await geocode(candidates, countryCode);
  if (!place) return null;

  const day = kickoff.toISOString().slice(0, 10);
  const url =
    `https://api.open-meteo.com/v1/forecast?latitude=${place.latitude}&longitude=${place.longitude}` +
    `&hourly=temperature_2m,precipitation_probability,weather_code,wind_speed_10m` +
    `&timezone=GMT&start_date=${day}&end_date=${day}`;
  const data = await getJson(url, 3600);

  const hour = kickoff.toISOString().slice(0, 13) + ':00';
  const i = data.hourly.time.indexOf(hour);
  if (i === -1) return null;

  const [description, icon] = WEATHER_CODES[data.hourly.weather_code[i]] ?? ['Bilinmiyor', '🌡️'];
  return {
    city: place.name,
    temperature: data.hourly.temperature_2m[i],
    precipitationProbability: data.hourly.precipitation_probability[i],
    windSpeed: data.hourly.wind_speed_10m[i],
    description,
    icon,
  };
}
