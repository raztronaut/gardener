import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
export const FEEDS = { hn: { title: 'Hacker News', url: 'https://hnrss.org/frontpage' }, nasa: { title: 'NASA', url: 'https://www.nasa.gov/feed/' } };
const cache = new Map(), pending = new Map();
export async function readFeed(id) {
  const feed = FEEDS[id]; if (!feed) return null;
  const last = cache.get(id);
  if (last && Date.now() - last.at < 5 * 60 * 1000) return { ...last, stale: false };
  if (pending.has(id)) return pending.get(id);
  const work = (async () => {
    try {
      const r = await fetch(feed.url, { signal: AbortSignal.timeout(8000), headers: { 'user-agent': 'GardenOS RSS Reader' }, redirect: 'error' });
      if (!r.ok) throw new Error('feed unavailable');
      const chunks=[]; let size=0;
      for await (const c of r.body) { size += c.length; if(size>1048576) throw new Error('feed too large'); chunks.push(c); }
      const items = await new Promise((resolve,reject) => {
        const child = execFile('python3', ['-I', fileURLToPath(new URL('../tools/feeds/parse-feed.py', import.meta.url))], { timeout: 3000, maxBuffer: 128 * 1024 }, (e,out) => { if(e) reject(e); else { try {resolve(JSON.parse(out));}catch(e){reject(e);} } });
        child.stdin.end(Buffer.concat(chunks));
      });
      if (!items.length) throw new Error('empty feed');
      const data = { id, title:feed.title, items, at:Date.now() }; cache.set(id,data); return {...data,stale:false};
    } catch { if(last) return {...last,stale:true}; return {id,title:feed.title,items:[],error:'Feed unavailable. Try again shortly.'}; }
  })().finally(()=>pending.delete(id)); pending.set(id,work); return work;
}
