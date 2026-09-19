// Read-only NOAA sample; compares the native port against the existing web worker.
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
const dir = process.argv[2];
if (!dir) throw new Error('Temporary fixture directory required');
const origin = 'https://noaa-hrrr-bdp-pds.s3.amazonaws.com';
const cycle = new Date(Math.floor(Date.now()/3600000)*3600000 - 2*3600000);
const stamp = cycle.toISOString().replace(/[-:T]/g,'').slice(0,10);
const url = `${origin}/hrrr.${stamp.slice(0,8)}/conus/hrrr.t${stamp.slice(8)}z.wrfsubhf03.grib2`;
const indexResponse = await fetch(url+'.idx');
if (!indexResponse.ok) throw new Error(`Index ${indexResponse.status}`);
const rows = (await indexResponse.text()).trim().split('\n').map(x=>x.split(':'));
const n = rows.findIndex(r=>r[3]==='REFC' && r[4]==='entire atmosphere');
const start = Number(rows[n][1]), end=Number(rows[n+1][1])-1;
const response=await fetch(url,{headers:{Range:`bytes=${start}-${end}`}});
if(response.status!==206 || end-start>4*1024*1024) throw new Error('Range rejected');
const bytes=new Uint8Array(await response.arrayBuffer());
const source=fs.readFileSync(new URL('../experimental/raw-weather/hrrr-subhourly-worker.js',import.meta.url),'utf8');
const scope={addEventListener(){}};
vm.runInNewContext(source.replace('})(self);','scope.oracle = {parseGrib2, unpackComplexSpatial, resampleViewport}; })(self);'),{self:scope,Uint8Array,Int32Array,Uint32Array,DataView,Date,Math,Map,Number,Error});
const parsed=scope.oracle.parseGrib2(bytes), values=scope.oracle.unpackComplexSpatial(bytes,parsed).values;
const bounds={minLat:30,minLon:-105,maxLat:44,maxLon:-85};
const expected=scope.oracle.resampleViewport({values,grid:parsed.grid,representation:parsed.representation,
 bounds,width:160,height:120,threshold:5,dbzMin:0,dbzMax:80,signal:{aborted:false}}).data;
fs.writeFileSync(path.join(dir,'record.grib2'),bytes);
fs.writeFileSync(path.join(dir,'expected.bin'),expected);
fs.writeFileSync(path.join(dir,'metadata.json'),JSON.stringify({url,start,end,cycle:cycle.toISOString(),leadMinutes:parsed.forecastMinutes}));
console.log(`Web oracle: ${expected.length} pixels, ${expected.filter(x=>x>0).length} precip pixels`);
