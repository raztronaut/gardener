import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
const temp=await mkdtemp(join(tmpdir(),'garden-messages-test-'));
process.env.GARDENER_DATA=temp;
const {createMessenger,editionContent,serveSharedItem,photonSend}=await import('../src/messages.mjs');
const {messageAction}=await import('../public/lib/message-intent.js');
const {directAction}=await import('../src/voice-fast.mjs');
const credentials={projectId:'test',projectSecret:'dummy',recipients:[{id:'razi',name:'Razi',phone:'+15555550101'},{id:'gui',name:'Gui',phone:'+15555550102'}]};
const edition={id:'edition-1',day:'2026-11-05',title:'A daily edition',intro:'Overview.',sections:[{title:'Science',summary:'Category overview.',stories:[{title:'Story',paragraphs:['Full paragraph.'],sources:[{title:'Original',source:'Publisher',url:'https://example.com/story'}]}]}],closing:'The wild side.'};
let sequence=0;
const make=async transport=>{
 const directory=join(temp,String(++sequence));
 const messenger=createMessenger({directory,readConfig:async()=>credentials,readEdition:async id=>!id||id===edition.id?edition:null,publicBase:async()=>'https://garden.example',transport});
 return {messenger,directory};
};
test('speech sends exact dictated case and punctuation, routes current and daily separately',()=>{
 assert.deepEqual(directAction('send a note to razi saying "Hello, Gui!"'),{name:'send',input:{recipient:'razi',kind:'note',text:'Hello, Gui!'}});
 assert.equal(messageAction('Send the daily news summary to Razi.').input.kind,'daily');
 assert.equal(messageAction('send this to Gui').input.kind,'current');
 assert.equal(messageAction('send this to Razi please.').input.recipient,'Razi');
 assert.equal(messageAction('send this to Razi actually Gui'),null);
 assert.equal(messageAction('tell me about sending things'),null);
});
test('the voice agent dispatches sends once without a cloud model or snapshot wait',async()=>{
 const {runAgent}=await import('../src/voiceagent.mjs');let calls=[];
 const result=await runAgent('send a note to razi saying "Hello, Gui!"',{context:async()=>{throw Error('Unexpected model path');},call:async actions=>{calls.push(...actions);return [{ok:true}];},signal:new AbortController().signal});
 assert.equal(result.ok,true);assert.equal(calls.length,1);assert.equal(calls[0].input.text,'Hello, Gui!');
});
test('named daily content contains the complete edition and sources, not the open view',()=>{
 const content=editionContent(edition);assert.match(content.title,/2026-11-05/);assert.match(content.text,/Full paragraph/);assert.match(content.text,/https:\/\/example.com\/story/);assert.match(content.text,/The wild side/);
});
test('parallel/repeated requests send once and cannot change a request to a different message',async()=>{
 let sends=0;const {messenger}=await make(async({recipient,message})=>{sends++;assert.equal(recipient.id,'razi');assert.match(message,/Hello, Gui!/);return {state:'delivered'};});
 const input={recipient:'RAZI',kind:'note',text:'Hello, Gui!',requestId:'test-unique-request-1'};
 const jobs=await Promise.all([messenger.enqueue(input),messenger.enqueue(input)]);assert.equal(jobs[0].id,jobs[1].id);await messenger.drain();assert.equal(sends,1);assert.equal((await messenger.status(jobs[0].id)).state,'delivered');
 await assert.rejects(messenger.enqueue({...input,text:'Different'}),/different message/);
 await assert.rejects(messenger.enqueue({...input,recipient:'Nobody',requestId:'test-unique-request-2'}),/not connected/);
 assert.equal(sends,1);
});
test('full content arrives in Messages without tunnel URLs, truncation, or a public tunnel',async()=>{
 let sent;
 const {messenger}=await make(async({message})=>{sent=message;return {state:'delivered'};});
 const body='A complete paragraph. '.repeat(800)+'THE END';
 await messenger.enqueue({recipient:'razi',kind:'snapshot',title:'Long summary',text:body,url:'https://publisher.example/original',requestId:'test-direct-content-1'});
 await messenger.drain();
 assert.ok(sent.includes(body));assert.ok(sent.includes('THE END'));assert.ok(sent.includes('https://publisher.example/original'));
 assert.ok(!sent.includes('/s/'));assert.ok(!sent.includes('ngrok'));assert.ok(!sent.includes('garden.example'));
 await messenger.enqueue({recipient:'razi',kind:'daily',requestId:'test-direct-daily-1'});await messenger.drain();
 assert.ok(sent.includes('Full paragraph.'));assert.ok(sent.includes('The wild side.'));assert.ok(sent.includes('https://example.com/story'));assert.ok(!sent.includes('garden.example'));
});
test('daily snapshot is frozen, share token is unguessable and note pages are never published',async()=>{
 const {messenger,directory}=await make(async()=>({state:'sent'}));
 const job=await messenger.enqueue({recipient:'gui',kind:'daily',editionId:edition.id,requestId:'test-daily-request-1'});await messenger.drain();assert.match(job.id,/^[a-f0-9]{48}$/);
 const saved=JSON.parse(await readFile(join(directory,job.id+'.json'),'utf8'));assert.match(saved.content.text,/Full paragraph/);
 const render=async id=>{const res={headers:{},writeHead(code,headers){this.code=code;this.headers=headers;},end(body){this.body=body;}};await serveSharedItem({method:'GET'},res,'/s/'+id,directory);return res;};
 assert.equal((await render(job.id)).code,200);
 assert.equal((await render('0'.repeat(48))).code,404);
 saved.content.text='<script>alert("x")</script>';await writeFile(join(directory,job.id+'.json'),JSON.stringify(saved));const html=await render(job.id);assert.ok(!html.body.includes('<script>'));assert.match(html.headers['Content-Security-Policy'],/default-src 'none'/);
 saved.at=Date.now()-31*86400000;await writeFile(join(directory,job.id+'.json'),JSON.stringify(saved));assert.equal((await render(job.id)).code,404);
 const note=await messenger.enqueue({recipient:'gui',kind:'note',text:'Private note',requestId:'test-note-request-3'});await messenger.drain();assert.equal((await render(note.id)).code,404);
});
test('unsafe links and unpublished editions fail without sending',async()=>{
 let sends=0;const {messenger}=await make(async()=>{sends++;return {state:'sent'};});
 await assert.rejects(messenger.enqueue({recipient:'razi',kind:'snapshot',title:'Bad',text:'Body',url:'javascript:alert(1)',requestId:'test-invalid-url-1'}),/Unsupported/);
 await assert.rejects(messenger.enqueue({recipient:'razi',kind:'daily',editionId:'missing',requestId:'test-missing-day-1'}),/published/);assert.equal(sends,0);
});
test('unknown network outcomes are retained, not retried or falsely reported delivered',async()=>{
 let sends=0;const {messenger}=await make(async()=>{sends++;throw Error('Network timeout');});
 const input={recipient:'razi',kind:'note',text:'Hi',requestId:'test-timeout-request'};const job=await messenger.enqueue(input);await messenger.drain();assert.equal((await messenger.status(job.id)).state,'uncertain');await messenger.enqueue(input);assert.equal(sends,1);
});
test('paid plan and unactivated phone fail before opening a message transport',async()=>{
 const original=globalThis.fetch;
 try{
  globalThis.fetch=async()=>({ok:true,json:async()=>({succeed:true,data:{tier:'business',subscription_id:'paid'}})});
  await assert.rejects(photonSend({credentials,recipient:credentials.recipients[0],message:'Hi',id:'test'}),/zero-billing/);
  globalThis.fetch=async url=>({ok:true,json:async()=>({succeed:true,data:url.endsWith('billing/subscription')?{tier:'free',subscription_id:null,customer_id:null}:{users:[{phoneNumber:credentials.recipients[0].phone,meta:{}}]}})});
  await assert.rejects(photonSend({credentials,recipient:credentials.recipients[0],message:'Hi',id:'test'}),/needs to text/);
 }finally{globalThis.fetch=original;}
});
test.after(async()=>{await rm(temp,{recursive:true,force:true});});
