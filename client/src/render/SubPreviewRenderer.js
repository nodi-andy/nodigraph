/**
 * A block's own level, drawn in place on its face.
 *
 * This is the rendering half of the endless zoom. A container block's
 * frame is a scaled picture of its face (see model/levelGeometry.js), so
 * the level inside it can be drawn straight onto the face through one
 * transform — the children land where they sit inside, and every
 * boundary pin lands exactly on the block's own exterior pin. Zoom in and
 * the level grows with the block; zoom far enough and the camera crosses
 * into it (see main.js's crossLevelsForZoom) with nothing on screen
 * moving, because the picture you were looking at IS the level.
 *
 * Two levels of detail, crossfaded on the effective zoom (screen pixels
 * per child world unit): silhouettes while the level is small — fills,
 * borders, port dots, a caption with the block's name — and the real
 * drawBlock/wire rendering once there is room to read it, so what you see
 * a moment before crossing in is identical to what you see after.
 *
 * Nothing in this file is interactive: hit-testing, selection and drag
 * still see a plain block until the camera has crossed into the level.
 * Culling is by the visible world rect handed down from SceneRenderer, so
 * a level whose block is off screen, or a child off the visible part of
 * its level, costs nothing.
 */
import { drawConnectionLabel, drawPath, getConnectionGeometry, getDashPattern } from './ConnectionRenderer.js';
import { drawBlock, getPortPosition, hasSubArchitecture } from './BlockRenderer.js';
import { LevelView } from '../model/levelView.js';
import { frameToFace } from '../model/levelGeometry.js';
import { getCanvasPalette } from './canvasPalette.js';

// The block's smaller on-screen dimension, in CSS pixels, where the
// transition starts and where it's complete. Below FADE_IN the level is a
// smudge that costs more attention than it repays. The span between the
// two keeps it from popping into existence mid-zoom-gesture. A default
// block (120x80 world units) reaches FULL at roughly 2.9x zoom; a large
// one, drawn four grid cells tall, at 1.4x.
const FADE_IN_SIZE = 130;
const FULL_SIZE = 230;

// The crossfade fades *through* rather than dissolving one image into the
// other: the centered name leaves over NAME_OUT and the level only starts
// arriving at PREVIEW_IN, so the two barely coexist.
const NAME_OUT = [0.2, 0.55];
const PREVIEW_IN = [0.45, 1];

// Effective zoom (screen px per child world unit) over which the drawing
// goes from silhouettes to the real block and wire rendering. At 0.5 a
// default block is 60 px wide — the silhouette's caption is still the
// only legible text; by 0.9 its own name and port labels read fine.
const DETAIL_IN = [0.5, 0.9];

// Position within a [start, end] window, clamped to 0..1 at both ends.
function ramp(t, [start, end]) {
  return Math.min(1, Math.max(0, (t - start) / (end - start)));
}

// A hard stop on recursion, well past anything a real diagram nests. The
// working bound is the size gate: a level only opens once its block has
// FADE_IN_SIZE pixels on screen, and every level down is smaller by its
// frame's scale, so how deep the drawing goes follows the zoom.
const MAX_DEPTH = 12;

// Screen-constant type sizes, divided by the effective scale before use.
const CAPTION_INSET = 9;
const CAPTION_FONT_SIZE = 10;
const MINI_FONT_SIZE = 9;
const MINI_CORNER_RADIUS = 2.5;

// How thick a previewed wire and a previewed block's border are drawn, in
// screen pixels, while the level is a silhouette.
const MINI_WIRE_WIDTH = 1.3;
const MINI_BORDER_WIDTH = 0.9;

// The silhouette is a quieter register than the block's own face, so it
// is drawn under this; the full-detail rendering is the real thing and
// paints at full strength.
const PREVIEW_ALPHA = 0.85;

const MINI_FONT_STACK = '-apple-system, Segoe UI, Roboto, sans-serif';
const DEFAULT_WIRE_COLOR = '#4f8cff';
const DEFAULT_ACCENT_COLOR = '#3b6fa0';

/**
 * How far along the crossfade `block` is at this zoom: 0 (an ordinary
 * block, nothing to show) to 1 (fully opened up). Deliberately not an
 * opacity — it's the one position both halves are read off, by
 * drawSubPreview for the level and by contentAlphaFor for the name and
 * badge it displaces, so the two can never disagree about where in the
 * transition they are.
 */
