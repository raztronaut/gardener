import {renderJourneyMap} from './journey-map.js';
const clock=t=>new Date(t).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
const minutes=l=>Math.max(1,Math.ceil((l.end-l.start)/60000));
export function mountDirections({h,query='',onRoute,onJourney=()=>{}}){
 const root=h('section',{class:'tr-planner'}),input=h('input',{type:'search',placeholder:'Where are you going?','aria-label':'Destination',maxlength:160,value:query}),button=h('button',{type:'submit'},'Find a way'),status=h('p',{class:'tr-caption',role:'status'}),results=h('div',{class:'tr-plan-results'}),form=h('form',{},input,button);let generation=0,ctl,network={},selected=null,mapBox=null;
 root.append(h('h2',{},'From the Garden to…'),form,status,results);
 const get=async(url,options={})=>{const r=await fetch(url,{...options,signal:AbortSignal.any([ctl.signal,AbortSignal.timeout(25000)])});const d=await r.json();if(!r.ok||d.error)throw Error(d.error||'Try again in a moment.');return d;};
 root.dataset.gardenShare='';root.gardenShare=null;
 const drawMap=()=>{if(selected&&mapBox?.isConnected)renderJourneyMap({container:mapBox,journey:selected,network,h});};
 async function choose(place){
  const turn=++generation;ctl?.abort();ctl=new AbortController();selected=null;root.gardenShare=null;status.textContent='Building your journey…';results.replaceChildren();
  try{const d=await get('/api/transit/plan',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify(place)});if(turn!==generation||!root.isConnected)return;
   status.textContent=`${place.name} · leaving now`;
   const overview=h('div',{class:'tr-journey-overview'}),choices=h('nav',{class:'tr-options','aria-label':'Journey options'}),steps=h('section',{class:'tr-journey'});mapBox=h('div',{class:'tr-journey-map-frame'});
   const select=index=>{selected=d.journeys[index];const j=selected,rides=j.legs.filter(l=>l.type==='ride'),first=rides[0];
    overview.replaceChildren(h('div',{},h('strong',{class:'tr-total'},`${j.minutes} min`),h('span',{},`Arrive ${clock(j.arrival)}`)),h('div',{class:'tr-route-chain'},...j.legs.map(l=>h('span',{class:l.type==='walk'?'tr-walk-chip':'tr-ride-chip'},l.type==='walk'?`Walk ${minutes(l)} min`:l.route))),h('p',{class:'tr-caption'},`~${j.walkingMinutes} min walking · ${j.transfers?j.transfers+' transfer'+(j.transfers===1?'':'s'):'No transfers'} · ${first?'board '+first.route+' at '+clock(first.start):''}`));
    choices.querySelectorAll('button').forEach((b,i)=>b.setAttribute('aria-pressed',String(i===index)));
    steps.replaceChildren(h('h3',{},'Your way there'),...(j.firstStopLive?.length?[h('p',{class:'tr-live-note'},'Live at your first stop: '+j.firstStopLive.map(a=>clock(a.time)).join(', ')+'. Scheduled connections below may change.')]:[]),h('ol',{},...j.legs.map((l,i)=>h('li',{},l.type==='walk'?h('div',{},h('strong',{},`Walk ~${minutes(l)} min`),h('span',{},` to ${l.to}`)):h('div',{},h('button',{type:'button',onClick:()=>onRoute(l.agency==='BA'?l.routeId:l.route)},`${l.mode} ${l.route} → ${l.headsign}`),h('p',{},`${clock(l.start)} · ${l.from}`),h('p',{},`${clock(l.end)} · ${l.to}`),h('small',{},`${minutes(l)} min on board · scheduled`)),l.type==='walk'&&j.legs[i+1]?.type==='ride'?h('small',{},`~${Math.max(0,Math.round((j.legs[i+1].start-l.end)/60000))} min at the stop before boarding`):null))));
    root.gardenShare={kind:'snapshot',title:'Trip to '+j.legs.at(-1).to,text:[`${j.minutes} minutes · ${j.transfers} transfers · approximately ${j.walkingMinutes} minutes walking`,...j.legs.map(l=>l.type==='walk'?`Walk approximately ${minutes(l)} minutes to ${l.to}`:`${l.mode} ${l.route} → ${l.headsign}\n${clock(l.start)} · ${l.from}\n${clock(l.end)} · ${l.to} (scheduled)`),'Schedules checked '+new Date(d.scheduleAt).toLocaleString()+'. Approximate walks; connections may change.'].join('\n\n'),url:d.directionsUrl};
    drawMap();onJourney(j);
   };
   choices.append(...d.journeys.map((j,i)=>h('button',{type:'button',class:'tr-option',onClick:()=>select(i)},h('strong',{},`${j.minutes} min`),h('span',{},j.legs.filter(l=>l.type==='ride').map(l=>l.route).join(' → ')),h('small',{},`~${j.walkingMinutes} min walk · ${j.transfers} transfers`))));
   results.replaceChildren(overview,mapBox,choices,steps,h('p',{class:'tr-caption'},'Scheduled connections · approximate walks, not turn-by-turn paths. Live positions are shown when supplied. Schedules checked '+clock(d.scheduleAt)+'.'),h('a',{href:d.directionsUrl,target:'_blank',rel:'noopener noreferrer'},'Open street directions & compare live options ↗'));
   if(d.journeys.length)select(0);else overview.replaceChildren(h('p',{},'No connection found in the next six hours. Check the full planner below.'));
  }catch(e){if(turn===generation&&e.name!=='AbortError')status.textContent=e.message;}
 }
 async function search(e){e?.preventDefault();const q=input.value.trim();if(q.length<2)return;const turn=++generation;ctl?.abort();ctl=new AbortController();selected=null;root.gardenShare=null;button.disabled=true;status.textContent='Finding your destination…';results.replaceChildren();
  try{const d=await get('/api/transit/places?q='+encodeURIComponent(q));if(turn!==generation||!root.isConnected)return;status.textContent=d.places.length?'Choose the place you mean.':'No nearby match. Try a street address or city name.';results.replaceChildren(...d.places.map(p=>h('button',{class:'tr-place',type:'button','data-psel':'','data-name':p.name,onClick:()=>choose(p)},p.name)),h('small',{},'Place search: OpenStreetMap · Photon'));}catch(e){if(turn===generation&&e.name!=='AbortError')status.textContent=e.message;}finally{if(turn===generation)button.disabled=false;}
 }
 form.addEventListener('submit',search);if(query)setTimeout(()=>{if(root.isConnected)search();},0);
 return {root,setNetwork:n=>{network=n;drawMap();},cleanup:()=>{generation++;ctl?.abort();}};
}
