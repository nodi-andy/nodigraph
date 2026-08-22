// A small curated set of block-label fonts, loaded via the Google Fonts
// <link> tags in index.html — kept short so it's a real, considered choice
// rather than an overwhelming picker. `key: null` (Default) is the system
// stack drawBlock always used before this existed, so an unrecorded choice
// (every block before this feature, or one reset back) looks unchanged.
const FALLBACK_STACK = '-apple-system, Segoe UI, Roboto, sans-serif';

export const FONTS = [
  { key: null, label: 'Default', family: FALLBACK_STACK },
  { key: 'inter', label: 'Inter', family: `'Inter', ${FALLBACK_STACK}` },
  { key: 'mono', label: 'Mono', family: `'JetBrains Mono', ui-monospace, monospace` },
  { key: 'serif', label: 'Serif', family: `'Merriweather', Georgia, serif` },
];

const BY_KEY = new Map(FONTS.map((f) => [f.key, f]));

export function getFontFamily(key) {
  return (BY_KEY.get(key) || FONTS[0]).family;
}

// A shared cache mirroring render/imageCache.js's shape: canvas text can't
// await a web font mid-render, so this draws with the fallback stack
// immediately and asks for a redraw once the browser confirms the real
// font is ready — the same "nothing yet, then the real thing" pattern an
// image URL block uses.
const readyCache = new Map();

export function ensureFontLoaded(cssFont, onReady) {
  let entry = readyCache.get(cssFont);
  if (!entry) {
    entry = { status: 'loading', listeners: new Set() };
    readyCache.set(cssFont, entry);
    const settle = (status) => {
      entry.status = status;
      entry.listeners.forEach((fn) => fn());
      entry.listeners.clear();
    };
    document.fonts.load(cssFont).then((faces) => settle(faces.length ? 'loaded' : 'error'), () => settle('error'));
  }
  if (entry.status === 'loading' && onReady) entry.listeners.add(onReady);
  return entry.status === 'loaded';
}
