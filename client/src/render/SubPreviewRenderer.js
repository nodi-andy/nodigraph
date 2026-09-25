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
  buildHopIndex,
  beginRoutingPass,
  endRoutingPass,
  FLOW_DASH,
} from './ConnectionRenderer.js';
import { drawBlock, drawBoundary, drawBoundaryPins, drawBlockPorts, drawExteriorSubSlots, drawOpenHeader, drawResizeHandles, hasSubArchitecture, isPluggedConnection } from './BlockRenderer.js';
import { LevelView } from '../model/levelView.js';
import { logicalPortOf } from '../model/BlockDescription.js';
import { defaultBoundaryFor, frameToFace } from '../model/levelGeometry.js';
import { GRID_SIZE } from '../model/grid.js';
import { getCanvasPalette } from './canvasPalette.js';
import { getLevelOpenZoom } from './viewOptions.js';

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
//
// No longer a constant: how early a level should open is a preference
// (see render/viewOptions.js), so this reads it per call. The two names
// stay because they mean different things at the call sites even though
// they are the same number — one is "is this level drawn", the other is
// "is the view deep enough to be editing in it".
const FADE_MS = 160;
export function openZoom() {
  return getLevelOpenZoom();
}
export function minEditZoom() {
  return getLevelOpenZoom();
}

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
  // A block the host will not let you enter (window.nodigraphCanEnter, see
  // main.js's canEnterBlock) keeps its level closed on its face as well.
  // The host draws such a block's face opaque — noditron's board card
  // until the board is connected — so a level drawn under it would only
  // ever be paint nobody sees, plus port labels and live-value overlays
  // that leak out around a face that is supposed to be shut.
  if (typeof window !== 'undefined' && window.nodigraphCanEnter?.(block) === false) return false;
  if (block.style?.forceShowContent) return true;
  return zoom * frameToFace(block.geometry, block.boundaryGeometry).scale >= openZoom();
}

