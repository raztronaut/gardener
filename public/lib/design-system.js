export { tokenizeCSS, tokenizeStyleSheet, tokenInventory } from './style-tokens.js';
import { TOKEN_CONTRACT, TOKEN_GROUPS } from './design-contract.js';
export { TOKEN_CONTRACT, TOKEN_GROUPS };
const ID = /^[a-z][a-z0-9-]*$/;
const CUSTOM = /^--[a-z][a-z0-9-]*$/;
const PROPERTY = /^(--[a-z][a-z0-9-]*|-?[a-z][a-z0-9-]*)$/;
export const TOKEN_ALIASES = Object.freeze(Object.fromEntries(Object.entries(TOKEN_CONTRACT).flatMap(([name, info]) => info.aliases.map(alias => [alias, name]))));
export const canonicalToken = name => TOKEN_ALIASES[name] || name;
const refs = value => [...value.matchAll(/var\(\s*(--[\w-]+)/g)].map(m => canonicalToken(m[1]));
function fail(path, message) { throw new Error(path + ': ' + message); }
function object(value, path) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) fail(path, 'expected an object');
}
function fields(value, allowed, path) {
  object(value, path);
  for (const key of Object.keys(value)) if (!allowed.includes(key)) fail(path + '.' + key, 'unknown field');
}
function value(v, path) {
  if (typeof v !== 'string' || !v.trim() || v.length > 8000 || /[{};<>\u0000-\u001f]|@import/i.test(v)) fail(path, 'expected a nonempty CSS value without rule delimiters');
}
export function validateDesign(d, id = d?.id, { supports, selectorValid } = {}) {
  fields(d, ['$schema', 'version', 'id', 'label', 'description', 'tokens', 'layout', 'components', 'widgets'], 'theme');
  if (typeof id !== 'string' || !ID.test(id) || d.id !== id) fail('theme.id', 'must match requested theme id');
  if (d.version !== 1) fail('theme.version', 'must be 1');
  for (const key of ['label','description','$schema']) if (d[key] !== undefined && typeof d[key] !== 'string') fail('theme.' + key, 'expected a string');
  const warnings = [], tokens = {}, paths = {};
  fields(d.tokens || {}, TOKEN_GROUPS, 'tokens');
  function token(name, v, group, path, local = false) {
    if (!CUSTOM.test(name)) fail(path, 'invalid custom-property name');
    const canonical = canonicalToken(name), info = TOKEN_CONTRACT[canonical];
    if (group === 'palette') {
      if (!/^--palette-[a-z0-9][a-z0-9-]*$/.test(name)) fail(path, 'primitive names start with --palette-');
    } else if (group === 'overrides' && !(local && info)) {
      if (!/^--ds-[a-z0-9][a-z0-9-]*$/.test(name)) fail(path, 'deep overrides use inventoried --ds-* names');
    } else if (!local && (!info || info.group !== group)) fail(path, 'unknown semantic token or wrong group; register its role in design-contract.js');
    value(v, path);
    const cssProperty = group === 'palette' ? 'color' : info?.cssProperty;
    if (supports && cssProperty && !supports(cssProperty, v.replace(/\s*!important\s*$/, ''))) fail(path, 'invalid ' + cssProperty + ' token value');
    if (canonical !== name) warnings.push(path + ' uses legacy alias; prefer ' + canonical);
    return canonical;
  }
  for (const [group, values] of Object.entries(d.tokens || {})) {
    object(values, 'tokens.' + group);
    for (const [name, v] of Object.entries(values)) {
      const path = 'tokens.' + group + '.' + name, key = token(name, v, group, path);
      if (key in tokens) fail(path, 'duplicate role already defined at ' + paths[key]);
      tokens[key] = v; paths[key] = path;
    }
  }
  // References resolve through semantic aliases. Reject undefined roles and cycles.
  for (const [name, v] of Object.entries(tokens)) {
    for (const ref of refs(v)) if (!(ref in tokens)) fail(paths[name], 'undefined token reference ' + ref);
  }
  const visiting = new Set(), visited = new Set();
  function visit(name, chain = []) {
    if (visiting.has(name)) fail(paths[name], 'token reference cycle: ' + [...chain,name].join(' → '));
    if (visited.has(name)) return;
    visiting.add(name); for (const ref of refs(tokens[name])) visit(ref, [...chain,name]);
    visiting.delete(name); visited.add(name);
  }
  Object.keys(tokens).forEach(name => visit(name));
  function declarations(rules, path, local = {}) {
    object(rules, path);
    for (const [prop,v] of Object.entries(rules)) {
      if (!PROPERTY.test(prop)) fail(path + '.' + prop, 'invalid CSS property');
      value(v, path + '.' + prop);
      if (supports && !prop.startsWith('--') && !supports(prop, v.replace(/\s*!important\s*$/, ''))) fail(path + '.' + prop, 'unsupported or invalid CSS value');
      for (const ref of refs(v)) {
        if (!(ref in tokens) && !(ref in local) && (TOKEN_CONTRACT[ref] || /^--(palette|color|font|space|radius|surface|cursor)-/.test(ref))) fail(path + '.' + prop, 'undefined token reference ' + ref);
      }
    }
  }
  function selector(sel, path) {
    if (typeof sel !== 'string' || !sel.trim() || /[{};@<>]/.test(sel.replaceAll('>', ''))) fail(path, 'invalid selector');
    if(selectorValid && !selectorValid(sel))fail(path,'invalid or unsupported selector');
  }
  object(d.components || {}, 'components');
  for (const [name,c] of Object.entries(d.components || {})) {
    if (!ID.test(name)) fail('components.' + name, 'invalid component name');
    fields(c, ['description','selector','style'], 'components.' + name);
    if(c.description !== undefined && typeof c.description !== 'string')fail('components.'+name+'.description','expected a string');
    selector(c.selector, 'components.' + name + '.selector');
    declarations(c.style, 'components.' + name + '.style');
  }
  const columns = d.layout?.columns ?? 4;
  if (d.layout !== undefined) {
    fields(d.layout, ['columns','rowSize','align'], 'layout');
    if (!Number.isInteger(columns) || columns < 1 || columns > 12) fail('layout.columns', 'must be 1–12');
    if (d.layout.rowSize !== undefined) {
      value(d.layout.rowSize, 'layout.rowSize');
      if (supports && !supports('grid-auto-rows', d.layout.rowSize)) fail('layout.rowSize', 'invalid grid track');
    }
    if (d.layout.align !== undefined && !['start','end','center','stretch','space-between','space-around','space-evenly'].includes(d.layout.align)) fail('layout.align', 'invalid grid alignment');
  }
  object(d.widgets || {}, 'widgets');
  for (const [wid,w] of Object.entries(d.widgets || {})) {
    if (!ID.test(wid)) fail('widgets.' + wid, 'invalid widget id');
    const path = 'widgets.' + wid;
    fields(w, ['description','columns','rows','order','hidden','style','tokens','parts'], path);
    for (const [key,max] of [['columns',columns],['rows',20]]) if (w[key] !== undefined && (!Number.isInteger(w[key]) || w[key] < 1 || w[key] > max)) fail(path + '.' + key, 'invalid ' + key);
    if (w.order !== undefined && !Number.isInteger(w.order)) fail(path + '.order','expected an integer');
    if (w.hidden !== undefined && typeof w.hidden !== 'boolean') fail(path + '.hidden','expected a boolean');
    if(w.description !== undefined && typeof w.description !== 'string')fail(path+'.description','expected a string');
    object(w.tokens || {}, path + '.tokens');
    const local = {};
    for (const [name,v] of Object.entries(w.tokens || {})) {
      const key=token(name,v,'overrides',path+'.tokens.'+name,true);
      if(key in local)fail(path+'.tokens.'+name,'duplicate local role');
      local[key]=v;
    }
    declarations(w.tokens || {}, path + '.tokens', local);
    declarations(w.style || {}, path + '.style', local);
    object(w.parts || {}, path + '.parts');
    for (const [part,style] of Object.entries(w.parts || {})) {
      selector(part, path + '.parts.' + part); declarations(style, path + '.parts.' + part, local);
    }
  }
  return { tokens, warnings };
}
export function declarationsCSS(values) { return Object.entries(values).map(([p,v]) => p + ':' + v + ';').join(''); }
export function withAliases(values) {
  const result = { ...values };
  for (const [alias, canonical] of Object.entries(TOKEN_ALIASES)) if (canonical in values) result[alias] = 'var(' + canonical + ')';
  return result;
}
export function compileDesign(d, id = 'classic', options = {}) {
  const { tokens } = validateDesign(d, id, options), scope = 'html[data-theme="' + id + '"]';
  let css = scope + '{' + declarationsCSS(withAliases(tokens)) + '}';
  const style = (sel, props) => { css += scope + '{' + sel + '{' + declarationsCSS(props) + '}}'; };
  for (const c of Object.values(d.components || {})) style(c.selector, c.style);
  if (d.layout) style('body[data-dash="main"] #garden', {
    'grid-template-columns': 'repeat(' + (d.layout.columns ?? 4) + ', minmax(0, 1fr))',
    'grid-auto-rows': d.layout.rowSize || 'minmax(60px, auto)', 'overflow-y':'auto', 'align-content':d.layout.align || 'start',
  });
  for (const [wid,w] of Object.entries(d.widgets || {})) {
    const sel = 'body[data-dash="main"] #garden > [data-wid="' + wid + '"]', rule = {};
    if(w.columns !== undefined) rule['grid-column'] = 'span ' + w.columns;
    if(w.rows !== undefined) rule['grid-row'] = 'span ' + w.rows;
    if(w.order !== undefined) rule.order = w.order + ' !important';
    if(w.hidden === true) rule.display = 'none';
    const local = Object.fromEntries(Object.entries(w.tokens || {}).map(([k,v])=>[canonicalToken(k),v]));
    style(sel, { ...rule, ...w.style, ...withAliases(local) });
    for(const [part,props] of Object.entries(w.parts || {})) style(sel + ' :is(' + part + ')',props);
  }
  return css;
}
