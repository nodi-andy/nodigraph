import { clamp, snap, sideNormal, sideAxis, getPortOffsetBounds } from '../model/grid.js';
import { getStateColor } from '../model/BlockDescription.js';

const CORNER_RADIUS = 6;
export const RESIZE_HANDLE_SIZE = 10;
export const PORT_RADIUS = 5;
// The drawn arrowhead is smaller than this — it's the hit-test radius
// around the handle's tip, padded like every other small handle.
export const CONNECTOR_HANDLE_RADIUS = 4;
export const CONNECTOR_NUB_LENGTH = 14;
const CONNECTOR_ARROW_SIZE = 8;
export const ENTER_ICON_RADIUS = 9;
export const ENTER_ICON_MARGIN = 4;
const INPUT_PORT_COLOR = '#8b93a3';
const DEFAULT_OUTPUT_PORT_COLOR = '#8b93a3';
const CONNECTOR_HANDLE_COLOR = '#e6e9ef';
const PORT_LABEL_COLOR = '#c3c9d4';
const PORT_LABEL_GAP = 6;
const PORT_RING_RADIUS = PORT_RADIUS + 4;
// Selected (clicked, ready to delete) uses the same blue as a selected
// block; an in-progress wire's own source stays that same "active" blue;
// a hovered drop target turns green once it's actually compatible, or red
// when it's a real port but the wrong effective direction to pair with.
export const PORT_SELECTED_RING_COLOR = '#4f8cff';
export const PORT_SOURCE_RING_COLOR = '#4f8cff';
export const PORT_TARGET_VALID_RING_COLOR = '#3ecf5d';
export const PORT_TARGET_INVALID_RING_COLOR = '#e5484d';

function sideLength(block, side) {
  return sideAxis(side) === 'x' ? block.geometry.height : block.geometry.width;
}

// A port's world position is its own stored side + offset from that side's
// start corner, clamped to the current side length — dragging the move
// handle sets these directly, so this stays the single place move/hit-test/
// render all agree on where a port actually is.
export function getPortPosition(block, port) {
  const { x, y, width, height } = block.geometry;
  const bounds = getPortOffsetBounds(sideLength(block, port.side));
  const offset = clamp(port.offset ?? bounds.min, bounds.min, bounds.max);

  switch (port.side) {
    case 'left':
      return { x, y: y + offset };
    case 'right':
      return { x: x + width, y: y + offset };
    case 'top':
      return { x: x + offset, y };
    case 'bottom':
    default:
      return { x: x + offset, y: y + height };
  }
}

export function getAllPortPositions(block) {
  return (block.ports || []).map((port) => ({ port, ...getPortPosition(block, port) }));
}

export function findPortPosition(block, portId) {
  const port = (block.ports || []).find((p) => p.id === portId);
  return port ? getPortPosition(block, port) : null;
}

// The connector handle sits just outside the block, past the port dot on
// the border — a distinct, slightly harder-to-hit target so a drag can
// reliably tell "reposition this port" from "start a wire" apart.
// `inverted` flips it to point inward instead — used when this port is
// being drawn on the surrounding boundary frame (see drawBoundary) rather
// than on an ordinary block, since "outward" there would point off into
// space outside the diagram instead of toward anything wireable.
export function getConnectorHandlePosition(portPos, side, inverted = false) {
  const n = sideNormal(side);
  const sign = inverted ? -1 : 1;
  return { x: portPos.x + n.x * sign * CONNECTOR_NUB_LENGTH, y: portPos.y + n.y * sign * CONNECTOR_NUB_LENGTH };
}

// Projects an arbitrary world point onto the nearest point on the block's
// own border, across all four sides — this is what lets a dragged port
// slide around every side of the block, switching sides at the corners.
export function projectPointToPerimeter(block, worldX, worldY) {
  const { x, y, width, height } = block.geometry;
  const candidates = [
    { side: 'left', offset: worldY - y, dist: Math.abs(worldX - x) },
    { side: 'right', offset: worldY - y, dist: Math.abs(worldX - (x + width)) },
    { side: 'top', offset: worldX - x, dist: Math.abs(worldY - y) },
    { side: 'bottom', offset: worldX - x, dist: Math.abs(worldY - (y + height)) },
  ];
  candidates.sort((a, b) => a.dist - b.dist);
  const best = candidates[0];
  const bounds = getPortOffsetBounds(sideLength(block, best.side));
  return { side: best.side, offset: snap(clamp(best.offset, bounds.min, bounds.max)) };
}

const BORDER_HIT_THRESHOLD = 8;

