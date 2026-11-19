import { staticMap, svgEl } from './staticmap.js';
// Event-driven, raster-cached map. No GL context, continuous animation, or inferred
// vehicle movement; dots are precisely the latest provider-reported positions.
export function transitMap({container,data,shapes,route,vehicle,onRoute,onVehicle,camera,onCamera}) {
  const width=Math.max(300,Math.round(container.getBoundingClientRect().width||740)),height=430;
  let bounds=camera;
  const paths=(shapes?.routes||[]).filter(r=>!route||r.route===route);
  if(!bounds){
    const points=route?paths.flatMap(r=>r.paths.flat()):[];
    if(points.length){const xs=points.map(p=>p[0]),ys=points.map(p=>p[1]);bounds=[Math.min(...ys)-.004,Math.min(...xs)-.004,Math.max(...ys)+.004,Math.max(...xs)+.004];}
    else bounds=[data.origin.lat-.012,data.origin.lon-.018,data.origin.lat+.012,data.origin.lon+.018];
  }
  const m=staticMap({bbox:bounds,width,height,dim:.9,maxZoom:17});m.el.classList.add('tr-street-map');
  const layer=svgEl('g');m.svg.append(layer);
  const lineColor=route?'var(--color-accent)':'var(--color-accent-secondary)';
  for(const r of paths){
    const d=r.paths.map(line=>line.map((p,i)=>{const [x,y]=m.project(p[1],p[0]);return `${i?'L':'M'}${x.toFixed(1)},${y.toFixed(1)}`;}).join(' ')).join(' ');
    const path=svgEl('path',{d,fill:'none',stroke:lineColor,'stroke-width':route?4:2,opacity:route?.9:.38,'stroke-linecap':'round'});layer.append(path);
    const hit=svgEl('path',{d,fill:'none',stroke:'transparent','stroke-width':15,tabindex:0,role:'button','aria-label':`Open ${r.route.startsWith('BA:')?'BART':'Muni'} route ${r.route.replace(/^BA:/,'')}`});
    hit.addEventListener('click',e=>{e.stopPropagation();onRoute(r.route);});hit.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();e.stopPropagation();onRoute(r.route);}});layer.append(hit);
  }
  for(const s of data.stops||[]){const [cx,cy]=m.project(s.lat,s.lon);const dot=svgEl('circle',{cx,cy,r:3,fill:'var(--color-text-primary)',stroke:'var(--color-canvas)','stroke-width':1});const title=svgEl('title');title.textContent=s.name;dot.append(title);layer.append(dot);}
  const [hx,hy]=m.project(data.origin.lat,data.origin.lon);layer.append(svgEl('circle',{cx:hx,cy:hy,r:10,fill:'var(--color-accent)',opacity:.17}),svgEl('circle',{cx:hx,cy:hy,r:4,fill:'var(--color-text-primary)'}));
  const vehicles=(route?data.routeVehicles||data.vehicles:data.vehicles||[]).filter(v=>(!route||v.route===route)&&Date.now()-v.recorded<300000);
  for(const v of vehicles){
    const [x,y]=m.project(v.lat,v.lon);if(x<0||y<0||x>width||y>height)continue;
    const g=svgEl('g',{transform:`translate(${x},${y})`,tabindex:0,role:'button','aria-label':`Route ${v.route}, vehicle ${v.id}. Updated ${new Date(v.recorded).toLocaleTimeString()}`});g.classList.add('tr-vehicle-marker');
    g.append(svgEl('rect',{x:-18,y:-15,width:36,height:30,rx:10,fill:v.id===vehicle?'var(--color-text-primary)':'var(--color-accent)',stroke:'var(--color-canvas)','stroke-width':2}));
    const label=svgEl('text',{x:0,y:5,'text-anchor':'middle',fill:'var(--color-canvas)','font-size':15,'font-family':'var(--font-body)','font-weight':600});label.textContent=v.route.replace(/^BA:/,'');g.append(label);
    const select=e=>{e.preventDefault();e.stopPropagation();onVehicle(v);};g.addEventListener('click',select);g.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' ')select(e);});layer.append(g);
  }
  const controls=document.createElement('div');controls.className='tr-map-controls';
  function button(label,action,aria){const b=document.createElement('button');b.type='button';b.textContent=label;b.setAttribute('aria-label',aria);b.onclick=action;controls.append(b);}
  const change=(scale,dx=0,dy=0)=>{const [s,w,n,e]=bounds,hh=Math.min(80,(n-s)*scale/2),hw=Math.min(180,(e-w)*scale/2),cy=Math.max(-85+hh,Math.min(85-hh,(s+n)/2+dy)),cx=Math.max(-180+hw,Math.min(180-hw,(w+e)/2+dx));onCamera([cy-hh,cx-hw,cy+hh,cx+hw]);};
  button('+',()=>change(.65),'Zoom in');button('−',()=>change(1.5),'Zoom out');button('↺',()=>onCamera(null),'Fit route or neighborhood');
  m.el.append(controls);
  // Pointer dragging pans; vertical wheel and normal touch gestures still scroll the page.
  let start;
  const release=()=>{const id=start?.id;start=null;if(id!=null&&m.el.hasPointerCapture(id))m.el.releasePointerCapture(id);};
  m.el.addEventListener('pointerdown',e=>{if(e.button!==0||e.pointerType==='touch'||e.target.closest('button')||e.target.closest('[role="button"]'))return;start={x:e.clientX,y:e.clientY,id:e.pointerId};m.el.setPointerCapture(e.pointerId);});
  m.el.addEventListener('pointerup',e=>{if(!start||e.pointerId!==start.id)return;const dx=e.clientX-start.x,dy=e.clientY-start.y;release();if(Math.hypot(dx,dy)<5)return;change(1,-dx/width*(bounds[3]-bounds[1]),dy/height*(bounds[2]-bounds[0]));});
  m.el.addEventListener('pointercancel',release);
  m.el.addEventListener('lostpointercapture',()=>start=null);
  // A map redraw can replace a node during a drag. Release before detaching it.
  container.firstElementChild?.releaseMapPointer?.();
  m.el.releaseMapPointer=release;
  container.replaceChildren(m.el);
}
