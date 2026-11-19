import { execFile } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { readFileSync } from 'node:fs';
import { readFile, writeFile, rename, mkdir } from 'node:fs/promises';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { paths } from './config.mjs';
import { extractArticle } from './rich-article.mjs';
import { extractReadable, isBotWall } from './reader.mjs';
import { fetchFeedURL, feedURL } from './feed-fetch.mjs';
const catalog=JSON.parse(readFileSync(new URL('./feed-catalog.json',import.meta.url),'utf8'));
export const FEEDS = {
  ...Object.fromEntries(catalog.feeds.map(({id,...feed})=>[id,feed])),
  guardian:{title:'The Guardian',url:'https://www.theguardian.com/us/rss',category:'World',description:'Independent reporting, culture and ideas.'},
  nasa:{title:'NASA',url:'https://www.nasa.gov/feed/',category:'Science',description:'Dispatches from beyond our atmosphere.'},
  almanac:{title:'Old Farmer’s Almanac',url:'https://www.almanac.com/news/gardening/feed',website:'https://www.almanac.com/gardening',fallbackWebsite:'https://www.almanac.com/gardening',category:'Garden',description:'Gardening guides and seasonal advice. Uses publisher website articles when its category RSS feed is empty.'},
  'almanac-weather':{title:'Almanac — Weather',url:'https://www.almanac.com/news/weather/feed',fallbackWebsite:'https://www.almanac.com/weather',website:'https://www.almanac.com/weather',category:'Garden & Seasons',description:'Almanac weather articles; publisher website fallback while category RSS is empty.'},
  'almanac-astronomy':{title:'Almanac — Astronomy',url:'https://www.almanac.com/news/astronomy/feed',fallbackWebsite:'https://www.almanac.com/astronomy',website:'https://www.almanac.com/astronomy',category:'Science',description:'Almanac astronomy articles; publisher website fallback while category RSS is empty.'},
  techcrunch:{title:'TechCrunch',url:'https://techcrunch.com/feed/',category:'Technology',description:'Startups and the people building what comes next.'},
  bbc:{title:'BBC World',url:'https://feeds.bbci.co.uk/news/world/rss.xml',category:'World',description:'A wide-angle view of the day.'},
  science:{title:'ScienceDaily',url:'https://www.sciencedaily.com/rss/top.xml',category:'Science',description:'New discoveries across the sciences.'},
  ars:{title:'Ars Technica',url:'https://feeds.arstechnica.com/arstechnica/index',category:'Technology',description:'Technology, science and the details that matter.'},
  mit:{title:'MIT News',url:'https://news.mit.edu/rss/feed',category:'Science',description:'Research and inventions from MIT.'},
};
// Canonical IDs avoid duplicate subscriptions when a personal feed is also built in.
for(const [id,feed] of Object.entries(FEEDS)){
  if(!id.startsWith('razi-'))continue;
  const match=Object.entries(FEEDS).find(([other,f])=>!other.startsWith('razi-')&&f.url===feed.url);
  if(match){match[1].collection='razi';delete FEEDS[id];}
}
const file=join(paths.DATA,'feeds.json');
let library,loading,serial=Promise.resolve();
const cache=new Map(),pending=new Map(),failures=new Map();
async function state(){
  if(library)return library;
  if(!loading)loading=(async()=>{try{const d=JSON.parse(await readFile(file,'utf8'));if(d.version!==1||!Array.isArray(d.subscribed)||typeof d.custom!=='object')throw Error();library=d;}catch{library={version:1,subscribed:['guardian','nasa','almanac'],custom:{}};}return library;})();
  return loading;
}
export async function feedLibrary(){const s=await state();return {subscribed:s.subscribed,collections:[{id:'recommended',title:'Recommended sources'},{id:'razi',title:"Razi's RSS Feeds List",source:catalog.source,count:catalog.feeds.filter(f=>f.collection==='razi').length}],feeds:Object.entries({...FEEDS,...s.custom}).map(([id,f])=>({id,...f,subscribed:s.subscribed.includes(id)}))};}
function parse(body,args=[]){return new Promise((resolve,reject)=>{const c=execFile('python3',['-I',fileURLToPath(new URL('../tools/feeds/parse-feed.py',import.meta.url)),...args],{timeout:3000,maxBuffer:4*1024*1024},(e,out)=>{if(e)reject(new Error('This page is not a readable RSS or Atom feed.'));else{try{resolve(JSON.parse(out));}catch{reject(new Error('Feed could not be parsed.'));}}});c.stdin.on('error',()=>{});c.stdin.end(body);});}
async function loadFeed(id,feed,last){
  try{
    const r=await fetchFeedURL(feed.url,last||{});
    if(r.status===304&&last){const d={...last,at:Date.now(),stale:false};cache.set(id,d);return d;}
    const items=await parse(r.body);if(!items.length)throw new Error('No readable entries yet.');
    const data={id,title:feed.title,items,at:Date.now(),etag:r.headers.etag,lastModified:r.headers['last-modified'],stale:false};cache.set(id,data);return data;
  }catch(e){
    if(feed.fallbackWebsite){try{const r=await fetchFeedURL(feed.fallbackWebsite);const items=await parse(r.body,['almanac']);if(items.length){const data={id,title:feed.title,items,at:Date.now(),stale:false,format:'website',sourceNote:'Publisher website articles · category RSS currently has no entries'};cache.set(id,data);return data;}}catch{/* retain saved edition on fallback failure */}}
    return last?{...last,stale:true,error:'Publisher unavailable. Showing the saved edition.'}:{id,title:feed.title,items:[],error:feed.unavailable||e.message,website:feed.website};}
}
export async function readFeed(id){
  const s=await state(),feed=FEEDS[id]||s.custom[id];if(!feed)return null;
  const failed=failures.get(id);if(failed&&Date.now()-failed.at<30000)return failed.data;
  const last=cache.get(id);if(last&&Date.now()-last.at<300000)return last;
  if(pending.has(id))return pending.get(id);
  const work=loadFeed(id,feed,last).then(data=>{if(data.error)failures.set(id,{at:Date.now(),data});else failures.delete(id);return data;}).finally(()=>pending.delete(id));pending.set(id,work);return work;
}
export async function feedDigest(){
  const s=await state();const feeds=await Promise.all(s.subscribed.map(readFeed));
  return {feeds:feeds.filter(Boolean).map(f=>({id:f.id,title:f.title,at:f.at,stale:!!f.stale,error:f.error,format:f.format,sourceNote:f.sourceNote})),items:feeds.filter(Boolean).flatMap(f=>(f.items||[]).slice(0,8).map(i=>({...i,source:f.title,feedId:f.id}))).sort((a,b)=>(Date.parse(b.date)||0)-(Date.parse(a.date)||0)).slice(0,32)};
}
async function discover(query){
  const q=String(query||'').trim();
  const known=Object.entries(FEEDS).find(([id,f])=>[id,f.title,f.url,f.title.replace(/[^a-z0-9]/gi,'')].some(n=>n.toLowerCase()===q.toLowerCase().replace(/^the /,''))||f.title.toLowerCase()===q.toLowerCase());
  if(known){const checked=await readFeed(known[0]);if(checked.error&&!known[1].unavailable)throw new Error(checked.error);return {id:known[0],feed:known[1]};}
  let url;try{url=feedURL(q.includes('://')?q:'https://'+q).href;}catch{throw new Error('Choose a source below, or paste a website / RSS address.');}
  const r=await fetchFeedURL(url);let items;
  try{items=await parse(r.body);}catch{}
  let title=new URL(r.url).hostname.replace(/^www\./,'');
  if(!items?.length){
    const links=await parse(r.body,['discover',r.url]);
    if(!links.length)throw new Error('No RSS or Atom feed was advertised on that page. Try its direct feed URL.');
    let found=false;
    for(const link of links.slice(0,3)){try{const candidate=await fetchFeedURL(link.url);const parsed=await parse(candidate.body);if(!parsed.length)continue;url=candidate.url;items=parsed;title=link.title||title;found=true;break;}catch{}}
    if(!found)throw new Error('The advertised feeds could not be read.');
  }else url=r.url;
  const id='custom-'+createHash('sha256').update(url).digest('hex').slice(0,16);
  const feed={title:title.slice(0,100),url,category:'Your discovery',description:new URL(url).hostname};
  cache.set(id,{id,title:feed.title,items,at:Date.now(),stale:false});return {id,feed};
}
export function changeFeeds({action,query,id}){
  // Serial mutations make simultaneous voice/touch additions idempotent.
  const work=serial.then(async()=>{
    const s=await state();let connected;
    if(action==='add'){
      if(s.subscribed.length>=20)throw new Error('Your library holds up to 20 feeds. Remove one first.');
      const found=await discover(query||id);id=found.id;connected=found.feed;
      const duplicate=Object.entries({...FEEDS,...s.custom}).find(([,f])=>f.url===found.feed.url);if(duplicate)id=duplicate[0];
      if(!FEEDS[id])s.custom[id]=found.feed;
      if(!s.subscribed.includes(id))s.subscribed.push(id);
    }else if(action==='remove')s.subscribed=s.subscribed.filter(x=>x!==id);
    else throw new Error('Unknown library action.');
    await mkdir(paths.DATA,{recursive:true});await writeFile(file+'.tmp',JSON.stringify(s),{mode:0o600});await rename(file+'.tmp',file);
    return {...await feedLibrary(),connected:connected?{id,title:connected.title}:null};
  });serial=work.catch(()=>{});return work;
}

// Full text is fetched only for an article actually listed by a known source.
const articleCache=new Map(),articlePending=new Map();
export async function feedArticle(id,url){
  const feed=await readFeed(id);
  const item=feed?.items?.find(i=>i.url===url);
  if(!item)throw Error('This article is no longer listed by this source.');
  const cached=articleCache.get(url);if(cached&&Date.now()-cached.at<12*3600000)return cached;
  if(articlePending.has(url))return articlePending.get(url);
  const job=(async()=>{
    const r=await fetchFeedURL(url);
    if(isBotWall(r.status,r.body.toString()))throw Error('The publisher requires its original page.');
    const text=extractReadable(r.body.toString());
    if(text.length<500 || /subscribe to (?:continue|read|unlock)|already a subscriber|sign in to (?:continue|read)/i.test(text.slice(-1600)))throw Error('The publisher shares only an excerpt here.');
    const rich=await extractArticle(r.body.toString(),r.url);
    const result={title:item.title,url:r.url,text,html:rich.html,at:Date.now(),coverage:'article'};
    articleCache.set(url,result);if(articleCache.size>100)articleCache.delete(articleCache.keys().next().value);
    return result;
  })().finally(()=>articlePending.delete(url));articlePending.set(url,job);return job;
}
