/**
 * How much of a block's decoration gets painted — the one rendering
 * setting that is a choice about looks rather than about the diagram.
 *
 * A block used to always draw as a chip: a slab with a visible side wall
 * under its face and a two-layer drop shadow under that (see
 * BlockRenderer's CHIP_DEPTH and PAPER_SHADOW_LAYERS). It reads well, and
 * it costs a lot — per block it is a second full outline traced, an extra
 * fill and stroke, and two *blurred* fills. A blurred fill is far and away
 * the most expensive thing a 2D canvas does, and a big diagram pays for it
 * once per block on every pan, zoom and drag frame. Past a few hundred
 * blocks that alone is the difference between a diagram that moves and one
 * that doesn't.
 *
 * So the chip is now opt-in: the plain view draws the face, its border and
 * its pins, which is the whole diagram — nothing about what the drawing
 * *means* is in the shadow. Settings > Improved view turns the chip back
 * on for people whose diagrams are small enough not to care, and it is
 * remembered across sessions.
 *
 * It lives here rather than being threaded through renderScene because
 * both exporters draw through the same renderers, and an exported figure
 * should look like what is on screen without either exporter having to
 * know the setting exists. Callers that genuinely need to force one or the
 * other still can: every drawing entry point takes it as an option.
 */

const STORAGE_KEY = 'nodigraph.improvedView';
const OPEN_ZOOM_KEY = 'nodigraph.levelOpenZoom';

/**
 * How big a level's own contents have to be drawn before that level is
 * shown on its block's face, in screen pixels per world unit of the level
 * inside (see SubPreviewRenderer.isLevelOpen, which compares the block's
 * own interior scale against this).
 *
 * 0.5 — contents at half size — is where this sat as a constant. It is a
 * judgement about legibility, not a fact, and which side of it you want
 * depends on what you are doing: reading a whole system at a glance wants
 * levels to open early, even if each one is a smudge, while editing one
 * level wants the others to stay shut and out of the way. So it is a
 * setting, remembered per browser like the rest of them.
 *
 * Lower opens sooner and draws more of the diagram at once, which costs
 * more per frame — every open level is another level's worth of blocks
 * and wires being drawn.
 */
export const LEVEL_OPEN_ZOOMS = [
  { value: 0.15, label: 'Much sooner' },
  { value: 0.25, label: 'Sooner' },
  { value: 0.5, label: 'Normal' },
  { value: 1, label: 'Later' },
];
const DEFAULT_OPEN_ZOOM = 0.5;

let levelOpenZoom = DEFAULT_OPEN_ZOOM;

// Off by default: a first-time visitor with a large diagram should see it
// move, and someone who wants the nicer blocks can say so once.
let improvedView = false;

try {
  improvedView = globalThis.localStorage?.getItem(STORAGE_KEY) === '1';
  const saved = Number(globalThis.localStorage?.getItem(OPEN_ZOOM_KEY));
  if (Number.isFinite(saved) && saved > 0) levelOpenZoom = saved;
} catch {
  // Storage can be refused outright (private mode, blocked cookies). The
  // settings are preferences, not data — defaulting them is a complete answer.
}

export function isImprovedView() {
  return improvedView;
}

export function setImprovedView(on) {
  improvedView = Boolean(on);
  try {
    globalThis.localStorage?.setItem(STORAGE_KEY, improvedView ? '1' : '0');
  } catch {
    // Same as above: it just won't be remembered next time.
  }
  return improvedView;
}

export function getLevelOpenZoom() {
  return levelOpenZoom;
}

export function setLevelOpenZoom(value) {
  const next = Number(value);
  // Anything unrecognised falls back to the default rather than leaving
  // levels that never open (0) or open always (a negative).
  levelOpenZoom = Number.isFinite(next) && next > 0 ? next : DEFAULT_OPEN_ZOOM;
  try {
    globalThis.localStorage?.setItem(OPEN_ZOOM_KEY, String(levelOpenZoom));
  } catch {
    // As above.
  }
  return levelOpenZoom;
}
