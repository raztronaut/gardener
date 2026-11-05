// The Gardener™ — countdown card: a timer as a card floating in the wall's top-left
// corner (over the clock), only while it runs. Started with /timer (default 2 min) or
// by voice ("Hey Garden, start a two-minute countdown" → command timer). Big mint
// mm:ss + a thin bar that drains; at zero a chime and "Time's up" in gold, then it
// folds away. Tap it to dismiss. The end time is kept in localStorage, so a wall
// reload mid-countdown carries on. One tick per second; no animation loop.
const KEY = 'garden.countdown';
let el = null, timer = 0, foldT = 0, endAt = 0, total = 0, sound = () => {};

const fmt = (ms) => {
  const s = Math.max(0, Math.ceil(ms / 1000));
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

function ensure() {
  if (el) return el;
  el = document.createElement('div');
  el.id = 'countdownCard';
  el.innerHTML = '<div class="cd-ttl">Countdown</div><div class="cd-time"></div><div class="cd-bar"><i></i></div>';
  el.addEventListener('click', () => stop());
  (document.getElementById('zoomroot') || document.body).appendChild(el);
  return el;
}

function paint() {
  const left = endAt - Date.now();
  el.querySelector('.cd-time').textContent = fmt(left);
  el.querySelector('.cd-bar i').style.transform = `scaleX(${Math.max(0, Math.min(1, left / total))})`;
  if (left <= 0) done();
}

function done() {
  clearInterval(timer); timer = 0;
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  el.classList.add('up');
  el.querySelector('.cd-ttl').textContent = 'Countdown';
  el.querySelector('.cd-time').textContent = 'Time’s up';
  sound('done');
  clearTimeout(foldT); foldT = setTimeout(() => stop(), 15000);
}

function run() {
  ensure();
  clearTimeout(foldT);
  el.className = 'on';
  paint();
  clearInterval(timer);
  timer = setInterval(paint, 1000);
}

export function start(seconds = 120) {
  total = Math.max(1, Math.round(seconds)) * 1000;
  endAt = Date.now() + total;
  try { localStorage.setItem(KEY, JSON.stringify({ endAt, total })); } catch { /* ignore */ }
  run();
}

export function stop() {
  clearInterval(timer); timer = 0; clearTimeout(foldT);
  try { localStorage.removeItem(KEY); } catch { /* ignore */ }
  if (el) el.className = '';
}

export const running = () => !!timer;

// on load: pick up a countdown that was running before a reload
export function init(opts = {}) {
  if (opts.sound) sound = opts.sound;
  try {
    const s = JSON.parse(localStorage.getItem(KEY) || 'null');
    if (s && s.endAt > Date.now()) { endAt = s.endAt; total = s.total; run(); }
    else localStorage.removeItem(KEY);
  } catch { /* ignore */ }
}

// "2", "2m", "90s", "1:30", "five" → seconds (default 2 minutes)
const WORDS = { one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7, eight: 8, nine: 9, ten: 10, fifteen: 15, twenty: 20, thirty: 30 };
export function parse(arg) {
  const a = String(arg || '').trim().toLowerCase();
  if (!a) return 120;
  let m = a.match(/^(\d+):(\d{1,2})$/);
  if (m) return +m[1] * 60 + +m[2];
  m = a.match(/^(\d+(?:\.\d+)?|[a-z]+)\s*(s|sec|secs|seconds?|m|min|mins|minutes?|h|hours?)?$/);
  if (!m) return null;
  const n = /^\d/.test(m[1]) ? +m[1] : WORDS[m[1]];
  if (!n) return null;
  const u = (m[2] || 'm')[0];
  return Math.round(n * (u === 's' ? 1 : u === 'h' ? 3600 : 60));
}
