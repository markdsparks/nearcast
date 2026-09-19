#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {createHash} from 'node:crypto';
import {WIDTH,HEIGHT,START_TIME,asymmetricStormTexture,observedTrack,scaleTexture} from './fixtures/radar-seam-engine-fixtures.mjs';
const source=await readFile(new URL('../radar-seam-engine.js',import.meta.url),'utf8');
const module={exports:{}};
new Function('module',source.replace('    VERSION,\n    DEFAULT_LEADS_MINUTES,','    estimatePairTranslation,\n    VERSION,\n    DEFAULT_LEADS_MINUTES,'))(module);
const seam=module.exports;
assert.equal(typeof seam.estimatePairTranslation,'function');
const raw=await readFile(new URL('../raw-map-runtime.js',import.meta.url),'utf8');
function extract(name){const start=raw.indexOf(`  function ${name}(`),end=raw.indexOf('\n  function ',start+1);assert.ok(start>=0&&end>start);return raw.slice(start,end);}
const gate=new Function(`${['composeRadarForecastSeam','compareCandidateTime','finiteOrNull','encodeDbz','emit'].map(extract).join('\n')}\nreturn composeRadarForecastSeam;`)();
const pick=(object,keys)=>Object.fromEntries(keys.filter(key=>object[key]!==undefined).map(key=>[key,object[key]]));
const pairKeys=['dx','dy','score','confidence','confidenceLevel','overlap','precipOverlap','ambiguity','ambiguityGap','improvementOverStationary','activeSource','activeTarget','sampleStride'];
const summary=(value,keys)=>value.status==='ready'?{status:'ready',...pick(value,keys)}:{status:'unavailable',reason:value.reason};
const textures={},identities=new Map();
function texture(data,width=WIDTH,height=HEIGHT){const sha=createHash('sha256').update(data).digest('hex'),key=`${width}x${height}:${sha}`;if(identities.has(key))return identities.get(key);
  const id=`texture-${identities.size}`;identities.set(key,id);const rle=[];for(let i=0;i<data.length;){let end=i+1;while(end<data.length&&data[end]===data[i])end++;rle.push(end-i,data[i]);i=end;}
  textures[id]={width,height,rle};return id;}
