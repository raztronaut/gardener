// Official A2UI runtime, bundled once and lazy-loaded only for a rich surface.
import {MessageProcessor,Catalog,CommonSchemas} from '@a2ui/web_core/v0_9';
import {A2uiSurface,A2uiLitElement,basicCatalog} from '@a2ui/lit/v0_9';
import {html,nothing} from 'lit';
import {z} from 'zod/v3';
export {MessageProcessor};
export const CATALOG_ID='https://garden.local/catalogs/house-v1.json';
const dynamic=CommonSchemas.DynamicString;
const entries=[];
function register(name,shape,draw){
 const api={name,schema:z.object(shape).strict()};
 class Component extends A2uiLitElement{
  api=api;
  createRenderRoot(){return this;}
  render(){const p=this.controller?.props;return p?draw(p):nothing;}
 }
 const tag='garden-a2ui-'+name.toLowerCase();customElements.define(tag,Component);entries.push({...api,tagName:tag});
}
register('GardenMetric',{label:dynamic,value:dynamic,detail:dynamic.optional()},p=>html`<section class="ga-metric"><span>${p.label}</span><strong>${p.value}</strong><p>${p.detail}</p></section>`);
register('GardenNotice',{title:dynamic,text:dynamic},p=>html`<aside class="ga-notice"><h3>${p.title}</h3><p>${p.text}</p></aside>`);
register('GardenProgress',{label:dynamic,value:CommonSchemas.DynamicNumber},p=>html`<section class="ga-progress"><label>${p.label}</label><progress max="100" .value=${Math.max(0,Math.min(100,p.value))}></progress><span>${Math.round(p.value)}%</span></section>`);
register('GardenSteps',{title:dynamic,items:z.array(z.string().max(500)).max(16)},p=>html`<section class="ga-steps"><h3>${p.title}</h3><ol>${p.items.map(x=>html`<li>${x}</li>`)}</ol></section>`);
register('GardenTable',{columns:z.array(z.string()).max(6),rows:z.array(z.array(z.string())).max(30)},p=>html`<div class="ga-table"><table><thead><tr>${p.columns.map(x=>html`<th>${x}</th>`)}</tr></thead><tbody>${p.rows.map(r=>html`<tr>${r.map(x=>html`<td>${x}</td>`)}</tr>`)}</tbody></table></div>`);
register('GardenBars',{label:dynamic,values:z.array(z.number().min(0).max(100)).max(24),labels:z.array(z.string()).max(24)},p=>html`<section class="ga-chart"><h3>${p.label}</h3><div>${p.values.map((v,i)=>html`<figure><meter min="0" max="100" .value=${v}></meter><figcaption>${p.labels[i]||''} · ${v}</figcaption></figure>`)}</div></section>`);
export const catalog=new Catalog(CATALOG_ID,'0.9',[...basicCatalog.components.values(),...entries],[]);
export function createRenderer(surface){const el=new A2uiSurface();el.surface=surface;return el;}
export const componentNames=[...catalog.components.keys()];
