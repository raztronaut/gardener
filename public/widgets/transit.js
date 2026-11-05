// Read-only 511 Muni data; credential and configured origin stay on the server.
const STYLE = `
.tr-tile { min-height:0; height:100%; display:flex; flex-direction:column; justify-content:center; gap:4px; }
.tr-row { display:flex; gap:16px; align-items:baseline; padding:10px 0; }
.tr-tile .tr-row { padding:4px 0; }
.tr-tile .tr-destination { font-size:18px; line-height:1.2; display:-webkit-box; -webkit-line-clamp:2; -webkit-box-orient:vertical; overflow:hidden; }
.tr-tile .tr-minutes,.tr-tile .tr-route { font-size:24px; }
.tr-route { font:32px var(--font-display); color:var(--mint); min-width:45px; }
.tr-destination { flex:1; min-width:0; font-size:20px; }
.tr-minutes { font:30px var(--font-display); white-space:nowrap; }
.tr-sub { color:var(--ink-soft); font-size:15px; margin-top:6px; }
.tr-full { padding:24px; }
.tr-full h2 { font:28px var(--font-display); margin:26px 0 12px; }
.tr-map { display:block; width:100%; max-height:480px; border:1px solid var(--stroke); border-radius:18px; background:rgba(5,20,14,.6); }
.tr-map text { font:14px var(--font); fill:var(--ink); }
.tr-empty { color:var(--ink-soft); }
`;
const due = (a) => {const n=Math.round((a.time-Date.now())/60000);return n<=0?'Due':`${n} min`;};
function row(a,h,full) { return h('div',{class:'tr-row'},h('span',{class:'tr-route'},a.route),h('div',{class:'tr-destination'},a.destination,full?h('div',{class:'tr-sub'},`${a.stop} · ${a.distance} m straight-line`):null),h('span',{class:'tr-minutes'},`${a.realtime?'':'~'}${due(a)}`)); }
function map(data) {
  const ns='http://www.w3.org/2000/svg',svg=document.createElementNS(ns,'svg');svg.setAttribute('viewBox','0 0 660 460');svg.classList.add('tr-map');svg.setAttribute('role','img');svg.setAttribute('aria-label','Nearby reported vehicle positions. North is up. Schematic, not a street map.');
  const add=(tag,attrs,text)=>{const el=document.createElementNS(ns,tag);for(const[k,v]of Object.entries(attrs))el.setAttribute(k,v);if(text)el.textContent=text;svg.append(el);return el;};
  add('path',{d:'M330 15V445 M15 230H645',stroke:'rgba(180,220,200,.15)',fill:'none'});
  add('text',{x:20,y:28},'N ↑ · 500 m');add('path',{d:'M20 45H70',stroke:'#9fbfaf','stroke-width':2});
  const pos=(p)=>({x:330+(p.lon-data.origin.lon)*111195*Math.cos(data.origin.lat*Math.PI/180)*.1,y:230-(p.lat-data.origin.lat)*111195*.1});
  for(const s of data.stops||[]){const p=pos(s);add('circle',{cx:p.x,cy:p.y,r:3,fill:'#9fbfaf'});}
  add('circle',{cx:330,cy:230,r:6,fill:'#fff'});add('text',{x:340,y:248},'Nearby origin');
  for(const v of (data.vehicles||[]).filter(v=>Date.now()-v.recorded<300000)){const p=pos(v);add('circle',{cx:p.x,cy:p.y,r:6,fill:'#74f7b0'});add('text',{x:p.x+9,y:p.y-7},v.route);}
  return svg;
}
async function render(body,ctx,full) {
  ctx.style(STYLE);const {h}=ctx;const root=h('div',{class:full?'tr-full':'tr-tile'},h('div',{class:'tr-empty'},'Checking nearby departures…'));body.replaceChildren(root);
  const refresh=async()=>{
    try {
      const data=await ctx.fetchJSON('/api/transit',{viaProxy:false,timeout:26000});
      const valid=(data.arrivals||[]).filter(a=>a.time>Date.now()-30000);
      if(!full){root.replaceChildren(...(valid.length?valid.slice(0,2).map(a=>row(a,h,false)):[h('div',{class:'tr-empty'},data.error||'No upcoming predictions nearby.')]),...(data.stale?[h('div',{class:'tr-sub'},'Saved data · open to check freshness')]:[]));return;}
      const stamp=data.sourceAt?new Date(data.sourceAt).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}):'unavailable';
      root.replaceChildren(h('p',{class:'tr-sub'},`Muni · 511 · provider updated ${stamp} · refresh every 90 seconds${data.stale?' · SAVED / STALE DATA':''}`),data.error?h('p',{class:'tr-empty'},data.error):h('p',{class:'tr-sub'},'Nearest stops plus the nearby Taraval corridor. ~ marks a schedule estimate.'),h('h2',{},'Next departures'),...(valid.length?valid.map(a=>row(a,h,true)):[h('p',{class:'tr-empty'},'No upcoming predictions. This does not mean service has stopped.')]),h('h2',{},'Reported vehicle positions'),h('p',{class:'tr-sub'},'Within 1.8 km · north up · schematic, not a street map. Positions older than five minutes are excluded.'),...(data.origin?[map(data)]:[]),h('h2',{},'Stops covered'),...(data.stops||[]).map(s=>h('p',{class:'tr-sub'},`${s.name} · ${s.distance} m · stop ${s.id}`)));
    } catch {root.replaceChildren(h('p',{class:'tr-empty'},'Live transit is temporarily unavailable.'));}
  };await refresh();ctx.interval(refresh,90000);
}
export default {id:'transit',title:'Nearby transit',icon:'🚋',size:'md',chrome:true,frame:false,mount:(body,ctx)=>render(body,ctx,false),openFull:(body,ctx)=>render(body,ctx,true)};
