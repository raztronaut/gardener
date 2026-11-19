// Optional live integration check: uses the machine's external QA browser, no app dependency.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'/tmp/garden-browser-qa/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.GARDENER_TEST_BROWSER||'/home/talbot/.local/share/gardener-chrome/chrome-linux-arm64/chrome',args:['--no-sandbox','--disable-gpu']});
 const base=process.env.GARDENER_TEST_URL||'http://127.0.0.1:8787';
 try{for(const theme of ['classic','moonstone']){
  const page=await browser.newPage({viewport:{width:900,height:1600}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
  await page.goto(`${base}/?theme=${theme}&screenshot=1&open=rss`);
  await page.waitForFunction(()=>window.gardenDesign?.context().status==='ready');
  await page.locator('.fr-sources').getByRole('button',{name:'The Guardian',exact:true}).click();
  await page.locator('.fr-story').first().click();
  await page.waitForFunction(()=>document.querySelector('.fr-excerpt-note')?.textContent.startsWith('Article from the publisher'),null,{timeout:40000});
  const preview=page.locator('.fr-prose.article-rich');assert(await preview.locator('img').count());
  await preview.locator('img').first().evaluate(img=>img.decode());
  assert(await preview.locator('p').count()>2);
  assert.equal(await preview.evaluate(e=>e.scrollWidth>e.clientWidth),false);
  await page.screenshot({path:`/tmp/reader-${theme}-preview.png`});
  const url=await page.locator('.fr-story[aria-pressed="true"]').getAttribute('data-url');
  await page.locator('.fr-fullscreen').click();
  const frame=page.frameLocator('.rd-frame');await frame.locator('.article-rich img').first().waitFor({timeout:40000});
  assert.equal(await frame.locator('html').getAttribute('data-theme'),theme);
  await frame.locator('.article-rich img').first().evaluate(img=>img.decode());
  await frame.locator('body').evaluate(()=>document.fonts.ready);
  assert.equal(await frame.locator('body').evaluate(e=>e.scrollWidth>e.clientWidth),false);
  const before=await frame.locator('body').evaluate(()=>scrollY);
  await page.locator('.rd-frame').evaluate(e=>e.contentWindow.postMessage({__readerScroll:600},'*'));
  await page.waitForTimeout(500);assert(await frame.locator('body').evaluate(()=>scrollY)>before);
  await page.locator('.rd-frame').evaluate(e=>e.contentWindow.postMessage({__readerScroll:-100000},'*'));await page.waitForTimeout(500);
  await page.screenshot({path:`/tmp/reader-${theme}-fullscreen.png`});
  // A deterministic HN listing linked to the same real publisher article tests
  // the actual HN click path without depending on today's front-page ordering.
  await page.route('**/api/proxy?*',route=>{
   const u=new URL(route.request().url()).searchParams.get('url')||'';
   if(u.includes('hacker-news.firebaseio.com/v0/topstories'))return route.fulfill({json:[424242]});
   if(u.includes('hacker-news.firebaseio.com/v0/item/'))return route.fulfill({json:{id:424242,title:'Reader integration article',url,score:10,time:Date.now()/1000}});
   return route.continue();
  });
  await page.goto(`${base}/?theme=${theme}&screenshot=1&open=hacker-news`);
  await page.locator('.cl-row.clickable').filter({hasText:'Reader integration article'}).first().click();
  await page.frameLocator('.rd-frame').locator('.article-rich img').first().waitFor({timeout:40000});
  assert.equal(await page.frameLocator('.rd-frame').locator('html').getAttribute('data-theme'),theme);
  assert.deepEqual(errors,[]);console.log(`PASS ${theme}: live RSS rich preview, fullscreen images, fonts, overflow, controller scrolling, HN article path`);
  await page.close();
 }}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
