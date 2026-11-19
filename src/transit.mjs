import {paths} from './config.mjs';
import {readFile,writeFile,rename} from 'node:fs/promises';
import {transitCatalog,origin as homeOrigin} from './transit-planner.mjs';
let stopCache, cache, pending, lastFailure=0,restore;
async function restoreTransit(origin){
 restore ||= (async()=>{try{const d=JSON.parse(await readFile(paths.DATA+'/transit-live.json','utf8'));if(!d.origin||meters(origin,d.origin)>1)return;if(d.stops?.at>Date.now()-86400000)stopCache=d.stops;if(d.live?.at>Date.now()-3600000&&d.live.at<=Date.now())cache=d.live;}catch{}})();await restore;
}
async function saveTransit(origin){try{const file=paths.DATA+'/transit-live.json';await writeFile(file+'.tmp',JSON.stringify({origin,stops:stopCache,live:cache}),{mode:0o600});await rename(file+'.tmp',file);}catch{}}

const list = x => Array.isArray(x) ? x : x ? [x] : [];
export function meters(a,b) {
  const r=Math.PI/180,dy=(a.lat-b.lat)*111195,dx=(a.lon-b.lon)*111195*Math.cos((a.lat+b.lat)/2*r);return Math.hypot(dx,dy);
}
export function normalizeTransit(raw, stops, origin, now=Date.now()) {
  const service=raw.Siri?.ServiceDelivery || raw.ServiceDelivery || {};
  const visits=list(service.StopMonitoringDelivery).flatMap(d=>list(d.MonitoredStopVisit));
  const byId=new Map(stops.map(s=>[String(s.id),s]));const arrivals=[],vehicles=new Map(),allVehicles=new Map();
  for(const v of visits) {
    const j=v.MonitoredVehicleJourney || {},c=j.MonitoredCall || {},stop=byId.get(String(v.MonitoringRef || c.StopPointRef));
    const lat=Number(j.VehicleLocation?.Latitude),lon=Number(j.VehicleLocation?.Longitude),recorded=Date.parse(v.RecordedAtTime);
    const route=String(j.LineRef || '');
    if(route && Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(recorded) && now-recorded<5*60000 && Math.abs(lat-37.77)<.3 && Math.abs(lon+122.44)<.3) allVehicles.set(String(j.VehicleRef),{id:String(j.VehicleRef),route,lat,lon,recorded,direction:j.DirectionRef,destination:j.DestinationName || '',bearing:Number(j.Bearing)||0});
    if(route && Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(recorded) && now-recorded<5*60000 && meters({lat,lon},origin)<1800) {
      vehicles.set(String(j.VehicleRef),{id:String(j.VehicleRef),route,lat,lon,recorded,destination:j.DestinationName || ''});
    }
    if(!stop)continue;
    const expected=Date.parse(c.ExpectedArrivalTime || c.ExpectedDepartureTime),aimed=Date.parse(c.AimedArrivalTime || c.AimedDepartureTime);
    const time=Number.isFinite(expected)?expected:aimed;
    if(!Number.isFinite(time)||time<now-30000)continue;
    arrivals.push({route,destination:c.DestinationDisplay || j.DestinationName || '',stop:stop.name,stopId:stop.id,distance:stop.distance,time,realtime:Number.isFinite(expected),vehicle:String(j.VehicleRef||'')});
  }
  const stopArrivals=arrivals.slice();
  const nearest = new Map();
  for (const a of arrivals) { const key = `${a.route}|${a.destination}|${a.vehicle || a.time}`; const prior = nearest.get(key); if (!prior || a.distance < prior.distance) nearest.set(key,a); }
  arrivals.splice(0,arrivals.length,...nearest.values());
  arrivals.sort((a,b)=>a.time-b.time);
  return {arrivals:arrivals.slice(0,96),stopArrivals,vehicles:[...vehicles.values()],routeVehicles:[...allVehicles.values()],stops,origin,sourceAt:service.ResponseTimestamp || null,at:now};
}
// VehicleMonitoring includes each vehicle once plus its future stop calls. The
// equivalent all-city StopMonitoring response repeats those journeys per stop
// and can exceed the bounded response size as daytime service grows.
export function normalizeVehicleMonitoring(raw,stops,origin,now=Date.now()){
 const service=raw.Siri?.ServiceDelivery||raw.ServiceDelivery||{},known=new Set(stops.map(s=>String(s.id))),visits=[];
 for(const a of list(service.VehicleMonitoringDelivery).flatMap(d=>list(d.VehicleActivity))){
  const j=a.MonitoredVehicleJourney||{};
  const calls=[j.MonitoredCall||{},...list(j.OnwardCalls?.OnwardCall).filter(c=>known.has(String(c.StopPointRef)))];
  for(const c of calls)visits.push({RecordedAtTime:a.RecordedAtTime,MonitoringRef:c.StopPointRef,MonitoredVehicleJourney:{...j,MonitoredCall:c}});
 }
 return normalizeTransit({ServiceDelivery:{ResponseTimestamp:service.ResponseTimestamp,StopMonitoringDelivery:{MonitoredStopVisit:visits}}},stops,origin,now);
}
export function withBoardingPredictions(plan){
 if(!cache||cache.stale||Date.now()-cache.at>120000)return plan;
 return {...plan,journeys:plan.journeys.map(j=>{const first=j.legs.find(l=>l.type==='ride');const live=first?.agency==='SF'?(cache.stopArrivals||[]).filter(a=>a.realtime&&a.route===first.route&&String(a.stopId)===first.fromId.slice(3)&&a.time>Date.now()&&Math.abs(a.time-first.start)<600000).sort((a,b)=>a.time-b.time).slice(0,2):[];return {...j,firstStopLive:live.map(a=>({time:a.time,destination:a.destination,vehicle:a.vehicle,sourceAt:cache.sourceAt}))};})};
}
export async function api(path,params) {
  const url=new URL('https://api.511.org/transit/'+path);url.searchParams.set('api_key',process.env.GARDENER_511_KEY);url.searchParams.set('format','json');
  for(const [k,v]of Object.entries(params))url.searchParams.set(k,v);
  const r=await fetch(url,{signal:AbortSignal.timeout(12000),redirect:'error'});
  if(!r.ok)throw new Error('Transit provider unavailable');
  const chunks=[];let size=0;for await(const c of r.body){size+=c.length;if(size>12*1024*1024)throw new Error('Oversize response');chunks.push(c);}
  return JSON.parse(Buffer.concat(chunks).toString('utf8').replace(/^\uFEFF/,''));
}
export async function nearbyTransit() {
  if(!process.env.GARDENER_511_KEY)return {error:'Transit is not configured.',arrivals:[],vehicles:[],stops:[]};
  const origin={lat:Number(process.env.GARDENER_TRANSIT_LAT),lon:Number(process.env.GARDENER_TRANSIT_LON)};
  if(!Number.isFinite(origin.lat)||!Number.isFinite(origin.lon))return {error:'Set a transit location.',arrivals:[],vehicles:[],stops:[]};
  await restoreTransit(origin);
  if(cache && Date.now()-cache.at<90000)return cache;
  if(pending)return pending;
  if(Date.now()-lastFailure<30000)return cache?{...cache,stale:true,error:'Provider unavailable — showing saved predictions.'}:{origin,error:'Live transit is temporarily unavailable.',arrivals:[],vehicles:[],stops:stopCache?.stops||[]};
  pending=(async()=>{
    try {
      if(!stopCache || Date.now()-stopCache.at>86400000){
        const catalog=await transitCatalog();
        const stops=catalog.stops.filter(s=>s.agency==='SF').map(s=>({...s,id:s.rawId,distance:Math.round(meters(s,origin))})).filter(s=>s.distance<1800).sort((a,b)=>a.distance-b.distance);
        const chosen=stops.slice(0,80);
        stopCache={at:Date.now(),stops:[...new Map(chosen.map(s=>[s.id,s])).values()]};
      }
      cache=normalizeVehicleMonitoring(await api('VehicleMonitoring',{agency:'SF'}),stopCache.stops,origin);
      const age=Date.now()-Date.parse(cache.sourceAt);cache.stale=!Number.isFinite(age)||age>5*60000;await saveTransit(origin);return cache;
    }catch{
      lastFailure=Date.now();
      if(cache)return {...cache,stale:true,error:'Provider unavailable — showing saved predictions.'};
      return {origin,error:'Live transit is temporarily unavailable.',arrivals:[],vehicles:[],stops:stopCache?.stops||[]};
    }
  })().finally(()=>pending=null);return pending;
}

