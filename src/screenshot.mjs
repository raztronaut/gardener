// The Gardener™ — visual capture.
// Primary: headless Chromium renders the live URL at exactly 900×1600 → PNG.
// This is deterministic and independent of the physical display's power state
// (so it works even at 06:00 when the panel is asleep). gnome-screenshot of
// the live X display is available as a secondary "what the human sees" capture.
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { statSync, existsSync, rmSync } from 'node:fs';
import { config, paths } from './config.mjs';

const pExecFile = promisify(execFile);

// Render a URL headlessly to a PNG at the locked canvas size.
export async function captureUrl(url, outPath, { waitMs = 8000, timeout = 45000 } = {}) {
  if (existsSync(outPath)) { try { rmSync(outPath); } catch { /* ignore */ } }
  const args = [
    '--headless=new', '--no-sandbox', '--disable-gpu', '--disable-dev-shm-usage',
    '--hide-scrollbars', '--force-device-scale-factor=1',
    `--user-data-dir=${paths.CHROME_PROFILE}`,
    `--window-size=${config.width},${config.height}`,
    `--screenshot=${outPath}`,
    `--virtual-time-budget=${waitMs}`,
    url,
  ];
  try {
    await pExecFile(config.chromium, args, { timeout });
  } catch (e) {
    // Chromium often exits non-zero with benign GPU/va warnings even on success;
    // judge by the artifact, not the exit code.
    if (!existsSync(outPath)) throw new Error(`headless render produced no file: ${(e.stderr || e.message || '').toString().slice(0, 200)}`);
  }
  if (!existsSync(outPath) || statSync(outPath).size < 1024) {
    throw new Error('screenshot missing or suspiciously small');
  }
  return outPath;
}

// Convenience: screenshot the running dashboard (clean QA mode, no overlay/bar).
export async function captureDashboard(outPath, opts = {}) {
  const url = `http://${config.host}:${config.port}/?screenshot=1`;
  return captureUrl(url, outPath, opts);
}

// Secondary: grab the actual live X display (requires panel awake).
export async function captureLiveDisplay(outPath) {
  const env = { ...process.env, DISPLAY: config.display };
  await pExecFile('gnome-screenshot', ['-f', outPath], { env, timeout: 20000 });
  if (!existsSync(outPath)) throw new Error('gnome-screenshot produced no file');
  return outPath;
}