// Detects a click near a rectangle's edge (any of the four sides, within
// its actual span, not the infinite line) — used both to add a port right
// where you click a block's border, and to find which edge of the boundary
// frame a splitter-style drag should resize. Returns the same {side,
// offset} shape a port itself uses, so a border click can become a port at
// exactly that spot with no extra conversion.
export function getBorderHit(geometry, worldX, worldY, threshold = BORDER_HIT_THRESHOLD) {
  const { x, y, width, height } = geometry;
  const withinX = worldX >= x - threshold && worldX <= x + width + threshold;
  const withinY = worldY >= y - threshold && worldY <= y + height + threshold;
  if (!withinX && !withinY) return null;

  const candidates = [];
  if (withinY) {
    const distLeft = Math.abs(worldX - x);
    const distRight = Math.abs(worldX - (x + width));
    if (distLeft <= threshold) candidates.push({ side: 'left', dist: distLeft, offset: worldY - y });
    if (distRight <= threshold) candidates.push({ side: 'right', dist: distRight, offset: worldY - y });
  }
  if (withinX) {
    const distTop = Math.abs(worldY - y);
    const distBottom = Math.abs(worldY - (y + height));
    if (distTop <= threshold) candidates.push({ side: 'top', dist: distTop, offset: worldX - x });
    if (distBottom <= threshold) candidates.push({ side: 'bottom', dist: distBottom, offset: worldX - x });
  }
  if (!candidates.length) return null;

  candidates.sort((a, b) => a.dist - b.dist);
  const best = candidates[0];
  const bounds = getPortOffsetBounds(sideAxis(best.side) === 'x' ? height : width);
  return { side: best.side, offset: snap(clamp(best.offset, bounds.min, bounds.max)) };
}

// Grows away from wherever the connector handle points, so the two never
// overlap: normally that's inward (the handle points outward), but on an
// inverted (boundary) port the handle points inward instead, so the label
// has to swap to the outward side to stay clear of it.
function drawPortLabel(ctx, port, pos, inverted = false) {
  if (!port.name) return;
  ctx.fillStyle = PORT_LABEL_COLOR;
  ctx.font = '10px -apple-system, Segoe UI, Roboto, sans-serif';

  const n = sideNormal(port.side);
  const sign = inverted ? 1 : -1;
  const dirX = n.x * sign;
  const dirY = n.y * sign;
  const gap = PORT_RADIUS + PORT_LABEL_GAP;

  if (Math.abs(dirX) > Math.abs(dirY)) {
    ctx.textAlign = dirX > 0 ? 'left' : 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(port.name, pos.x + dirX * gap, pos.y);
  } else {
    ctx.textAlign = 'center';
    ctx.textBaseline = dirY > 0 ? 'top' : 'bottom';
    ctx.fillText(port.name, pos.x, pos.y + dirY * gap);
  }
}

// An arrowhead pointing the same way the connector line already travels
// (outward for a normal block, inward for the boundary — see
// getConnectorHandlePosition) reads as "drag from here to wire it up" more
// clearly than a plain dot did.
function drawConnectorArrow(ctx, handlePos, side, inverted) {
  const n = sideNormal(side);
  const sign = inverted ? -1 : 1;
  const dirX = n.x * sign;
  const dirY = n.y * sign;
  const perpX = -dirY;
  const perpY = dirX;
  const half = CONNECTOR_ARROW_SIZE / 2;

  const tipX = handlePos.x + dirX * half;
  const tipY = handlePos.y + dirY * half;
  const backX = handlePos.x - dirX * half;
  const backY = handlePos.y - dirY * half;

  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(backX + perpX * half, backY + perpY * half);
  ctx.lineTo(backX - perpX * half, backY - perpY * half);
  ctx.closePath();
  ctx.fillStyle = CONNECTOR_HANDLE_COLOR;
  ctx.fill();
}

