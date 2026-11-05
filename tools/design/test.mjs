import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { compileDesign, validateDesign, tokenizeCSS, tokenInventory } from '../../public/lib/design-system.js';
import { THEMES } from '../../public/lib/theme-registry.js';
import { themeSchema } from '../../public/lib/theme-schema.js';
const fixture=(tokens={})=>({version:1,id:'classic',tokens,components:{},widgets:{}});
test('all registered themes compile independently and without deprecated token keys',()=>{
  for(const theme of THEMES){
    const d=JSON.parse(readFileSync(new URL('../../public'+theme.file,import.meta.url)));
    assert.match(compileDesign(d,theme.id),new RegExp('data-theme="'+theme.id+'"'));
    assert.deepEqual(validateDesign(d,theme.id).warnings,[]);
  }
});
test('semantic roles emit compatibility aliases; local roles override them locally',()=>{
  const d=fixture({palette:{'--palette-mint':'#74f7b0'},colors:{'--color-accent':'var(--palette-mint)'}});
  d.widgets.clock={tokens:{'--color-accent':'#ccbbff'}};
  const css=compileDesign(d);
  assert.match(css,/--mint:var\(--color-accent\)/);
  assert.match(css, /data-wid="clock"[^{}]*\{[^{}]*--color-accent:#ccbbff;--mint:var\(--color-accent\)/);
});
test('reject unknown fields, wrong groups and duplicate semantic roles',()=>{
  assert.throws(()=>compileDesign({...fixture(),widgtes:{}}),/unknown field/);
  assert.throws(()=>compileDesign(fixture({colours:{}})),/unknown field/);
  assert.throws(()=>compileDesign(fixture({colors:{'--color-acent':'red'}})),/unknown semantic token/);
  assert.throws(()=>compileDesign(fixture({colors:{'--color-accent':'red','--mint':'green'}})),/duplicate role/);
  assert.throws(()=>compileDesign({...fixture(),widgets:{clock:{rows:'2'}}}),/invalid rows/);
  assert.throws(()=>compileDesign({...fixture(),widgets:{clock:{columns:99}}}),/invalid columns/);
});
test('reject missing references and cycles before any CSS is applied',()=>{
  assert.throws(()=>compileDesign(fixture({colors:{'--color-accent':'var(--palette-missing)'}})),/undefined token reference/);
  assert.throws(()=>compileDesign(fixture({colors:{'--color-accent':'var(--color-accent-secondary)','--color-accent-secondary':'var(--color-accent)'}})),/cycle/);
  assert.throws(()=>compileDesign(fixture({colors:{'--color-accent':'var(--mint)'}})),/cycle/);
});
test('component selector lists remain inside the theme; injection is rejected',()=>{
  const d=fixture();d.components.buttons={selector:'button, .button:hover',style:{color:'#abc'}};
  assert.match(compileDesign(d),/html\[data-theme="classic"\]\{button, \.button:hover\{/);
  d.components.buttons.selector='} body {';assert.throws(()=>compileDesign(d),/invalid selector/);
  assert.throws(()=>compileDesign(fixture({colors:{'--color-accent':'red; display:none'}})),/CSS value/);
});
test('browser validation rejects invalid CSS property values atomically',()=>{
  const d=fixture();d.components.x={selector:'.x',style:{padding:'banana'}};
  assert.throws(()=>compileDesign(d,'classic',{supports:()=>false}),/unsupported or invalid/);
});
test('authored shorthand, quoted braces, comments and priorities survive tokenization',()=>{
  const css='.clock::before { content:"a;{b}"; background:linear-gradient(var(--ink), var(--mint)); background-clip:text; padding:10px 20px !important; font:20px "A;B"; }';
  const out=tokenizeCSS(css,'clock');
  assert.match(out,/content:"a;\{b\}"/);assert.match(out,/linear-gradient\(var\(--ink\), var\(--mint\)\)/);
  assert.match(out,/10px 20px\) !important/);assert.match(out,/"A;B"/);
  assert.equal(tokenizeCSS(out,'clock'),out);
});
test('conditional declarations get distinct inventory keys; keyframes and font-face stay authored',()=>{
  const css='.x { color:red } @media (max-width:600px) { .x { color:blue } } @keyframes glow { from { opacity:0 } to { opacity:1 } } @font-face { font-family:"X"; src:url("/x.woff2") }';
  const out=tokenizeCSS(css,'conditional-test');
  const tokens=Object.entries(tokenInventory).filter(([,v])=>v.owner==='conditional-test');
  assert.equal(tokens.length,2);assert.notEqual(tokens[0][0],tokens[1][0]);
  assert.deepEqual(tokens[1][1].context,['@media (max-width:600px)']);
  assert.match(out,/@keyframes glow \{ from \{ opacity:0 \} to \{ opacity:1 \} \}/);
  assert.match(out,/@font-face \{ font-family:"X"/);
});
test('checked-in JSON schema is generated from the same contract',()=>{
  assert.deepEqual(JSON.parse(readFileSync(new URL('../../public/themes/schema/theme.schema.json',import.meta.url))),themeSchema());
});

test('widget-local aliases cannot silently define the same role twice',()=>{
  const d=fixture();d.widgets.clock={tokens:{'--color-accent':'red','--mint':'blue'}};
  assert.throws(()=>compileDesign(d),/duplicate local role/);
});
test('typed color roles reject invalid colors before application',()=>{
  const d=fixture({colors:{'--color-accent':'banana'}});
  assert.throws(()=>compileDesign(d,'classic',{supports:()=>false}),/invalid color token/);
});
test('reserved semantic reference typos and malformed palette names are rejected',()=>{
  const d=fixture();d.components.button={selector:'button',style:{color:'var(--color-acent)'}};
  assert.throws(()=>compileDesign(d),/undefined token reference/);
  assert.throws(()=>compileDesign(fixture({palette:{'--palette-':'red'}})),/primitive names/);
});
