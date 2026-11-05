import {setTodoDone} from './todo-store.js';
import {todoTaskText} from './todo-assignees.js';
// Opt-in compositions. Original tiles/fullscreens keep their own renderers.
// A size is selectable only when it has an explicit, reviewed content design.
export const VARIANTS = {
  todos: {small:'The next task, with an open-task count',medium:'Three tasks with completion controls',wide:'Next task beside two upcoming tasks',tall:'Five tasks in a calm checklist'},
  clock: {small:'Time, date and the daily poem',wide:'Time beside New York and London'},
  'air-quality': {small:'AQI and its category',wide:'AQI beside the next six hours'},
  weather: {small:'Current temperature and next sun event',medium:'Now and three upcoming hours',wide:'Now beside a six-hour forecast'},
  daily: {medium:'Whole painting with a quiet caption',tall:'Portrait frame, artist and date',wide:'Painting beside its museum label',large:'Large artwork with its story'},
  'hacker-news': {small:'The leading headline',medium:'Three readable headlines',wide:'Four stories in two columns',large:'Six stories with clear ranking'},
  gardyn: {small:'Day and growth stage',medium:'Ready crops, flowers and the next milestone',wide:'The growth timeline, with room for every row',large:'Every plant and its estimated stage'},
  fractal: {medium:'Floating art in a compact frame',tall:'A taller frame for the whole sculpture',large:'Room for the sculpture to breathe'},
  'sf-events': {small:'One upcoming plan',wide:'Three plans side by side',tall:'A five-event agenda'},
  transit: {small:'The next two departures',wide:'Three departures with stop names',tall:'Five departures and provider freshness'},
  // A temporary election card: its authored design is the only reviewed size.
  midterms: {},
};
export const sizeAvailable = (id,size) => size==='original'||Object.hasOwn(VARIANTS[id]||{},size);
export function unavailableReason(id) {
  return id==='midterms'?'This temporary card uses its original design.': 'Not designed for this card. Open fullscreen for more detail.';
}
const h=(tag,attrs={},...kids)=>{const e=document.createElement(tag);for(const[k,v]of Object.entries(attrs)){if(v==null||v===false)continue;if(k==='class')e.className=v;else if(k==='style')Object.assign(e.style,v);else e.setAttribute(k,String(v));}for(const k of kids.flat(Infinity))if(k!=null&&k!==false)e.append(k instanceof Node?k:String(k));return e;};
const text=(s,c='wv-note')=>h('div',{class:c},s);
const stat=(value,label)=>h('div',{class:'wv-stat'},text(value,'wv-value'),text(label,'wv-muted'));
const localHour=iso=>String(iso||'').match(/T(\d\d)/)?.[1];
const hourLabel=iso=>{const n=Number(localHour(iso));return Number.isFinite(n)?`${n%12||12}${n<12?'a':'p'}`:'—';};
const localPrefix=()=>new Intl.DateTimeFormat('sv-SE',{timeZone:'America/Los_Angeles',year:'numeric',month:'2-digit',day:'2-digit',hour:'2-digit',hourCycle:'h23'}).format(new Date()).replace(' ','T');
const currentIndex=times=>Math.max(0,(times||[]).findIndex(t=>String(t).startsWith(localPrefix())));
function shortTime(iso){if(!iso)return '—';const m=String(iso).match(/T(\d\d):(\d\d)/);if(!m)return '—';return `${Number(m[1])%12||12}:${m[2]} ${Number(m[1])<12?'am':'pm'}`;}
function paintImage(data,card){return card.querySelector('.dly-pic')?.src||data?.img||'';}
function weatherRoot(size,data,card){
  const d=data,cur=d?.current;
  const now=h('div',{class:'wv-weather-now'},text(card.querySelector('.wx-now .f')?.textContent||'—','wv-value'),text(card.querySelector('.wx-now .c')?.textContent||'','wv-muted'));
  const icon=card.querySelector('.wx-now .ic img');if(icon)now.prepend(h('img',{src:icon.src,alt:'',class:'wv-weather-icon'}));
  const sun=card.querySelector('.nx');if(sun)now.append(text([sun.querySelector('.k')?.textContent,sun.querySelector('.v')?.textContent].filter(Boolean).join(' '),'wv-note'));
  if(size==='small')return [now];
  if(!cur)return [now,text('Forecast is updating.')];
  const times=d.hourly?.time||[],start=currentIndex(times),count=size==='wide'?6:3;
  const hours=Array.from({length:count},(_,n)=>{const i=start+n*(size==='wide'?2:1),f=d.hourly.temperature_2m?.[i],code=d.hourly.weather_code?.[i];if(!Number.isFinite(f))return null;
    return h('div',{class:'wv-hour'},text(n===0?'Now':hourLabel(times[i]),'wv-muted'),text(`${Math.round(f)}°`,'wv-hour-temp'),d.variantIcons?.[i]?h('img',{src:d.variantIcons[i].src,alt:d.variantIcons[i].label,class:'wv-hour-icon'}):text('','wv-hour-condition'));
  });
  return [now,h('div',{class:'wv-hours'},...hours)];
}
function clockRoot(size,card){
  const time=card.querySelector('.time')?.textContent?.replace(/\s+/g,' ').trim()||new Intl.DateTimeFormat('en-US',{hour:'numeric',minute:'2-digit'}).format(new Date());
  const face=h('div',{class:'wv-clock-face'},text(card.querySelector('.greet')?.textContent||'','wv-poem'),text(time,'wv-time'),text(card.querySelector('.date')?.textContent||new Date().toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric'}),'wv-note'));
  if(size==='small')return [face];
  return [face,h('div',{class:'wv-world'},...['America/New_York','Europe/London'].map((tz,i)=>h('div',{class:'wv-world-row'},text(i?'London':'New York','wv-muted'),text(new Intl.DateTimeFormat('en-US',{timeZone:tz,hour:'numeric',minute:'2-digit'}).format(new Date()),'wv-world-time'))))];
}
function airRoot(size,d,card){
  const aqi=d?.aqi??d?.current?.us_aqi;
  const reading=stat(Number.isFinite(aqi)?String(Math.round(aqi)):card.querySelector('.num')?.textContent||'—',d?.category||card.querySelector('.cat')?.textContent||'Awaiting reading');
  if(d?.bandColor)reading.style.color=d.bandColor;
  if(size==='small')return [reading];
  const values=d?.hourly?.us_aqi||[],times=d?.hourly?.time||[],index=d?.index??currentIndex(times),points=values.slice(index,index+6);
  const chart=h('div',{class:'wv-air-chart','aria-label':'US AQI over the next six hours'},text('Next six hours · US AQI','wv-eyebrow'),h('div',{class:'wv-air-bars'},...points.map((n,i)=>h('div',{class:'wv-air-column'},text(Number.isFinite(n)?Math.round(n):'—','wv-note'),h('div',{class:'wv-air-bar',style:{height:`${Number.isFinite(n)?Math.max(6,Math.min(100,n/Math.max(100,...points.filter(Number.isFinite))*100)):0}%`,background:d?.bands?.find(b=>n<=b.max)?.color||'var(--color-accent)'}}),text(i?hourLabel(times[index+i]):'Now','wv-muted')))));
  return [reading,chart];
}
function newsRoot(size,data,card){
  const stories=(data||[]).slice(0,({small:1,medium:3,wide:4,large:6})[size]);
  if(!stories.length){const t=card.querySelector('.hn-title')?.textContent;return [text(t||'Headlines are updating.','wv-headline')];}
  return stories.map((s,i)=>{let domain='news.ycombinator.com';try{domain=new URL(s.url).hostname.replace(/^www\./,'');}catch{}
    const limit=({small:95,medium:85,wide:120,large:180})[size],title=s.title.length>limit?s.title.slice(0,limit).replace(/\s+\S*$/,'')+'…':s.title;
    return h('div',{class:'wv-story'},text(i+1,'wv-rank'),h('div',{},h('div',{class:'wv-headline',title:s.title},title),text(`▲ ${s.score||0} · ${domain}`,'wv-muted')));
  });
}
function paintingRoot(size,d,card){
  const src=paintImage(d,card),title=d?.title||card.querySelector('.dly-line b')?.textContent||'Painting of the Day';
  const img=h('div',{class:'wv-painting-image'},src?h('img',{src,alt:title,draggable:'false'}):text('The artwork is loading.'));
  const meta=h('div',{class:'wv-painting-label'},text(title,'wv-painting-title'),text(d?.artist||'','wv-note'),text([d?.date,(size==='tall'?null:d?.museumShort||d?.museum)].filter(Boolean).join(' · '),'wv-muted'));
  if(['wide','large'].includes(size)&&d?.blurb)meta.append(text(d.blurb,'wv-art-story'));
  return [img,meta];
}
function gardynRoot(size,d,card){
  const day=d?.day,stage=d?.stage||'Growing';
  const head=h('div',{class:'wv-garden-head'},stat(day==null?'—':`Day ${day}`,stage));
  if(size==='small')return [head];
  if(size==='wide'){
    const chart=card.querySelector('.gd-chart')?.cloneNode(true);if(chart){chart.classList.add('wv-garden-chart');chart.querySelectorAll('[id]').forEach(e=>e.removeAttribute('id'));chart.inert=true;return [head,chart];}
  }
  const plants=(d?.plants||[]).map(p=>({...p,remaining:Math.max(0,p.m[0]-day)})).sort((a,b)=>a.remaining-b.remaining||a.m[0]-b.m[0]);
  const highlights=[plants.find(p=>p.k==='green'&&!p.remaining),plants.find(p=>p.k==='flower'&&!p.remaining),plants.find(p=>p.remaining>0)].filter(Boolean);
  const chosen=size==='large'?plants:[...new Set([...highlights,...plants])].slice(0,3);
  const list=h('div',{class:'wv-plants'},...chosen.slice(0,size==='large'?16:3).map(p=>h('div',{class:'wv-plant'},h('div',{},text(p.short||p.n,'wv-plant-name'),text(p.k==='flower'?'First flowers':'First harvest','wv-muted')),text(p.status?.label || (p.remaining?`${p.remaining}d`:p.k==='flower'?'In bloom':'Ready'),'wv-plant-status'))));
  return [head,list,text('Growth estimates from the sowing date','wv-footnote')];
}
function transitRoot(size,d,card){
  const arrivals=(d?.arrivals||[]).filter(a=>a.time>Date.now()-30000).slice(0,({small:2,wide:3,tall:5})[size]);
  if(!arrivals.length)return [text(d?.error||card.querySelector('.tr-empty')?.textContent||'No upcoming predictions.','wv-note')];
  const rows=arrivals.map(a=>{const mins=Math.round((a.time-Date.now())/60000);return h('div',{class:'wv-departure'},text(a.route,'wv-route'),h('div',{class:'wv-destination'},text(a.destination,'wv-destination-name'),size==='small'?null:text(a.stop,'wv-muted')),text(`${a.realtime?'':'~'}${mins<=0?'Due':`${mins} min`}`,'wv-departure-time'));});
  if(size!=='small')rows.push(text(`${d.stale?'Saved data · ':''}511 · updated ${d.sourceAt?new Date(d.sourceAt).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'}):'time unavailable'}`,'wv-footnote'));
  return rows;
}
function todosRoot(size,data){
  const pending=(data||[]).filter(t=>!t.done),limit=({small:1,medium:3,wide:3,tall:5})[size];
  const rows=pending.slice(0,limit).map((t,i)=>h('label',{class:'todo-glance-row',onClick:e=>e.stopPropagation()},h('input',{type:'checkbox','aria-label':`Mark ${t.title} complete`,onChange:e=>{try{setTodoDone(t.id,e.target.checked);}catch{e.target.checked=false;}}}),h('span',{class:'todo-glance-copy'},size==='wide'&&i===0?text('UP NEXT','rss-source'):null,todoTaskText(h,t))));
  if(!rows.length)rows.push(text('All done.','todo-title'));
  rows.push(text(pending.length>limit?`+ ${pending.length-limit} more · open all ${pending.length}`:`${pending.length} open · tap for details`,'todo-more'));
  return rows;
}
function eventsRoot(size,d,card){
  const events=(d||[]).filter(e=>!e.when||+e.when>Date.now()-3*60*60*1000).slice(0,({small:1,wide:3,tall:5})[size]);
  if(!events.length)return [text(card.querySelector('.won-empty')?.textContent||'No upcoming plans to show.','wv-note')];
  return events.map(e=>h('div',{class:'wv-event'},text(e.when&&!e.allDay?new Intl.DateTimeFormat('en-US',{weekday:'short',hour:'numeric',minute:'2-digit'}).format(e.when):'All day','wv-event-time'),text(e.name,'wv-event-name'),text(e.place||e.venue||e.where||'','wv-muted')));
}
export function renderVariant(id,size,{data,card}){
  if(!sizeAvailable(id,size)||size==='original')return null;
  const renderers={todos:()=>todosRoot(size,data),clock:()=>clockRoot(size,card),'air-quality':()=>airRoot(size,data,card),weather:()=>weatherRoot(size,data,card),daily:()=>paintingRoot(size,data,card),'hacker-news':()=>newsRoot(size,data,card),gardyn:()=>gardynRoot(size,data,card),transit:()=>transitRoot(size,data,card),'sf-events':()=>eventsRoot(size,data,card),fractal:()=>{const src=card.querySelector('.frc img')?.src;return [src?h('img',{class:'wv-fractal-art',src,alt:'Trihourly fractal sculpture'}):text('The sculpture is growing.')];}};
  return h('div',{class:`wv wv-${id} wv-${size}`},...(renderers[id]?.()||[]));
}
