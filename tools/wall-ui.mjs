#!/usr/bin/env node
// Native UI control for Paseo/Codex; no screenshots, CLI child agent, or browser clicks.
// node tools/wall-ui.mjs context | audit | capabilities | request.json
import{readFileSync}from'node:fs';
const arg=process.argv[2]||'context';
const input=['context','audit','capabilities'].includes(arg)?null:JSON.parse(readFileSync(arg==='-'?0:arg,'utf8'));
if(input&&!['open','close','layout','command','surface','a2ui','send'].includes(input.name))throw Error('Expected a Garden UI action.');
const tabs=await(await fetch('http://127.0.0.1:9223/json')).json();
const tab=tabs.find(t=>t.type==='page'&&/^http:\/\/(127\.0\.0\.1|localhost):8787\//.test(t.url));if(!tab)throw Error('Garden kiosk is not connected.');
const ws=new WebSocket(tab.webSocketDebuggerUrl),start=performance.now();
const timeout=setTimeout(()=>{ws.close();console.error('Wall UI timed out.');process.exitCode=1;},15000);
const expression=arg==='context'?'window.gardenWall.context()':arg==='audit'?'window.gardenWall.auditLayout()':arg==='capabilities'?'window.gardenWall.capabilities()':`window.gardenWall.act(${JSON.stringify(input)})`;
ws.addEventListener('open',()=>ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression,awaitPromise:true,returnByValue:true}})));
ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.id!==1)return;clearTimeout(timeout);ws.close();if(r.error||r.result?.exceptionDetails){console.error('Wall UI failed.');process.exitCode=1;return;}console.log(JSON.stringify({ms:Math.round(performance.now()-start),result:r.result?.result?.value},null,2));});
ws.addEventListener('error',()=>{clearTimeout(timeout);console.error('Could not connect to the kiosk.');process.exitCode=1;ws.close();});
