// Read or exercise the real kiosk using its existing Arcade control surface.
// Usage: node tools/bw/wall-check.mjs inspect|launch|start|exit|timing
const arg=process.argv[2]||'inspect';
const expressions={
 inspect:`({title:document.title, arcades:document.querySelectorAll('.eg').length, titles:[...document.querySelectorAll('.ax-title')].map(e=>e.textContent),rows:[...document.querySelectorAll('.eg-rom')].map(e=>e.textContent),inGame:window.__GARDEN_GAME?.inGame(), canvases:document.querySelectorAll('canvas[aria-label="Bomberman World Garden Edition"]').length})`,
 launch:`(()=>{const row=[...document.querySelectorAll('.eg-rom')].find(e=>e.textContent.includes('Bomberman World: The Garden Edition'));if(!row)throw Error('World portrait not on shelf');row.click();if(!window.__GARDEN_GAME.inGame())document.querySelector('.ax-play').click();return 'launch requested';})()`,
 start:`(()=>{window.__GARDEN_GAME.raw('jbld');window.__GARDEN_GAME.raw('jblu');return {inGame:window.__GARDEN_GAME.inGame()};})()`,
 exit:`(()=>{window.__GARDEN_GAME.raw('jbkd');window.__GARDEN_GAME.raw('jbld');return {inGame:window.__GARDEN_GAME.inGame()};})()`,
 timing:`new Promise(resolve=>{const values=[];let last=performance.now();function tick(t){values.push(t-last);last=t;if(values.length<180)requestAnimationFrame(tick);else{values.sort((a,b)=>a-b);resolve({frames:values.length,medianMs:values[90],p95Ms:values[171],over25ms:values.filter(x=>x>25).length,canvas:document.querySelector('canvas[aria-label="Bomberman World Garden Edition"]')?.getBoundingClientRect().toJSON()});}}requestAnimationFrame(tick);})`,
};
if(!expressions[arg])throw Error('Unknown check');const tabs=await(await fetch('http://127.0.0.1:9223/json')).json();const tab=tabs.find(t=>t.type==='page'&&t.url.startsWith('http://127.0.0.1:8787/'));if(!tab)throw Error('Kiosk not connected');
const ws=new WebSocket(tab.webSocketDebuggerUrl);const timeout=setTimeout(()=>{ws.close();process.exitCode=1;},15000);
ws.addEventListener('open',()=>ws.send(JSON.stringify({id:1,method:'Runtime.evaluate',params:{expression:expressions[arg],awaitPromise:true,returnByValue:true}})));
ws.addEventListener('message',e=>{const r=JSON.parse(e.data);if(r.id!==1)return;clearTimeout(timeout);ws.close();if(r.error||r.result?.exceptionDetails){console.error(r.error||r.result.exceptionDetails);process.exitCode=1;}else console.log(JSON.stringify(r.result.result.value,null,2));});
