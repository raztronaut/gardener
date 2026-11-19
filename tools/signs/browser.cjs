// Real Garden panel and sign module; all sign, speech and printer calls are fixtures.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/home/talbot/.cache/garden-browser-qa/node_modules/playwright-core');
const assert=require('node:assert/strict'),fs=require('node:fs/promises'),path=require('node:path'),os=require('node:os');
const {execFile}=require('node:child_process');const exec=require('node:util').promisify(execFile);
(async()=>{
 const {createSignWorkflow}=await import('../../src/sign-workflow.mjs');
 const {runAgent}=await import('../../src/voiceagent.mjs');
 const dir=await fs.mkdtemp(path.join(os.tmpdir(),'garden-sign-browser-'));let submitted=0,speeches=0,listens=0;
 const spec={eyebrow:'algorithm',headline:'Lock door after opening',subphrase:'Unless short trips (e.g. taking trash)',illustration:'door',template:'directive',logo:'directive'};
 const flow=createSignWorkflow({dir,propose:async(intent,old)=>({spec:{...(old||spec),...(old?{headline:intent}:{})},model:'browser fixture'}),render:async(s,out)=>{await fs.mkdir(out,{recursive:true});const p=path.join(out,'render.json');await fs.writeFile(p,JSON.stringify({...s,illustrationFile:path.join(process.cwd(),'data/signs/qa/codex-image-probe/illustration.png')}));await exec('python3',['tools/signs/render.py',p,out,'data/signs/assets'],{cwd:'/home/talbot/gardener'});return{illustration:{provider:'programmatic'}};},printer:{submit:async()=>{submitted++;return{jobId:submitted,status:'submitted'};},find:async()=>null}});
 const browser=await chromium.launch({executablePath:'/home/talbot/.local/share/gardener-chrome/chrome-linux-arm64/chrome',args:['--no-sandbox','--disable-gpu','--disable-webgl']});
 try{
  const page=await browser.newPage({viewport:{width:900,height:1600}});const errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.route('**/api/signs/**',async r=>{try{
   const url=new URL(r.request().url()),action=url.pathname.slice('/api/signs/'.length);let result;
   if(action==='catalog')result=JSON.parse(await fs.readFile('data/signs/templates.json','utf8'));
   else if(action==='printer')result={ok:true,name:'Fixture printer',attributes:{'media-default':'na_letter_8.5x11in'}};
   else if(r.request().method()==='GET'){
    const parts=action.split('/');if(parts.length===3)return r.fulfill({contentType:parts[2].endsWith('.png')?'image/png':'application/pdf',body:await flow.artifact(parts[0],Number(parts[1]),parts[2])});result=await flow.get(action);
   }else if(action==='speak'){speeches++;result={ok:true,audio:'/fixture-speech.wav'};}else result=await flow[action](r.request().postDataJSON());
   await r.fulfill({json:result});
  }catch(e){await r.fulfill({status:400,json:{error:e.message}});}});
  await page.route('http://127.0.0.1:8899/**',r=>{if(r.request().url().endsWith('/ptt'))listens++;return r.fulfill({json:{ok:true,state:'idle',enabled:true},headers:{'access-control-allow-origin':'*','access-control-allow-headers':'content-type'}});});
  await page.addInitScript(()=>{window.Audio=class {play(){setTimeout(()=>this.onended?.(),30);return Promise.resolve();}pause(){this.onpause?.();}};});
  await page.goto('http://127.0.0.1:8787/?screenshot=1&voiceport=8899',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>!!window.gardenWall,{timeout:30000});
  await page.evaluate(()=>document.body.classList.remove('screenshot'));
  const action=input=>page.evaluate(input=>window.gardenWall.act({name:'sign',input}),input);
  const say=text=>runAgent(text,{context:()=>page.evaluate(()=>gardenWall.context()),call:async calls=>{const out=[];for(const c of calls)out.push(await page.evaluate(c=>gardenWall.act(c),c));return out;},startedAt:Date.now()});
  assert((await say('Make a sign')).ok);
  await page.waitForFunction(()=>gardenWall.context().sign?.status==='brief');
  for(let i=0;i<30&&listens<1;i++)await page.waitForTimeout(100);
  assert(listens>=1,'Opening the studio asks aloud and starts follow-up capture');
  assert.equal(await page.locator('.sign-compose textarea').isVisible(),false);
  assert((await say('People should lock the door after opening except for short trips')).ok);
  await page.waitForFunction(()=>!!window.gardenWall.context().sign?.approval,{timeout:30000});
  for(let i=0;i<50&&(speeches<2||listens<2);i++)await page.waitForTimeout(100);
  let state=await page.evaluate(()=>window.gardenWall.context().sign);const first=state;
  assert.equal(submitted,0);assert(speeches>=2);assert(listens>=2);
  const print=page.locator('[data-sign-print]');assert.equal(await print.isEnabled(),true);
  // Voice generic select/press must not bypass explicit confirmation.
  assert.equal((await page.evaluate(()=>gardenWall.act({name:'select',input:{text:'Yes, print this version'}}))).ok,false);
  assert.equal((await page.evaluate(()=>gardenWall.act({name:'press',input:{button:'ok'}}))).ok,false);
  assert.equal(submitted,0);
  assert.equal(await page.locator('.sign-slots textarea').first().isVisible(),false);
  assert((await say('Change the headline to lock the door behind you')).ok);
  await page.waitForFunction(()=>gardenWall.context().sign?.version===2&&!!gardenWall.context().sign.approval,{timeout:30000});
  assert.equal((await action({action:'approve',id:first.id,version:first.version,token:first.approval.token,utterance:'yes',startedAt:Date.now()})).ok,false);
  assert.equal(submitted,0);
  state=await page.evaluate(()=>gardenWall.context().sign);
  const approved={action:'approve',id:state.id,version:state.version,token:state.approval.token,utterance:'yes print it',startedAt:Date.now()};
  assert((await say('yes print it')).ok);await flow.settled();await page.waitForFunction(()=>gardenWall.context().sign?.status==='submitted');assert.equal(submitted,1);
  await action(approved);assert.equal(submitted,1);
  await say('The picture is bad, generate a new illustration of a hand turning the lock');await page.waitForFunction(()=>gardenWall.context().sign?.version===3&&!!gardenWall.context().sign.approval,{timeout:30000});
  await page.evaluate(()=>dispatchEvent(new CustomEvent('garden:voice-cancel',{detail:{why:'silence'}})));
  assert.equal((await page.evaluate(()=>gardenWall.context().sign)).approval,null);assert.equal(submitted,1);
  await say('no');assert.equal((await page.evaluate(()=>gardenWall.context().sign)).status,'cancelled');
  // A real preview for inspection, without speech, approval tokens or printing.
  const sample=await flow.create({slots:spec});await flow.settled();await action({action:'open',id:sample.id,silent:true});
  await page.locator('.sign-preview img').waitFor();await page.waitForTimeout(600);
  await fs.mkdir('data/signs/qa',{recursive:true});await page.screenshot({path:'data/signs/qa/voice-studio.png'});
  const geometry=await page.locator('.garden-signs').evaluate(el=>({width:el.getBoundingClientRect().width,scrollWidth:el.scrollWidth,screenWidth:innerWidth}));assert(geometry.scrollWidth<=geometry.width+2);
  assert.equal(errors.length,0,errors.join('\n'));console.log(JSON.stringify({ok:true,submittedToFixtureOnly:submitted,speeches,listens,geometry,errors}));
 }finally{await browser.close();await fs.rm(dir,{recursive:true,force:true});}
})().catch(e=>{console.error(e);process.exitCode=1});
