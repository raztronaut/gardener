// Deliberately narrow grammar: unmatched or ambiguous speech always uses the agent.
export function directAction(text) {
  const t = String(text).toLowerCase().trim().replace(/[.!?]+$/, '').replace(/\s+/g, ' ');
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
