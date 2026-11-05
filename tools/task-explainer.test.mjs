import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSetupChatOpener } from '../src/task-explainer.mjs';
const ID = '12345678-1234-1234-1234-123456789abc';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'garden-paseo-task-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'scripts')); await mkdir(join(root, 'docs/host'), { recursive: true });
  for (const file of ['scripts/install-host-docs.sh', 'docs/host/AGENTS.md', 'docs/host/CLAUDE.md', 'docs/host/GARDENOS.md']) await writeFile(join(root, file), 'documentation installer fixture');
  await writeFile(join(root, '.env'), 'PRIVATE_MUST_NOT_BE_SENT');
  return { root, stateFile: join(root, 'state/chat.json') };
}

test('one real chat per task, even for simultaneous clicks; persisted chat is reopened after restart', async t => {
  const options = await fixture(t), calls = [];
  const run = async args => { calls.push(args); await new Promise(r => setTimeout(r, 10)); return args[0] === 'run' ? ID+'\n' : '{}'; };
  const open = createSetupChatOpener({ ...options, run });
  const [a, b] = await Promise.all([open('gui-install-host-docs'), open('gui-install-host-docs')]);
  assert.equal(a.agentId, ID); assert.equal(b.agentId, ID); assert(a.opened); assert.equal(calls.length, 2);
  const create = calls[0]; assert(create.includes('--no-wait')); assert(create.includes('plan')); assert(create.includes('claude-haiku-5-5'));
  assert(create.at(-1).includes('Do not execute the installer')); assert(!create.at(-1).includes('PRIVATE_MUST_NOT_BE_SENT'));
  assert.deepEqual(calls[1], ['agent', 'open', ID, '--json']);
  const reopen = createSetupChatOpener({ ...options, run });
  assert.equal((await reopen('gui-install-host-docs')).created, false);
  assert.equal(calls.length, 3); assert.equal(calls.filter(a => a[0] === 'run').length, 1);
});

test('a failed desktop handoff reuses the chat on retry rather than creating a duplicate', async t => {
  const options = await fixture(t); let creations = 0, opens = 0;
  const open = createSetupChatOpener({ ...options, run: async args => {
    if (args[0] === 'run') { creations++; return ID; }
    if (++opens === 1) throw Error('desktop unavailable');
    return '{}';
  } });
  assert.equal((await open('gui-install-host-docs')).opened, false);
  assert.equal((await open('gui-install-host-docs')).opened, true);
  assert.equal(creations, 1); assert.equal(opens, 2);
});

test('unknown tasks and missing source files cannot launch a chat; creation failures can be retried', async t => {
  const options = await fixture(t); let calls = 0;
  const open = createSetupChatOpener({ ...options, run: async args => {
    calls++; if (calls === 1) throw Error('daemon unavailable'); return args[0] === 'run' ? ID : '{}';
  } });
  await assert.rejects(open('../../.env'), /Unknown setup task/); assert.equal(calls, 0);
  await assert.rejects(open('gui-install-host-docs'), /daemon unavailable/);
  assert.equal((await open('gui-install-host-docs')).opened, true);
  const other = await fixture(t); await rm(join(other.root, 'docs/host/AGENTS.md'));
  await assert.rejects(createSetupChatOpener({ ...other, run: async () => { throw Error('must not run'); } })('gui-install-host-docs'), /ENOENT/);
});
