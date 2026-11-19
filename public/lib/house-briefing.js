import {briefingSections,streamBriefing} from './briefing-data.js';
export async function showBriefing(context,act,arg=''){
 const sections=briefingSections(arg),id='briefing-'+Date.now();let revision=1;
 const title=sections.length===3?'Your day, coming together.':sections.includes('departures')?'Before you head out.':'A little perspective.';
 await act({name:'surface',input:{id,operation:'create',revision,title,status:'Connecting the pieces…',recipe:{kind:'briefing',sections},blocks:[
  ...sections.map(id=>({id,type:'text',label:{weather:'Outside',news:'Today, in a nutshell',departures:'Your next ride'}[id],text:'Connecting…'})),
  {id:'actions',type:'actions',actions:sections.map(s=>({target:{weather:'weather',news:'rss',departures:'transit'}[s],label:{weather:'Explore weather',news:'Read today’s stories',departures:'See buses & plan a journey'}[s]}))}
 ]}});
 const update=blocks=>act({name:'surface',input:{id,operation:'update',revision:++revision,blocks}});
 streamBriefing(sections,window.__GARDEN_STATE||{},block=>update([block])).then(()=>act({name:'surface',input:{id,operation:'update',revision:++revision,status:'Ready · '+new Date().toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})+' · save this as a living widget',blocks:[]}}));
 return {ok:true,say:'Your briefing is coming together.'};
}
