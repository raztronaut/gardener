// Regression: right-side assignment dropdowns must not widen the task page.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.GARDENER_TEST_BROWSER,args:['--no-sandbox','--disable-gpu']});
 try{
  const page=await browser.newPage({viewport:{width:900,height:1600}});
  await page.addInitScript(()=>localStorage.setItem('garden.todos.v1',JSON.stringify(Array.from({length:8},(_,i)=>({id:'qa-assignee-'+i,title:'Check shared supplies and keep this long task and its assignment controls reachable '+i,assignees:['gui','param','herbie'],done:false})))));
  await page.goto((process.env.GARDENER_TEST_URL||'http://127.0.0.1:8787')+'/?theme=classic',{waitUntil:'domcontentloaded'});
  await page.waitForFunction(()=>window.gardenWall?.context().layout);
  await page.evaluate(()=>window.gardenWall.act({name:'open',input:{target:'todos'}}));
  await page.locator('.todo-full').waitFor();
  const pickers=[page.locator('.todo-task details').first(),page.locator('.todo-task details').last(),page.locator('.todo-add details')];
  for(const picker of pickers){
   await picker.locator('summary').click();
   await page.waitForTimeout(100);
   const geometry=await picker.evaluate(details=>{
    const menu=details.querySelector('.todo-assignee-menu'),body=details.closest('.panel-body'),r=menu.getBoundingClientRect(),b=body.getBoundingClientRect();
    return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,panelLeft:b.left+body.clientLeft,panelRight:b.left+body.clientLeft+body.clientWidth,panelBottom:b.bottom,overflowX:body.scrollWidth-body.clientWidth,documentOverflow:document.documentElement.scrollWidth-document.documentElement.clientWidth};
   });
   assert(geometry.left>=geometry.panelLeft-1&&geometry.right<=geometry.panelRight+1,JSON.stringify(geometry));
   assert(geometry.top>=0&&geometry.bottom<=Math.min(1600,geometry.panelBottom)+1,JSON.stringify(geometry));
   assert(geometry.overflowX<=1&&geometry.documentOverflow<=1,JSON.stringify(geometry));
   assert(await picker.getByRole('button',{name:'All',exact:true}).isVisible());
   assert.equal(await picker.getByRole('checkbox').count(),6);
   await page.keyboard.press('Escape');
   assert(await page.locator('#panel').evaluate(e=>e.classList.contains('open')));
  }
  console.log('PASS: first task, last task, and add-task menus fit both axes; no horizontal scrollbar; All and every assignee reachable.');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exit(1)});
