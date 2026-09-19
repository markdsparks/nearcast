#!/usr/bin/env node
import assert from 'node:assert/strict';
import {readFile} from 'node:fs/promises';
import {deflateSync,gzipSync,gunzipSync} from 'node:zlib';
import {createHash} from 'node:crypto';

const worker = await readFile(new URL('../experimental/raw-weather/mrms-browser-worker.js',import.meta.url),'utf8');
const scope={addEventListener(){}};
new Function('self',worker.replace('})(self);','scope.fixtureAPI={parseGrib2,parseEmbeddedPng,validateDecodeContract,decodeViewportTexture};\n})(self);'))(scope);
const api=scope.fixtureAPI;
const hash=b=>createHash('sha256').update(b).digest('hex');
const liveKey=process.argv.find(argument=>argument.startsWith('--live-key='))?.slice('--live-key='.length);
if(liveKey){
  assert.match(liveKey,/^CONUS\/MergedReflectivityQCComposite_00\.50\/[0-9]{8}\/MRMS_MergedReflectivityQCComposite_00\.50_[0-9]{8}-[0-9]{6}\.grib2\.gz$/);
  const response=await fetch(`https://noaa-mrms-pds.s3.amazonaws.com/${liveKey}`);assert.equal(response.status,200);
  const downloaded=Buffer.from(await response.arrayBuffer());assert.ok(downloaded.length<=8*1024*1024);
  const bytes=gunzipSync(downloaded,{maxOutputLength:8*1024*1024}),parsed=api.parseGrib2(bytes),png=api.parseEmbeddedPng(bytes,parsed.dataSection);api.validateDecodeContract(parsed,png);
  const bounds=process.argv.includes('--live-national')?{minLat:20,minLon:-130,maxLat:55,maxLon:-60}:{minLat:38.35,minLon:-90.65,maxLat:39.25,maxLon:-89.25};
  const sampled=await api.decodeViewportTexture({png,grid:parsed.grid,representation:parsed.representation,bounds,
    width:320,height:200,threshold:5,dbzMin:0,dbzMax:80,signal:new AbortController().signal});
  console.log(JSON.stringify({key:liveKey,textureSHA256:hash(sampled.data),precipitationPixels:sampled.precipPixels,sourceRowsReconstructed:sampled.rowsDecoded}));process.exit(0);
}
const key='CONUS/MergedReflectivityQCComposite_00.50/20260919/MRMS_MergedReflectivityQCComposite_00.50_20260919-000641.grib2.gz';
function crc32(data){let crc=0xffffffff;for(const byte of data){crc^=byte;for(let bit=0;bit<8;bit++)crc=(crc>>>1)^((crc&1)?0xedb88320:0);}return (crc^0xffffffff)>>>0;}
function pngChunk(type,data){const result=Buffer.alloc(data.length+12);result.writeUInt32BE(data.length);result.write(type,4);data.copy(result,8);result.writeUInt32BE(crc32(result.subarray(4,-4)),result.length-4);return result;}
function predictor(filter,a,b,c){if(filter===0)return 0;if(filter===1)return a;if(filter===2)return b;if(filter===3)return Math.floor((a+b)/2);const p=a+b-c,pa=Math.abs(p-a),pb=Math.abs(p-b),pc=Math.abs(p-c);return pa<=pb&&pa<=pc?a:pb<=pc?b:c;}
function grib(reversed=false,options={}){
  const width=80,height=90,rowBytes=width*2,rows=[];let previous=Buffer.alloc(rowBytes);
  for(let y=0;y<height;y++){
    const row=Buffer.alloc(rowBytes),filter=options.invalidFilter&&y===0?5:y%5,packet=Buffer.alloc(rowBytes+1);packet[0]=filter;
    for(let x=0;x<width;x++){
      const gx=reversed?width-1-x:x,gy=reversed?height-1-y:y;
      let dbz=Math.round((gx*0.7+gy*0.13)%90*10)/10;
      if(gx<8)dbz=-999;else if(gx<15)dbz=-99;else if(gy%17===0&&gx%11===0)dbz=110;
      row.writeUInt16BE(Math.round(dbz*10+9990),x*2);
    }
    for(let i=0;i<rowBytes;i++)packet[i+1]=(row[i]-predictor(filter,i>=2?row[i-2]:0,previous[i],i>=2?previous[i-2]:0))&255;
    rows.push(packet);previous=row;
  }
  const header=Buffer.alloc(13);header.writeUInt32BE(width);header.writeUInt32BE(height,4);header[8]=options.badDepth?8:16;
  let inflated=Buffer.concat(rows);if(options.extraRowByte)inflated=Buffer.concat([inflated,Buffer.from([0])]);if(options.shortRow)inflated=inflated.subarray(0,-1);
  let compressed=deflateSync(inflated);if(options.truncatedZlib)compressed=compressed.subarray(0,-4);
  const png=Buffer.concat([Buffer.from('89504e470d0a1a0a','hex'),pngChunk('IHDR',header),pngChunk('tEXt',Buffer.from('fixture\0Synthetic numeric test')),
    pngChunk('IDAT',compressed.subarray(0,Math.floor(compressed.length/2))),pngChunk('IDAT',compressed.subarray(Math.floor(compressed.length/2))),pngChunk('IEND',Buffer.alloc(0))]);
  function section(n,size){const b=Buffer.alloc(size);b.writeUInt32BE(size);b[4]=n;return b;}
  const s1=section(1,21);s1.writeUInt16BE(161,5);s1[9]=255;s1[10]=1;s1[11]=3;s1.writeUInt16BE(2026,12);s1[14]=9;s1[15]=19;s1[16]=0;s1[17]=6;s1[18]=41;s1[19]=2;s1[20]=7;
  const s3=section(3,72);s3.writeUInt32BE(width*height,6);s3.writeUInt32BE(width,30);s3.writeUInt32BE(height,34);s3.writeUInt32BE(1,38);s3.writeUInt32BE(1e6,42);
  s3.writeUInt32BE(reversed?36550000:41000000,46);s3.writeUInt32BE(reversed?271950000:268000000,50);
  s3.writeUInt32BE(reversed?41000000:36550000,55);s3.writeUInt32BE(reversed?268000000:271950000,59);s3.writeUInt32BE(50000,63);s3.writeUInt32BE(50000,67);s3[71]=reversed?0xc0:0;
  const s4=section(4,34);s4[9]=10;s4[10]=0;s4[11]=8;s4[13]=97;s4[22]=102;s4.writeUInt32BE(500,24);s4[28]=255;
  const s5=section(5,21);s5.writeUInt32BE(width*height,5);s5.writeUInt16BE(41,9);s5.writeFloatBE(-9990,11);s5.writeUInt16BE(1,17);s5[19]=16;
  const s6=section(6,6);s6[5]=255;const s7=section(7,png.length+5);png.copy(s7,5);
  const first=Buffer.alloc(16);first.write('GRIB');first[6]=209;first[7]=2;
  const all=Buffer.concat([first,s1,s3,s4,s5,s6,s7,Buffer.from('7777')]);all.writeBigUInt64BE(BigInt(all.length),8);return all;
}
const vectors=[];
for(const [name,reversed,bounds,encoding] of [
  ['all-five-png-filters',false,{minLat:38.1,minLon:-91.5,maxLat:40.6,maxLon:-88.5},{dbzMin:0,dbzMax:80,threshold:5}],
  ['outside-and-missing-coverage',false,{minLat:34,minLon:-96,maxLat:44,maxLon:-86},{dbzMin:0,dbzMax:80,threshold:5}],
  ['opposite-scan-directions',true,{minLat:38.1,minLon:-91.5,maxLat:40.6,maxLon:-88.5},{dbzMin:0,dbzMax:80,threshold:5}],
  ['custom-encoding',false,{minLat:36.6,minLon:-92,maxLat:41,maxLon:-88.1},{dbzMin:-10,dbzMax:100,threshold:8}]
]){
  const raw=grib(reversed),parsed=api.parseGrib2(raw),png=api.parseEmbeddedPng(raw,parsed.dataSection);api.validateDecodeContract(parsed,png);
  const result=await api.decodeViewportTexture({png,grid:parsed.grid,representation:parsed.representation,bounds,width:64,height:64,...encoding,signal:new AbortController().signal});
  vectors.push({name,key,bounds,encoding,width:64,height:64,gzipBase64:gzipSync(raw).toString('base64'),gribBase64:raw.toString('base64'),
    textureSHA256:hash(result.data),precipitationPixels:result.precipPixels,sourceRowsReconstructed:result.rowsDecoded});
}
const keys=['20260918-235841','20260919-000041','20260919-000241','20260919-000441','20260919-000641'].map(stamp=>
  `CONUS/MergedReflectivityQCComposite_00.50/${stamp.slice(0,8)}/MRMS_MergedReflectivityQCComposite_00.50_${stamp}.grib2.gz`);
