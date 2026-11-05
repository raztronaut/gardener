export function openFeeds({ h, openPanel, openReader }) {
  const root = h('div', { class: 'feed-reader' });
  let generation = 0;
  async function show(id) {
    const gen = ++generation;
    const list = h('div', { 'aria-live': 'polite' }, 'Reading the feed…');
    const nav = h('div', { class: 'feed-nav' }, ...[['hn','Hacker News'],['nasa','NASA']].map(([key,title]) => h('button', { type:'button', 'aria-pressed':String(id === key), onClick:()=>show(key) },title)));
    root.replaceChildren(nav, list);
    try {
      const r = await fetch(`/api/feeds?id=${encodeURIComponent(id)}`, {signal:AbortSignal.timeout(12000)});
      if (!r.ok) throw new Error(); const feed = await r.json();
      if(gen!==generation || !root.isConnected) return;
      const status = feed.error || `${feed.stale ? 'Saved copy · ' : 'Updated '}${feed.at ? new Date(feed.at).toLocaleTimeString([], {hour:'numeric',minute:'2-digit'}) : ''}`;
      list.replaceChildren(h('p',{class:'feed-status'},status), ...(feed.items || []).map(item => h('button',{ type:'button',class:'feed-story',onClick:()=>openReader(item.url,item.title) }, h('span',{},item.title),h('small',{},item.date ? new Date(item.date).toLocaleDateString() : feed.title))));
    } catch { if(gen===generation) list.replaceChildren(h('p',{},'Feed unavailable. Choose a source to retry.')); }
  }
  openPanel('Feed reader',root); show('hn');
}
