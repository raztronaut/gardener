import { sizeAvailable } from '../public/lib/widget-variants.js';
// Deliberately narrow grammar: unmatched or ambiguous speech always uses the agent.
export function directAction(text) {
  const t = String(text).toLowerCase().trim().replace(/[.!?]+$/, '').replace(/\s+/g, ' ');
  const layout = directLayout(t);
  if (layout) return {name:'layout',input:{changes:[layout]}};
  const widgets = { weather: 'weather', 'air quality': 'air-quality', 'hacker news': 'hacker-news', fractal: 'fractal', clock: 'clock', gardyn: 'gardyn', transit:'transit', 'nearby transit':'transit' };
  let m = t.match(/^(?:open|show)(?: me)?(?: the)? (weather|air quality|hacker news|fractal|clock|gardyn|transit|nearby transit)$/);
  if (m) return { name: 'open', input: { target: widgets[m[1]] } };
  if (/^(?:close(?: the panel)?|go back|never mind)$/.test(t)) return { name: 'close', input: {} };
  if (/^(?:go home|show the wall|back to the wall)$/.test(t)) return { name: 'dashboard', input: { id: 'main' } };
  if (/^(?:stop|cancel)(?: the)? (?:timer|countdown)$/.test(t)) return { name: 'command', input: { name: 'timer', arg: 'off' } };
  m = t.match(/^(?:start|set)(?: a)? (?:timer|countdown) for (\d{1,3}|one|two|three|four|five|ten) (seconds?|minutes?)$/);
  if (m) { const n = Number(m[1]) || ({one:1,two:2,three:3,four:4,five:5,ten:10})[m[1]]; if (n > 0) return { name:'command', input:{name:'timer',arg:m[2].startsWith('second') ? `${n}s` : String(n)} }; }
  m = t.match(/^(?:open|show)(?: the)? (rss|feed reader|headlines game)$/);
  if (m) return {name:'command',input:{name:m[1] === 'headlines game' ? 'headlines' : 'rss',arg:''}};
  m = t.match(/^(?:turn )?(?:garden )?mood (on|off)$/);
  if (m) return {name:'command', input:{name:'mood',arg:m[1]}};
  return null;
}

const NAMES = {'weather':'weather','air':'air-quality','air quality':'air-quality','hacker news':'hacker-news','news':'hacker-news','painting':'daily','painting of the day':'daily','fractal':'fractal','clock':'clock','time':'clock','gardyn':'gardyn','garden':'gardyn','events':'sf-events','out in sf':'sf-events'};
const number = s => ({one:1,two:2,three:3,four:4,five:5,six:6,seven:7,eight:8,nine:9,ten:10})[s] || Number(s);
const target = s => NAMES[String(s).replace(/^the /,'').replace(/ widget$/,'').trim()];
export function isLayoutRequest(text) {
  return /\b(widget|page|resize|reorder|rearrange)\b/i.test(text) || /^(?:make|move|put|remove|hide|add|restore) (?:the )?(?:weather|air|clock|time|news|hacker news|painting|fractal|gardyn|garden|events)\b/i.test(text);
}
export function directLayout(text) {
  const t=String(text).toLowerCase().trim().replace(/[.!?]+$/,'').replace(/\s+/g,' ');
  let m;
  if(/^(?:next|previous|last) page$/.test(t))return {action:'page',page:t.startsWith('next')?'next':'previous'};
  if((m=t.match(/^(?:go to|show|switch to|open) page (\d+|one|two|three|four|five|six|seven|eight|nine|ten)$/)))return {action:'page',page:number(m[1])};
  if(/^(?:add|create)(?: a| another| new)? page$/.test(t))return {action:'add_page'};
  if((m=t.match(/^(?:remove|delete) page (\d+|one|two|three|four|five)$/)))return {action:'remove_page',page:number(m[1])};
  if(/^(?:edit|arrange|rearrange)(?: the| my)? widgets$/.test(t))return {action:'edit'};
  if(/^(?:done editing|finish editing|stop editing|finish arranging)$/.test(t))return {action:'done'};
  if((m=t.match(/^(?:make|resize) (.+?) (?:to )?(small|medium|wide|tall|large|smaller|bigger|taller|wider)(?: size)?$/))&&target(m[1])){const size=({smaller:'small',bigger:'large',taller:'tall',wider:'wide'})[m[2]]||m[2];if(['smaller','bigger','taller','wider'].includes(m[2])&&!sizeAvailable(target(m[1]),size))return null;return {action:'resize',widget:target(m[1]),size};}
  if((m=t.match(/^(?:make|resize) (.+?) (?:to )?(two|four|2|4) (?:by|x) (one|two|three|four|1|2|3|4)$/))&&target(m[1]))return {action:'resize',widget:target(m[1]),columns:number(m[2]),rows:number(m[3])};
  if((m=t.match(/^(?:move|put|add|restore) (.+?) (?:to|on) page (\d+|one|two|three|four|five)$/))&&target(m[1]))return {action:t.startsWith('add')||t.startsWith('restore')?'add':'move',widget:target(m[1]),page:number(m[2])};
  if((m=t.match(/^(remove|hide|add|restore) (.+)$/))&&target(m[2]))return {action:['remove','hide'].includes(m[1])?'remove':'add',widget:target(m[2])};
  if((m=t.match(/^(?:move|put) (.+?) (before|after) (.+)$/))&&target(m[1])&&target(m[3]))return {action:'reorder',widget:target(m[1]),[m[2]]:target(m[3])};
  return null;
}
