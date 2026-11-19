const {chromium}=require('/tmp/garden-browser-qa/node_modules/playwright');const assert=require('node:assert/strict'),fs=require('node:fs');
(async()=>{const browser=await chromium.launch({executablePath:'/home/talbot/.local/share/gardener-chrome/chrome-linux-arm64/chrome',args:['--no-sandbox','--disable-gpu','--disable-webgl']});try{
const p=await browser.newPage({viewport:{width:900,height:1600}}),errors=[];p.on('pageerror',e=>errors.push(e.message));
await p.goto('http://127.0.0.1:8787/?theme=classic&screenshot=1&bar=1');await p.waitForFunction(()=>window.gardenWall?.context().layout);await p.evaluate(()=>document.body.classList.add('qa-open'));
const act=(name,input)=>p.evaluate(({name,input})=>window.gardenWall.act({name,input}),{name,input});
const results=[];
for(const flow of ['', 'briefing','commute','controls','focus','packing','catalog']){
 const r=await p.evaluate(flow=>import('/lib/genui-studio.js').then(m=>m.showStudio(window.gardenWall.act,flow)),flow);assert(r.ok,JSON.stringify({flow,r}));await p.waitForTimeout(350);
 assert(await p.locator('a2ui-surface').count());const bounds=await p.locator('.garden-a2ui').evaluate(e=>({scroll:e.scrollWidth,width:e.clientWidth}));assert(bounds.scroll<=bounds.width+2,JSON.stringify({flow,bounds}));
 if(flow==='controls'){const field=p.locator('.garden-a2ui input').first();await field.fill('Golden Gate Park');await field.focus();assert.equal(await field.inputValue(),'Golden Gate Park');}
 if(flow==='packing'){await p.locator('.garden-a2ui input[type=checkbox]').first().check();assert(await p.locator('.garden-a2ui input[type=checkbox]').first().isChecked());}
 if(['','controls','briefing','catalog'].includes(flow))await p.screenshot({path:`docs/performance/v6/genui-${flow||'studio'}.png`});
 results.push(flow||'home');await act('close',{});
}
const catalog=await p.evaluate(()=>import('/lib/a2ui-surface.js').then(m=>m.a2uiCatalog()));fs.writeFileSync('public/genui/catalog.json',JSON.stringify(catalog,null,2)+'\n');
assert.equal(catalog.components.length,24);assert.deepEqual(errors,[]);console.log('PASS studio flows:',results.join(', '),'catalog:',catalog.components.length);
}finally{await browser.close();}})().catch(e=>{console.error(e);process.exitCode=1});
