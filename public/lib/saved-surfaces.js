import {validateSurface} from './live-surface.js';
const KEY='garden.saved-surfaces.v1';
export function savedSurfaces(){
 try{return JSON.parse(localStorage.getItem(KEY)||'[]').slice(0,8).flatMap(s=>{try{if(!/^surface-[a-z0-9-]{1,48}$/.test(s.id))return [];const v=validateSurface({...s,operation:'create',revision:1});return [{...v,savedAt:s.savedAt}];}catch{return [];}});}catch{return [];}
}
export function saveSurface(value){
 const all=savedSurfaces(),same=all.find(s=>s.title===value.title&&JSON.stringify(s.recipe)===JSON.stringify(value.recipe));
 if(!same&&all.length>=8)throw Error('Eight saved compositions already exist. Re-save an existing title to update it.');
 const id=same?.id||'surface-'+crypto.randomUUID(),record={...validateSurface({...value,id,operation:'create',revision:1}),savedAt:Date.now()};
 localStorage.setItem(KEY,JSON.stringify([...all.filter(s=>s.id!==id),record]));return record;
}
export const savedEntries=()=>savedSurfaces().map(s=>({id:s.id,file:'/widgets/saved-surface.js',enabled:true,order:100}));
export function renderSurfaceCard(size,record,h){
 const limit=size==='medium'?2:size==='large'?6:3,blocks=(record.blocks||[]).filter(b=>b.type!=='actions'),root=h('div',{class:'saved-composition saved-'+size});
 for(const b of blocks.slice(0,limit))root.append(h('section',{class:'saved-block'},h('span',{class:'saved-label'},b.label),b.type==='metric'?h('strong',{class:'saved-value'},b.value):null,h('p',{class:'saved-copy'},b.type==='list'?(b.items||[]).slice(0,size==='large'?3:1).join(' · '):b.text)));
 if(!blocks.length)root.append(h('p',{class:'saved-copy'},record.blocks.flatMap(b=>b.actions||[]).map(a=>a.label).join(' · ')||'Open your saved composition.'));
 root.append(h('small',{class:'saved-foot'},`${record.recipe?.kind==='briefing'?'Living briefing':'Saved composition'} · ${blocks.length>limit?'+'+(blocks.length-limit)+' more · ':''}open for the full view`));return root;
}
