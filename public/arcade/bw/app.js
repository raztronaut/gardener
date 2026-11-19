import {World} from './engine.js';
import {Renderer} from './render.js';
import {WorldAudio} from './audio.js';
export async function bootBW(host,{onExit=()=>{},assetBase='/api/bw/asset/',debug=false}={}) {
 const root=document.createElement('div');root.style.cssText='position:absolute;inset:0;background:#061119;display:flex;align-items:center;justify-content:center;overflow:hidden';
 const canvas=document.createElement('canvas');canvas.setAttribute('aria-label','Bomberman World Garden Edition');canvas.style.cssText='display:block;max-width:100%;max-height:100%;width:auto;height:100%;aspect-ratio:320/568;image-rendering:pixelated;outline:0';canvas.tabIndex=0;root.append(canvas);host.replaceChildren(root);
 const get=async name=>{const r=await fetch(assetBase+name);if(!r.ok)throw Error('World asset missing: '+name);return new Uint8Array(await r.arrayBuffer());};
 const [base,vram,pack]=await Promise.all([get('battle.ram'),get('battle.vram'),fetch(assetBase+'pack.json').then(r=>r.json())]);
 const stages=pack.stages||[{id:0,name:'Standard'}];
 for(const stage of stages)if(stage.preview)pack.presentation.images['stagePreview'+stage.id]=stage.preview;
 const audio=new WorldAudio(assetBase);await audio.load();
 let world=new World(base,{onSound:id=>audio.play(id)}),render=new Renderer(canvas,vram,pack.presentation),stopped=false,title=true,paused=false,error=null,raf=0,lastTime=0,acc=0,frames=0,totalMs=0,maxMs=0;
 const menu={screen:'title',cursor:0,notice:'',wins:3,seconds:180,stageIndex:0,stages};
 let loading=false;
 async function startStage(){
  if(loading)return;loading=true;menu.notice='LOADING';
  try{const stage=stages[menu.stageIndex];let nextBase=base,nextVram=vram,presentation=pack.presentation;
   if(stage.id){const values=await Promise.all([get(`stage-${stage.id}.ram`),get(`stage-${stage.id}.vram`),get(`stage-${stage.id}.json`)]);nextBase=values[0];nextVram=values[1];presentation={...JSON.parse(new TextDecoder().decode(values[2])),images:pack.presentation.images};}
   if(stopped)return;const nextWorld=new World(nextBase,{onSound:id=>audio.play(id),humans:world.humans,wins:menu.wins,seconds:menu.seconds});
   const nextRender=new Renderer(canvas,nextVram,presentation);await nextRender.ready;if(stopped)return;world=nextWorld;render=nextRender;title=false;paused=false;error=null;held.fill(0);latched.fill(0);lastTime=0;audio.start().catch(e=>console.warn('World audio:',e.message));
  }catch(e){menu.notice='STAGE LOAD FAILED';console.error('World stage:',e);}finally{loading=false;}
 }
 const held=[0,0],latched=[0,0],abort=new AbortController();
 function exit(){stop();onExit();}
 function down(p,bit){if(stopped)return;const old=held[p];held[p]|=bit;latched[p]|=bit;if(old&bit)return;
  if(p===0&&(held[0]&0x30000)===0x30000){exit();return;}
  if(p!==0)return;
  if(title){navigate(bit);latched.fill(0);}
  else if(bit===0x10000){
   if(world.matchComplete){title=true;menu.screen='players';menu.cursor=1;menu.notice='';audio.pause(true);held.fill(0);latched.fill(0);}
   else {paused=!paused;audio.pause(paused);}
  }
 }
 function navigate(bit){
  if(loading)return;menu.notice='';const step=bit===0x10||bit===0x80?-1:1,confirm=bit===0x10000||bit===0x2000;
  if(bit===0x4000){const parent={main:'title',mode:'main',battle:'mode',players:'battle',rules:'players',stages:'rules'};menu.screen=parent[menu.screen]||'title';menu.cursor=menu.screen==='mode'||menu.screen==='players'?1:0;return;}
  if(menu.screen==='title'){if(confirm){menu.screen='main';menu.cursor=0;}return;}
  if(menu.screen==='players'){
   if(bit===0x10||bit===0x40)menu.cursor=(menu.cursor+step+5)%5;
   if(bit===0x80||bit===0x20){if(menu.cursor===1)world.humans=world.humans===1?2:1;else menu.notice=menu.cursor===0?'PLAYER 1 IS ALWAYS HUMAN':'UP TO TWO HUMAN PLAYERS';}
   if(confirm){menu.screen='rules';menu.cursor=1;}return;
  }
  if(menu.screen==='rules'){
   if(bit===0x10||bit===0x40)menu.cursor=menu.cursor===1?2:1;
   if(bit===0x80||bit===0x20){if(menu.cursor===1){const values=[1,3,5];menu.wins=values[(values.indexOf(menu.wins)+step+3)%3];}else menu.seconds=((menu.seconds/60-1+step+5)%5+1)*60;}
   if(confirm){menu.screen='stages';menu.cursor=0;}return;
  }
  if(menu.screen==='stages'){
   if([0x10,0x20,0x40,0x80].includes(bit))menu.stageIndex=(menu.stageIndex+step+stages.length)%stages.length;
   if(confirm)startStage();return;
  }
  const count=menu.screen==='mode'?3:2;
  if(bit===0x10||bit===0x40)menu.cursor=(menu.cursor+step+count)%count;
  if(!confirm)return;
  if(menu.screen==='main'&&menu.cursor===0){menu.screen='mode';menu.cursor=1;}
  else if(menu.screen==='mode'&&menu.cursor===1){menu.screen='battle';menu.cursor=0;}
  else if(menu.screen==='battle'&&menu.cursor===0){menu.screen='players';menu.cursor=1;}
  else menu.notice='AVAILABLE IN THE ORIGINAL PS1 GAME';

 }
 function raw(s){if(stopped||typeof s!=='string'||!['j','q'].includes(s[0]))return;const p=s[0]==='q'?1:0;
  if(s[1]==='b'){const bit=({0:0x2000,1:0x4000,3:0x1000,4:0x8000,6:0x400,7:0x800,8:0x100,9:0x200,10:0x20000,11:0x10000})[s.charCodeAt(2)-97];if(bit){if(s[3]==='d')down(p,bit);else held[p]&=~bit;}return;}
  if(s[1]==='x'){held[p]&=~0xa0;if(s[2]==='l')down(p,0x80);if(s[2]==='r')down(p,0x20);}
  if(s[1]==='y'){held[p]&=~0x50;if(s[2]==='u')down(p,0x10);if(s[2]==='d')down(p,0x40);}
 }
 const keys={ArrowUp:[0,0x10],ArrowRight:[0,0x20],ArrowDown:[0,0x40],ArrowLeft:[0,0x80],Space:[0,0x2000],KeyZ:[0,0x2000],Enter:[0,0x10000],ShiftRight:[0,0x20000],KeyW:[1,0x10],KeyD:[1,0x20],KeyS:[1,0x40],KeyA:[1,0x80],KeyF:[1,0x2000]};
 for(const type of ['keydown','keyup'])window.addEventListener(type,e=>{if(e.code==='Escape'&&type==='keydown'){e.preventDefault();e.stopImmediatePropagation();exit();return;}const k=keys[e.code];if(!k)return;e.preventDefault();e.stopImmediatePropagation();if(type==='keydown'){if(!e.repeat)down(...k);}else held[k[0]]&=~k[1];},{capture:true,signal:abort.signal});
 canvas.addEventListener('click',()=>{if(title){down(0,0x10000);held[0]&=~0x10000;}else if(!paused)audio.start().catch(()=>{});canvas.focus();},{signal:abort.signal});
 window.addEventListener('blur',()=>{held.fill(0);latched.fill(0);if(!title){paused=true;audio.pause(true);}},{signal:abort.signal});
 document.addEventListener('visibilitychange',()=>{if(document.hidden){held.fill(0);latched.fill(0);if(!title){paused=true;audio.pause(true);}}lastTime=0;},{signal:abort.signal});
 function loop(t){if(stopped)return;try{const dt=lastTime?Math.min(80,t-lastTime):0;lastTime=t;if(!title&&!paused&&!error&&!document.hidden){acc+=dt;const start=performance.now();while(acc>=1000/60){world.tick(held.map((v,i)=>(v|latched[i])&0xffff));latched.fill(0);acc-=1000/60;}const ms=performance.now()-start;totalMs+=ms;maxMs=Math.max(maxMs,ms);frames++;}else acc=0;render.draw(world,{title,menu,paused,error});}catch(e){error=e;console.error('World stopped:',e);}raf=requestAnimationFrame(loop);}
 function stop(){if(stopped)return;stopped=true;cancelAnimationFrame(raf);abort.abort();audio.stop();held.fill(0);latched.fill(0);root.remove();}
 await render.ready;render.draw(world,{title,menu});raf=requestAnimationFrame(loop);canvas.focus();
 const ctl={raw,stop,suspend(){held.fill(0);latched.fill(0);if(!title){paused=true;audio.pause(true);}}};if(debug)Object.defineProperties(ctl,{world:{get:()=>world},state:{get:()=>({title,menu:{...menu},paused,stopped,error:error?.message,frames,averageMs:totalMs/frames,maxMs})},renderer:{get:()=>render},audio:{get:()=>audio}});return ctl;
}
