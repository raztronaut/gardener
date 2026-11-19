import fs from 'node:fs';import assert from 'node:assert/strict';import {World,PLAYER,BOMB} from '../../public/arcade/bw/engine.js';
const w=new World(fs.readFileSync('data/bw/pack/battle.ram'));
const owners=new Set(),sounds=new Set();w.onSound=id=>sounds.add(id);w.reset();let ticks=0;const started=performance.now(),first=w.round;
while(w.round===first&&ticks<11200){w.tick([0]);for(let i=0;i<40;i++){const p=BOMB+i*124;if(w.m.u16(p+0x56)!==10)owners.add(w.m.u8(p+0x73));}ticks++;}
assert(w.round>first,'Full match reaches a result and starts a fresh round');for(let i=1;i<5;i++)assert(owners.has(i),`CPU ${i} places bombs`);
assert([0,1,2,3,4].every(i=>w.alive(i)),'All characters alive on fresh round');assert.equal(w.frame,0);assert.equal(w.cell(0,2),0x7f7f);assert.equal(w.cell(29,12),0x7f7f);
const report={ticks,elapsedMs:Math.round(performance.now()-started),cpuBombOwners:[...owners].sort(),sounds:[...sounds].sort(),round:w.round};fs.writeFileSync('data/bw/match-verification.json',JSON.stringify(report,null,2)+'\n');console.log(report);
