import {projectPortrait,PORTRAIT_SHEAR} from './geometry.js';
import {PLAYER,BOMB,EFFECT,STAGE_OBJECT,inside,ARENA_ROWS} from './engine.js';
const shearDelta=.5-PORTRAIT_SHEAR;
export class Renderer {
 constructor(canvas,vram,presentation) {this.canvas=canvas;this.ctx=canvas.getContext('2d',{alpha:false});this.vram=new Uint16Array(vram.buffer,vram.byteOffset,vram.byteLength/2);this.cache=new Map();canvas.width=320;canvas.height=568;this.presentation=presentation;this.stage=presentation.stage||0;if(this.stage){canvas.width=360;canvas.height=640;}canvas.style.aspectRatio=canvas.width+'/'+canvas.height;this.floorTiles=[];this.buildFloor();this.buildScene();this.images={};this.ready=Promise.all(Object.entries(presentation.images).map(([name,src])=>new Promise((resolve,reject)=>{const im=this.images[name]=new Image();im.onload=resolve;im.onerror=()=>reject(Error('Missing original menu artwork'));im.src=src;}))); }
 texture(tp,clut,u,v,w,h,red=128,green=128,blue=128,semi=false) {
  const key=[tp,clut,u,v,w,h,red,green,blue,semi].join(',');if(this.cache.has(key))return this.cache.get(key);
  const canvas=document.createElement('canvas');canvas.width=w;canvas.height=h;const ctx=canvas.getContext('2d'),im=ctx.createImageData(w,h),d=im.data,vr=this.vram;
  const depth=(tp>>>7)&3,tx=(tp&15)*64,ty=((tp>>>4)&1)*256,cx=(clut&63)*16,cy=(clut>>>6)&511;
  for(let y=0;y<h;y++)for(let x=0;x<w;x++){
   const sx=(u+x)&255,sy=(v+y)&255;let value;
   if(depth===0){const bits=vr[((ty+sy)&511)*1024+((tx+(sx>>>2))&1023)];value=vr[cy*1024+((cx+((bits>>>((sx&3)*4))&15))&1023)];}
   else if(depth===1){const bits=vr[((ty+sy)&511)*1024+((tx+(sx>>>1))&1023)];value=vr[cy*1024+((cx+((bits>>>((sx&1)*8))&255))&1023)];}
   else value=vr[((ty+sy)&511)*1024+((tx+sx)&1023)];
   if(!value)continue;const o=(y*w+x)*4;d[o]=Math.min(31,((value&31)*red)>>7)*255/31;d[o+1]=Math.min(31,(((value>>>5)&31)*green)>>7)*255/31;d[o+2]=Math.min(31,(((value>>>10)&31)*blue)>>7)*255/31;d[o+3]=semi&&(value&0x8000)&&((tp>>>5)&3)===0?128:255;
  }
  ctx.putImageData(im,0,0);this.cache.set(key,canvas);return canvas;
 }
 // Shallower portrait ground projection; height and character sprites stay upright.
 xy(wx,wy){const [x,y]=projectPortrait(wx,wy);return this.stage?[x-4,y+32]:[x,y];}
 buildFloor(){
  if(this.stage){this.buildStageFloor();return;}
  const bg=document.createElement('canvas');bg.width=352;bg.height=300;const ctx=bg.getContext('2d');
  for(const p of this.presentation.background)ctx.drawImage(this.texture(p.tpage,p.clut,p.u,p.v,p.width,p.height),p.x,p.y-240);
  const wall=(x,y)=>{const image=document.createElement('canvas');image.width=32;image.height=32;const c=image.getContext('2d');c.drawImage(bg,x,y,32,32,0,0,32,32);
   // The wall is baked into the stage backdrop. Remove its surrounding blue
   // sky/green floor rather than carrying those pixels onto the other edges.
   const pixels=c.getImageData(0,0,32,32);for(let i=0;i<pixels.data.length;i+=4){const d=pixels.data;if(Math.max(d[i],d[i+1],d[i+2])-Math.min(d[i],d[i+1],d[i+2])>24)d[i+3]=0;}c.putImageData(pixels,0,0);
   c.globalCompositeOperation='destination-in';c.drawImage(this.texture(5,30800,0,0,32,32),0,0);return this.solid(image,this.texture(5,30800,0,0,32,32));};
  this.topWall=wall(114,20);this.leftWall=wall(30,68);
  this.pillar=this.solid(this.texture(5,30800,0,0,32,32));this.soft=this.solid(this.texture(5,30864,32,0,32,32));
  // Extract complete projected cells, including both phases of the original
  // 40x32 floor pattern. Square atlas fragments cannot tile this projection.
  for(let row=0;row<2;row++)for(let col=0;col<2;col++){
   const r=22+row,c=6+col,x=20*c-8*r+176,y=16*r-212;
   const tile=document.createElement('canvas');tile.width=28;tile.height=16;
   const t=tile.getContext('2d');t.drawImage(bg,x-14,y-8,28,16,0,0,28,16);
   const im=t.getImageData(0,0,28,16);
   for(let yy=0;yy<16;yy++)for(let xx=0;xx<28;xx++)if(xx<8-Math.floor(yy/2)||xx>=28-Math.floor(yy/2))im.data[(yy*28+xx)*4+3]=0;
   t.putImageData(im,0,0);
   const projected=document.createElement('canvas');projected.width=32;projected.height=16;const pc=projected.getContext('2d');pc.imageSmoothingEnabled=false;pc.setTransform(1,0,shearDelta,1,-8*shearDelta,0);pc.drawImage(tile,0,0);this.floorTiles[row*2+col]=projected;
  }
 }
 solid(source,rightSource=source){
  const result=document.createElement('canvas');result.width=32;result.height=32;
  const c=result.getContext('2d');c.imageSmoothingEnabled=false;
  // Three planes: transform only their ground axes. Height remains vertical.
  const plane=(matrix,points,texture=source)=>{c.save();c.setTransform(...matrix);c.beginPath();points.forEach(([x,y],i)=>i?c.lineTo(x,y):c.moveTo(x,y));c.closePath();c.clip();c.drawImage(texture,0,0);c.restore();};
  plane([1,0,shearDelta,1,-8*shearDelta,0],[[0,16],[8,0],[28,0],[20,16]]);
  plane([1,0,0,1,8*shearDelta,0],[[0,16],[20,16],[20,32],[0,32]]);
  plane([2*PORTRAIT_SHEAR,0,0,1,24*(1-2*PORTRAIT_SHEAR),0],[[20,16],[28,0],[28,16],[20,32]],rightSource);
  return result;
 }
 buildScene(){
  if(this.stage)return;
  this.ground=document.createElement('canvas');this.ground.width=320;this.ground.height=568;
  const c=this.ground.getContext('2d'),sky=c.createLinearGradient(0,0,0,568);sky.addColorStop(0,'#0000c6');sky.addColorStop(1,'#000019');c.fillStyle=sky;c.fillRect(0,0,320,568);
  this.rows=[];
  for(let r=0;r<=ARENA_ROWS+1;r++){
   const tiles=[],y=this.xy(0,r*256+128)[1],image=document.createElement('canvas');image.width=320;image.height=32;
   for(let col=1;col<=13;col++){
    const playable=inside(r,col),border=!playable;
    const [x]=this.xy(col*320+160,r*256+128);
    if(playable)c.drawImage(this.floorTiles[(r&1)*2+(col&1)],x-14,y-8);
    tiles.push({col,x,border});
   }
   this.rows.push({r,y,tiles,image,ctx:image.getContext('2d'),signature:null,draw:()=>this.ctx.drawImage(image,0,y-24)});
  }

 }
 buildStageFloor(){
  const bg=document.createElement('canvas');bg.width=352;bg.height=300;const ctx=bg.getContext('2d');
  for(const p of this.presentation.background)ctx.drawImage(this.texture(p.tpage,p.clut,p.u,p.v,p.width,p.height),p.x,p.y);
  this.stageFloor=[];
  for(let r=17;r<=27;r++)for(let col=2;col<=14;col++){
   const x=20*col-8*r+176,y=16*r-212;
   const tile=document.createElement('canvas');tile.width=28;tile.height=16;const t=tile.getContext('2d');t.drawImage(bg,x-14,y-8,28,16,0,0,28,16);
   const im=t.getImageData(0,0,28,16);for(let yy=0;yy<16;yy++)for(let xx=0;xx<28;xx++)if(xx<8-Math.floor(yy/2)||xx>=28-Math.floor(yy/2))im.data[(yy*28+xx)*4+3]=0;t.putImageData(im,0,0);
   const projected=document.createElement('canvas');projected.width=32;projected.height=16;const pc=projected.getContext('2d');pc.imageSmoothingEnabled=false;pc.setTransform(1,0,shearDelta,1,-8*shearDelta,0);pc.drawImage(tile,0,0);this.stageFloor[(r-17)*13+col-2]=projected;
  }
  this.ground=document.createElement('canvas');this.ground.width=360;this.ground.height=640;const c=this.ground.getContext('2d');c.fillStyle='#080916';c.fillRect(0,0,360,640);
  for(let r=1;r<=ARENA_ROWS;r++)for(let col=2;col<=14;col++){
   const sourceRow=r>=17?r:19+(r%6),[x,y]=this.xy(col*320+160,r*256+128);
   c.drawImage(this.stageFloor[(sourceRow-17)*13+col-2],x-14,y-8);
  }
  this.stageTiles={};for(const [name,pieces] of Object.entries(this.presentation.terrain)){
   const tile=document.createElement('canvas');tile.width=48;tile.height=64;const ctx=tile.getContext('2d');
   for(const p of pieces)ctx.drawImage(this.texture(p.tpage,p.clut,p.u,p.v,p.width,p.height),24+p.dx+p.sx,32+p.dy+p.sy);
   if([3,5,6].includes(this.stage)&&name.startsWith('pillar')&&pieces.length===1&&pieces[0].width===32&&pieces[0].height===32){
    const p=pieces[0];ctx.clearRect(0,0,48,64);ctx.drawImage(this.solid(this.texture(p.tpage,p.clut,p.u,p.v,32,32)),16,16);
   }
   this.stageTiles[name]=tile;
  }
  this.rows=[];
 }
 stageTerrain(world){
  const draws=[];
  for(let r=0;r<=ARENA_ROWS+1;r++)for(let col=1;col<=15;col++)for(let layer=0;layer<2;layer++){
   const border=!world.inside(r,col);if(border&&layer)continue;
   const value=world.cell(r,col,layer),type=value&127;
   const name=border?'pillar':type===0x76?'pillar':type===0x7e?'pillar2':type>=0x60&&type<=0x75?'soft':null;
   if(!name)continue;let [x,y]=this.xy(col*320,r*256);const height=layer*48;[x,y]=this.layerXY(world.m,x,y,layer);
   draws.push({y:y+8+layer*10000,draw:()=>this.ctx.drawImage(this.stageTiles[name],Math.round(x+3.2)-24,y-32-height)});
  }
  return draws;
 }
 terrain(world){
  for(const row of this.rows){
   const types=row.tiles.map(t=>{const type=world.cell(row.r,t.col)&127;return t.border?(row.r===0||row.r===ARENA_ROWS+1?3:4):type===0x76||type===0x7f?1:type>=0x60&&type<=0x75?2:0;});
   const signature=types.join('');if(row.signature===signature)continue;row.signature=signature;
   row.ctx.clearRect(0,0,320,32);
   row.tiles.forEach((tile,i)=>{const kind=types[i];if(kind)row.ctx.drawImage([null,this.pillar,this.soft,this.topWall,this.leftWall][kind],tile.x-14,0);});
  }
 }
 text(text,x,y){
  for(const char of text.toUpperCase()){
   const n=char.charCodeAt(0)-65;
   if(n>=0&&n<26)this.ctx.drawImage(this.images.font,(n%12)*16,Math.floor(n/12)*16,16,16,x,y,16,16);
   else if(/\d/.test(char))this.digits(char,x+4,y);
   x+=16;
  }
 }
 centered(text,y){this.text(text,Math.round((320-text.length*16)/2),y);}
 digits(text,x,y){
  for(const char of String(text)){
   if(char===':')this.ctx.drawImage(this.texture(30,31186,200,128,8,16),x,y);
   else if(/\d/.test(char))this.ctx.drawImage(this.texture(30,31186,char==='0'?232:152+Number(char)*8,0,8,16),x,y);
   x+=8;
  }
 }
 hud(world){
  const c=this.ctx,sec=Math.max(0,world.seconds-Math.floor(world.frame/60));
  c.drawImage(this.texture(30,31506,0,216,16,16),24,17);
  this.digits(`${Math.floor(sec/60)}:${String(sec%60).padStart(2,'0')}`,40,17);
  for(let i=0;i<5;i++){
   c.save();if(!world.alive(i))c.globalAlpha=.35;
   c.drawImage(this.texture(94,30739+i*64,0,i*16,16,16),88+i*40,17);c.restore();
   this.digits(world.scores[i],108+i*40,17);
  }
 }
 layerXY(m,x,y,layer){
  if(!layer||layer>=2)return [x,y];const s16=a=>m.u16(a)<<16>>16,base=0x8008b464,other=base+80*layer;
  return [x+s16(base)-s16(other),y+s16(base+2)-s16(other+2)];
 }
 sprite(m,p,stageObject=false) {
  if(!m.u8(p+0x18))return;
  const primitive=m.u32(p+0x10),seq=m.u32(p+8);if(!primitive||!seq)return;
  const n=m.u32(primitive);if(n>40)throw Error('Invalid World sprite descriptor');
  let [x,y]=this.xy(m.u16(p+0x4c),m.u16(p+0x4e));[x,y]=this.layerXY(m,x,y,m.u16(p+0x56));const s16=a=>m.u16(a)<<16>>16;
  // Original sprite pieces enter a prepend ordering table. Back pieces
  // therefore draw first; forward order hid item icons behind their frames.
  for(let i=n-1;i>=0;i--){
   const a=primitive+4+i*20,u=m.u8(a),v=m.u8(a+1),dx=m.u8(a+2)<<24>>24,dy=m.u8(a+3)<<24>>24;
   const clut=m.u16(a+4),tp=m.u16(a+6),w=m.u16(a+8),h=m.u16(a+10);if(!w||!h||w>256||h>256)continue;
   const img=this.texture(tp,clut,u,v,w,h,m.u8(p+0x1e),m.u8(p+0x1f),m.u8(p+0x20),Boolean(clut&0x8000));
   this.ctx.drawImage(img,Math.round(x+dx+s16(seq+4)+s16(p+0x5e)/16),Math.round(y+dy+s16(seq+6)+(s16(p+0x60)-s16(p+0x50))/16));
  }
 }
 menu(state,world){
  const c=this.ctx,im=this.images,{screen,cursor,notice}=state;
  if(this.stage){c.save();c.scale(360/320,640/568);}
  if(screen==='stages'){
   const selected=state.stages[state.stageIndex],preview=im['stagePreview'+selected.id];
   const sky=c.createLinearGradient(0,0,0,568);sky.addColorStop(0,'#0099ff');sky.addColorStop(.45,'#0099ff');sky.addColorStop(.7,'#07531a');sky.addColorStop(1,'#003707');c.fillStyle=sky;c.fillRect(0,0,320,568);
   if(preview){
    // Keep the island, stage number and name as one coherent original scene.
    // Only the parchment heading is reflowed, with no stray background strips.
    c.drawImage(preview,16,7,288,44,16,34,288,44);
    c.drawImage(preview,0,55,320,185,-40,160,400,231.25);
    const fade=c.createLinearGradient(0,379,0,393);fade.addColorStop(0,'rgba(7,83,26,0)');fade.addColorStop(1,'#07531a');c.fillStyle=fade;c.fillRect(0,379,320,14);
   }
   this.menuText('LEFT   RIGHT',87,486);this.menuText('PRESS START',91,520);
   if(notice){c.font='10px monospace';c.textAlign='center';c.fillStyle='#eee';c.fillText(notice,160,548);}
   if(this.stage)c.restore();return;
  }
  // Fill the portrait canvas. Reflow original layers instead of stretching
  // the original 4:3 framebuffer (which would elongate faces and lettering).
  if(['title','main','mode'].includes(screen)){
   const bg=c.createLinearGradient(0,0,0,568);bg.addColorStop(0,'#10113c');bg.addColorStop(.65,'#080825');bg.addColorStop(1,'#000010');c.fillStyle=bg;c.fillRect(0,0,320,568);
   c.save();if(screen!=='title')c.globalAlpha=.6;c.drawImage(im.portraitTitle,-16,64,352,264);c.restore();
   const fade=c.createLinearGradient(0,304,0,350);fade.addColorStop(0,'rgba(8,8,37,0)');fade.addColorStop(1,'#080825');c.fillStyle=fade;c.fillRect(0,304,320,46);
   c.drawImage(im.portraitCopyright,0,532);
   if(screen==='title')this.menuText('PRESS START BUTTON',56,430,48);
   else if(screen==='main'){
    ['GAME MODE','OPTION'].forEach((s,i)=>this.menuText(s,90,400+i*50,cursor===i?96:0));c.drawImage(im.menuHead,62,400+cursor*50);
   }else{
    ['NORMAL GAME','BATTLE GAME','CHALLENGE GAME'].forEach((s,i)=>this.menuText(s,66,380+i*50,cursor===i?96:0));c.drawImage(im.menuHead,38,380+cursor*50);
   }
  }else{
   // Nine-slice the blank parchment only. Text, cursor, icons and character art
   // are separately extracted original pixels with their original proportions.
   const paper=im.portraitPaper;
   c.drawImage(paper,0,0,1,240,0,0,320,568);
   c.drawImage(paper,0,0,320,56,0,22,320,56);
   c.drawImage(paper,0,56,320,24,0,100,320,24);
   c.drawImage(paper,0,80,320,128,0,124,320,386);
   c.drawImage(paper,0,208,320,32,0,510,320,32);
   c.drawImage(im['portrait'+({battle:'Battle',players:'Players',rules:'Rules'}[screen])+'Heading'],0,22);
   if(screen==='battle'){
    for(let i=0;i<2;i++)c.drawImage(im['portraitBattle'+i],0,250+i*90);
    c.drawImage(im.menuFeather,48,248+cursor*90);
   }else if(screen==='players'){
    for(let i=0;i<5;i++){c.drawImage(im['portraitPlayer'+i],0,170+i*68);c.drawImage(i<world.humans?im.menuMan:im.menuCom,236,170+i*68);}
    c.drawImage(im.menuFeather,48,168+cursor*68);
   }else if(screen==='rules'){
    for(let i=0;i<6;i++)c.drawImage(im['portraitRule'+i],0,170+i*55);
    c.drawImage(im.menuFeather,40,168+cursor*55);
    this.menuNumber(String(state.wins),276,225,im.menuNumbersGreen);
    this.menuNumber(`${state.seconds/60}:00`,244,280,im.menuNumbersRed);
   }
  }
  if(notice){c.font='9px monospace';c.textAlign='center';c.fillStyle=screen==='players'?'#151007':'#eee';c.fillText(notice,160,517);}
  if(this.stage)c.restore();
 }
 menuText(text,x,y,tint=0){
  // Original proportional title alphabet; highlighted and pink rows are on-disc.
  const widths={I:7,J:10,L:12,M:13,N:12,O:12,R:12,S:11,T:12};
  for(const ch of text){if(ch===' '){x+=12;continue;}const n=ch.charCodeAt(0)-65;if(n<0||n>25)continue;
   this.ctx.drawImage(this.images.menuAlphabet,64+(n%12)*16,Math.floor(n/12)*16+tint,16,16,x,y,16,16);x+=widths[ch]||12;
  }
 }
 menuNumber(text,x,y,image){for(const ch of text){const u=ch===':'?160:ch==='0'?144:(Number(ch)-1)*16;this.ctx.drawImage(image,u,0,16,16,x,y,16,16);x+=ch===':'?12:12;}}
 draw(world,{title=false,menu=null,paused=false,error=null}={}) {
  const c=this.ctx,m=world.m;c.imageSmoothingEnabled=false;
  if(title){this.menu(menu,world);return;}
  c.drawImage(this.ground,0,0);if(!this.stage)this.terrain(world);
  const draws=this.stage?this.stageTerrain(world):[...this.rows];
  for(const [base,count,stride] of [[PLAYER,5,0xdc],[BOMB,40,0x7c],[EFFECT,130,0x70],[STAGE_OBJECT,50,0xb4]])for(let i=0;i<count;i++){
   const p=base+i*stride;if(m.u16(p+0x56)===10)continue;
   // Original scenery beyond the old perimeter belongs to that backdrop. It
   // must not float across the extended floor or protrude through new walls.
   if(base===STAGE_OBJECT&&m.u8(p+0x6e)===14&&(m.u16(p+0x52)<2||m.u16(p+0x52)>14||m.u16(p+0x54)<17||m.u16(p+0x54)>27))continue;const y=m.u16(p+0x4e);const layer=m.u16(p+0x56),platform=base===STAGE_OBJECT&&m.u8(p+0x6e)===132;draws.push({y:platform?9000:this.xy(0,y)[1]+layer*10000+0.1,draw:()=>this.sprite(m,p,base===STAGE_OBJECT)});
  }
  draws.sort((a,b)=>a.y-b.y);for(const d of draws)d.draw();
  if(this.stage){c.save();c.translate(20,12);}this.hud(world);if(this.stage)c.restore();
  if(paused||world.result||error){
   c.save();c.translate((this.canvas.width-320)/2,(this.canvas.height-568)/2);
   c.fillStyle='rgba(0,0,22,.9)';c.fillRect(16,220,288,118);
   const label=error?'GAME STOPPED':paused?'PAUSE':world.result.winner===null?'DRAW':`${world.result.winner<world.humans?'PLAYER':'CPU'} ${world.result.winner+1} WINS`;
   this.centered(label,253);this.centered(error?'RETURN TO ARCADE':paused||world.matchComplete?'PRESS START':'NEXT ROUND',296);c.restore();
  }
 }
}
