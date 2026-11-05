// A click asks the backend to explain a fixed task; generated text is never HTML.
const KEY = 'garden.todo-explanation.v1';
let saved, pending;
function savedAnswer() {
  if (saved) return saved;
  try {
    const value = JSON.parse(localStorage.getItem(KEY));
    if (typeof value?.explanation === 'string' && value.explanation.length <= 6000) saved = value;
  } catch { /* Local storage is optional. */ }
  return saved;
}

export function taskExplainer(h) {
  const answer = savedAnswer();
  const root = h('section', { class: 'todo-ai', 'aria-label': 'Ask AI about this task' });
  const button = h('button', { type: 'button', class: 'todo-ai-ask' }, answer ? 'Ask AI again' : 'Ask AI what this does');
  const status = h('p', { class: 'todo-hint', role: 'status' }, 'Reads the installer and its guide files. Explains here.');
  const result = h('div', { class: 'todo-ai-result', hidden: !answer, 'aria-label': 'AI explanation', 'aria-live': 'polite' });
  const paint = value => {
    result.hidden = false;
    result.replaceChildren(h('div', { class: 'todo-ai-heading' }, 'Garden’s take'),
      ...value.explanation.split(/\n\s*\n/).map(text => h('p', {}, text)),
      h('p', { class: 'todo-hint' }, 'Based on the installer + three guide files. Explaining only; nothing was run.'));
  };
  if (answer) paint(answer);
  root.append(button, status, result);
  button.addEventListener('click', async event => {
    event.preventDefault(); event.stopPropagation();
    button.disabled = true; button.textContent = 'Reading the installer…';
    status.textContent = 'Getting a short explanation for Gui…';
    try {
      pending ||= (async () => {
        const response = await fetch('/api/todos/explain', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: 'gui-install-host-docs' }), signal: AbortSignal.timeout(25000),
        });
        let value;
        try { value = await response.json(); }
        catch { throw Error('AI could not answer right now. Please try again.'); }
        if (!response.ok || typeof value.explanation !== 'string') throw Error(value.error || 'AI is unavailable right now.');
        saved = value;
        try { localStorage.setItem(KEY, JSON.stringify(value)); } catch { /* Answer still works in memory. */ }
        return value;
      })().finally(() => { pending = null; });
      paint(await pending);
      status.textContent = 'Explanation ready. You can still ask questions in Paseo if you want a deeper review.';
    } catch (error) {
      status.textContent = error.name === 'TimeoutError' ? 'AI took too long. Try again in a moment.' : error.message;
    } finally {
      button.disabled = false; button.textContent = savedAnswer() ? 'Ask AI again' : 'Try asking AI again';
    }
  });
  return root;
}
