/**
 * The miniature of a block's own internals, drawn inside the block once
 * there's enough room on screen to read it.
 *
 * A block with sub-architecture otherwise says nothing about what's in it
 * beyond the small corner badge (see BlockRenderer.drawSubArchitectureBadge)
 * — you have to drill in and come back out to answer "what's in there?".
 * Zoomed in far enough that the block has real estate to spare, that
 * answer can just be shown: the level's own blocks and wires, drawn to
 * scale inside the face, framed exactly the way entering the block frames
 * them (see levelView.boundsOf, which is also what Camera.centerOn fits).
 *
 * The gate is the block's *on-screen* size, not the zoom level alone — a
 * large block earns a preview sooner than a small one, which is what
 * "enough room to read it" actually means. Zoom is only how world units
 * become screen pixels here.
 *
 * Nothing in this file is interactive: hit-testing, selection and drag all
 * still see a plain block. It is a picture of the inside, not the inside.
 */
import { drawPath, getConnectionGeometry } from './ConnectionRenderer.js';
import { getPortPosition, hasSubArchitecture } from './BlockRenderer.js';
import { LevelView, boundsOf } from '../model/levelView.js';
import { getCanvasPalette } from './canvasPalette.js';

// The block's smaller on-screen dimension, in CSS pixels, where the
// transition starts and where it's complete. Below FADE_IN the miniature
// is a smudge that costs more attention than it repays — a level of three
// or four blocks only has room to say anything from about FULL up. The
// span between the two is what keeps it from popping into existence
// mid-zoom-gesture. A default block (120x80 world units) reaches FULL at
// roughly 2.9x zoom; a large one, drawn four grid cells tall, at 1.4x.
const FADE_IN_SIZE = 130;
const FULL_SIZE = 230;

// The crossfade fades *through* rather than dissolving one image into the
// other: the centered name leaves over NAME_OUT and the miniature only
// starts arriving at PREVIEW_IN, so the two barely coexist. Dissolving
// them straight across instead leaves a stretch of zooming where a
// half-strength label sits on a half-strength schematic, which reads as a
// rendering fault rather than as a transition; the brief moment with
// neither is what makes it read as one thing replacing another. The name
// also holds at full strength for the first fifth, so a block still short
// of showing anything looks exactly as it always did.
const NAME_OUT = [0.2, 0.55];
const PREVIEW_IN = [0.45, 1];

// Position within a [start, end] window, clamped to 0..1 at both ends.
function ramp(t, [start, end]) {
  return Math.min(1, Math.max(0, (t - start) / (end - start)));
}

// How deep the nesting is allowed to draw. One level of recursion (a
// previewed child showing its own internals) is a real payoff when you're
// zoomed right in; past that the marks are smaller than a wire is thick,
// so it's cost without information.
const MAX_DEPTH = 2;

// Screen-constant paddings and type sizes, divided by the effective scale
// before use — the same trick this renderer already uses for grid dots,
// resize handles and the corner badge.
const PREVIEW_PADDING = 9;
const CAPTION_HEIGHT = 13;
const CAPTION_FONT_SIZE = 10;
const MINI_FONT_SIZE = 9;
const MINI_CORNER_RADIUS = 2.5;

// How thick a previewed wire and a previewed block's border are drawn, in
// screen pixels. Deliberately thinner than the real thing (3 and 1.5): a
// miniature drawn at full weights reads as a dense blot, and the point of
// it is the shape of the network, not its line quality.
const MINI_WIRE_WIDTH = 1.3;
const MINI_BORDER_WIDTH = 0.9;

// The preview is a quieter register than the block's own face — reference
// material inside something else, not the drawing being worked on — so
// everything in it is drawn under this.
const PREVIEW_ALPHA = 0.85;

const MINI_FONT_STACK = '-apple-system, Segoe UI, Roboto, sans-serif';
const DEFAULT_WIRE_COLOR = '#4f8cff';
const DEFAULT_ACCENT_COLOR = '#3b6fa0';

/**
 * How far along the crossfade `block` is at this zoom: 0 (an ordinary
 * block, nothing to show) to 1 (fully opened up). Deliberately not an
 * opacity — it's the one position both halves are read off, by
 * drawSubPreview for the miniature and by contentAlphaFor for the name
 * and badge it displaces, so the two can never disagree about where in
 * the transition they are.
 */
export function subPreviewProgress(block, zoom) {
  if (block.kind === 'text' || !hasSubArchitecture(block)) return 0;
  const screenSize = Math.min(block.geometry.width, block.geometry.height) * zoom;
  if (screenSize <= FADE_IN_SIZE) return 0;
  if (screenSize >= FULL_SIZE) return 1;
  return (screenSize - FADE_IN_SIZE) / (FULL_SIZE - FADE_IN_SIZE);
}

