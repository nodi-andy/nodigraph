/**
 * Levels, drawn nested — one renderer for the level being edited and for
 * every level visible inside it.
 *
 * A container block's frame is a scaled picture of its face (see
 * model/levelGeometry.js), so the level inside it can be drawn straight
 * onto the face through one transform: the children land where they sit
 * inside, and every boundary pin lands exactly on the block's own
 * exterior pin. drawLevel draws one level's contents — wires and blocks
 * in z-order, with the selection and drag state of the level that is
 * currently being edited (the `focus`) — and for each child that has a
 * level of its own calls drawSubPreview, which crossfades that level in
 * on the child's face and calls drawLevel again for it. SceneRenderer
 * starts this at the root, whatever level is being edited, so nothing
 * on screen ever changes when the editing focus moves from one level to
 * another: the picture you were looking at IS the level.
 *
 * Two levels of detail, crossfaded on the effective zoom (screen pixels
 * per child world unit): silhouettes while the level is small — fills,
 * borders, port dots, a caption with the block's name — and the real
 * drawBlock/wire rendering once there is room to read it. A level is
 * editable exactly when it is drawn at full detail (see isLevelEditable
 * and interaction/LevelFocus.js), and the levels on the way down to the
 * one being edited are always drawn at full detail, whatever the zoom.
 *
 * Culling is by the visible world rect handed down from SceneRenderer, so
 * a level whose block is off screen, or a child off the visible part of
 * its level, costs nothing.
 */
import {
  drawConnectionLabel,
  drawPath,
  getConnectionGeometry,
  getDashPattern,
  verticalSegmentsOf,
  FLOW_DASH,
} from './ConnectionRenderer.js';
import { drawBlock, drawBoundary, drawResizeHandles, getPortPosition, hasSubArchitecture } from './BlockRenderer.js';
import { LevelView } from '../model/levelView.js';
import { frameToFace } from '../model/levelGeometry.js';
import { GRID_SIZE } from '../model/grid.js';
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
// goes from silhouettes to the real block and wire rendering. At 0.3 a
// default block is 36 px wide — the silhouette's caption is still the
// only legible text; by 0.55 its own name reads, and the level can be
// edited (see isLevelEditable).
const DETAIL_IN = [0.3, 0.55];
export const DETAIL_FULL_ZOOM = DETAIL_IN[1];

// Position within a [start, end] window, clamped to 0..1 at both ends.
function ramp(t, [start, end]) {
  return Math.min(1, Math.max(0, (t - start) / (end - start)));
}

// A hard stop on recursion, well past anything a real diagram nests. The
// working bound is the size gate: a level only opens once its block has
// FADE_IN_SIZE pixels on screen, and every level down is smaller by its
// frame's scale, so how deep the drawing goes follows the zoom.
export const MAX_DEPTH = 12;

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
const WIRE_COLOR = DEFAULT_WIRE_COLOR;
const WIRE_SELECTED_HALO = 'rgba(255, 180, 84, 0.55)';
const SELECTION_COLOR = '#4f8cff';

// A dot at every grid intersection rather than a lattice of lines — the
// Figma/design-tool convention, and a lot less visually busy across a
// large diagram than full-length lines crossing behind every block. The
// radius is a fixed *screen* size so dots stay a legible, constant pixel
// size whether zoomed in or panned far out. Below MIN_GRID_SCREEN_SPACING
// pixels between dots the grid is a grey wash, not a guide, and is left
// out — which is also what keeps the root level's grid from being drawn
// at a fraction of a pixel under a deeply nested level being edited.
const GRID_DOT_RADIUS = 1.4;
const MIN_GRID_SCREEN_SPACING = 8;

const EMPTY_SET = new Set();
const CULL_PAD = 120;

