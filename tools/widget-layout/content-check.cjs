// Integration gate: isolated browser storage, every default/optional size and page.
// PLAYWRIGHT_MODULE and GARDENER_TEST_BROWSER point to external QA dependencies.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');const fs=require('fs');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.GARDENER_TEST_BROWSER,args:['--no-sandbox','--disable-gpu','--disable-webgl']});const page=await browser.newPage({viewport:{width:900,height:1600}});const errors=[],results=[];const deadline=setTimeout(()=>{console.error('Layout QA exceeded 150 seconds');browser.close().finally(()=>process.exit(1));},150000);page.on('pageerror',e=>errors.push(e.message));
 await page.addInitScript(()=>{localStorage.setItem('garden.retire.midterms',String(Date.now()-1));localStorage.setItem('garden.todos.v1',JSON.stringify(Array.from({length:8},(_,i)=>({id:'qa-'+i,title:i===0?'Finish agent setup and verify the host documentation is installed correctly':i===1?'A deliberately long task title that wraps across lines so the card must retain its count and checkbox':'Task '+(i+1),assignee:i===0?'Gui':'',done:false,command:i===0?'sudo bash /example/test-command.sh':undefined,terminalHint:i===0}))));});
 await page.goto((process.env.GARDENER_TEST_URL||'http://127.0.0.1:8787')+'/?theme=classic&screenshot=1&bar=1');await page.waitForFunction(()=>window.gardenWall?.context().layout);await page.waitForTimeout(4000);await page.evaluate(()=>Promise.race([document.fonts.ready,new Promise(r=>setTimeout(r,3000))]));console.log('loaded');
 const act=input=>page.evaluate(input=>window.gardenWall.act({name:'layout',input}),input);
 const state=()=>page.evaluate(()=>window.gardenWall.context().layout);
 const audit=()=>page.evaluate(()=>window.gardenWall.auditLayout());
 for(let p=1;p<=(await state()).pages;p++){await act({action:'page',page:p});await page.waitForTimeout(70);results.push({kind:'default-page',page:p,...await audit()});}
 const widgets=(await state()).widgets;
 for(const w of widgets){
  for(const size of w.availableSizes){console.log('checking',w.id,size);
   const resize=await act({action:'resize',widget:w.id,size});if(!resize.ok){results.push({widget:w.id,size,ok:false,error:resize});continue;}
   const target=(await state()).widgets.find(x=>x.id===w.id);await act({action:'page',page:target.page==='all'?1:target.page});await page.waitForTimeout(80);
   const a=await audit();results.push({kind:'size',widget:w.id,size,...a});
   if(['todos','rss','transit'].includes(w.id)&&['original','wide','tall'].includes(size))await page.screenshot({path:`/tmp/garden-v3-${w.id}-${size}.png`});
   // Editor controls cannot shift the frame.
   const rect=()=>page.locator(`#garden>.card[data-wid="${w.id}"]`).boundingBox();const before=await rect();await act({action:'edit'});const during=await rect();await act({action:'done'});if(JSON.stringify(before)!==JSON.stringify(during))results.push({widget:w.id,size,ok:false,issues:[{kind:'editing-changed-frame'}]});
  }
  await act({action:'resize',widget:w.id,size:'original'});
 }
 // Actual extra-task behavior: all rows accessible fullscreen; instructions are
 // complete there, not cut into the finite tile. Adding never changes card geometry.
 await page.evaluate(()=>document.body.classList.add('qa-open'));
 await page.evaluate(()=>window.gardenWall.act({name:'open',input:{target:'todos'}}));await page.locator('.todo-full').waitFor({timeout:10000});
 const taskCount=await page.locator('.todo-full .todo-task').count();if(taskCount!==8)errors.push('Fullscreen task count '+taskCount);
 await page.locator('.todo-add input[type=text]').fill('New QA task');await page.locator('.todo-add button[type=submit]').click();if(await page.locator('.todo-full .todo-task').count()!==9)errors.push('Task add did not update');
 await page.keyboard.press('Escape');
 // Prove the audit detects a regression; restore immediately in isolated page.
 await page.evaluate(()=>{const c=document.querySelector('#garden>.card:not(.widget-page-hidden)');c.dataset.qaOriginal=c.style.height;c.style.setProperty('transform','translateY(2500px)','important');});
 if((await audit()).ok)errors.push('Audit did not catch an injected out-of-frame card');
 clearTimeout(deadline);await browser.close();const report={at:new Date().toISOString(),method:'900x1600 isolated Classic browser; real widget data, eight-task stress fixture; all offered sizes, default pages and editor geometry',results,errors};fs.writeFileSync(process.env.GARDENER_LAYOUT_REPORT||'/tmp/garden-v3-layout.json',JSON.stringify(report,null,2));
 const failures=results.filter(r=>!r.ok);console.log(JSON.stringify({checks:results.length,failures,errors},null,2));if(failures.length||errors.length)process.exitCode=1;
})().catch(e=>{console.error(e);process.exit(1)});
