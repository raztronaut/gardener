// Gui Dávid's dashboard — all the words live here. Edit freely: the widgets pick
// a different line each day (rotating by date), so nothing repeats day to day.
export const FROM = 'Gui Dávid';
export const TO = 'Louise';

export const DECLARATIONS = [
  'Louise, you are my favourite place to be.',
  'Every version of my day is better with you in it.',
  'I would choose you in every lifetime, on every timeline.',
  'You are the calm and the spark, both at once.',
  'Home stopped being a place the day I met you.',
  'I still get nervous-happy when I hear you at the door.',
  'Of all the things growing in this house, my love for you grows fastest.',
  'You make ordinary Tuesdays feel like holidays.',
  'I love you more today than yesterday — less than tomorrow.',
  'If I could plant one seed forever, it would be us.',
];

export const REASONS = [
  'the way you laugh before the joke is even over',
  'how you make everyone around you feel seen',
  'your stubborn, beautiful kindness',
  'the face you make when the coffee is perfect',
  'you believe in me on the days I don’t',
  'your hand finding mine without looking',
  'how brave you are about new things',
  'the way you say my name',
  'you turn small moments into memories',
  'your curiosity about everything',
  'how you care for the plants (and for me)',
  'you are my best friend',
];

export const PROMISES = [
  'Breakfast in bed, no reason needed.',
  'A long walk in Golden Gate Park, phones away.',
  'Your favourite song on repeat, dancing in the kitchen.',
  'Flowers from the Gardyn, picked just for you.',
  'A surprise date — you just have to say yes.',
  'Always the last bite of dessert.',
  'Listening, really listening, every time.',
  'Planning our next trip together.',
];

// Stable daily index (same pick all day, changes at midnight).
export function daily(list, salt = 0) {
  const d = new Date();
  const n = Math.floor((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5) + salt * 7);
  return list[((n % list.length) + list.length) % list.length];
}
export function dailyN(list, k, salt = 0) {
  const out = [];
  for (let i = 0; i < Math.min(k, list.length); i++) out.push(daily(list, salt + i * 3));
  return [...new Set(out)];
}