// Official SFMTA route geometry. Independent from live arrivals, cached for a day;
// a slow geometry refresh never holds up the departure board.
let routeCache,routePending;
export async function transitRoutes(){
  if(routeCache&&Date.now()-routeCache.at<86400000)return routeCache;
  if(routePending)return routePending;
  routePending=(async()=>{
    const {readFile,writeFile,mkdir}=await import('node:fs/promises');
    const {paths}=await import('./config.mjs');const path=paths.DATA+'/transit-routes.json';
    if(!routeCache){try{routeCache=JSON.parse(await readFile(path,'utf8'));if(Date.now()-routeCache.at<86400000)return routeCache;}catch{}}
    try{
      const r=await fetch('https://data.sf.gov/resource/9exe-acju.json?$limit=300',{signal:AbortSignal.timeout(10000)});
      if(!r.ok)throw Error();const rows=await r.json();if(!Array.isArray(rows))throw Error();
      const routes=rows.filter(x=>x.shape?.type==='MultiLineString').map(x=>({route:x.route_name,direction:x.direction,paths:x.shape.coordinates,asOf:x.data_as_of}));
      if(!routes.length)throw Error();routeCache={routes,at:Date.now(),source:'SFMTA · DataSF',url:'https://data.sf.gov/Transportation/Muni-Simple-Routes/9exe-acju'};
      await mkdir(paths.DATA,{recursive:true});await writeFile(path,JSON.stringify(routeCache));return routeCache;
    }catch{return routeCache?{...routeCache,stale:true}:{routes:[],error:'Route shapes are temporarily unavailable.'};}
  })().finally(()=>routePending=null);return routePending;
}

