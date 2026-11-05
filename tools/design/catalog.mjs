// Reproducible source inventory. Never executes widget code or template expressions.
import { readFileSync, writeFileSync, readdirSync } from 'node:fs';
import { resolve, relative } from 'node:path';
import { createHash } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import { FALLBACK_STYLESHEETS } from '../../public/lib/theme-registry.js';
import { tokenizeCSS, tokenInventory } from '../../public/lib/style-tokens.js';
const root=fileURLToPath(new URL('../../',import.meta.url));
const files=[...FALLBACK_STYLESHEETS.map(sheet=>'public'+sheet.file),
 ...readdirSync(resolve(root,'public/widgets')).filter(f=>f.endsWith('.js')).map(f=>'public/widgets/'+f)];
const sources={},skipped=[];let blocks=0;
for(const file of files){
  const text=readFileSync(resolve(root,file),'utf8');
  sources[file]=createHash('sha256').update(text).digest('hex');
  if(file.endsWith('.css')){tokenizeCSS(text,FALLBACK_STYLESHEETS.find(sheet=>'public'+sheet.file===file).owner);blocks++;continue;}
  const id=file.split('/').at(-1).replace('.js','');
  const pattern=/(?:\b(?:const|let)\s+([A-Z][A-Z0-9_]*(?:STYLE|CSS)|STYLE|CSS)\s*=|\bctx\.style\()\s*`/g;
  let match;
  while((match=pattern.exec(text))){
    let end=pattern.lastIndex;for(;end<text.length;end++){if(text[end]==='\\'){end++;continue;}if(text[end]==='`')break;}
    const raw=text.slice(pattern.lastIndex,end);pattern.lastIndex=end+1;
    if(raw.includes('${')){skipped.push({source:file,line:text.slice(0,match.index).split('\n').length,reason:'dynamic CSS template; inspect mounted runtime inventory'});continue;}
    const css=raw.replace(/\\([\\`$])/g,'$1');
    const owners=match[1]?.includes('FULL')?[id+':full',id+':panel']:[id,id+':full',id+':panel'];
    for(const owner of owners)tokenizeCSS(css,owner);
    blocks++;
  }
}
const inventory=Object.fromEntries(Object.entries(tokenInventory).sort(([a],[b])=>a.localeCompare(b)));
const data=JSON.stringify(inventory,null,2)+'\n';
const manifest=JSON.stringify({version:1,description:'Static source possibilities; mounted runtime inventory is authoritative for active states.',sources,cssBlocks:blocks,tokens:Object.keys(inventory).length,skipped},null,2)+'\n';
const outputs={'public/themes/token-inventory.json':data,'public/themes/token-inventory.sources.json':manifest};
if(process.argv.includes('--check')){
  for(const [file,expected] of Object.entries(outputs))if(readFileSync(resolve(root,file),'utf8')!==expected)throw Error('Stale inventory: '+file+'; run npm run design:catalog');
  console.log('Source token inventory is current');
}else{
  for(const [file,value] of Object.entries(outputs))writeFileSync(resolve(root,file),value);
  console.log('Cataloged',Object.keys(inventory).length,'possible declarations across',blocks,'CSS blocks;',skipped.length,'dynamic blocks require runtime inspection');
}
