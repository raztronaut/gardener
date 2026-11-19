import {savedSurfaces,renderSurfaceCard} from '/lib/saved-surfaces.js';
import {streamBriefing} from '/lib/briefing-data.js';
import {VARIANTS} from '/lib/widget-variants.js';
import {SIZE_PLANS} from '/lib/widget-size-plans.js';
export function createWidget(entry){
 let record=savedSurfaces().find(s=>s.id===entry.id);if(!record)throw Error('Saved composition unavailable.');
 const homeSize=record.blocks.filter(b=>b.type!=='actions').length<=2?'medium':'wide';
 VARIANTS[entry.id]={medium:'Two key readings with short context',wide:'Three sources at a glance',large:'More context from each saved source'};
 SIZE_PLANS[entry.id]={default:{size:homeSize,reason:'A living composition needs separate readable readings, with the full story one tap away.'},composition:'Medium focuses on two readings; Wide compares three sources; Large earns its space with more context.',overflow:'Keep whole blocks and clamp only summary text. Full text and actions remain available in the expanded surface.',variants:VARIANTS[entry.id]};
 return {id:entry.id,title:record.recipe?.kind==='briefing'?(record.recipe.sections.length===3?'Daily brief':(record.recipe.sections||[]).map(s=>({weather:'Weather',departures:'Rides',news:'News'}[s])).join(' & ')):record.title,size:homeSize==='wide'?'wide':'md',homeSize,chrome:true,getVariantData:()=>record,
 mount(body,ctx){let alive=true,busy=false;const draw=()=>{if(alive)body.replaceChildren(renderSurfaceCard(homeSize,record,ctx.h));};draw();if(record.recipe?.kind==='briefing')ctx.interval(async()=>{if(busy)return;busy=true;try{await streamBriefing(record.recipe.sections,ctx.config,block=>{record={...record,blocks:record.blocks.map(b=>b.id===block.id?block:b)};draw();});}finally{busy=false;}},5*60e3);return()=>alive=false;},
 async openFull(body,ctx){
  if(record.recipe?.kind==='a2ui'){const {remapA2ui}=await import('/lib/a2ui-surface.js');return ctx.act({name:'a2ui',input:{title:record.title,messages:remapA2ui(record.recipe.messages)}});}
  if(record.recipe?.kind==='briefing')return ctx.act({name:'command',input:{name:'briefing',arg:record.recipe.sections.join(' ')}});
  return ctx.act({name:'surface',input:{...record,id:'saved-'+Date.now(),operation:'create',revision:1,status:'Saved '+new Date(record.savedAt).toLocaleDateString()}});
 }};
}
