// Browser management checks intercept every provider mutation and outgoing send.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.GARDENER_TEST_BROWSER,args:['--no-sandbox','--disable-gpu','--disable-webgl']});
 const page=await browser.newPage({viewport:{width:900,height:1600}}),errors=[],mutations=[];
 const deadline=setTimeout(()=>browser.close(),100000);page.on('pageerror',e=>errors.push(e.message));
 let residents=[{id:'razi',name:'Razi',phone:'+15555550101',aliases:[],assignedPhoneNumber:'+15555550888',state:'ready'}];
 try {
  await page.route('**/lib/voice.js*',r=>r.fulfill({contentType:'text/javascript',body:'export function startVoice(){return {}; }'}));
  await page.route('**/widgets/fractal.js*',r=>r.fulfill({contentType:'text/javascript',body:"export default {id:'fractal',title:'Fractal',mount(){}}"}));
  await page.route('**/api/messages/send',()=>{throw Error('Management must not send a message.');});
  await page.route('**/api/messages/recipients',r=>r.fulfill({json:{configured:true,recipients:residents.map(({id,name})=>({id,name}))}}));
  await page.route('**/api/messages/residents**',async r=>{
   const path=new URL(r.request().url()).pathname;
   if(r.request().method()==='GET')return r.fulfill({json:{configured:true,remoteAvailable:true,free:true,residents}});
   const input=r.request().postDataJSON();mutations.push({path,input});
   if(path.endsWith('/save')){
    const row={id:input.id||input.name.toLowerCase(),...input,assignedPhoneNumber:'+15555550777',state:'pending'};
    residents=residents.filter(x=>x.id!==row.id);residents.push(row);return r.fulfill({json:{ok:true,resident:row}});
   }
   residents=residents.filter(x=>x.id!==input.id);return r.fulfill({json:{ok:true}});
  });
  await page.goto((process.env.GARDENER_TEST_URL||'http://127.0.0.1:8787')+'/?theme=classic');
  await page.waitForFunction(()=>document.documentElement.dataset.gardenerReady==='true');
  const result=await page.evaluate(()=>window.gardenWall.act({name:'command',input:{name:'residents'}}));assert.equal(result.ok,true);
  await page.getByText('Ready to receive',{exact:true}).waitFor();assert.equal(await page.locator('#panelSend').count(),0);
  await page.locator('.residents-editor > summary').click();
  await page.getByLabel('Resident name',{exact:true}).fill('Gui');await page.getByLabel('Resident phone',{exact:true}).fill('+15555550102');await page.getByRole('button',{name:'Add resident',exact:true}).click();
  const row=page.locator('[data-resident-id="gui"]');await row.getByText('Needs activation',{exact:true}).waitFor();await row.getByText(/send “Hi Garden”/).waitFor();
  assert.ok((await page.evaluate(()=>window.gardenWall.context().recipients)).some(r=>r.id==='gui'));
  await page.screenshot({path:'/tmp/garden-residents-classic.png'});
  await row.getByRole('button',{name:'Edit',exact:true}).click();assert.equal(await page.getByLabel('Resident phone',{exact:true}).evaluate(e=>e.readOnly),true);
  await page.getByLabel('Resident name',{exact:true}).fill('Gui David');await page.getByRole('button',{name:'Save changes',exact:true}).click();await row.getByRole('heading',{name:'Gui David',exact:true}).waitFor();
  await row.getByRole('button',{name:'Remove',exact:true}).click();assert.equal(mutations.filter(m=>m.path.endsWith('/remove')).length,0);
  await row.getByRole('button',{name:'Keep resident',exact:true}).click();assert.equal(await row.locator('.residents-confirm').count(),0);
  await row.getByRole('button',{name:'Remove',exact:true}).click();await row.getByRole('button',{name:'Remove Gui David',exact:true}).click();await row.waitFor({state:'detached'});
  assert.equal(mutations.filter(m=>m.path.endsWith('/remove')).length,1);assert.ok(!(await page.evaluate(()=>window.gardenWall.context().recipients)).some(r=>r.id==='gui'));
  const share=await page.evaluate(()=>window.gardenWall.act({name:'send',input:{recipient:'razi',kind:'current'}}));assert.equal(share.ok,false);
  await page.getByText('Setup and sending help',{exact:true}).click();await page.getByText(/No resident account or extra app/).waitFor();
  await page.evaluate(()=>window.gardenWall.act({name:'command',input:{name:'theme',arg:'moonstone'}}));
  await page.evaluate(()=>window.gardenWall.act({name:'command',input:{name:'residents'}}));await page.getByText('Ready to receive',{exact:true}).waitFor();
  assert.equal(await page.locator('#panelSend').count(),0);assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,checks:['Command opens manager','Adds without sending','Shows opt-in instructions','Name edit keeps phone fixed','Remove requires confirmation and supports cancel','Voice roster updates immediately','Address book cannot be shared','Setup help opens','Other theme remains usable'],mutations:mutations.length,errors}));
 }finally{clearTimeout(deadline);await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
