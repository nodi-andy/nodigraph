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

// Off by default: a first-time visitor with a large diagram should see it
// move, and someone who wants the nicer blocks can say so once.
let improvedView = false;

try {
  improvedView = globalThis.localStorage?.getItem(STORAGE_KEY) === '1';
} catch {
  // Storage can be refused outright (private mode, blocked cookies). The
  // setting is a preference, not data — defaulting it is a complete answer.
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
