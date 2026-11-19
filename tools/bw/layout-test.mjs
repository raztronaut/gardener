import fs from 'node:fs';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const runtime=process.env.BW_TEST_RUNTIME||'public/arcade/bw';
const {World,PLAYER,inside,ARENA_ROWS}=await import(pathToFileURL(process.cwd()+'/'+runtime+'/engine.js'));
const base=fs.readFileSync('data/bw/pack/battle.ram');
for(let seed=680;seed<780;seed++){
 const w=new World(base,{seed});
 for(let r=0;r<=ARENA_ROWS+1;r++)for(let c=1;c<=13;c++){
  if(!inside(r,c))assert.equal(w.cell(r,c),0x7f7f,'Closed solid boundary');
  else if(r%2===0&&c%2===1)assert.equal(w.cell(r,c),0x7f76,'Spawn creation must not remove permanent pillars');
 }
 for(let i=0;i<5;i++){
  const p=PLAYER+i*220,root=[w.m.u16(p+0x54),w.m.u16(p+0x52)],seen=new Set(),queue=[root];
  while(queue.length){const [r,c]=queue.shift(),key=r+','+c;if(seen.has(key)||!inside(r,c)||w.cell(r,c)!==0x4001)continue;seen.add(key);for(const [dr,dc] of [[1,0],[-1,0],[0,1],[0,-1]])queue.push([r+dr,c+dc]);}
  assert.equal(seen.size,3,`Seed ${seed}: player ${i+1} has exactly three connected starting cells, not an open corridor`);
 }
 for(let r=1;r<=5;r++)for(let c=2;c<=6;c++){
  assert.equal(w.cell(r,c),w.cell(r,14-c),'Left/right corner layouts match');
  assert.equal(w.cell(r,c),w.cell(ARENA_ROWS+1-r,c),'Top/bottom corner layouts match');
 }
}
console.log('100 starting boards: five bounded three-cell pockets, matching corners, intact pillars and all four solid boundaries: PASS');
