import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
const data = await mkdtemp(join(tmpdir(),'garden-editorial-test-'));
process.env.GARDENER_DATA=data;
const {EDITOR_VERSION,publishEditorial,readingState}=await import('../../src/editorial.mjs');
const {manualEntries}=await import('../../src/manual-changelog.mjs');
test.after(async()=>{await rm(data,{recursive:true,force:true});});
async function input(kind,extra) {
 const dir=join(data,'editorial-inputs',kind);await mkdir(dir,{recursive:true});
 const file=join(dir,'input.json');
 await writeFile(file,JSON.stringify({kind,version:EDITOR_VERSION,createdAt:Date.now(),day:'2026-11-05',...extra}));return file;
}
test('publishes bold feature labels, preserves daily identity, and rejects oversized or repo content',async()=>{
 const file=await input('changelog',{days:[{day:'2026-11-05',at:123,fingerprint:'new-source'}]});
 const entry={day:'2026-11-05',hasChanges:true,phrase:'GardenOS now keeps **the night** alive with a single gesture.',features:[{title:'Night-mode snooze',description:'Keep the wall awake for another hour with a keyboard shortcut or controller hold.'}]};
 await publishEditorial('changelog',{inputFile:file,entries:[entry]});
 const saved=manualEntries()[0];assert.equal(saved.id,'M20261105');assert.match(saved.details,/\*\*Night-mode snooze:\*\*/);assert.equal(saved.provider,'paseo/codex');assert(!saved.phrase.includes('**'));
 await assert.rejects(publishEditorial('changelog',{inputFile:file,entries:[{...entry,phrase:'GardenOS now publishes a shiny new GitHub repo.'}]}),/Repository/);
 await assert.rejects(publishEditorial('changelog',{inputFile:file,entries:[{...entry,features:Array.from({length:4},(_,i)=>({title:'Long feature '+i,description:'word '.repeat(190)}))}]}),/700 words/);
 assert.equal(manualEntries()[0].phrase,saved.phrase);
});
test('reading editions require supported links, retain the last good result, and upsert one notification ID per day',async()=>{
 const url='https://example.com/story';
 const spec={fingerprint:'feed-content',feeds:[{id:'science',title:'Science',error:null}],articles:[{url,title:'A discovery',source:'Science',feedId:'science'}]};
 const file=await input('reading',spec);
 const paragraph='Scientists followed a remarkable discovery through careful observation and repeated measurement. '.repeat(8);
 const edition={inputFile:file,title:'A world worth looking at',intro:'Today we follow two discoveries that reward a closer look.',sections:[{title:'A new perspective',paragraphs:[paragraph],urls:[url]},{title:'The bigger picture',paragraphs:[paragraph],urls:[url]}],closing:'See you tomorrow.'};
 await publishEditorial('reading',edition);
 assert.equal(readingState().edition.id,'reading-2026-11-05');assert.equal(readingState().edition.sections[0].sources[0].coverage,'feed excerpt');
 await assert.rejects(publishEditorial('reading',{...edition,sections:[{...edition.sections[0],urls:['https://forged.example/']},edition.sections[1]]}),/not in/);
 assert.equal(readingState().edition.title,edition.title);
 await input('reading',{...spec,createdAt:0});
 await assert.rejects(publishEditorial('reading',edition),/newer edition/);
 await input('reading',spec);
 await publishEditorial('reading',edition);assert.equal(readingState().editions.length,1);
 await assert.rejects(publishEditorial('reading',{...edition,inputFile:'/tmp/arbitrary.json'}),/inputFile/);
});

test('busy changelog days can retain more than six features and richer headlines',async()=>{
 const file=await input('changelog',{days:[{day:'2026-11-04',at:456,fingerprint:'busy-day'}]});
 const features=Array.from({length:9},(_,i)=>({title:`Capability ${i+1}`,description:'The wall gains a useful finished capability with concrete details and a delightful interaction. '.repeat(3)}));
 await publishEditorial('changelog',{inputFile:file,entries:[{day:'2026-11-04',hasChanges:true,phrase:'GardenOS gains a richer set of capabilities across voice, games, reading, themes and controls, with the full day’s useful and delightful work preserved in one readable account.',features}]});
 const saved=manualEntries().find(e=>e.day==='2026-11-04');assert.equal(saved.details.split('\n').length,9);assert(saved.details.split(/\s+/).length>220);
});
test('category editions retain per-category summaries, individual stories and their own source links',async()=>{
 const url='https://example.com/category-story';
 const file=await input('reading',{fingerprint:'category-feed',feeds:[],articles:[{url,title:'A category story',source:'Technology',feedId:'tech'}]});
 const story={title:'A significant development',paragraphs:['Evidence and useful context from the linked source. '.repeat(25)],urls:[url]};
 const edition={inputFile:file,title:'A broader briefing',intro:'An overview that connects the day’s developments. '.repeat(20),sections:[{title:'Important Tech Updates',summary:'Major advances, security incidents and their consequences.',stories:[story,story]},{title:'The Wild Side',summary:'A lighter perspective on a strange world.',stories:[story,story]}],closing:'Until tomorrow.'};
 await publishEditorial('reading',edition);
 const saved=readingState().edition;assert(saved.wordCount>850);assert.equal(saved.sections[0].summary,edition.sections[0].summary);assert.equal(saved.sections[0].stories.length,2);assert.equal(saved.sections[1].stories[1].sources[0].url,url);
 await assert.rejects(publishEditorial('reading',{...edition,sections:[{...edition.sections[0],stories:[{...story,urls:['https://made-up.example/story']}]},edition.sections[1]]}),/not in/);
 assert.equal(readingState().edition.title,edition.title);
});

test('personal source catalog is discoverable without bulk subscription and avoids duplicate feed URLs',async()=>{
 const {feedLibrary}=await import('../../src/feeds.mjs');const library=await feedLibrary();
 assert(library.collections.some(c=>c.id==='razi'&&c.count>=140));
 assert.deepEqual(library.subscribed,['guardian','nasa','almanac']);
 assert.equal(new Set(library.feeds.map(f=>f.url)).size,library.feeds.length);
 assert(library.feeds.some(f=>f.title==='Import AI'&&f.collection==='razi'&&!f.subscribed));
});

test('article endpoint rejects sources and URLs not present in a known feed',async()=>{
 const {feedArticle}=await import('../../src/feeds.mjs');
 await assert.rejects(feedArticle('no-such-source','https://127.0.0.1/private'),/no longer listed/);
});
