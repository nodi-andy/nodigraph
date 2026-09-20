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
 * A level is shown as soon as its contents would be drawn at half size
 * or more (OPEN_ZOOM), eased in over a fraction of a second; there is no
 * intermediate rendering, what appears is the level exactly as it is
 * drawn when edited. A level is editable once it is shown at a readable
 * zoom (see isLevelEditable and interaction/LevelFocus.js), and the
 * levels on the way down to the one being edited are always drawn open,
 * whatever the zoom.
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
import { drawBlock, drawBoundary, drawBoundaryPins, drawBlockPorts, drawExteriorSubSlots, drawResizeHandles, hasSubArchitecture } from './BlockRenderer.js';
import { LevelView } from '../model/levelView.js';
import { defaultBoundaryFor, frameToFace } from '../model/levelGeometry.js';
import { GRID_SIZE } from '../model/grid.js';
import { getCanvasPalette } from './canvasPalette.js';

// A block's level opens once its contents would be drawn at this many
// screen pixels per world unit of the level — half size — whatever the
// block's own size on screen. Judged on the contents, not the face: a
// small block with a big frame shows a smudge long after its face is
// big, and a big block with a snug frame is readable while its face is
// still small. No crossfade over the zoom, the level is either shown or
// not, but the flip is eased over FADE_MS so it reads as the level
// arriving rather than popping. Shown and editable are the same
// threshold (see isLevelEditable); it is also where main.js hands the
// editing focus back to the parent on zooming out.
const OPEN_ZOOM = 0.5;
const FADE_MS = 160;
export const MIN_EDIT_ZOOM = OPEN_ZOOM;

// Position within a [start, end] window, clamped to 0..1 at both ends.
function ramp(t, [start, end]) {
  return Math.min(1, Math.max(0, (t - start) / (end - start)));
}

// A hard stop on recursion, well past anything a real diagram nests. The
// working bound is the size gate: a level only opens once its block has
// FADE_IN_SIZE pixels on screen, and every level down is smaller by its
// frame's scale, so how deep the drawing goes follows the zoom.
export const MAX_DEPTH = 12;

const WIRE_COLOR = '#4f8cff';
const WIRE_SELECTED_HALO = 'rgba(255, 180, 84, 0.55)';

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

// A rect of the level a block sits in, expressed in the coordinates of
// the level drawn inside that block (see frameToFace).
function toChildRect(rect, layout) {
  return {
    x: (rect.x - layout.offsetX) / layout.scale,
    y: (rect.y - layout.offsetY) / layout.scale,
    width: rect.width / layout.scale,
    height: rect.height / layout.scale,
  };
}

// The overlap of two rects, or null when they don't meet.
function intersection(a, b) {
  const x = Math.max(a.x, b.x);
  const y = Math.max(a.y, b.y);
  const width = Math.min(a.x + a.width, b.x + b.width) - x;
  const height = Math.min(a.y + a.height, b.y + b.height) - y;
  return width > 0 && height > 0 ? { x, y, width, height } : null;
}

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
 * The grid of the level *inside* `block`, painted on its face — for a
 * block whose level is not drawn there (closed at this zoom, or empty and
 * so never opening at all). drawSubPreview draws the same grid as part of
 * an open level; this is the standalone version, so the one container new
 * blocks land in (see `focus.gridBlockId`) shows its grid whether or not
 * its contents happen to be on screen. A block never entered yet has no
 * frame; the one it would get on being entered stands in, so the dots are
 * at the same scale they will be a moment later.
 */
function drawFaceGrid(ctx, block, { zoom = 1, palette, visible = null } = {}) {
  const frame = block.boundaryGeometry || defaultBoundaryFor(block.geometry);
  if (!frame) return;
  const layout = frameToFace(block.geometry, frame);
  const { x, y, width, height } = block.geometry;
  // The face itself, in the coordinates of the level inside it. Unlike an
  // open level — which has contents of its own reaching to the edge of
  // the viewport — there is nothing here but the dots, so the rect is
  // clamped to the face rather than handing drawGridDots the whole
  // viewport to generate a screenful of dots the clip then throws away.
  const face = {
    x: (x - layout.offsetX) / layout.scale,
    y: (y - layout.offsetY) / layout.scale,
    width: width / layout.scale,
    height: height / layout.scale,
  };
  const rect = visible ? intersection(face, toChildRect(visible, layout)) : face;
  if (!rect) return;
  ctx.save();
  ctx.beginPath();
  ctx.rect(x, y, width, height);
  ctx.clip();
  ctx.translate(layout.offsetX, layout.offsetY);
  ctx.scale(layout.scale, layout.scale);
  drawGridDots(ctx, rect, zoom * layout.scale, palette);
  ctx.restore();
}

