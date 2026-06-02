// LinkedIn Clout™ — a tongue-in-cheek "hustle post of the day" for the hacker
// house. Self-contained (no API, no perpetual animation): it picks one satirical
// LinkedIn-influencer hot-take and a reaction count, rotating every few hours.
// Honors the feedback "grow a seed to get clout on linkedin" + "display gui likes guy"
// (yes — Gui always likes the post).

const POSTS = [
  'I fired my best engineer for using a mouse. We ship with vim or we don’t ship. Agree?',
  'Slept 3 hours. Closed 0 deals. Drank 4 Soylents. This is what winning feels like. \u{1F451}',
  'Rejected a $2M term sheet because the VC said "lol" in the meeting. Vibes are non-negotiable.',
  'My cofounder asked for a weekend off. I asked him if Jeff Bezos takes weekends off. He quit. We’re hiring.',
  'Hot take: standups are for people who can’t stand the heat of shipping at 3am. \u{1F525}',
  'Turned our garage into a 24/7 war room. The neighbors call it a fire hazard. I call it product-market fit.',
  'I don’t do work-life balance. I do work-work balance. The second work is also work.',
  'We don’t have a roadmap. We have a manifesto. Investors love it. My therapist does not.',
  'Replaced our entire HR department with a Slack bot named "Grindr." Different one. Long story.',
  'Spent the seed round on a foosball table and one (1) very confident intern. Zero regrets.',
];

// A confident, fake job title to match the vibe.
const TITLES = [
  'Founder · Builder · Visionary',
  'Chief Vibes Officer · ex-dropout',
  '10x Engineer · Thought Leader',
  'Disruptor · Hustler · Sleeps Later',
];

export default {
  id: 'linkedin-clout',
  title: 'LinkedIn Clout',
  icon: '\u{1F4BC}',
  size: 'sm',
  chrome: true,
  async mount(body, ctx) {
    ctx.style(`
      .lic { display:flex; flex-direction:column; gap:11px; height:100%; }
      .lic-head { display:flex; align-items:center; gap:10px; }
      .lic-av { width:38px; height:38px; border-radius:50%; flex:0 0 auto;
        display:grid; place-items:center; font-family:var(--font-display); font-weight:700;
        font-size:18px; color:#04140d; background:linear-gradient(135deg,var(--mint),var(--mint-2)); }
      .lic-who { min-width:0; line-height:1.15; }
      .lic-name { font-size:14px; font-weight:700; color:var(--ink); }
      .lic-name .deg { color:var(--ink-faint); font-weight:500; font-size:12px; }
      .lic-title { font-size:11px; color:var(--ink-faint); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
      .lic-post { font-size:14px; line-height:1.34; color:var(--ink-soft); flex:1;
        display:-webkit-box; -webkit-line-clamp:4; -webkit-box-orient:vertical; overflow:hidden; }
      .lic-foot { display:flex; align-items:center; gap:8px; padding-top:9px;
        border-top:1px solid var(--stroke); font-size:12px; color:var(--ink-faint); }
      .lic-react { display:inline-flex; align-items:center; }
      .lic-react span { width:18px; height:18px; border-radius:50%; margin-left:-5px;
        display:grid; place-items:center; font-size:10px; background:var(--glass-2);
        border:1px solid var(--stroke); }
      .lic-react span:first-child { margin-left:0; }
      .lic-likes b { color:var(--ink-soft); font-weight:600; }
    `);

    // Rotate by the hour so it feels alive but never animates / re-renders fast.
    const pick = (arr, salt) => arr[(Math.floor(Date.now() / 36e5) + salt) % arr.length];
    const render = () => {
      const post = pick(POSTS, 0);
      const title = pick(TITLES, 1);
      const likes = 800 + (Math.floor(Date.now() / 36e5) % 9) * 137 + (post.length % 90);
      body.replaceChildren(
        ctx.h('div', { class: 'lic' },
          ctx.h('div', { class: 'lic-head' },
            ctx.h('div', { class: 'lic-av' }, 'in'),
            ctx.h('div', { class: 'lic-who' },
              ctx.h('div', { class: 'lic-name' }, 'Gui ', ctx.h('span', { class: 'deg' }, '· 1st')),
              ctx.h('div', { class: 'lic-title' }, title))),
          ctx.h('div', { class: 'lic-post' }, post),
          ctx.h('div', { class: 'lic-foot' },
            ctx.h('span', { class: 'lic-react' },
              ctx.h('span', {}, '\u{1F44D}'), ctx.h('span', {}, '❤'), ctx.h('span', {}, '\u{1F525}')),
            ctx.h('span', { class: 'lic-likes' },
              ctx.h('b', {}, 'Gui'), ' and ', ctx.h('b', {}, likes.toLocaleString()), ' others'))));
    };
    // No network — but keep the contract: render now, refresh hourly.
    ctx.interval(render, 60 * 60 * 1000);
  },
};
