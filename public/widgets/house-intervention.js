// An Intervention™ — a gentle (okay, pointed) house-wide intervention about Max's
// cleaning habits. Self-contained, no API, no perpetual animation: it rotates one
// lovingly passive-aggressive note per hour. Honors the feedback: "have an
// intervention about max's cleaning habits."
const NOTES = [
  'The sink is not a long-term storage solution. Those dishes have been there since the weekend.',
  'We found a mug growing its own ecosystem. It may qualify for rent. Please, the dishes.',
  'Your dishes have started introducing themselves to the new ones. Break the cycle.',
  'The trash can has a lid AND a curb. Both are within walking distance. We believe in you.',
  'That pan you “left to soak” on Tuesday has achieved sentience. Soaking time is over.',
  'Crumbs are not a decorative finish for the counter. The sponge is right there, buddy.',
  'Your laundry pile now blocks a fire exit. This is a safety intervention as much as a clean one.',
  'We love you. We do not love the smell coming from your side of the kitchen. Help us help you.',
  'The recycling goes OUT, not next to the bin in a hopeful little pile. So close. So far.',
  'One (1) dish. That’s all we ask today. Start small. We’ll throw a party when you do.',
];

export default {
  id: 'house-intervention',
  title: 'An Intervention',
  icon: '🧹',
  size: 'md',
  chrome: true,
  async mount(body, ctx) {
    ctx.style(`
      .itv { display:flex; flex-direction:column; gap:7px; height:100%; }
      .itv-to { font-family:var(--font-mono); font-size:11px; letter-spacing:.1em; text-transform:uppercase; color:var(--rose); }
      .itv-msg { font-family:var(--font-display); font-size:16px; line-height:1.3; color:var(--ink);
        display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden; }
      .itv-sign { margin-top:auto; padding-top:6px; font-size:11.5px; color:var(--ink-faint); }
    `);
    // Rotate hourly — feels alive, never animates or polls fast.
    const render = () => {
      const note = NOTES[Math.floor(Date.now() / 36e5) % NOTES.length];
      body.replaceChildren(
        ctx.h('div', { class: 'itv' },
          ctx.h('div', { class: 'itv-to' }, '🧽 For Max, with love'),
          ctx.h('div', { class: 'itv-msg' }, note),
          ctx.h('div', { class: 'itv-sign' }, '— the house 💚')));
    };
    ctx.interval(render, 60 * 60 * 1000);
  },
};
