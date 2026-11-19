import {Mips} from './mips.js';
import {installHost} from './host.js';
export const PLAYER=0x800cda98,BOMB=0x800cdee8,EFFECT=0x800d0148,GRID=0x800cbc80,STAGE_OBJECT=0x800d6f18;
export const ARENA_ROWS=27, ARENA_COLS=11;
export const rowStart = () => 2;
export const inside = (r,c) => r>=1&&r<=ARENA_ROWS&&c>=rowStart(r)&&c<=rowStart(r)+10;
export class World {
 constructor(base,{onSound=()=>{},tall=true,humans=1,seed=680,seconds=180,wins=3}={}) {
  this.seconds=seconds;this.wins=wins;this.base=base;
  this.stage=new DataView(base.buffer,base.byteOffset,base.byteLength).getUint16(0x78aac,true);this.columns=this.stage?13:11;
  // Keep the original stage's mix of empty/item-bearing crates. The private
  // map bytes supply the contents; no invented replacement power-up rules.
  const view=new DataView(base.buffer,base.byteOffset,base.byteLength);this.crateContents=[];
  for(let i=0;i<30*64;i++){const v=view.getUint16((GRID&0x1fffffff)+i*2,true);if(v>=0x3e60&&v<=0x3e75)this.crateContents.push(v);}
  if(!this.crateContents.length)throw Error('Stage has no validated crate-content distribution');this.onSound=onSound;this.tall=tall;this.humans=humans;this.seed=seed;this.round=0;this.scores=[0,0,0,0,0];this.reset();
 }
 reset() {
  this.m=new Mips(Uint8Array.from(this.base));const m=this.m;installHost(m,this.onSound);
  // Same occupancy masks as 0x8001be0c / 0x8001be3c; no CPU/device work.
  for(const [pc,mask] of [[0x8001be0c,0x80],[0x8001be3c,0x7f]])m.hooks.set(pc,()=>{for(let i=0xcad80;i<0xcbc80;i++)m.bytes[i]&=mask;});
  this.frame=0;this.result=null;this.matchComplete=false;this.endAt=0;this.last=[0,0];this.round++;m.w32(0x9010,this.seed+this.round);
  if(!this.tall)return;
  // Original storage supports 30 rows. Extend the AI danger-map initialization from row 14 to row 0.
  if(m.u32(0x800e6f00)!==0x2414000e)throw Error('Unrecognized World AI revision');m.w32(0x800e6f00,0x24140000);
  if(m.u32(0x800e6f64)!==0x28840011)throw Error('Unrecognized World AI width revision');m.w32(0x800e6f64,0x28840020);
  m.bytes.fill(0,0xcad80,0xcbc80);
  for(let l=0;l<2;l++)for(let r=0;r<30;r++)for(let c=0;c<64;c++)this.setCell(r,c,0x7f7f,l);
  let rng=this.seed+this.round;const random=()=>{rng=(Math.imul(rng,1664525)+1013904223)>>>0;return rng/4294967296;};
  const crates=new Map(),contents=new Map();
  const keyFor=(r,c)=>[Math.min(r,ARENA_ROWS+1-r),Math.min(c,this.columns+3-c)].join(',');
  const content=(r,c)=>{const key=keyFor(r,c);if(!contents.has(key))contents.set(key,this.crateContents[Math.floor(random()*this.crateContents.length)]);return contents.get(key);};
  for(let r=1;r<=ARENA_ROWS;r++)for(let c=2;c<=this.columns+1;c++){
   const key=keyFor(r,c);
   if(!crates.has(key))crates.set(key,random()<.70);
   this.setCell(r,c,(r%2===0&&c%2===1)?0x7f76:crates.get(key)?content(r,c):0x4001);
  }
  // Preserve the complete original stage sector, including both collision
  // layers and special tiles. The northern extension uses the same stage art
  // and native item mix; original hazard coordinates remain intact.
  if(this.stage){const view=new DataView(this.base.buffer,this.base.byteOffset,this.base.byteLength);
   for(let l=0;l<2;l++)for(let r=17;r<=27;r++)for(let c=2;c<=14;c++){const v=view.getUint16(0xcbc80+2*(l*1920+r*64+c),true);this.setCell(r,c,(v&0x3f80)===0x3f80&&(v&127)===1?0x4001:v,l);}
  }
  const right=this.columns+1;
  const starts=[[2,1],[right,27],[right,1],[2,27],[6,13]];
  const pockets=[[[2,1],[3,1],[2,2]],[[right,27],[right-1,27],[right,26]],[[right,1],[right-1,1],[right,2]],[[2,27],[3,27],[2,26]],[[6,13],[6,12],[7,13]]];
  // Each spawn has a three-cell escape pocket, enclosed by crates. Preserve
  // the permanent pillar lattice, including near the bottom and middle spawn.
  for(const pocket of pockets){
   const cells=new Set(pocket.map(([c,r])=>r+','+c));
   for(const [c,r] of pocket)for(const [dr,dc] of [[-1,0],[1,0],[0,-1],[0,1]]){
    const rr=r+dr,cc=c+dc;if(this.inside(rr,cc)&&!cells.has(rr+','+cc)&&this.cell(rr,cc)!==0x7f76)this.setCell(rr,cc,content(rr,cc));
   }
   for(const [c,r] of pocket){if(this.cell(r,c)===0x7f76)throw Error('Spawn pocket overlaps a pillar');this.setCell(r,c,0x4001);}
  }
  for(let i=0;i<40;i++)m.w16(BOMB+i*0x7c+0x56,10);
  for(let i=0;i<130;i++)m.w16(EFFECT+i*0x70+0x56,10);
  for(let i=0;i<5;i++) {
   const p=PLAYER+i*0xdc,[c,r]=starts[i];
   m.w16(p+0x4c,c*320+160);m.w16(p+0x4e,r*256+128);m.w16(p+0x50,0);m.w16(p+0x52,c);m.w16(p+0x54,r);m.w16(p+0x56,0);
   m.w32(p+0x64,0);m.w32(p+0x68,0);m.w32(p+0x6c,0);m.w16(p+0x8c,1);m.w16(p+0x8e,1);m.w16(p+0x92,150);m.w8(p+0xda,2);
   m.w16(p+0xac,0);m.w16(p+0xae,0);m.w8(p+0xd2,i<this.humans?0:1);m.w8(p+0xd3,i);m.w8(0x80078c7c+i,i<this.humans?0:1);
  }
  m.w16(0x80078bf8,this.seconds*60);m.w16(0x80078c4a,0);
 }
 inside(r,c){return r>=1&&r<=ARENA_ROWS&&c>=2&&c<=this.columns+1;}
 cell(r,c,l=0){return this.m.u16(GRID+2*(l*1920+r*64+c));}
 setCell(r,c,v,l=0){this.m.w16(GRID+2*(l*1920+r*64+c),v);}
 alive(i){const p=PLAYER+i*0xdc;return this.m.u16(p+0x56)!==10&&!(this.m.u32(p+0x68)&0x4c000000);}
 tick(inputs=[0,0]) {
  if(this.result){this.frame++;if(!this.matchComplete&&this.frame>=this.endAt)this.reset();return;}
  const m=this.m;
  for(let i=0;i<this.humans;i++){m.w16(0x800d9300+i*2,inputs[i]||0);m.w16(0x800d92d8+i*2,(inputs[i]||0)&~this.last[i]);this.last[i]=inputs[i]||0;}
  for(const pc of [0x8001be0c,0x80021ec4,0x800e68ec,0x800ecad0,0x800252f0,0x80023efc,0x800e95f4,0x8001be3c])m.call(pc);
  this.frame++;
  const alive=[0,1,2,3,4].filter(i=>this.alive(i));
  if(alive.length<=1||this.frame>=60*this.seconds){this.result={winner:alive.length===1?alive[0]:null};if(this.result.winner!==null)this.scores[this.result.winner]++;this.matchComplete=this.scores.some(n=>n>=this.wins);this.endAt=this.frame+240;}
 }
}
