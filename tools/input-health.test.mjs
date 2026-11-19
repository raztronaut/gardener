import test from 'node:test';
import assert from 'node:assert/strict';
import {createWidgetScope} from '../public/lib/widget-scope.js';
import {inputDecision} from '../src/input-health-policy.mjs';
const sleep=ms=>new Promise(r=>setTimeout(r,ms));

test('closing a slow widget aborts fetch and rejects timers registered after close',async()=>{
  const old=globalThis.fetch;let aborted=false,runs=0;
  globalThis.fetch=(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>{aborted=true;reject(signal.reason);},{once:true}));
  try{const scope=createWidgetScope(),pending=scope.fetchJSON('/slow',{viaProxy:false});scope.stop();await assert.rejects(pending,{name:'AbortError'});assert(aborted);assert.equal(scope.interval(()=>runs++,5),null);await sleep(20);assert.equal(runs,0);await assert.rejects(scope.fetchJSON('/closed'),{name:'AbortError'});}finally{globalThis.fetch=old;}
});
test('async refreshes cannot overlap; stop is permanent; rejected refreshes are handled',async()=>{
  let running=0,peak=0,calls=0,errors=0;const scope=createWidgetScope(()=>errors++);
  scope.interval(async()=>{calls++;peak=Math.max(peak,++running);await sleep(22);running--;throw Error('offline');},3);
  await sleep(60);scope.stop();const after=calls;await sleep(35);assert.equal(peak,1);assert.equal(calls,after);assert(errors>0);
});
test('an explicitly loaded widget does not immediately fetch twice',async()=>{
  let calls=0;const scope=createWidgetScope();scope.interval(()=>calls++,100,{immediate:false});assert.equal(calls,0);scope.stop();
});
const sample=now=>({now,rawCount:30,lastRaw:now-100,page:{safe:true,fresh:false,lastInput:1},window:{kiosk:true,buttonsDown:false},voiceIdle:true});
test('recovery needs sustained physical input loss, not a stationary pointer',()=>{
  let state={};state=inputDecision(state,sample(20000));assert(!state.recover);state=inputDecision(state,sample(25000));assert(!state.recover);state=inputDecision(state,sample(30000));assert(state.recover);
  assert.equal(inputDecision(state,{...sample(35000),rawCount:0}).strikes,0);
});
test('typing/overlays/games/voice, another app, held mouse, new probe, stale events and healthy input prevent recovery',()=>{
  const variants=[{page:{safe:false,lastInput:1}},{voiceIdle:false},{window:{kiosk:false}},{window:{kiosk:true,buttonsDown:true}},{page:{safe:true,fresh:true,lastInput:1}},{lastRaw:100},{page:{safe:true,lastInput:29999}}];
  for(const change of variants)assert.equal(inputDecision({since:10000,strikes:9},{...sample(30000),...change}).recover,false);
});
