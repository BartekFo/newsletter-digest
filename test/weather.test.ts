import { test } from 'node:test';
import assert from 'node:assert/strict';
import { weatherCodeToText, fetchWeather, type WeatherClient } from '../src/weather.js';
import { silentLogger } from '../src/logger.js';

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

test('fetchWeather: shapes data from an injected Open-Meteo client', async () => {
  const client: WeatherClient = {
    async geocode(city) {
      assert.equal(city, 'Warsaw');
      return { lat: 52.23, lon: 21.01, name: 'Warszawa' };
    },
    async forecast(coordinates) {
      assert.deepEqual(coordinates, { lat: 52.23, lon: 21.01 });
      return {
        current: { temperature_2m: 18.6, weather_code: 61 },
        daily: {
          temperature_2m_max: [22.4],
          temperature_2m_min: [11.7],
          precipitation_probability_max: [65],
        },
      };
    },
  };

  const weather = await fetchWeather({ weatherCity: 'Warsaw' }, silentLogger, client);

  assert.deepEqual(weather, {
    city: 'Warszawa',
    temp: 19,
    code: 61,
    description: 'Lekki deszcz',
    max: 22,
    min: 12,
    precipProb: 65,
  });
});

test('fetchWeather: client failure returns null without throwing', async () => {
  const client: WeatherClient = {
    async geocode() {
      throw new Error('Open-Meteo unavailable');
    },
    async forecast() {
      throw new Error('forecast should not be called');
    },
  };

  const weather = await fetchWeather({ weatherCity: 'Warsaw' }, silentLogger, client);
  assert.equal(weather, null);
});
