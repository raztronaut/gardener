import fs from 'node:fs';
import assert from 'node:assert/strict';
import {Mips} from '../../public/arcade/bw/mips.js';
import {projectWorld,projectPortrait} from '../../public/arcade/bw/geometry.js';
import {World,inside,PLAYER,ARENA_ROWS} from '../../public/arcade/bw/engine.js';

const base=fs.readFileSync('data/bw/pack/battle.ram'),m=new Mips(Uint8Array.from(base)),p=0x801f0000;
let n=0;
for(const [cx,cy] of [[180,220],[184,-40]])for(let row=0;row<30;row++)for(let col=0;col<26;col++)for(const sub of [0,7,127,255]){
  const x=col*320+sub,y=row*256+sub;
  m.w16(p,x);m.w16(p+2,y);m.w16(p+10,0);m.w16(0x8008b464,cx);m.w16(0x8008b466,cy);
  const original=[m.call(0x80017908,[p])<<16>>16,m.call(0x800178d0,[p])<<16>>16];
  assert.deepEqual(projectWorld(x,y,cx,cy),original);n++;
}
const world=new World(base);
for(let i=0;i<5;i++){
  const p=PLAYER+i*0xdc;
  assert(inside(world.m.u16(p+0x54),world.m.u16(p+0x52)),`Player ${i} spawn inside`);
}
for(let row=0;row<30;row++)for(let col=0;col<26;col++){
  const playable=inside(row,col),border=!playable&&[-1,0,1].some(dr=>[-1,0,1].some(dc=>inside(row+dr,col+dc)));
  if(!playable&&!border)continue;
  const [x,y]=projectPortrait(col*320+160,row*256+128);
  assert(x-14>=0&&x+12<=320&&y-24>=0&&y+8<=568,'No clipped ground or block at portrait edges');
  if(border)assert.equal(world.cell(row,col),0x7f7f,'Arena boundary must be solid');
}
for(let r=1;r<=ARENA_ROWS;r++){
  const cells=Array.from({length:64},(_,c)=>c).filter(c=>inside(r,c));
  assert.deepEqual(cells,Array.from({length:11},(_,c)=>c+2),'Each row has the same continuous boundaries');
  if(r>1)assert(Math.abs(projectPortrait(2*320,r*256)[0]-projectPortrait(2*320,(r-1)*256)[0])<=2,'No stepped camera jumps');
}
console.log(`PASS ${n} projection coordinates match original binary; portrait spawns, solid boundaries and artwork fit`);
