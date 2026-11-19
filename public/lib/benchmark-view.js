// Garden's benchmark views consume measured artifacts, never trigger workload tests.
let cache=null,pending=null;
const clip=(v,n=900)=>typeof v==='string'?v.slice(0,n):'';
export function normalizeBenchmarkReport(raw){
 if(raw?.version!==1||!Array.isArray(raw.suites))throw Error('Benchmark report is not readable.');
 const suites=raw.suites.slice(0,30).map(s=>({id:clip(s.id,80),title:clip(s.title,140),description:clip(s.description),method:clip(s.method,1800),limits:clip(Array.isArray(s.limits)?s.limits.join(' '):s.limits,1600),notes:(Array.isArray(s.notes)?s.notes:[]).slice(0,12).map(x=>clip(x)),checks:s.checks&&Number.isFinite(s.checks.total)?{passed:Math.max(0,Number(s.checks.passed)||0),total:Math.max(0,s.checks.total)}:null,
 metrics:(s.metrics||[]).slice(0,20).filter(m=>Number.isFinite(m.median)&&m.median>=0).map(m=>({id:clip(m.id,100),label:clip(m.label,180),unit:clip(m.unit,20)||'ms',median:m.median,p95:Number.isFinite(m.p95)?m.p95:null,samples:Number.isInteger(m.samples)?m.samples:0,warmth:clip(m.warmth,100),values:(Array.isArray(m.values)?m.values:[]).filter(Number.isFinite).slice(0,1000),note:clip(m.note)}))}));
 return {version:1,generatedAt:raw.generatedAt,environment:raw.environment||{},assets:(Array.isArray(raw.assets)?raw.assets:[]).slice(0,12).filter(a=>Number.isFinite(a.bytes)&&Number.isFinite(a.gzipBytes)).map(a=>({path:clip(a.path,160),bytes:a.bytes,gzipBytes:a.gzipBytes})),suites};
}
export async function loadBenchmarkReport({force=false}={}){
 if(cache&&!force&&Date.now()-cache.at<60000)return cache.report;
 if(pending)return pending;
 pending=(async()=>{const r=await fetch('/genui/benchmarks.json',{cache:'no-store',signal:AbortSignal.timeout(12000)});if(!r.ok)throw Error(r.status===404?'The benchmark run is being prepared.':'The benchmark results are reconnecting.');const report=normalizeBenchmarkReport(await r.json());cache={report,at:Date.now()};return report;})().finally(()=>pending=null);return pending;
}
export function benchmarkSummary(report){
 const metrics=(report?.suites||[]).flatMap(s=>s.metrics.map(m=>({...m,suite:s.title})));
 const timing=metrics.filter(m=>m.unit==='ms'),lead=timing.find(m=>/a2ui.*patch|a2ui.*update/i.test(m.id+' '+m.label))||timing.find(m=>/native.*patch|dispatch/i.test(m.id+' '+m.label))||timing[0];
 const checks=(report?.suites||[]).reduce((a,s)=>({passed:a.passed+(s.checks?.passed||0),total:a.total+(s.checks?.total||0)}),{passed:0,total:0});
 return {lead,metrics,checks,suites:report?.suites?.length||0};
}
export const formatMeasure=(v,unit='ms')=>Number.isFinite(v)?`${new Intl.NumberFormat('en-US',{maximumFractionDigits:v<10?2:v<100?1:0}).format(v)}${unit==='ms'?' ms':unit==='bytes'?' B':' '+unit}`:'Not measured';
function summaryLabel(m){return m?/a2ui/i.test(m.id+' '+m.label)?'A2UI update':/native|dispatch/i.test(m.id+' '+m.label)?'Native update':m.label:'Waiting for a run';}
export function renderBenchmarkCard(size,report,h){
 const {lead,checks,suites}=benchmarkSummary(report),root=h('div',{class:'bench-card bench-card-'+size});
 const primary=h('div',{class:'bench-card-primary'},h('span',{class:'bench-kicker'},'THE GARDEN · IN MOTION'),h('strong',{class:'bench-card-value'},lead?formatMeasure(lead.median,lead.unit):'No run yet'),h('span',{class:'bench-card-label'},lead?`${summaryLabel(lead)} · median`:'The next report appears here.'));
 root.append(primary);
 if(size==='wide')root.append(h('div',{class:'bench-card-context'},h('strong',{class:'bench-card-checks'},checks.total?`${checks.passed}/${checks.total}`:'—'),h('span',{},'checks passed'),h('small',{},suites?`${suites} suites · ${lead?.samples||0} timing samples`:'Preparing representative runs')));
 else root.append(h('p',{class:'bench-card-note'},checks.total?`${checks.passed}/${checks.total} checks · ${suites} measured suites`:'Measured timings, methods and what they mean.'));
 if(globalThis.document?.documentElement.dataset.theme==='classic'&&size==='medium'&&lead?.values?.length>1){const chart=distribution(lead,h);chart.classList.add('bench-card-plot');root.append(chart);}
 const recorded=globalThis.document?.documentElement.dataset.theme==='classic'&&report?.generatedAt?'Recorded '+new Date(report.generatedAt).toLocaleDateString('en-US',{month:'short',day:'numeric'})+' · ':'';
 root.append(h('small',{class:'bench-card-foot'},recorded+'Open the performance lab ↗'));
 return root;
}
const svg=(name,attrs)=>{const el=document.createElementNS('http://www.w3.org/2000/svg',name);for(const [k,v]of Object.entries(attrs))el.setAttribute(k,String(v));return el;};
function distribution(metric,h){
 const values=metric.values;if(values.length<2)return h('p',{class:'bench-subtle'},'Individual samples were not retained for this metric.');
 const max=Math.max(...values,metric.p95||0,1),w=640,ht=92,chart=svg('svg',{viewBox:`0 0 ${w} ${ht}`,role:'img','aria-label':`${metric.label}: ${values.length} individual measurements, in run order. Vertical scale zero to ${formatMeasure(max,metric.unit)}.`});
 chart.append(svg('line',{x1:0,x2:w,y1:ht-8,y2:ht-8,class:'bench-axis'}));
 if(metric.p95!==null){const y=ht-8-(metric.p95/max)*(ht-18);chart.append(svg('line',{x1:0,x2:w,y1:y,y2:y,class:'bench-p95'}));}
 const points=values.map((v,i)=>`${(i/(values.length-1)*w).toFixed(2)},${(ht-8-v/max*(ht-18)).toFixed(2)}`).join(' ');chart.append(svg('polyline',{points,fill:'none',class:'bench-trace'}));
 for(let i=0;i<values.length;i++){const point=svg('circle',{cx:i/(values.length-1)*w,cy:ht-8-values[i]/max*(ht-18),r:values.length>100?1:2.3,class:'bench-dot'});const title=svg('title',{});title.textContent=`Run ${i+1}: ${formatMeasure(values[i],metric.unit)}`;point.append(title);chart.append(point);}
 return h('figure',{class:'bench-distribution'},chart,h('figcaption',{},'Run order →',h('span',{},`0–${formatMeasure(max,metric.unit)} · dashed line: p95`)));
}
function metricView(metric,scale,h){
 const header=h('div',{class:'bench-metric-heading'},h('div',{},h('h3',{},metric.label),h('span',{class:'bench-subtle'},`${metric.samples} samples${metric.warmth?' · '+metric.warmth:''}`)),h('strong',{class:'bench-metric-value'},formatMeasure(metric.median,metric.unit)));
 const track=h('div',{class:'bench-track','aria-hidden':'true'}),median=h('span',{class:'bench-range-median'}),p95=h('span',{class:'bench-range-p95'});median.style.width=Math.max(.4,metric.median/scale*100)+'%';p95.style.left=Math.min(100,(metric.p95??metric.median)/scale*100)+'%';track.append(median,p95);
 const section=h('section',{class:'bench-metric'},header,track,h('div',{class:'bench-metric-meta'},h('span',{},metric.samples===1?'One observed run':'Median · the typical run'),h('span',{},metric.samples===1?'More runs needed for a tail estimate':metric.p95===null?'p95 not recorded':`p95 ${formatMeasure(metric.p95,metric.unit)}`)));
 if(metric.values.length>1)section.append(distribution(metric,h));
 if(metric.note)section.append(h('p',{class:'bench-subtle'},metric.note));return section;
}
function suiteView(suite,h){
 const scales={};for(const m of suite.metrics)scales[m.unit]=Math.max(scales[m.unit]||1,m.median,m.p95||0,...m.values);
 const head=h('header',{class:'bench-suite-heading'},h('span',{class:'bench-kicker'},'MEASUREMENT '+suite.id.replaceAll('-',' ').toUpperCase()),h('h2',{},suite.title),h('p',{},suite.description));
 const section=h('section',{class:'bench-suite','data-suite':suite.id},head);
 if(suite.checks)section.append(h('div',{class:'bench-check-strip'},h('strong',{},`${suite.checks.passed} / ${suite.checks.total}`),h('span',{},'correctness checks passed')));
 section.append(...suite.metrics.map(m=>metricView(m,scales[m.unit],h)));
 if(!suite.metrics.length)section.append(h('p',{},'Correctness results only. No timing claim was recorded.'));
 const method=h('details',{class:'bench-method'},h('summary',{'data-psel':'', 'data-name':`How ${suite.title} was measured`},'How we measured this'),h('p',{},suite.method||'Method not supplied.'),h('h3',{},'How to interpret the result'),h('p',{},suite.limits||'Results describe this recorded workload, not every request.'),...suite.notes.map(note=>h('p',{},note)));section.append(method);return section;
}
export function mountBenchmarkPage(body,ctx){
 const {h}=ctx;let alive=true,selected='all',report=null;
 const root=h('main',{class:'bench-lab'}),status=h('p',{class:'bench-status',role:'status'}),nav=h('nav',{class:'bench-suite-tabs','aria-label':'Benchmark suite'}),content=h('div',{class:'bench-content'}),refresh=h('button',{type:'button',class:'bench-refresh','data-psel':'','data-name':'Refresh benchmark results',onClick:()=>load(true)},'Refresh results');
 root.append(h('header',{class:'bench-hero'},h('span',{class:'bench-kicker'},'THE GARDEN · PERFORMANCE LAB'),h('h1',{},'Feel the difference.'),h('p',{},'Where the milliseconds go, how the pieces behave, and what we actually tested.'),status,refresh),nav,content);body.replaceChildren(root);
 const draw=()=>{
  if(!alive||!report)return;const {lead,checks,suites}=benchmarkSummary(report);
  status.textContent=`Recorded ${new Date(report.generatedAt).toLocaleString('en-US',{month:'long',day:'numeric',year:'numeric',hour:'numeric',minute:'2-digit'})} · ${report.environment.device||'Garden workstation'}`;
  nav.replaceChildren(...[{id:'all',title:'Overview'},...report.suites].map(s=>h('button',{type:'button','data-psel':'','data-name':s.title,'aria-pressed':String(selected===s.id),onClick:()=>{selected=s.id;draw();}},s.title)));
  content.replaceChildren();
  if(selected==='all')content.append(h('section',{class:'bench-overview'},h('div',{class:'bench-overview-lead'},h('span',{class:'bench-kicker'},lead?summaryLabel(lead):'RESULTS'),h('strong',{},lead?formatMeasure(lead.median,lead.unit):'Ready to inspect'),h('p',{},lead?`${lead.samples} measurements · median`:'Choose a measured suite below')),h('div',{class:'bench-overview-facts'},h('strong',{},checks.total?`${checks.passed}/${checks.total}`:'—'),h('span',{},'checks passed'),h('small',{},`${suites} suites · recorded results, not a live score`))));
  const chosen=selected==='all'?report.suites:report.suites.filter(s=>s.id===selected);content.append(...chosen.map(s=>suiteView(s,h)));
  if(selected==='all'&&report.assets?.length)content.append(h('section',{class:'bench-assets'},h('span',{class:'bench-kicker'},'THE COST OF THE COMPONENTS'),h('h2',{},'What we load to make it happen.'),h('p',{},'Bundle sizes are part of the performance story. Raw size is the source payload; gzip is the compressed equivalent, not a claim that this server transfers it compressed.'),...report.assets.map(a=>h('div',{class:'bench-asset'},h('strong',{},a.path.split('/').at(-1)),h('span',{},`${Math.round(a.bytes/1024)} KiB raw · ${Math.round(a.gzipBytes/1024)} KiB gzip`)))));
  if(report.environment.notes)content.append(h('p',{class:'bench-environment'},String(report.environment.notes).slice(0,1600)));
  content.append(h('aside',{class:'bench-explainer'},h('h2',{},'Read the numbers like a human.'),h('p',{},'Median is the middle run: useful for the usual experience. p95 is the time that 95% of recorded runs finished within: useful for spotting the slow tail.'),h('p',{},'Cold means loading work may be included. Warm means code or data was already available. Compare timings only when their workload and conditions match.'),h('p',{},'Browser rendering measurements do not measure the physical screen or the complete time from speech to a visible response. A quick result is useful only when its correctness checks pass.')));
 };
 async function load(force=false){refresh.disabled=true;status.textContent='Opening the measurement notebook…';try{report=await loadBenchmarkReport({force});draw();}catch(e){if(!alive)return;status.textContent=e.message;if(!report)content.replaceChildren(h('section',{class:'bench-empty'},h('h2',{},'The lab is getting ready.'),h('p',{},'This page reads completed benchmark runs. It never invents scores or runs heavy tests on the household display.'),h('p',{},'Use Refresh results when a new run has finished.')));}finally{if(alive)refresh.disabled=false;}}
 load();return()=>alive=false;
}
