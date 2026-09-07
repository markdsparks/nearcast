// Optional browser regression; run against a local preview with Playwright available.
const { chromium } = require(process.env.NEARCAST_PLAYWRIGHT_MODULE || process.env.PLAYWRIGHT_MODULE || 'playwright');
const assert = require('node:assert/strict');
(async () => {
  const browser = await chromium.launch({channel:'chrome', headless:true});
  const page = await browser.newPage({viewport:{width:390,height:844},deviceScaleFactor:2});
  page.setDefaultTimeout(10000);
  console.log('browser ready');
  await page.route('**/*', route => new URL(route.request().url()).hostname === '127.0.0.1' ? route.continue() : route.abort());
  await page.goto(process.env.NEARCAST_PREVIEW_URL || 'http://127.0.0.1:4188/', {waitUntil:'domcontentloaded'});
  console.log('page loaded');
  await page.evaluate(() => {
    const now = new Date();
    const date = now.toISOString().slice(0,10);
    const tomorrow = new Date(+now+86400000).toISOString().slice(0,10);
    const data = {
      latitude:38.72, longitude:-89.95, utc_offset_seconds:0,
      current:{time:now.toISOString(),temperature_2m:78,apparent_temperature:80,weather_code:0,is_day:1,relative_humidity_2m:50,dew_point_2m:58,visibility:16093.44,wind_speed_10m:5,wind_gusts_10m:12,wind_direction_10m:225},
      current_units:{temperature_2m:'°F',wind_speed_10m:'mph'},
      daily:{time:[date,tomorrow],sunrise:[date+'T06:30',tomorrow+'T06:31'],sunset:[date+'T19:20',tomorrow+'T19:18'],uv_index_max:[5,5],weather_code:[0,0],temperature_2m_max:[82,84],temperature_2m_min:[60,62],precipitation_probability_max:[0,0],precipitation_sum:[0,0]},
      hourly:{time:[now.toISOString()],temperature_2m:[78],apparent_temperature:[80],weather_code:[0],precipitation_probability:[0],precipitation:[0],is_day:[1],uv_index:[4]},
      airQuality:{current:{time:now.toISOString(),us_aqi:42,pm2_5:6,pm10:12},hourly:{time:[now.toISOString()],us_aqi:[42]}}
    };
    state.forecast = data;
    data.hourly = {
      time: Array.from({length:24}, (_,h) => date+'T'+String(h).padStart(2,'0')+':00'),
      temperature_2m: Array(24).fill(78), apparent_temperature:Array(24).fill(80),
      precipitation_probability:Array(24).fill(0), weather_code:Array(24).fill(0),
      is_day:Array.from({length:24}, (_,h)=>h>=7 && h<19 ? 1:0),
      uv_index:Array.from({length:24}, (_,h)=>Math.max(0,6-Math.abs(h-12)))
    };
    state.activePlace = {name:'Maryville, Illinois',latitude:38.72,longitude:-89.95};
    state.timeFormat = '24';
    els.shell.classList.remove('mode-welcome');
    els.shell.classList.add('mode-forecast');
    renderWeatherEssentials(data);
    const hierarchy = [...document.querySelector('.launch-stage').parentElement.children];
    if (!(hierarchy.indexOf(document.querySelector('.daily-panel')) < hierarchy.indexOf(document.getElementById('mapView')) && hierarchy.indexOf(document.getElementById('mapView')) < hierarchy.indexOf(document.getElementById('weatherEssentials')))) throw new Error('Wrong home hierarchy');
    if (!document.getElementById('outlookAirNotice').hidden) throw new Error('Good air should not be promoted');
    document.getElementById('forecastView').hidden = false;
    const surface = document.getElementById('weatherEssentials');
    for (const el of surface.parentElement.children) { if (el !== surface) el.hidden = true; }
    for (const el of document.querySelectorAll('.welcome, .welcome-screen, #welcome, #welcomeView')) el.hidden = true;
    surface.scrollIntoView();
  });
  const essentials = page.locator('#weatherEssentials');
  console.log('rendered', await essentials.isVisible());
  await essentials.screenshot({path:'/tmp/nearcast-essentials-light.png'});
  assert.match(await essentials.innerText(), /42/);
  assert.match(await essentials.innerText(), /06:30/);
  await page.locator('[data-essential-detail="air"]').click();
  await page.locator('#glanceDetailSheet.show').waitFor();
  assert.equal(await page.locator('#glanceDetailTitle').innerText(), 'Air quality');
  assert.match(await page.locator('#glanceDetailBody').innerText(), /CAMS/);
  await page.evaluate(() => closeGlanceDetail());
  await page.waitForTimeout(300);
  await page.locator('[data-essential-detail="sun"]').click();
  await page.locator('#glanceDetailSheet.show').waitFor();
  assert.match(await page.locator('#glanceDetailBody').innerText(), /19:20/);
  await page.locator('#sunDetailHit').waitFor();
  const beforeScrub = await page.locator('#sunDetailReadout').innerText();
  await page.locator('#sunDetailHit').focus();
  await page.keyboard.press('Home');
  assert.equal(await page.locator('#sunDetailHit').getAttribute('aria-valuenow'), '0');
  await page.keyboard.press('ArrowRight');
  assert.equal(await page.locator('#sunDetailHit').getAttribute('aria-valuenow'), '1');
  await page.locator('#sunDetailGraph svg').scrollIntoViewIfNeeded();
  await page.waitForTimeout(400);
  const bounds = await page.locator('#sunDetailGraph svg').boundingBox();
  await page.mouse.move(bounds.x+bounds.width*.5,bounds.y+bounds.height*.5);
  await page.mouse.down();
  await page.mouse.move(bounds.x+bounds.width*.6,bounds.y+bounds.height*.4,{steps:6});
  await page.mouse.up();
  const scrubIndex=Number(await page.locator('#sunDetailHit').getAttribute('aria-valuenow'));
  assert.ok(scrubIndex>45 && scrubIndex<70, 'physical drag selects the afternoon, got '+scrubIndex);
  assert.notEqual(await page.locator('#sunDetailReadout').innerText(), beforeScrub);
  assert.match(await page.locator('#sunDetailReadout').innerText(), /UV/);
  await page.locator('#glanceDetailSheet').screenshot({path:'/tmp/nearcast-sun-interactive.png'});
  await page.evaluate(() => {
    const data=state.forecast;
    graphCtx={data,hrs:[],dayIndex:0,sunriseISO:data.daily.sunrise[0],sunsetISO:data.daily.sunset[0],showNow:true};
    drawSunGraph();
    window.sunIsolationBefore = graphActiveIndex;
  });
  await page.locator('#sunDetailHit').focus();
  await page.keyboard.press('End');
  assert.equal(await page.evaluate(()=>graphActiveIndex === window.sunIsolationBefore),true,'standalone scrubbing preserves Hourly selection');
  await page.setViewportSize({width:320,height:780});
  await page.waitForTimeout(200);
  const readoutFits=await page.locator('#sunDetailReadout').evaluate(el=>{
    const r=el.getBoundingClientRect(),w=el.parentElement.getBoundingClientRect();
    return r.left>=w.left-1 && r.right<=w.right+1;
  });
  assert.equal(readoutFits,true,'readout remains within chart at the end of the timeline');
  await page.evaluate(() => closeGlanceDetail());
  await page.waitForTimeout(300);
  await page.evaluate(() => {
    state.timeFormat = '12';
    state.forecast.airQuality.current.us_aqi = 128;
    renderWeatherEssentials(state.forecast);
    document.documentElement.dataset.theme = 'dark';
  });
  assert.match(await essentials.innerText(), /6:30/);
  assert.doesNotMatch(await essentials.innerText(), /19:20/);
  await page.setViewportSize({width:320,height:780});
  await essentials.screenshot({path:'/tmp/nearcast-essentials-dark-small.png'});
  const overflow = await essentials.evaluate(el => [...el.querySelectorAll('*')].filter(child => child.scrollWidth > child.clientWidth+1 && getComputedStyle(child).display !== 'inline' && !(child instanceof SVGElement)).map(child=>child.className));
  assert.deepEqual(overflow, []);
  await page.evaluate(() => { state.forecast.airQuality = null; renderWeatherEssentials(state.forecast); });
  assert.match(await page.locator('[data-essential-detail="air"]').innerText(), /Unavailable/);
  assert.equal(await page.locator('#outlookAirNotice').evaluate(el => el.hidden), true);
  await page.evaluate(() => {
    state.forecast.airQuality = {current:{time:new Date().toISOString(),us_aqi:128}};
    renderWeatherEssentials(state.forecast);
    document.querySelector('.hourly-panel').hidden = false;
    document.getElementById('glanceTitle').textContent = 'Cloudy and cooling';
    document.getElementById('glanceKicker').textContent = "Today's outlook";
    document.getElementById('glanceSupport').textContent = 'Cooling through the evening';
    document.getElementById('glanceSupport').hidden = false;
  });
  const notice = page.locator('#outlookAirNotice');
  // Home defers rendering offscreen panels with content-visibility. Bring the
  // notice on screen before reading its rendered text, as a person would.
  await notice.scrollIntoViewIfNeeded();
  assert.equal(await notice.isVisible(), true);
  assert.match(await notice.innerText(), /Unhealthy for sensitive groups.*128/);
  const fits = await notice.evaluate(el => el.scrollWidth <= el.clientWidth);
  assert.equal(fits, true, 'long air notice wraps at 320px');
  await page.locator('#hero').screenshot({path:'/tmp/nearcast-outlook-air-notice.png'});
  await notice.click();
  await page.locator('#glanceDetailSheet.show').waitFor();
  assert.equal(await page.locator('#glanceDetailTitle').innerText(), 'Air quality');
  await page.evaluate(() => {
    closeGlanceDetail();
    state.forecast.airQuality.current.us_aqi = 100;
    renderWeatherEssentials(state.forecast);
  });
  assert.equal(await notice.isVisible(), false, 'improving air removes the notice');
  assert.match(await essentials.innerText(), /Moderate/);
  await page.setViewportSize({width:390,height:844});
  for (const [kind,title] of [['wind','5 mph wind'],['humidity','Humidity & dew point'],['visibility','Visibility'],['uv','UV & daylight']]) {
    const entry=page.locator(`[data-essential-detail="${kind}"]`);
    await entry.click();
    await page.locator('#glanceDetailSheet.show').waitFor();
    assert.equal(await page.locator('#glanceDetailTitle').innerText(),title);
    if(kind==='uv') await page.locator('#sunDetailHit').waitFor();
    await page.locator('#glanceDetailSheet').screenshot({path:`/tmp/nearcast-detail-${kind}.png`});
    await page.locator('#glanceDetailClose').click();
    await page.waitForTimeout(350);
    assert.equal(await entry.evaluate(el=>el===document.activeElement),true,'close returns focus to '+kind);
  }
  await page.setViewportSize({width:320,height:780});
  await page.evaluate(()=>{document.documentElement.style.fontSize='20px';});
  await essentials.screenshot({path:'/tmp/nearcast-weather-details-large-text.png'});
  const largeOverflow = await essentials.evaluate(el => [...el.querySelectorAll('*')].filter(child => child.scrollWidth > child.clientWidth+1 && getComputedStyle(child).display !== 'inline' && !(child instanceof SVGElement)).map(child=>child.className));
  assert.deepEqual(largeOverflow, [], 'details retain complete labels with large text on 320px phone');
  await page.evaluate(()=>{
    openGlanceDetail('humidity');
    closeGlanceDetail();
    openGlanceDetail('visibility');
  });
  await page.waitForTimeout(400);
  assert.equal(await page.locator('#glanceDetailSheet').isVisible(),true,'a previous close cannot hide a newly opened detail');
  assert.equal(await page.locator('#glanceDetailTitle').innerText(),'Visibility');
  await browser.close();
  console.log('Browser: all weather details, AQI transitions, Sun scrubbing, 12/24-hour times, large text and rapid navigation passed.');
})().catch(error => { console.error(error); process.exit(1); });
