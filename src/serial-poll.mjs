// No overlapping requests, including when a local daemon is slow or unavailable.
export function serialPoll(tick, { intervalMs = 500, initialMs = 250, onError = () => {} } = {}) {
  let stopped = false, timer;
  const run = async () => {
    try { await tick(); } catch (e) { onError(e); }
    if (!stopped) timer = setTimeout(run, intervalMs);
  };
  timer = setTimeout(run, initialMs);
  return () => { stopped = true; clearTimeout(timer); };
}
