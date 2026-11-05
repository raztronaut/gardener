// One registry for the picker, runtime, CLI, and remote-wall asset allowlist.
export const DEFAULT_THEME = 'classic';
export const THEMES = Object.freeze([
  Object.freeze({ id: 'classic', label: 'Garden Classic', description: 'The original green aurora and liquid glass. Always available.', file: '/themes/classic.json' }),
  Object.freeze({ id: 'moonstone', label: 'Moonstone', description: 'Editorial typography, quiet slate surfaces and lavender accents.', file: '/themes/moonstone.json', assets: Object.freeze(['/themes/cursors/arrow.svg','/themes/cursors/hand.svg','/themes/cursors/text.svg']) }),
]);
export const themeById = id => THEMES.find(theme => theme.id === id);

export const FALLBACK_STYLESHEETS = Object.freeze([
  Object.freeze({ file: '/styles.css', owner: 'shell' }),
  Object.freeze({ file: '/lib/widget-pages.css', owner: 'widget-pages' }),
  Object.freeze({ file: '/themes/themes.css', owner: 'theme-picker' }),
]);
