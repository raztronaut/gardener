import { HOUSE, HOUSE_RESIDENTS } from './house-info.js';

const KEY = 'garden.todos.v1';
const INITIAL = { id: 'gui-install-host-docs', title: 'finish agent setup', assignees: ['gui'], command: 'sudo bash /home/talbot/gardener-github/scripts/install-host-docs.sh', terminalHint: true, done: false };

export function normalizeAssignees(values) {
  const people = [HOUSE, ...HOUSE_RESIDENTS];
  const ids = new Set((Array.isArray(values) ? values : []).map(value => people.find(person => person.id === value || person.name.toLowerCase() === String(value).toLowerCase())?.id).filter(Boolean));
  if (ids.has(HOUSE.id) || !ids.size) return [HOUSE.id];
  return HOUSE_RESIDENTS.filter(person => ids.has(person.id)).map(person => person.id);
}

export function assigneeLabel(task) {
  const ids = normalizeAssignees(task.assignees ?? (task.assignee ? [task.assignee] : []));
  if (ids.includes(HOUSE.id)) return HOUSE.name;
  if (ids.length === HOUSE_RESIDENTS.length) return 'All';
  return HOUSE_RESIDENTS.filter(person => ids.includes(person.id)).map(person => person.name).join(', ');
}

function normalizeTask(task) {
  const { assignee, ...rest } = task;
  const title = task.id === INITIAL.id && task.title === 'Finish agent setup' ? INITIAL.title : task.title;
  return { ...rest, title, assignees: normalizeAssignees(task.assignees ?? (assignee ? [assignee] : [])) };
}

export function readTasks() {
  try {
    const raw = localStorage.getItem(KEY), tasks = JSON.parse(raw);
    if (Array.isArray(tasks) && tasks.every(task => task && typeof task.id === 'string' && typeof task.title === 'string')) {
      const normalized = tasks.map(normalizeTask), next = JSON.stringify(normalized);
      // Persist a legacy-name migration without changing any completion state.
      if (raw !== next) { try { localStorage.setItem(KEY, next); } catch { /* Reading still works. */ } }
      return normalized;
    }
  } catch { /* A new browser starts with the requested setup task. */ }
  return [normalizeTask(INITIAL)];
}

export function saveTasks(tasks) {
  localStorage.setItem(KEY, JSON.stringify(tasks.map(normalizeTask)));
  window.dispatchEvent(new Event('garden:todos-changed'));
}
export function setTodoDone(id, done) { saveTasks(readTasks().map(task => task.id === id ? { ...task, done: !!done } : task)); }
export function subscribeTasks(fn) {
  const storage = event => { if (event.key === KEY) fn(); };
  window.addEventListener('garden:todos-changed', fn); window.addEventListener('storage', storage);
  return () => { window.removeEventListener('garden:todos-changed', fn); window.removeEventListener('storage', storage); };
}
