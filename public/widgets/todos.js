// Household to-dos live in this wall browser, independently of daily tending.
const STORAGE_KEY = 'garden.todos.v1';
const SETUP_COMMAND = 'sudo bash /home/talbot/gardener-github/scripts/install-host-docs.sh';
const INITIAL_TASK = {
  id: 'gui-install-host-docs',
  title: 'Finish agent setup',
  assignee: 'Gui',
  command: SETUP_COMMAND,
  terminalHint: true,
  done: false,
};

function readTasks() {
  try {
    const tasks = JSON.parse(localStorage.getItem(STORAGE_KEY));
    if (Array.isArray(tasks) && tasks.every(t => t && typeof t.id === 'string' && typeof t.title === 'string')) return tasks;
  } catch { /* A new browser starts with the real requested task below. */ }
  return [{ ...INITIAL_TASK }];
}

async function copyCommand(command) {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(command);
      return;
    }
  } catch { /* Older kiosk builds can use the gesture-based fallback. */ }
  const focused = document.activeElement;
  const field = document.createElement('textarea');
  field.value = command;
  field.setAttribute('aria-label', 'Command to copy');
  field.style.cssText = 'position:fixed;left:-9999px;top:0';
  document.body.append(field);
  try {
    field.select();
    if (!document.execCommand('copy')) throw Error('Copy unavailable');
  } finally {
    field.remove();
    focused?.focus({ preventScroll: true });
  }
}

