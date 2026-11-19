// Real dashboard round trips in isolated storage; never launches a native game.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
const path=require('node:path');
const fs=require('node:fs');

(async()=>{
  const output=path.join(__dirname,'../../data/layout-transition-qa');
  fs.mkdirSync(output,{recursive:true});
  const browser=await chromium.launch({executablePath:process.env.GARDENER_TEST_BROWSER,args:['--no-sandbox','--disable-gpu','--disable-webgl']});
  try {
    for(const theme of ['classic','moonstone']) {
      const page=await browser.newPage({viewport:{width:900,height:1600}});
      await page.addInitScript(()=>localStorage.setItem('garden.retire.midterms',String(Date.now()-1)));
      const act=async(name,input)=>{
        const result=await page.evaluate(request=>window.gardenWall.act(request),{name,input});
        assert(result.ok,JSON.stringify(result));
      };
      const snapshot=()=>page.evaluate(()=>({
        layout:window.gardenWall.context().layout,
        saved:localStorage.getItem(`garden.widget-pages.${document.documentElement.dataset.theme}.grid.v3`),
        cards:[...document.querySelectorAll('#garden>.card[data-wid]')].map(c=>({
          id:c.dataset.wid,hidden:c.classList.contains('widget-page-hidden'),
          column:c.style.getPropertyValue('--home-column'),row:c.style.getPropertyValue('--home-row'),
          rect:c.getBoundingClientRect().toJSON(),
        })),
      }));
      await page.goto((process.env.GARDENER_TEST_URL||'http://127.0.0.1:8787')+`/?theme=${theme}&screenshot=1`);
      await page.waitForSelector('#garden[data-layout=standard]');
      await page.waitForFunction(()=>document.documentElement.dataset.gardenerBoot==='ready');
      // Include a human rearrangement and non-default size, not just the manifest order.
      await act('layout',{action:'resize',widget:'weather',size:'wide'});
      await act('layout',{action:'move',widget:'hacker-news',page:2});
      await act('layout',{action:'page',page:2});
      const before=await snapshot();
      for(let round=0;round<3;round++) {
        await act('dashboard',{id:'arcade'});
        assert.equal(await page.evaluate(()=>window.gardenWall.context().dashboard),'arcade');
        const during=await page.evaluate(theme=>localStorage.getItem(`garden.widget-pages.${theme}.grid.v3`),theme);
        assert.equal(during,before.saved,`${theme}: leaving home must not rewrite the saved layout`);
        await act('dashboard',{id:'main'});
        const after=await snapshot();
        assert.deepEqual(after,before,`${theme}: Arcade return ${round+1} must preserve page, positions, sizes and storage`);
      }
      await page.screenshot({path:path.join(output,`${theme}-after.png`)});
      await page.close();
      console.log(`PASS ${theme}: three Arcade round trips preserve exact geometry, page and saved choices`);
    }
  } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
