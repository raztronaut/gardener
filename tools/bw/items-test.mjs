import fs from 'node:fs';import assert from 'node:assert/strict';import {createHash} from 'node:crypto';import {pathToFileURL} from 'node:url';
const runtime=process.env.BW_TEST_RUNTIME||'public/arcade/bw';const {World,PLAYER,BOMB}=await import(pathToFileURL(process.cwd()+'/'+runtime+'/engine.js'));const {Mips}=await import(pathToFileURL(process.cwd()+'/'+runtime+'/mips.js'));const {installHost}=await import(pathToFileURL(process.cwd()+'/'+runtime+'/host.js'));
const spec=JSON.parse(fs.readFileSync('data/bw/conformance/items/cases.json'));let frames=0;
for(const entry of spec.cases){const m=new Mips(fs.readFileSync(`data/bw/conformance/items/${entry.name}.ram`));installHost(m,()=>{});
 for(let f=0;f<spec.frames;f++){if(f===90)for(const [off,value] of [[0x4c,1120],[0x4e,384],[0x52,3],[0x54,1]])m.w16(PLAYER+off,value);for(const pc of spec.funcs)m.call(pc);const h=createHash('sha256');for(const [lo,hi] of spec.ranges)h.update(m.bytes.subarray(lo,hi));assert.equal(h.digest('hex'),entry.hashes[f],`item ${entry.name}, frame ${f}`);frames++;}}
const base=fs.readFileSync('data/bw/pack/battle.ram');const w=new World(base),m=w.m;
for(let i=0;i<5;i++){assert.equal(m.u16(PLAYER+i*220+0x8e),1);assert.equal(m.u8(PLAYER+i*220+0xda),2);m.w8(PLAYER+i*220+0xd2,0);m.w8(0x80078c7c+i,0);}
assert(w.crateContents.some(v=>v>0x3e60));assert([...Array(27)].some((_,r)=>[...Array(11)].some((_,c)=>w.cell(r+1,c+2)>0x3e60&&w.cell(r+1,c+2)<=0x3e75)));
w.tick([0x2000]);w.tick([0]);m.w16(PLAYER+0x4c,1120);m.w16(PLAYER+0x52,3);w.tick([0x2000]);assert.equal([...Array(40)].filter((_,i)=>m.u16(BOMB+i*124+0x56)!==10).length,1,'Cannot place a second bomb before capacity pickup');
console.log(`${frames} original-machine item ticks, item-bearing layout, one starting bomb and capacity enforcement: PASS`);
