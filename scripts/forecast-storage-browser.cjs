// Start a local preview first. Tests real startup/rendering with all storage
// writes rejected, and genuine network failure followed by the Retry action.
const { chromium } = require(process.env.NEARCAST_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const preview = process.env.NEARCAST_PREVIEW_URL || 'http://127.0.0.1:4188/';
const place = { id: 'storage-test', name: 'Nokomis', admin1: 'Illinois', country_code: 'US', latitude: 39.301, longitude: -89.286 };
function forecast() {
  const now = new Date();
  const dates = [0, 1].map(n => new Date(+now + n * 86400000).toISOString().slice(0, 10));
  const times = dates.flatMap(d => Array.from({ length: 24 }, (_, h) => `${d}T${String(h).padStart(2, '0')}:00`));
  const fill = n => times.map(() => n);
  return {
    latitude: place.latitude, longitude: place.longitude, timezone: 'UTC', utc_offset_seconds: 0,
    current: { time: now.toISOString(), temperature_2m: 83, apparent_temperature: 85, weather_code: 3, is_day: 1, precipitation: 0, wind_speed_10m: 5, relative_humidity_2m: 60 },
    current_units: { temperature_2m: '°F', wind_speed_10m: 'mph' },
    daily: { time: dates, sunrise: dates.map(d => d + 'T06:30'), sunset: dates.map(d => d + 'T19:30'), weather_code: [3, 3], temperature_2m_max: [85, 86], temperature_2m_min: [65, 66], precipitation_probability_max: [0, 0], precipitation_sum: [0, 0], uv_index_max: [4, 4] },
    hourly: { time: times, temperature_2m: fill(83), apparent_temperature: fill(85), weather_code: fill(3), is_day: fill(1), precipitation_probability: fill(0), precipitation: fill(0), wind_speed_10m: fill(5), wind_gusts_10m: fill(8), wind_direction_10m: fill(90), relative_humidity_2m: fill(60), uv_index: fill(2) },
    _nearcastForecast: { version: 1, latitude: place.latitude, longitude: place.longitude, unit: 'fahrenheit', generatedAtMs: +now, sources: {} }
  };
}
(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    for (const failedNetwork of [false, true]) {
      const page = await browser.newPage({ viewport: { width: 390, height: 844 }, serviceWorkers: 'block' });
      page.setDefaultTimeout(10000);
      const errors = [];
      page.on('pageerror', e => { errors.push(e.message); console.error('Page error:', e.message); });
      let fail = failedNetwork;
      let attempts = 0;
      await page.route('**/*', route => {
        const url = new URL(route.request().url());
        if (url.pathname === '/api/forecast' || (url.hostname === 'api.open-meteo.com' && url.pathname === '/v1/forecast')) {
          attempts++;
          return route.fulfill({ status: fail ? 503 : 200, contentType: 'application/json', body: JSON.stringify(fail ? { error: 'test-provider-unavailable' } : forecast()) });
        }
        if (url.hostname === '127.0.0.1' && !url.pathname.startsWith('/api/')) return route.continue();
        return route.abort();
      });
      await page.addInitScript(p => {
        localStorage.setItem('weather-places', JSON.stringify([p]));
        localStorage.setItem('weather-last-place', JSON.stringify(p));
        localStorage.setItem('test-personal-sentinel', 'keep');
        window.rejectedStorageWrites = [];
        Storage.prototype.setItem = function(key) {
          window.rejectedStorageWrites.push(key);
          throw new DOMException('Simulated full storage', 'QuotaExceededError');
        };
      }, place);
      await page.goto(preview, { waitUntil: 'domcontentloaded' });
      if (failedNetwork) {
        await page.getByRole('button', { name: 'Retry weather', exact: true }).waitFor();
        assert.match(await page.locator('#status').innerText(), /Could not load weather/);
        assert.equal(await page.locator('#glanceTitle').innerText(), 'Forecast unavailable');
        assert.doesNotMatch(await page.locator('#nearcastBrief').innerText(), /Waking up/);
        await page.screenshot({ path: '/tmp/nearcast-forecast-retry.png' });
        fail = false;
        await page.getByRole('button', { name: 'Retry weather', exact: true }).click();
      }
      await page.waitForFunction(() => document.getElementById('nowTemp').textContent === '83°F', null, { timeout: 10000 }).catch(async error => {
        console.error(await page.evaluate(() => ({ mode: els.shell.className, temp: els.nowTemp.textContent, status: els.status.textContent, writes: window.rejectedStorageWrites })));
        throw error;
      });
      assert.equal(await page.locator('#status').textContent(), '');
      assert.doesNotMatch(await page.locator('#nearcastBrief').innerText(), /Waking up|Retry weather/);
      assert.notEqual(await page.locator('#glanceTitle').innerText(), 'Building your local weather read.');
      assert.ok(await page.locator('.day-row').count() > 0, 'daily forecast renders despite cache failure');
      const stored = await page.evaluate(() => ({ rejected: window.rejectedStorageWrites, places: localStorage.getItem('weather-places'), sentinel: localStorage.getItem('test-personal-sentinel') }));
      assert.ok(stored.rejected.some(k => k.startsWith('forecast:')), 'the forecast save really failed');
      assert.ok(stored.rejected.includes('weather-last-place'), 'remembering the last place also failed safely');
      assert.equal(JSON.parse(stored.places)[0].id, place.id);
      assert.equal(stored.sentinel, 'keep');
      assert.deepEqual(errors, [], 'storage failure never becomes an uncaught rendering error');
      if (!failedNetwork) await page.screenshot({ path: '/tmp/nearcast-storage-recovered.png' });
      assert.ok(attempts > 0);
      await page.close();
    }
    console.log('PASS browser: full-storage startup, complete forecast, preserved personal data, honest network error, and successful retry.');
  } finally { await browser.close(); }
})().catch(e => { console.error(e); process.exit(1); });
