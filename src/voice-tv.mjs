import {destinationPhrase} from './voice-destination.mjs';
// Paired, certificate-pinned loopback adapter. No microphone/audio transport.
import https from 'node:https';import fs from 'node:fs';import path from 'node:path';
export function tvRequest(route,body,{signal}={}){
 const file=process.env.GARDENER_TV_BRIDGE_CONFIG;
 if(!file)return Promise.reject(Error('GardenTV voice is not configured.'));
 let config,ca;try{config=JSON.parse(fs.readFileSync(file));ca=fs.readFileSync(path.join(path.dirname(file),'cert.pem'));}catch{return Promise.reject(Error('GardenTV pairing is unavailable.'));}
 return new Promise((resolve,reject)=>{
  const port=Number(process.env.GARDENER_TV_BRIDGE_PORT||8790);if(!Number.isInteger(port)||port<1024||port>65535)return reject(Error('Invalid TV bridge port'));
  const req=https.request('https://127.0.0.1:'+port+route,{method:body?'POST':'GET',ca,signal,timeout:25000,headers:{Authorization:'Bearer '+config.token,'content-type':'application/json'}},res=>{let data='';res.on('data',c=>{data+=c;if(data.length>200000)req.destroy(Error('TV response too large'));});res.on('end',()=>{try{const d=JSON.parse(data);if(res.statusCode!==200)return reject(Error(d.error||'GardenTV is unavailable.'));resolve(d);}catch{reject(Error('GardenTV response failed.'));}});});
  req.on('timeout',()=>req.destroy(Error('GardenTV timed out.')));req.on('error',reject);req.end(body?JSON.stringify(body):undefined);
 });
}
export function tvDirectAction(raw){
 const t=String(raw).normalize('NFKC').toLowerCase().trim().replace(/[.!?]+$/,'').replace(/\s+/g,' ').replace(/^please /,'').replace(/ please$/,'').replace(/ (?:app|application)$/,'');
 const names={'youtube':'youtube','you tube':'youtube','netflix':'netflix','twitch':'twitch','spotify':'spotify','prime video':'prime','amazon prime':'prime','disney plus':'disney','disney+':'disney','hulu':'hulu','apple tv':'apple','peacock':'peacock','paramount plus':'paramount','paramount+':'paramount','weather':'weather','air quality':'air-quality','hacker news':'hacker-news','news':'hacker-news','fractal':'fractal','tasks':'todos','to dos':'todos','games':'arcade','game library':'arcade','screensaver settings':'screensaver','tv settings':'settings','settings':'settings','garden':'garden-desktop'};
 const m=t.match(/^(?:open|show|launch|start)(?: up)?(?: me)?(?: the)? (.+)$/);if(m&&names[m[1]])return {name:'open',input:{target:names[m[1]]}};
 if(/^(?:start|launch|play)(?: super)? bomberman(?: 2| two)?$/.test(t))return {name:'command',input:{name:'game',arg:'Super Bomberman 2 (USA).sfc'}};
 if(/^(?:stop|quit|exit|close)(?: the)? game$/.test(t))return {name:'command',input:{name:'game',arg:'stop'}};
 if(/^(?:mute|unmute)$/.test(t))return {name:'command',input:{name:t,arg:''}};
 if(/^(?:pause|resume|play|play pause)$/.test(t))return {name:'command',input:{name:t==='pause'?'pause':t==='play pause'?'playpause':'resume',arg:''}};
 return null;
}

const STREAM_APPS=new Set(['netflix','youtube','twitch','spotify','prime','disney','hulu','apple','peacock','paramount']);
// These exact app launches belong to the TV unless a wall/browser target is explicit.
export function tvAppLaunch(raw){const p=destinationPhrase(raw);if(p.destination==='garden')return null;const action=tvDirectAction(p.text);return action?.name==='open'&&STREAM_APPS.has(action.input.target)?{...p,destination:'tv',action}:null;}
