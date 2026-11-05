import assert from 'node:assert/strict';
import { packPages, defaultSize, SIZES } from '../../public/lib/widget-layout.js';
import { directAction } from '../../src/voice-fast.mjs';
const ids=['clock','air-quality','weather','daily','hacker-news','sf-events','gardyn','fractal'];
const items=ids.map((id,order)=>({id,order,page:0,size:defaultSize(id),hidden:false}));
for(const size of Object.keys(SIZES)) {
  const input=items.map(x=>({...x,...(x.id==='weather'?{size}:{})}));
  const original=JSON.stringify(input), result=packPages(input,2,'weather');
  assert.equal(JSON.stringify(input),original,'packing must not mutate caller state');
  assert.equal(result.positions.weather.page,0,'the resized widget stays on its requested page');
  for(let n=0;n<result.pages;n++){
    const occupied=new Set();
    for(const p of [result.clock,...Object.values(result.positions).filter(x=>x.page===n)].filter(Boolean)){
      assert(p.x+p.columns<=4&&p.y+p.rows<=7,'all cells stay inside the screen');
      for(let y=p.y;y<p.y+p.rows;y++)for(let x=p.x;x<p.x+p.columns;x++){
        const key=`${x},${y}`;assert(!occupied.has(key),'widgets must not overlap');occupied.add(key);
      }
    }
  }
}
const full=Array.from({length:100},(_,order)=>({id:`test-${order}`,order,page:0,size:'large'}));
assert.throws(()=>packPages(full),/20 pages are full/);
assert(!packPages([...items,{id:'hidden',page:0,size:'large',hidden:true}]).positions.hidden);
assert.deepEqual(packPages(items),packPages(items),'packing is deterministic');
for(const [phrase,action] of [
  ['make the weather medium','resize'],['make the clock two by two','resize'],
  ['move the painting to page two','move'],['remove the weather widget','remove'],
  ['add weather','add'],['move weather before air','reorder'],['next page','page'],
  ['go to page two','page'],['add a page','add_page'],['done editing','done'],
])assert.equal(directAction(phrase)?.input.changes[0].action,action,phrase);
assert.equal(directAction('add a stock widget'),null,'new widgets require the coding agent');
console.log('PASS: finite page packing, variants, overflow, hidden widgets and fast voice layout grammar.');

// A newly added widget fills a spare existing page before creating another,
// and must not displace the widgets already placed on either existing page.
const existing=Array.from({length:26},(_,order)=>({id:`small-${order}`,order,page:order<13?0:1,size:'small'}));
const pinned={id:'clock',size:'small',page:0,order:-1};
const withNew=packPages([pinned,...existing,{id:'new',size:'small',page:0,order:0}],2,{id:'new',last:true});
assert.equal(withNew.positions.new.page,2);
assert.equal(withNew.pages,3);
const spare=packPages([pinned,...existing.slice(0,25),{id:'new',size:'small',page:0,order:0}],2,{id:'new',last:true});
assert.equal(spare.positions.new.page,1);
assert.equal(spare.pages,2);
assert.equal(defaultSize('new-widget','tall'),'tall');

// New widgets/sizes are never enabled without an authored composition.
const {sizeAvailable,VARIANTS}=await import('../../public/lib/widget-variants.js');
assert.equal(sizeAvailable('new-unknown-widget','original'),true);
assert.equal(sizeAvailable('new-unknown-widget','large'),false);
assert.equal(sizeAvailable('gardyn','tall'),false);
assert.equal(sizeAvailable('clock','large'),false);
for(const [id,variants] of Object.entries(VARIANTS))for(const size of Object.keys(variants)){
  assert(SIZES[size],`${id} declares an unknown footprint`);
  assert.equal(sizeAvailable(id,size),true);
}
console.log('PASS: variant availability is explicit; unknown and undesigned sizes stay disabled.');

assert.equal(directAction('make the weather taller'),null,'a comparative with no exact designed size should use the snapshot-aware voice model');

const {gridMetrics}=await import('../../public/lib/widget-layout.js');
const m=gridMetrics({width:848,height:1361,gap:9,padding:2});
assert(Math.abs(m.row*7+6*9+4-1361)<1e-9);
assert(Math.abs(m.column*4+3*9+4-848)<1e-9);
for(const name of Object.keys(SIZES)){
  const rect=m.footprint(name),s=SIZES[name];
  assert(Math.abs(rect.height-(s.rows*m.row+(s.rows-1)*9))<1e-9);
  assert(rect.width<=844&&rect.height<=1357);
}
for(const id of ['weather','daily','hacker-news','sf-events','gardyn','fractal'])assert.equal(defaultSize(id),'medium');
for(const id of ['clock','air-quality','transit'])assert.equal(defaultSize(id),'small');
console.log('PASS: actual grid dimensions include borders/padding/gaps; authored defaults resolve to named footprints.');
