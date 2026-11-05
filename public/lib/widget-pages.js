import { VARIANTS, sizeAvailable, unavailableReason, renderVariant } from './widget-variants.js';
import { GRID, SIZES, sizeName, defaultSize, packPages, gridMetrics } from './widget-layout.js';

// All approved themes share the same finite-page behavior; appearance lives in theme data.
export function initWidgetPages(options) { return initHome(options); }

function initHome({ garden, h, changed, blocked = () => false, definition = () => ({}) }) {
  const legacyKey='garden.widget-pages.original.v2',events=new AbortController(),observers=[];
  const listen=(node,name,handler,options={})=>node.addEventListener(name,handler,{...options,signal:events.signal});
  const gridEnabled=()=>getComputedStyle(garden).getPropertyValue('--home-grid-mode').trim()==='standard';
  if(document.body.dataset.dash==='main')garden.classList.add('home-paged');
  let standard=gridEnabled();
  const storageKey=()=>standard?`garden.widget-pages.${document.documentElement.dataset.theme}.grid.v3`:legacyKey;
  let activeStorageKey=storageKey();
  function loadLayout(){
    let stored,migrating=false;try{const own=localStorage.getItem(storageKey());migrating=standard&&!own;stored=JSON.parse(own||localStorage.getItem(legacyKey));}catch{}
    const next={pages:2,items:{},...stored};
    if(!Number.isInteger(next.pages)||next.pages<2||next.pages>20)next.pages=2;
    if(!next.items||typeof next.items!=='object'||Array.isArray(next.items))next.items={};
    if(migrating)for(const cfg of Object.values(next.items)){if(cfg&&typeof cfg==='object'){delete cfg.variantReturnPage;delete cfg.clockReturnPage;}}
    return next;
  }
  let state=loadLayout();
  let page=0,editing=false,drag=null,press=null,start=null,suppressUntil=0,layout,returnFocus;
  const variantState=new Map();
  let pickerCard=null;
  const cards=()=>[...garden.querySelectorAll(':scope > .card[data-wid]')];
  const main=()=>document.body.dataset.dash==='main';
  const available=()=>main()&&!blocked()&&!document.hidden;
  const slot=c=>c.dataset.wid==='midterms'?'sf-events':c.dataset.wid;
  const title=c=>c.querySelector('.card-title')?.textContent?.trim()||({fractal:'Trihourly Fractal',clock:'Clock'})[c.dataset.wid]||c.dataset.wid;
  function item(c) {
    const id=slot(c); let cfg=state.items[id];
    if(!cfg||typeof cfg!=='object')cfg=state.items[id]={page:0,order:cards().indexOf(c),hidden:false};
    if(!Number.isInteger(cfg.page)||cfg.page<0||cfg.page>=state.pages)cfg.page=0;
    if(!Number.isFinite(cfg.order))cfg.order=cards().indexOf(c);
    if(!sizeAvailable(c.dataset.wid,cfg.size))cfg.size='original';
    if(standard&&(!Number.isInteger(cfg.requestedPage)||cfg.requestedPage<0||cfg.requestedPage>=state.pages))cfg.requestedPage=cfg.page;
    if(c.dataset.wid==='clock'){cfg.hidden=false;cfg.page=0;if(standard)cfg.requestedPage=0;}
    return cfg;
  }
  const status=h('span',{class:'widget-layout-status',role:'status'});
  const nav=h('nav',{class:'widget-pages home-page-dots','aria-label':'Widget pages'});
  document.querySelector('#feedbackbar').prepend(nav);
  const toolbar=h('div',{class:'widget-edit-bar home-edit-bar',hidden:true},
    h('button',{type:'button',onclick:()=>openGallery()},'+ Add widgets'),h('span',{},'Drag any widget'),status,
    h('button',{type:'button',onclick:()=>edit(false)},'Done'));
  const drawer=h('aside',{class:'widget-drawer',hidden:true,'aria-label':'Widget gallery'});
  const picker=h('aside',{class:'widget-size-picker',hidden:true,'aria-label':'Widget size'});
  document.body.append(toolbar,drawer,picker);
  const empty=h('div',{class:'widget-page-empty',hidden:true},h('p',{},'Room to grow'),h('button',{type:'button',onclick:()=>{edit(true);openGallery();}},'Add widgets'));
  garden.append(empty);
  function save() {try{localStorage.setItem(storageKey(),JSON.stringify(state));status.textContent='Saved';}catch{status.textContent='Storage unavailable — changes last until reload';}}
  const frameSize=c=>sizeName(c.dataset.wid,item(c).size,definition(c.dataset.wid)?.homeSize);
  function entries(){return cards().map(c=>({id:c.dataset.wid,...item(c),page:standard?item(c).requestedPage:item(c).page,size:frameSize(c)}));}
  function metrics(){const s=getComputedStyle(garden);return gridMetrics({width:garden.clientWidth,height:garden.clientHeight,gap:parseFloat(s.gap)||9,padding:parseFloat(s.paddingTop)||2});}
  function arrange(priority) {
    if(standard){if(priority!==undefined)state.anchor=priority;layout=packPages(entries(),state.pages,state.anchor);state.pages=layout.pages;for(const c of cards()){const p=layout.positions[c.dataset.wid];if(p)item(c).page=p.page;}return;}
    // Preserve the original authored grid. The rejected fixed tracks and card
    // variants must never silently restyle a freshly loaded wall.
    const all=cards().filter(c=>c.dataset.wid!=='clock'&&!item(c).hidden).sort((a,b)=>item(a).order-item(b).order);
    const counts=Array(state.pages).fill(0);
    for(const c of all){const cfg=item(c);if(counts[cfg.page]>=13){let next=counts.findIndex((n,i)=>i!==cfg.page&&n<13);if(next<0&&state.pages<20){next=state.pages++;counts.push(0);}if(next>=0)cfg.page=next;}counts[cfg.page]++;}
    layout={pages:state.pages,positions:{},clock:null};
  }

  function apply(priority) {
    nav.hidden=!main();
    if(!main()){ if(editing)edit(false); return; }
    arrange(priority);
    garden.classList.add('home-paged');garden.dataset.layout=standard?'standard':'authored';
    garden.style.setProperty('--widget-unit',`${standard?metrics().row:Math.max(100,(garden.clientHeight-6*(parseFloat(getComputedStyle(garden).gap)||9))/7)}px`);
    for(const c of cards()) {
      const cfg=item(c),p=c.dataset.wid==='clock'?layout.clock:layout.positions[c.dataset.wid];
      const hidden=c.dataset.wid!=='clock'&&(cfg.hidden||cfg.page!==page);
      c.classList.toggle('widget-page-hidden',hidden);
      c.classList.toggle('widget-editing',editing);
      c.style.order=standard?'':String(cfg.order);
      if(standard)c.dataset.gridSize=frameSize(c);else{delete c.dataset.gridSize;c.style.removeProperty('--home-column');c.style.removeProperty('--home-row');}
      if(cfg.size==='original')delete c.dataset.wsize;else c.dataset.wsize=cfg.size;
      syncVariant(c);
      if(p) {
        c.style.setProperty('--home-column',`${p.x+1} / span ${p.columns}`);
        c.style.setProperty('--home-row',`${p.y+1} / span ${p.rows}`);
      }
      let controls=c.querySelector(':scope > .widget-edit-controls');
      if(editing&&!controls){
        controls=h('div',{class:'widget-edit-controls'},
          ...(c.dataset.wid==='clock'?[]:[h('button',{type:'button','aria-label':`Remove ${title(c)}`,onclick:()=>execute({action:'remove',widget:c.dataset.wid})},'×')]),
          h('button',{type:'button',class:'widget-drag-handle','aria-label':`Move ${title(c)}`,title:'Drag anywhere on the card. Arrow keys reorder; Ctrl + Left/Right changes page.',onkeydown:e=>{
            if(!['ArrowLeft','ArrowRight','ArrowUp','ArrowDown'].includes(e.key)||e.shiftKey)return;
            e.preventDefault();e.stopPropagation();
            if(c.dataset.wid==='clock')return;
            const delta=['ArrowLeft','ArrowUp'].includes(e.key)?-1:1;
            const args=e.ctrlKey?{action:'move',page:Math.max(1,Math.min(state.pages,cfg.page+1+delta))}:{action:'reorder',direction:delta<0?'earlier':'later'};
            execute({...args,widget:c.dataset.wid});
          }},'⠿'),
          h('button',{type:'button','aria-label':`Resize ${title(c)}`,onclick:()=>openSizes(c)},'⤢'));
        controls.addEventListener('click',e=>e.stopPropagation()); c.append(controls);
      }else if(!editing)controls?.remove();
    }
    empty.style.gridRow=standard?`${(layout.clock?.rows||1)+1} / -1`:'auto';
    empty.hidden=cards().some(c=>c.dataset.wid!=='clock'&&!c.classList.contains('widget-page-hidden'));
    nav.replaceChildren(...Array.from({length:state.pages},(_,n)=>h('button',{type:'button','aria-label':`Page ${n+1}`,'aria-current':page===n?'page':null,class:n===page?'current':'',onclick:()=>go(n)},h('span',{'aria-hidden':'true'}))));
    garden.dataset.page=String(page);
    changed();
  }
  function update(priority){apply(priority);save();}
  function go(n){if(!main())return;page=Math.max(0,Math.min(state.pages-1,n));cards().forEach(c=>c.classList.remove('focused'));apply();}
  function edit(on=true) {
    if(on&&!available())return;
    if(on&&!editing)returnFocus=document.activeElement;
    editing=on; document.body.classList.toggle('editing-widgets',on);toolbar.hidden=!on;
    if(!on){drawer.hidden=true;picker.hidden=true;cancelDrag();}
    apply();
    // A hold must leave the pointer exactly where it was; no focus scrolling.
    if(!on&&returnFocus?.isConnected)returnFocus.focus({preventScroll:true});
  }
  function renderPreview(c) {
    const clone=c.cloneNode(true), sources=[...c.querySelectorAll('canvas')];
    clone.querySelectorAll('canvas').forEach((cv,i)=>{try{if(cv.closest('.frc')){cv.remove();return;}const img=h('img',{src:sources[i].toDataURL(),alt:''});img.style.cssText=cv.style.cssText;img.style.width=`${sources[i].getBoundingClientRect().width}px`;img.style.height=`${sources[i].getBoundingClientRect().height}px`;cv.replaceWith(img);}catch{cv.remove();}});
    clone.querySelectorAll('.widget-edit-controls,.widget-variant-body,script,iframe').forEach(n=>n.remove());
    [clone,...clone.querySelectorAll('*')].forEach(n=>{n.removeAttribute('id');n.removeAttribute('autofocus');n.removeAttribute('data-wid');});
    clone.classList.remove('widget-page-hidden','widget-editing','widget-dragging');clone.classList.add('widget-preview-card');clone.removeAttribute('data-wsize');clone.removeAttribute('style');clone.querySelectorAll('[hidden]').forEach(n=>{if(n.matches('.card-body,.widget-original-body'))n.hidden=false;});clone.inert=true;return clone;
  }
  function openGallery(){
    picker.hidden=true;
    const gallery=h('div',{class:'widget-gallery'});
    for(const c of cards().filter(c=>c.dataset.wid!=='clock')){
      const cfg=item(c),here=!cfg.hidden&&cfg.page===page;
      gallery.append(h('button',{type:'button',class:'widget-gallery-item',disabled:here,'aria-label':`${here?'On this page:':cfg.hidden?'Add':'Move here:'} ${title(c)}`,onclick:()=>{const r=execute({action:'add',widget:c.dataset.wid,page:page+1});if(r.ok)drawer.hidden=true;}},h('div',{class:'widget-preview','aria-hidden':'true'},renderPreview(c)),h('strong',{},title(c)),h('span',{},here?'On this page':cfg.hidden?'+ Add widget':`Move from page ${cfg.page+1}`)));
    }
    drawer.replaceChildren(h('div',{class:'widget-drawer-head'},h('h2',{},'Add to your garden'),h('button',{type:'button','aria-label':'Close widget gallery',onclick:()=>{drawer.hidden=true;}},'×')),h('p',{},'Pages stay full-screen. Extra widgets get another page.'),gallery,
      h('div',{class:'widget-page-tools'},h('button',{type:'button',onclick:()=>execute({action:'add_page'})},'+ Add page'),h('button',{type:'button',disabled:state.pages<=2,onclick:()=>execute({action:'remove_page',page:page+1})},'Remove this page')));
    drawer.hidden=false;
  }
  function syncVariant(c){
    let record=variantState.get(c);
    if(!record){
      record={originalHeight:c.getBoundingClientRect().height||(c.classList.contains('tall')?360:180),preview:null,queued:false};variantState.set(c,record);
      const observer=new MutationObserver(records=>{
        if(records.every(r=>r.target.closest?.('.widget-variant-body,.widget-edit-controls')||[...r.addedNodes].every(n=>n.nodeType===1&&n.matches?.('.widget-variant-body,.widget-edit-controls,.widget-original-body'))&&r.type==='childList'))return;
        if(record.queued)return;record.queued=true;
        requestAnimationFrame(()=>{record.queued=false;if(!c.isConnected)return;syncVariant(c);if(pickerCard===c&&!picker.hidden)paintSizeChoices(c);});
      });observer.observe(c,{subtree:true,childList:true,characterData:true});record.observer=observer;observers.push(observer);
    }
    const cfg=item(c),selected=cfg.size!=='original';
    if(selected&&!record.preview)record.preview=renderPreview(c);
    let source=c.querySelector(':scope > .card-body,:scope > .widget-original-body');
    // Bare clock content has no card-body. Wrap it only while a variant is selected.
    if(selected&&!source&&c.dataset.wid!=='fractal'){
      source=h('div',{class:'widget-original-body'});for(const n of [...c.childNodes])if(!n.classList?.contains('widget-edit-controls')&&!n.classList?.contains('widget-variant-body'))source.append(n);c.prepend(source);
    }
    let body=c.querySelector(':scope > .widget-variant-body');
    if(!selected){body?.remove();if(source)source.hidden=false;if(source?.classList.contains('widget-original-body'))source.replaceWith(...source.childNodes);return;}
    // The fractal keeps its original live WebGL scene; only its frame changes.
    if(c.dataset.wid==='fractal')return;
    if(source)source.hidden=true;
    if(!body){body=h('div',{class:'widget-variant-body'});c.append(body);}
    const data=definition(c.dataset.wid)?.getVariantData?.();
    const rendered=renderVariant(c.dataset.wid,cfg.size,{card:c,data});if(rendered)body.replaceChildren(rendered);
  }
  const frameSizeForDefault=c=>defaultSize(c.dataset.wid,definition(c.dataset.wid)?.homeSize);
  function previewSize(c,name){
    const original=name==='original',size=SIZES[name],gap=parseFloat(getComputedStyle(garden).gap)||9;
    const legacyWidth=original?(c.classList.contains('w4')?garden.clientWidth:(garden.clientWidth-gap)/2):size.columns===4?garden.clientWidth:(garden.clientWidth-gap)/2;
    const unit=(garden.clientHeight-6*gap)/7;
    const legacyHeight=original?variantState.get(c)?.originalHeight||300:unit*size.rows+gap*(size.rows-1);
    const box=standard?metrics().footprint(original?frameSizeForDefault(c):name):{width:legacyWidth,height:legacyHeight};
    const {width,height}=box;
    const availableWidth=(Math.min(innerWidth-100,820)-28)/3-24,scale=Math.min(availableWidth/width,142/height);
    let frame;
    if(original){frame=(variantState.get(c)?.preview||renderPreview(c)).cloneNode(true);}
    else{
      const classes=['card','wv-preview-frame',c.classList.contains('bare')?'bare':'',c.classList.contains('unframed')?'unframed':''].filter(Boolean).join(' ');
      frame=h('div',{class:classes},c.querySelector('.card-title')?h('div',{class:'card-title'},title(c)):null,h('div',{class:'widget-variant-body'},renderVariant(c.dataset.wid,name,{card:c,data:definition(c.dataset.wid)?.getVariantData?.()})));
    }
    if(standard)frame.classList.add('standard-preview-frame');
    frame.classList.remove('widget-preview-card');frame.style.width='100%';frame.style.height='100%';frame.style.minHeight='0';frame.style.transform='none';frame.inert=true;
    return h('div',{class:'widget-size-preview','aria-hidden':'true'},h('div',{class:'widget-size-preview-scene',style:{width:`${width}px`,height:`${height}px`,transform:`scale(${scale})`,marginLeft:`${-width*scale/2}px`}},frame));
  }
  function paintSizeChoices(c){
    const options=picker.querySelector('.widget-size-options');if(!options)return;
    options.replaceChildren(...Object.entries({original:{label:standard?`Default · ${SIZES[frameSizeForDefault(c)].label}`:'Original'},...SIZES}).map(([name,size])=>{
      const available=sizeAvailable(c.dataset.wid,name),description=name==='original'?(standard?'Authored content in a standard footprint':'Your unchanged original card'):available?VARIANTS[c.dataset.wid][name]:unavailableReason(c.dataset.wid);
      return h('button',{type:'button',disabled:!available,'aria-disabled':String(!available),'aria-label':`${size.label} size`,'aria-pressed':String(item(c).size===name),onclick:()=>{const result=execute({action:'resize',widget:c.dataset.wid,size:name});if(result.ok){picker.hidden=true;pickerCard=null;}}},
        available?previewSize(c,name):h('div',{class:'widget-size-unavailable','aria-hidden':'true'},'Not available'),h('strong',{},size.label),h('span',{class:'widget-size-description'},description));
    }));
  }
  function openSizes(c){
    drawer.hidden=true;pickerCard=c;
    picker.replaceChildren(h('div',{class:'widget-drawer-head'},h('h2',{},title(c)),h('button',{type:'button','aria-label':'Close size picker',onclick:()=>{picker.hidden=true;pickerCard=null;}},'×')),
      h('p',{},standard?'Every choice uses the same page grid. Default keeps the card’s authored content.':'Choose a designed layout. Previews use the current widget content. Original stays unchanged.'),h('div',{class:'widget-size-options'}));
    paintSizeChoices(c);picker.hidden=false;
  }

  function resolve(want){
    const norm=s=>String(s||'').toLowerCase().replace(/[^a-z0-9]+/g,' ').trim();
    const w=norm(want), aliases={painting:'daily','painting of the day':'daily',air:'air-quality',news:'hacker-news',garden:'gardyn',events:'sf-events','out in sf':'sf-events',time:'clock'};
    const found=cards().find(c=>c.dataset.wid===want||norm(title(c))===w||norm(c.dataset.wid)===w||c.dataset.wid===aliases[w]);
    return found;
  }
  function fitsWithoutCrowding(){
    const shown=cards().filter(c=>!c.classList.contains('widget-page-hidden'));
    const wall=garden.getBoundingClientRect(),rects=shown.map(c=>c.getBoundingClientRect());
    if(garden.scrollHeight>garden.clientHeight+2)return false;
    for(let i=0;i<shown.length;i++){
      const r=rects[i],original=variantState.get(shown[i])?.originalHeight||0;
      if(r.bottom>wall.bottom+2||r.top<wall.top-2)return false;
      if(item(shown[i]).size==='original'&&original>80&&r.height<original*.84)return false;
      for(let j=0;j<i;j++)if(Math.min(r.right,rects[j].right)-Math.max(r.left,rects[j].left)>3&&Math.min(r.bottom,rects[j].bottom)-Math.max(r.top,rects[j].top)>3)return false;
    }
    return true;
  }
  function fitChosenSize(c){
    if(standard)return;
    if(fitsWithoutCrowding())return;
    const cfg=item(c),initial=cfg.page;
    const load=n=>cards().filter(p=>p.dataset.wid!=='clock'&&!item(p).hidden&&item(p).page===n).length;
    if(c.dataset.wid==='clock'){
      for(const peer of cards().filter(p=>p.dataset.wid!=='clock'&&!item(p).hidden&&item(p).page===page).reverse()){
        let next=Array.from({length:state.pages},(_,i)=>i).filter(n=>n!==page).sort((a,b)=>load(a)-load(b))[0];
        if(next==null){if(state.pages>=20)throw Error('No room for that size.');next=state.pages++;}
        item(peer).clockReturnPage??=page;item(peer).page=next;apply();if(fitsWithoutCrowding()){save();return;}
      }
      return;
    }
    const candidates=Array.from({length:state.pages},(_,i)=>i).filter(n=>n!==initial).sort((a,b)=>load(a)-load(b));
    for(const n of candidates){cfg.page=n;go(n);if(fitsWithoutCrowding()){cfg.variantReturnPage??=initial;save();return;}}
    if(state.pages>=20)throw Error('No page has room for that size.');
    cfg.page=state.pages++;go(cfg.page);cfg.variantReturnPage??=initial;
    if(!fitsWithoutCrowding())throw Error('This card cannot fit beside the clock at this display size.');
    save();
  }
  function execute(input={}){
    if(!main())return {ok:false,error:'Return to the main wall to arrange widgets.'};
    const before=JSON.stringify(state),previousPage=page;
    try{
      if(Array.isArray(input.changes)) {
        if(!input.changes.length||input.changes.length>20)throw Error('Use between 1 and 20 layout changes.');
        const results=[];
        for(const change of input.changes){if(change.changes)throw Error('Nested changes are not supported.');const result=execute(change);if(!result.ok)throw Error(result.error);results.push(result.say);}
        return {ok:true,say:results.filter(Boolean).join(' '),layout:snapshot()};
      }
      const {action}=input;
      if(action==='inspect')return {ok:true,info:JSON.stringify(snapshot())};
      if(action==='edit'){edit(true);return {ok:true};}
      if(action==='done'){edit(false);return {ok:true};}
      if(action==='page'){
        const n=input.page==='next'?page+1:input.page==='previous'?page-1:Number(input.page)-1;
        if(!Number.isInteger(n)||n<0||n>=state.pages)throw Error(`Choose a page from 1 to ${state.pages}.`);
        go(n);return {ok:true,say:`Page ${page+1}.`};
      }
      if(action==='add_page'){if(state.pages>=20)throw Error('There are already 20 pages.');state.pages++;page=state.pages-1;update();return {ok:true,say:`Added page ${page+1}.`};}
      if(action==='remove_page'){
        const n=input.page==null?page:Number(input.page)-1;
        if(state.pages<=2)throw Error('Keep at least two pages.');
        if(!Number.isInteger(n)||n<0||n>=state.pages)throw Error('That page does not exist.');
        for(const cfg of Object.values(state.items)){if(cfg.page>=n)cfg.page=Math.max(0,cfg.page-1);if(standard&&cfg.requestedPage>=n)cfg.requestedPage=Math.max(0,cfg.requestedPage-1);}
        const oldCount=state.pages;state.pages--;page=Math.min(page,state.pages-1);update();if(state.pages>=oldCount)throw Error('Those widgets still need this page. Remove or shrink some first.');return {ok:true,say:'Removed the page; its widgets were kept.'};
      }
      const c=resolve(input.widget);if(!c)throw Error(`Unknown widget: ${input.widget}. Use an available widget from the layout snapshot.`);
      const cfg=item(c);
      if(input.page!=null){const n=Number(input.page)-1;if(!Number.isInteger(n)||n<0||n>=20)throw Error('Page must be between 1 and 20.');state.pages=Math.max(state.pages,n+1);if(c.dataset.wid!=='clock'){cfg.page=n;if(standard)cfg.requestedPage=n;}}
      if(action==='resize'){
        let size=input.size;
        if(!size&&input.columns!=null&&input.rows!=null)size=Object.keys(SIZES).find(k=>SIZES[k].columns===Number(input.columns)&&SIZES[k].rows===Number(input.rows));
        if(size!=='original'&&!SIZES[size])throw Error('Choose a named widget size.');
        if(!sizeAvailable(c.dataset.wid,size))throw Error(`${size} is not designed for ${title(c)}. Available sizes: original, ${Object.keys(VARIANTS[c.dataset.wid]||{}).join(', ')}.`);
        cfg.size=size;
        if(!standard&&size==='original'&&c.dataset.wid==='clock')for(const peer of cards()){const pc=item(peer);if(Number.isInteger(pc.clockReturnPage)){pc.page=pc.clockReturnPage;delete pc.clockReturnPage;}}
        if(!standard&&size==='original'&&Number.isInteger(cfg.variantReturnPage)){cfg.page=cfg.variantReturnPage;delete cfg.variantReturnPage;}
      }else if(action==='remove'){if(c.dataset.wid==='clock')throw Error('The clock stays on every page.');cfg.hidden=true;}
      else if(action==='add'||action==='move'){if(c.dataset.wid==='clock')throw Error('The clock is on every page already.');cfg.hidden=false;delete cfg.variantReturnPage;delete cfg.clockReturnPage;if(input.page==null)cfg.page=page;if(standard)cfg.requestedPage=cfg.page;if(action==='add')cfg.order=Math.max(0,...cards().map(p=>item(p).order))+1;}
      else if(action==='reorder'){
        if(c.dataset.wid==='clock')throw Error('The clock stays anchored at the top.');
        const all=cards().filter(c=>c.dataset.wid!=='clock').sort((a,b)=>item(a).order-item(b).order);
        const peers=all.filter(p=>!item(p).hidden&&item(p).page===cfg.page);
        let target=input.before?resolve(input.before):input.after?resolve(input.after):null;
        if(input.position!=null&&(!Number.isInteger(Number(input.position))||Number(input.position)<1))throw Error('Position must be a positive whole number.');
        if(!target&&input.position!=null)target=peers[Math.max(0,Math.min(peers.length-1,Number(input.position)-1))];
        if(!target&&input.direction)target=peers[peers.indexOf(c)+(input.direction==='earlier'?-1:1)];
        if(!target||target===c)return {ok:true,say:'Already in that position.'};
        if(item(target).hidden||target.dataset.wid==='clock')throw Error('Choose another visible widget to order beside.');
        const from=all.indexOf(c),to=all.indexOf(target);all.splice(from,1);
        const at=input.before?all.indexOf(target):input.after?all.indexOf(target)+1:to;
        all.splice(at,0,c);all.forEach((p,i)=>{item(p).order=i;});
        if(input.before||input.after)cfg.page=item(target).page;if(standard)cfg.requestedPage=cfg.page;
      }else throw Error(`Unknown layout action: ${action}`);
      // Reordering follows order; additions, moves and resizes reserve space for the target.
      update(action==='reorder'||(action==='resize'&&cfg.size==='original')?null:action==='add'?{id:c.dataset.wid,last:true}:c.dataset.wid);
      if(!cfg.hidden&&c.dataset.wid!=='clock')go(cfg.page);
      if(action==='resize'&&cfg.size!=='original')fitChosenSize(c);
      return {ok:true,say:`${title(c)} ${action==='resize'?`is ${cfg.size}`:action==='remove'?'removed':`on page ${cfg.page+1}`}.`,layout:snapshot()};
    }catch(e){state=JSON.parse(before);page=previousPage;apply();save();status.textContent=e.message;return {ok:false,error:e.message};}
  }
  function snapshot(){return {page:page+1,pages:state.pages,grid:{...GRID,presentation:standard?'standard named footprints':'original authored grid',metrics:standard?{column:metrics().column,row:metrics().row,gap:metrics().gap}:null},sizes:{original:{label:standard?'Default (named footprint)':'Original'},...SIZES},editing,widgets:cards().map(c=>({id:c.dataset.wid,title:title(c),...item(c),page:c.dataset.wid==='clock'?'all':item(c).page+1,pinned:c.dataset.wid==='clock',footprint:standard?{name:frameSize(c),...SIZES[frameSize(c)],...metrics().footprint(frameSize(c))}:null,availableSizes:['original',...Object.keys(VARIANTS[c.dataset.wid]||{})]}))};}
  function clearPress(){clearTimeout(press);press=null;}
  function beginDrag(e,c){
    if(c.dataset.wid==='clock')return;
    clearPress();drawer.hidden=true;picker.hidden=true;
    const r=c.getBoundingClientRect(),ghost=renderPreview(c);
    ghost.className='card home-drag-ghost';ghost.style.cssText=`position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;`;
    document.body.append(ghost);
    drag={card:c,ghost,dx:e.clientX-r.left,dy:e.clientY-r.top,target:null,page,initialPage:page,pointer:e.pointerId};
    c.classList.add('widget-dragging');document.body.classList.add('widget-is-dragging');
    garden.setPointerCapture?.(e.pointerId);suppressUntil=performance.now()+1000;
  }
  function cancelDrag(){if(!drag)return;drag.ghost.remove();drag.card.classList.remove('widget-dragging');drag.target?.classList.remove('widget-drop-target');drag=null;document.body.classList.remove('widget-is-dragging');}
  listen(garden,'pointerdown',e=>{
    if(e.button!==0||!available()||e.target.closest('.widget-edit-controls button:not(.widget-drag-handle),input,select,textarea,[contenteditable="true"]'))return;
    const c=e.target.closest('#garden > .card[data-wid]');start={x:e.clientX,y:e.clientY,id:e.pointerId};
    if(!c)return;
    if(editing){e.preventDefault();e.stopImmediatePropagation();beginDrag(e,c);return;}
    press=setTimeout(()=>{press=null;edit(true);beginDrag(e,c);},450);
  },{capture:true});
  listen(document,'pointermove',e=>{
    if(start&&!drag&&Math.hypot(e.clientX-start.x,e.clientY-start.y)>10)clearPress();
    if(!drag)return;
    e.preventDefault();drag.ghost.style.left=`${e.clientX-drag.dx}px`;drag.ghost.style.top=`${e.clientY-drag.dy}px`;
    const target=document.elementFromPoint(e.clientX,e.clientY)?.closest('#garden > .card[data-wid]');
    drag.target?.classList.remove('widget-drop-target');drag.target=target&&target!==drag.card&&target.dataset.wid!=='clock'?target:null;drag.target?.classList.add('widget-drop-target');
  },{passive:false});
  listen(document,'pointerup',e=>{
    clearPress();
    if(drag){const {card,target}=drag;const movedPage=page!==drag.initialPage;cancelDrag();if(target)execute({action:'reorder',widget:card.dataset.wid,before:target.dataset.wid});else if(movedPage)execute({action:'move',widget:card.dataset.wid,page:page+1});suppressUntil=performance.now()+350;start=null;return;}
    if(start&&e.pointerType!=='mouse'&&!editing){const dx=e.clientX-start.x,dy=e.clientY-start.y;if(available()&&Math.abs(dx)>70&&Math.abs(dx)>Math.abs(dy)*1.5){go(page+(dx<0?1:-1));suppressUntil=performance.now()+350;}}
    start=null;
  });
  listen(document,'pointercancel',()=>{clearPress();cancelDrag();start=null;});
  listen(garden,'lostpointercapture',()=>cancelDrag());
  listen(garden,'click',e=>{if(performance.now()<suppressUntil||(editing&&!e.target.closest('.widget-edit-controls'))){e.preventDefault();e.stopImmediatePropagation();}},{capture:true});
  listen(document,'keydown',e=>{
    if(e.ctrlKey&&e.shiftKey&&['ArrowLeft','ArrowRight'].includes(e.key)&&available()){e.preventDefault();e.stopImmediatePropagation();if(!e.repeat)go(page+(e.key==='ArrowRight'?1:-1));}
    if(e.key==='Escape'&&editing){e.preventDefault();e.stopImmediatePropagation();if(!picker.hidden)picker.hidden=true;else if(!drawer.hidden)drawer.hidden=true;else edit(false);}
  },{capture:true});
  const edges=[-1,1].map(n=>h('div',{class:`widget-edge ${n<0?'left':'right'}`,'aria-hidden':'true'}));
  document.body.append(...edges);
  let edge=0,timer,latched=false;
  const resetEdge=()=>{clearTimeout(timer);edge=0;latched=false;edges.forEach(n=>n.classList.remove('dwelling'));};
  listen(document,'pointermove',e=>{
    const dir=e.clientY>130&&e.clientY<innerHeight-190?e.clientX<18?-1:e.clientX>innerWidth-18?1:0:0;
    if(!dir||!available()||!drawer.hidden||!picker.hidden||e.pointerType!=='mouse'||(e.buttons&&!drag)||page+dir<0||page+dir>=state.pages){resetEdge();return;}
    if(dir===edge)return;resetEdge();edge=dir;
    const cue=edges[dir<0?0:1];cue.style.setProperty('--edge-duration',drag?'750ms':'1500ms');cue.classList.add('dwelling');
    timer=setTimeout(()=>{edges.forEach(n=>n.classList.remove('dwelling'));if(available()&&!latched){latched=true;go(page+dir);}},drag?750:1500);
  });
  listen(window,'blur',()=>{resetEdge();clearPress();cancelDrag();start=null;});
  listen(document,'pointerout',e=>{if(!e.relatedTarget)resetEdge();});
  const cardObserver=new MutationObserver(records=>{for(const n of records.flatMap(r=>[...r.removedNodes])){const record=variantState.get(n);if(record){record.observer.disconnect();const i=observers.indexOf(record.observer);if(i>=0)observers.splice(i,1);variantState.delete(n);}}const added=records.flatMap(r=>[...r.addedNodes]).find(n=>n.matches?.('.card[data-wid]'));apply(added?{id:added.dataset.wid,last:true}:null);save();});cardObserver.observe(garden,{childList:true});observers.push(cardObserver);
  const dashObserver=new MutationObserver(()=>{resetEdge();if(main()){apply();save();}else{edit(false);garden.classList.remove('home-paged');cards().forEach(c=>{c.classList.remove('widget-page-hidden');delete c.dataset.wsize;delete c.dataset.gridSize;});delete garden.dataset.layout;nav.hidden=true;empty.hidden=true;}});dashObserver.observe(document.body,{attributes:true,attributeFilter:['data-dash']});observers.push(dashObserver);
  function designChanged(){
    const next=gridEnabled();
    const nextKey=next?`garden.widget-pages.${document.documentElement.dataset.theme}.grid.v3`:legacyKey;
    if(next!==standard||nextKey!==activeStorageKey){cancelDrag();editing=false;document.body.classList.remove('editing-widgets');toolbar.hidden=true;drawer.hidden=true;picker.hidden=true;standard=next;activeStorageKey=nextKey;state=loadLayout();page=0;}
    apply();save();
  }
  listen(window,'garden:design',designChanged);listen(window,'garden:theme',designChanged);
  if(!state.defaultsRestored) {
    const originalWall=new Set(['clock','air-quality','weather','daily','hacker-news','sf-events','midterms','gardyn','fractal']);
    // Keep the original wall's proportions. Later additions remain available on
    // the next page instead of compressing the established cards.
    for(const c of cards())if(item(c).size==='original'){const cfg=item(c);cfg.page=originalWall.has(c.dataset.wid)?0:1;if(standard)cfg.requestedPage=cfg.page;}
    state.defaultsRestored=true;
  }
  apply();save();
  return { edit:()=>edit(true),done:()=>edit(false),step:n=>{if(available())go(page+n);},snapshot,execute,get editing(){return editing;},destroy:()=>{
    events.abort();observers.forEach(o=>o.disconnect());clearPress();resetEdge();cancelDrag();document.body.classList.remove('editing-widgets');garden.classList.remove('home-paged');
    delete garden.dataset.layout;
    cards().forEach(c=>{c.classList.remove('widget-page-hidden','widget-editing');c.style.removeProperty('--home-column');c.style.removeProperty('--home-row');delete c.dataset.wsize;delete c.dataset.gridSize;c.style.order='';c.querySelector('.widget-edit-controls')?.remove();});[nav,toolbar,drawer,picker,empty,...edges].forEach(n=>n.remove());
  }};
}
