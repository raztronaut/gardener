import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createSetupExplainer } from '../src/task-explainer.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'garden-explainer-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'scripts')); await mkdir(join(root, 'docs/host'), { recursive: true });
  for (const file of ['scripts/install-host-docs.sh', 'docs/host/AGENTS.md', 'docs/host/CLAUDE.md', 'docs/host/GARDENOS.md']) await writeFile(join(root, file), 'documentation installer fixture');
  await writeFile(join(root, '.env'), 'PRIVATE_MUST_NOT_BE_SENT');
  return root;
}

test('only fixed source files are sent; simultaneous and repeated asks share a generation', async t => {
  const root = await fixture(t); let calls = 0;
  const explain = createSetupExplainer({ root, generateText: async sources => {
    calls++; assert.equal(sources.length, 4); assert(!JSON.stringify(sources).includes('PRIVATE_MUST_NOT_BE_SENT'));
    await new Promise(resolve => setTimeout(resolve, 20)); return 'This installs guide files; sudo is needed at the filesystem root.';
  } });
  const [a, b] = await Promise.all([explain('gui-install-host-docs'), explain('gui-install-host-docs')]);
  assert.equal(a.explanation, b.explanation); assert.equal(calls, 1);
  assert.equal((await explain('gui-install-host-docs')).cached, true); assert.equal(calls, 1);
  await assert.rejects(explain('../../.env'), /does not have a connected explainer/);
  assert.equal(calls, 1);
});

test('changing the installer invalidates a saved explanation', async t => {
  const root = await fixture(t); let calls = 0;
  const explain = createSetupExplainer({ root, generateText: async () => `Explanation ${++calls}` });
  const a = await explain('gui-install-host-docs');
  await writeFile(join(root, 'scripts/install-host-docs.sh'), 'updated installer');
  const b = await explain('gui-install-host-docs');
  assert.notEqual(a.sourceHash, b.sourceHash); assert.equal(calls, 2);
});

test('failed requests can be retried; missing sources never reach the model', async t => {
  const root = await fixture(t); let calls = 0;
  const explain = createSetupExplainer({ root, generateText: async () => { if (++calls === 1) throw Error('provider down'); return 'Recovered explanation'; } });
  await assert.rejects(explain('gui-install-host-docs'), /provider down/);
  assert.equal((await explain('gui-install-host-docs')).explanation, 'Recovered explanation');
  await rm(join(root, 'docs/host/AGENTS.md'));
  await assert.rejects(explain('gui-install-host-docs'), /unavailable/); assert.equal(calls, 2);
});
