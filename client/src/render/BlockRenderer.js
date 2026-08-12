import { snap } from '../model/grid.js';
import { getStateColor } from '../model/BlockDescription.js';

const HEADER_HEIGHT = 26;
const CORNER_RADIUS = 6;
export const RESIZE_HANDLE_SIZE = 10;
export const PORT_RADIUS = 5;
const INPUT_PORT_COLOR = '#8b93a3';
const DEFAULT_OUTPUT_PORT_COLOR = '#8b93a3';

// Evenly distributes a side's ports along the block body, then snaps each to
// the nearest grid line — real drag-to-reposition (Milestone 2) will move a
// port between grid lines the same way blocks move between grid cells.
export function getPortPositions(block, direction) {
  const { x, y, width, height } = block.geometry;
  const ports = (block.ports || []).filter((p) => p.direction === direction);
  if (!ports.length) return [];

  const edgeX = direction === 'in' ? x : x + width;
  const top = y + HEADER_HEIGHT;
  const usableHeight = height - HEADER_HEIGHT;
  const step = usableHeight / (ports.length + 1);

  return ports.map((port, i) => ({
    port,
    x: edgeX,
    y: snap(top + step * (i + 1)),
  }));
}

function drawPorts(ctx, block) {
  const outputColor = getStateColor(block) || DEFAULT_OUTPUT_PORT_COLOR;

  for (const { x: px, y: py } of getPortPositions(block, 'in')) {
    ctx.beginPath();
    ctx.arc(px, py, PORT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = INPUT_PORT_COLOR;
    ctx.fill();
    ctx.strokeStyle = '#12161d';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  for (const { x: px, y: py } of getPortPositions(block, 'out')) {
    ctx.beginPath();
    ctx.arc(px, py, PORT_RADIUS, 0, Math.PI * 2);
    ctx.fillStyle = outputColor;
    ctx.fill();
    ctx.strokeStyle = '#12161d';
    ctx.lineWidth = 2;
    ctx.stroke();
  }
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
// border (Milestone 2), not internal sub-regions. When you drill into a
// block, its own border becomes the frame that shows those same ports.
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
