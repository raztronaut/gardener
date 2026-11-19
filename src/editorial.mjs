// Scheduled Paseo agents publish data through these validators. No model/API calls.
import { createHash, randomUUID } from 'node:crypto';
import { promises as fs } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { z } from 'zod';
import { paths } from './config.mjs';
import { getKV, setKV } from './db.mjs';
import { collectManualDays, dayKey } from './manual-changelog.mjs';
import { feedLibrary, readFeed } from './feeds.mjs';
import { fetchFeedURL } from './feed-fetch.mjs';
import { extractReadable, isBotWall } from './reader.mjs';
export const EDITOR_VERSION = 'paseo-editor-v2';
const JOBS = join(paths.DATA, 'editorial-inputs');
const short = z.string().trim().min(1);
const feature = z.object({ title: short.max(55), description: short.max(1400) }).strict();
export const changelogSchema = z.object({ inputFile: short, entries: z.array(z.object({
  day: z.string().regex(/^\d{4}-\d{2}-\d{2}$/), hasChanges: z.boolean(), phrase: z.string().max(600),
  features: z.array(feature).max(14),
}).strict()).max(7) }).strict();
const storySchema = z.object({ title: short.max(150), paragraphs: z.array(short.max(2200)).min(1).max(4),
  urls: z.array(z.string().url()).min(1).max(5) }).strict();
