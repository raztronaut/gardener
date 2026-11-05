import assert from 'node:assert/strict';import {runAgent}from'../../../src/voiceagent.mjs';
const original=globalThis.fetch;let called=0;
globalThis.fetch=async(url)=>{
 if(String(url).includes('openrouter')){await new Promise(r=>setTimeout(r,550));return Response.json({answers:{route:{choice:'wall',confidence:.99}}});}
 await new Promise(r=>setTimeout(r,35));
 return Response.json({id:'eval',type:'message',role:'assistant',model:'eval',content:[{type:'tool_use',id:'tool',name:'open',input:{target:'weather'}}],stop_reason:'tool_use',usage:{input_tokens:1,output_tokens:1}});
};
try{
 const t=performance.now();const result=await runAgent('Could you show the weather panel?',{context:async()=>({}),call:async()=>{called++;return[{ok:true}];}});const ms=Math.round(performance.now()-t);assert.equal(result.ok,true);assert.equal(called,1);assert.ok(ms<450,`slow router delayed model by ${ms}ms`);console.log('PASS model does not wait for slow router:',ms,'ms vs 550 ms mock router');
}finally{globalThis.fetch=original;}
