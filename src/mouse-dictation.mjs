// The mouse follows the foreground app. Paseo owns its native dictation session;
// Garden owns hold-to-talk. Never turn a release over another app into a new action.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
const exec = promisify(execFile);
const env = { ...process.env, DISPLAY: process.env.DISPLAY || ':0' };

export async function foreground() {
  const { stdout } = await exec('xprop', ['-root', '_NET_ACTIVE_WINDOW'], { env, timeout: 1000 });
  const id = stdout.match(/0x[\da-f]+/i)?.[0];
  if (!id || id === '0x0') throw new Error('No foreground window');
  const result = await exec('xprop', ['-id', id, 'WM_CLASS'], { env, timeout: 1000 });
  return { id, paseo: /"paseo"/i.test(result.stdout) };
}

export function mouseDictation({ garden, log = () => {}, active = foreground,
  toggle = async (id) => {
    // Recheck after the async window lookup. No focus stealing or background input.
    if ((await foreground()).id !== id) throw new Error('Focus changed before dictation');
    await exec('/home/talbot/.local/bin/desk', ['key', 'ctrl+d'], { env, timeout: 1500 });
  },
}) {
  let held = false, target = null, queue = Promise.resolve();
  return (down) => {
    queue = queue.then(async () => {
      if (down === held) return;
      held = down;
      if (!down) {
        const previous = target; target = null;
        if (previous === 'garden') await garden(false);
        return;
      }
      const window = await active();
      target = window.paseo ? 'paseo' : 'garden';
      if (target === 'paseo') await toggle(window.id);
      else await garden(true);
    }).catch((error) => { log(`mouse dictation: ${error.message}`); });
    return queue;
  };
}
