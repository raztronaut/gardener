import fs from 'node:fs';import assert from 'node:assert/strict';import {World,PLAYER,BOMB} from './engine.mjs';
const base=fs.readFileSync('data/bw/gpu/frame.ram');let sounds=[];const w=new World(base,{onSound:(id)=>sounds.push(id)});
const m=w.m,x=m.u16(PLAYER+0x4c);for(let i=0;i<15;i++)w.tick([0x20]);assert(m.u16(PLAYER+0x4c)>x,'P1 moves');
w.tick([0x2000]);assert(Array.from({length:40},(_,i)=>m.u16(BOMB+i*0x7c+0x56)).some(x=>x!==10),'P1 places bomb');
const start=performance.now();for(let i=0;i<3000;i++)w.tick([i%240<60?0x40:i%240<120?0x20:i%240<180?0x10:0x80]);
console.log('3000 tall ticks in',Math.round(performance.now()-start),'ms','round',w.round,'sounds', [...new Set(sounds)]);fs.writeFileSync('data/bw/tall-probe.ram',w.m.bytes);
