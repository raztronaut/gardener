// The editor publishes once; every wall reads the same cached daily edition.
export async function renderDailySummary({ h, container, status, openReader, editionId }) {
  container.dataset.gardenShare='';container.gardenShare=null;
  container.replaceChildren(h('p', {class:'fr-empty'}, 'Opening today’s edition…'));
  try {
    const response=await fetch('/api/reading-summary'+(editionId?'?edition='+encodeURIComponent(editionId):''),{cache:'no-store',signal:AbortSignal.timeout(10000)});
    if(!response.ok)throw Error('The daily edition could not be reached.');
    const data=await response.json();
    if(!container.isConnected || container.hidden)return;
    const e=data.edition;
    if(!e){status.textContent='Your first edition is on its way.';container.replaceChildren(h('h2',{},'A fresh perspective, every morning.'),h('p',{},'The Reading Room editor gathers the major stories from your connected feeds. Your daily edition will appear here when it is ready.'));return;}
    const date=new Date(e.day+'T12:00:00').toLocaleDateString('en-US',{weekday:'long',month:'long',day:'numeric',year:'numeric'});
    const minutes=Math.max(1,Math.ceil(e.wordCount/200));
    status.textContent=e.day===data.today?'Today’s edition is ready.':`Showing the saved edition from ${date}.`;
    const sourceLinks = sources => !sources?.length ? null : h('div',{class:'fr-edition-sources'},h('span',{class:'fr-eyebrow'},'READ FURTHER'),...sources.map(source=>h('button',{type:'button',class:'fr-source-link',onClick:()=>openReader(source.url,source.title)},h('span',{},source.source+' ↗'),h('strong',{},source.title),source.coverage==='feed excerpt'?h('small',{},'Summary based on the publisher’s feed excerpt'):source.coverage==='website excerpt'?h('small',{},'Summary based on the publisher’s website listing'):null)));
    const storyCount=e.sections.reduce((count,s)=>count+(s.stories?.length||1),0);
    container.replaceChildren(
      h('header',{class:'fr-edition-lead'},h('span',{class:'fr-eyebrow'},`THE DAILY · ${date}`),h('h2',{},e.title),...e.intro.split(/\n\s*\n/).map(p=>h('p',{class:'fr-edition-intro'},p)),h('span',{class:'fr-edition-meta'},`${minutes} minute read · ${storyCount} stories · From your connected sources`)),
      h('nav',{class:'fr-edition-index','aria-label':'Edition categories'},...e.sections.map((s,index)=>h('button',{type:'button',onClick:()=>container.querySelector(`#daily-category-${index}`).scrollIntoView({block:'start',behavior:'smooth'})},s.title))),
      ...e.sections.map((section,index)=>h('section',{class:'fr-edition-section',id:`daily-category-${index}`},h('span',{class:'fr-edition-number'},String(index+1).padStart(2,'0')),h('h3',{},section.title),
        section.summary?h('p',{class:'fr-category-summary'},section.summary):null,
        ...(section.paragraphs||[]).map(p=>h('p',{},p)),sourceLinks(section.sources),
        ...(section.stories||[]).map(story=>h('article',{class:'fr-edition-story'},h('h4',{},story.title),...story.paragraphs.map(p=>h('p',{},p)),sourceLinks(story.sources))))),
      e.closing?h('p',{class:'fr-edition-closing'},e.closing):null,
      e.feeds?.some(f=>f.error)?h('p',{class:'fr-edition-meta'},'Unavailable sources: '+e.feeds.filter(f=>f.error).map(f=>f.title).join(', ')+'. This edition uses the sources available at publication.'):null);
    container.gardenShare={kind:'daily',editionId:e.id,title:e.title};
    container.scrollTop=0;
    let seen=[];try{seen=JSON.parse(localStorage.getItem('garden-reading-seen')||'[]');}catch{}
    try{localStorage.setItem('garden-reading-seen',JSON.stringify([...new Set([...seen,e.id])].slice(-30)));}catch{}
    window.dispatchEvent(new CustomEvent('garden:reading-opened',{detail:{id:e.id}}));
  }catch(error){if(container.isConnected){status.textContent=error.message;container.replaceChildren(h('p',{class:'fr-empty'},'Your saved daily edition will be available when the connection returns.'),h('button',{type:'button',class:'fr-read',onClick:()=>renderDailySummary({h,container,status,openReader,editionId})},'Try again'));}}
}
export function initReadingNotifications({h,openPanel,openSummary}) {
  const toolbar=document.querySelector('.topright');if(!toolbar)return;
  let editions=[];
  const badge=h('span',{class:'reading-unread',hidden:true},'');
  const button=h('button',{id:'readingBell',type:'button',class:'gbtn icon reading-bell','aria-label':'Notifications',title:'Notifications',onClick:()=>{
    const rows=editions.map(e=>h('button',{type:'button',class:'cl-row clickable reading-notification','data-psel':'',onClick:()=>openSummary(e.id)},h('div',{class:'cl-main'},h('div',{class:'cl-phrase'},'New Daily News Summary Available!'),h('div',{class:'cl-meta'},new Date(e.day+'T12:00:00').toLocaleDateString('en-US',{month:'long',day:'numeric',year:'numeric'})),h('p',{},e.title))));
    openPanel('Notifications',h('div',{class:'reading-notifications'},...(rows.length?rows:[h('p',{class:'cl-empty'},'Your daily news editions will appear here. The Reading Room editor publishes every morning.')])));
  }},h('span',{html:'<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4"/></svg>'}),badge);
  toolbar.prepend(button);
  function paint(){
    if(!['classic','moonstone'].includes(document.documentElement.dataset.theme)){button.remove();return;}
    if(!button.isConnected)toolbar.prepend(button);
    button.hidden=false;
    let seen=[];try{seen=JSON.parse(localStorage.getItem('garden-reading-seen')||'[]');}catch{}
    const unread=editions.filter(e=>!seen.includes(e.id)).length;
    badge.hidden=!unread;badge.textContent=String(unread);
    button.setAttribute('aria-label',unread?`Notifications · ${unread} unread daily summaries`:'Notifications');
  }
  async function refresh(){try{const r=await fetch('/api/reading-summary',{cache:'no-store'});if(r.ok){const d=await r.json();editions=d.editions||[];paint();}}catch{/* retain last known notifications */}}
  window.addEventListener('garden:reading-opened',paint);window.addEventListener('garden:theme',paint);
  paint();refresh();setInterval(refresh,60000);
}
