// The wall opens a real Paseo conversation; the answer and follow-ups live there.
let pending;
export function taskExplainer(h) {
  const root = h('section', { class: 'todo-ai', 'aria-label': 'Ask about this task in Paseo' });
  const button = h('button', { type: 'button', class: 'todo-ai-ask' }, 'Ask in Paseo');
  const status = h('p', { class: 'todo-hint', role: 'status' }, 'Opens a Paseo chat in this workspace with your setup question already sent. Continue the conversation there.');
  root.append(button, status);
  button.addEventListener('click', async event => {
    event.preventDefault(); event.stopPropagation();
    button.disabled = true; button.textContent = 'Opening Paseo…';
    status.textContent = 'Preparing your setup conversation…';
    try {
      pending ||= (async () => {
        const response = await fetch('/api/todos/paseo', {
          method: 'POST', headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ id: 'gui-install-host-docs' }), signal: AbortSignal.timeout(60000),
        });
        let chat;
        try { chat = await response.json(); }
        catch { throw Error('Paseo could not open the chat right now. Please try again.'); }
        if (!response.ok || !chat.agentId) throw Error(chat.error || 'Paseo is unavailable right now.');
        return chat;
      })().finally(() => { pending = null; });
      const chat = await pending;
      if (!chat.opened) throw Error(chat.error);
      button.textContent = 'Reopen Paseo chat';
      status.textContent = `Opened “${chat.title}” in Paseo. Type a reply in that chat to ask follow-up questions.`;
    } catch (error) {
      status.textContent = error.name === 'TimeoutError' ? 'Paseo is taking a while. Try again; an existing setup chat will be reused.' : error.message;
      button.textContent = 'Try opening Paseo again';
    } finally { button.disabled = false; }
  });
  return root;
}