export const readingSchema = z.object({ inputFile: short, title: short.max(120), intro: short.max(3200),
  sections: z.array(z.object({ title: short.max(100), summary: short.max(1800).optional(),
    paragraphs: z.array(short.max(2200)).max(4).default([]), urls: z.array(z.string().url()).max(8).default([]),
    stories: z.array(storySchema).min(1).max(8).optional(), }).strict()).min(2).max(8),
  closing: z.string().max(800),
}).strict();
const words = text => String(text).trim().split(/\s+/).filter(Boolean).length;
const hash = data => createHash('sha256').update(JSON.stringify(data)).digest('hex');
function readEntries(key) { try { return JSON.parse(getKV(key, '[]')); } catch { return []; } }
export const readingEditions = () => readEntries('reading_editions_v1');
export function readingState() {
  const editions = readingEditions();
  return { today: dayKey(Date.now()), edition: editions[0] || null, editions: editions.map(({id,day,title,publishedAt}) => ({id,day,title,publishedAt})) };
}
async function saveJSON(file, data) {
  await fs.mkdir(dirname(file), { recursive: true });
  const temp = file + '.' + randomUUID() + '.tmp';
  await fs.writeFile(temp, JSON.stringify(data, null, 2), { mode: 0o600 });
  await fs.rename(temp, file);
}
async function loadInput(file, kind) {
  const p = resolve(file);
  if (!p.startsWith(JOBS + '/')) throw Error('Use the inputFile produced by prepare.');
  const d = JSON.parse(await fs.readFile(p, 'utf8'));
  if (d.kind !== kind || d.version !== EDITOR_VERSION) throw Error('Wrong editorial input version/type.');
  return d;
}
export async function prepareEditorial(kind, options = {}) {
  const run = join(JOBS, `${Date.now()}-${randomUUID()}`);
  const now = Date.now();
  const rulesDigest=hash(await fs.readFile(new URL(`../tools/editorial/${kind==='changelog'?'CHANGELOG':'READING'}.md`,import.meta.url),'utf8'));
  const manifest = { kind, version: EDITOR_VERSION, createdAt: now, day: dayKey(now),rulesDigest };
  if (kind === 'changelog') {
    const existing = readEntries('manual_changelog_v1');
    const days = await collectManualDays(options);
    let baseline = [];
    try { baseline = JSON.parse(await fs.readFile(join(paths.DATA, 'backups/editor-migration-20261105/manual-changelog.json'), 'utf8')); } catch { /* optional older published coverage */ }
    manifest.days = [];
    for (const [day,messages] of [...days].sort(([a],[b])=>b.localeCompare(a))) {
      messages.sort((a,b)=>a.at-b.at || a.session.localeCompare(b.session));
      const fingerprint = hash([EDITOR_VERSION, rulesDigest, messages]);
      const previous = existing.find(e=>e.day===day);
      if (previous?.fingerprint === fingerprint && !options.force) continue;
      const sourceFile = join(run, day+'.json');
      await saveJSON(sourceFile, { day, messages, coverageReference: baseline.find(e=>e.day===day) || null, previous: previous ? {phrase:previous.phrase,details:previous.details} : null });
      manifest.days.push({day,sourceFile,fingerprint,at:Math.max(...messages.map(m=>m.at))});
    }
  } else if (kind === 'reading') {
    const library = await feedLibrary();
    const feeds = await Promise.all(library.subscribed.map(readFeed));
    manifest.feeds = feeds.filter(Boolean).map(f=>({id:f.id,title:f.title,stale:!!f.stale,error:f.error||null,at:f.at||null,format:f.format||'rss',sourceNote:f.sourceNote||null}));
    const cutoff = now - 48 * 3600000;
    manifest.articles = feeds.filter(Boolean).flatMap(f=>(f.items||[]).filter(i=>{
      const at=Date.parse(i.date); return !Number.isFinite(at)||at>=cutoff;
    }).slice(0,40).map(i=>({...i,content:String(i.content||'').slice(0,1200),feedId:f.id,source:f.title,coverage:i.coverage||'feed excerpt'})));
    if (!manifest.articles.length) throw Error('No recent feed articles available; keep the saved edition.');
    manifest.fingerprint = hash([EDITOR_VERSION,rulesDigest,manifest.articles]);
    manifest.alreadyPublished = readingEditions().some(e=>e.day===manifest.day && e.fingerprint===manifest.fingerprint);
  } else throw Error('Unknown editorial job.');
  const inputFile = join(run,'input.json');
  await saveJSON(inputFile,manifest);
  return { inputFile, ...manifest };
}
export async function fetchEditorialArticle(inputFile, url) {
  const input=await loadInput(inputFile,'reading');
  const item=input.articles.find(a=>a.url===url);
  if (!item) throw Error('Article must come from the prepared subscribed feeds.');
  let article;
  try {
    const response=await fetchFeedURL(url);
    const text=isBotWall(response.status,response.body.toString())?'':extractReadable(response.body.toString());
    if (text.length<600) throw Error('Full article not readable.');
    article={...item,text,coverage:'article',finalUrl:response.url};
  } catch { article={...item,text:item.content||item.summary||'',coverage:item.coverage||'feed excerpt'}; }
  const file=join(dirname(inputFile),hash(url)+'.article.json');
  await saveJSON(file,article);
  return {file,coverage:article.coverage};
}
export async function publishEditorial(kind, payload, { agentId = process.env.PASEO_AGENT_ID || null } = {}) {
  const data=(kind==='changelog'?changelogSchema:readingSchema).parse(payload);
  const input=await loadInput(data.inputFile,kind);
  const now=Date.now();
  if(kind==='changelog') {
    const entries=readEntries('manual_changelog_v1');
    if(new Set(data.entries.map(e=>e.day)).size!==data.entries.length) throw Error('Duplicate changelog days.');
    for(const item of data.entries) {
      const source=input.days.find(d=>d.day===item.day);
      if(!source)throw Error('Day is not in prepared inputs.');
      if(item.hasChanges && (!item.features.length || words(item.phrase)>70 || words(item.phrase)<5))throw Error('Use a 5–70 word headline and feature bullets.');
      const details=item.features.map(f=>`- **${f.title}:** ${f.description}`).join('\n');
      if(words(details)>700)throw Error('Changelog detail exceeds 700 words.');
      if(/github|raztronaut\/gardener/i.test(item.phrase+' '+details))throw Error('Repository housekeeping must be excluded.');
      const index=entries.findIndex(e=>e.day===item.day);
      if(index>=0 && entries[index].publishedAt>input.createdAt)throw Error('A newer changelog was published; prepare again.');
      const entry={id:`M${item.day.replaceAll('-','')}`,day:item.day,at:source.at,kind:'manual',
        model:'gpt-6-luna',reasoning:'medium',provider:'paseo/codex',agentId,publishedAt:now,
        fingerprint:source.fingerprint,phrase:item.phrase.replace(/\*\*([^*]+)\*\*/g,'$1').replace(/`([^`]+)`/g,'$1'),details,hasChanges:item.hasChanges};
      if(index<0)entries.push(entry);else entries[index]=entry;
    }
    setKV('manual_changelog_v1',JSON.stringify(entries));
    return {published:data.entries.map(e=>e.day)};
  }
  const allWords=words([data.intro,...data.sections.flatMap(s=>[s.title,s.summary||'',...s.paragraphs,...(s.stories||[]).flatMap(t=>[t.title,...t.paragraphs])]),data.closing].join(' '));
  if(allWords<180||allWords>2600)throw Error('Daily edition must be 180–2600 words (aim for 1000–1800 on a rich news day).');
  const resolveSources = async (urls) => {
    const sources=[];
    for(const url of [...new Set(urls)]) {
      const item=input.articles.find(a=>a.url===url);
      if(!item)throw Error('Source link is not in the subscribed feed snapshot.');
      let coverage=item.coverage||'feed excerpt';
      try {coverage=JSON.parse(await fs.readFile(join(dirname(data.inputFile),hash(url)+'.article.json'),'utf8')).coverage;}catch{}
      sources.push({url:item.url,title:item.title,source:item.source,feedId:item.feedId,coverage});
    }
    return sources;
  };
  const sections=[];
  for(const section of data.sections) {
    if (!section.urls.length && !section.stories?.length) throw Error('Every section needs linked stories or source URLs.');
    const stories=[];
    for (const story of section.stories || []) stories.push({title:story.title,paragraphs:story.paragraphs,sources:await resolveSources(story.urls)});
    sections.push({title:section.title,summary:section.summary||'',paragraphs:section.paragraphs,
      sources:await resolveSources(section.urls),stories});
  }
  // An edition is content-addressed by day: revisions never create duplicate bells.
  const editions=readingEditions();
  if(editions.some(e=>e.day===input.day && e.publishedAt>input.createdAt))throw Error('A newer edition exists; prepare again.');
  const edition={id:`reading-${input.day}`,day:input.day,title:data.title,intro:data.intro,sections,closing:data.closing,
    publishedAt:now,model:'gpt-6-luna',reasoning:'medium',provider:'paseo/codex',agentId,
    fingerprint:input.fingerprint,feeds:input.feeds,wordCount:allWords};
  const next=[edition,...editions.filter(e=>e.day!==input.day)].sort((a,b)=>b.day.localeCompare(a.day)).slice(0,14);
  setKV('reading_editions_v1',JSON.stringify(next));
  return {published:edition.id,sections:sections.length,words:allWords};
}
