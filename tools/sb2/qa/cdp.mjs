// Tiny Chrome DevTools Protocol client for the port's headless QA (tools/sb2/qa/).
// Never point this at the live kiosk (9223): use your own headless browser (9340+).
export async function connect(port, urlMatch = '') {
  const list = await (await fetch(`http://127.0.0.1:${port}/json`)).json();
  const t = list.find((x) => x.type === 'page' && x.url.includes(urlMatch)) || list.find((x) => x.type === 'page');
  if (!t) throw new Error('no page target');
  const ws = new WebSocket(t.webSocketDebuggerUrl);
  await new Promise((ok, bad) => { ws.onopen = ok; ws.onerror = bad; });
  let id = 0;
  const pending = new Map();
  const listeners = [];
  ws.onmessage = (e) => {
    const m = JSON.parse(e.data);
    if (m.id && pending.has(m.id)) { const p = pending.get(m.id); pending.delete(m.id); m.error ? p.bad(new Error(m.error.message)) : p.ok(m.result); }
    else if (m.method) for (const l of listeners) l(m);
  };
  const send = (method, params = {}) => new Promise((ok, bad) => { const i = ++id; pending.set(i, { ok, bad }); ws.send(JSON.stringify({ id: i, method, params })); });
  async function evaluate(expr, awaitPromise = true) {
    const r = await send('Runtime.evaluate', { expression: expr, awaitPromise, returnByValue: true });
    if (r.exceptionDetails) throw new Error(r.exceptionDetails.exception?.description || r.exceptionDetails.text);
    return r.result.value;
  }
  async function screenshot(file) {
    const fs = await import('node:fs');
    const r = await send('Page.captureScreenshot', { format: 'png' });
    fs.writeFileSync(file, Buffer.from(r.data, 'base64'));
    return file;
  }
  return { send, evaluate, screenshot, on: (f) => listeners.push(f), close: () => ws.close() };
}
export const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
