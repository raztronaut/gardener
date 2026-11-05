import { HOUSE, HOUSE_RESIDENTS } from './house-info.js';
import { normalizeAssignees, assigneeLabel } from './todo-store.js';

// One row format for default tiles, size variants, previews, and task details.
export function todoTaskText(h, task) {
  const name = assigneeLabel(task);
  return h('span', { class: 'todo-title todo-assigned-line', title: `${name}: ${task.title}` },
    h('strong', { class: 'todo-assignee-name' }, `${name}: `), task.title);
}

// Native disclosure keeps the picker keyboard-accessible without a UI library.
export function assigneePicker(h, { value = [HOUSE.id], label = 'Assign to', onChange = () => true } = {}) {
  let selected = normalizeAssignees(value);
  const details = h('details', { class: 'todo-assignees' });
  const summary = h('summary', { 'aria-label': label });
  const menu = h('div', { class: 'todo-assignee-menu', role: 'group', 'aria-label': label });
  const checks = new Map();
  const sync = () => {
    summary.textContent = assigneeLabel({ assignees: selected });
    for (const [id, input] of checks) input.checked = selected.includes(id);
  };
  const choose = next => {
    const normalized = normalizeAssignees(next);
    if (onChange(normalized) !== false) selected = normalized;
    sync();
  };
  const all = h('button', { type: 'button', class: 'todo-assignee-all', onclick: () => choose(HOUSE_RESIDENTS.map(person => person.id)) }, 'All');
  menu.append(h('div', { class: 'todo-assignee-tools' }, h('span', {}, 'Assign to'), all));
  for (const person of [HOUSE, ...HOUSE_RESIDENTS]) {
    const input = h('input', { type: 'checkbox', value: person.id, 'aria-label': person.name });
    input.addEventListener('change', () => {
      if (person.id === HOUSE.id) choose([HOUSE.id]);
      else choose(input.checked ? [...selected.filter(id => id !== HOUSE.id), person.id] : selected.filter(id => id !== person.id));
    });
    checks.set(person.id, input);
    menu.append(h('label', { class: 'todo-assignee-option' }, input, person.name, person.id === HOUSE.id ? h('span', { class: 'todo-hint' }, 'shared') : null));
  }
  details.append(summary, menu);
  details.addEventListener('click', event => event.stopPropagation());
  details.addEventListener('toggle', () => {
    if (!details.open) return;
    details.dataset.placement = 'below';
    requestAnimationFrame(() => {
      const bottom = Math.min(window.innerHeight - 16, details.closest('.panel-body')?.getBoundingClientRect().bottom ?? window.innerHeight - 16);
      if (menu.getBoundingClientRect().bottom > bottom) details.dataset.placement = 'above';
    });
  });
  sync();
  return { element: details, value: () => [...selected] };
}

// These listeners retain no task nodes; closed fullscreens cannot leak pickers.
if (typeof document !== 'undefined') {
  document.addEventListener('pointerdown', event => {
    for (const picker of document.querySelectorAll('.todo-assignees[open]')) if (!picker.contains(event.target)) picker.open = false;
  });
  document.addEventListener('keydown', event => {
    if (event.key !== 'Escape') return;
    const open = [...document.querySelectorAll('.todo-assignees[open]')];
    if (!open.length) return;
    event.preventDefault(); event.stopImmediatePropagation();
    for (const picker of open) picker.open = false;
    open[0].querySelector('summary')?.focus();
  }, true);
}
