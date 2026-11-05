// Deterministic finite-page layout. Coordinates are 0-based; public pages are 1-based.
export const GRID = { columns: 4, rows: 7, smallColumns: 2, smallSlots: 14, maxPages: 20 };
export const SIZES = {
  small: { columns: 2, rows: 1, label: 'Small', description: 'One clear reading' },
  medium: { columns: 2, rows: 2, label: 'Medium', description: 'A reading and a short overview' },
  wide: { columns: 4, rows: 2, label: 'Wide', description: 'A horizontal overview' },
  tall: { columns: 2, rows: 3, label: 'Tall', description: 'More room for the forecast, list or artwork' },
  large: { columns: 4, rows: 4, label: 'Large', description: 'A spacious overview' },
};
// Default authored content uses a named outer footprint too. No renderer gets
// a second sizing system: Original is an alias for this widget's default frame.
export function defaultSize(id, preferred) {
  if (SIZES[preferred]) return preferred;
  return ['clock','air-quality','transit'].includes(id) ? 'small' : 'medium';
}
export function sizeName(id, size, preferred) { return SIZES[size] ? size : defaultSize(id, preferred); }
export function gridMetrics({width,height,gap=9,padding=2}) {
  const innerWidth=width-2*padding, innerHeight=height-2*padding;
  const column=(innerWidth-(GRID.columns-1)*gap)/GRID.columns;
  const row=(innerHeight-(GRID.rows-1)*gap)/GRID.rows;
  return {column,row,width:innerWidth,height:innerHeight,gap,padding,
    footprint(size){const s=SIZES[size];if(!s)throw Error('Unknown footprint');return {width:s.columns*column+(s.columns-1)*gap,height:s.rows*row+(s.rows-1)*gap};}};
}

export function packPages(items, pageCount = 2, priority = null) {
  const pages = Array.from({length: Math.max(2,pageCount)},()=>[]), positions = {};
  const clock = items.find(x=>x.id==='clock');
  function board(n) {
    while (pages.length <= n) pages.push([]);
    const used = Array.from({length:GRID.rows},()=>Array(GRID.columns).fill(false));
    if(clock) { const s=SIZES[clock.size]; for(let y=0;y<s.rows;y++)for(let x=0;x<s.columns;x++)used[y][x]=true; }
    for(const p of pages[n])for(let y=p.y;y<p.y+p.rows;y++)for(let x=p.x;x<p.x+p.columns;x++)used[y][x]=true;
    return used;
  }
  const ordered = items.filter(x=>x.id!=='clock'&&!x.hidden).sort((a,b)=>a.page-b.page||a.order-b.order);
  // Put a deliberate resize/add/move on its requested page before packing its peers.
  if(priority) {
    const id=typeof priority==='string'?priority:priority.id, sign=priority.last?1:-1;
    ordered.sort((a,b)=>(a.id===id?sign:b.id===id?-sign:0));
  }
  for(const it of ordered) {
    const size = SIZES[it.size]; let found=false;
    const count=pages.length;
    const candidates=[...Array.from({length:count-it.page},(_,i)=>it.page+i),...Array.from({length:it.page},(_,i)=>i),...Array.from({length:GRID.maxPages-count},(_,i)=>count+i)];
    for(const n of candidates) {
      if(found)break;
      const used=board(n);
      for(let y=0;y<=GRID.rows-size.rows&&!found;y++)for(let x=0;x<=GRID.columns-size.columns&&!found;x++) {
        if(used.slice(y,y+size.rows).some(row=>row.slice(x,x+size.columns).some(Boolean)))continue;
        const p={id:it.id,page:n,x,y,...size}; pages[n].push(p); positions[it.id]=p; found=true;
      }
    }
    if(!found) throw Error('All 20 pages are full. Remove a widget or choose a smaller size.');
  }
  return { pages:pages.length, positions, clock:clock?{id:'clock',x:0,y:0,...SIZES[clock.size]}:null };
}
