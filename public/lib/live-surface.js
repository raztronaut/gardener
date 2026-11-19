// Garden's small declarative UI catalog. Keyed updates are data, never executable
// HTML/JS/CSS. RAM only; a closed surface cannot be resurrected by a late patch.
const catalog=['text','metric','list','actions'];
const words=(value,max=1600)=>typeof value==='string'?value.slice(0,max):'';
const ids=value=>typeof value==='string'&&/^[a-zA-Z0-9_-]{1,64}$/.test(value);
export const SURFACE_CATALOG=Object.freeze({version:1,types:catalog,maxBlocks:12,actions:['weather','transit','rss','clock','gardyn','home','close']});
export function validateSurface(input){
  if(!input||!ids(input.id)||!['create','update'].includes(input.operation)||!Number.isSafeInteger(input.revision)||input.revision<1)throw Error('Expected surface id, create/update operation, and positive integer revision.');
  if(!Array.isArray(input.blocks)||input.blocks.length>12)throw Error('Use at most 12 blocks.');
  const seen=new Set();const blocks=input.blocks.map(b=>{
    if(!ids(b.id)||seen.has(b.id)||!catalog.includes(b.type))throw Error('Each block needs a unique id and a catalog type.');seen.add(b.id);
    if(b.type==='actions'&&(!Array.isArray(b.actions)||b.actions.some(a=>!SURFACE_CATALOG.actions.includes(a.target))))throw Error('Unknown surface action.');
    return {id:b.id,type:b.type,label:words(b.label,100),text:words(b.text),value:words(b.value,80),items:Array.isArray(b.items)?b.items.slice(0,12).map(i=>words(i,300)):[],actions:Array.isArray(b.actions)?b.actions.slice(0,6).map(a=>({label:words(a.label,60),target:a.target})):[]};
  });return {id:input.id,operation:input.operation,revision:input.revision,title:input.title===undefined?undefined:words(input.title,120),status:input.status===undefined?undefined:words(input.status,180),blocks,recipe:input.recipe?.kind==='a2ui'&&Array.isArray(input.recipe.messages)&&JSON.stringify(input.recipe.messages).length<131072?{kind:'a2ui',messages:input.recipe.messages}:input.recipe?.kind==='briefing'?{kind:'briefing',sections:(input.recipe.sections||[]).filter(s=>['weather','news','departures'].includes(s)).slice(0,3)}:undefined};
}
let current=null,externalReader=()=>null;
export function setExternalSurfaceReader(reader){externalReader=reader;}
export function currentSurface(){const external=externalReader();if(external)return external;if(!current?.root.isConnected||!current.isOpen())throw Error('Open a generated briefing or surface first.');return {title:current.heading.textContent,blocks:[...current.contents.values()].map(v=>JSON.parse(v)),recipe:current.recipe};}
export function updateSurface(input,{h,openPanel,act,isOpen=()=>true}){
  let s;try{s=validateSurface(input);}catch(e){return {ok:false,error:e.message};}
  if(s.operation==='update'&&(!current||current.id!==s.id||!current.root.isConnected||!current.isOpen()))return {ok:false,error:'This surface is no longer open. Create a new surface to show it.'};
  if(current?.id===s.id&&s.revision<=current.revision)return {ok:false,error:'Stale surface revision ignored.'};
  if(s.operation==='create'){
    s.title ||= 'Garden';const heading=h('h1',{},s.title),status=h('p',{class:'gs-status',role:'status','aria-live':'polite'}),body=h('div',{class:'gs-blocks'}),root=h('section',{class:'gs'},h('span',{class:'gs-eyebrow'},'THE GARDEN · LIVE'),heading,status,body);
    const save=h('button',{type:'button',class:'gs-save',onClick:async()=>{save.disabled=true;try{const result=await act({name:'command',input:{name:'pin',arg:''}});if(result?.ok===false)status.textContent=result.error;}catch{status.textContent='Could not save. Try again.';}finally{save.disabled=false;}}},'＋ Make this a widget');root.append(h('footer',{class:'gs-footer'},save,h('span',{},'A live composition. Yours to keep.')));
    current={id:s.id,revision:0,root,heading,status,body,nodes:new Map(),contents:new Map(),isOpen,recipe:s.recipe};openPanel(s.title,root,{immediate:true});
  }
  const c=current;c.revision=s.revision;if(s.title!==undefined)c.heading.textContent=s.title;if(s.status!==undefined)c.status.textContent=s.status;
  for(const b of s.blocks){
    const signature=JSON.stringify(b);if(c.contents.get(b.id)===signature)continue;c.contents.set(b.id,signature);
    let node=c.nodes.get(b.id);if(!node){node=h('section',{class:'gs-block','data-block':b.id});c.nodes.set(b.id,node);c.body.append(node);}
    const kids=b.label?[h('h2',{},b.label)]:[];
    node.dataset.kind=b.type;
    if(b.type==='text')kids.push(h('p',{},b.text));
    if(b.type==='metric')kids.push(h('div',{class:'gs-value'},b.value),h('p',{},b.text));
    if(b.type==='list')kids.push(h('ul',{},...b.items.map(i=>h('li',{},i))));
    if(b.type==='actions')kids.push(h('div',{class:'gs-actions'},...b.actions.map(a=>h('button',{type:'button',onClick:async e=>{
      const request=a.target==='home'?{name:'dashboard',input:{id:'main'}}:a.target==='close'?{name:'close',input:{}}:{name:'open',input:{target:a.target}};
      const button=e.currentTarget;button.disabled=true;
      try{const result=await act(request);if(result?.ok===false&&c.root.isConnected)c.status.textContent=result.error||'Action unavailable.';}
      catch{if(c.root.isConnected)c.status.textContent='Action unavailable. Please try again.';}
      finally{if(button.isConnected)button.disabled=false;}
    }},a.label||a.target))));
    node.replaceChildren(...kids);
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches)node.animate([{opacity:0,transform:'translateY(8px)'},{opacity:1,transform:'translateY(0)'}],{duration:260,easing:'cubic-bezier(.2,.7,.2,1)'});
  }
  // Keep updates bounded even when an agent keeps adding new ids.
  while(c.nodes.size>12){const [id,node]=c.nodes.entries().next().value;node.remove();c.nodes.delete(id);c.contents.delete(id);}
  return {ok:true,surface:s.id,revision:s.revision,blocks:c.nodes.size};
}
