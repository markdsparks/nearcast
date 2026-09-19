#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {gzipSync, gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';
const source = await readFile(new URL('../raw-map-runtime.js', import.meta.url), 'utf8');
function extract(name) {
  const start=source.indexOf(`  function ${name}(`), end=source.indexOf('\n  function ', start+1);
  assert.ok(start>=0 && end>start); return source.slice(start,end);
}
const anchor='2026-09-19T01:20:00.000Z';
class FixedDate extends Date { constructor(...args) { super(...(args.length?args:[anchor])); } }
const api=new Function('Date', `${extract('encodeNcrd')}\n${extract('buildChunkIndex')}\nreturn {encodeNcrd,buildChunkIndex};`)(FixedDate);
const encoding={type:'uint8-dbz',dbzMin:0,dbzMax:80,threshold:5,noData:0,valueMin:1,valueMax:255};
const bounds={minLat:38.3,minLon:-90.4,maxLat:39,maxLon:-89.7};
const payload=Uint8Array.from({length:256},(_,index)=>index);
const sha=(bytes)=>createHash('sha256').update(bytes).digest('hex');
const vectors=[];
for(const [kind,provider,gzip] of [['observed','noaa-mrms-direct',false],['forecast','noaa-hrrr-subhourly',false],['forecast','noaa-hrrr-zarr',true]]) {
  const validTime=kind==='observed'?anchor:'2026-09-19T01:30:00.000Z';
  const meta={provider:'nearcast-raw-map',version:1,sourceProvider:provider,kind,validTime,timestamp:validTime,
    visualMetric:kind==='observed'?'reflectivity':'simulated-reflectivity',width:16,height:16,projection:'web-mercator-bounds',bounds,valueEncoding:encoding};
  const bytes=Buffer.from(api.encodeNcrd(meta,payload));
  const transport=gzip?gzipSync(bytes):bytes;
  const input={kind,provider,visualMetric:meta.visualMetric,source:{product:kind==='observed'?'MergedReflectivityQCComposite_00.50':'wrfsubhf/REFC',region:'CONUS',
    ...(kind==='forecast'?{cycleTime:'2026-09-19T01:00:00.000Z',forecastMinutes:30}:{})}};
  const manifest=api.buildChunkIndex({context:{width:16,height:16,bounds},input,validTime,chunkUrl:`frames/${provider}.ncrd${gzip?'.gz':''}`,
    byteLength:transport.length,stats:{precipPixels:255,outputPixels:256,minDbz:0,maxDbz:80},valueEncoding:encoding});
  vectors.push({name:provider,manifest,bytesBase64:transport.toString('base64'),payloadSHA256:sha(payload),width:16,height:16,kind,validTime});
}
const legacy=[];
for(const folder of ['synthetic-smoke','nebraska-20260701-055640','nebraska-20260701-055640-z12']) {
  const indexPath=`radar/chunks/${folder}/index.json`;
  const index=JSON.parse(await readFile(new URL('../'+indexPath,import.meta.url),'utf8'));
  const chunk=index.levels[0].chunks[0]; const chunkPath=`radar/chunks/${folder}/${chunk.path}`;
  const unpacked=gunzipSync(await readFile(new URL('../'+chunkPath,import.meta.url)));
  assert.equal(unpacked.readUInt16BE(4),1);
  const h=unpacked.readUInt16BE(6), n=unpacked.readUInt32BE(8);
  const meta=JSON.parse(unpacked.subarray(12,12+h).toString());
  assert.equal(unpacked.length,12+h+n);
  legacy.push({indexPath,chunkPath,width:meta.width,height:meta.height,payloadSHA256:sha(unpacked.subarray(12+h)),
    kind:folder==='synthetic-smoke'?'synthetic':'observed',validTime:index.frame.observedAt});
}
const fixture={version:1,note:'Transport/decoder fixtures only. Legacy MRMS files are historical; synthetic data is never live weather.',vectors,legacy,
  gzipBombBase64:gzipSync(Buffer.alloc(1_200_000,1)).toString('base64')};
if(process.argv.includes('--emit')) process.stdout.write(JSON.stringify(fixture,null,2)+'\n');
else {
  const expected=JSON.parse(await readFile(new URL('./fixtures/native-radar/chunk-contract.json',import.meta.url),'utf8'));
  assert.deepEqual(expected,fixture);
  console.log('PASS Native NCRD fixture oracle: production raw-map encoder/index, three existing gzip coverage assets, bounded-expansion adversarial fixture');
}
