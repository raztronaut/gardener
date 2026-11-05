import './config.mjs';
let stopCache, cache, pending;
const list = x => Array.isArray(x) ? x : x ? [x] : [];
export function meters(a,b) {
  const r=Math.PI/180,dy=(a.lat-b.lat)*111195,dx=(a.lon-b.lon)*111195*Math.cos((a.lat+b.lat)/2*r);return Math.hypot(dx,dy);
}
export function normalizeTransit(raw, stops, origin, now=Date.now()) {
  const service=raw.Siri?.ServiceDelivery || raw.ServiceDelivery || {};
  const visits=list(service.StopMonitoringDelivery).flatMap(d=>list(d.MonitoredStopVisit));
  const byId=new Map(stops.map(s=>[String(s.id),s]));const arrivals=[],vehicles=new Map();
  for(const v of visits) {
    const j=v.MonitoredVehicleJourney || {},c=j.MonitoredCall || {},stop=byId.get(String(v.MonitoringRef || c.StopPointRef));
    const lat=Number(j.VehicleLocation?.Latitude),lon=Number(j.VehicleLocation?.Longitude),recorded=Date.parse(v.RecordedAtTime);
    const route=String(j.LineRef || '');
    if(route && Number.isFinite(lat) && Number.isFinite(lon) && Number.isFinite(recorded) && now-recorded<5*60000 && meters({lat,lon},origin)<1800) {
      vehicles.set(String(j.VehicleRef),{id:String(j.VehicleRef),route,lat,lon,recorded,destination:j.DestinationName || ''});
    }
    if(!stop)continue;
    const expected=Date.parse(c.ExpectedArrivalTime || c.ExpectedDepartureTime),aimed=Date.parse(c.AimedArrivalTime || c.AimedDepartureTime);
    const time=Number.isFinite(expected)?expected:aimed;
    if(!Number.isFinite(time)||time<now-30000)continue;
    arrivals.push({route,destination:c.DestinationDisplay || j.DestinationName || '',stop:stop.name,stopId:stop.id,distance:stop.distance,time,realtime:Number.isFinite(expected),vehicle:String(j.VehicleRef||'')});
  }
  const nearest = new Map();
  for (const a of arrivals) { const key = `${a.route}|${a.destination}|${a.vehicle || a.time}`; const prior = nearest.get(key); if (!prior || a.distance < prior.distance) nearest.set(key,a); }
  arrivals.splice(0,arrivals.length,...nearest.values());
  arrivals.sort((a,b)=>a.time-b.time);
  return {arrivals:arrivals.slice(0,32),vehicles:[...vehicles.values()],stops,origin,sourceAt:service.ResponseTimestamp || null,at:now};
}
async function api(path,params) {
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
  if(cache && Date.now()-cache.at<90000)return cache;
  if(pending)return pending;
  pending=(async()=>{
    try {
      if(!stopCache || Date.now()-stopCache.at>86400000){
        const raw=await api('stops',{operator_id:'SF'});
        const stops=list(raw.Contents?.dataObjects?.ScheduledStopPoint).map(s=>({id:String(s.id),name:s.Name,type:s.StopType,lat:Number(s.Location?.Latitude),lon:Number(s.Location?.Longitude)})).filter(s=>Number.isFinite(s.lat)&&Number.isFinite(s.lon)).map(s=>({...s,distance:Math.round(meters(s,origin))})).filter(s=>s.distance<1800).sort((a,b)=>a.distance-b.distance);
        const chosen=[...stops.slice(0,8),...stops.filter(s=>/rail|metro|tram/i.test(s.type) || /Taraval|West Portal|Forest Hill/i.test(s.name)).slice(0,4)];
        stopCache={at:Date.now(),stops:[...new Map(chosen.map(s=>[s.id,s])).values()]};
      }
      cache=normalizeTransit(await api('StopMonitoring',{agency:'SF'}),stopCache.stops,origin);
      const age=Date.now()-Date.parse(cache.sourceAt);cache.stale=!Number.isFinite(age)||age>5*60000;return cache;
    }catch{
      if(cache)return {...cache,stale:true,error:'Provider unavailable — showing saved predictions.'};
      return {error:'Live transit is temporarily unavailable.',arrivals:[],vehicles:[],stops:stopCache?.stops||[]};
    }
  })().finally(()=>pending=null);return pending;
}
