const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const TIMEOUT_MS = 5000;

/**
 * WMO weather interpretation codes → Polish description.
 * https://open-meteo.com/en/docs (Weather variable documentation).
 */
const WMO_CODES = {
  0: 'Bezchmurnie',
  1: 'Przeważnie bezchmurnie',
  2: 'Częściowe zachmurzenie',
  3: 'Pochmurno',
  45: 'Mgła',
  48: 'Mgła osadzająca szadź',
  51: 'Lekka mżawka',
  53: 'Umiarkowana mżawka',
  55: 'Gęsta mżawka',
  56: 'Marznąca mżawka',
  57: 'Gęsta marznąca mżawka',
  61: 'Lekki deszcz',
  63: 'Umiarkowany deszcz',
  65: 'Silny deszcz',
  66: 'Marznący deszcz',
  67: 'Silny marznący deszcz',
  71: 'Lekki śnieg',
  73: 'Umiarkowany śnieg',
  75: 'Silny śnieg',
  77: 'Krupa śnieżna',
  80: 'Przelotny lekki deszcz',
  81: 'Przelotny umiarkowany deszcz',
  82: 'Gwałtowne przelotne opady',
  85: 'Przelotny lekki śnieg',
  86: 'Przelotny silny śnieg',
  95: 'Burza',
  96: 'Burza z lekkim gradem',
  99: 'Burza z silnym gradem',
};

/**
 * Map a WMO weather code to a Polish text description.
 * @param {number} code
 * @returns {string}
 */
export function weatherCodeToText(code) {
  return WMO_CODES[code] ?? 'Nieznane warunki';
}

/**
 * Resolve a city name to coordinates via the Open-Meteo geocoding API.
 * @param {string} city
 * @returns {Promise<{lat: number, lon: number, name: string}>}
 */
export async function geocodeCity(city) {
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(city)}&count=1&language=pl&format=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Geocoding failed: HTTP ${res.status}`);

  const data = await res.json();
  const hit = data.results?.[0];
  if (!hit) throw new Error(`City not found: ${city}`);

  return { lat: hit.latitude, lon: hit.longitude, name: hit.name };
}

/**
 * Fetch current weather plus today's max/min and precipitation chance for the
 * configured city. Returns null on any failure (failure-safe — the digest must
 * render even when this API is unreachable).
 *
 * @param {{ weatherCity: string }} config
 * @returns {Promise<{city: string, temp: number, code: number, description: string,
 *   max: number, min: number, precipProb: number} | null>}
 */
export async function fetchWeather(config) {
  try {
    const { lat, lon, name } = await geocodeCity(config.weatherCity);

    const params = new URLSearchParams({
      latitude: String(lat),
      longitude: String(lon),
      current: 'temperature_2m,weather_code',
      daily: 'temperature_2m_max,temperature_2m_min,precipitation_probability_max',
      timezone: 'auto',
    });

    const res = await fetch(`${FORECAST_URL}?${params}`, {
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (!res.ok) throw new Error(`Forecast failed: HTTP ${res.status}`);

    const data = await res.json();
    const code = data.current?.weather_code;

    return {
      city: name,
      temp: Math.round(data.current?.temperature_2m),
      code,
      description: weatherCodeToText(code),
      max: Math.round(data.daily?.temperature_2m_max?.[0]),
      min: Math.round(data.daily?.temperature_2m_min?.[0]),
      precipProb: data.daily?.precipitation_probability_max?.[0] ?? 0,
    };
  } catch (err) {
    console.warn(`[digest] Weather unavailable: ${err.message}`);
    return null;
  }
}