function drawPortRing(ctx, x, y, color) {
  ctx.beginPath();
  ctx.arc(x, y, PORT_RING_RADIUS, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
}

// `inverted` is set when drawing a container's ports on its boundary frame:
// a port that's an input from outside acts as a source from inside (data
// is available to route to children), and an output acts as a sink (a
// child's result flows into it, then out) — so which color/role a port
// gets flips, on top of the nub/arrow direction flipping. `portHighlights`
// (optional) is a `Map` of `"blockId:portId" -> ringColor` covering
// selection and in-progress-wire feedback, shared across every block/
// boundary drawn this frame.
function drawPorts(ctx, block, { inverted = false, portHighlights = null } = {}) {
  const outputColor = getStateColor(block) || DEFAULT_OUTPUT_PORT_COLOR;

  for (const { port, x: px, y: py } of getAllPortPositions(block)) {
    const isEffectivelyOutput = inverted ? port.direction === 'in' : port.direction === 'out';
    const color = isEffectivelyOutput ? outputColor : INPUT_PORT_COLOR;
    const handle = getConnectorHandlePosition({ x: px, y: py }, port.side, inverted);

    ctx.strokeStyle = '#4a5568';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(handle.x, handle.y);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(px, py, PORT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = '#12161d';
    ctx.lineWidth = 2;
    ctx.stroke();

    drawConnectorArrow(ctx, handle, port.side, inverted);
    drawPortLabel(ctx, port, { x: px, y: py }, inverted);

    const ringColor = portHighlights?.get(`${block.id}:${port.id}`);
    if (ringColor) drawPortRing(ctx, px, py, ringColor);
  }
}

// Always visible (not just when selected) so drilling into a block is
// discoverable without already knowing the double-click shortcut exists.
export function getEnterIconCenter(block) {
  const { x, y, height } = block.geometry;
  return {
    x: x + ENTER_ICON_MARGIN + ENTER_ICON_RADIUS,
    y: y + height - ENTER_ICON_MARGIN - ENTER_ICON_RADIUS,
  };
}

function drawEnterIcon(ctx, block) {
  const { x: cx, y: cy } = getEnterIconCenter(block);

  ctx.beginPath();
  ctx.arc(cx, cy, ENTER_ICON_RADIUS, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255, 255, 255, 0.1)';
  ctx.fill();
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.35)';
  ctx.lineWidth = 1;
  ctx.stroke();

  // A small square-within-a-circle reads as "this contains its own
  // architecture" without needing a text label at this size.
  const s = 6;
  ctx.strokeStyle = '#e6e9ef';
  ctx.lineWidth = 1.3;
  ctx.strokeRect(cx - s / 2, cy - s / 2, s, s);
}

function roundRectPath(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

// A block is a plain titled box with its name centered — no header band.
// Its Input/Output ports are handles on the border, on any of the four
// sides. When you drill into a block, its own border becomes the frame
// that shows those same ports (Milestone 3).
export function drawBlock(ctx, block, { selected = false, portHighlights = null } = {}) {
  const { x, y, width, height } = block.geometry;
  const accentColor = block.style?.color || '#3b6fa0';

  roundRectPath(ctx, x, y, width, height, CORNER_RADIUS);
  ctx.fillStyle = '#1c2431';
  ctx.fill();
  ctx.lineWidth = selected ? 2 : 1.5;
  ctx.strokeStyle = selected ? '#4f8cff' : accentColor;
  ctx.stroke();

  ctx.save();
  roundRectPath(ctx, x, y, width, height, CORNER_RADIUS);
  ctx.clip();

  ctx.fillStyle = '#ffffff';
  ctx.font = '13px -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(block.name, x + width / 2, y + height / 2, width - 16);

  ctx.restore();

  drawPorts(ctx, block, { portHighlights });
  drawEnterIcon(ctx, block);

  if (selected) {
    ctx.fillStyle = '#4f8cff';
    ctx.fillRect(
      x + width - RESIZE_HANDLE_SIZE / 2,
      y + height - RESIZE_HANDLE_SIZE / 2,
      RESIZE_HANDLE_SIZE,
      RESIZE_HANDLE_SIZE,
    );
  }
}

// The frame representing "the current system" — the block you're inside,
// drawn as a dashed outline (not a solid box: it's empty space you're
// standing in, not an object). It's purely a container for the block's own
// IOs — its geometry is whatever the user has dragged it to (see
// DragStateMachine's boundary-edge splitter drag) and has no relationship
// to where children happen to sit. Its ports are the container's own real
// ports, rendered inverted (see drawPorts) so wiring them to a child never
// has to cross back out over this outline. No resize handle, no enter
// icon, no centered name-as-content — just a small label so it reads as a
// frame.
export function drawBoundary(ctx, block, geometry, { selected = false, portHighlights = null } = {}) {
  const { x, y, width, height } = geometry;

  ctx.save();
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = selected ? '#4f8cff' : 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = selected ? 2 : 1.5;
  ctx.strokeRect(x, y, width, height);
  ctx.restore();

  ctx.fillStyle = selected ? '#4f8cff' : '#8b93a3';
  ctx.font = '11px -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(block.name, x + 4, y - 6);

  drawPorts(ctx, { ...block, geometry }, { inverted: true, portHighlights });
}

export function getResizeHandleWorldRect(block) {
  const { x, y, width, height } = block.geometry;
  return {
    x: x + width - RESIZE_HANDLE_SIZE / 2,
    y: y + height - RESIZE_HANDLE_SIZE / 2,
    width: RESIZE_HANDLE_SIZE,
    height: RESIZE_HANDLE_SIZE,
  };
}
