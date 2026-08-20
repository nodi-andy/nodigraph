import {
  drawBlock,
  drawBoundary,
  drawPortGhost,
  PORT_SELECTED_RING_COLOR,
  PORT_SOURCE_RING_COLOR,
  PORT_TARGET_VALID_RING_COLOR,
  PORT_TARGET_INVALID_RING_COLOR,
} from './BlockRenderer.js';
import { drawPath, getConnectionGeometry, verticalSegmentsOf } from './ConnectionRenderer.js';
import { GRID_SIZE } from '../model/grid.js';

const GRID_COLOR = '#1a212b';
const WIRE_COLOR = '#4f8cff';
const WIRE_SELECTED_HALO = 'rgba(255, 180, 84, 0.55)';

// A handful of visually-distinct colors, deterministically picked per
// remote client id — enough to tell separate cursors apart without any
// identity/accounts system to draw real names from.
const CURSOR_COLORS = ['#ff6b6b', '#4f8cff', '#3ecf5d', '#ffb454', '#c77dff', '#5eead4', '#f472b6'];

function colorForClientId(id) {
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

function drawGrid(ctx, camera, canvasWidth, canvasHeight) {
  const topLeft = camera.screenToWorld(0, 0);
  const bottomRight = camera.screenToWorld(canvasWidth, canvasHeight);
  const startX = Math.floor(topLeft.x / GRID_SIZE) * GRID_SIZE;
  const startY = Math.floor(topLeft.y / GRID_SIZE) * GRID_SIZE;

  ctx.strokeStyle = GRID_COLOR;
  ctx.lineWidth = 1 / camera.zoom;
  ctx.beginPath();
  for (let gx = startX; gx <= bottomRight.x; gx += GRID_SIZE) {
    ctx.moveTo(gx, topLeft.y);
    ctx.lineTo(gx, bottomRight.y);
  }
  for (let gy = startY; gy <= bottomRight.y; gy += GRID_SIZE) {
    ctx.moveTo(topLeft.x, gy);
    ctx.lineTo(bottomRight.x, gy);
  }
  ctx.stroke();
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

function drawConnections(ctx, project, wireSelection, boundary) {
  // Routed up front, because drawing any one wire needs to know where all
  // the others run in order to bow over the ones it merely crosses.
  const routed = [];
  for (const connection of project.listConnections()) {
    const geometry = getConnectionGeometry(project, connection, boundary);
    if (geometry) routed.push({ connection, geometry, verticals: verticalSegmentsOf(geometry.points) });
  }

  for (const entry of routed) {
    const hopOver = routed
      .filter((other) => other !== entry && !sharesEndpoint(other.connection, entry.connection))
      .flatMap((other) => other.verticals);

    // Selection is a halo behind the wire rather than a recolor of it: the
    // main reason to select a pipe is to change its color, and repainting
    // it to show it is selected would hide the very thing being chosen.
    const selected = wireSelection?.isSelected(entry.connection.id);
    if (selected) {
      drawPath(ctx, entry.geometry.points, { color: WIRE_SELECTED_HALO, width: 9, hopOver });
    }
    drawPath(ctx, entry.geometry.points, {
      color: entry.connection.color || WIRE_COLOR,
      width: 3,
      hopOver,
    });
  }
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
    // Off for exported diagram images (see docSync.js) — the grid is an
    // editing aid, not part of the diagram, and leaving it out keeps the
    // exported PNG's background genuinely transparent instead of a faint
    // lattice of grid lines on a light Doc page.
    showGrid = true,
  },
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  camera.applyTransform(ctx, dpr);
  if (showGrid) drawGrid(ctx, camera, canvasWidth, canvasHeight);

  const blocks = project.listBlocks();
  const containerBlock = project.getContainerBlock();
  const boundary = containerBlock?.boundaryGeometry
    ? { block: containerBlock, geometry: containerBlock.boundaryGeometry }
    : null;
  const portHighlights = buildPortHighlights(selectedBlockId, selectedPortId, connectionSource, connectionTarget);

  // Drawn before every block/boundary so a wire's own connector-handle
  // triangle (drawn as part of the block/boundary pass) always paints over
  // the wire's endpoint, not the other way around — a wire sits under the
  // handles it connects to, not through them.
  drawConnections(ctx, project, wireSelection, boundary);

  // Drawn before the real blocks so they visually sit "inside" the frame
  // rather than the dashed outline cutting across them.
  if (boundary) {
    drawBoundary(ctx, boundary.block, boundary.geometry, {
      selected: boundary.block.id === selectedBlockId,
      portHighlights,
    });
  }

  for (const block of blocks) {
    drawBlock(ctx, block, { selected: selectedBlockIds.has(block.id), portHighlights });
  }

  if (marqueeRect) drawMarquee(ctx, marqueeRect, camera.zoom);

  if (pendingConnectionPath) {
    drawPath(ctx, pendingConnectionPath, { color: WIRE_COLOR, dashed: true });
  }

  // The "click here to add a port" preview — drawn on top of the block it
  // belongs to, once the hover dwell has actually elapsed (see
  // DragStateMachine.getHoverGhost).
  if (hoverGhost) {
    drawPortGhost(ctx, hoverGhost.geometry, hoverGhost.side, hoverGhost.offset);
  }

  // Drawn last so a remote cursor always reads on top of everything else.
  if (remoteCursors?.size) {
    drawRemoteCursors(ctx, remoteCursors, camera.zoom);
  }
}
