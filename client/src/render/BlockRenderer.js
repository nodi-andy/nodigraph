const HEADER_HEIGHT = 26;
const CORNER_RADIUS = 6;
export const RESIZE_HANDLE_SIZE = 10;

const REGION_LABELS = ['INPUT', 'PROCESSING', 'OUTPUT'];

function roundRectPath(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

// The fixed Input/Processing/Output layout every block shares: everything
// else (port placement, hit-testing) is built against this geometry contract.
export function drawBlock(ctx, block, { selected = false } = {}) {
  const { x, y, width, height } = block.geometry;
  const bodyY = y + HEADER_HEIGHT;
  const bodyHeight = height - HEADER_HEIGHT;
  const regionWidth = width / 3;

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

  for (let i = 0; i < 3; i += 1) {
    const regionX = x + i * regionWidth;
    if (i > 0) {
      ctx.strokeStyle = '#2c3644';
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.moveTo(regionX, bodyY);
      ctx.lineTo(regionX, y + height);
      ctx.stroke();
    }
    ctx.fillStyle = '#6b7889';
    ctx.font = '9px -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.fillText(REGION_LABELS[i], regionX + 6, bodyY + 10);
  }

  ctx.restore();

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
