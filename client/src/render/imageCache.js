// A small shared cache for block-text-as-image-URL rendering (see
// BlockRenderer.drawBlock). Loaded once per URL and reused by every block
// and every frame that references it — images load asynchronously, so
// this is what lets a synchronous canvas redraw show "nothing yet, then
// the picture" instead of trying to await anything mid-render.
const cache = new Map();

// A plain http(s) URL ending in a common image extension (an optional
// query string is fine) — deliberately narrow so an ordinary text name is
// never misread as one. data: URLs are intentionally excluded: pasting a
// base64 image in as a block's name would balloon the project — and by
// extension every share link it's serialized into — which defeats the
// whole point of the URL being compact.
const IMAGE_URL_PATTERN = /^https?:\/\/\S+\.(png|jpe?g|gif|webp|svg)(\?\S*)?$/i;

export function isImageUrl(text) {
  return IMAGE_URL_PATTERN.test((text || '').trim());
}

/**
 * Returns the loaded <img> for `url` if it's ready to draw, or null while
 * it's still loading (or failed) — the caller draws its plain-text
 * fallback in that case. `onReady` fires once the URL settles either way
 * (never for one already resolved by the time this is called), so the
 * caller can ask for a redraw.
 */
export function getCachedImage(url, onReady) {
  let entry = cache.get(url);
  if (!entry) {
    entry = { status: 'loading', img: null, listeners: new Set() };
    cache.set(url, entry);

    const img = new Image();
    // Anonymous CORS mode: without a server that opts in with its own
    // Access-Control-Allow-Origin header, the browser refuses to load the
    // image at all — safely (the block just keeps showing its fallback
    // text), rather than loading it "tainted" and quietly breaking every
    // canvas export (Save, the share-link screenshot, Google Docs) the
    // moment this block's image is drawn into the same canvas.
    img.crossOrigin = 'anonymous';
    const settle = (status) => {
      entry.status = status;
      entry.img = status === 'loaded' ? img : null;
      entry.listeners.forEach((fn) => fn());
      entry.listeners.clear();
    };
    img.onload = () => settle('loaded');
    img.onerror = () => settle('error');
    img.src = url;
  }

  if (entry.status === 'loading' && onReady) entry.listeners.add(onReady);
  return entry.status === 'loaded' ? entry.img : null;
}
