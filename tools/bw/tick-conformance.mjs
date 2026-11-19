import fs from 'node:fs';import assert from 'node:assert/strict';import {Mips} from './mips.mjs';import {installHost} from './host.mjs';
const root='data/bw/conformance/ticks/',spec=JSON.parse(fs.readFileSync(root+'case.json')),m=new Mips(Uint8Array.from(fs.readFileSync(root+'baseline.ram')));installHost(m);
for(let f=0;f<spec.frames;f++){
 const held=f<60?0x20:f===60?0x2000:f<130?0x80:0;m.w16(0x800d9300,held);m.w16(0x800d92d8,f===60?0x2000:0);
 for(const pc of spec.functions)m.call(pc);
 const expected=fs.readFileSync(root+String(f).padStart(4,'0')+'.bin');let index=0,diffs=[];
 for(const [lo,hi] of spec.ranges)for(let i=lo;i<hi;i++,index++)if(m.bytes[i]!==expected[index])diffs.push([i.toString(16),m.bytes[i],expected[index]]);
 if(diffs.length){console.log('frame',f,'diffs',diffs.length,diffs.slice(0,30));process.exit(1);}
}console.log(`${spec.frames} complete battle ticks match original machine RAM`);
