import { isClean } from '../widgets/hacker-news.js';

// Real headlines are sourced live. Invented headlines are authored fiction, never news.
const FAKES = [
  'I replaced my Kubernetes cluster with a single SQLite database',
  'Show HN: A compiler that explains its errors as gardening advice',
  'The lost Unix workstation that ran entirely from a bicycle dynamo',
  'We measured the carbon footprint of every semicolon in our codebase',
  'A spreadsheet implementation of the original Macintosh operating system',
  'Ask HN: Has anyone successfully migrated their family group chat to IRC?',
  'The surprisingly difficult problem of sorting a billion rubber ducks',
  'I built a mechanical keyboard that gets quieter when you write better code',
  'Show HN: Version control for sourdough starter',
  'Running a distributed database on sixteen smart doorbells',
  'My home server has been cooled by a garden pond for eleven years',
  'Why our startup replaced its daily standup with a chess position',
];
const shuffle = (xs) => { const a = [...xs]; for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(Math.random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; } return a; };
// Reserve three real answers for prior days, excluding the visible front page.
// A 48-hour cutoff avoids today's headlines regardless of the wall's timezone.
export function selectRealStories(current, historical, now = Date.now()) {
  const visibleIds = new Set(current.map(s => String(s.id)));
  const visibleTitles = new Set(current.map(s => s.title?.trim().toLowerCase()));
  const seenIds = new Set(), seenTitles = new Set();
  const valid = (s) => {
    const title = s?.title?.trim().toLowerCase();
    if (!title || !/^\d+$/.test(String(s.id)) || !isClean(s.title) || s.deleted || s.dead || seenIds.has(String(s.id)) || seenTitles.has(title)) return false;
    seenIds.add(String(s.id)); seenTitles.add(title); return true;
  };
  const older = shuffle(historical.filter(s => s && Number.isFinite(s.time) && s.time < now / 1000 - 2 * 86400 && !visibleIds.has(String(s.id)) && !visibleTitles.has(s.title?.trim().toLowerCase())).filter(valid));
  if (older.length < 3) throw new Error('Not enough older headlines');
  const recent = shuffle(current.filter(valid));
  return [...older.slice(0, 3), ...recent.slice(0, 3), ...older.slice(3)].slice(0, 6);
}
export async function fetchHistoricalStories(now = Date.now()) {
  const end = Math.floor(now / 1000) - 2 * 86400;
  const params = new URLSearchParams({ tags: 'story', numericFilters: `created_at_i>${end - 28 * 86400},created_at_i<${end},points>30`, hitsPerPage: '100' });
  const url = `https://hn.algolia.com/api/v1/search?${params}`;
  const response = await fetch(`/api/proxy?url=${encodeURIComponent(url)}`, { signal: AbortSignal.timeout(15000) });
  if (!response.ok) throw new Error('Historical headlines unavailable');
  const data = await response.json();
  return (data.hits || []).map(s => ({ id: s.objectID, title: s.title, time: s.created_at_i }));
}
let active = null;
export function guess(word) { if (active?.root.isConnected) active.act(word); }
export async function openGame({ h, openPanel, fetchStories, fetchHistory = fetchHistoricalStories }) {
  const root = h('div', { class: 'headline-game' }, h('p', {}, 'Gathering headlines from today and previous days…'));
  openPanel('Real or fake? · Hacker News', root);
  let stories;
  try {
    const [current, historical] = await Promise.all([fetchStories(), fetchHistory()]);
    stories = selectRealStories(current, historical);
  } catch { stories = []; }
  if (!stories.length) { root.replaceChildren(h('p', {}, 'Could not gather enough headlines from previous days. Close this panel and try again shortly.')); return; }
  if (!root.isConnected) return;
  let score = { correct: 0, total: 0 };
  try { const s = JSON.parse(localStorage.getItem('garden.headlines.score')); if (Number.isSafeInteger(s?.total) && Number.isSafeInteger(s?.correct) && s.correct >= 0 && s.total >= s.correct) score = s; } catch { /* fresh score */ }
  const deck = shuffle([...stories.map((s) => ({ title: s.title, real: true, id: s.id })), ...shuffle(FAKES).slice(0, Math.min(6, stories.length)).map((title) => ({ title, real: false }))]);
  let index = 0, answered = false;
  function round() {
    answered = false;
    if (index >= deck.length) { root.replaceChildren(h('h2', {}, 'That’s the round.'), h('p', {}, `Household total: ${score.correct} / ${score.total}`), h('p', {}, 'Play again for another mix of recent and older headlines.')); return; }
    const item = deck[index];
    const result = h('div', { class: 'headline-result', 'aria-live': 'polite' });
    const choices = h('div', { class: 'headline-choices' });
    function answer(real) {
      if (answered) return; answered = true;
      score.total++; if (real === item.real) score.correct++;
      try { localStorage.setItem('garden.headlines.score', JSON.stringify(score)); } catch { /* storage unavailable */ }
      choices.querySelectorAll('button').forEach((b) => { b.disabled = true; });
      result.append(h('h2', {}, real === item.real ? 'You got it.' : 'It fooled you.'), h('p', {}, item.real ? 'Real — a headline posted to Hacker News.' : 'Fake — invented for this game.'), h('p', {}, `Household total: ${score.correct} / ${score.total}`));
      if (item.real) result.append(h('a', { href: `https://news.ycombinator.com/item?id=${item.id}`, target: '_blank', rel: 'noopener noreferrer' }, 'See the original HN post ↗'));
      result.append(h('button', { type: 'button', onClick: () => { index++; round(); } }, 'Next headline →'));
    }
    active = { root, act: (word) => { if (word === 'real' || word === 'fake') answer(word === 'real'); else if (word === 'next' && answered) { index++; round(); } } };
    choices.append(h('button', { type: 'button', onClick: () => answer(true) }, 'Real'), h('button', { type: 'button', onClick: () => answer(false) }, 'Fake'));
    root.replaceChildren(h('p', { class: 'headline-progress' }, `Headline ${index + 1} of ${deck.length} · household ${score.correct}/${score.total}`), h('h2', { class: 'headline-title' }, item.title), choices, result);
  }
  round();
}
