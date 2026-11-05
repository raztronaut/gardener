// Runs before paint; runtime checks membership in the single theme-registry.js.
// a URL preview never overwrites the saved preference.
(() => {
  let theme = 'classic';
  try { theme = localStorage.getItem('garden.theme') || theme; } catch {}
  theme = new URLSearchParams(location.search).get('theme') || theme;
  document.documentElement.dataset.theme = /^[a-z][a-z0-9-]*$/.test(theme) ? theme : 'classic';
})();
