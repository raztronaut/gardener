import {readFileSync}from'node:fs';
import {VARIANTS}from'../../public/lib/widget-variants.js';
import {SIZE_PLANS}from'../../public/lib/widget-size-plans.js';
import {SIZES}from'../../public/lib/widget-layout.js';
export function checkSizeContracts(widgets,variants=VARIANTS,plans=SIZE_PLANS){
 const errors=[];
 for(const w of widgets.filter(w=>w.enabled!==false)){
  const p=plans[w.id];
  if(!p){errors.push(`${w.id}: declare a size design before adding this card.`);continue;}
  if(!SIZES[p.default?.size]||p.default?.reason?.length<25||p.composition?.length<30||p.overflow?.length<30)errors.push(`${w.id}: explain the default footprint, compositions and overflow policy.`);
  const choices=variants[w.id]||{};
  for(const [size,desc]of Object.entries(choices))if(!SIZES[size]||p.variants?.[size]!==desc||desc.length<15)errors.push(`${w.id}/${size}: renderer choice and reviewed intent must agree.`);
  for(const size of Object.keys(p.variants||{}))if(!choices[size])errors.push(`${w.id}/${size}: a plan without a renderer cannot be offered.`);
  if(new Set(Object.values(choices)).size!==Object.keys(choices).length)errors.push(`${w.id}: each variant needs a distinct purpose.`);
 }
 return errors;
}
const manifest=JSON.parse(readFileSync(new URL('../../public/widgets/manifest.json',import.meta.url)));
const errors=checkSizeContracts(manifest.widgets);if(errors.length){console.error(errors.join('\n'));process.exitCode=1;}else console.log('PASS: every enabled home widget has a default rationale, composition/overflow policy, and matching variant choices.');
