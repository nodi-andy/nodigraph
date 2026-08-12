import { drawBlock, findPortPosition } from './BlockRenderer.js';
import { drawConnection, drawFlowDot } from './ConnectionRenderer.js';
import { getFlowPhase } from './FlowAnimator.js';
import { GRID_SIZE } from '../model/grid.js';

const GRID_COLOR = '#1a212b';

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

function drawConnections(ctx, project, timestampMs) {
  const phase = getFlowPhase(timestampMs);
  for (const connection of project.listConnections()) {
    const sourceBlock = project.getBlock(connection.sourceBlockId);
    const targetBlock = project.getBlock(connection.targetBlockId);
    if (!sourceBlock || !targetBlock) continue;

    const sourcePos = findPortPosition(sourceBlock, connection.sourcePortId);
    const targetPos = findPortPosition(targetBlock, connection.targetPortId);
    if (!sourcePos || !targetPos) continue;

    drawConnection(ctx, sourcePos, targetPos);
    drawFlowDot(ctx, sourcePos, targetPos, phase);
  }
}

export function renderScene(
  ctx,
  camera,
  project,
  { selectedBlockId, dpr, canvasWidth, canvasHeight, pendingConnection, timestampMs = 0 },
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  camera.applyTransform(ctx, dpr);
  drawGrid(ctx, camera, canvasWidth, canvasHeight);

  for (const block of project.listBlocks()) {
    drawBlock(ctx, block, { selected: block.id === selectedBlockId });
  }

  drawConnections(ctx, project, timestampMs);

  if (pendingConnection) {
    drawConnection(ctx, pendingConnection.source, pendingConnection.target, {
      color: '#4f8cff',
      dashed: true,
    });
  }
}
