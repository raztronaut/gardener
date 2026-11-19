// Own requests and timers for exactly one widget mount. Closing is permanent:
// a late async mount cannot start new work on an already closed context.
export function createWidgetScope(onError = () => {}) {
  const lifetime = new AbortController(), timers = new Set();
  const signal = lifetime.signal;
  async function fetchValue(url, { viaProxy = true, timeout = 24000 } = {}, format) {
    signal.throwIfAborted();
    const request = new AbortController();
    const cancel = () => request.abort(signal.reason);
    signal.addEventListener('abort', cancel, { once: true });
    const timer = setTimeout(() => request.abort(new DOMException('Request timed out', 'TimeoutError')), timeout);
    try {
      const response = await fetch(viaProxy ? `/api/proxy?url=${encodeURIComponent(url)}` : url, { signal: request.signal });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response[format]();
    } finally {
      clearTimeout(timer);
      signal.removeEventListener('abort', cancel);
    }
  }
  return {
    signal,
    fetchJSON: (url, options) => fetchValue(url, options, 'json'),
    fetchText: (url, options) => fetchValue(url, options, 'text'),
    interval(fn, ms, { immediate = true } = {}) {
      if (signal.aborted) return null;
      let busy = false;
      const run = async () => {
        if (busy || signal.aborted) return;
        busy = true;
        try { await fn(); } catch (error) { if (!signal.aborted) onError(error); }
        finally { busy = false; }
      };
      const timer = setInterval(run, ms);
      timers.add(timer);
      if (immediate) void run();
      return timer;
    },
    stop() {
      if (signal.aborted) return;
      lifetime.abort();
      timers.forEach(clearInterval);
      timers.clear();
    },
  };
}
