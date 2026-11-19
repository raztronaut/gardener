import fs from 'node:fs';
import assert from 'node:assert/strict';
import {Mips} from './mips.mjs';
const root=new URL('../../data/bw/conformance/movement/',import.meta.url);
const base=fs.readFileSync(new URL('baseline.ram',root));
const pcs={canEnter:0x8001c120,updateCell:0x8001c0a4,centerErrorX:0x8001bd10,centerErrorY:0x8001bd44,contact:0x8001c268,bombContact:0x8001c4bc,playerContact:0x8001c61c,resolveUp:0x8001c738,resolveDown:0x8001c8f8,resolveLeft:0x8001cab8,resolveRight:0x8001cc68,alignX:0x8001ea1c,alignY:0x8001ebd0,chooseAxis:0x8001ed7c,move:0x8001eef8,tickBombFuse:0x80024f98};
const {cases,observed_range:[lo,hi]}=JSON.parse(fs.readFileSync(new URL('cases.json',root)));
const m=new Mips(Uint8Array.from(base));let count=0;
for(const c of cases) {
 m.bytes.set(base);for(const [a,s,v] of c.patches)m[`w${s*8}`](a,v);
 const before=m.bytes.slice(lo,hi),ret=m.call(pcs[c.name],c.args);
 if(c.result!==null)assert.equal(ret,c.result,`${count} ${c.name}`);
 const writes=[];for(let i=lo;i<hi;i++)if(m.bytes[i]!==before[i-lo])writes.push([i,m.bytes[i]]);
 assert.deepEqual(writes,c.writes,`${count} ${c.name} RAM`);count++;
}
console.log(`${count} original-binary routine cases passed by JS runner`);
