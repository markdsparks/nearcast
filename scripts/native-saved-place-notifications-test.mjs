import assert from 'node:assert/strict';
import fs from 'node:fs';
import {
  handlePlanWatchNotificationConfigRequest, handlePlanWatchNotificationRegisterRequest,
  evaluateSavedPlaceWatch, evaluateUrgentSavedPlaceAlert, planWatchCandidateInCooldown, planWatchCandidateInQuietHours
} from '../workers/radar-capability.mjs';
const objects = new Map();
const env = {
  PLAN_WATCH_R2: {
    async put(key,value) { objects.set(key,JSON.parse(value)); },
    async get(key) { return objects.has(key) ? {json:async()=>structuredClone(objects.get(key))} : null; },
    async delete(key) { objects.delete(key); },
    async list({prefix}) { return {objects:[...objects.keys()].filter(key=>key.startsWith(prefix)).map(key=>({key})),truncated:false}; }
  },
  PLAN_WATCH_REGISTRATION_RATE_LIMITER:{limit:async()=>({success:true})},
  PLAN_WATCH_REGISTRATION_GLOBAL_RATE_LIMITER:{limit:async()=>({success:true})},
  PLAN_WATCH_APNS_TEAM_ID:'fixture', PLAN_WATCH_APNS_KEY_ID:'fixture', PLAN_WATCH_APNS_PRIVATE_KEY:'fixture-never-used',
  PLAN_WATCH_APNS_BUNDLE_ID:'app.nearcast.ios'
};
const nativeChannel={token:'cd'.repeat(32),environment:'production',bundleId:'app.nearcast.ios'};
const client={owner:'native-v1',timezone:'America/Chicago',unit:'fahrenheit'};
const tokyo={id:'tokyo',timezone:'Asia/Tokyo',place:{name:'Tokyo',countryCode:'JP',latitude:35.68,longitude:139.69}};
const register=async(places,overrides={})=>{
  const response=await handlePlanWatchNotificationRegisterRequest(new Request('https://getnearcast.app/api/watch/notifications/register',{
    method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({nativeChannel,client,plans:[],places,...overrides})
  }),env);
  return {status:response.status,body:await response.json()};
};
const originalFetch=globalThis.fetch;
globalThis.fetch=async()=>{throw new Error('No production requests or notification deliveries belong in this test');};
try {
  const config=await (await handlePlanWatchNotificationConfigRequest(new Request('https://getnearcast.app/api/watch/notifications/config'),env)).json();
  assert.equal(config.nativeSavedPlaceWatchesVersion,1);
  const first=await register([tokyo]);
  assert.equal(first.status,200);assert.equal(first.body.planCount,0);assert.equal(first.body.placeCount,1);assert.equal(first.body.placeWatchVersion,1);
  const key=[...objects.keys()].find(key=>key.includes('/subscriptions/'));
  assert.equal(objects.get(key).places[0].timezone,'Asia/Tokyo');
  const retained=structuredClone(objects.get(key));
  for(const invalid of [[tokyo,tokyo],Array.from({length:4},(_,i)=>({...tokyo,id:`place-${i}`,place:{...tokyo.place,latitude:30+i}})),
    [{...tokyo,timezone:'Invalid/Timezone'}],[{...tokyo,id:'x'.repeat(97)}],[tokyo,{...tokyo,id:'duplicate-location'}]]) {
    assert.equal((await register(invalid)).status,400);
    assert.deepEqual(objects.get(key),retained,'invalid place inventory is rejected atomically');
  }
  objects.get(key).places[0].lastKnown={snapshot:{placeId:'tokyo',unit:'fahrenheit',days:[{date:'2026-11-02',rainChance:70}]}};
  const baseline=structuredClone(objects.get(key).places[0].lastKnown);
  await register([{...tokyo,place:{...tokyo.place,name:'Home'}}]);
  assert.deepEqual(objects.get(key).places[0].lastKnown,baseline,'rename/sync retains the server comparison point');
  await register([tokyo],{client:{...client,unit:'celsius'}});
  assert.equal(objects.get(key).places[0].lastKnown.snapshot,null,'display units reset the place comparison point');
  objects.get(key).places[0].lastKnown=baseline;
  await register([{...tokyo,place:{...tokyo.place,latitude:36}}],{client:{...client,unit:'celsius'}});
  assert.equal(objects.get(key).places[0].lastKnown.snapshot,null,'moving a place ID cannot compare unrelated locations');
  await register([{...tokyo,lastKnown:baseline}]);
  assert.equal(objects.get(key).places[0].lastKnown.snapshot,null,'native clients cannot inject server change baselines');

  const now=Date.parse('2026-11-01T16:00:00Z'); // Tokyo Nov 2, Chicago Nov 1
  const dates=['2026-11-02','2026-11-03'];
  function forecast({rain=10,startHour=null,code=0}={}) {
    const times=dates.flatMap(date=>Array.from({length:24},(_,hour)=>`${date}T${String(hour).padStart(2,'0')}:00`));
    return {timezone:'Asia/Tokyo',utc_offset_seconds:32400,daily:{time:dates},hourly:{time:times,
      temperature_2m:times.map(()=>68),apparent_temperature:times.map(()=>68),
      precipitation_probability:times.map((_,i)=>startHour===null?rain:(i%24>=startHour?70:10)),
      precipitation:times.map(()=>0),wind_gusts_10m:times.map(()=>10),weather_code:times.map(()=>code)}};
  }
  function context(forecast,alerts={readiness:'supported',alerts:[]},place=tokyo,at=now) {
    const base=`${place.place.latitude.toFixed(3)}:${place.place.longitude.toFixed(3)}:`;
    return {now:at,forecastCache:new Map([[base+'fahrenheit',Promise.resolve(forecast)]]),alertsCache:new Map([[base+'alerts',Promise.resolve(alerts)]])};
  }
  const record={client};
  const initial=await evaluateSavedPlaceWatch(tokyo,record,context(forecast()));
  assert.equal(initial.candidate,null,'the first routine place check is silent');
  assert.equal(initial.place.lastKnown.snapshot.days[0].date,'2026-11-02','today follows Tokyo, not the phone time zone');
  const changed=await evaluateSavedPlaceWatch(initial.place,record,context(forecast({rain:75})));
  assert.equal(changed.candidate.type,'place-rain');
  assert.equal(changed.candidate.notification.target,'hourly');
  const route=new URL(changed.candidate.notification.url);
  assert.equal(route.searchParams.get('placeId'),'tokyo');assert.equal(route.searchParams.get('date'),'2026-11-02');
  assert.equal(route.searchParams.get('lat'),'35.68');assert.equal(route.searchParams.get('lon'),'139.69');
  const missing=forecast();missing.hourly.precipitation_probability[2]=null;
  const unavailable=await evaluateSavedPlaceWatch(changed.place,record,context(missing));
  assert.equal(unavailable.candidate,null);assert.equal(unavailable.updated,false);assert.equal(unavailable.error,'forecast-window-unavailable');
  assert.deepEqual(unavailable.place.lastKnown,changed.place.lastKnown,'missing weather cannot invent clearing or consume a baseline');
  const yesterday=forecast();yesterday.daily.time=['2026-11-01','2026-11-02'];
  assert.equal((await evaluateSavedPlaceWatch(initial.place,record,context(yesterday))).candidate,null,'old daily dates cannot become current guidance');
  const gapped=forecast();
  for(const values of Object.values(gapped.hourly)) values.splice(3,1);
  assert.equal((await evaluateSavedPlaceWatch(changed.place,record,context(gapped))).error,'forecast-window-unavailable','missing whole hours cannot invent a forecast improvement');
  const earlyRain=forecast();earlyRain.hourly.precipitation_probability[1]=80;
  const rainBaseline=await evaluateSavedPlaceWatch(tokyo,record,context(earlyRain));
  const later=await evaluateSavedPlaceWatch(rainBaseline.place,record,context(earlyRain,undefined,tokyo,now+3600_000));
  assert.equal(later.candidate,null,'an unchanged rainy hour passing does not create a clearing notification');
  const alreadyPassed=forecast();alreadyPassed.hourly.weather_code[0]=95;
  assert.equal((await evaluateSavedPlaceWatch(initial.place,record,context(alreadyPassed))).candidate,null,'past-only storm changes do not notify as future risk');
  const oldTiming=await evaluateSavedPlaceWatch(tokyo,record,context(forecast({startHour:7})));
  const movedTiming=await evaluateSavedPlaceWatch(oldTiming.place,record,context(forecast({startHour:5})));
  assert.equal(movedTiming.candidate?.type,'place-rain-timing');assert.match(movedTiming.candidate.notification.body,/2 hours earlier/);
  const policyRecord={client:{...client,notificationPolicy:{quietStart:0,quietEnd:23,minimumIntervalMinutes:180}},lastRoutineSentAt:new Date(now-60_000).toISOString()};
  assert.equal(planWatchCandidateInCooldown(policyRecord,changed.candidate,new Date(now)),true);
  assert.equal(planWatchCandidateInQuietHours(policyRecord,changed.candidate,{},new Date(now)),true);

  const chicago={id:'chicago',timezone:'America/Chicago',place:{name:'Chicago',countryCode:'US',latitude:41.88,longitude:-87.63}};
  const dstNow=Date.parse('2026-11-01T06:30:00Z');
  const warning={readiness:'supported',alerts:[{event:'Severe Thunderstorm Warning',severity:'Severe',onset:'2026-11-02T05:15:00Z',ends:'2026-11-02T05:45:00Z'}]};
  const urgent=await evaluateUrgentSavedPlaceAlert(chicago,{client:{...client,timezone:'Asia/Tokyo'}},context({},warning,chicago,dstNow));
  assert.equal(urgent.candidate?.type,'place-alert');assert.equal(urgent.candidate.notification.target,'map');
  assert.equal(new URL(urgent.candidate.notification.url).searchParams.get('date'),'2026-11-01','a late warning belongs to the 25-hour Chicago day');
  assert.equal(planWatchCandidateInCooldown(policyRecord,urgent.candidate,new Date(now)),false,'urgent official warnings bypass routine cooldown');
  const firstWarning={readiness:'supported',alerts:[{event:'Severe Thunderstorm Warning',severity:'Severe',onset:'2026-11-01T17:15:00Z',ends:'2026-11-01T18:15:00Z'}]};
  const initialWarning=await evaluateSavedPlaceWatch(tokyo,record,context(forecast(),firstWarning));
  assert.equal(initialWarning.candidate?.type,'place-alert','first routine baseline cannot swallow an already-active official warning');
  const alertsFailed=await evaluateSavedPlaceWatch(changed.place,record,context(forecast(),{readiness:'error',alerts:[]}));
  assert.equal(alertsFailed.candidate,null);assert.deepEqual(alertsFailed.place.lastKnown,changed.place.lastKnown);
  if (process.argv[2]) fs.writeFileSync(process.argv[2], JSON.stringify({routine:changed.candidate.notification,timing:movedTiming.candidate.notification,urgent:urgent.candidate.notification}));
  console.log('PASS native saved-place watches: atomic registration, receipts, owner baselines, units/location reset, truthful forecast evidence, rain timing, local days/DST, native routes, cooldown and urgent warnings');
} finally {globalThis.fetch=originalFetch;}
