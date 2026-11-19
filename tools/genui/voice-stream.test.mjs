import test from 'node:test';
import assert from 'node:assert/strict';
import {createA2uiToolStream,runAgent} from '../../src/voiceagent.mjs';
const create={version:'v0.9',createSurface:{surfaceId:'voice-test',catalogId:'https://garden.local/catalogs/house-v1.json'}};
const root={version:'v0.9',updateComponents:{surfaceId:'voice-test',components:[{id:'root',component:'Column',children:['intro']},{id:'intro',component:'Text',text:'Already visible'}]}};
const update={version:'v0.9',updateDataModel:{surfaceId:'voice-test',path:'/done',value:true}};
const begin=()=>({type:'content_block_start',index:0,content_block:{type:'tool_use',id:'ui-tool',name:'a2ui',input:{}}});
const delta=partial_json=>({type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json}});
const final=messages=>({content:[{type:'tool_use',id:'ui-tool',name:'a2ui',input:{title:'Demo',messages}}],stop_reason:'tool_use'});
const tick=()=>new Promise(r=>setTimeout(r,0));
test('complete messages paint before final tool JSON; split input and queued calls preserve order',async()=>{
 const calls=[];let resume;const blocked=new Promise(r=>resume=r);
 const session=createA2uiToolStream({call:async xs=>{calls.push(xs[0]);if(calls.length===1)await blocked;return[{ok:true}];}});
 session.handle(begin());const prefix='{"title":"Demo","messages":['+JSON.stringify(create)+','+JSON.stringify(root);
 for(const ch of prefix)session.handle(delta(ch));
 await session.ready;await tick();assert.equal(calls.length,0,'router gate must hold queued messages');session.release();await tick();assert.equal(calls.length,1);resume();await tick();assert.equal(calls.length,2,'second complete message must render before outer tool closes');
 session.handle(delta(','+JSON.stringify(update)+']}'));
 const results=await session.finish(final([create,root,update]));assert.equal(results.get('ui-tool').ok,true);assert.deepEqual(calls.map(c=>c.input.messages[0]),[create,root,update]);assert(calls.every(c=>c.name==='a2ui'));
});
test('cancellation during an in-flight call discards queued UI patches',async()=>{
 const ctl=new AbortController();let release;const pending=new Promise(r=>release=r);let calls=0;
 const session=createA2uiToolStream({signal:ctl.signal,call:async()=>{calls++;await pending;return[{ok:true}];}});
 session.handle(begin());session.release();session.handle(delta(JSON.stringify({title:'Demo',messages:[create,root,update]})));await tick();assert.equal(calls,1);ctl.abort();release();await assert.rejects(()=>session.finish(final([create,root,update])));await tick();assert.equal(calls,1);
});
test('a rendering failure stops later patches and returns the actual failed result',async()=>{
 let calls=0;const session=createA2uiToolStream({call:async()=>{calls++;return[{ok:false,error:'Surface closed'}];}});
 session.handle(begin());session.release();session.handle(delta(JSON.stringify({title:'Demo',messages:[create,root]})));const out=await session.finish(final([create,root]));assert.equal(calls,1);assert.equal(out.get('ui-tool').error,'Surface closed');
});
test('ordinary tools do not dispatch through the incremental path',async()=>{
 let calls=0;const session=createA2uiToolStream({call:async()=>{calls++;return[{ok:true}];}});session.release();
 session.handle({...begin(),content_block:{type:'tool_use',name:'volume',id:'volume-tool',input:{}}});session.handle(delta('{"set":90}'));assert.equal((await session.finish({content:[],stop_reason:'end_turn'})).size,0);assert.equal(calls,0);
});
test('SDK SSE → runAgent renders before provider completion and never replays the final tool',async()=>{
 const original=globalThis.fetch,enc=new TextEncoder(),calls=[];let providerFinished=false,firstPaintBeforeFinish=false,finishProvider,timer;
 const send=(controller,event)=>controller.enqueue(enc.encode('event: '+event.type+'\ndata: '+JSON.stringify(event)+'\n\n'));
 globalThis.fetch=async (url,init)=>{
  if(String(url).includes('openrouter'))return Response.json({answers:{route:{choice:'wall',confidence:.99,probabilities:{wall:.99}}}});
  const request=JSON.parse(init.body);assert.equal(request.tools.find(t=>t.name==='a2ui').eager_input_streaming,true,'production A2UI tool must disable provider buffering');
  return new Response(new ReadableStream({start(controller){
   send(controller,{type:'message_start',message:{id:'sdk-test',type:'message',role:'assistant',model:'test',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:0}}});send(controller,begin());
   send(controller,delta('{"title":"Demo","messages":['+JSON.stringify(create)+','+JSON.stringify(root)));
   finishProvider=()=>{clearTimeout(timer);send(controller,delta(','+JSON.stringify(update)+']}'));send(controller,{type:'content_block_stop',index:0});send(controller,{type:'message_delta',delta:{stop_reason:'tool_use',stop_sequence:null},usage:{output_tokens:50}});providerFinished=true;send(controller,{type:'message_stop'});controller.close();};
   timer=setTimeout(finishProvider,1200);
  }}),{headers:{'content-type':'text/event-stream'}});
 };
 try{
  const result=await runAgent('Build an interactive packing checklist for our outing',{context:async()=>({}),call:async xs=>{for(const x of xs){calls.push(x);if(!providerFinished)firstPaintBeforeFinish=true;}if(calls.length===2)finishProvider();return xs.map(()=>({ok:true}));},signal:AbortSignal.timeout(5000)});
  assert.equal(result.ok,true);assert.equal(firstPaintBeforeFinish,true);assert.equal(calls.length,3);assert.deepEqual(calls.map(c=>c.input.messages[0]),[create,root,update]);
 }finally{clearTimeout(timer);globalThis.fetch=original;}
});

