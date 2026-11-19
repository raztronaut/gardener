// Generate private item test inputs. Run items-oracle.py to verify them independently.
import fs from 'node:fs';import {createHash} from 'node:crypto';import {World,PLAYER,BOMB,EFFECT} from './engine.mjs';
const base=fs.readFileSync('data/bw/pack/battle.ram'),out='data/bw/conformance/items/';fs.mkdirSync(out,{recursive:true});const cases=[],ranges=[[0xcad80,0xd3a28],[0xf8e00,0xf9000],[0x9010,0x9014]],funcs=[0x8001be0c,0x80021ec4,0x800e68ec,0x800ecad0,0x800252f0,0x80023efc,0x800e95f4,0x8001be3c];
for(let kind=0x60;kind<=0x75;kind++){
 const sounds=[],w=new World(base,{onSound:id=>sounds.push(id)}),m=w.m;for(let i=0;i<5;i++){m.w8(PLAYER+i*220+0xd2,0);m.w8(0x80078c7c+i,0);m.w16(0x800d9300+i*2,0);m.w16(0x800d92d8+i*2,0);}w.setCell(1,3,0x3e00|kind);w.tick([0x2000]);const bomb=Array.from({length:40},(_,i)=>BOMB+i*124).find(p=>m.u16(p+0x56)!==10);m.w16(bomb+0x6c,1);
 const move=(c,r)=>{for(const [a,v] of [[0x4c,c*320+160],[0x4e,r*256+128],[0x52,c],[0x54,r]])m.w16(PLAYER+a,v);};move(6,11);w.setCell(11,6,0x4001);m.w16(0x800d9300,0);m.w16(0x800d92d8,0);m.w32(0x80014a78,0x03e00008);m.w32(0x80014a7c,0x00001021);
 const name=kind.toString(16);fs.writeFileSync(out+name+'.ram',m.bytes);const hashes=[],grid=[];let last;let drop;
 for(let f=0;f<110;f++){if(f===90)move(3,1);for(const pc of funcs)m.call(pc);const v=w.cell(1,3);if(v!==last){grid.push([f,v]);last=v;}if(f===89)drop={cell:v,effects:Array.from({length:130},(_,i)=>EFFECT+i*112).filter(p=>m.u16(p+0x56)!==10).map(p=>({type:m.u8(p+0x69),primitive:m.u32(p+0x10),sequence:m.u32(p+8)}))};const h=createHash('sha256');for(const [lo,hi] of ranges)h.update(m.bytes.subarray(lo,hi));hashes.push(h.digest('hex'));}
 const item={kind,name,hashes,grid,drop,sounds,stats:{bombs:m.u16(PLAYER+0x8e),fire:m.u8(PLAYER+0xda),speed:m.u16(PLAYER+0x58),flags:m.u32(PLAYER+0x68)}};cases.push(item);console.log(name,item.sounds,item.stats);
}
fs.writeFileSync(out+'js-cases.json',JSON.stringify({ranges,funcs,frames:110,cases},null,2));
