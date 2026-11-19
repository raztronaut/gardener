import { renderDailySummary } from './reading-summary.js';
import { openFeeds as legacyFeeds } from './feed-reader-legacy.js';
export function wordDate(value) {
  const d=new Date(value);if(!value||!Number.isFinite(+d))return 'Date not supplied';
  const day=d.getDate(),suffix=day%100>=11&&day%100<=13?'th':({1:'st',2:'nd',3:'rd'})[day%10]||'th';
  return `${d.toLocaleDateString('en-US',{month:'long'})} ${day}${suffix}, ${d.getFullYear()}`;
}
async function json(url,options){const r=await fetch(url,{...options,signal:AbortSignal.any([AbortSignal.timeout(35000),...(options?.signal?[options.signal]:[])])});const d=await r.json();if(!r.ok)throw new Error(d.error||'Could not reach the reader.');return d;}
export async function connectFeed(query) {
  const result=await json('/api/feeds/library',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'add',query})});
  window.dispatchEvent(new CustomEvent('garden:feeds-changed',{detail:result.connected}));return result;
}
export function openFeeds({h,openPanel,openReader,query='',manage=false,daily=false,editionId=null,signal=null}) {
  if(!['classic','moonstone'].includes(document.documentElement.dataset.theme))return legacyFeeds({h,openPanel,openReader,query,connectFeed});
  const root=h('section',{class:'fr', 'aria-label':'Garden feed reader'});
  const sidebar=h('nav',{class:'fr-sources','aria-label':'Your feeds'}),list=h('div',{class:'fr-list','aria-label':'Articles'}),preview=h('article',{class:'fr-preview','aria-label':'Article preview'});
  const status=h('div',{class:'fr-status',role:'status','aria-live':'polite'},'Opening your library…');
  const heading=h('h1',{},'A little wider world.');
  const toolbar=h('header',{class:'fr-toolbar'},h('div',{},h('span',{class:'fr-eyebrow'},'THE GARDEN · READING ROOM'),heading),h('div',{class:'fr-toolbar-actions'},h('button',{type:'button',class:'fr-daily-button',onClick:()=>dailyView?goBack():showDaily()},'Read the Daily News Summary'),h('button',{type:'button',class:'fr-add',onClick:()=>showManage()},'+ Discover')));
  const work=h('div',{class:'fr-work'},list,preview);
  const edition=h('article',{class:'fr-edition','data-panel-scroll':'',hidden:true,'aria-label':'Daily news summary',tabindex:'0'});
  root.append(toolbar,status,sidebar,work,edition);openPanel('Reading room',root);
  let library,active='all',generation=0,selected=null,articles=[],management=false,dailyView=false,returnView=null;
  const btn=(label,click,attrs={})=>h('button',{type:'button',onClick:click,...attrs},label);
  const lifetime=new AbortController();
  const requestJSON=(url,options={})=>json(url,{...options,signal:AbortSignal.any([lifetime.signal,...(options.signal?[options.signal]:[])])});
  const live=()=>!lifetime.signal.aborted&&root.isConnected;
  function nav(){
    sidebar.replaceChildren(btn('All',()=>show('all'),{'aria-pressed':String(active==='all'&&!management),'aria-label':'All sources'}),...(library?.feeds||[]).filter(f=>f.subscribed).map(f=>btn(f.title,()=>show(f.id),{'aria-pressed':String(active===f.id&&!management)})),btn('Manage feeds',showManage,{class:'fr-manage'}));
  }
  let articleGeneration=0,articleAbort=null;
  const articleCache=new Map();
  root.dispose=()=>{lifetime.abort();articleAbort?.abort();articleCache.clear();generation++;articleGeneration++;signal?.removeEventListener('abort',root.dispose);};
  if(signal?.aborted)root.dispose();else signal?.addEventListener('abort',root.dispose,{once:true});
  function select(item){
    preview.dataset.gardenShare='';preview.gardenShare={kind:'snapshot',title:item.title,text:(item.content||item.summary||item.title).slice(0,59000),url:item.url};
    const request=++articleGeneration;articleAbort?.abort();articleAbort=new AbortController();
    selected=item.url;
    for(const row of list.querySelectorAll('[data-url]'))row.setAttribute('aria-pressed',String(row.dataset.url===selected));
    const prose=item.content||item.summary||'This publisher shares a headline only. Open the original to read more.';
    preview.replaceChildren(h('div',{class:'fr-article-actions'},btn('Read the original ↗',()=>openReader(item.url,item.title,{original:true}),{class:'fr-read'}),btn('Open in full screen',()=>openReader(item.url,item.title,{fullscreen:true}),{class:'fr-fullscreen'})),h('div',{class:'fr-preview-meta'},item.source||'',h('span',{},wordDate(item.date))),h('h2',{},item.title),h('div',{class:'fr-prose'},...prose.match(/.{1,650}(?:\s|$)|.+$/g)?.map(t=>h('p',{},t))||[]),h('p',{class:'fr-excerpt-note',role:'status'},item.coverage==='website excerpt'?'Publisher’s website listing · Loading article…':'Loading the full article…'));
    if(item.html){const prose=preview.querySelector('.fr-prose');prose.classList.add('article-rich');prose.innerHTML=item.html;}
    // A bounded content fade; no animation loop or layout motion on the Jetson.
    if(!matchMedia('(prefers-reduced-motion: reduce)').matches)preview.animate([{opacity:.35},{opacity:1}],{duration:160});
    preview.scrollTop=0;
    const apply=article=>{if(request!==articleGeneration||!live())return;preview.gardenShare={kind:'snapshot',title:item.title,text:article.text.length>59000?article.text.slice(0,58900)+'\n\nArticle excerpt · open the original for the rest.':article.text,url:item.url};const prose=preview.querySelector('.fr-prose');if(article.html){prose.classList.add('article-rich');prose.innerHTML=article.html;}else prose.replaceChildren(...article.text.split(/\n+/).filter(Boolean).map(p=>h('p',{},p)));preview.querySelector('.fr-excerpt-note').textContent='Article from the publisher · Some publishers supply only a partial article';};
    if(articleCache.has(item.url)){apply(articleCache.get(item.url));return;}
    requestJSON(`/api/feeds/article?id=${encodeURIComponent(item.feedId||active)}&url=${encodeURIComponent(item.url)}`,{signal:articleAbort.signal}).then(article=>{if(request!==articleGeneration||!live())return;articleCache.set(item.url,article);if(articleCache.size>30)articleCache.delete(articleCache.keys().next().value);apply(article);}).catch(error=>{
      if(request!==articleGeneration||!live()||error.name==='AbortError')return;
      preview.querySelector('.fr-excerpt-note').textContent=(item.coverage==='website excerpt'?'Publisher’s website listing':'Publisher’s feed excerpt')+' · Full text could not be retrieved here. Use Read the original.';
    });
  }
  function leaveDaily(){dailyView=false;edition.hidden=true;work.hidden=false;sidebar.hidden=false;toolbar.querySelector('.fr-daily-button').textContent='Read the Daily News Summary';}
  function showDaily(){
    if(!dailyView)returnView={active,selected,listScroll:list.scrollTop,previewScroll:preview.scrollTop,management};
    dailyView=true;management=false;++generation;work.hidden=true;sidebar.hidden=true;edition.hidden=false;heading.textContent='The Daily';
    toolbar.querySelector('.fr-daily-button').setAttribute('aria-pressed','true');
    toolbar.querySelector('.fr-daily-button').textContent='Go back';
    renderDailySummary({h,container:edition,status,openReader,editionId});
  }
  async function goBack(){
    const previous=returnView;
    if(previous?.management)showManage();else{
      await show(previous?.active||'all');
      list.scrollTop=previous?.listScroll||0;preview.scrollTop=previous?.previewScroll||0;
    }
    toolbar.querySelector('.fr-daily-button').focus();
  }
  async function show(id){
    leaveDaily();toolbar.querySelector('.fr-daily-button').setAttribute('aria-pressed','false');
    management=false;work.classList.remove('fr-managing');active=id;const gen=++generation;nav();
    heading.textContent=id==='all'?'A little wider world.':library?.feeds.find(f=>f.id===id)?.title||'Reading room';
    status.textContent='Gathering stories…';list.replaceChildren(h('p',{class:'fr-empty'},'Opening this edition…'));preview.replaceChildren(h('p',{class:'fr-empty'},'Choose a story to settle in.'));
    try{
      const data=await requestJSON(id==='all'?'/api/feeds/digest':`/api/feeds?id=${encodeURIComponent(id)}`);if(gen!==generation||!live())return;
      articles=(data.items||[]).map(i=>({...i,source:i.source||data.title,feedId:i.feedId||data.id}));
      const issues=data.feeds?.filter(f=>f.error)||[];
      status.textContent=data.error||`${articles.length} stories${data.stale?' · Saved edition':''}${data.format==='website'?' · Publisher website edition':''}${issues.length?` · ${issues.map(f=>f.title+' unavailable').join(', ')}`:''}`;
      list.replaceChildren(...articles.map(item=>h('button',{type:'button',class:'fr-story','data-url':item.url,'aria-pressed':'false',onClick:()=>select(item)},h('span',{class:'fr-story-source'},item.source),h('strong',{},item.title),h('span',{class:'fr-summary'},item.summary||'Open this story to read more.'),h('time',{dateTime:item.date||''},wordDate(item.date)))));
      if(articles.length)select(articles.find(i=>i.url===selected)||articles[0]);
      else{list.append(h('p',{class:'fr-empty'},data.error||'No stories yet. Discover a source to begin.'));if(data.website)preview.replaceChildren(btn('Visit publisher ↗',()=>openReader(data.website,data.title)));}
    }catch(e){if(gen===generation&&live()){status.textContent=e.message;list.replaceChildren(btn('Try again',()=>show(id)));}}
  }
  async function add(q,button){
    if(!q.trim())return;button.disabled=true;status.textContent=`Finding ${q}…`;button.textContent='Connecting…';
    try{const result=await connectFeed(q);if(!live())return;library=result;status.textContent=`${result.connected.title} is in your garden.`;show(result.connected.id);}
    catch(e){if(live()){status.textContent=e.message;button.disabled=false;button.textContent='Connect';}}
  }
  function showManage(){
    leaveDaily();toolbar.querySelector('.fr-daily-button').setAttribute('aria-pressed','false');
    management=true;++generation;work.classList.add('fr-managing');heading.textContent='Follow your curiosity.';status.textContent='Connect a source by name, website, or RSS address.';nav();preview.replaceChildren();
    const field=h('input',{type:'text',placeholder:'TechCrunch, a website, or an RSS URL','aria-label':'Find a feed',maxLength:2048});
    const submit=btn('Connect',()=>add(field.value,submit),{class:'fr-read'});
    const form=h('form',{class:'fr-discover',onSubmit:e=>{e.preventDefault();add(field.value,submit);}},field,submit);
    const results=h('div',{class:'fr-catalog'});
    let collection='recommended',category='all';
    const collections=h('div',{class:'fr-collections','aria-label':'Feed collections'});
    const categoryField=h('select',{'aria-label':'Feed category',onChange:e=>{category=e.target.value;draw();}});
    const updateCategories=()=>{category='all';const categories=[...new Set((library?.feeds||[]).filter(f=>collection==='razi'?f.collection==='razi':f.collection!=='razi'||f.subscribed).map(f=>f.category))].sort();categoryField.replaceChildren(h('option',{value:'all'},'All categories'),...categories.map(c=>h('option',{value:c},c)));};
    const collectionButtons=[];
    for(const c of library?.collections||[]){const b=btn(c.title,()=>{collection=c.id;for(const b of collectionButtons)b.setAttribute('aria-pressed',String(b.dataset.collection===collection));updateCategories();draw();},{'data-collection':c.id,'aria-pressed':String(collection===c.id)});collectionButtons.push(b);collections.append(b);}
    updateCategories();
    const draw=()=>results.replaceChildren(...(library?.feeds||[]).filter(f=>(collection==='razi'?f.collection==='razi':f.collection!=='razi'||f.subscribed)&&(category==='all'||f.category===category)).filter(f=>(f.title+' '+f.category+' '+f.description).toLowerCase().includes(field.value.toLowerCase())).map(f=>{
      const action=btn(f.subscribed?'Remove':f.unavailable?'Save source':'Connect',async()=>{
        if(!f.subscribed){await add(f.id,action);return;}
        action.disabled=true;try{library=await requestJSON('/api/feeds/library',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({action:'remove',id:f.id})});window.dispatchEvent(new CustomEvent('garden:feeds-changed'));nav();draw();status.textContent=f.title+' removed.';}catch(e){status.textContent=e.message;action.disabled=false;}
      },{'aria-label':`${f.subscribed?'Remove':'Connect'} ${f.title}`});
      return h('div',{class:'fr-source-card'},h('span',{class:'fr-eyebrow'},f.category),h('h3',{},f.title),h('p',{},f.unavailable||f.description),action);
    }));
    field.addEventListener('input',draw);list.replaceChildren(form,collections,categoryField,results);draw();field.focus();
  }
  if(daily)showDaily();
  requestJSON('/api/feeds/library').then(d=>{if(!live())return;library=d;nav();if(dailyView){return;}else if(query){showManage();const button=list.querySelector('.fr-read');add(query,button);}else if(manage)showManage();else show('all');}).catch(e=>{if(live()&&!dailyView)status.textContent=e.message;});
  return root;
}