let bartCache,bartPending,bartAttempt=0;
export async function bartTransit(){
 if(bartCache&&Date.now()-bartAttempt<300000)return bartCache;
 if(bartPending)return bartPending;
 if(Date.now()-bartAttempt<30000)return {arrivals:[],vehicles:[],stops:[],error:'BART is temporarily unavailable.'};
 bartAttempt=Date.now();
 bartPending=(async()=>{try{
  const catalog=await transitCatalog(),origin=homeOrigin();
  const all=catalog.stops.filter(s=>s.agency==='BA').map(s=>({...s,distance:Math.round(meters(s,origin))})).sort((a,b)=>a.distance-b.distance);
  const names=[...new Set(all.map(s=>s.name))].slice(0,3);
  const stops=all.filter(s=>names.includes(s.name)).map(s=>({...s,id:s.rawId}));
  const d=normalizeTransit(await api('StopMonitoring',{agency:'BA'}),stops,origin);
  const fix=v=>({...v,route:'BA:'+v.route,agency:'BA'});
  bartCache={...d,arrivals:d.arrivals.map(fix),vehicles:d.vehicles.map(fix),routeVehicles:d.routeVehicles.map(fix),agency:'BA',stale:!d.sourceAt||Date.now()-Date.parse(d.sourceAt)>300000};return bartCache;
 }catch{bartCache=bartCache?{...bartCache,stale:true,error:'BART provider unavailable — saved predictions.'}:{arrivals:[],vehicles:[],stops:[],error:'BART predictions are unavailable.'};return bartCache;}})().finally(()=>bartPending=null);return bartPending;
}
