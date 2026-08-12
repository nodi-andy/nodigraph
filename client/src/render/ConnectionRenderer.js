// A fixed-magnitude horizontal control-point offset (rather than one scaled
// only by dx) keeps the curve looking like a cable even when the target sits
// to the left of the source, instead of pinching into a loop.
function bezierControlPoints(source, target) {
  const dx = target.x - source.x;
  const offset = Math.max(60, Math.abs(dx) / 2);
  return {
    cp1: { x: source.x + offset, y: source.y },
    cp2: { x: target.x - offset, y: target.y },
  };
}

export function drawConnection(ctx, source, target, { color = '#4f8cff', width = 2, dashed = false } = {}) {
  const { cp1, cp2 } = bezierControlPoints(source, target);
  ctx.save();
  ctx.setLineDash(dashed ? [6, 4] : []);
  ctx.beginPath();
  ctx.moveTo(source.x, source.y);
  ctx.bezierCurveTo(cp1.x, cp1.y, cp2.x, cp2.y, target.x, target.y);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.restore();
}

export function pointOnConnection(source, target, t) {
  const { cp1, cp2 } = bezierControlPoints(source, target);
  const mt = 1 - t;
  return {
    x: mt ** 3 * source.x + 3 * mt ** 2 * t * cp1.x + 3 * mt * t ** 2 * cp2.x + t ** 3 * target.x,
    y: mt ** 3 * source.y + 3 * mt ** 2 * t * cp1.y + 3 * mt * t ** 2 * cp2.y + t ** 3 * target.y,
  };
}

export function drawFlowDot(ctx, source, target, t, { color = '#e6e9ef', radius = 3.5 } = {}) {
  const p = pointOnConnection(source, target, t);
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}
