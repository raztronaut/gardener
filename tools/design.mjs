#!/usr/bin/env node
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';
import { compileDesign, validateDesign, TOKEN_CONTRACT } from '../public/lib/design-system.js';
import { THEMES, DEFAULT_THEME, themeById } from '../public/lib/theme-registry.js';
import { themeSchema } from '../public/lib/theme-schema.js';
const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
const command=process.argv[2]||'inspect',id=process.argv[3]||DEFAULT_THEME;
const read=id=>JSON.parse(readFileSync(resolve(root,'public'+themeById(id).file),'utf8'));
try{
  if(command==='schema'){
    const content=JSON.stringify(themeSchema(),null,2)+'\n',file=resolve(root,'public/themes/schema/theme.schema.json');
    if(process.argv.includes('--write')){writeFileSync(file,content);console.log('Updated theme JSON schema from contract');}
    else if(readFileSync(file,'utf8')!==content)throw Error('Theme schema is stale; run node tools/design.mjs schema --write');
    else console.log('Theme schema matches contract');
  }else if(command==='surfaces'){
    console.log(readFileSync(resolve(root,'public/themes/review-surfaces.json'),'utf8'));
  }else if(command==='roles'){
    const search=process.argv.slice(3).join(' ').toLowerCase();
    console.log(JSON.stringify(Object.fromEntries(Object.entries(TOKEN_CONTRACT).filter(([k,v])=>JSON.stringify([k,v]).toLowerCase().includes(search))),null,2));
  }else if(command==='list')console.log(JSON.stringify(THEMES,null,2));
  else {
    if(!themeById(id))throw Error('Unknown theme: '+id+'; use '+THEMES.map(t=>t.id).join(', '));
    const d=read(id),css=compileDesign(d,id),validation=validateDesign(d,id);
    if(command==='lint'||command==='lint-all'){
      let failures=0;
      for(const theme of command==='lint-all'?THEMES:[themeById(id)]){
        const doc=read(theme.id);let count=0;
        for(const [name,c] of Object.entries(doc.components||{}))for(const [prop,v] of Object.entries(c.style||{})){
          if(/#[0-9a-f]{3,8}\b|rgba?\(/i.test(v)){
            console.error(theme.id+'.components.'+name+'.'+prop+': move literal paint into a semantic role');count++;
          }
        }
        failures+=count;console.log(theme.id+': '+count+' component paint literals');
      }
      if(failures)process.exitCode=1;
    }else if(command==='validate'||command==='validate-all'){
      for(const theme of command==='validate-all'?THEMES:[themeById(id)]){
        const design=read(theme.id),result=validateDesign(design,theme.id);
        console.log('Valid:',theme.id,'—',Object.keys(result.tokens).length,'tokens,',Object.keys(design.components||{}).length,'components');
        result.warnings.forEach(w=>console.log('  warning:',w));
      }
    }else if(command==='css')console.log(css);
    else if(command==='inspect')console.log(JSON.stringify(d,null,2));
    else if(command==='tokens'){
      const all=JSON.parse(readFileSync(resolve(root,'public/themes/token-inventory.json'),'utf8'));
      const search=process.argv.slice(4).join(' ').toLowerCase();
      console.log(JSON.stringify(Object.fromEntries(Object.entries(all).filter(([k,v])=>JSON.stringify([k,v]).toLowerCase().includes(search))),null,2));
    }else if(command==='audit'){
      const generated=Object.keys(validation.tokens).filter(k=>k.startsWith('--ds-'));
      const literal=[];
      for(const [name,c] of Object.entries(d.components||{}))for(const [p,v] of Object.entries(c.style)){
        if(/#[0-9a-f]{3,8}\b|rgba?\(/i.test(v))literal.push({component:name,property:p,value:v});
      }
      console.log(JSON.stringify({theme:id,roles:Object.keys(validation.tokens).length,legacyAliases:validation.warnings,deepOverrides:generated,
        componentColorLiterals:literal,notes:['Component literals are exceptions to review, not automatic recolors.','Source catalog lists static possibilities; window.gardenDesign.tokens is authoritative for mounted states.','Drawing code uses design-values.js; data colors and alarm meanings still require state review.']},null,2));
    }else throw Error('Usage: design.mjs list|inspect|validate|validate-all|css|roles|tokens|audit|schema|surfaces|lint|lint-all [theme] [search]');
  }
}catch(e){console.error(e.message);process.exitCode=1;}
