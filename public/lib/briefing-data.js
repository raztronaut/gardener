import {fetchForecast,forecastSnapshot} from './weather-data.js';
export function briefingSections(arg=''){
 arg=String(arg).toLowerCase();
 if(/commute|head out|leav/.test(arg))return ['weather','departures'];
 const out=[];if(/weather|outside|sky/.test(arg))out.push('weather');if(/news|reading|headlines/.test(arg))out.push('news');if(/bus|transit|train|stop|depart/.test(arg))out.push('departures');return out.length?['weather','departures','news'].filter(s=>out.includes(s)):['weather','departures','news'];
}
const read=async path=>{const r=await fetch(path,{signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error();return r.json();};
const time=t=>new Date(t).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
export async function loadBriefingBlock(section,config={}){
 if(section==='weather'){
  let v;try{v=await fetchForecast(config);}catch{v=forecastSnapshot(config);if(!v)throw Error();}
  const d=v.data,t=Math.round(d.current.temperature_2m),today=d.daily;
  return {id:'weather',type:'metric',label:'Outside',value:`${t}°F`,text:`${Math.round((t-32)*5/9)}°C · ${Math.round(today.temperature_2m_min[0])}–${Math.round(today.temperature_2m_max[0])}°F today${Date.now()-v.at>15*60e3?' · saved '+time(v.at):''}`};
 }
 if(section==='departures'){
  const d=await read('/api/transit'),items=(d.arrivals||[]).filter(a=>a.time>Date.now()).slice(0,3).map(a=>`${a.route} → ${a.destination} · ${a.realtime?'':'~'}${Math.ceil((a.time-Date.now())/60000)} min · ~${Math.max(1,Math.ceil(a.distance*1.3/75))} min walk`);
  return {id:section,type:'list',label:d.stale?'Saved departures':'Your next ride',items:items.length?items:[d.error||'No nearby departures predicted right now.']};
 }
 const d=await read('/api/reading-summary').catch(()=>null),e=d?.edition;
 if(e?.intro)return {id:'news',type:'text',label:e.day===d.today?'Today, in a nutshell':`News · saved edition ${e.day}`,text:e.intro.split(/(?<=[.!?])\s+/).slice(0,3).join(' ').slice(0,1000)};
 const feed=await read('/api/feeds/digest');return {id:'news',type:'list',label:'Latest headlines · daily summary not ready',items:(feed.items||[]).slice(0,3).map(i=>i.title)};
}
export async function streamBriefing(sections,config,onBlock){
 await Promise.allSettled(sections.map(async section=>{try{await onBlock(await loadBriefingBlock(section,config));}catch{await onBlock({id:section,type:'text',label:{weather:'Outside',news:'Today’s news',departures:'Your next ride'}[section],text:'This source is taking a moment. Open it below to retry.'});}}));
}
