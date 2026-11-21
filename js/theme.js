/*
 * theme.js — light / dark theme toggle, shared by index.html and notes.html.
 *
 * Colours are CSS tokens (css/base.css). An explicit choice is stored in
 * localStorage under THEME_KEY and applied as <html data-theme="light|dark">;
 * a tiny inline script in each page's <head> applies the stored choice before
 * first paint, so there is no flash. With no stored choice the page follows
 * prefers-color-scheme (in CSS, so it also works without JS).
 *
 * The toggle is a <button class="theme-toggle" aria-pressed> in each page;
 * aria-pressed="true" means the light theme is on.
 *
 * The top of the file is pure logic, tested in tests/theme.test.mjs.
 */

/* ---------- pure logic ---------- */

export const THEME_KEY = 'theme';

/** Background colour per theme, for <meta name="theme-color">. Keep in sync with --bg. */
export const THEME_BG = { dark: '#0b0b0b', light: '#faf8f3' };

/** A stored value if it is a valid explicit choice, else null. */
export function validTheme(value) {
  return value === 'light' || value === 'dark' ? value : null;
}

/** The theme in effect: an explicit stored choice wins, else the system preference. */
export function resolveTheme(stored, systemPrefersLight) {
  return validTheme(stored) || (systemPrefersLight ? 'light' : 'dark');
}

/** The theme the toggle switches to. */
export function nextTheme(current) {
  return current === 'light' ? 'dark' : 'light';
}

/* ---------- browser ---------- */

function readStored() {
  try { return window.localStorage.getItem(THEME_KEY); } catch { return null; }
}

function writeStored(theme) {
  try { window.localStorage.setItem(THEME_KEY, theme); } catch { /* private mode: choice lasts this page only */ }
}

function init() {
  const root = document.documentElement;
  const mq = window.matchMedia('(prefers-color-scheme: light)');
  const buttons = [...document.querySelectorAll('.theme-toggle')];
  const meta = document.querySelector('meta[name="theme-color"]');

  const current = () => resolveTheme(root.dataset.theme || readStored(), mq.matches);

  const sync = () => {
    const theme = current();
    for (const b of buttons) {
      b.setAttribute('aria-pressed', String(theme === 'light'));
      b.title = theme === 'light' ? 'Switch to dark theme' : 'Switch to light theme';
    }
    if (meta) meta.setAttribute('content', THEME_BG[theme]);
  };

  for (const b of buttons) {
    b.addEventListener('click', () => {
      const theme = nextTheme(current());
      root.dataset.theme = theme;
      writeStored(theme);
      sync();
    });
  }
  // No explicit choice yet: follow the system live.
  mq.addEventListener('change', sync);
  sync();
}

if (typeof document !== 'undefined') init();