/**
 * The opacity everything a preview displaces should be drawn at, at the
 * given point along the crossfade — used by drawBlock for a full-size
 * block's name and badge, and by drawMiniBlock for a silhouette about to
 * be opened up in turn.
 */
export function contentAlphaFor(t) {
  return 1 - ramp(t, NAME_OUT);
}

// The other half: how solidly the miniature itself paints at that same
// point. PREVIEW_ALPHA is the ceiling it settles at, never full strength.
function previewInkFor(t) {
  return ramp(t, PREVIEW_IN) * PREVIEW_ALPHA;
}

// Where the miniature goes inside the block's face, and what maps the
// child level's own world coordinates onto it. `scale` composes with the
// camera's zoom, so `zoom * scale` is how many screen pixels one child
// world unit ends up being — that product is what every screen-constant
// size inside the miniature is divided by.
function previewLayout(geometry, bounds, zoom) {
  const padding = PREVIEW_PADDING / zoom;
  const caption = CAPTION_HEIGHT / zoom;
  const inner = {
    x: geometry.x + padding,
    y: geometry.y + padding + caption,
    width: geometry.width - padding * 2,
    height: geometry.height - padding * 2 - caption,
  };
  if (inner.width <= 0 || inner.height <= 0) return null;
  const scale = Math.min(inner.width / bounds.width, inner.height / bounds.height);
  return {
    scale,
    // Centered in whichever axis has slack left over after fitting.
    offsetX: inner.x + (inner.width - bounds.width * scale) / 2 - bounds.x * scale,
    offsetY: inner.y + (inner.height - bounds.height * scale) / 2 - bounds.y * scale,
  };
}

// A block reduced to its silhouette: fill, accent border, and its name if
// there's a legible amount of room for it. Ports are single dots — at this
// size the pipe-shaped real thing (see BlockRenderer's PORT_LENGTH) is
// indistinguishable from a blob, but *where* wires attach is still worth
// showing, since that's half of what a diagram says.
function drawMiniBlock(ctx, block, palette, effectiveZoom, ownPreviewT) {
  const { x, y, width, height } = block.geometry;
  const accent = block.style?.color || DEFAULT_ACCENT_COLOR;
  const fill = block.style?.fill || palette.blockFill;
  const radius = Math.min(MINI_CORNER_RADIUS / effectiveZoom, width / 2, height / 2);

  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
  ctx.fillStyle = fill;
  ctx.fill();
  if (accent !== 'transparent') {
    ctx.lineWidth = MINI_BORDER_WIDTH / effectiveZoom;
    ctx.strokeStyle = accent;
    ctx.stroke();
  }

  ctx.fillStyle = accent === 'transparent' ? palette.portLabel : accent;
  for (const port of block.ports || []) {
    const position = getPortPosition(block, port);
    if (!position) continue;
    ctx.beginPath();
    ctx.arc(position.x, position.y, (MINI_WIRE_WIDTH * 1.1) / effectiveZoom, 0, Math.PI * 2);
    ctx.fill();
  }

  // Under roughly this much room a name is a grey smear that reads as
  // dirt on the glass, so the silhouette goes unlabelled rather than
  // mislabelled. A silhouette about to be opened up in turn (see
  // drawSubPreview's recursion) drops its centered name by exactly as
  // much, for the same reason a full-size block does — its own nested
  // caption is taking that job over.
  const fontSize = MINI_FONT_SIZE / effectiveZoom;
  const nameAlpha = contentAlphaFor(ownPreviewT);
  if (height < fontSize * 1.6 || width < fontSize * 2.5 || nameAlpha <= 0) return;
  if (nameAlpha < 1) ctx.globalAlpha *= nameAlpha;
  ctx.fillStyle = palette.blockText;
  ctx.font = `${fontSize}px ${MINI_FONT_STACK}`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(block.name || '', x + width / 2, y + height / 2, width - fontSize);
}

// Where a wire meets the dashed frame — the miniature's stand-in for the
// boundary port the full-size interior view draws there. Muted like the
// frame itself rather than coloured like a child's port: it belongs to the
// container, not to anything inside it.
function drawFramePort(ctx, position, palette, effectiveZoom) {
  if (!position) return;
  ctx.beginPath();
  ctx.arc(position.x, position.y, (MINI_WIRE_WIDTH * 1.4) / effectiveZoom, 0, Math.PI * 2);
  ctx.fillStyle = palette.portLabel;
  ctx.fill();
}