export function toggleForcedContent(block) {
  if (block.kind === 'text' || !hasSubArchitecture(block)) return false;
  block.boundaryGeometry ||= defaultBoundaryFor(block.geometry);
  block.style = { ...block.style, forceShowContent: !block.style?.forceShowContent };
  return true;
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
/**
 * Whether an invisible wire is being shown right now.
 *
 * A wire set invisible (see the Inspector's own toggle) is a connection
 * that is real but not worth drawing all the time — a clock line into
 * every block, a common ground, a bus every service talks to. Left drawn
 * they bury the diagram; deleted, the diagram lies about what is
 * connected. So the wire stays and the line does not, until you ask for
 * it by hovering one of the pins it lands on — the pin still carries its
 * plug, so a block always shows that it *is* connected.
 *
 * A selected one shows too, whatever the pointer is doing: the Inspector
 * is open on it, and a wire you are editing has to be on screen.
 */
export function isWireShown(connection, hoverPin = null, wireSelection = null) {
  if (!connection.invisible) return true;
  if (wireSelection?.isSelected(connection.id)) return true;
  if (!hoverPin) return false;
  return (
    (hoverPin.blockId === connection.sourceBlockId && hoverPin.portId === connection.sourcePortId)
    || (hoverPin.blockId === connection.targetBlockId && hoverPin.portId === connection.targetPortId)
  );
}

function sharesEndpoint(a, b) {
  return (
    a.sourcePortId === b.sourcePortId
    || a.targetPortId === b.targetPortId
    || a.sourcePortId === b.targetPortId
    || a.targetPortId === b.sourcePortId
  );
}

// A string id turned into a number, remembered — ids are stable and few,
// and the level signature below hashes the same handful every frame.
const idHashes = new Map();

function hashId(value) {
  if (value == null) return 0;
  let hash = idHashes.get(value);
  if (hash === undefined) {
    hash = 2166136261;
    for (let i = 0; i < value.length; i += 1) {
      hash ^= value.charCodeAt(i);
      hash = Math.imul(hash, 16777619);
    }
    hash >>>= 0;
    idHashes.set(value, hash);
  }
  return hash;
}

/**
 * Everything a level's routing depends on, as one number.
 *
 * Routes are worked out in the level's own world coordinates, so panning,
 * zooming and the flow animation cannot change a single one of them — yet
 * every frame re-derived the lot, and that is quadratic work (each wire is
 * compared against every other for shared trunks and detour lanes). On a
 * diagram of a few hundred wires it was most of the frame, on every frame,
 * including the ones where nothing had moved.
 *
 * So the routes are kept between frames and rebuilt only when something
 * they actually depend on differs: a block's box or one of its pins, a
 * wire's endpoints or hand-drawn route, the frame, or the drag state that
 * temporarily hides or redirects a wire. Derived from the data itself
 * rather than from a revision counter, because blocks are mutated in place
 * all over the editor and a counter would only have to be remembered in
 * every one of those places to be wrong in one of them.
 */
function levelSignature(view, boundary, wireMoveOverride, hidden) {
  let hash = 2166136261;
  const mix = (value) => {
    hash ^= value | 0;
    hash = Math.imul(hash, 16777619);
  };
  // Rounded to a hundredth of a unit: finer than that is below anything
  // that could move a route, and keeps float noise from thrashing the cache.
  const mixNumber = (value) => mix(Math.round((value || 0) * 100));

  for (const block of view.listBlocks()) {
    mix(hashId(block.id));
    const g = block.geometry || {};
    mixNumber(g.x);
    mixNumber(g.y);
    mixNumber(g.width);
    mixNumber(g.height);
    for (const port of block.ports || []) {
      mix(hashId(port.id));
      mix(hashId(port.side));
      mixNumber(port.offset);
      mix(port.hidden ? 1 : 2);
    }
  }
  for (const connection of view.listConnections()) {
    mix(hashId(connection.id));
    mix(hashId(connection.sourceBlockId));
    mix(hashId(connection.sourcePortId));
    mix(hashId(connection.targetBlockId));
    mix(hashId(connection.targetPortId));
    // A hand-drawn route is the author's own and is routed around nothing,
    // but it is still what gets drawn — so it belongs in the signature.
    const route = connection.route;
    if (route) {
      mix(hashId(route.first));
      for (const coord of route.coords || []) mixNumber(coord);
    }
    if (connection.manualBend) {
      mixNumber(connection.manualBend.x);
      mixNumber(connection.manualBend.y);
    }
  }
  const frame = boundary?.geometry;
  if (frame) {
    mix(hashId(boundary.block?.id));
    mixNumber(frame.x);
    mixNumber(frame.y);
    mixNumber(frame.width);
    mixNumber(frame.height);
  }
  if (wireMoveOverride) {
    mix(hashId(wireMoveOverride.connectionId));
    mix(hashId(wireMoveOverride.portId));
    mix(wireMoveOverride.previewIndex);
  }
  if (hidden instanceof Set) {
    // Order-independent, so the Set's own iteration order cannot matter.
    let hiddenHash = 0;
    for (const id of hidden) hiddenHash ^= hashId(id);
    mix(hiddenHash);
  } else if (hidden) {
    mix(hashId(hidden));
  }
  return hash >>> 0;
}

// One entry per level, keyed by the container block the level belongs to —
// so a diagram with several levels open at once keeps each one's routes.
// Keyed weakly: a level whose container is gone takes its cache with it.
const routeCache = new WeakMap();
// The root level of a Project has no container block to key on.
const ROOT_KEY = { root: true };

// Computed once per level per frame, independent of draw order — routing
// (and the hopOver bow every wire needs against every other) is a purely
// geometric question, unrelated to which of them ends up painted over
// which block (see drawLevel's own z-ordering of this same list).
// `hidden` is one connection id or a Set of them. A plugged connection
// (see BlockRenderer.isPluggedConnection) is never routed: its two blocks
// meet at the pin, and there is no wire to draw between them.
export function routeConnections(view, boundary, wireMoveOverride = null, hidden = null) {
  const key = view.getContainerBlock() || ROOT_KEY;
  const signature = levelSignature(view, boundary, wireMoveOverride, hidden);
  const cached = routeCache.get(key);
  if (cached && cached.signature === signature) return cached.routed;

  // Routing one wire asks about the others, and those questions repeat
  // enormously — see ConnectionRenderer.beginRoutingPass. The answers hold
  // for as long as this one pass over the level.
  beginRoutingPass();
  let routed;
  try {
    routed = routeConnectionsInPass(view, boundary, wireMoveOverride, hidden);
  } finally {
    endRoutingPass();
  }
  routeCache.set(key, { signature, routed });
  return routed;
}

function routeConnectionsInPass(view, boundary, wireMoveOverride, hidden) {
  const routed = [];
  const isHidden = hidden instanceof Set ? (id) => hidden.has(id) : (id) => id === hidden;
  for (const connection of view.listConnections()) {
    // The one connection currently being picked up to redirect (see
    // DragStateMachine.getRedirectingConnectionId) is left out of its own
    // ordinary, static rendering entirely — the whole point being that it
    // visibly comes off its old port the instant it's grabbed, rather than
    // sitting there unchanged alongside the live dashed preview (drawn
    // separately, over everything — see SceneRenderer) that's standing in
    // for it. Left out of hopOver bowing too: nothing else should still
    // treat it as an obstacle once it's already "in the air."
    if (isHidden(connection.id)) continue;
    if (isPluggedConnection(view, connection)) continue;
    const geometry = getConnectionGeometry(view, connection, boundary, wireMoveOverride);
    if (geometry) routed.push({ connection, geometry, verticals: verticalSegmentsOf(geometry.points) });
  }
  return routed;
}

// The colour a wire is drawn in. window.nodigraphConnectionColor (see
// main.js's own doc on this file's handful of host hooks) lets a host
// recolor a specific wire by whatever data it is presently carrying,
// without touching the connection's own stored `color`; the Inspector's
// colour picker stays authoritative for any wire the host has no opinion
// on. The plug the wire puts in its pins takes the same colour (see
// BlockRenderer.drawPorts).
function wireColorOf(connection) {
  const hostColor = typeof window !== 'undefined' ? window.nodigraphConnectionColor?.(connection) : null;
  return hostColor || connection.color || WIRE_COLOR;
}

// Map<blockId, Map<portId, colour | null>>: every connected pin in this
// level — the colour of its wire, for the grip, or null for a pin that is
// only plugged into its neighbour (connected, no wire). A pin with both
// keeps the wire's colour.
function pinWiresOf(routed, plugged = []) {
  const byBlock = new Map();
  const mark = (blockId, portId, color) => {
    if (!byBlock.has(blockId)) byBlock.set(blockId, new Map());
    const pins = byBlock.get(blockId);
    if (!pins.get(portId)) pins.set(portId, color);
  };
  for (const connection of plugged) {
    mark(connection.sourceBlockId, connection.sourcePortId, null);
    mark(connection.targetBlockId, connection.targetPortId, null);
  }
  for (const { connection } of routed) {
    const color = wireColorOf(connection);
    mark(connection.sourceBlockId, connection.sourcePortId, color);
    mark(connection.targetBlockId, connection.targetPortId, color);
  }
  return byBlock;
}

// A wire neither of whose pins has a direction set (IN/OUT in the
// Inspector — see BlockRenderer.pinShapeOf's two-way ring) carries nothing
// in either particular direction, so its animation swings back and forth
// instead of marching one way: SWING_AMPLITUDE world units either side,
// one full swing every SWING_PERIOD world units of the ordinary march —
// about 2.4 s at main.js's FLOW_SPEED.
const SWING_AMPLITUDE = 12;
const SWING_PERIOD = 132;

function isTwoWayConnection(view, connection) {
  const directionOf = (blockId, portId) => {
    const block = view.getBlock(blockId);
    const pin = block?.ports?.find((p) => p.id === portId);
    return logicalPortOf(block, pin)?.direction ?? null;
  };
  return !directionOf(connection.sourceBlockId, connection.sourcePortId) && !directionOf(connection.targetBlockId, connection.targetPortId);
}

function flowDashOffset(view, connection, flowOffset) {
  if (flowOffset === null) return 0;
  if (!isTwoWayConnection(view, connection)) return flowOffset;
  return SWING_AMPLITUDE * Math.sin((2 * Math.PI * flowOffset) / SWING_PERIOD);
}

// `hopIndex` is the level's shared index of vertical runs (see
// ConnectionRenderer.buildHopIndex), built once for the whole level rather
// than once per wire; `entryIndex` is this wire's position in `routed`,
// which is what the index's runs are tagged with.
function drawOneConnection(ctx, entry, entryIndex, routed, hopIndex, wireSelection, flowOffset, palette, view) {
  // A wire never bows over its own vertical runs, nor over those of a wire
  // hanging off one of its own pins — two wires meeting at a pin share
  // their approach to it by nature, and an arc there would read as a kink
  // rather than as one line crossing another.
  const hopSkip = (owner) => owner === entryIndex || sharesEndpoint(routed[owner].connection, entry.connection);
  const hopOver = hopIndex;

  // Selection is a halo behind the wire rather than a recolor of it: the
  // main reason to select a pipe is to change its color, and repainting
  // it to show it is selected would hide the very thing being chosen.
  // The halo stays solid while the wire above it marches, which also
  // makes the dashes read as gaps in a wire rather than as a new shape.
  const selected = wireSelection?.isSelected(entry.connection.id);
  if (selected) {
    drawPath(ctx, entry.geometry.points, { color: WIRE_SELECTED_HALO, width: 9, hopOver, hopSkip });
  }
  // Animate takes over the whole wire's dashing while it's running,
  // regardless of the wire's own resting style — the marching dashes
  // are the point of it, not something a dotted wire should opt out of.
  drawPath(ctx, entry.geometry.points, {
    color: wireColorOf(entry.connection),
    width: 3,
    hopOver,
    hopSkip,
    dash: flowOffset === null ? getDashPattern(entry.connection.dashStyle) : FLOW_DASH,
    dashOffset: flowDashOffset(view, entry.connection, flowOffset),
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
  const hoverPin = focused ? focus.hoverPin || null : null;

  // Wires that end on the container's own pins route to the frame
  // whether or not the frame itself is drawn.
  const routingBoundary = container?.boundaryGeometry ? { block: container, geometry: container.boundaryGeometry } : null;
  const routed = routeConnections(view, routingBoundary, wireMoveOverride, hiddenConnectionId);
  if (focused && focus.out) focus.out.routed = routed;
  // A wire being picked up (hiddenConnectionId) is not in `routed`, so its
  // pins show their sockets empty while it is in the air.
  const plugged = view.listConnections().filter((connection) => isPluggedConnection(view, connection));
  const pinWires = pinWiresOf(routed, plugged);
  const wireEntriesFor = (blockId, port) =>
    view.listBoundaryWires(blockId, port.id).map((id, rank) => {
      const connection = view.getConnection(id);
      return { id, rank, label: connection?.label || '', color: connection ? wireColorOf(connection) : null };
    });

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
  // A wire marked invisible is kept out of the picture until one of its
  // own pins is hovered — for the connections that are real but would
  // otherwise bury the diagram (a clock into everything, a common
  // ground). Its pins still show their plugs, so the block says it is
  // connected; hovering one is what asks where to.
  //
  // Filtered here rather than skipped at the draw call, because the
  // hop-over index is built from this list: a wire nobody can see must
  // not make its neighbours bow over it.
  const visibleRouted = routed.filter((entry) => isWireShown(entry.connection, hoverPin, wireSelection));
  // Every wire's vertical runs, indexed once for the whole level — see
  // ConnectionRenderer.buildHopIndex for why this isn't per wire.
  const hopIndex = buildHopIndex(visibleRouted);
  const blockZIndex = new Map(blocks.map((block, i) => [block.id, i]));
  const zIndexOfEndpoint = (blockId) => blockZIndex.get(blockId) ?? -1;
  const drawItems = [
    ...visibleRouted.map((entry, entryIndex) => ({
      kind: 'connection',
      z: Math.max(zIndexOfEndpoint(entry.connection.sourceBlockId), zIndexOfEndpoint(entry.connection.targetBlockId)),
      entry,
      // Position in `routed`, which is what the hop index tags its runs
      // with — the sort below reorders these items, so it can't be the
      // loop's own index.
      entryIndex,
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
    const boundaryWireLabels = new Map(boundaryPorts.map((port) => [port.id, wireEntriesFor(boundary.block.id, port)]));
    drawBoundary(ctx, { ...boundary.block, ports: boundaryPorts }, boundary.geometry, {
      selected: boundary.block.id === selectedBlockId,
      portHighlights,
      palette,
      boundaryWireLabels,
      wireMoveOverride,
      zoom,
      hoverPin,
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
      drawOneConnection(ctx, item.entry, item.entryIndex, visibleRouted, hopIndex, wireSelection, flowOffset, palette, view);
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
      pinWires: pinWires.get(block.id) || null,
      hoverPin,
    });
    if (previewT > 0) {
      drawSubPreview(ctx, block, { zoom, t: previewT, palette, depth: depth + 1, visible, focus, flowOffset, requestRender, onDrawBlock });
      // The block's own heading, over the level that has just covered its
      // face — it fades in by the same number the centred name fades out
      // by, so the two never both show at full strength.
      drawOpenHeader(ctx, block, { alpha: previewT, palette, requestRender });
    } else if (focus?.gridBlockId === block.id) {
      // The block a new block would land in, with its level not drawn on
      // its face — closed at this zoom, or still empty, which is exactly
      // the case where "the next block goes in here" most needs saying.
      drawFaceGrid(ctx, block, { zoom, palette, visible });
    }
    // The host's per-block drawing hook (see SceneRenderer.renderScene).
    // Fires for every level drawn, not only the one being edited: a host
    // that draws a block's own face (noditron's live values) had no way to
    // show it for a container's children while you stood outside it, or
    // for the level above while you stood inside one — so the two could
    // never be read at the same time, which is the whole point of drawing
    // a level inside its block.
    //
    // `ctx` is already under this level's own transform here, so anything
    // drawn straight onto it needs nothing extra. A host placing real DOM
    // instead has to know where that lands on screen, and deriving it from
    // the live canvas matrix is exact at any nesting depth — composing the
    // chain of level transforms by hand would be a second, drift-prone
    // copy of what the canvas already tracks. Absent on a recording
    // context that has no matrix (see render/svgContext.js), where a host
    // should fall back to its own camera math.
    onDrawBlock(ctx, block, {
      contentAlpha: contentAlphaFor(previewT),
      focused,
      transform: typeof ctx.getTransform === 'function' ? ctx.getTransform() : null,
    });
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
    drawBlockPorts(ctx, block, { portHighlights, palette, zoom, labelsOutside: openAlpha, pinWires: pinWires.get(block.id) || null, hoverPin });
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
  // over the first of them again by the level above, name and all — so
  // the names stay off here (portNames), or every wired pin would be
  // labelled twice, once on each side of the same border.
  if (!boundary && routingBoundary) {
    const wiredPins = view.listBoundaryPorts(container).filter((port) => view.listBoundaryWires(container.id, port.id).length > 0);
    if (wiredPins.length) {
      const boundaryWireLabels = new Map(wiredPins.map((port) => [port.id, wireEntriesFor(container.id, port)]));
      drawBoundaryPins(ctx, container, routingBoundary.geometry, wiredPins, { portHighlights, palette, boundaryWireLabels, wireMoveOverride, zoom, hoverPin, portNames: false });
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
