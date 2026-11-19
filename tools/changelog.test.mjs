import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { changelogPhrase, changelogDetails, numberChangelog } from '../src/changelog.mjs';
import { collectManualDays, chatMessage, dayKey } from '../src/manual-changelog.mjs';

test('headline and complete bullet detail are independent; legacy detail survives', () => {
 const detail = '- Improved controls.\n- '+ 'A longer complete description. '.repeat(20);
 const summary = `CHANGELOG: Improved the garden.\nCHANGELOG_DETAILS:\n${detail}`;
 assert.equal(changelogPhrase(summary), 'Improved the garden.');
 assert.equal(changelogDetails(summary), detail.trim());
 assert.equal(changelogDetails('CHANGELOG: Fixed weather.\n\nAdded hourly rain.\nAll 175 checks green'), 'Added hourly rain.');
});
test('reads only chat text, never tools or reasoning', () => {
 assert.equal(chatMessage({type:'response_item',payload:{type:'function_call_output',output:'secret'}}),null);
 assert.equal(chatMessage({type:'response_item',payload:{type:'message',role:'assistant',phase:'analysis',content:[{type:'output_text',text:'thinking'}]}}),null);
 assert.deepEqual(chatMessage({type:'assistant',message:{content:[{type:'thinking',thinking:'hidden'},{type:'text',text:'Done'}]}}),{role:'assistant',text:'Done'});
});
test('daily digest combines Paseo sessions by local day and excludes unrelated/nightly work', async () => {
 const home = await mkdtemp(join(tmpdir(), 'garden-changelog-'));
 try {
  const ad=join(home,'.paseo/agents/root'), ld=join(home,'.codex/sessions');
  await mkdir(ad,{recursive:true});await mkdir(ld,{recursive:true});
  const now=Date.parse('2026-11-05T18:00:00Z');
  for (const [id,title] of [['one','GardenOS controls'],['two','GardenOS weather'],['three','Unrelated project'],['four','Daily tending'],['five','GardenOS automated editorial job']]) {
   await writeFile(join(ad,id+'.json'),JSON.stringify({title,labels:id==='five'?{'paseo.schedule-id':'test-schedule'}:{},updatedAt:new Date(now).toISOString(),runtimeInfo:{sessionId:id}}));
   const rows=[['2026-11-05T06:00:00Z','Previous day work'],['2026-11-05T09:00:00Z','Completed controls']].map(([timestamp,text])=>JSON.stringify({timestamp,type:'response_item',payload:{type:'message',role:'assistant',phase:'final_answer',content:[{type:'output_text',text}]}}));
   await writeFile(join(ld,'rollout-'+id+'.jsonl'),rows.join('\n'));
  }
  const days=await collectManualDays({home,now,days:2});
  assert.equal(dayKey('2026-11-05T06:00:00Z'),'2026-11-04');
  assert.equal(days.get('2026-11-05').length,2);
  assert.equal(days.get('2026-11-04').length,2);
  assert.deepEqual(new Set(days.get('2026-11-05').map(m=>m.session)),new Set(['one','two']));
 } finally {await rm(home,{recursive:true,force:true});}
});

test('manual numbers increment after the preceding tending, reset on the next, and retain stable IDs', () => {
 const entries = [
  {id:'M2',kind:'manual',at:30}, {id:172,kind:'tending',at:40},
  {id:'M3',kind:'manual',at:50}, {id:171,kind:'tending',at:10},
  {id:'M1',kind:'manual',at:20},
 ];
 const numbered = numberChangelog(entries);
 assert.deepEqual(numbered.map(e=>e.number), ['172.1','172','171.2','171.1','171']);
 assert.equal(numbered[0].id,'M3');
 assert.equal(entries[0].number,undefined);
 assert.equal(numberChangelog([{id:'first',kind:'manual',at:1}])[0].number,'0.1');
 const sameTime=numberChangelog([{id:'M1',kind:'manual',at:10},{id:171,kind:'tending',at:10}]);
 assert.equal(sameTime[0].number,'171.1');
 const many=numberChangelog([{id:171,kind:'tending',at:0}, ...Array.from({length:12},(_,i)=>({id:`M${i}`,kind:'manual',at:i+1}))]);
 assert.equal(many[0].number,'171.12');
});