function frame(frame){return {texture:texture(frame.data,frame.width,frame.height),validTime:frame.validTime};}
const asFrame=(data,time=START_TIME)=>({data,width:WIDTH,height:HEIGHT,validTime:new Date(time).toISOString()});
const base=asymmetricStormTexture(),track=observedTrack(seam),slow=observedTrack(seam,{frameCount:19,dxPerFrame:0.5,dyPerFrame:0});
const uniform=asFrame(new Uint8Array(WIDTH*HEIGHT).fill(80));
const sparse=asFrame(Uint8Array.from({length:WIDTH*HEIGHT},(_,i)=>i===1940?160:0));
const shifted=(x,y)=>seam.translateTexture(base,WIDTH,HEIGHT,x,y,{interpolation:'nearest'});
let randomState=7;const random=asFrame(Uint8Array.from({length:WIDTH*HEIGHT},()=>{randomState=(Math.imul(randomState,1664525)+1013904223)>>>0;return randomState>>>24;}));
const pairs=[];
for(const [name,a,b,threshold] of [['translated',asFrame(base),asFrame(shifted(3,-2)),8],['reverse',asFrame(shifted(3,-2)),asFrame(base),8],['stationary',asFrame(base),asFrame(base),17],
  ['uniform-ambiguous',uniform,uniform,8],['sparse',sparse,sparse,8],['unrelated',asFrame(base),random,8]]){
  pairs.push({name,source:frame(a),target:frame(b),threshold,expected:summary(seam.estimatePairTranslation(a.data,b.data,WIDTH,HEIGHT,{threshold}),pairKeys)});
}
const motions=[],motionResults=new Map(),motionInputs=new Map();
for(const [name,frames,threshold,minimumPairs] of [
  ['default-track',track,8,1],['raw-map-track',track,17,2],['slow-long-history',slow,17,2],
  ['stationary',[0,1,2,3].map(i=>asFrame(base,START_TIME+i*300000)),17,2],
  ['sparse',[sparse,{...sparse,validTime:new Date(START_TIME+300000).toISOString()}],8,1],
  ['uniform',[uniform,{...uniform,validTime:new Date(START_TIME+300000).toISOString()}],8,1],
  ['too-fast',observedTrack(seam,{frameCount:2,dxPerFrame:8,dyPerFrame:0,intervalMinutes:2}),8,1],
  ['inconsistent',[-12,12,-12,0].map((x,i)=>asFrame(shifted(x,0),START_TIME+i*600000)),8,2],
  ['duplicate-time',[track[0],track[0]],8,1],['one-frame',[track[0]],8,1],['history-over-budget',Array(33).fill(track[0]),8,1],
  ['unsorted',track.slice().reverse(),17,2],['long-gap',[track[0],{...track[1],validTime:new Date(START_TIME+60*60000).toISOString()}],8,1]
]){
  const result=seam.estimateMotion({frames},{signalThreshold:threshold,minimumPairs});motionResults.set(name,result);motionInputs.set(name,frames);
  const expected=summary(result,['velocityX','velocityY','speedPixelsPerMinute','directionDegrees','confidence','confidenceLevel','consistency','meanResidualPixels','observedSpanMinutes','observedFrameCount','discardedObservedFrameCount','anchorValidTime','width','height','threshold']);
  if(result.status==='ready')expected.pairs=result.pairs.map(p=>pick(p,[...pairKeys,'intervalMinutes','olderValidTime','newerValidTime','velocityX','velocityY']));
  motions.push({name,frames:frames.map(frame),threshold,minimumPairs,expected});
}
const corrections=[];
const reference=asFrame(shifted(6,-3),START_TIME+30*60000),forecast=asFrame(scaleTexture(seam.translateTexture(reference.data,WIDTH,HEIGHT,-4,2,{interpolation:'nearest'}),0.8),START_TIME+30*60000);
for(const [name,ref,fcst,motionName,threshold] of [['lag-and-intensity',reference,forecast,'default-track',8],['no-motion-phase',reference,forecast,null,17],['unchanged',reference,reference,'default-track',8],['no-signal',sparse,sparse,null,8]]){
  const result=seam.estimateForecastCorrection({referenceFrame:ref,forecastFrame:fcst,motion:motionName?motionResults.get(motionName):undefined},{signalThreshold:threshold});
  corrections.push({name,reference:frame(ref),forecast:frame(fcst),motionName,threshold,
    expected:summary(result,['dx','dy','phaseLagMinutes','intensityScale','confidence','confidenceLevel','overlap','precipOverlap','score','anchorValidTime','referenceValidTime','width','height'])});
}
const advection=[];
for(const [name,motionName,leads] of [['default-horizon','default-track',[15,30,45,60]],['outside-domain','default-track',[70]],['long-slow-horizon','slow-long-history',[15,45,90]],
  ['exact-fractional-times','default-track',[12.5005,27.013,42.025]],['duplicate-target','default-track',[15,15,30]],['zero-lead','default-track',[0]],['over-maximum-lead','default-track',[90.001]]]){
  const motion=motionResults.get(motionName);assert.equal(motion.status,'ready');
  const targets=leads.map(lead=>new Date(Date.parse(motion.anchorValidTime)+Math.round(lead*60000)).toISOString());
  const result=seam.generateNowcast({frames:motionInputs.get(motionName),motion,targetValidTimes:targets});
  const expected=summary(result,[]);if(result.status==='ready')expected.targets=result.frames.map(f=>pick(f,['targetValidTime','anchorValidTime','leadMinutes','displacementX','displacementY','coverage','confidence','confidenceLevel']));
  advection.push({name,motionName,targets,expected});
}
const runtime=[];const anchor=Date.parse(track.at(-1).validTime),iso=ms=>new Date(ms).toISOString();
for(const [name,observedAge,cycleAge,leads,observedCount,nativeOnlyReason] of [
  ['normal',2,120,[15,30,45,60,70,75],4,null],['age-boundary',8,150,[30,60],4,null],
  ['old-anchor',8.001,120,[15],4,null],['old-cycle',2,150.001,[15],4,null],['far-first-lead',2,120,[30.001],4,null],
  ['zero-first-lead',2,120,[0,15],4,null],['insufficient-history',2,120,[15],1,null],
  ['future-anchor-strict-native',-1,120,[15],4,'observed-frame-too-old'],['future-cycle-strict-native',2,-1,[15],4,'forecast-cycle-too-old']]){
  const observedTimes=track.slice(-observedCount).map(f=>f.validTime),forecastTimes=leads.map(lead=>iso(anchor+Math.round(lead*60000))),requestedAt=iso(anchor+Math.round(observedAge*60000)),cycleTime=iso(Date.parse(requestedAt)-Math.round(cycleAge*60000));
  let captured;const result=gate({mode:'both',observedSelection:{now:requestedAt},encoding:{dbzMin:0,dbzMax:80,threshold:5},width:WIDTH,height:HEIGHT},
    [...observedTimes.map(validTime=>({kind:'observed',validTime})),...forecastTimes.map(validTime=>({kind:'forecast',validTime,source:{cycleTime}}))],
    {buildSeam(input){captured=input;return {status:'unavailable',reason:'fixture-gates-passed'};}});
  runtime.push({name,observedTimes,forecastTimes,requestedAt,cycleTime,nativeOnlyReason,
    expected:captured?{status:'ready',targetValidTimes:captured.targetValidTimes}:{status:'unavailable',reason:result.summary.reason}});
}
const fixture={version:1,note:'Exact existing JS default-profile estimator/gate oracle. Synthetic textures only. Native rejects missing masks, mismatched spatial contracts and future anchors/cycles; no displayed nowcast parity is claimed.',textures,pairs,motions,corrections,advection,runtime};
if(process.argv.includes('--emit'))process.stdout.write(JSON.stringify(fixture,null,2)+'\n');
else {assert.deepEqual(JSON.parse(await readFile(new URL('./fixtures/native-radar/seam-estimation.json',import.meta.url),'utf8')),fixture);
  console.log(`PASS Native seam fixture oracle: ${pairs.length} pairs, ${motions.length} motion histories, ${corrections.length} corrections, ${advection.length} advection gates, ${runtime.length} raw-runtime gates`);}
