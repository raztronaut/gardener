import { wordDate } from '/lib/feed-reader.js';
let variantData=[];
export default {
  id:'rss',title:'Reading room',icon:'📰',size:'md',homeSize:'medium',chrome:true,frame:false,
  getVariantData:()=>variantData,
  async mount(body,ctx) {
    const {h}=ctx;
    ctx.style(`.rss-card{height:100%;min-height:0;display:flex;flex-direction:column;gap:12px;justify-content:center}.rss-source{font-size:13px;color:var(--ink-soft)}.rss-headline{font-size:20px;line-height:1.25}.rss-item{min-height:0}.rss-hint{font-size:13px;color:var(--ink-soft)}`);
    const root=h('div',{class:'rss-card'},h('div',{class:'rss-headline'},'Gathering a little wider world…'));body.replaceChildren(root);
    let alive=true,busy=false;
    const refresh=async()=>{if(busy)return;busy=true;try{
      const d=await ctx.fetchJSON('/api/feeds/digest',{viaProxy:false,timeout:35000});if(!alive)return;variantData=d.items||[];
      const item=variantData[0];
      root.replaceChildren(item?h('div',{class:'rss-item'},h('div',{class:'rss-source'},item.source),h('div',{class:'rss-headline'},item.title),h('div',{class:'rss-preview'},item.summary||''),h('div',{class:'rss-date'},wordDate(item.date))):h('div',{class:'rss-headline'},'A quiet moment. Open to discover a source.'),h('div',{class:'rss-hint'},'Your reading room ↗'));
      root.querySelector('.rss-preview')?.setAttribute('data-classic-only','');root.querySelector('.rss-date')?.setAttribute('data-classic-only','');
      if(!['classic','moonstone'].includes(document.documentElement.dataset.theme))root.querySelectorAll('[data-classic-only]').forEach(e=>e.hidden=true);
    }catch{if(alive&&!variantData.length)root.replaceChildren(h('div',{class:'rss-headline'},'Open the reader to reconnect.'));}finally{busy=false;}};
    window.addEventListener('garden:feeds-changed',refresh);await refresh();ctx.interval(refresh,300000,{immediate:false});
    return()=>{alive=false;window.removeEventListener('garden:feeds-changed',refresh);};
  },
  async openFull(body,ctx,options={}){const m=await import('/lib/feed-reader.js');if(!document.getElementById('feed-css'))document.head.append(ctx.h('link',{id:'feed-css',rel:'stylesheet',href:'/lib/feed-reader.css'}));const root=m.openFeeds({signal:ctx.signal,daily:!!options.daily,editionId:options.editionId,h:ctx.h,openPanel:(_title,root)=>body.replaceChildren(root),openReader:(url,title,options)=>ctx.openArticle(url,title,options)});return()=>root?.dispose?.();}
};
