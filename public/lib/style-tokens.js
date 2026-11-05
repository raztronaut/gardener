// Legacy style inventory only. Semantic theme roles live in design-contract.js.
export const tokenInventory = {};
const themeable = /^(color|background.*|border.*|box-shadow|text-shadow|font.*|line-height|letter-spacing|text-transform|padding.*|margin.*|gap|row-gap|column-gap|width|min-width|max-width|height|min-height|max-height|grid-.*|align-.*|justify-.*|flex.*|opacity|cursor|fill|stroke)$/;
function hash(text) { let h=2166136261; for(const c of text) h=Math.imul(h^c.charCodeAt(0),16777619); return (h>>>0).toString(36); }
// Delimiters inside quoted strings, comments and functions are data, not CSS structure.
export function splitDeclarations(text) {
  const parts=[]; let start=0,quote='',depth=0,comment=false;
  for(let i=0;i<text.length;i++){
    const c=text[i],n=text[i+1];
    if(comment){if(c==='*'&&n==='/'){comment=false;i++;}continue;}
    if(quote){if(c==='\\'){i++;continue;}if(c===quote)quote='';continue;}
    if(c==='/'&&n==='*'){comment=true;i++;continue;}
    if(c==='"'||c==="'"){quote=c;continue;}
    if(c==='(')depth++;if(c===')')depth--;
    if(c===';'&&!depth){parts.push(text.slice(start,i));start=i+1;}
  }
  parts.push(text.slice(start));return parts;
}
function structuralBraces(text) {
  const braces=[];let quote='',comment=false,paren=0;
  for(let i=0;i<text.length;i++){
    const c=text[i],n=text[i+1];
    if(comment){if(c==='*'&&n==='/'){comment=false;i++;}continue;}
    if(quote){if(c==='\\'){i++;continue;}if(c===quote)quote='';continue;}
    if(c==='/'&&n==='*'){comment=true;i++;continue;}
    if(c==='"'||c==="'"){quote=c;continue;}
    if(c==='(')paren++;if(c===')')paren--;
    if(!paren&&(c==='{'||c==='}'))braces.push([i,c]);
  }return braces;
}
const clean=s=>s.replace(/\/\*[\s\S]*?\*\//g,'').trim();
export function tokenizeCSS(source,owner,context=[]) {
  const braces=structuralBraces(source);let cursor=0,result='',index=0;
  while(index<braces.length){
    const [open,ch]=braces[index];if(ch!== '{'){index++;continue;}
    let depth=1,end=index+1;while(end<braces.length&&depth){depth+=braces[end][1]==='{'?1:-1;end++;}
    if(depth)break;const close=braces[end-1][0],header=source.slice(cursor,open),selector=clean(header),body=source.slice(open+1,close);
    let replacement=body;
    if(/^@(media|supports|container|layer|scope)\b/.test(selector)){
      replacement=tokenizeCSS(body,owner,[...context,selector.replace(/\s+/g,' ')]);
    }else if(selector&&!selector.startsWith('@')){
      // Nested authored selectors remain untouched until separately scoped; do not
      // misinterpret declaration fragments as a selector or keyframe as a component.
      if(!structuralBraces(body).length)replacement=splitDeclarations(body).map(decl=>{
        const normalized=clean(decl),colon=normalized.indexOf(':');if(colon<0)return decl;
        const property=normalized.slice(0,colon).trim();let value=normalized.slice(colon+1).trim();
        if(!themeable.test(property)||!value||value.includes('--ds-')||value.includes('data:'))return decl;
        const important=/\s*!important\s*$/.test(value);value=value.replace(/\s*!important\s*$/,'');
        const identity=[...context,selector.replace(/\s+/g,' ')].join('|');
        const token='--ds-'+owner.replace(/[^a-z0-9-]/gi,'-')+'-'+hash(identity)+'-'+property;
        tokenInventory[token]={owner,selector,property,default:value,...(context.length?{context}: {})};
        return property+':var('+token+', '+value+')'+(important?' !important':'');
      }).join(';');
    }
    result+=header+'{'+replacement+'}';cursor=close+1;index=end;
  }
  return result+source.slice(cursor);
}
export function tokenizeStyleSheet(sheet,owner){
  const node=sheet?.ownerNode;
  if(node?.tagName==='STYLE'){node.__originalCSS=node.__originalCSS||node.textContent;node.textContent=tokenizeCSS(node.__originalCSS,owner);}
}
