import legacy from '/lib/transit-legacy.js';
import { mountDirections } from '/lib/transit-directions.js';
import { transitMap } from '/lib/transit-map.js';
let DATA=null;
const time=t=>new Date(t).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'});
const due=a=>{const n=Math.ceil((a.time-Date.now())/60000);return n<=0?'Due':`${n}`;};
const modernTheme=()=>['classic','moonstone'].includes(document.documentElement.dataset.theme);
function departure(a,h,click,detail=false){return h(click?'button':'div',{class:'tr-departure',...(click?{type:'button',onClick:()=>click(a)}:{})},h('span',{class:'tr-line-badge'},a.route.replace(/^BA:/,'')),h('span',{class:'tr-trip'},h('span',{class:'tr-trip-title'},a.destination),detail?h('span',{class:'tr-caption'},`${a.stop} · ~${Math.max(1,Math.ceil(a.distance*1.3/75))} min walk`):null),h('span',{class:'tr-eta'},`${a.realtime?'':'~'}${due(a)}`,h('small',{},due(a)==='Due'?'now':'min')));}
export default {
  id:'transit',title:'Nearby transit',icon:'🚋',size:'md',homeSize:'small',chrome:true,frame:false,getVariantData:()=>DATA||legacy.getVariantData(),
  async mount(body,ctx){
    if(!modernTheme())return legacy.mount(body,ctx);
    const h=ctx.h,root=h('div',{class:'tr-card'},h('span',{class:'tr-caption'},'Listening to the city…'));body.replaceChildren(root);
    let alive=true,busy=false;
    const refresh=async()=>{if(busy)return;busy=true;try{const d=await ctx.fetchJSON('/api/transit',{viaProxy:false,timeout:26000});if(!alive)return;DATA=d;
      const arrivals=(d.arrivals||[]).filter(a=>a.time>Date.now()-30000).slice(0,2);
      root.replaceChildren(...arrivals.map(a=>departure(a,h)),...(!arrivals.length?[h('p',{class:'tr-caption'},d.error||'No predictions nearby right now.')]:[]),h('div',{class:'tr-card-foot'},d.stale?'Saved predictions · check before leaving':'Muni · your next way out ↗'));
    }catch{if(alive)root.replaceChildren(h('p',{class:'tr-caption'},'Live arrivals are taking a moment. Open to retry.'));}finally{busy=false;}};
    await refresh();ctx.interval(refresh,90000,{immediate:false});return()=>alive=false;
  },
  async openFull(body,ctx,options={}){
    if(!modernTheme())return legacy.openFull(body,ctx);
    const {h}=ctx;let data=DATA||{arrivals:[],vehicles:[],stops:[]},shapes=null,catalog=null,bart=null,route='',mode='all',journey=null,vehicle=null,camera=null,alive=true,bartPending=null;
    const meta=r=>catalog?.routes?.find(x=>x.id===(r.startsWith('BA:')?r:'SF:'+r));
    const active=()=>({...((mode==='bart'?bart:data)||{arrivals:[],vehicles:[],stops:[]}),origin:data?.origin||catalog?.origin});
    const root=h('section',{class:'tr-explorer'}),status=h('p',{class:'tr-caption',role:'status'},'Connecting to Muni…'),nav=h('nav',{class:'tr-routes','aria-label':'Transit routes'}),map=h('div',{class:'tr-map-frame'}),detail=h('div',{class:'tr-detail'}),arrivals=h('div',{class:'tr-arrivals'});
    const heading=h('h1',{},'The city is moving.');
    const modes=h('nav',{class:'tr-routes tr-modes','aria-label':'Transit type'});
    const planner=mountDirections({h,query:options.destination||'',onRoute:r=>choose(r),onJourney:j=>{journey=j;route='';mode='all';draw();if(j.legs.some(l=>l.agency==='BA'))refreshBart();}});
    root.append(h('header',{class:'tr-hero'},h('span',{class:'tr-eyebrow'},'THE GARDEN · OUT & ABOUT'),heading,status),planner.root,modes,nav,map,detail,arrivals);body.replaceChildren(root);
    const refreshBart=()=>bartPending||(bartPending=(async()=>{try{bart=await ctx.fetchJSON('/api/transit/bart',{viaProxy:false,timeout:26000});}catch{bart={arrivals:[],vehicles:[],stops:[],error:'BART predictions are unavailable.'};}draw();})().finally(()=>bartPending=null));
    const choose=r=>{journey=null;route=r;vehicle=null;camera=null;if(r.startsWith('BA:')){mode='bart';refreshBart();}else if(mode==='bart')mode='all';draw();};
    function drawMap(){if(!active().origin)return;transitMap({container:map,data:active(),shapes:{...shapes,routes:[...(shapes?.routes||[]),...(catalog?.shapes||[])].filter(r=>route?r.route===route:mode==='bart'?r.route.startsWith('BA:'):!r.route.startsWith('BA:')&&(mode==='all'||(meta(r.route)?.mode==='Muni bus')===(mode==='bus')))},route,vehicle:vehicle?.id,camera,onRoute:choose,onVehicle:v=>{vehicle=v;if(route!==v.route){route=v.route;camera=null;}draw();detail.scrollIntoView({block:'nearest',behavior:'smooth'});},onCamera:c=>{camera=c;drawMap();}});}
    function draw(){
      if(!alive||!root.isConnected||!data)return;
      const d=active(),info=meta(route),kind=info?.mode||(mode==='bart'?'BART':mode==='bus'?'Muni bus':mode==='metro'?'Muni Metro':'Muni · bus & Metro');
      heading.textContent=route?`${route.replace(/^BA:/,'')} · ${info?.name||'Route'}`:mode==='bart'?'Across the Bay.':'The city is moving.';
      if(journey)heading.textContent='Your way to '+journey.legs.at(-1).to.split(' · ')[0]+'.';
      status.textContent=`${kind} · ${d.sourceAt?'updated '+time(d.sourceAt):(d.error||'waiting for live predictions')} · refreshes every ${mode==='bart'?'5 minutes':'90 seconds'}${d.stale?' · SAVED DATA':''}`;
      if(journey)status.textContent='Scheduled journey · reported vehicles appear when available';
      modes.replaceChildren(...[['all','Nearby Muni'],['bus','Muni bus'],['metro','Muni Metro'],['bart','BART']].map(([id,label])=>h('button',{type:'button','aria-pressed':String(mode===id),onClick:()=>{mode=id;route='';vehicle=null;camera=null;if(id==='bart')refreshBart();draw();}},label)));
      let routeIds=[...new Set([...(data.arrivals||[]).map(a=>a.route),...(data.vehicles||[]).map(v=>v.route),...(shapes?.routes||[]).filter(r=>r.paths.some(p=>p.some(([lon,lat])=>Math.abs(lat-data.origin?.lat)<.012&&Math.abs(lon-data.origin?.lon)<.018))).map(r=>r.route),...(route?[route]:[])])].sort((a,b)=>a.localeCompare(b,undefined,{numeric:true}));
      if(mode==='bart')routeIds=(catalog?.routes||[]).filter(r=>r.agency==='BA').map(r=>r.id);
      else if(mode!=='all')routeIds=routeIds.filter(r=>mode==='bus'?meta(r)?.mode==='Muni bus':['Muni Metro','Muni cable car'].includes(meta(r)?.mode));
      nav.replaceChildren(...['',...routeIds].map(r=>h('button',{type:'button','aria-pressed':String(route===r),title:meta(r)?`${meta(r).mode} · ${meta(r).name}`:'Nearby departures',onClick:()=>{if(!r){route='';vehicle=null;camera=null;draw();}else choose(r);}},r.replace(/^BA:/,'')||'Nearby')));
      planner.setNetwork({data, bart, shapes:[...(shapes?.routes||[]),...(catalog?.shapes||[])]});
      drawMap();
      const next=(d.arrivals||[]).filter(a=>(!route||a.route===route)&&a.time>Date.now()-30000);
      const vehicles=(route?d.routeVehicles||d.vehicles:d.vehicles||[]).filter(v=>(!route||v.route===route)&&Date.now()-v.recorded<300000);
      if(vehicle)vehicle=vehicles.find(v=>v.id===vehicle.id)||null;
      const current=vehicle,eta=current?next.find(a=>a.vehicle===current.id):null;
      detail.replaceChildren(h('div',{class:'tr-map-key'},h('span',{},'● The Garden'),h('span',{},'□ Reported vehicle'),h('span',{},shapes?.error||`${route&&![...(shapes?.routes||[]),...(catalog?.shapes||[])].some(r=>r.route===route)?'No published shape for '+route:(shapes?.stale?'Saved ':'')+(mode==='bart'?'BART':'SFMTA')+' route lines'} · drag to pan`)),h('h2',{},current?`On board ${current.id}`:route?`${kind} ${route.replace(/^BA:/,'')} · ${vehicles.length} reported vehicles`:'From your neighborhood'),current?h('p',{class:'tr-vehicle-detail'},`${current.destination||kind+' vehicle'} · position updated ${time(current.recorded)}${eta?` · ${due(eta)}${due(eta)==='Due'?'':' min'} to ${eta.stop}`:' · No matching nearby ETA supplied.'}`):h('p',{class:'tr-caption'},route?'Tap a vehicle to inspect its reported position and nearest matching prediction.':'Tap a route, departure, or vehicle to follow its journey. Routes show published paths, not detours.'));
      arrivals.replaceChildren(h('h2',{},'Next departures'),...next.map(a=>departure(a,h,()=>choose(a.route),true)),...(!next.length?[h('p',{class:'tr-caption'},d.error||'No predictions for these nearby stops. Service may still be running.')]:[]),h('h2',{},'Vehicles on this view'),...vehicles.map(v=>h('button',{type:'button',class:'tr-vehicle-row','aria-pressed':String(vehicle?.id===v.id),onClick:()=>{vehicle=v;draw();detail.scrollIntoView({block:'nearest'});}},h('span',{class:'tr-line-badge'},v.route.replace(/^BA:/,'')),h('span',{},v.destination||`Vehicle ${v.id}`,h('small',{},`Vehicle ${v.id} · position ${time(v.recorded)}`)))),h('p',{class:'tr-caption'},'511 live predictions · ~ means a scheduled estimate. Positions older than five minutes are hidden. Walking times are approximate; use street directions for the actual path.'),h('h2',{},'Nearby stops'),...(d.stops||[]).filter((s,i,a)=>a.findIndex(x=>x.name===s.name)===i).map(s=>h('p',{class:'tr-caption'},`${s.name} · ~${Math.max(1,Math.ceil(s.distance*1.3/75))} min walk`)));
    }
    if(data)draw();
    ctx.fetchJSON('/api/transit/catalog',{viaProxy:false,timeout:25000}).then(c=>{catalog=c;data={...data,origin:data.origin||c.origin};draw();}).catch(()=>{status.textContent='Route descriptions unavailable. Live departure data is separate.';});
    ctx.fetchJSON('/api/transit/routes',{viaProxy:false,timeout:14000}).then(s=>{shapes=s;if(alive)draw();}).catch(()=>{shapes={error:'Route shapes unavailable.'};if(alive)draw();});
    const refresh=async()=>{try{const next=await ctx.fetchJSON('/api/transit',{viaProxy:false,timeout:26000});data={...next,origin:next.origin||data.origin||catalog?.origin};DATA=data;draw();}catch{status.textContent='Live transit is temporarily unavailable. Your last view is still here.';}};
    await refresh();ctx.interval(()=>Promise.all([refresh(),...(mode==='bart'?[refreshBart()]:[])]),90000,{immediate:false});
    return()=>{alive=false;map.firstElementChild?.releaseMapPointer?.();planner.cleanup();};
  }
};