const listings=['20260918','20260919'].map(day=>{const prefix=`CONUS/MergedReflectivityQCComposite_00.50/${day}/`,dayKeys=keys.filter(key=>key.startsWith(prefix));
  return {prefix,xml:`<?xml version="1.0"?><ListBucketResult xmlns="http://s3.amazonaws.com/doc/2006-03-01/"><Name>noaa-mrms-pds</Name><Prefix>${prefix}</Prefix><KeyCount>${dayKeys.length}</KeyCount><IsTruncated>false</IsTruncated>${dayKeys.map(key=>`<Contents><Key>${key}</Key><LastModified>2026-09-19T00:07:00.000Z</LastModified><Size>1024</Size></Contents>`).join('')}</ListBucketResult>`};});
const adapter=await readFile(new URL('../experimental/raw-weather/mrms-browser-adapter.js',import.meta.url),'utf8');
const adapterScope={};new Function('self','fetch',adapter)(adapterScope,async url=>{const prefix=new URL(url).searchParams.get('prefix');const listing=listings.find(l=>l.prefix===prefix);assert.ok(listing);return new Response(listing.xml);});
const selectionCases=[];
for(const [name,maximumFrames,targetTimes] of [['even-history',3,[]],['earliest-tie-and-newest',3,['2026-09-19T00:03:41Z']],['newest-only',1,[]],['missing-target-keeps-newest',3,['2026-09-18T23:00:00Z']]]){
  const result=await adapterScope.NearcastMrms.listRecentFrames({now:'2026-09-19T00:07:45Z',minutes:20,maxFrames:maximumFrames,targetTimes});
  selectionCases.push({name,maximumFrames,targetTimes,expectedKeys:result.map(f=>f.key)});
}
const malformed=[['invalidFilter','invalidPNG'],['badDepth','unsupportedPNG'],['extraRowByte','sizeLimit'],['shortRow','invalidCompression'],['truncatedZlib','invalidCompression']]
  .map(([name,failure])=>({name,failure,gzipBase64:gzipSync(grib(false,{[name]:true})).toString('base64')}));
const fixture={version:1,note:'Synthetic GRIB2 numeric parity fixtures run through the actual browser worker; never present as live weather.',vectors,listings,selectionCases,malformed,
  gribExpansionBombBase64:gzipSync(Buffer.alloc(8*1024*1024+1)).toString('base64')};
if(process.argv.includes('--emit'))process.stdout.write(JSON.stringify(fixture,null,2)+'\n');
else {assert.deepEqual(JSON.parse(await readFile(new URL('./fixtures/native-radar/mrms-contract.json',import.meta.url),'utf8')),fixture);console.log('PASS MRMS fixture oracle: actual browser PNG/GRIB/viewport routines and source-time selection');}