function now() {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

// Whether `block`'s level is shown on its face at this zoom (the zoom of
// the level `block` sits in).
export function isLevelOpen(block, zoom) {
  if (block.kind === 'text' || !hasSubArchitecture(block) || !block.boundaryGeometry) return false;
  return zoom * frameToFace(block.geometry, block.boundaryGeometry).scale >= OPEN_ZOOM;
}

// Kept for callers that only need the target state: 1 when the level is
// shown, 0 when the block is closed.
export function subPreviewProgress(block, zoom) {
  return isLevelOpen(block, zoom) ? 1 : 0;
}

/**
 * Whether `block`'s level is drawn on its face at a zoom where it can be
 * edited in place (see interaction/LevelFocus.js).
 */
export function isLevelEditable(block, zoom) {
  return isLevelOpen(block, zoom);
}

// The eased opening of each level, keyed by block id: when the shown/
// closed state flips, the alpha runs from the old state to the new one
// over FADE_MS, asking for a redraw until it arrives. Ids of blocks that
// are gone linger here harmlessly; the map is small.
const openings = new Map();

/**
 * How far open `block`'s level is drawn right now, 0..1 — the animated
 * version of subPreviewProgress. drawBlock fades the name it displaces
 * by the same number (see contentAlphaFor), so the two halves
 * never disagree.
 */
export function previewAlphaFor(block, zoom, requestRender = () => {}) {
  const open = isLevelOpen(block, zoom);
  const t = now();
  let state = openings.get(block.id);
  if (!state) {
    state = { open, since: t - FADE_MS };
    openings.set(block.id, state);
  } else if (state.open !== open) {
    // Reverse mid-fade from where it is, not from the far end.
    const progress = Math.min(1, (t - state.since) / FADE_MS);
    state.open = open;
    state.since = t - (1 - progress) * FADE_MS;
  }
  const progress = Math.min(1, Math.max(0, (t - state.since) / FADE_MS));
  if (progress < 1) requestRender();
  return open ? progress : 1 - progress;
}

/**
 * The opacity everything an open level displaces should be drawn at —
 * the block's own centred name — at the given point
 * of the opening. The name fades where it stands; nothing moves.
 */
export function contentAlphaFor(t) {
  return 1 - t;
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
  } else if (focused && routingBoundary && container.id === selectedBlockId) {
    // A nested level draws no frame of its own. There is no "current
    // view" to outline any more — every level is on screen at once, and
    // the container's own face border is already drawn by the level
    // above, so a dashed rectangle inside it was a second border for a
    // thing that already has one (and, where the frame's aspect ratio
    // differs from the face's, one that did not even line up with it).
    // The root keeps its frame: it has no face anywhere to borrow a
    // border from, and it is what a new parent would be wrapped around.
    // Only the resize handles survive here, and only while the container
    // is the selected thing — they are how its frame is resized from
    // inside, and they are not a border.
    drawResizeHandles(ctx, routingBoundary.geometry, palette, zoom);
  }

  for (const item of drawItems) {
    if (item.kind === 'connection') {
      drawOneConnection(ctx, item.entry, routed, wireSelection, flowOffset, palette);
      continue;
    }
    const block = item.block;
    if (cullRect && !intersects(block.geometry, cullRect) && !focus?.pathIds?.has(block.id)) continue;
    // One number positions both halves of the crossfade: drawSubPreview
    // paints the level from it, and drawBlock fades the name it
    // displaces back out (see contentAlphaFor). A block on the way
    // down to the level being edited is always fully open.
    let previewT = showSubPreviews ? previewAlphaFor(block, zoom, requestRender) : 0;
    if (showSubPreviews && focus?.pathIds?.has(block.id) && hasSubArchitecture(block) && block.boundaryGeometry) previewT = 1;
    drawBlock(ctx, block, {
      selected: selectedBlockIds.has(block.id),
      portHighlights,
      requestRender,
      palette,
      zoom,
      contentAlpha: contentAlphaFor(previewT),
      portLabelsOutside: previewT,
    });
    if (previewT > 0) {
      drawSubPreview(ctx, block, { zoom, t: previewT, palette, depth: depth + 1, visible, focus, flowOffset, requestRender, onDrawBlock });
    } else if (focus?.gridBlockId === block.id) {
      // The block a new block would land in, with its level not drawn on
      // its face — closed at this zoom, or still empty, which is exactly
      // the case where "the next block goes in here" most needs saying.
      drawFaceGrid(ctx, block, { zoom, palette, visible });
    }
    // The host's per-block drawing hook (see SceneRenderer.renderScene)
    // fires for the level being edited only — what it always drew on.
    if (focused) onDrawBlock(ctx, block);
  }

  // Pins over wires. A wire's z-index is its front endpoint's, so it paints
  // over the other endpoint's arrowhead; and a level drawn inside a block
  // paints its wires over the block's own pins where they meet the frame.
  // Every block that has a wire in this level, or a level of its own,
  // gets its pins drawn once more on top.
  const wiredIds = new Set();
  for (const { connection } of routed) {
    wiredIds.add(connection.sourceBlockId);
    wiredIds.add(connection.targetBlockId);
  }
  for (const block of blocks) {
    if (!wiredIds.has(block.id) && !hasSubArchitecture(block)) continue;
    if (cullRect && !intersects(block.geometry, cullRect)) continue;
    const openAlpha = showSubPreviews && hasSubArchitecture(block) && block.boundaryGeometry ? (focus?.pathIds?.has(block.id) ? 1 : previewAlphaFor(block, zoom, requestRender)) : 0;
    drawBlockPorts(ctx, block, { portHighlights, palette, zoom, labelsOutside: openAlpha });
    // An open container's multi-wire pins split into sub-slots at this
    // level's scale (see BlockRenderer.drawExteriorSubSlots), arriving
    // with the level.
    if (openAlpha > 0) {
      const inner = new LevelView(block);
      const counts = new Map(inner.listBoundaryPorts(block).map((port) => [port.id, inner.listBoundaryWires(block.id, port.id).length]));
      drawExteriorSubSlots(ctx, block, counts, { palette, alpha: openAlpha });
    }
  }

  // A nested level's own pins on the frame, for the pins that carry wires
  // from inside: the plug outside is one connector, and this is where it
  // splits into the sub-slots the wires inside attach to (see
  // BlockRenderer.drawBoundaryPins). The container's exterior pin is drawn
  // over the first of them again by the level above.
  if (!boundary && routingBoundary) {
    const wiredPins = view.listBoundaryPorts(container).filter((port) => view.listBoundaryWires(container.id, port.id).length > 0);
    if (wiredPins.length) {
      const boundaryWireLabels = new Map(
        wiredPins.map((port) => {
          const ids = view.listBoundaryWires(container.id, port.id);
          return [port.id, ids.map((id, rank) => ({ id, rank, label: view.getConnection(id)?.label || '' }))];
        }),
      );
      drawBoundaryPins(ctx, container, routingBoundary.geometry, wiredPins, { portHighlights, palette, boundaryWireLabels, wireMoveOverride, zoom });
    }
  }
}

