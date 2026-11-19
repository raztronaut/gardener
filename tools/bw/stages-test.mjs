// Exercise the installed private stage packs. No commercial assets in source.
import fs from 'node:fs';import assert from 'node:assert/strict';import {pathToFileURL} from 'node:url';
const runtime=process.env.BW_TEST_RUNTIME||'public/arcade/bw';const {World,PLAYER,STAGE_OBJECT}=await import(pathToFileURL(process.cwd()+'/'+runtime+'/engine.js'));
const pack=JSON.parse(fs.readFileSync('data/bw/pack/pack.json'));assert.equal(pack.stages.length,10);
const results=[];
for(const stage of pack.stages){const base=fs.readFileSync(`data/bw/pack/${stage.id?'stage-'+stage.id:'battle'}.ram`),sounds=new Set(),world=new World(base,{onSound:id=>sounds.add(id)}),m=world.m;
 assert.equal(world.stage,stage.id);const view=new DataView(base.buffer,base.byteOffset,base.byteLength);
 if(stage.id){
  // Native special terrain and upper floor must survive the portrait extension.
  for(let l=0;l<2;l++)for(let r=17;r<=25;r++)for(let c=2;c<=14;c++){let expected=view.getUint16(0xcbc80+2*(l*1920+r*64+c),true);if((expected&0x3f80)===0x3f80&&(expected&127)===1)expected=0x4001;const actual=world.cell(r,c,l);if(!l&&r===25&&[2,14].includes(c))assert(actual>=0x3e60&&actual<=0x3e75);else assert.equal(actual,expected,`${stage.name}: original sector ${l}/${r}/${c}`);}
  for(let i=0;i<50*180;i++)assert.equal(m.bytes[0xd6f18+i],base[0xd6f18+i],`${stage.name}: native objects`);
 }
 for(let i=0;i<5;i++)assert.equal(m.u16(PLAYER+i*220+0x8e),1);
 for(let f=0;f<2400;f++)world.tick([f%180===0?0x2000:0]);
 const result={id:stage.id,name:stage.name,frame:world.frame,round:world.round,sounds:[...sounds],alive:[0,1,2,3,4].filter(i=>world.alive(i)),stageObjects:[...Array(50)].filter((_,i)=>world.m.u16(STAGE_OBJECT+i*180+0x56)!==10).length};results.push(result);console.log(result);
}
fs.writeFileSync('data/bw/complete/stages-verification.json',JSON.stringify(results,null,2));console.log('Ten stages, preserved native terrain/objects, 24,000 playable portrait ticks: PASS');
