import {paths,ROOT} from './config.mjs';
import {readFile,stat} from 'node:fs/promises';
import {execFile,spawn} from 'node:child_process';
import {promisify} from 'node:util';
const exec=promisify(execFile),folder=paths.DATA+'/transit';
let preparing,catalogCache,geocodeAt=0,geocodePending,prepareAfter=0;const places=new Map(),plans=new Map();
export async function ensureSchedules(){
 let age=Infinity;try{age=Date.now()-(await stat(folder+'/schedule.sqlite')).mtimeMs;}catch{}
 if(age<86400000)return;
 if(Date.now()<prepareAfter){if(age===Infinity)throw Error('Transit schedules are unavailable. Please retry later.');return;}
 if(!preparing)preparing=(async()=>{try{await exec(process.execPath,[ROOT+'/tools/transit/download.mjs'],{cwd:ROOT,timeout:200000});await exec('nice',['-n','10','python3',ROOT+'/tools/transit/schedules.py','build',folder],{timeout:120000});catalogCache=null;}catch(e){prepareAfter=Date.now()+600000;throw e;}})().finally(()=>preparing=null);
 if(age===Infinity)await preparing;else preparing.catch(()=>{}); // serve last-good schedules during refresh
}
export async function transitCatalog(){
 await ensureSchedules();
 const version=(await stat(folder+'/catalog.json')).mtimeMs;
 if(catalogCache?.version===version)return catalogCache;
 catalogCache={...JSON.parse(await readFile(folder+'/catalog.json','utf8')),version};return catalogCache;
}
export function origin(){return {lat:Number(process.env.GARDENER_TRANSIT_LAT),lon:Number(process.env.GARDENER_TRANSIT_LON),name:'The Garden'};}
export async function searchPlaces(query){
 const q=String(query||'').trim();if(q.length<2||q.length>160)throw Error('Enter a place or address (2–160 characters).');
 const key=q.toLowerCase(),hit=places.get(key);if(hit&&Date.now()-hit.at<86400000)return hit.data;
 if(geocodePending)throw Error('Please wait a moment before searching again.');
 if(Date.now()-geocodeAt<1100)throw Error('Please wait a moment before searching again.');
 geocodeAt=Date.now();
 geocodePending=(async()=>{
  const u=new URL('https://photon.komoot.io/api/');u.search=new URLSearchParams({q,limit:'5',lat:'37.76',lon:'-122.45',lang:'en'});
  const r=await fetch(u,{signal:AbortSignal.timeout(10000),headers:{'User-Agent':'GardenOS-house-transit/1.0'}});if(!r.ok)throw Error('Place search is unavailable. Try again shortly.');
  const raw=await r.json();const data={places:(raw.features||[]).map(f=>({name:[f.properties.name,f.properties.housenumber&&f.properties.street?`${f.properties.housenumber} ${f.properties.street}`:f.properties.street,f.properties.city].filter(Boolean).join(' · '),lat:f.geometry.coordinates[1],lon:f.geometry.coordinates[0]})).filter(p=>p.lat>37&&p.lat<39&&p.lon> -123.5&&p.lon< -121),at:Date.now(),source:'OpenStreetMap · Photon'};
  data.places=data.places.filter((p,i,a)=>a.findIndex(x=>x.name===p.name&&Math.abs(x.lat-p.lat)<.0001&&Math.abs(x.lon-p.lon)<.0001)===i);
  places.set(key,{at:Date.now(),data});if(places.size>80)places.delete(places.keys().next().value);return data;
 })().finally(()=>geocodePending=null);return geocodePending;
}
export async function planTransit(destination,{now=Date.now()}={}){
 if(!destination||typeof destination!=='object')throw Error('Choose a destination first.');
 const lat=Number(destination.lat),lon=Number(destination.lon);
 if(!Number.isFinite(lat)||!Number.isFinite(lon)||lat<37||lat>39||lon< -123.5||lon> -121)throw Error('Choose a destination in the Bay Area.');
 await ensureSchedules();const home=origin();if(!Number.isFinite(home.lat)||!Number.isFinite(home.lon))throw Error('Set the starting location first.');
 const key=`${lat.toFixed(5)},${lon.toFixed(5)}:${Math.floor(now/30000)}`;if(plans.has(key))return plans.get(key);
 const result=new Promise((resolve,reject)=>{
  const child=spawn('python3',[ROOT+'/tools/transit/schedules.py','plan',folder],{stdio:['pipe','pipe','pipe']});let output='',error='';const timer=setTimeout(()=>{child.kill();reject(Error('Journey planning took too long. Please retry.'));},15000);
  child.stdout.on('data',x=>{output+=x;if(output.length>200000){child.kill();reject(Error('Planner response too large.'));}});child.stderr.on('data',x=>error+=x.toString().slice(0,500));
  child.on('error',()=>{clearTimeout(timer);reject(Error('Journey planner is unavailable.'));});child.on('close',code=>{clearTimeout(timer);if(code)return reject(Error('Journey planner is unavailable.'));try{const data=JSON.parse(output);const url=new URL('https://www.google.com/maps/dir/');url.search=new URLSearchParams({api:'1',origin:`${home.lat},${home.lon}`,destination:`${lat},${lon}`,travelmode:'transit'});resolve({...data,destination:{name:String(destination.name||'Destination').slice(0,180),lat,lon},directionsUrl:url.href});}catch{reject(Error('Invalid planner response.'));}});
  child.stdin.end(JSON.stringify({origin:home,destination:{lat,lon,name:String(destination.name||'Destination').slice(0,180)},now}));
 });plans.set(key,result);try{return await result;}catch(e){plans.delete(key);throw e;}finally{if(plans.size>20)plans.delete(plans.keys().next().value);}
}
