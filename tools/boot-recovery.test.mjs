import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';

const html = readFileSync(new URL('../public/index.html', import.meta.url), 'utf8');
const source = html.match(/<script id="garden-boot-recovery">([\s\S]*?)<\/script>/)[1];
function browser() {
  const storage = new Map();
  const state = { now: 1000000, reloads: 0, storage, storageBlocked: false };
  state.navigate = ({ ready = false, running = false } = {}) => {
    let deadline;
    const context = {
      document: { documentElement: { dataset: { gardenerBoot: ready ? 'ready' : 'loading' } } },
      window: { gardenWall: running ? {} : undefined },
      Date: { now: () => state.now },
      console: { warn() {} },
      sessionStorage: {
        getItem: key => storage.get(key) ?? null,
        setItem(key, value) { if (state.storageBlocked) throw new Error('Storage unavailable'); storage.set(key, value); },
      },
      location: { reload() { state.reloads++; } },
      setTimeout(callback, delay) { assert.equal(delay, 30000); deadline = callback; },
    };
    vm.runInNewContext(source, context);
    return () => { state.now += 30000; deadline(); };
  };
  return state;
}

test('a failed asset boot retries; a recovered app stops retrying', () => {
  const b = browser();
  b.navigate()();
  assert.equal(b.reloads, 1);
  b.navigate({ ready: true, running: true })();
  assert.equal(b.reloads, 1);
});

test('persistent failure is capped across reloads, with a new budget after five minutes', () => {
  const b = browser();
  for (let n = 0; n < 5; n++) b.navigate()();
  assert.equal(b.reloads, 2);
  b.now += 300001;
  b.navigate()();
  assert.equal(b.reloads, 3);
});

test('a running session with slow widgets is never reloaded', () => {
  const b = browser();
  b.navigate({ running: true })();
  b.navigate({ ready: true })();
  assert.equal(b.reloads, 0);
});

test('unavailable session storage cannot cause an unbounded reload loop', () => {
  const b = browser();
  b.storageBlocked = true;
  b.navigate()();
  assert.equal(b.reloads, 0);
});

test('malformed recovery metadata can recover without affecting other stored data', () => {
  const b = browser();
  b.storage.set('garden.bootRecovery', 'broken');
  b.storage.set('garden.layout', 'preserve');
  b.navigate()();
  assert.equal(b.reloads, 1);
  assert.equal(b.storage.get('garden.layout'), 'preserve');
});