/**
 * Draws `block`'s level inside its own face. Call it after drawBlock has
 * painted that block, passing the `t` previewAlphaFor returned for the
 * same block and zoom — 0 draws nothing. `visible` (optional) is the
 * visible world rect in the coordinates of the level `block` sits in;
 * anything outside it is skipped. `focus` (see drawLevel) makes a block
 * on the path to the level being edited draw fully open at any zoom, and
 * unclipped, so a child dragged past the frame from inside stays on
 * screen.
 */
export function drawSubPreview(
  ctx,
  block,
  { zoom = 1, t = 1, palette = getCanvasPalette('light'), depth = 0, visible = null, focus = null, flowOffset = null, requestRender = () => {}, onDrawBlock = () => {} } = {},
) {
  const onFocusPath = Boolean(focus?.pathIds?.has(block.id));
  const alpha = onFocusPath ? 1 : t;
  const frame = block.boundaryGeometry;
  if (alpha <= 0 || depth >= MAX_DEPTH || !hasSubArchitecture(block) || !frame) return;
  if (visible && !onFocusPath && !intersects(block.geometry, visible)) return;

  const view = new LevelView(block);
  const layout = frameToFace(block.geometry, frame);
  const effectiveZoom = zoom * layout.scale;
  const { x, y, width, height } = block.geometry;

  // What the level sees of the viewport, in its own coordinates.
  const childVisible = visible ? toChildRect(visible, layout) : null;

  ctx.save();
  ctx.globalAlpha *= alpha;

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

  // The level's own grid — over the face's fill, under its contents,
  // exactly what the canvas shows behind the root level. Only the one
  // container a new block would land in gets it (see `focus.gridBlockId`),
  // so the dotted background reads as "here" rather than as scenery every
  // level repeats.
  if (childVisible && (focus?.gridBlockId == null || focus.gridBlockId === block.id)) {
    drawGridDots(ctx, childVisible, effectiveZoom, palette);
  }

  // The level drawn exactly as the level being edited is drawn (same
  // drawLevel), so moving the editing focus into it changes nothing on
  // screen. Its children's own levels open inside it in turn, gated on
  // their on-screen size under the combined scale.
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
