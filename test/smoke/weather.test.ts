import { test } from 'node:test';
import assert from 'node:assert/strict';

import { fetchWeather } from '../../src/weather.js';
import { isReachable } from './support.js';

const apiReachable = await isReachable(
  'https://geocoding-api.open-meteo.com/v1/search?name=Warsaw&count=1',
  3000,
);

test(
  'Open-Meteo returns weather for a real city',
  {
    skip: apiReachable ? false : 'Open-Meteo not reachable — skipping smoke test',
    timeout: 20_000,
  },
  async () => {
    const weather = await fetchWeather({ weatherCity: 'Warsaw' });

    assert.ok(weather, 'weather should not be null');
    assert.equal(typeof weather.temp, 'number', 'temp must be a number');
    assert.ok(weather.description.length > 0, 'description must be non-empty');
    assert.ok(weather.city.length > 0, 'city must be non-empty');
  },
);
