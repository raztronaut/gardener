import { compileDesign, tokenInventory, tokenizeCSS, TOKEN_CONTRACT } from './design-system.js';
import { THEMES, DEFAULT_THEME, themeById, FALLBACK_STYLESHEETS } from './theme-registry.js';
export { THEMES };
export function currentTheme() { return document.documentElement.dataset.theme || DEFAULT_THEME; }
const cache=new Map(), pending=new Map();
let activeDesign=null, lastCSS='', poll=0, initialized=false, status='loading', lastError=null;
export function designContext() {
  const id=currentTheme();
  return {theme:id,file:'public'+(themeById(id)?.file||themeById(DEFAULT_THEME).file),defaultDesignTarget:DEFAULT_THEME,
    approvalPolicy:'Other themes require explicit scope or approval with before/after screenshot previews.',
    guide:'DESIGN_SYSTEM.md',contract:'public/lib/design-contract.js',schema:'public/themes/schema/theme.schema.json',
    status,error:lastError,grid:activeDesign?.layout||'Classic baseline',widgets:activeDesign?.widgets||{},
    inventory:'public/themes/token-inventory.json'};
}
function designStyle(){
  let el=document.getElementById('theme-design');
  if(!el){el=document.createElement('style');el.id='theme-design';document.head.append(el);}return el;
}
function apply(id,entry){
  if(id!==currentTheme())return;
  if(entry.css!==lastCSS){designStyle().textContent=entry.css;lastCSS=entry.css;window.dispatchEvent(new CustomEvent('garden:design',{detail:{id}}));}
  activeDesign=entry.design;status='ready';lastError=null;document.documentElement.removeAttribute('data-theme-error');
}
async function loadDesign(id){
  if(pending.has(id))return pending.get(id);
  const task=(async()=>{
    const r=await fetch(themeById(id).file,{cache:'no-store',signal:AbortSignal.timeout(8000)});
    if(!r.ok)throw Error('Theme HTTP '+r.status);
    const design=await r.json();
    const css=compileDesign(design,id,{supports:CSS.supports.bind(CSS),selectorValid:selector=>{
      const sheet=new CSSStyleSheet();sheet.replaceSync(selector+'{--design-valid:1}');return sheet.cssRules.length>0;
    }});
    const entry={design,css};cache.set(id,entry);return entry;
  })();
  pending.set(id,task);
  try{return await task;}finally{if(pending.get(id)===task)pending.delete(id);}
}
export async function refreshDesign(){
  const id=currentTheme();
  if(!themeById(id))return;
  try{const entry=await loadDesign(id);apply(id,entry);}
  catch(e){
    // An old request must never change the newly selected theme's error/status.
    if(id!==currentTheme())return;
    if(cache.has(id))apply(id,cache.get(id));
    status='error';lastError=e.message;document.documentElement.dataset.themeError=e.message;
    console.error('Design update rejected; keeping this theme’s last valid design:',e);
  }
}
export function setTheme(id){
  if(!themeById(id))return false;
  document.documentElement.dataset.theme=id;
  activeDesign=null;status='loading';lastError=null;document.documentElement.removeAttribute('data-theme-error');
  if(cache.has(id))apply(id,cache.get(id));
  else{designStyle().textContent='';lastCSS='';}
  try{localStorage.setItem('garden.theme',id);}catch{}
  const url=new URL(location.href);
  if(url.searchParams.has('theme')){url.searchParams.delete('theme');history.replaceState(null,'',url);}
  refreshDesign();window.dispatchEvent(new CustomEvent('garden:theme',{detail:{id}}));return true;
}
export function initThemes(open){
  if(initialized)return;initialized=true;
  document.getElementById('themeSelect')?.addEventListener('click',open);
  if(!themeById(currentTheme()))document.documentElement.dataset.theme=DEFAULT_THEME;
  document.getElementById('theme-customization')?.remove();
  // Tokenize fallback sheets once, preserving their original order and values.
  for(const sheet of [...document.styleSheets]){
    if(!sheet.href)continue;
    const registered=FALLBACK_STYLESHEETS.find(item=>item.file===new URL(sheet.href).pathname);
    if(!registered)continue;
    const link=sheet.ownerNode,owner=registered.owner;
    fetch(sheet.href,{signal:AbortSignal.timeout(8000)}).then(r=>{if(!r.ok)throw Error('HTTP '+r.status);return r.text();}).then(source=>{
      const el=document.createElement('style');el.id='design-baseline-'+owner;el.textContent=tokenizeCSS(source,owner);
      link.after(el);link.disabled=true;
    }).catch(e=>console.error('Fallback inventory unavailable; original stylesheet retained:',e));
  }
  window.gardenDesign={context:designContext,tokens:tokenInventory,roles:TOKEN_CONTRACT,refresh:refreshDesign,
    dispose:()=>{clearInterval(poll);initialized=false;}};
  refreshDesign();
  poll=setInterval(()=>{if(!document.hidden)refreshDesign();},5000);
  window.addEventListener('storage',e=>{
    if(e.key!=='garden.theme'&&e.key!==null)return;
    let id=DEFAULT_THEME;try{id=localStorage.getItem('garden.theme')||id;}catch{}
    id=themeById(id)?id:DEFAULT_THEME;
    // Storage synchronization must not rewrite a URL preview or create a storage loop.
    document.documentElement.dataset.theme=id;
    activeDesign=null;status='loading';lastError=null;
    if(cache.has(id))apply(id,cache.get(id));else{designStyle().textContent='';lastCSS='';}
    refreshDesign();
  });
}