/**
 * Draws `block`'s internals inside its own face. Call it after drawBlock
 * has painted that block, passing the `t` subPreviewProgress returned
 * for the same block and zoom — early enough in the ramp (or 0) draws
 * nothing at all.
 */
export function drawSubPreview(ctx, block, { zoom = 1, t = 1, palette = getCanvasPalette('light'), depth = 0 } = {}) {
  const ink = previewInkFor(t);
  if (ink <= 0 || depth >= MAX_DEPTH || !hasSubArchitecture(block)) return;

  const view = new LevelView(block);
  const bounds = boundsOf(view);
  if (!bounds) return;
  const layout = previewLayout(block.geometry, bounds, zoom);
  if (!layout) return;

  const effectiveZoom = zoom * layout.scale;
  const { x, y, width, height } = block.geometry;

  ctx.save();
  ctx.globalAlpha = ink;

  // The caption carries the block's name once the miniature has the
  // middle of the face. It arrives on the same curve as the rest of the
  // miniature, just after drawBlock's centered name has gone (see
  // NAME_OUT/PREVIEW_IN) — the block reads as briefly unlabelled between
  // the two, which is the transition, rather than as doubly labelled.
  const captionSize = CAPTION_FONT_SIZE / zoom;
  const captionInset = PREVIEW_PADDING / zoom;
  ctx.fillStyle = palette.blockText;
  ctx.font = `${captionSize}px ${MINI_FONT_STACK}`;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'top';
  ctx.fillText(block.name || '', x + captionInset, y + captionInset * 0.6, width - captionInset * 2);

  // Clipped to the face so anything reaching past the fitted bounds — a
  // hand-routed wire's detour, say — can't spill onto the canvas.
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();

  ctx.translate(layout.offsetX, layout.offsetY);
  ctx.scale(layout.scale, layout.scale);

  // The interior's own boundary frame, the dashed container its ports sit
  // on — the same thing drawBoundary paints on entering, minus the ports
  // themselves, which would land alongside this block's real ports and
  // read as a second, contradictory set.
  const boundaryGeometry = block.boundaryGeometry;
  if (boundaryGeometry) {
    ctx.save();
    ctx.setLineDash([4 / effectiveZoom, 3 / effectiveZoom]);
    ctx.strokeStyle = palette.boundaryDash;
    ctx.lineWidth = MINI_BORDER_WIDTH / effectiveZoom;
    ctx.strokeRect(boundaryGeometry.x, boundaryGeometry.y, boundaryGeometry.width, boundaryGeometry.height);
    ctx.restore();
  }

  // Wires first, so every silhouette paints over its own endpoints — the
  // same relationship a wire has with its frontmost block in the real
  // scene. No hop bows and no labels: both are legibility devices sized
  // for a full-size diagram, and at this scale they only add noise.
  const boundary = boundaryGeometry ? { block, geometry: boundaryGeometry } : null;
  for (const connection of view.listConnections()) {
    const geometry = getConnectionGeometry(view, connection, boundary);
    if (!geometry) continue;
    drawPath(ctx, geometry.points, {
      color: connection.color || DEFAULT_WIRE_COLOR,
      width: MINI_WIRE_WIDTH / effectiveZoom,
    });
    // A wire that runs out to the container's own interface ends on the
    // dashed frame, where the full-size view draws a boundary port (see
    // BlockRenderer.drawBoundary). Without something there the wire just
    // stops in mid-air and reads as broken, so each such endpoint gets the
    // same dot a child block's port gets. Only the ones actually in use:
    // an unwired pin has no wire to leave dangling, and drawing every pin
    // would put a second set of port marks on a face that already carries
    // this block's real ones.
    if (connection.sourceBlockId === block.id) drawFramePort(ctx, geometry.sourcePos, palette, effectiveZoom);
    if (connection.targetBlockId === block.id) drawFramePort(ctx, geometry.targetPos, palette, effectiveZoom);
  }

  for (const child of view.listBlocks()) {
    // A child with its own internals gets the same treatment recursively,
    // gated on its own on-screen size under the combined scale — so it
    // opens up only once you've zoomed far enough that it, too, has room.
    // Its alpha drives the same crossfade one level down that this one's
    // does up here: the silhouette's centered name out, the nested
    // miniature and its caption in.
    const childT = depth + 1 < MAX_DEPTH ? subPreviewProgress(child, effectiveZoom) : 0;
    ctx.save();
    drawMiniBlock(ctx, child, palette, effectiveZoom, childT);
    ctx.restore();
    drawSubPreview(ctx, child, { zoom: effectiveZoom, t: childT, palette, depth: depth + 1 });
  }

  ctx.restore();
}
