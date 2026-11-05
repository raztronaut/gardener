let variantData=[];
export default {
  id:'rss',title:'Feed reader',icon:'📰',size:'md',homeSize:'medium',chrome:true,frame:false,
  getVariantData:()=>variantData,
  async mount(body,ctx) {
    const {h}=ctx;
    ctx.style(`.rss-card{height:100%;min-height:0;display:flex;flex-direction:column;gap:12px;justify-content:center}.rss-source{font-size:13px;color:var(--ink-soft)}.rss-headline{font-size:20px;line-height:1.25}.rss-item{min-height:0}.rss-hint{font-size:13px;color:var(--ink-soft)}`);
    const root=h('div',{class:'rss-card'},h('div',{class:'rss-headline'},'Reading NASA’s feed…'));body.replaceChildren(root);
    let latest=null;
    const draw=()=>{
      if(!latest)return;
      const count=1; // the wall is a glance; the reader holds the full feed
      const items=latest.items||[];
      root.replaceChildren(...(items.length?items.slice(0,count).map(item=>h('div',{class:'rss-item'},h('div',{class:'rss-source'},latest.title),h('div',{class:'rss-headline'},item.title.length>95?item.title.slice(0,92)+'…':item.title))):[h('div',{class:'rss-headline'},latest.error||'No feed entries right now.')]),h('div',{class:'rss-hint'},latest.stale?'Saved copy · open the reader':'Open to read · NASA + Hacker News'));
    };
    const refresh=async()=>{try{latest=await ctx.fetchJSON('/api/feeds?id=nasa',{viaProxy:false,timeout:12000});variantData=(latest.items||[]).map(i=>({...i,source:latest.title}));draw();}catch{if(!latest)root.replaceChildren(h('div',{class:'rss-headline'},'Feed unavailable. Open to retry.'));}};
    await refresh();ctx.interval(refresh,300000);

  },
  async openFull(body,ctx) {
    const m=await import('/lib/feed-reader.js');
    // Use the widget context's existing sandboxed article reader.
    if(!document.getElementById('feed-css'))document.head.append(ctx.h('link',{id:'feed-css',rel:'stylesheet',href:'/lib/feed-reader.css'}));
    m.openFeeds({h:ctx.h,openPanel:(_title,root)=>body.replaceChildren(root),openReader:(url,title)=>ctx.openArticle(url,title)});
  }
};