export function subPreviewProgress(block, zoom) {
  if (block.kind === 'text' || !hasSubArchitecture(block) || !block.boundaryGeometry) return 0;
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

function previewInkFor(t) {
  return ramp(t, PREVIEW_IN);
}

function intersects(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}

// A block reduced to its silhouette: fill, accent border, port dots and
// its name if there's a legible amount of room for it.
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

// The terminal a wire runs out to when it leaves for the container's own
// interface — on the frame's edge, which the transform puts on the face's
// edge, right under the block's own exterior pin.
function drawEdgeTerminal(ctx, position, palette, effectiveZoom) {
  if (!position) return;
  ctx.beginPath();
  ctx.arc(position.x, position.y, (MINI_WIRE_WIDTH * 1.4) / effectiveZoom, 0, Math.PI * 2);
  ctx.fillStyle = palette.portLabel;
  ctx.fill();
}

/**
 * Draws `block`'s level inside its own face. Call it after drawBlock has
 * painted that block, passing the `t` subPreviewProgress returned for the
 * same block and zoom — early enough in the ramp (or 0) draws nothing.
 * `visible` (optional) is the visible world rect in this level's own
 * coordinates; anything outside it is skipped.
 */
export function drawSubPreview(ctx, block, { zoom = 1, t = 1, palette = getCanvasPalette('light'), depth = 0, visible = null } = {}) {
  const ink = previewInkFor(t);
  const frame = block.boundaryGeometry;
  if (ink <= 0 || depth >= MAX_DEPTH || !hasSubArchitecture(block) || !frame) return;
  if (visible && !intersects(block.geometry, visible)) return;

  const view = new LevelView(block);
  const layout = frameToFace(block.geometry, frame);
  const effectiveZoom = zoom * layout.scale;
  const detail = ramp(effectiveZoom, DETAIL_IN);
  const { x, y, width, height } = block.geometry;

  const boundary = { block, geometry: frame };
  const routed = [];
  for (const connection of view.listConnections()) {
    const geometry = getConnectionGeometry(view, connection, boundary);
    if (geometry) routed.push({ connection, geometry });
  }

  // What the level sees of the viewport, in its own coordinates.
  const childVisible = visible
    ? {
        x: (visible.x - layout.offsetX) / layout.scale,
        y: (visible.y - layout.offsetY) / layout.scale,
        width: visible.width / layout.scale,
        height: visible.height / layout.scale,
      }
    : null;

  ctx.save();
  ctx.globalAlpha = ink;

  // The caption carries the block's name while the level is a silhouette
  // whose own names are too small to read; it fades out as the real
  // rendering, names included, fades in.
  if (detail < 1) {
    const captionSize = CAPTION_FONT_SIZE / zoom;
    const captionInset = CAPTION_INSET / zoom;
    ctx.save();
    ctx.globalAlpha = ink * (1 - detail);
    ctx.fillStyle = palette.blockText;
    ctx.font = `${captionSize}px ${MINI_FONT_STACK}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(block.name || '', x + captionInset, y + captionInset * 0.6, width - captionInset * 2);
    ctx.restore();
  }

  // Clipped to the face so anything reaching past the frame — a child
  // placed outside it, a hand-routed wire's detour — can't spill onto the
  // parent level.
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();

  ctx.translate(layout.offsetX, layout.offsetY);
  ctx.scale(layout.scale, layout.scale);

  const children = view.listBlocks().filter((child) => !childVisible || intersects(child.geometry, childVisible));

  // Silhouette pass — fades out as detail comes in.
  if (detail < 1) {
    ctx.save();
    ctx.globalAlpha = ink * PREVIEW_ALPHA * (1 - detail);
    for (const { connection, geometry } of routed) {
      drawPath(ctx, geometry.points, { color: connection.color || DEFAULT_WIRE_COLOR, width: MINI_WIRE_WIDTH / effectiveZoom });
      if (connection.sourceBlockId === block.id) drawEdgeTerminal(ctx, geometry.sourcePos, palette, effectiveZoom);
      if (connection.targetBlockId === block.id) drawEdgeTerminal(ctx, geometry.targetPos, palette, effectiveZoom);
    }
    for (const child of children) {
      const childT = subPreviewProgress(child, effectiveZoom);
      ctx.save();
      drawMiniBlock(ctx, child, palette, effectiveZoom, childT);
      ctx.restore();
    }
    ctx.restore();
  }

  // Full-detail pass — the level drawn exactly as it is drawn once the
  // camera has crossed into it (same drawBlock, same wire renderer), so
  // the crossing changes nothing on screen.
  if (detail > 0) {
    ctx.save();
    ctx.globalAlpha = ink * detail;
    for (const { connection, geometry } of routed) {
      drawPath(ctx, geometry.points, { color: connection.color || DEFAULT_WIRE_COLOR, dash: getDashPattern(connection.dashStyle) });
      if (connection.label) drawConnectionLabel(ctx, geometry, connection.label, palette);
    }
    for (const child of children) {
      const childT = subPreviewProgress(child, effectiveZoom);
      drawBlock(ctx, child, { palette, zoom: effectiveZoom, contentAlpha: contentAlphaFor(childT) });
    }
    ctx.restore();
  }

  // A child with its own level gets the same treatment recursively, gated
  // on its own on-screen size under the combined scale.
  for (const child of children) {
    const childT = subPreviewProgress(child, effectiveZoom);
    if (childT > 0) drawSubPreview(ctx, child, { zoom: effectiveZoom, t: childT, palette, depth: depth + 1, visible: childVisible });
  }

  ctx.restore();
}