test('a duplicate A2UI tool block never streams or replaces the first tool',async()=>{
 const calls=[];const session=createA2uiToolStream({call:async xs=>{calls.push(...xs);return[{ok:true}];}});session.release();session.handle(begin());session.handle(delta(JSON.stringify({title:'Demo',messages:[create]})));
 session.handle({...begin(),index:1,content_block:{type:'tool_use',id:'ignored-tool',name:'a2ui',input:{}}});session.handle({...delta(JSON.stringify({title:'Duplicate',messages:[root]})),index:1});
 const response=final([create]);response.content.push({type:'tool_use',id:'ignored-tool',name:'a2ui',input:{title:'Duplicate',messages:[root]}});const result=await session.finish(response);assert.equal(result.size,1);assert.equal(calls.length,1);
});
test('routing cancellation before the gate opens discards all provisional messages',async()=>{
 const ctl=new AbortController();let calls=0;const session=createA2uiToolStream({signal:ctl.signal,call:async()=>{calls++;return[{ok:true}];}});
 session.handle(begin());session.handle(delta(JSON.stringify({title:'Demo',messages:[create,root]})));ctl.abort();await assert.rejects(()=>session.finish(final([create,root])));await tick();assert.equal(calls,0);
});
test('a malformed tail retires an already-rendered provisional surface by its exact id',async()=>{
 const calls=[];const session=createA2uiToolStream({call:async xs=>{calls.push(...xs);return[{ok:true}];}});session.release();session.handle(begin());session.handle(delta('{"title":"Demo","messages":['+JSON.stringify(create)));await tick();assert.equal(calls.length,1);
 session.handle(delta(',broken-tail'));session.handle({type:'content_block_stop',index:0});const out=await session.finish(final([create]));assert.equal(out.get('ui-tool').ok,false);assert.equal(calls.length,2);assert.deepEqual(calls[1].input.messages,[{version:'v0.9',deleteSurface:{surfaceId:'voice-test'}}]);
});
