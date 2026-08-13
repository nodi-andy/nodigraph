import { drawBlock, drawBoundary } from './BlockRenderer.js';
import { drawPath, getConnectionGeometry } from './ConnectionRenderer.js';
import { GRID_SIZE } from '../model/grid.js';

const GRID_COLOR = '#1a212b';
const WIRE_COLOR = '#4f8cff';
const WIRE_SELECTED_COLOR = '#ffb454';

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

function drawConnections(ctx, project, wireSelection, boundary) {
  for (const connection of project.listConnections()) {
    const geometry = getConnectionGeometry(project, connection, boundary);
    if (!geometry) continue;

    const selected = wireSelection?.isSelected(connection.id);
    drawPath(ctx, geometry.points, { color: selected ? WIRE_SELECTED_COLOR : WIRE_COLOR, width: selected ? 4 : 3 });
  }
}

export function renderScene(
  ctx,
  camera,
  project,
  { selectedBlockId, dpr, canvasWidth, canvasHeight, pendingConnectionPath, wireSelection },
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  camera.applyTransform(ctx, dpr);
  drawGrid(ctx, camera, canvasWidth, canvasHeight);

  const blocks = project.listBlocks();
  const containerBlock = project.getContainerBlock();
  const boundary = containerBlock?.boundaryGeometry
    ? { block: containerBlock, geometry: containerBlock.boundaryGeometry }
    : null;

  // Drawn before the real blocks so they visually sit "inside" the frame
  // rather than the dashed outline cutting across them.
  if (boundary) {
    drawBoundary(ctx, boundary.block, boundary.geometry, { selected: boundary.block.id === selectedBlockId });
  }

  for (const block of blocks) {
    drawBlock(ctx, block, { selected: block.id === selectedBlockId });
  }

  drawConnections(ctx, project, wireSelection, boundary);

  if (pendingConnectionPath) {
    drawPath(ctx, pendingConnectionPath, { color: WIRE_COLOR, dashed: true });
  }
}
