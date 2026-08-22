// Light/dark mode for the whole app — the UI chrome (via CSS custom
// properties, toggled through the `data-theme` attribute on <html>) and the
// canvas (via render/canvasPalette.js, which reads the same theme name).
// Light is the default regardless of the OS's own color-scheme preference:
// a diagram exported to Google Docs always lands on a white page, so
// starting people in the palette that already matches that avoids a
// "why does my export look wrong" surprise for anyone who never opens
// Settings.
const STORAGE_KEY = 'nodigraph-theme';
const THEMES = ['light', 'dark'];

let current = 'light';
const listeners = new Set();

function readStored() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY);
    return THEMES.includes(saved) ? saved : null;
  } catch {
    return null; // Storage blocked (private mode) — fall back to the default.
  }
}

function apply(name) {
  current = name;
  // The default theme carries no attribute at all, rather than an explicit
  // data-theme="light" — one fewer thing for a stylesheet author to get
  // backwards, and it means "no preference recorded yet" and "light" are
  // indistinguishable in the DOM, which is exactly true.
  if (name === 'dark') document.documentElement.dataset.theme = 'dark';
  else delete document.documentElement.dataset.theme;
}

// Call once, as early as possible (before the first paint) — reads any
// saved preference and applies it immediately, so there's no flash of the
// wrong theme while the rest of the app is still starting up.
export function initTheme() {
  apply(readStored() || 'light');
}

export function getTheme() {
  return current;
}

export function setTheme(name) {
  if (!THEMES.includes(name) || name === current) return;
  apply(name);
  try {
    localStorage.setItem(STORAGE_KEY, name);
  } catch {
    // Nothing to fall back to — the choice just won't survive a reload.
  }
  for (const listener of listeners) listener(name);
}

// Returns an unsubscribe function, same shape as the other pub/sub helpers
// in this codebase (SelectionManager.onChange, etc.).
export function onThemeChange(listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
