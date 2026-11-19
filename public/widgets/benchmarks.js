import {loadBenchmarkReport,renderBenchmarkCard,mountBenchmarkPage} from '/lib/benchmark-view.js';
let report=null;
export default {
 id:'benchmarks',title:'Performance lab',icon:'◴',size:'md',homeSize:'medium',chrome:true,
 getVariantData:()=>report,
 mount(body,ctx){let alive=true;body.replaceChildren(renderBenchmarkCard('medium',report,ctx.h));
  const refresh=async()=>{try{const next=await loadBenchmarkReport();if(!alive)return;report=next;body.replaceChildren(renderBenchmarkCard('medium',report,ctx.h));}catch{/* A visible pending composition is already rendered. */}};
  refresh();ctx.interval(refresh,300000);return()=>alive=false;
 },
 openFull(body,ctx){return mountBenchmarkPage(body,ctx);}
};
