import assert from 'node:assert/strict';
import { normalizeTransit, meters, nearbyTransit, normalizeVehicleMonitoring } from '../../src/transit.mjs';
const now=Date.now(),origin={lat:37,lon:-122},stops=[{id:'1',name:'A',distance:10},{id:'2',name:'B',distance:30}];
const visit=(id,extra={})=>({MonitoringRef:id,RecordedAtTime:new Date(now).toISOString(),MonitoredVehicleJourney:{LineRef:'L',VehicleRef:'123',VehicleLocation:{Latitude:'37',Longitude:'-122'},MonitoredCall:{ExpectedArrivalTime:new Date(now+60000).toISOString(),DestinationDisplay:'Downtown'},...extra}});
const payload=visits=>({ServiceDelivery:{StopMonitoringDelivery:{MonitoredStopVisit:visits}}});
const d=normalizeTransit(payload([visit('1'),visit('2'),visit('9')]),stops,origin,now);
assert.equal(d.arrivals.length,1);assert.equal(d.arrivals[0].stop,'A');assert.equal(d.vehicles.length,1);assert.equal(meters(origin,origin),0);
assert.equal(normalizeTransit({},stops,origin,now).arrivals.length,0);
assert.equal(normalizeTransit(payload([visit('1',{MonitoredCall:{ExpectedArrivalTime:new Date(now-60000).toISOString()}})]),stops,origin,now).arrivals.length,0);
const old=visit('1');old.RecordedAtTime=new Date(now-360000).toISOString();assert.equal(normalizeTransit(payload([old]),stops,origin,now).vehicles.length,0);
console.log('PASS transit distance, deduplication, stop filtering, expired predictions, old positions, empty data');

const savedFetch=globalThis.fetch;const keys=['GARDENER_511_KEY','GARDENER_TRANSIT_LAT','GARDENER_TRANSIT_LON'];const saved=keys.map(k=>process.env[k]);
try{
 process.env.GARDENER_511_KEY='test-only';process.env.GARDENER_TRANSIT_LAT='37';process.env.GARDENER_TRANSIT_LON='-122';let requests=0;
 globalThis.fetch=async()=>{requests++;throw Error('simulated provider outage');};
 for(let i=0;i<2;i++){const unavailable=await nearbyTransit();assert.deepEqual(unavailable.origin,origin);assert.equal(unavailable.arrivals.length,0);assert.ok(unavailable.error);}
 assert.equal(requests,1);console.log('PASS provider outage retains origin and suppresses repeated calls during cooldown');
}finally{globalThis.fetch=savedFetch;keys.forEach((k,i)=>{if(saved[i]===undefined)delete process.env[k];else process.env[k]=saved[i];});}

const j=visit('1').MonitoredVehicleJourney;j.MonitoredCall={...j.MonitoredCall,StopPointRef:'9'};j.OnwardCalls={OnwardCall:[{StopPointRef:'1',ExpectedArrivalTime:new Date(now+120000).toISOString()},{StopPointRef:'2',ExpectedArrivalTime:new Date(now+180000).toISOString()}]};
const vm=normalizeVehicleMonitoring({ServiceDelivery:{ResponseTimestamp:new Date(now).toISOString(),VehicleMonitoringDelivery:{VehicleActivity:[{RecordedAtTime:new Date(now).toISOString(),MonitoredVehicleJourney:j}]}}},stops,origin,now);
assert.equal(vm.arrivals.length,1);assert.equal(vm.arrivals[0].stopId,'1');assert.equal(vm.stopArrivals.length,2);assert.equal(vm.vehicles.length,1);console.log('PASS vehicle feed retains onward-stop predictions and deduplicates vehicle positions');
