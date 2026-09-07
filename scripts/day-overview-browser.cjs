// Optional browser regression. Start a local Nearcast preview first; set NEARCAST_PREVIEW_URL and NEARCAST_PLAYWRIGHT_MODULE if needed.
const { chromium } = require(process.env.NEARCAST_PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({channel:'chrome', headless:true});
  const page = await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});
  page.setDefaultTimeout(10000);
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto(process.env.NEARCAST_PREVIEW_URL || 'http://127.0.0.1:4188/', {waitUntil:'domcontentloaded'});
  await page.evaluate(() => {
    const now = new Date();
    const date = now.toISOString().slice(0,10);
    const tomorrow = new Date(+now+86400000).toISOString().slice(0,10);
    const times = [date,tomorrow].flatMap(day => Array.from({length:24},(_,h)=>day+'T'+String(h).padStart(2,'0')+':00'));
    const fill = value => Array(48).fill(value);
    state.forecast = {
      latitude:38.72, longitude:-89.95, utc_offset_seconds:0,
      current:{time:now.toISOString(),temperature_2m:78,apparent_temperature:80,weather_code:0,is_day:1,relative_humidity_2m:50,wind_speed_10m:5},
      current_units:{temperature_2m:'°F',wind_speed_10m:'mph'},
      daily:{time:[date,tomorrow],sunrise:[date+'T06:30',tomorrow+'T06:31'],sunset:[date+'T19:20',tomorrow+'T19:18'],uv_index_max:[5,5],weather_code:[0,0],temperature_2m_max:[82,84],temperature_2m_min:[60,62],precipitation_probability_max:[0,70],precipitation_sum:[0,.2]},
      hourly:{time:times,temperature_2m:times.map((_,i)=>60+i%24),apparent_temperature:times.map((_,i)=>60+i%24),weather_code:times.map((_,i)=>i===39?95:0),precipitation_probability:times.map((_,i)=>i===39?70:4),precipitation:times.map((_,i)=>i===39?.2:0),is_day:times.map((_,i)=>i%24>=7&&i%24<19?1:0),uv_index:times.map((_,i)=>Math.max(0,6-Math.abs(i%24-12))),wind_speed_10m:fill(6),wind_gusts_10m:fill(12),wind_direction_10m:fill(270),relative_humidity_2m:fill(60)}
    };
    state.activePlace = {name:'Maryville, Illinois',latitude:38.72,longitude:-89.95};
    state.timeFormat='24';
    state.unit='fahrenheit';
    activeAlerts=[];
    state.forecast.hourly.weather_code[47]=95;
    state.forecast.hourly.precipitation_probability[47]=70;
    els.shell.classList.remove('mode-welcome');
    els.shell.classList.add('mode-forecast');
    document.getElementById('forecastView').hidden=false;
    openDayFromIndex(1);
  });
  await page.locator('#dayDetail.show').waitFor();
  await page.waitForTimeout(500);
  assert.equal(await page.locator('[data-day-period]').count(),4);
  await page.locator('#sheetDayPeriods').screenshot({path:'/tmp/nearcast-day-overview-390.png'});
  await page.locator('[data-day-period="afternoon"]').click();
  assert.equal(await page.evaluate(()=>dayDetailNavState.forecastFocus.source),'day-period');
  assert.match(await page.locator('.sheet-hour-row.is-expanded').getAttribute('aria-label'),/12/);
  await page.waitForTimeout(700);
  await page.evaluate(()=>openDayFromIndex(1));
  await page.setViewportSize({width:320,height:780});
  await page.waitForTimeout(500);
  await page.locator('#sheetDayPeriods').scrollIntoViewIfNeeded();
  const overflow=await page.locator('#sheetDayPeriods').evaluate(el=>[...el.querySelectorAll('*')].filter(x=>!(x instanceof SVGElement)&&!x.classList.contains('sheet-day-period-icon')&&getComputedStyle(x).display!=='inline'&&x.scrollWidth>x.clientWidth+1).map(x=>x.className));
  assert.deepEqual(overflow,[]);
  await page.locator('#sheetDayPeriods').screenshot({path:'/tmp/nearcast-day-overview-320.png'});
  await page.locator('#sheetStats').screenshot({path:'/tmp/nearcast-day-stats-320.png'});
  assert.match(await page.locator('[data-day-period="evening"]').innerText(),/near 23:00/);
  await page.evaluate(()=>{document.documentElement.dataset.theme='dark';openDayFromIndex(1);});
  await page.locator('#sheetDayPeriods').screenshot({path:'/tmp/nearcast-day-overview-dark-320.png'});
  await page.evaluate(()=>{state.timeFormat='12';openDayFromIndex(1);});
  assert.match(await page.locator('[data-day-period="morning"]').innerText(),/6:00 AM–12:00 PM/);
  await page.locator('#sheetPrevDay').click();
  assert.equal(await page.evaluate(()=>dayDetailNavState.dayIndex),0);
  await page.locator('#sheetNextDay').click();
  assert.equal(await page.evaluate(()=>dayDetailNavState.dayIndex),1);
  assert.equal(await page.locator('[data-day-period]').count(),4);
  await page.evaluate(()=>{
    state.forecast.hourly.wind_speed_10m.fill(null);
    state.forecast.hourly.wind_gusts_10m.fill(null);
    state.forecast.hourly.uv_index.fill(null);
    state.forecast.hourly.precipitation.fill(null);
    state.forecast.hourly.temperature_2m.fill(null);
    state.forecast.hourly.weather_code.fill(null);
    openDayFromIndex(1);
  });
  assert.equal(await page.locator('#sheetStats .sheet-stat strong').allTextContents().then(values=>values.slice(2).every(value=>value==='—')),true,'missing stats must not show zero');
  assert.equal(await page.locator('.sheet-day-period-value').allTextContents().then(values=>values.every(value=>value.startsWith('—'))),true,'missing temperatures must not show zero');
  assert.equal(await page.locator('#sheetHigh').innerText(),'—');
  assert.equal(await page.locator('#sheetLow').innerText(),'—');
  assert.equal(await page.locator('.sheet-day-period-icon > svg').count(),0,'missing conditions do not invent clear skies');
  assert.match(await page.locator('#sheetDayPeriods').innerText(),/Conditions unavailable/);
  await page.evaluate(()=>{
    state.forecast.hourly.temperature_2m.fill(72);
    refreshOpenDayDetailMemorySurfaces();
  });
  assert.match(await page.locator('#sheetHigh').innerText(),/72/,'refresh restores available temperature');
  await page.evaluate(()=>{
    state.forecast.hourly.temperature_2m.fill(null);
    refreshOpenDayDetailMemorySurfaces();
  });
  assert.equal(await page.locator('#sheetHigh').innerText(),'—','refresh does not retain old temperature');
  await page.evaluate(()=>openNext24Detail());
  assert.equal(await page.locator('#sheetDayPeriods').isVisible(),false);
  await browser.close();
  console.log('Day overview browser: 390/320px no overflow, exact period jump, stats layout, no rolling clutter passed.');
})().catch(error=>{console.error(error);process.exit(1);});