function render(body, ctx, full = false) {
  const { h } = ctx;
  ctx.style(`
    .todo-root{display:flex;flex-direction:column;gap:14px;min-height:0;height:100%;font-family:var(--font-body)}
    .todo-list{display:flex;flex-direction:column;gap:18px;min-height:0}
    .todo-task{display:flex;flex-direction:column;gap:10px;min-width:0}
    .todo-owner,.todo-hint,.todo-copy-status,.todo-more{font-size:15px;line-height:1.4;color:var(--color-text-muted)}
    .todo-title{font-family:var(--font-heading);font-size:28px;line-height:1.15;color:var(--color-text-primary)}
    .todo-command{display:flex;flex-direction:column;gap:8px;align-items:stretch;text-align:left;width:100%;padding:12px;border:1px solid var(--stroke);border-radius:var(--radius-button,12px);background:var(--color-canvas-raised);color:var(--color-text-primary);font:inherit;cursor:pointer}
    .todo-command code{font:inherit;font-size:17px;line-height:1.35;overflow-wrap:anywhere;white-space:normal}
    .todo-copy-label{font-size:13px;color:var(--color-accent)}
    .todo-command:hover,.todo-add button:hover{border-color:var(--color-accent)}
    .todo-command:focus-visible,.todo-add button:focus-visible,.todo-add input:focus-visible,.todo-check input:focus-visible{outline:2px solid var(--color-accent);outline-offset:3px}
    .todo-copy-status{min-height:1.4em;margin:0}
    .todo-hint{margin:0}
    .todo-hint strong{font-weight:600;color:var(--color-text-primary)}
    .todo-check{display:flex;align-items:center;gap:10px;font-size:16px;cursor:pointer;width:fit-content}
    .todo-check input{width:20px;height:20px;accent-color:var(--color-accent);cursor:pointer;margin:0}
    .todo-task.is-done .todo-title{text-decoration:line-through;color:var(--color-text-muted)}
    .todo-full{height:auto;min-height:100%;padding:20px;gap:30px}
    .todo-full .todo-list{gap:30px}
    .todo-full .todo-task{padding-bottom:24px;border-bottom:1px solid var(--stroke)}
    .todo-add{display:flex;gap:10px;flex-wrap:wrap}
    .todo-add input{flex:1;min-width:180px;background:var(--color-canvas-raised);color:var(--color-text-primary);border:1px solid var(--stroke);border-radius:12px;padding:12px;font:inherit}
    .todo-add button{border:1px solid var(--stroke);border-radius:12px;padding:12px 20px;background:var(--color-canvas-raised);color:var(--color-text-primary);font:inherit;cursor:pointer}
  `);
  const root = h('div', { class: `todo-root${full ? ' todo-full' : ''}` });
  const list = h('div', { class: 'todo-list' });
  const storageStatus = h('p', { class: 'todo-copy-status', role: 'status', hidden: true });
  root.append(list, storageStatus);
  body.replaceChildren(root);
  let previous = '';

  function save(tasks) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(tasks)); }
    catch { storageStatus.hidden = false; storageStatus.textContent = 'Could not save. Browser storage is unavailable.'; return false; }
    draw(true);
    return true;
  }

  function taskRow(task) {
    const checkbox = h('input', { type: 'checkbox', 'aria-label': `Mark ${task.title} complete` });
    checkbox.checked = !!task.done;
    checkbox.addEventListener('click', e => e.stopPropagation());
    checkbox.addEventListener('change', () => {
      if (!save(readTasks().map(t => t.id === task.id ? { ...t, done: checkbox.checked } : t))) checkbox.checked = !!task.done;
    });
    const row = h('article', { class: `todo-task${task.done ? ' is-done' : ''}` },
      task.assignee ? h('div', { class: 'todo-owner' }, `For ${task.assignee} · when you see this`) : null,
      h('div', { class: 'todo-title' }, task.title));
    if (task.command) {
      const label = h('span', { class: 'todo-copy-label' }, 'Click command to copy');
      const status = h('span', { class: 'todo-copy-status', role: 'status' });
      const button = h('button', { type: 'button', class: 'todo-command', 'aria-label': 'Copy setup command' }, h('code', {}, task.command), label);
      button.addEventListener('click', async e => {
        e.stopPropagation();
        try { await copyCommand(task.command); label.textContent = 'Copied'; status.textContent = 'Paste into your Paseo terminal and press Enter.'; }
        catch { label.textContent = 'Copy unavailable'; status.textContent = 'Select the command and copy it manually.'; }
      });
      row.append(button, status);
    }
    if (task.terminalHint) row.append(h('p', { class: 'todo-hint' },
      'In this Paseo workspace, open a terminal with ', h('strong', {}, 'Ctrl + Shift + T'),
      ' or click ', h('strong', {}, '+ → Terminal'), ' in the workspace toolbar. Enter your password in the terminal.'));
    const checkLabel = h('label', { class: 'todo-check', onclick: e => e.stopPropagation() }, checkbox, task.done ? 'Completed' : task.command ? 'Mark done after running' : 'Mark done');
    row.append(checkLabel);
    return row;
  }

  function draw(force = false) {
    const tasks = readTasks(), signature = JSON.stringify(tasks);
    if (!force && signature === previous) return;
    previous = signature;
    const pending = tasks.filter(t => !t.done), visible = full ? [...pending, ...tasks.filter(t => t.done)] : pending.slice(0, 1);
    list.replaceChildren(...visible.map(taskRow));
    if (!visible.length) list.append(h('div', { class: 'todo-title' }, 'All done'), h('p', { class: 'todo-hint' }, full ? 'Add another task below.' : 'Open to see completed tasks or add a new one.'));
    if (!full && pending.length > 1) list.append(h('div', { class: 'todo-more' }, `+ ${pending.length - 1} more · open to view`));
  }

  if (full) {
    const input = h('input', { type: 'text', maxlength: '200', placeholder: 'Add a to-do', 'aria-label': 'New to-do', required: true });
    const form = h('form', { class: 'todo-add' }, input, h('button', { type: 'submit' }, 'Add task'));
    form.addEventListener('submit', e => {
      e.preventDefault();
      const title = input.value.trim();
      if (!title) return;
      if (save([...readTasks(), { id: crypto.randomUUID(), title, done: false }])) input.value = '';
    });
    root.append(form);
  }
  draw();
  ctx.interval(() => draw(), 1000);
}

export default {
  id: 'todos', title: 'To do', size: 'md', homeSize: 'medium', chrome: true,
  mount: (body, ctx) => render(body, ctx),
  openFull: (body, ctx) => render(body, ctx, true),
};
