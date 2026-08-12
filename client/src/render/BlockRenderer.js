import { HEADER_HEIGHT, clamp, getPortOffsetBounds } from '../model/grid.js';
import { getStateColor } from '../model/BlockDescription.js';

const CORNER_RADIUS = 6;
export const RESIZE_HANDLE_SIZE = 10;
export const PORT_RADIUS = 5;
export const CONNECTOR_HANDLE_RADIUS = 4;
export const CONNECTOR_NUB_LENGTH = 14;
const INPUT_PORT_COLOR = '#8b93a3';
const DEFAULT_OUTPUT_PORT_COLOR = '#8b93a3';
const CONNECTOR_HANDLE_COLOR = '#e6e9ef';

// A port's world position is its own stored offset from the block's top,
// clamped to the current body height — dragging the move handle (Milestone 2)
// sets that offset directly, so this stays the single place move/hit-test/
// render all agree on where a port actually is.
export function getPortPositions(block, direction) {
  const { x, y, width, height } = block.geometry;
  const ports = (block.ports || []).filter((p) => p.direction === direction);
  if (!ports.length) return [];

  const edgeX = direction === 'in' ? x : x + width;
  const bounds = getPortOffsetBounds(height);

  return ports.map((port) => ({
    port,
    x: edgeX,
    y: y + clamp(port.offset ?? HEADER_HEIGHT, bounds.min, bounds.max),
  }));
}

export function findPortPosition(block, portId) {
  const port = (block.ports || []).find((p) => p.id === portId);
  if (!port) return null;
  const match = getPortPositions(block, port.direction).find((p) => p.port.id === portId);
  return match ? { x: match.x, y: match.y } : null;
}

// The connector handle sits just outside the block, past the port dot on
// the border — a distinct, slightly harder-to-hit target so a drag can
// reliably tell "reposition this port" from "start a wire" apart.
export function getConnectorHandlePosition(portPos, direction) {
  const dx = direction === 'in' ? -CONNECTOR_NUB_LENGTH : CONNECTOR_NUB_LENGTH;
  return { x: portPos.x + dx, y: portPos.y };
}

function drawPortGroup(ctx, block, direction, color) {
  for (const { x: px, y: py } of getPortPositions(block, direction)) {
    const handle = getConnectorHandlePosition({ x: px, y: py }, direction);

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
  }
}

function drawPorts(ctx, block) {
  const outputColor = getStateColor(block) || DEFAULT_OUTPUT_PORT_COLOR;
  drawPortGroup(ctx, block, 'in', INPUT_PORT_COLOR);
  drawPortGroup(ctx, block, 'out', outputColor);
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

// A block is just a titled box; its Input/Output ports are handles on this
// border. When you drill into a block, its own border becomes the frame
// that shows those same ports (Milestone 3).
export function drawBlock(ctx, block, { selected = false } = {}) {
  const { x, y, width, height } = block.geometry;

  roundRectPath(ctx, x, y, width, height, CORNER_RADIUS);
  ctx.fillStyle = '#1c2431';
  ctx.fill();
  ctx.lineWidth = selected ? 2 : 1;
  ctx.strokeStyle = selected ? '#4f8cff' : '#3a4556';
  ctx.stroke();

  ctx.save();
  roundRectPath(ctx, x, y, width, height, CORNER_RADIUS);
  ctx.clip();

  ctx.fillStyle = block.style?.color || '#3b6fa0';
  ctx.fillRect(x, y, width, HEADER_HEIGHT);
  ctx.fillStyle = '#ffffff';
  ctx.font = '13px -apple-system, Segoe UI, Roboto, sans-serif';
  ctx.textBaseline = 'middle';
  ctx.fillText(block.name, x + 8, y + HEADER_HEIGHT / 2, width - 16);

  ctx.restore();

  drawPorts(ctx, block);

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

export function getResizeHandleWorldRect(block) {
  const { x, y, width, height } = block.geometry;
  return {
    x: x + width - RESIZE_HANDLE_SIZE / 2,
    y: y + height - RESIZE_HANDLE_SIZE / 2,
    width: RESIZE_HANDLE_SIZE,
    height: RESIZE_HANDLE_SIZE,
  };
}
