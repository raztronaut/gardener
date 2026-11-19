// Read-only geometric checks. No design prescriptions: charts, imagery, type and
// composition remain free. A deliberate line clamp is distinct from a cut-off box.
export function auditLayout(){
 const issues=[],garden=document.getElementById('garden');if(!garden)return {ok:false,issues:[{kind:'missing-wall'}]};
 const box=e=>e.getBoundingClientRect(),inside=(a,b)=>a.left>=b.left-3&&a.top>=b.top-3&&a.right<=b.right+3&&a.bottom<=b.bottom+3;
 const visible=e=>{const r=box(e);return r.width>0&&r.height>0&&getComputedStyle(e).visibility!=='hidden';};
 const cards=[...garden.querySelectorAll(':scope > .card[data-wid]')].filter(e=>visible(e)&&!e.classList.contains('widget-page-hidden'));
 const outer=box(garden),vw=innerWidth,vh=innerHeight;
 if(garden.scrollHeight>garden.clientHeight+3)issues.push({kind:'page-overflow',pixels:garden.scrollHeight-garden.clientHeight});
 if(outer.bottom>vh+3||outer.right>vw+3||outer.left< -3)issues.push({kind:'wall-outside-viewport'});
 for(let i=0;i<cards.length;i++){
  const card=cards[i],r=box(card),id=card.dataset.wid;
  if(!inside(r,outer))issues.push({widget:id,kind:'card-outside-page'});
  for(let j=0;j<i;j++){const b=box(cards[j]);if(Math.min(r.right,b.right)-Math.max(r.left,b.left)>3&&Math.min(r.bottom,b.bottom)-Math.max(r.top,b.top)>3)issues.push({widget:id,other:cards[j].dataset.wid,kind:'card-overlap'});}
  for(const body of card.querySelectorAll(':scope > .card-body, :scope > .widget-variant-body')){
   if(!visible(body)||body.hidden)continue;
   if(body.scrollHeight>body.clientHeight+3)issues.push({widget:id,kind:'content-overflow-y',pixels:body.scrollHeight-body.clientHeight});
   if(body.scrollWidth>body.clientWidth+3)issues.push({widget:id,kind:'content-overflow-x',pixels:body.scrollWidth-body.clientWidth});
  }
  for(const e of card.querySelectorAll('.card-body *, .widget-variant-body *')){
   if(!(e instanceof HTMLElement)||!visible(e)||e.closest('[hidden]')||!e.textContent?.trim())continue;
   const style=getComputedStyle(e),clamped=Number(style.webkitLineClamp)>0,ellipsis=style.textOverflow==='ellipsis';
   if(!clamped&&['hidden','clip'].includes(style.overflowY)&&e.scrollHeight>e.clientHeight+3)issues.push({widget:id,kind:'hidden-content-y',element:e.className,pixels:e.scrollHeight-e.clientHeight});
   if(!clamped&&!ellipsis&&['hidden','clip'].includes(style.overflowX)&&e.scrollWidth>e.clientWidth+3)issues.push({widget:id,kind:'hidden-content-x',element:e.className,pixels:e.scrollWidth-e.clientWidth});
  }
  for(const e of card.querySelectorAll('button,input,select,textarea,a[href],.todo-more')){
   if(!visible(e)||e.closest('[hidden]'))continue;
   if(!inside(box(e),r))issues.push({widget:id,kind:'clipped-control',label:(e.getAttribute('aria-label')||e.textContent||e.tagName).slice(0,60)});
  }
 }
 const footer=document.getElementById('feedbackbar');if(footer&&box(footer).bottom>vh+3)issues.push({kind:'composer-outside-viewport'});
 return {ok:!issues.length,theme:document.documentElement.dataset.theme,page:document.querySelector('.widget-page-dot[aria-current="page"]')?.textContent,cards:cards.length,issues};
}
