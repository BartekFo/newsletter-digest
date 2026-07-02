// @ts-nocheck
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weatherCodeToText, fetchWeather } from '../src/weather.js';

// ---------------------------------------------------------------------------
// Unit tests for weatherCodeToText (no network)
// ---------------------------------------------------------------------------

test('weatherCodeToText: known codes map to Polish text', () => {
  assert.equal(weatherCodeToText(0), 'Bezchmurnie');
  assert.equal(weatherCodeToText(61), 'Lekki deszcz');
  assert.equal(weatherCodeToText(95), 'Burza');
});

test('weatherCodeToText: unknown code falls back', () => {
  assert.equal(weatherCodeToText(9999), 'Nieznane warunki');
});

// ---------------------------------------------------------------------------
// Integration test — skips gracefully when Open-Meteo is unreachable
// ---------------------------------------------------------------------------

let apiReachable = false;
try {
  const res = await fetch('https://geocoding-api.open-meteo.com/v1/search?name=Warsaw&count=1', {
    signal: AbortSignal.timeout(3000),
  });
  apiReachable = res.ok;
} catch {
  apiReachable = false;
}

test(
  'fetchWeather: returns shaped object for a real city (integration)',
  { skip: !apiReachable ? 'Open-Meteo not reachable — skipping integration test' : false, timeout: 20_000 },
  async () => {
    const weather = await fetchWeather({ weatherCity: 'Warsaw' });

    assert.ok(weather, 'weather should not be null');
    assert.equal(typeof weather.temp, 'number', 'temp must be a number');
    assert.equal(typeof weather.description, 'string', 'description must be a string');
    assert.ok(weather.city.length > 0, 'city must be non-empty');
  },
);

test('fetchWeather: bad city returns null (failure-safe)', async () => {
  const weather = await fetchWeather({ weatherCity: 'zzzzzzznotacity12345' });
  assert.equal(weather, null);
});