export function drawGridDots(ctx, rect, zoom, palette, alpha = 1) {
  if (!rect || GRID_SIZE * zoom < MIN_GRID_SCREEN_SPACING) return;
  const startX = Math.floor(rect.x / GRID_SIZE) * GRID_SIZE;
  const startY = Math.floor(rect.y / GRID_SIZE) * GRID_SIZE;
  const endX = rect.x + rect.width;
  const endY = rect.y + rect.height;
  const radius = GRID_DOT_RADIUS / zoom;
  ctx.save();
  if (alpha < 1) ctx.globalAlpha *= alpha;
  ctx.fillStyle = palette.grid;
  ctx.beginPath();
  for (let gy = startY; gy <= endY; gy += GRID_SIZE) {
    for (let gx = startX; gx <= endX; gx += GRID_SIZE) {
      ctx.moveTo(gx + radius, gy);
      ctx.arc(gx, gy, radius, 0, Math.PI * 2);
    }
  }
  ctx.fill();
  ctx.restore();
}

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
 * Whether `block`'s level, drawn on its face at this zoom (the zoom of
 * the level `block` sits in), is at full detail — the level is exactly
 * as it would be drawn when edited, so it can be edited in place (see
 * interaction/LevelFocus.js).
 */
export function isLevelEditable(block, zoom) {
  if (subPreviewProgress(block, zoom) < 1) return false;
  const t = frameToFace(block.geometry, block.boundaryGeometry);
  return zoom * t.scale >= DETAIL_FULL_ZOOM;
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

// Two wires that leave or arrive at the same port are the same signal, so
// where they meet is a junction, not a crossing — bowing there would claim
// the opposite of what's true.
function sharesEndpoint(a, b) {
  return (
    a.sourcePortId === b.sourcePortId
    || a.targetPortId === b.targetPortId
    || a.sourcePortId === b.targetPortId
    || a.targetPortId === b.sourcePortId
  );
}

// Computed once per level per frame, independent of draw order — routing
// (and the hopOver bow every wire needs against every other) is a purely
// geometric question, unrelated to which of them ends up painted over
// which block (see drawLevel's own z-ordering of this same list).
export function routeConnections(view, boundary, wireMoveOverride = null, hiddenConnectionId = null) {
  const routed = [];
  for (const connection of view.listConnections()) {
    // The one connection currently being picked up to redirect (see
    // DragStateMachine.getRedirectingConnectionId) is left out of its own
    // ordinary, static rendering entirely — the whole point being that it
    // visibly comes off its old port the instant it's grabbed, rather than
    // sitting there unchanged alongside the live dashed preview (drawn
    // separately, over everything — see SceneRenderer) that's standing in
    // for it. Left out of hopOver bowing too: nothing else should still
    // treat it as an obstacle once it's already "in the air."
    if (connection.id === hiddenConnectionId) continue;
    const geometry = getConnectionGeometry(view, connection, boundary, wireMoveOverride);
    if (geometry) routed.push({ connection, geometry, verticals: verticalSegmentsOf(geometry.points) });
  }
  return routed;
}

function drawOneConnection(ctx, entry, routed, wireSelection, flowOffset, palette) {
  const hopOver = routed
    .filter((other) => other !== entry && !sharesEndpoint(other.connection, entry.connection))
    .flatMap((other) => other.verticals);

  // Selection is a halo behind the wire rather than a recolor of it: the
  // main reason to select a pipe is to change its color, and repainting
  // it to show it is selected would hide the very thing being chosen.
  // The halo stays solid while the wire above it marches, which also
  // makes the dashes read as gaps in a wire rather than as a new shape.
  const selected = wireSelection?.isSelected(entry.connection.id);
  if (selected) {
    drawPath(ctx, entry.geometry.points, { color: WIRE_SELECTED_HALO, width: 9, hopOver });
  }
  // Animate takes over the whole wire's dashing while it's running,
  // regardless of the wire's own resting style — the marching dashes
  // are the point of it, not something a dotted wire should opt out of.
  // window.nodigraphConnectionColor (see main.js's own doc on this file's
  // handful of host hooks) lets a host recolor a specific wire by
  // whatever data it's presently carrying, without touching the
  // connection's own stored `color` at all -- the Inspector's own color
  // picker (see ui/InspectorPanel.js) stays exactly as authoritative as
  // it always was for any wire the host has no opinion on (a host
  // returning null/undefined here, which is every wire by default with
  // no hook set at all).
  const hostColor = typeof window !== 'undefined' ? window.nodigraphConnectionColor?.(entry.connection) : null;
  drawPath(ctx, entry.geometry.points, {
    color: hostColor || entry.connection.color || WIRE_COLOR,
    width: 3,
    hopOver,
    dash: flowOffset === null ? getDashPattern(entry.connection.dashStyle) : FLOW_DASH,
    dashOffset: flowOffset ?? 0,
  });
  drawConnectionLabel(ctx, entry.geometry, entry.connection.label, palette);
}

// The dashed outline of the level being edited when that level is a
// nested one: its container's face border is already there (drawn by the
// level above), so this is only a quiet reminder of which level the
// selection and the next click belong to — and, when the container is
// the selected thing, the frame's own resize handles.
function drawFocusFrame(ctx, geometry, { selected, palette, zoom }) {
  const { x, y, width, height } = geometry;
  ctx.save();
  ctx.globalAlpha *= 0.6;
  ctx.setLineDash([8 / zoom, 6 / zoom]);
  ctx.strokeStyle = selected ? SELECTION_COLOR : palette.boundaryDash;
  ctx.lineWidth = 1.5 / zoom;
  ctx.strokeRect(x, y, width, height);
  ctx.restore();
  if (selected) drawResizeHandles(ctx, geometry, palette, zoom);
}

/**
 * Draws one level's contents in that level's own coordinates — `ctx` is
 * already under the transform that puts them on screen, and `zoom` is
 * how many screen pixels one of its world units is. `view` is a Project
 * (the level being edited, in the flat rendering exports use) or a
 * LevelView (any level, in the nested rendering).
 *
 * `boundary` ({ block, geometry }) draws the level's dashed frame with
 * the container's pins as seen from inside — the root level and the flat
 * rendering; a nested level's pins are already on screen as its
 * container's exterior pins, drawn by the level above, so it passes
 * none. `focus` (see SceneRenderer.renderScene) says which level is being
 * edited and carries its selection and drag state; the other levels draw
 * without any of it. `showSubPreviews` off draws every block closed, the
 * way an exported figure reads at one level.
 */
export function drawLevel(
  ctx,
  view,
  {
    zoom = 1,
    palette = getCanvasPalette('light'),
    visible = null,
    focus = null,
    depth = 0,
    boundary = null,
    showSubPreviews = true,
    flowOffset = null,
    requestRender = () => {},
    onDrawBlock = () => {},
  } = {},
) {
  const container = view.getContainerBlock();
  const focused = Boolean(focus) && container?.id === focus.containerId;
  const selectedBlockIds = focused ? focus.selectedBlockIds || EMPTY_SET : EMPTY_SET;
  const selectedBlockId = focused ? focus.selectedBlockId : null;
  const portHighlights = focus?.portHighlights || null;
  const wireSelection = focused ? focus.wireSelection : null;
  const hiddenConnectionId = focused ? focus.hiddenConnectionId : null;
  const wireMoveOverride = focused ? focus.wireMoveOverride : null;

  // Wires that end on the container's own pins route to the frame
  // whether or not the frame itself is drawn.
  const routingBoundary = container?.boundaryGeometry ? { block: container, geometry: container.boundaryGeometry } : null;
  const routed = routeConnections(view, routingBoundary, wireMoveOverride, hiddenConnectionId);
  if (focused && focus.out) focus.out.routed = routed;

  const blocks = view.listBlocks();
  // A block just off the visible rect can still reach into it with a
  // port label or its shadow, so the cull is padded by a screen-constant
  // margin.
  const cullRect = visible
    ? { x: visible.x - CULL_PAD / zoom, y: visible.y - CULL_PAD / zoom, width: visible.width + (2 * CULL_PAD) / zoom, height: visible.height + (2 * CULL_PAD) / zoom }
    : null;

  // `blocks` is already this level's own z-order (see Project's
  // bringToFront/sendToBack — later in the list means drawn later, i.e. on
  // top), so a block's index here doubles as its z-index. A wire's own
  // z-index is the *higher* of its two endpoints' — bringing a block to
  // the front brings its wires along with it, at least far enough to clear
  // whatever they'd otherwise still be tucked under, rather than every
  // wire staying pinned to the very back regardless of which blocks have
  // since been reordered in front of each other. The boundary/container
  // itself never participates (it isn't one of `blocks`, and doesn't
  // reorder) — a wire touching it just inherits its one real, ordinary
  // endpoint's z-index outright, and the frame itself keeps drawing before
  // every wire regardless (see below), same as always.
  const blockZIndex = new Map(blocks.map((block, i) => [block.id, i]));
  const zIndexOfEndpoint = (blockId) => blockZIndex.get(blockId) ?? -1;
  const drawItems = [
    ...routed.map((entry) => ({
      kind: 'connection',
      z: Math.max(zIndexOfEndpoint(entry.connection.sourceBlockId), zIndexOfEndpoint(entry.connection.targetBlockId)),
      entry,
    })),
    ...blocks.map((block, z) => ({ kind: 'block', z, block })),
  ];
  // Stable (native Array#sort is a stable sort per spec): entries already
  // sharing a z-index keep their relative order from the concat above,
  // which is exactly what puts a wire tied with its own frontmost block
  // right before that block — so the block's own port/connector glyphs
  // still paint over the wire's endpoint, not the other way around.
  drawItems.sort((a, b) => a.z - b.z);

  // The frame (and its own ports) always draws before every wire and
  // before the real blocks, so they visually sit "inside" it rather than
  // the dashed outline cutting across them.
  if (boundary) {
    // The container's own ports as seen from inside — cloned exterior
    // siblings (see BlockDescription.clonePort) collapse onto one entry
    // here, so a name+direction pair reads as the single logical pin it
    // actually is rather than one row per wire it happens to have outside.
    const boundaryPorts = view.listBoundaryPorts(boundary.block);
    // Which wires (if any beyond the ordinary single one) attach to each
    // of those pins from inside — see Project.listBoundaryWires (already
    // resolved against the same collapsed group) and BlockRenderer.drawPorts.
    const boundaryWireLabels = new Map(
      boundaryPorts.map((port) => {
        const ids = view.listBoundaryWires(boundary.block.id, port.id);
        return [port.id, ids.map((id, rank) => ({ id, rank, label: view.getConnection(id)?.label || '' }))];
      }),
    );
    drawBoundary(ctx, { ...boundary.block, ports: boundaryPorts }, boundary.geometry, {
      selected: boundary.block.id === selectedBlockId,
      portHighlights,
      palette,
      boundaryWireLabels,
      wireMoveOverride,
      zoom,
    });
  } else if (focused && routingBoundary) {
    drawFocusFrame(ctx, routingBoundary.geometry, { selected: container.id === selectedBlockId, palette, zoom });
  }

  for (const item of drawItems) {
    if (item.kind === 'connection') {
      drawOneConnection(ctx, item.entry, routed, wireSelection, flowOffset, palette);
      continue;
    }
    const block = item.block;
    if (cullRect && !intersects(block.geometry, cullRect) && !focus?.pathIds?.has(block.id)) continue;
    // One number positions both halves of the crossfade: drawSubPreview
    // paints the level from it, and drawBlock fades the name and badge
    // it displaces back out (see contentAlphaFor). A block on the way
    // down to the level being edited is always fully open.
    let previewT = showSubPreviews ? subPreviewProgress(block, zoom) : 0;
    if (showSubPreviews && focus?.pathIds?.has(block.id) && hasSubArchitecture(block) && block.boundaryGeometry) previewT = 1;
    drawBlock(ctx, block, {
      selected: selectedBlockIds.has(block.id),
      portHighlights,
      requestRender,
      palette,
      zoom,
      contentAlpha: contentAlphaFor(previewT),
    });
    if (previewT > 0) {
      drawSubPreview(ctx, block, { zoom, t: previewT, palette, depth: depth + 1, visible, focus, flowOffset, requestRender, onDrawBlock });
    }
    // The host's per-block drawing hook (see SceneRenderer.renderScene)
    // fires for the level being edited only — what it always drew on.
    if (focused) onDrawBlock(ctx, block);
  }
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
 * `visible` (optional) is the visible world rect in the coordinates of
 * the level `block` sits in; anything outside it is skipped. `focus`
 * (see drawLevel) makes a block on the path to the level being edited
 * draw fully open at any zoom, and unclipped, so a child dragged past
 * the frame from inside stays on screen.
 */
export function drawSubPreview(
  ctx,
  block,
  { zoom = 1, t = 1, palette = getCanvasPalette('light'), depth = 0, visible = null, focus = null, flowOffset = null, requestRender = () => {}, onDrawBlock = () => {} } = {},
) {
  const onFocusPath = Boolean(focus?.pathIds?.has(block.id));
  const ink = onFocusPath ? 1 : previewInkFor(t);
  const frame = block.boundaryGeometry;
  if (ink <= 0 || depth >= MAX_DEPTH || !hasSubArchitecture(block) || !frame) return;
  if (visible && !onFocusPath && !intersects(block.geometry, visible)) return;

  const view = new LevelView(block);
  const layout = frameToFace(block.geometry, frame);
  const effectiveZoom = zoom * layout.scale;
  const detail = onFocusPath ? 1 : ramp(effectiveZoom, DETAIL_IN);
  const { x, y, width, height } = block.geometry;

  const boundary = { block, geometry: frame };

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
  ctx.globalAlpha *= ink;

  // The caption carries the block's name while the level is a silhouette
  // whose own names are too small to read; it fades out as the real
  // rendering, names included, fades in.
  if (detail < 1) {
    const captionSize = CAPTION_FONT_SIZE / zoom;
    const captionInset = CAPTION_INSET / zoom;
    ctx.save();
    ctx.globalAlpha *= 1 - detail;
    ctx.fillStyle = palette.blockText;
    ctx.font = `${captionSize}px ${MINI_FONT_STACK}`;
    ctx.textAlign = 'left';
    ctx.textBaseline = 'top';
    ctx.fillText(block.name || '', x + captionInset, y + captionInset * 0.6, width - captionInset * 2);
    ctx.restore();
  }

  // Clipped to the face so anything reaching past the frame — a child
  // placed outside it, a hand-routed wire's detour — can't spill onto the
  // parent level. Not on the way down to the level being edited: there a
  // child dragged past the frame has to stay visible to be dragged back.
  if (!onFocusPath) {
    ctx.beginPath();
    ctx.rect(x, y, width, height);
    ctx.clip();
  }

  ctx.translate(layout.offsetX, layout.offsetY);
  ctx.scale(layout.scale, layout.scale);

  // The level's own grid, fading in with its detail — over the face's
  // fill, under its contents, exactly what the canvas shows behind the
  // root level.
  if (detail > 0 && childVisible) drawGridDots(ctx, childVisible, effectiveZoom, palette, detail);

  // Silhouette pass — fades out as detail comes in.
  if (detail < 1) {
    const routed = [];
    for (const connection of view.listConnections()) {
      const geometry = getConnectionGeometry(view, connection, boundary);
      if (geometry) routed.push({ connection, geometry });
    }
    const children = view.listBlocks().filter((child) => !childVisible || intersects(child.geometry, childVisible));
    ctx.save();
    ctx.globalAlpha *= PREVIEW_ALPHA * (1 - detail);
    for (const { connection, geometry } of routed) {
      drawPath(ctx, geometry.points, { color: connection.color || DEFAULT_WIRE_COLOR, width: MINI_WIRE_WIDTH / effectiveZoom });
      if (connection.sourceBlockId === block.id) drawEdgeTerminal(ctx, geometry.sourcePos, palette, effectiveZoom);
      if (connection.targetBlockId === block.id) drawEdgeTerminal(ctx, geometry.targetPos, palette, effectiveZoom);
    }
    for (const child of children) {
      ctx.save();
      drawMiniBlock(ctx, child, palette, effectiveZoom, subPreviewProgress(child, effectiveZoom));
      ctx.restore();
    }
    ctx.restore();
  }

  // Full-detail pass — the level drawn exactly as the level being edited
  // is drawn (same drawLevel), so moving the editing focus into it
  // changes nothing on screen. Its children's own levels open inside it
  // in turn, gated on their on-screen size under the combined scale.
  if (detail > 0) {
    ctx.save();
    ctx.globalAlpha *= detail;
    drawLevel(ctx, view, {
      zoom: effectiveZoom,
      palette,
      visible: childVisible,
      focus,
      depth,
      boundary: null,
      showSubPreviews: true,
      flowOffset,
      requestRender,
      onDrawBlock,
    });
    ctx.restore();
  }

  ctx.restore();
}
