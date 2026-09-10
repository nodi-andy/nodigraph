import {
  drawBlock,
  drawBoundary,
  drawPortGhost,
  PORT_SELECTED_RING_COLOR,
  PORT_SOURCE_RING_COLOR,
  PORT_TARGET_VALID_RING_COLOR,
  PORT_TARGET_INVALID_RING_COLOR,
} from './BlockRenderer.js';
import {
  drawPath,
  drawConnectionLabel,
  getConnectionGeometry,
  getDashPattern,
  verticalSegmentsOf,
  FLOW_DASH,
  PREVIEW_DASH,
} from './ConnectionRenderer.js';
import { GRID_SIZE } from '../model/grid.js';
import { getCanvasPalette } from './canvasPalette.js';
import { getTheme } from '../theme.js';

const WIRE_COLOR = '#4f8cff';
const WIRE_SELECTED_HALO = 'rgba(255, 180, 84, 0.55)';

// A handful of visually-distinct colors, deterministically picked per
// remote client id — enough to tell separate cursors apart without any
// identity/accounts system to draw real names from.
const CURSOR_COLORS = ['#ff6b6b', '#4f8cff', '#3ecf5d', '#ffb454', '#c77dff', '#5eead4', '#f472b6'];

// Exported so the header's own "who's online" list (see ui/OnlineUsers.js)
// colors each person's avatar to match the cursor they'd see moving on
// the canvas — the only "identity" either place has to go on, absent any
// accounts system.
export function colorForClientId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return CURSOR_COLORS[hash % CURSOR_COLORS.length];
}

// Drawn in world space like everything else, but scaled by 1/zoom so the
// cursor glyph stays a constant on-screen size regardless of zoom level —
// the same trick drawGrid uses for its line width.
function drawRemoteCursors(ctx, cursors, zoom) {
  const scale = 1 / zoom;
  for (const [clientId, cursor] of cursors) {
    const color = colorForClientId(clientId);
    ctx.save();
    ctx.translate(cursor.x, cursor.y);
    ctx.scale(scale, scale);

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 15);
    ctx.lineTo(4, 11.5);
    ctx.lineTo(7, 17.5);
    ctx.lineTo(9.5, 16.3);
    ctx.lineTo(6.5, 10.3);
    ctx.lineTo(11.5, 10.3);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const label = clientId.slice(0, 4);
    ctx.font = '11px -apple-system, Segoe UI, Roboto, sans-serif';
    const textWidth = ctx.measureText(label).width;
    ctx.fillStyle = color;
    ctx.fillRect(15, 9, textWidth + 8, 16);
    ctx.fillStyle = '#0b0e13';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 19, 17);

    ctx.restore();
  }
}

