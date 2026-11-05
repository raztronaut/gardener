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
let active = null;
export function guess(word) { if (active?.root.isConnected) active.act(word); }
export async function openGame({ h, openPanel, fetchStories }) {
  const root = h('div', { class: 'headline-game' }, h('p', {}, 'Gathering today’s headlines…'));
  openPanel('Real or fake? · Hacker News', root);
  let stories;
  try { stories = await fetchStories(); } catch { stories = []; }
  if (!stories.length) { root.replaceChildren(h('p', {}, 'Hacker News is unreachable. Close this panel and try again shortly.')); return; }
  if (!root.isConnected) return;
  let score = { correct: 0, total: 0 };
  try { const s = JSON.parse(localStorage.getItem('garden.headlines.score')); if (Number.isSafeInteger(s?.total) && Number.isSafeInteger(s?.correct) && s.correct >= 0 && s.total >= s.correct) score = s; } catch { /* fresh score */ }
  const deck = shuffle([...shuffle(stories).slice(0, 6).map((s) => ({ title: s.title, real: true, id: s.id })), ...shuffle(FAKES).slice(0, Math.min(6, stories.length)).map((title) => ({ title, real: false }))]);
  let index = 0, answered = false;
  function round() {
    answered = false;
    if (index >= deck.length) { root.replaceChildren(h('h2', {}, 'That’s the round.'), h('p', {}, `Household total: ${score.correct} / ${score.total}`), h('p', {}, 'Play again later for a fresh front page.')); return; }
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
