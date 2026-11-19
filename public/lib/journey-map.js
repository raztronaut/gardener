import {staticMap,svgEl} from './staticmap.js';
const routeKey=l=>l.agency==='BA'?l.routeId:l.route;
const distance=(p,q)=>(p[0]-q.lon)**2+(p[1]-q.lat)**2;
// Published route geometry clipped to boarding/alighting points. Walks are a
// dashed connection, explicitly approximate; never pretend we have street routing.
export function ridePath(leg,shapes){
 let best=null;
 for(const r of shapes.filter(r=>r.route===routeKey(leg)))for(const line of r.paths||[]){
  if(line.length<2)continue;let a=0,b=0;for(let i=1;i<line.length;i++){if(distance(line[i],leg.fromPoint)<distance(line[a],leg.fromPoint))a=i;if(distance(line[i],leg.toPoint)<distance(line[b],leg.toPoint))b=i;}
  const score=distance(line[a],leg.fromPoint)+distance(line[b],leg.toPoint);if(a===b)continue;
  if(!best||score<best.score)best={score,points:line.slice(Math.min(a,b),Math.max(a,b)+1)};
 }
 return best&&best.score<.00005?best.points:null;
}
export function renderJourneyMap({container,journey,network={},h}){
 const legs=journey.legs.filter(l=>l.fromPoint&&l.toPoint),shapes=network.shapes||[];
 if(!legs.length){container.replaceChildren(h('p',{class:'tr-caption'},'Journey map unavailable for these stops.'));return;}
 const routes=new Set(legs.filter(l=>l.type==='ride').map(routeKey));
 const points=legs.flatMap(l=>[l.fromPoint,l.toPoint]),lats=points.map(p=>p.lat),lons=points.map(p=>p.lon);
 const bbox=[Math.min(...lats)-.004,Math.min(...lons)-.005,Math.max(...lats)+.004,Math.max(...lons)+.005];
 const width=Math.max(300,container.clientWidth||740),map=staticMap({bbox,width,height:350,dim:.9,maxZoom:17});map.el.classList.add('tr-journey-map');
 const layer=svgEl('g'),info=h('p',{class:'tr-caption tr-map-status',role:'status'});map.svg.append(layer);
 let board=0,missing=0;
 for(const l of legs){
  const path=l.type==='ride'?ridePath(l,shapes):null;
  if(l.type==='ride'&&!path)missing++;
  const line=path||[[l.fromPoint.lon,l.fromPoint.lat],[l.toPoint.lon,l.toPoint.lat]];
  const d=line.map(([lon,lat],i)=>{const[x,y]=map.project(lat,lon);return `${i?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`;}).join(' ');
  layer.append(svgEl('path',{d,fill:'none',stroke:l.type==='walk'?'var(--color-text-primary)':'var(--color-accent)','stroke-width':l.type==='walk'?3:5,'stroke-dasharray':path?'none':l.type==='walk'?'3 7':'8 8','stroke-linecap':'round'}));
  if(l.type==='ride'){board++;const[x,y]=map.project(l.fromPoint.lat,l.fromPoint.lon);layer.append(svgEl('circle',{cx:x,cy:y,r:11,fill:'var(--color-canvas)',stroke:'var(--color-accent)','stroke-width':2}));const t=svgEl('text',{x,y:y+4,'text-anchor':'middle',fill:'var(--color-text-primary)','font-size':13});t.textContent=board;layer.append(t);}
 }
 for(const [p,label]of [[points[0],'Garden'],[points.at(-1),'Destination']]){const[x,y]=map.project(p.lat,p.lon);layer.append(svgEl('circle',{cx:x,cy:y,r:6,fill:'var(--color-text-primary)',stroke:'var(--color-canvas)','stroke-width':2}));const t=svgEl('text',{x:x+10,y:y-10,fill:'var(--color-text-primary)',stroke:'var(--color-canvas)','stroke-width':3,'paint-order':'stroke','font-size':15});t.textContent=label;layer.append(t);}
 const vehicles=[...(network.data?.routeVehicles||network.data?.vehicles||[]),...(network.bart?.routeVehicles||network.bart?.vehicles||[])].filter(v=>routes.has(v.route)&&Date.now()-v.recorded<300000);
 let shown=0;for(const v of vehicles){const[x,y]=map.project(v.lat,v.lon);if(x<12||x>width-12||y<12||y>338)continue;shown++;
  const g=svgEl('g',{transform:`translate(${x},${y})`,role:'button',tabindex:0,'aria-label':`${v.route.replace('BA:','')} vehicle ${v.id}`,'data-journey-vehicle':v.id});
  g.append(svgEl('rect',{x:-22,y:-13,width:44,height:26,rx:9,fill:'var(--color-accent)',stroke:'var(--color-canvas)','stroke-width':2}));const t=svgEl('text',{x:0,y:5,'text-anchor':'middle',fill:'var(--color-canvas)','font-size':13});t.textContent=v.route.replace('BA:','');g.append(t);
  const inspect=()=>{info.textContent=`${v.route.replace('BA:','')} → ${v.destination||'Destination not supplied'} · position updated ${new Date(v.recorded).toLocaleTimeString('en-US',{hour:'numeric',minute:'2-digit'})}. This vehicle is on your route; a matching trip is not guaranteed.`;};g.addEventListener('click',inspect);g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();inspect();}});layer.append(g);
 }
 info.textContent=`${shown?shown+' reported vehicle'+(shown===1?'':'s')+' on this view · tap to inspect':'No recent vehicle positions on this view'} · dotted walks are approximate${missing?' · dashed ride segments have no matching route shape':''}.`;
 container.replaceChildren(map.el,info);
}
