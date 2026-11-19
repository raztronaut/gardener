import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mouseDictation } from '../../src/mouse-dictation.mjs';

test('Paseo toggles once per press and never sends a Garden request', async () => {
  const calls = [];
  const edge = mouseDictation({ active: async () => ({ id: 'p', paseo: true }),
    garden: async () => assert.fail('wrong destination'), toggle: async id => calls.push(id) });
  await Promise.all([edge(true), edge(true), edge(false), edge(false), edge(true), edge(false)]);
  assert.deepEqual(calls, ['p', 'p']);
});
test('Garden release follows the original press when focus moves to Paseo', async () => {
  let paseo = false; const calls = [];
  const edge = mouseDictation({ active: async () => ({ id: 'x', paseo }),
    garden: async down => calls.push(down), toggle: async () => assert.fail('release retargeted') });
  await edge(true); paseo = true; await edge(false);
  assert.deepEqual(calls, [true, false]);
});
test('failed window lookup drops input rather than sending to the wrong app, then recovers', async () => {
  let fail = true; const calls = [];
  const edge = mouseDictation({ active: async () => { if (fail) throw Error('X unavailable'); return { paseo: false }; },
    garden: async down => calls.push(down) });
  await edge(true); await edge(false); fail = false;
  await edge(true); await edge(false); assert.deepEqual(calls, [true, false]);
});
