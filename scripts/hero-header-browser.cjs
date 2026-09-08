// Optional browser regression. Start the local preview first.
// Exercises real production markup/CSS with simulated iPhone safe-area insets.
const { chromium } = require(process.env.NEARCAST_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const css = fs.readFileSync(path.join(__dirname, '../styles.css'), 'utf8')
  .replace(/env\(safe-area-inset-(top|right|bottom|left),\s*0px\)/g, 'var(--test-safe-$1, 0px)');

(async () => {
  const browser = await chromium.launch({ channel: 'chrome', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2, hasTouch: true });
    page.on('pageerror', error => console.error('Page error:', error.message));
    page.setDefaultTimeout(10000);
    await page.route('**/*', route => {
      const url = new URL(route.request().url());
      if (url.hostname !== '127.0.0.1') return route.abort();
      if (url.pathname === '/styles.css') return route.fulfill({ contentType: 'text/css', body: css });
      return route.continue();
    });
    await page.goto(process.env.NEARCAST_PREVIEW_URL || 'http://127.0.0.1:4188/', { waitUntil: 'domcontentloaded' });
    await page.evaluate(() => {
      const place = { id: 'header-test', name: 'Leverkusen', admin1: 'North Rhine-Westphalia', country: 'Germany', latitude: 51.03, longitude: 6.98 };
      state.activePlace = place;
      state.savedPlaces = [place];
      document.documentElement.removeAttribute('data-boot');
      document.documentElement.dataset.theme = 'dark';
      els.shell.className = 'shell mode-forecast';
      document.getElementById('forecastView').hidden = false;
      for (const child of document.getElementById('forecastView').children) child.hidden = child.id !== 'nearcastBrief';
      document.body.style.minHeight = '2400px';
      renderForecastHero({ place, current: { temperature_2m: 68 }, tempUnit: 'F', todayIndex: 0, nowCode: 3, truth: { isDay: false }, data: { daily: { temperature_2m_max: [81], temperature_2m_min: [68] } } });
      updatePlaceSwitcher();
      els.nowSummary.textContent = 'Cloudy · feels 70°F';
    });

    const names = ['Leverkusen, North Rhine-Westphalia', 'Maryville, Illinois', 'Llanfairpwllgwyngyll, Isle of Anglesey'];
    const sizes = [320, 390, 430, 760, 761, 844, 1280];
    let checks = 0;
    for (const width of sizes) {
      await page.setViewportSize({ width, height: width === 844 ? 390 : 844 });
      for (const fontSize of [16, 20, 24]) {
        for (const safe of [{ top: 0, left: 0, right: 0 }, { top: 59, left: 0, right: 0 }, { top: 0, left: 59, right: 0 }, { top: 0, left: 0, right: 59 }]) {
          for (const name of names) {
            const centers = [];
            for (const askVisible of [false, true]) {
              await page.evaluate(({ fontSize, safe, name, askVisible }) => {
                const root = document.documentElement;
                root.style.fontSize = `${fontSize}px`;
                for (const [side, value] of Object.entries(safe)) root.style.setProperty(`--test-safe-${side}`, `${value}px`);
                document.getElementById('locationName').textContent = name;
                document.getElementById('aiAgentButton').hidden = !askVisible;
                window.scrollTo({ top: 0, behavior: 'instant' });
              }, { fontSize, safe, name, askVisible });
              for (const scroll of [0, 20, 60, 180]) {
                await page.evaluate(y => {
                  window.scrollTo({ top: y, behavior: 'instant' });
                  updateFloatingChrome({ forceReveal: true });
                }, scroll);
                const bounds = await page.evaluate(() => {
                  const location = document.getElementById('launchPlaceButton');
                  const text = document.getElementById('locationName');
                  const menu = document.getElementById('appMenuToggle');
                  const ask = document.getElementById('aiAgentButton');
                  const rect = el => {
                    const r = el.getBoundingClientRect();
                    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom, width: r.width, height: r.height };
                  };
                  return { place: rect(location), text: rect(text), menu: rect(menu), ask: ask.hidden ? null : rect(ask), clipped: text.scrollWidth > text.clientWidth + 1 || text.scrollHeight > text.clientHeight + 1 };
                });
                const label = JSON.stringify({ width, fontSize, safe, name, askVisible, scroll });
                assert.ok(bounds.place.left >= bounds.menu.right + 7, `place stays outside the menu lane: ${label}`);
                assert.ok(!bounds.clipped, `full name wraps without clipping: ${label}`);
                assert.ok(bounds.text.left >= bounds.place.left - 1 && bounds.text.right <= bounds.place.right + 1, `text stays inside its lane: ${label}`);
                assert.ok(bounds.place.height >= 44, `place retains a full touch target: ${label}`);
                if (bounds.ask) {
                  assert.ok(bounds.place.right <= bounds.ask.left - 7, `Ask cannot overlap the place: ${label} ${JSON.stringify(bounds)}`);
                  assert.ok(bounds.ask.height >= 44 && bounds.ask.width >= 44, `Ask retains a full touch target: ${label}`);
                }
                if (scroll === 0) centers.push((bounds.place.left + bounds.place.right) / 2);
                checks++;
              }
            }
            assert.ok(Math.abs(centers[0] - centers[1]) < 1, 'showing Ask does not shift the centered place');
          }
        }
      }
    }

    // Actual menu and place interactions, plus a representative mobile visual.
    await page.setViewportSize({ width: 390, height: 844 });
    await page.evaluate(() => {
      const root = document.documentElement;
      root.style.fontSize = '16px';
      root.style.setProperty('--test-safe-top', '59px');
      root.style.setProperty('--test-safe-left', '0px');
      root.style.setProperty('--test-safe-right', '0px');
      document.getElementById('locationName').textContent = 'Leverkusen, North Rhine-Westphalia';
      window.scrollTo({ top: 20, behavior: 'instant' });
      updateFloatingChrome({ forceReveal: true });
    });
    await page.locator('#appMenuToggle').tap();
    assert.equal(await page.locator('#appMenuToggle').getAttribute('aria-expanded'), 'true');
    await page.locator('#appMenuToggle').tap();
    assert.equal(await page.locator('#appMenuToggle').getAttribute('aria-expanded'), 'false');
    await page.locator('#launchPlaceButton').click();
    await page.locator('#placeSheet.show').waitFor();
    assert.match(await page.locator('#launchPlaceButton').getAttribute('aria-label'), /Leverkusen/);
    await page.evaluate(() => closePlaceSheet());
    await page.locator('#placeSheet').waitFor({ state: 'hidden' });
    await page.evaluate(() => {
      window.scrollTo({ top: 0, behavior: 'instant' });
      syncLaunchAlertReadingOrder(true);
    });
    assert.equal(await page.evaluate(() => document.querySelector('.launch-place-row').nextElementSibling.id), 'alertBar');
    await page.evaluate(() => syncLaunchAlertReadingOrder(false));
    await page.screenshot({ path: '/tmp/nearcast-header-dark-390.png', clip: { x: 0, y: 0, width: 390, height: 400 } });
    await page.setViewportSize({ width: 320, height: 780 });
    await page.evaluate(() => {
      document.documentElement.dataset.theme = 'light';
      document.documentElement.style.fontSize = '24px';
    });
    await page.screenshot({ path: '/tmp/nearcast-header-large-text-320.png', clip: { x: 0, y: 0, width: 320, height: 500 } });
    console.log(`Hero header browser: ${checks} layout checks passed, plus menu taps, place navigation, stable centering, and urgent-alert ordering.`);
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exit(1); });
