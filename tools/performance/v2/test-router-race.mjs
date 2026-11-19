import assert from 'node:assert/strict';import {runAgent}from'../../../src/voiceagent.mjs';
const original=globalThis.fetch;let called=0;
globalThis.fetch=async(url)=>{
 if(String(url).includes('openrouter')){await new Promise(r=>setTimeout(r,550));return Response.json({answers:{route:{choice:'wall',confidence:.99}}});}
 await new Promise(r=>setTimeout(r,35));
 const events=[
  {type:'message_start',message:{id:'eval',type:'message',role:'assistant',model:'eval',content:[],stop_reason:null,stop_sequence:null,usage:{input_tokens:1,output_tokens:0}}},
  {type:'content_block_start',index:0,content_block:{type:'tool_use',id:'tool',name:'open',input:{}}},
  {type:'content_block_delta',index:0,delta:{type:'input_json_delta',partial_json:JSON.stringify({target:'weather'})}},
  {type:'content_block_stop',index:0},
  {type:'message_delta',delta:{stop_reason:'tool_use',stop_sequence:null},usage:{output_tokens:1}},
  {type:'message_stop'},
 ];
 return new Response(events.map(e=>'event: '+e.type+'\ndata: '+JSON.stringify(e)+'\n\n').join(''),{headers:{'content-type':'text/event-stream'}});
};
try{
 const t=performance.now();const result=await runAgent('Could you show the weather panel?',{context:async()=>({}),call:async()=>{called++;return[{ok:true}];}});const ms=Math.round(performance.now()-t);assert.equal(result.ok,true);assert.equal(called,1);assert.ok(ms<450,`slow router delayed model by ${ms}ms`);console.log('PASS model does not wait for slow router:',ms,'ms vs 550 ms mock router');
}finally{globalThis.fetch=original;}
