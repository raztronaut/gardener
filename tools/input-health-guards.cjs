const {chromium}=require('/tmp/garden-browser-qa/node_modules/playwright');
const assert=require('node:assert/strict');
(async()=>{
 const {probePage}=await import('../src/input-health-policy.mjs');
 const b=await chromium.launch({executablePath:'/home/talbot/.local/share/gardener-chrome/chrome-linux-arm64/chrome',args:['--no-sandbox','--disable-gpu']});
 try{
  const p=await b.newPage();await p.goto('about:blank');
  await p.evaluate(()=>{window.gardenWall={context:()=>({dashboard:'main',layout:{page:2}})};});
  const probe=()=>p.evaluate('('+probePage.toString()+')()');
  const checks={idle:(await probe()).safe};
  await p.evaluate(()=>{const t=document.createElement('textarea');t.value='unsaved';document.body.append(t);});
  checks.draftBlocked=!(await probe()).safe;
  await p.evaluate(()=>{document.body.innerHTML='<div role="dialog">Open dialog</div>';});
  checks.dialogBlocked=!(await probe()).safe;
  await p.evaluate(()=>{document.body.innerHTML='';window.gardenWall.context=()=>({dashboard:'main',game:{playing:true}});});
  checks.gameBlocked=!(await probe()).safe;
  await p.evaluate(()=>{window.gardenWall.context=()=>({dashboard:'main',layout:{page:2}});});
  const before=await probe();await p.waitForTimeout(20);await p.mouse.move(100,100);
  checks.trustedInputDetected=(await probe()).lastInput>before.lastInput;
  // Reproduce missing input acknowledgements in the isolated page only.
  await p.reload();await p.evaluate(()=>{
   window.addEventListener('pointermove',e=>e.stopImmediatePropagation(),true);
   window.gardenWall={context:()=>({dashboard:'main',layout:{page:2}})};
  });
  const frozen=await probe();await p.waitForTimeout(20);await p.mouse.move(150,150);
  checks.injectedLossDetected=(await probe()).lastInput===frozen.lastInput;
  await p.reload();await p.evaluate(()=>{window.gardenWall={context:()=>({dashboard:'main',layout:{page:2}})};});
  const restored=await probe();await p.waitForTimeout(20);await p.mouse.move(175,175);
  checks.reloadRestoresInput=(await probe()).lastInput>restored.lastInput;
  for(const [name,result] of Object.entries(checks))assert(result,name);
  console.log(checks);
 }finally{await b.close();}
})().catch(e=>{console.error(e);process.exitCode=1});
