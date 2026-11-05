import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync, rmSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import vm from 'node:vm';
const dir = mkdtempSync(tmpdir() + '/garden-snooze-test-');
process.env.GARDENER_DATA = dir;
process.env.GARDENER_NIGHT_START = '0';
process.env.GARDENER_DAY_START = '24';
for (const name of ['xrandr', 'xset', 'pgrep']) {
  writeFileSync(dir + '/' + name, '#!/bin/sh\nexit 0\n'); chmodSync(dir + '/' + name, 0o755);
}
process.env.PATH = dir + ':' + process.env.PATH;
const base = new URL('../', import.meta.url).pathname;
const { snoozeDisplay, expireSnooze, goNight, goEvening, nightKeep } = await import(base + 'src/display.mjs');
const { getNight, getSnoozeUntil, setSnoozeUntil } = await import(base + 'src/db.mjs');
try {
 const now = Date.now(); const until = snoozeDisplay(now);
 assert.equal(until, now + 3600000); assert.equal(getNight(), false);
 goNight(); goEvening(); nightKeep(); assert.equal(getNight(), false);
 assert.equal(expireSnooze(now + 3599999), false);
 const extended = snoozeDisplay(now + 1000); assert.equal(extended, now + 3601000);
 assert.equal(expireSnooze(until), false);
 assert.equal(expireSnooze(extended), true); assert.equal(getNight(), true); assert.equal(getSnoozeUntil(), 0);
 setSnoozeUntil(Date.now() - 1); assert.equal(expireSnooze(), true);
 console.log('PASS: full hour, schedule/idle protection, extension, expiry, expired stored deadline');
 const source = readFileSync(base + 'src/pad.mjs', 'utf8');
 const chord = source.slice(source.indexOf('const sleepButtons'), source.indexOf('let rawLogged'));
 const sent = []; let timer, holdMs;
 const context = vm.createContext({ Set, MAP: {buttons:{10:'changelog',11:'help'}}, send: async a => { sent.push(a); }, setTimeout: (f, ms) => { timer=f; holdMs=ms; return 1; }, clearTimeout: () => { timer=null; }});
 vm.runInContext(chord + '\nglobalThis.button = sleepButton;', context);
 context.button(1,10); context.button(1,11); assert.equal(holdMs, 5000); assert.deepEqual(sent, []); timer(); context.button(0,10); context.button(0,11);
 assert.deepEqual(sent, ['snooze']); sent.length=0;
 context.button(1,10); context.button(1,11); context.button(0,11); context.button(0,10);
 await new Promise(r => setImmediate(r)); assert.deepEqual(sent,['jbkd','jbld','jbku','jblu']); sent.length=0;
 context.button(1,11); context.button(0,11); await new Promise(r=>setImmediate(r)); assert(sent.includes('help'));
 console.log('PASS: held chord fires once, release does not trigger menus, short game-exit chord and single tap preserved');
} finally { rmSync(dir, { recursive:true, force:true }); }
