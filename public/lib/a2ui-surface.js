import {ACTION_CATALOG,resolveGardenAction} from './garden-actions.js';
import {A2uiJsonlDecoder} from './a2ui-stream.js';
import {setExternalSurfaceReader} from './live-surface.js';
let runtimePromise,current=null;const dead=new Set();
export const loadA2ui=()=>runtimePromise ||= import('/genui/a2ui-runtime.js');
const idOk=s=>typeof s==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(s);
export async function a2uiCatalog(){const r=await loadA2ui();return {protocol:'v0.9',catalogId:r.CATALOG_ID,components:r.componentNames,actions:ACTION_CATALOG,schema:r.catalog.toJson()};}
function check(message,r){
 // Bound the whole structure before Zod visits any collection.
 let nodes=0;const seen=new WeakSet();
 const inspect=(v,depth=0)=>{if(++nodes>12000||depth>24)throw Error('UI structure exceeds its budget.');if(typeof v==='string'&&v.length>16000)throw Error('UI text is too large.');if(!v||typeof v!=='object')return;if(seen.has(v))throw Error('Cyclic UI data.');seen.add(v);const entries=Object.entries(v);if(entries.length>200)throw Error('UI collection is too large.');for(const[k,x]of entries){if(['__proto__','prototype','constructor','functionCall','call'].includes(k))throw Error('Unsupported expression.');if(k==='path'&&typeof x==='string'&&x.split('/').some(p=>['__proto__','prototype','constructor'].includes(p)))throw Error('Invalid binding path.');if(k==='url'&&(typeof x!=='string'||(!/^https:\/\//.test(x)&&!/^\/(?!\/)/.test(x))))throw Error('Use a literal HTTPS or local asset URL.');if(k==='event'&&(!x||!Object.hasOwn(ACTION_CATALOG,x.name)))throw Error('Unknown Garden action.');inspect(x,depth+1);}seen.delete(v);};inspect(message);
 if(new TextEncoder().encode(JSON.stringify(message)).length>131072)throw Error('UI message too large.');

 if(!message||message.version!=='v0.9')throw Error('Expected A2UI v0.9.');
 const keys=['createSurface','updateComponents','updateDataModel','deleteSurface'].filter(k=>message[k]);if(keys.length!==1)throw Error('Expected exactly one A2UI message.');
 const kind=keys[0],body=message[kind];if(!idOk(body.surfaceId))throw Error('Invalid surface id.');
 if(kind==='createSurface'&&body.catalogId!==r.CATALOG_ID)throw Error('Use the advertised Garden catalog.');
 if(kind==='updateComponents'){
  if(!Array.isArray(body.components)||body.components.length>160)throw Error('Use at most 160 components per update.');
  for(const c of body.components){if(!idOk(c.id))throw Error('Invalid component id.');const api=r.catalog.components.get(c.component);if(!api)throw Error('Unknown component '+c.component);const {id,component,...props}=c;const valid=api.schema.safeParse(props);if(!valid.success)throw Error('Invalid '+component+' properties: '+valid.error.issues[0]?.message);}
 }
 return {kind,body};
}
function alive(c){return c?.root.isConnected&&c.ctx.isOpen();}
function rememberDead(id){dead.add(id);if(dead.size>256)dead.delete(dead.values().next().value);}
function retire(c){if(!c)return;c.observer?.disconnect();c.processor.dispose();rememberDead(c.id);if(current===c)current=null;}
function snapshot(){
 if(!alive(current))throw Error('Open a generated surface first.');const c=current;
 const buttonLabels=new Set([...c.components.values()].filter(n=>n.component==='Button').map(n=>n.child));
 const text=[];for(const node of c.components.values())if(!buttonLabels.has(node.id)&&['Text','GardenMetric','GardenNotice','GardenSteps'].includes(node.component)){const data=c.surface.dataModel;const resolve=x=>x&&typeof x==='object'&&x.path?data.get(x.path):x;text.push({id:node.id,type:node.component==='GardenMetric'?'metric':'text',label:String(resolve(node.label)||resolve(node.title)||''),value:String(resolve(node.value)||''),text:String(resolve(node.text)||resolve(node.detail)||(node.items||[]).join(' · ')||'')});}
 const checks=[...c.components.values()].filter(n=>n.component==='CheckBox');if(checks.length)text.unshift({id:'checklist-summary',type:'list',label:'Your checklist',items:checks.map(n=>{const resolve=v=>v&&typeof v==='object'&&v.path?c.surface.dataModel.get(v.path):v;return (resolve(n.value)?'✓ ':'○ ')+String(resolve(n.label)||'');})});
 const messages=[{version:'v0.9',createSurface:{surfaceId:c.id,catalogId:c.catalogId}},{version:'v0.9',updateDataModel:{surfaceId:c.id,path:'/',value:c.surface.dataModel.get('/')}},{version:'v0.9',updateComponents:{surfaceId:c.id,components:[...c.components.values()]}}];
 return {title:c.heading.textContent,blocks:text.slice(0,12),recipe:c.recipe||{kind:'a2ui',messages}};
}
setExternalSurfaceReader(()=>alive(current)?snapshot():null);
export function remapA2ui(messages){const id='saved-'+crypto.randomUUID();return messages.map(m=>{const copy=JSON.parse(JSON.stringify(m));for(const k of ['createSurface','updateComponents','updateDataModel','deleteSurface'])if(copy[k])copy[k].surfaceId=id;return copy;});}
export async function updateA2ui(input,ctx){
 try{
 const r=await loadA2ui(),messages=input.messages;if(!Array.isArray(messages)||!messages.length||messages.length>200)throw Error('Use 1–200 A2UI messages.');
 const checked=messages.map(m=>check(m,r));
 for(let i=0;i<messages.length;i++){
  const {kind,body}=checked[i];
  if(kind==='createSurface'){
   if(dead.has(body.surfaceId))throw Error('That surface has ended. Use a new surface id.');
   if(current?.id===body.surfaceId)throw Error('Surface already exists. Send an update.');
   retire(current);const processor=new r.MessageProcessor([r.catalog]);
   const heading=ctx.h('h1',{},input.title||'Your Garden, composed.'),status=ctx.h('p',{class:'ga-status',role:'status','aria-live':'polite'},input.status||'Taking shape…'),bodyEl=ctx.h('div',{class:'ga-body'}),root=ctx.h('section',{class:'garden-a2ui'},ctx.h('span',{class:'ga-eyebrow'},'THE GARDEN · COMPOSED FOR YOU'),heading,status,bodyEl);
   const c={recipe:input.recipe?.kind==='briefing'?input.recipe:null,id:body.surfaceId,catalogId:r.CATALOG_ID,processor,heading,status,body:bodyEl,root,components:new Map(),ctx,busy:new Set()};current=c;
   const save=ctx.h('button',{type:'button',class:'ga-save',onClick:async()=>{const result=await ctx.act({name:'command',input:{name:'pin'}});if(result?.ok===false&&alive(c))status.textContent=result.error;}},'＋ Keep this as a widget');root.append(ctx.h('footer',{class:'ga-footer'},save));
   processor.onSurfaceCreated(surface=>{
    c.surface=surface;bodyEl.append(r.createRenderer(surface));
    surface.onAction.subscribe(async event=>{
     if(!alive(c)||c.busy.has(event.sourceComponentId))return;c.busy.add(event.sourceComponentId);status.textContent='Working…';
     try{const request=resolveGardenAction(event.name,event.context);const result=await ctx.act(request);if(alive(c))status.textContent=result?.ok===false?result.error||'Please try again.':result?.say||'Done.';}catch(e){if(alive(c))status.textContent=e.message;}finally{c.busy.delete(event.sourceComponentId);}
    });
    surface.onError.subscribe(e=>{if(alive(c))status.textContent=e.message;});
   });
   ctx.openPanel(input.title||'Garden',root,{immediate:true});c.observer=new MutationObserver(()=>{if(!root.isConnected)retire(c);});c.observer.observe(root.parentNode,{childList:true});
  }
  const c=current;if(!c||c.id!==body.surfaceId||!alive(c))throw Error('This surface is no longer open.');
  if(kind==='updateComponents'){
   const candidate=new Map(c.components);for(const node of body.components)candidate.set(node.id,node);
   if(candidate.size>160)throw Error('Surface component budget exceeded.');
   const visiting=new Set(),visited=new Set();const visit=id=>{if(visiting.has(id))throw Error('Components cannot contain a cycle.');if(visited.has(id))return;const n=candidate.get(id);if(!n)return;visiting.add(id);const refs=[n.child,n.entryPointChild,n.contentChild,...(Array.isArray(n.children)?n.children:[]),...(Array.isArray(n.tabs)?n.tabs.map(t=>t.child):[])];for(const ref of refs)if(typeof ref==='string')visit(ref);visiting.delete(id);visited.add(id);};for(const key of candidate.keys())visit(key);
   c.components=candidate;
  }
  if(kind==='updateDataModel'){
   // Bound accumulated state, including many individually small incremental patches.
   const bytes=new TextEncoder().encode(JSON.stringify(body.value??null)).length;
   const old=c.surface?.dataModel.get(body.path||'/');
   const oldBytes=new TextEncoder().encode(JSON.stringify(old??null)).length;
   const total=new TextEncoder().encode(JSON.stringify(c.surface?.dataModel.get('/')??{})).length;
   if(total-oldBytes+bytes>131072)throw Error('Surface data budget exceeded.');
  }
  if(kind==='deleteSurface'){retire(c);await ctx.act({name:'close',input:{}});continue;}
  const errors=c.processor.processMessagesWithErrors([messages[i]]);if(errors.length)throw Error(errors[0].error?.message||JSON.stringify(errors[0]).slice(0,240));
  if(input.title)c.heading.textContent=String(input.title).slice(0,120);
  if(input.status)c.status.textContent=String(input.status).slice(0,180);else if(kind==='updateComponents'&&c.components.has('root'))c.status.textContent='Ready to use.';
 }
 return {ok:true,surface:current?.id,protocol:'v0.9',components:current?.components.size||0};
 }catch(e){return {ok:false,error:e.message};}
}
export async function streamA2ui(chunks,ctx,{title,signal}={}){
 const queue=[];const decoder=new A2uiJsonlDecoder(m=>queue.push(m));let count=0;
 for await(const chunk of chunks){signal?.throwIfAborted();decoder.push(chunk);while(queue.length){const result=await updateA2ui({title,messages:[queue.shift()]},ctx);if(!result.ok)throw Error(result.error);count++;}}
 decoder.finish();while(queue.length){signal?.throwIfAborted();const result=await updateA2ui({title,messages:[queue.shift()]},ctx);if(!result.ok)throw Error(result.error);count++;}return {ok:true,messages:count};
}
