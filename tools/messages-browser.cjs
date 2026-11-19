// Isolated browser; all outbound messages are intercepted. Never contacts residents.
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const assert=require('node:assert/strict');
(async()=>{
 const browser=await chromium.launch({executablePath:process.env.GARDENER_TEST_BROWSER,args:['--no-sandbox','--disable-gpu','--disable-webgl']});
 const page=await browser.newPage({viewport:{width:900,height:1600}}),errors=[],sent=[];
 const deadline=setTimeout(()=>browser.close(),120000);
 page.on('pageerror',e=>errors.push(e.message));
 try {
  await page.route('**/lib/voice.js*',r=>r.fulfill({contentType:'text/javascript',body:'export function startVoice(){return {}; }'}));
  await page.route('**/widgets/fractal.js*',r=>r.fulfill({contentType:'text/javascript',body:"export default {id:'fractal',title:'Fractal',mount(){}}"}));
  const fixture={id:'fixture-edition',day:'2026-11-05',title:'Daily news test edition',intro:'A complete saved edition for browser testing.',wordCount:600,sections:[{title:'Science',summary:'Category summary.',stories:[{title:'A story',paragraphs:['The full story body.'],sources:[]}]}]};
  await page.route('**/api/reading-summary*',r=>r.fulfill({json:{today:fixture.day,edition:fixture,editions:[fixture]}}));
  await page.route('**/api/feeds/digest',r=>r.fulfill({json:{items:[{title:'Selected article test',url:'https://example.com/selected',summary:'Feed excerpt.',feedId:'test',source:'Test publisher'}],feeds:[]}}));
  await page.route('**/api/feeds/article?*',r=>r.fulfill({json:{text:'The full selected article, with its original link.',html:'<p>The full selected article, with its original link.</p>'}}));
  await page.route('**/api/transit',r=>r.fulfill({json:{arrivals:[],vehicles:[],stops:[]}}));
  await page.route('**/api/transit/catalog',r=>r.fulfill({json:{routes:[],shapes:[],stations:[]}}));
  await page.route('**/api/transit/routes',r=>r.fulfill({json:{routes:[]}}));
  await page.route('**/api/transit/places?*',r=>r.fulfill({json:{places:[{name:'Test Library',lat:37.7,lon:-122.4}]}}));
  const at=Date.now();
  const journey=route=>({minutes:20,transfers:0,walkingMinutes:2,arrival:at+1200000,legs:[{type:'ride',mode:'Muni bus',route,headsign:'Test Library',from:'Test stop',to:'Test Library',start:at+120000,end:at+1200000}]});
  await page.route('**/api/transit/plan',r=>r.fulfill({json:{journeys:[journey('TEST-1'),journey('TEST-2')],scheduleAt:at,directionsUrl:'https://example.com/directions'}}));
  await page.route('**/api/messages/recipients',r=>r.fulfill({json:{configured:true,recipients:[{id:'razi',name:'Razi'},{id:'gui',name:'Gui'}]}}));
  await page.route('**/api/messages/send' ,async r=>{sent.push(r.request().postDataJSON());await r.fulfill({status:202,json:{id:'a'.repeat(48),recipient:sent.at(-1).recipient,state:'sending'}});});
  await page.route('**/api/messages/status/*',r=>r.fulfill({json:{id:'a'.repeat(48),recipient:'Razi',state:'delivered'}}));
  await page.goto((process.env.GARDENER_TEST_URL||'http://127.0.0.1:8787')+'/?theme=classic');
  await page.waitForFunction(()=>window.gardenWall?.context().recipients.length===2);
  await page.waitForFunction(()=>document.documentElement.dataset.gardenerReady==='true');
  const opened=await page.evaluate(()=>window.gardenWall.act({name:'open',input:{target:'rss'}}));console.log('Opened reading room:',opened);
  await page.screenshot({path:'/tmp/garden-send-browser-open.png'});
  await page.locator('.fr-daily-button').click();await page.locator('.fr-edition h2').waitFor();
  await page.locator('#panelSend').click();await page.locator('.garden-send-choices button').first().waitFor();
  const bounds=await page.locator('.garden-send-menu').boundingBox();assert.ok(bounds.x>=0&&bounds.x+bounds.width<=900&&bounds.y+bounds.height<1600,'Send menu fits portrait screen');
  await page.screenshot({path:'/tmp/garden-send-classic.png'});
  await page.locator('.garden-send-choices button').filter({hasText:'Razi'}).click();
  assert.equal(sent[0].kind,'daily');assert.equal(sent[0].editionId,fixture.id);
  // Exact phrase used by speech's native fast path, then the same wall action.
  await page.evaluate(async()=>{const {messageAction}=await import('/lib/message-intent.js');return window.gardenWall.act(messageAction('send a note to razi saying "Hello, Gui!"'));});
  assert.equal(sent[1].text,'Hello, Gui!');assert.equal(sent[1].kind,'note');
  // 'This' outside an open item fails without sending.
  await page.evaluate(()=>window.gardenWall.act({name:'close'}));
  const noItem=await page.evaluate(()=>window.gardenWall.act({name:'send',input:{recipient:'razi',kind:'current'}}));assert.equal(noItem.ok,false);assert.equal(sent.length,2);
  await page.evaluate(()=>window.gardenWall.act({name:'show',input:{title:'A shared page',blocks:[{type:'text',text:'A readable paragraph to keep.'}]}}));
  await page.evaluate(()=>window.gardenWall.act({name:'send',input:{recipient:'gui',kind:'current'}}));assert.equal(sent[2].recipient,'gui');assert.match(sent[2].text,/readable paragraph/);
  await page.evaluate(()=>window.gardenWall.act({name:'open',input:{target:'rss'}}));
  await page.locator('.fr-preview .fr-prose').getByText('The full selected article, with its original link.').waitFor();
  await page.evaluate(()=>window.gardenWall.act({name:'send',input:{recipient:'razi',kind:'current'}}));
  assert.equal(sent[3].url,'https://example.com/selected');assert.match(sent[3].text,/full selected article/);
  await page.evaluate(()=>window.gardenWall.act({name:'open',input:{target:'transit'}}));
  await page.getByRole('searchbox',{name:'Destination'}).fill('Test Library');
  await page.getByRole('button',{name:'Find a way'}).click();
  await page.locator('.tr-place').click();
  await page.locator('.tr-option').nth(1).click();
  await page.evaluate(()=>window.gardenWall.act({name:'send',input:{recipient:'gui',kind:'current'}}));
  assert.match(sent[4].text,/TEST-2/);assert.ok(!sent[4].text.includes('TEST-1'));assert.equal(sent[4].url,'https://example.com/directions');
  // Selecting another theme preserves its existing header (no unapproved UI).
  await page.evaluate(async()=>{const m=await import('/lib/themes.js');m.setTheme('moonstone');await m.refreshDesign();});
  assert.equal(await page.locator('#panelSend').isVisible(),false);
  assert.equal(await page.evaluate(()=>window.gardenWall.context().recipients.length),2);
  await page.screenshot({path:'/tmp/garden-send-moonstone-unchanged.png'});
  assert.deepEqual(errors,[]);
  console.log(JSON.stringify({ok:true,checks:['Daily send button uses exact edition','Portrait menu fits','Dictated note preserves text','Send this rejects empty wall','Generic open page snapshot','Selected article keeps full text and original URL','Selected second itinerary is preserved','Other theme has no visual changes'],outboundIntercepts:sent.length,errors}));
 }finally{clearTimeout(deadline);await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
