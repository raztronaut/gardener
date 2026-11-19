import fs from 'node:fs';import {Mips} from './mips.mjs';
const m=new Mips(Uint8Array.from(fs.readFileSync('data/bw/gpu/frame.ram')));
m.hooks.set(0x80014a78,()=>0);
m.hooks.set(0xa0,c=>{if(c.r[9]===0x28){c.bytes.fill(0,c.addr(c.r[4]),c.addr(c.r[4])+c.r[5]);return 0;}if(c.r[9]===0x2f)return (Math.random()*32768)|0;throw Error(`BIOS ${c.r[9].toString(16)} args ${[...c.r.slice(4,8)].map(x=>(x>>>0).toString(16))} ra ${(c.r[31]>>>0).toString(16)}`)});
const funcs=[0x8001be0c,0x80021ec4,0x800e68ec,0x800ecad0,0x800252f0,0x80023efc,0x800e95f4,0x8001be3c];
for(let f=0;f<300;f++){
 m.w16(0x800d9300,f<60?0x20:0x2000);m.w16(0x800d92d8,f===60?0x2000:0);
 for(const pc of funcs){try{m.call(pc);if(f===0)console.log(pc.toString(16),m.count);}catch(e){console.log('frame',f,'routine',pc.toString(16));throw e;}}
}
fs.writeFileSync('data/bw/tick-probe.ram',m.bytes);console.log('300 ticks',Array.from({length:5},(_,i)=>{const p=0x800cda98+i*0xdc;return [m.u16(p+0x4c),m.u16(p+0x4e),m.u16(p+0x56),m.u32(p+0x68).toString(16),m.u16(p+0xae),m.u8(p+0xd4)]}));
