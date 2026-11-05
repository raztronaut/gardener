import test, { beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { HOUSE_RESIDENTS } from '../public/lib/house-info.js';
import { readTasks, saveTasks, normalizeAssignees, assigneeLabel, setTodoDone, subscribeTasks } from '../public/lib/todo-store.js';

beforeEach(() => {
  const items = new Map();
  globalThis.localStorage = { getItem: key => items.get(key) ?? null, setItem: (key, value) => items.set(key, value) };
  globalThis.window = new EventTarget();
});

test('legacy assignments migrate without losing completed state, task content, or setup actions', () => {
  localStorage.setItem('garden.todos.v1', JSON.stringify([
    { id: 'gui-install-host-docs', title: 'Finish agent setup', assignee: 'Gui', done: true, command: 'keep this command', terminalHint: true },
    { id: 'shared', title: 'Take out the trash', done: false },
  ]));
  const [gui, house] = readTasks();
  assert.deepEqual(gui.assignees, ['gui']); assert.equal(gui.title, 'finish agent setup');
  assert.equal(gui.done, true); assert.equal(gui.command, 'keep this command'); assert.equal(gui.terminalHint, true);
  assert.deepEqual(house.assignees, ['house']); assert.equal(house.done, false);
  assert(!('assignee' in JSON.parse(localStorage.getItem('garden.todos.v1'))[0]));
});

test('multi-selection is canonical, All means all residents, and House is a shared assignment', () => {
  assert.deepEqual(normalizeAssignees(['Param', 'gui', 'gui', 'unknown']), ['gui', 'param']);
  assert.deepEqual(normalizeAssignees(['house', 'gui']), ['house']);
  assert.deepEqual(normalizeAssignees([]), ['house']);
  assert.equal(assigneeLabel({ assignees: HOUSE_RESIDENTS.map(person => person.id) }), 'All');
  assert.equal(assigneeLabel({ assignees: ['gui', 'param'] }), 'Gui, Param');
  assert.equal(assigneeLabel({ assignees: ['house'] }), 'House');
});

test('editing assignments and completing tasks preserves selections and notifies mounted views', () => {
  let updates = 0; const stop = subscribeTasks(() => updates++);
  saveTasks([{ id: 'task', title: 'Stock the kitchen', assignees: ['max', 'herbie'], done: false }]);
  setTodoDone('task', true);
  assert.deepEqual(readTasks()[0].assignees, ['max', 'herbie']); assert.equal(readTasks()[0].done, true);
  assert.equal(updates, 2); stop();
  saveTasks(readTasks()); assert.equal(updates, 2);
});
