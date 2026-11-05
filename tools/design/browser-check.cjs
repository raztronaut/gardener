// Optional integration check. Uses an externally installed Playwright, no app dependency.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const root=path.resolve(__dirname,'../..'),base=process.env.GARDENER_TEST_URL||'http://127.0.0.1:8787';
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.GARDENER_TEST_BROWSER,args:['--no-sandbox','--disable-gpu']});
 try{
  const page=await browser.newPage({viewport:{width:900,height:1600}}),errors=[];
  page.on('pageerror',e=>errors.push(e.message));
  const original=Object.fromEntries(['classic','moonstone'].map(id=>[id,JSON.parse(fs.readFileSync(path.join(root,'public/themes/'+id+'.json'),'utf8'))]));
  const responses=structuredClone(original);let delayClassic=0;
  await page.route('**/themes/*.json',async route=>{
   const id=path.basename(new URL(route.request().url()).pathname,'.json');
   if(!responses[id])return route.continue();
   const data=structuredClone(responses[id]),delay=id==='classic'?delayClassic:0;
   if(delay)await new Promise(r=>setTimeout(r,delay));
   await route.fulfill({json:data});
  });
  // Avoid expensive art rendering in a test concerned with theme state.
  await page.route('**/widgets/fractal.js*',r=>r.fulfill({contentType:'text/javascript',body:"export default {id:'fractal',title:'Fractal',mount(){}}"}));
  await page.goto(base+'/?theme=classic');
  await page.waitForFunction(()=>window.gardenDesign?.context().status==='ready');
  await page.locator('#themeSelect').waitFor();
  assert.equal(await page.evaluate(()=>window.gardenDesign.context().defaultDesignTarget),'classic');
  const api=async code=>page.evaluate(code);
  const refresh=()=>api(()=>window.gardenDesign.refresh());
  const choose=id=>page.evaluate(async id=>{const m=await import('/lib/themes.js');m.setTheme(id);await m.refreshDesign();},id);
  responses.classic.tokens.colors['--color-accent']='#ddbb22';await refresh();
  assert.equal(await api(()=>getComputedStyle(document.documentElement).getPropertyValue('--mint').trim()),'#ddbb22');
  const validCSS=await api(()=>document.getElementById('theme-design').textContent);
  responses.classic.tokens.colors['--color-accent']='banana';await refresh();
  assert.equal(await api(()=>window.gardenDesign.context().status),'error');
  assert.equal(await api(()=>document.getElementById('theme-design').textContent),validCSS);
  await choose('moonstone');
  assert.equal(await api(()=>window.gardenDesign.context().status),'ready');
  assert.equal(await api(()=>getComputedStyle(document.documentElement).getPropertyValue('--mint').trim()),'#d6c0ff');
  // Cached Classic survives a failed reload; an old failure cannot poison Moonstone.
  await choose('classic');
  assert.equal(await api(()=>document.getElementById('theme-design').textContent),validCSS);
  delayClassic=350;
  const stale=refresh();
  await choose('moonstone');await stale;
  assert.equal(await api(()=>window.gardenDesign.context().status),'ready');
  assert.equal(await api(()=>document.documentElement.dataset.themeError),undefined);
  delayClassic=0;responses.classic=structuredClone(original.classic);
  responses.classic.tokens.colors['--color-voice-1']='#80a0c0';await choose('classic');
  const rgb=await api(async()=>{const m=await import('/lib/design-values.js');return m.designColor('--color-voice-1',[.3,.96,.66]);});
  assert.deepEqual(rgb,[128/255,160/255,192/255]);
  responses.classic=structuredClone(original.classic);await refresh();
  assert.deepEqual(await api(async()=>{const m=await import('/lib/design-values.js');return m.designColor('--color-voice-1',[.3,.96,.66]);}),[.3,.96,.66]);
  assert.equal(await api(async()=>{const m=await import('/lib/themes.js');return m.setTheme('not-registered');}),false);
  await choose('moonstone');await page.locator('#rfBtn').click({button:'right'});await page.locator('#rfMenu').waitFor();
  assert.equal(await page.locator('#rfMenu').evaluate(e=>getComputedStyle(e).backgroundColor),'rgb(37, 33, 49)');
  assert.deepEqual(errors,[]);
  console.log('PASS real theme compilation, semantic aliases, atomic invalid updates, cached restoration, stale-response isolation, canvas colors and forest menu');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
