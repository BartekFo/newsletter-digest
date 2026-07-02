import { silentLogger } from './logger.js';
import type { AppLogger, WeatherSummary } from './types.js';

const GEOCODE_URL = 'https://geocoding-api.open-meteo.com/v1/search';
const FORECAST_URL = 'https://api.open-meteo.com/v1/forecast';
const TIMEOUT_MS = 5000;

/**
 * WMO weather interpretation codes → Polish description.
 * https://open-meteo.com/en/docs (Weather variable documentation).
 */
const WMO_CODES: Record<number, string> = {
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
export function weatherCodeToText(code: number): string {
  return WMO_CODES[code] ?? 'Nieznane warunki';
}

/**
 * Resolve a city name to coordinates via the Open-Meteo geocoding API.
 * @param {string} city
 * @returns {Promise<{lat: number, lon: number, name: string}>}
 */
interface GeocodeResponse {
  results?: Array<{ latitude: number; longitude: number; name: string }>;
}

interface ForecastResponse {
  current?: {
    temperature_2m?: number;
    weather_code?: number;
  };
  daily?: {
    temperature_2m_max?: number[];
    temperature_2m_min?: number[];
    precipitation_probability_max?: number[];
  };
}

function errorMessage(err: unknown): string {
  return err instanceof Error ? err.message : String(err);
}

export async function geocodeCity(city: string): Promise<{ lat: number; lon: number; name: string }> {
  const url = `${GEOCODE_URL}?name=${encodeURIComponent(city)}&count=1&language=pl&format=json`;
  const res = await fetch(url, { signal: AbortSignal.timeout(TIMEOUT_MS) });
  if (!res.ok) throw new Error(`Geocoding failed: HTTP ${res.status}`);

  const data = (await res.json()) as GeocodeResponse;
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
 * @param {import('pino').Logger} [logger=silentLogger]
 * @returns {Promise<{city: string, temp: number, code: number, description: string,
 *   max: number, min: number, precipProb: number} | null>}
 */
export async function fetchWeather(
  config: { weatherCity: string },
  logger: AppLogger = silentLogger,
): Promise<WeatherSummary | null> {
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

    const data = (await res.json()) as ForecastResponse;
    const code = data.current?.weather_code as number;

    return {
      city: name,
      temp: Math.round(data.current?.temperature_2m as number),
      code,
      description: weatherCodeToText(code),
      max: Math.round(data.daily?.temperature_2m_max?.[0] as number),
      min: Math.round(data.daily?.temperature_2m_min?.[0] as number),
      precipProb: data.daily?.precipitation_probability_max?.[0] ?? 0,
    };
  } catch (err) {
    logger.warn({ err: errorMessage(err), city: config.weatherCity }, 'Pogoda niedostępna');
    return null;
  }
}
