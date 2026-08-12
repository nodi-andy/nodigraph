import { clamp, snap, sideNormal, sideAxis, getPortOffsetBounds, GRID_SIZE } from '../model/grid.js';
import { getStateColor } from '../model/BlockDescription.js';

const CORNER_RADIUS = 6;
export const RESIZE_HANDLE_SIZE = 10;
export const PORT_RADIUS = 5;
export const CONNECTOR_HANDLE_RADIUS = 4;
export const CONNECTOR_NUB_LENGTH = 14;
export const ENTER_ICON_RADIUS = 9;
export const ENTER_ICON_MARGIN = 4;
const INPUT_PORT_COLOR = '#8b93a3';
const DEFAULT_OUTPUT_PORT_COLOR = '#8b93a3';
const CONNECTOR_HANDLE_COLOR = '#e6e9ef';
const PORT_LABEL_COLOR = '#c3c9d4';
const PORT_LABEL_GAP = 6;

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

const BOUNDARY_PADDING = GRID_SIZE * 2;
const BOUNDARY_MIN_WIDTH = GRID_SIZE * 10;
const BOUNDARY_MIN_HEIGHT = GRID_SIZE * 8;

// The frame you're "inside" at any given level: a box that grows to fit
// whatever's currently there, padded so ports and wires have room, with a
// floor so an empty or single-block level still gives you space to work in.
export function computeBoundaryGeometry(blocks) {
  if (!blocks.length) {
    return { x: 0, y: 0, width: BOUNDARY_MIN_WIDTH, height: BOUNDARY_MIN_HEIGHT };
  }

  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const block of blocks) {
    minX = Math.min(minX, block.geometry.x);
    minY = Math.min(minY, block.geometry.y);
    maxX = Math.max(maxX, block.geometry.x + block.geometry.width);
    maxY = Math.max(maxY, block.geometry.y + block.geometry.height);
  }

  const x = snap(minX - BOUNDARY_PADDING);
  const y = snap(minY - BOUNDARY_PADDING);
  const width = Math.max(BOUNDARY_MIN_WIDTH, snap(maxX + BOUNDARY_PADDING - x));
  const height = Math.max(BOUNDARY_MIN_HEIGHT, snap(maxY + BOUNDARY_PADDING - y));
  return { x, y, width, height };
}

function drawPortLabel(ctx, port, pos) {
  if (!port.name) return;
  ctx.fillStyle = PORT_LABEL_COLOR;
  ctx.font = '10px -apple-system, Segoe UI, Roboto, sans-serif';

  switch (port.side) {
    case 'left':
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(port.name, pos.x + PORT_RADIUS + PORT_LABEL_GAP, pos.y);
      break;
    case 'right':
      ctx.textAlign = 'right';
      ctx.textBaseline = 'middle';
      ctx.fillText(port.name, pos.x - PORT_RADIUS - PORT_LABEL_GAP, pos.y);
      break;
    case 'top':
      ctx.textAlign = 'center';
      ctx.textBaseline = 'top';
      ctx.fillText(port.name, pos.x, pos.y + PORT_RADIUS + PORT_LABEL_GAP);
      break;
    case 'bottom':
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(port.name, pos.x, pos.y - PORT_RADIUS - PORT_LABEL_GAP);
      break;
    default:
      break;
  }
}

// `inverted` is set when drawing a container's ports on its boundary frame:
// a port that's an input from outside acts as a source from inside (data
// is available to route to children), and an output acts as a sink (a
// child's result flows into it, then out) — so which color/role a port
// gets flips, on top of the nub direction flipping in getConnectorHandlePosition.
function drawPorts(ctx, block, { inverted = false } = {}) {
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

    ctx.beginPath();
    ctx.arc(handle.x, handle.y, CONNECTOR_HANDLE_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = CONNECTOR_HANDLE_COLOR;
    ctx.fill();

    drawPortLabel(ctx, port, { x: px, y: py });
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
export function drawBlock(ctx, block, { selected = false } = {}) {
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

  drawPorts(ctx, block);
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
// standing in, not an object) sized to fit its children via
// computeBoundaryGeometry. Its ports are the container's own real ports,
// rendered inverted (see drawPorts) so wiring them to a child never has to
// cross back out over this outline. No resize handle, no enter icon, no
// centered name-as-content — just a small label so it reads as a frame.
export function drawBoundary(ctx, block, geometry, { selected = false } = {}) {
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

  drawPorts(ctx, { ...block, geometry }, { inverted: true });
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