// The shift-drag selection rectangle. Line width is divided by zoom so it
// stays a constant on-screen thickness, the same trick drawGrid uses.
function drawMarquee(ctx, rect, zoom) {
  ctx.save();
  ctx.fillStyle = 'rgba(79, 140, 255, 0.12)';
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.setLineDash([6 / zoom, 4 / zoom]);
  ctx.strokeStyle = '#4f8cff';
  ctx.lineWidth = 1 / zoom;
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

// A dot at every intersection rather than a lattice of lines — the Figma/
// design-tool convention, and a lot less visually busy across a large
// diagram than full-length lines crossing behind every block. Radius is a
// fixed *screen* size (divided by zoom, the same trick the old line width
// used) so dots stay a legible, constant pixel size whether zoomed in or
// panned far out, instead of shrinking to nothing or ballooning with the
// world-space geometry around them.
const GRID_DOT_RADIUS = 1.4;

function drawGrid(ctx, camera, canvasWidth, canvasHeight, palette) {
  const topLeft = camera.screenToWorld(0, 0);
  const bottomRight = camera.screenToWorld(canvasWidth, canvasHeight);
  const startX = Math.floor(topLeft.x / GRID_SIZE) * GRID_SIZE;
  const startY = Math.floor(topLeft.y / GRID_SIZE) * GRID_SIZE;
  const radius = GRID_DOT_RADIUS / camera.zoom;

  ctx.fillStyle = palette.grid;
  ctx.beginPath();
  for (let gy = startY; gy <= bottomRight.y; gy += GRID_SIZE) {
    for (let gx = startX; gx <= bottomRight.x; gx += GRID_SIZE) {
      ctx.moveTo(gx + radius, gy);
      ctx.arc(gx, gy, radius, 0, Math.PI * 2);
    }
  }
  ctx.fill();
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

// Computed once per frame, independent of draw order — routing (and the
// hopOver bow every wire needs against every other) is a purely geometric
// question, unrelated to which of them ends up painted over which block
// (see renderScene's own z-ordering of this same list against `blocks`).
function routeConnections(project, boundary, wireMoveOverride, hiddenConnectionId) {
  const routed = [];
  for (const connection of project.listConnections()) {
    // The one connection currently being picked up to redirect (see
    // DragStateMachine.getRedirectingConnectionId) is left out of its own
    // ordinary, static rendering entirely — the whole point being that it
    // visibly comes off its old port the instant it's grabbed, rather than
    // sitting there unchanged alongside the live dashed preview (drawn
    // separately, after every block — see renderScene) that's standing in
    // for it. Left out of hopOver bowing too: nothing else should still
    // treat it as an obstacle once it's already "in the air."
    if (connection.id === hiddenConnectionId) continue;
    const geometry = getConnectionGeometry(project, connection, boundary, wireMoveOverride);
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
  drawPath(ctx, entry.geometry.points, {
    color: window.nodigraphConnectionColor?.(entry.connection) || entry.connection.color || WIRE_COLOR,
    width: 3,
    hopOver,
    dash: flowOffset === null ? getDashPattern(entry.connection.dashStyle) : FLOW_DASH,
    dashOffset: flowOffset ?? 0,
  });
  drawConnectionLabel(ctx, entry.geometry, entry.connection.label, palette);
}

// One combined lookup so drawBlock/drawBoundary don't each need to know
// about selection vs. in-progress-wire state separately — every port ring
// this frame, keyed by "blockId:portId".
function buildPortHighlights(selectedBlockId, selectedPortId, connectionSource, connectionTarget) {
  const highlights = new Map();
  if (selectedBlockId && selectedPortId) {
    highlights.set(`${selectedBlockId}:${selectedPortId}`, PORT_SELECTED_RING_COLOR);
  }
  if (connectionSource) {
    highlights.set(`${connectionSource.blockId}:${connectionSource.portId}`, PORT_SOURCE_RING_COLOR);
  }
  if (connectionTarget) {
    const color = connectionTarget.valid ? PORT_TARGET_VALID_RING_COLOR : PORT_TARGET_INVALID_RING_COLOR;
    highlights.set(`${connectionTarget.blockId}:${connectionTarget.portId}`, color);
  }
  return highlights;
}

export function renderScene(
  ctx,
  camera,
  project,
  {
    selectedBlockId,
    // Every highlighted block; selectedBlockId stays the Inspector's single
    // "primary" one. Defaulted so callers that only care about one block
    // (the diagram-image renderer) don't have to build a Set.
    selectedBlockIds = new Set(selectedBlockId ? [selectedBlockId] : []),
    selectedPortId,
    dpr,
    canvasWidth,
    canvasHeight,
    pendingConnectionPath,
    connectionSource,
    connectionTarget,
    wireSelection,
    remoteCursors,
    hoverGhost,
    marqueeRect,
    // The one connection (if any) currently being picked up to redirect —
    // see DragStateMachine.getRedirectingConnectionId's own doc, and
    // drawConnections' use of this below.
    hiddenConnectionId = null,
    // { portId, connectionId, previewIndex } while a wire is being dragged
    // to a different slot within its own port (see
    // DragStateMachine.getWireMoveOverride) — lets it visibly follow the
    // cursor for this frame instead of only snapping into place on drop.
    wireMoveOverride = null,
    // Where the marching-dash pattern currently starts, or null for solid
    // wires. Null by default so an exported diagram image (see
    // model/diagramImage.js) is never caught mid-animation.
    flowOffset = null,
    // Off for exported diagram images (see docSync.js) — the grid is an
    // editing aid, not part of the diagram, and leaving it out keeps the
    // exported PNG's background genuinely transparent instead of a faint
    // lattice of grid lines on a light Doc page.
    showGrid = true,
    // Lets a block whose name is an image URL (see render/imageCache.js)
    // ask for a redraw once that image finishes loading — a no-op by
    // default so one-shot renders (the diagram-image exporter) don't need
    // to supply one; they just draw with whatever's already cached.
    requestRender = () => {},
    // Defaults to whatever the live app's theme currently is; the diagram-
    // image exporter (model/diagramImage.js) always passes the light
    // palette explicitly instead, since an exported figure lands on a
    // white Doc page regardless of which theme its editor prefers.
    palette = getCanvasPalette(getTheme()),
    // A generic embedding point for a host page (see main.js's own
    // window.nodigraph doc) that wants to draw its own thing onto a
    // specific block, in lockstep with this exact paint rather than a
    // separately-timed DOM overlay drifting out of sync on every pan/zoom
    // frame this canvas redraws but a slower host loop hasn't caught up
    // to yet. Called once per block, right after this module draws it —
    // `ctx` is already under this frame's camera transform at that point,
    // so the callback can draw straight in world coordinates (block.geometry)
    // with no transform math of its own to get right. A no-op by default,
    // which is every caller today except a host that's set one up.
    onDrawBlock = () => {},
  },
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  camera.applyTransform(ctx, dpr);
  if (showGrid) drawGrid(ctx, camera, canvasWidth, canvasHeight, palette);

  const blocks = project.listBlocks();
  const containerBlock = project.getContainerBlock();
  const boundary = containerBlock?.boundaryGeometry
    ? { block: containerBlock, geometry: containerBlock.boundaryGeometry }
    : null;
  const portHighlights = buildPortHighlights(selectedBlockId, selectedPortId, connectionSource, connectionTarget);

  const routed = routeConnections(project, boundary, wireMoveOverride, hiddenConnectionId);

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
  // endpoint's z-index outright, and the boundary frame itself keeps
  // drawing before every wire regardless (see below), same as always.
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
  // still paint over the wire's endpoint, not the other way around, the
  // same relationship every wire already had with every block before this
  // ordering existed at all.
  drawItems.sort((a, b) => a.z - b.z);

  // The boundary frame (and its own ports) still always draws before every
  // wire, exactly as it always has — it isn't part of the z-ordered block
  // list above, and a wire attached to it inherits its *other* endpoint's
  // z-index (see zIndexOfEndpoint's fallback), never the boundary's own, so
  // there's no z-indexed slot for the boundary's drawing to occupy here.
  // Drawn before the real blocks too, so they visually sit "inside" the
  // frame rather than the dashed outline cutting across them.
  if (boundary) {
    // The container's own ports as seen from inside — cloned exterior
    // siblings (see BlockDescription.clonePort) collapse onto one entry
    // here, so a name+direction pair reads as the single logical pin it
    // actually is rather than one row per wire it happens to have outside.
    const boundaryPorts = project.listBoundaryPorts(boundary.block);
    // Which wires (if any beyond the ordinary single one) attach to each
    // of those pins from inside — see Project.listBoundaryWires (already
    // resolved against the same collapsed group) and BlockRenderer.drawPorts.
    const boundaryWireLabels = new Map(
      boundaryPorts.map((port) => {
        const ids = project.listBoundaryWires(boundary.block.id, port.id);
        return [port.id, ids.map((id, rank) => ({ id, rank, label: project.getConnection(id)?.label || '' }))];
      }),
    );
    drawBoundary(ctx, { ...boundary.block, ports: boundaryPorts }, boundary.geometry, {
      selected: boundary.block.id === selectedBlockId,
      portHighlights,
      palette,
      boundaryWireLabels,
      wireMoveOverride,
      zoom: camera.zoom,
    });
  }

  for (const item of drawItems) {
    if (item.kind === 'connection') {
      drawOneConnection(ctx, item.entry, routed, wireSelection, flowOffset, palette);
      continue;
    }
    const block = item.block;
    drawBlock(ctx, block, {
      selected: selectedBlockIds.has(block.id),
      portHighlights,
      requestRender,
      palette,
      zoom: camera.zoom,
    });
    onDrawBlock(ctx, block);
  }

  if (marqueeRect) drawMarquee(ctx, marqueeRect, camera.zoom);

  if (pendingConnectionPath) {
    drawPath(ctx, pendingConnectionPath, { color: WIRE_COLOR, dash: PREVIEW_DASH });
  }

  // The "click here to add a port" preview — drawn on top of the block it
  // belongs to, once the hover dwell has actually elapsed (see
  // DragStateMachine.getHoverGhost).
  if (hoverGhost) {
    drawPortGhost(ctx, hoverGhost.geometry, hoverGhost.side, hoverGhost.offset, palette);
  }

  // Drawn last so a remote cursor always reads on top of everything else.
  if (remoteCursors?.size) {
    drawRemoteCursors(ctx, remoteCursors, camera.zoom);
  }
}
