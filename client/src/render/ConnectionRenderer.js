import { WIRE_STUB_LENGTH, sideNormal, sideAxis, snap } from '../model/grid.js';
import { findPortPosition } from './BlockRenderer.js';

// Drops points that don't actually bend the path (collinear with their
// neighbors) and collapses zero-length segments — this is what turns the
// stub+bridge construction below into a clean, minimal polyline.
function simplifyPath(rawPoints) {
  const deduped = [rawPoints[0]];
  for (let i = 1; i < rawPoints.length; i += 1) {
    const p = rawPoints[i];
    const prev = deduped[deduped.length - 1];
    if (prev.x === p.x && prev.y === p.y) continue;
    deduped.push(p);
  }

  if (deduped.length <= 2) return deduped;

  const result = [deduped[0]];
  for (let i = 1; i < deduped.length - 1; i += 1) {
    const prev = result[result.length - 1];
    const cur = deduped[i];
    const next = deduped[i + 1];
    const collinearHoriz = prev.y === cur.y && cur.y === next.y;
    const collinearVert = prev.x === cur.x && cur.x === next.x;
    if (!collinearHoriz && !collinearVert) result.push(cur);
  }
  result.push(deduped[deduped.length - 1]);
  return result;
}

/**
 * Manhattan router, similar in spirit to belt/trace routing: each port gets
 * a fixed-length stub straight out from its side, then the two stubs are
 * bridged with either a single corner (mixed side axes — no free segment to
 * grab afterward) or two corners around a middle "trunk" (aligned side
 * axes — this is the one segment a user can pick up and drag). manualBend
 * overrides the trunk's auto-midpoint once someone has dragged it.
 */
export function computeConnectionPath(
  sourcePos,
  sourceSide,
  targetPos,
  targetSide,
  manualBend,
  sourceInverted = false,
  targetInverted = false,
) {
  const sNorm = sideNormal(sourceSide);
  const tNorm = sideNormal(targetSide);
  // A boundary endpoint's stub points inward instead of outward (see
  // BlockRenderer.getConnectorHandlePosition for the same flip on the nub).
  const sSign = sourceInverted ? -1 : 1;
  const tSign = targetInverted ? -1 : 1;
  const stubA = { x: sourcePos.x + sNorm.x * sSign * WIRE_STUB_LENGTH, y: sourcePos.y + sNorm.y * sSign * WIRE_STUB_LENGTH };
  const stubB = { x: targetPos.x + tNorm.x * tSign * WIRE_STUB_LENGTH, y: targetPos.y + tNorm.y * tSign * WIRE_STUB_LENGTH };
  const sourceAxis = sideAxis(sourceSide);
  const targetAxis = sideAxis(targetSide);

  let bridge;
  if (sourceAxis === 'x' && targetAxis === 'x') {
    const midX = manualBend != null ? manualBend : snap((stubA.x + stubB.x) / 2);
    bridge = [{ x: midX, y: stubA.y }, { x: midX, y: stubB.y }];
  } else if (sourceAxis === 'y' && targetAxis === 'y') {
    const midY = manualBend != null ? manualBend : snap((stubA.y + stubB.y) / 2);
    bridge = [{ x: stubA.x, y: midY }, { x: stubB.x, y: midY }];
  } else if (sourceAxis === 'x') {
    bridge = [{ x: stubB.x, y: stubA.y }];
  } else {
    bridge = [{ x: stubA.x, y: stubB.y }];
  }

  const points = simplifyPath([sourcePos, stubA, ...bridge, stubB, targetPos]);
  const hasTrunk = points.length >= 4;
  return {
    points,
    trunkIndex: hasTrunk ? 1 : -1,
    trunkAxis: hasTrunk ? (points[1].x === points[2].x ? 'x' : 'y') : null,
  };
}

// The live "paving" preview while dragging from a connector handle — routes
// toward the cursor the same way a real connection would, so what you see
// while dragging is what you'll get on drop.
export function previewPathToCursor(sourcePos, sourceSide, cursorPos, inverted = false) {
  const sNorm = sideNormal(sourceSide);
  const sign = inverted ? -1 : 1;
  const stubA = { x: sourcePos.x + sNorm.x * sign * WIRE_STUB_LENGTH, y: sourcePos.y + sNorm.y * sign * WIRE_STUB_LENGTH };
  const axis = sideAxis(sourceSide);
  const corner = axis === 'x' ? { x: cursorPos.x, y: stubA.y } : { x: stubA.x, y: cursorPos.y };
  return simplifyPath([sourcePos, stubA, corner, cursorPos]);
}

// Resolves a stored Connection into live geometry against the *current*
// block/port positions every time — nothing about the route is cached, so
// moving a block just re-attaches the stubs without extra bookkeeping.
// `boundary` (optional, `{ block, geometry }`) is the container you're
// currently inside — if either endpoint is that block, its boundary
// geometry and inverted stub direction are used instead of its own
// (irrelevant, outside-facing) stored geometry.
export function getConnectionGeometry(project, connection, boundary) {
  const resolve = (blockId) => {
    const block = project.getBlock(blockId);
    if (!block) return null;
    const isBoundary = Boolean(boundary) && blockId === boundary.block.id;
    return { block: isBoundary ? { ...block, geometry: boundary.geometry } : block, isBoundary };
  };

  const source = resolve(connection.sourceBlockId);
  const target = resolve(connection.targetBlockId);
  if (!source || !target) return null;

  const sourcePort = source.block.ports.find((p) => p.id === connection.sourcePortId);
  const targetPort = target.block.ports.find((p) => p.id === connection.targetPortId);
  if (!sourcePort || !targetPort) return null;

  const sourcePos = findPortPosition(source.block, sourcePort.id);
  const targetPos = findPortPosition(target.block, targetPort.id);
  if (!sourcePos || !targetPos) return null;

  const routed = computeConnectionPath(
    sourcePos,
    sourcePort.side,
    targetPos,
    targetPort.side,
    connection.manualBend,
    source.isBoundary,
    target.isBoundary,
  );
  return { ...routed, sourcePos, targetPos };
}

function pathLength(points) {
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    total += Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
  }
  return total;
}

export function pointOnPath(points, t) {
  if (!points.length) return { x: 0, y: 0 };
  if (points.length === 1) return points[0];

  const total = pathLength(points);
  let remaining = Math.min(1, Math.max(0, t)) * total;

  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    const segLen = Math.hypot(b.x - a.x, b.y - a.y);
    if (remaining <= segLen || i === points.length - 2) {
      const ratio = segLen === 0 ? 0 : remaining / segLen;
      return { x: a.x + (b.x - a.x) * ratio, y: a.y + (b.y - a.y) * ratio };
    }
    remaining -= segLen;
  }
  return points[points.length - 1];
}

export function drawPath(ctx, points, { color = '#4f8cff', width = 3, dashed = false } = {}) {
  if (points.length < 2) return;
  ctx.save();
  ctx.setLineDash(dashed ? [6, 4] : []);
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) ctx.lineTo(points[i].x, points[i].y);
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.restore();
}

export function drawFlowDot(ctx, points, t, { color = '#e6e9ef', radius = 3.5 } = {}) {
  const p = pointOnPath(points, t);
  ctx.beginPath();
  ctx.arc(p.x, p.y, radius, 0, Math.PI * 2);
  ctx.fillStyle = color;
  ctx.fill();
}

function distanceToSegment(px, py, ax, ay, bx, by) {
  const dx = bx - ax;
  const dy = by - ay;
  const lengthSq = dx * dx + dy * dy;
  let t = lengthSq === 0 ? 0 : ((px - ax) * dx + (py - ay) * dy) / lengthSq;
  t = Math.min(1, Math.max(0, t));
  const cx = ax + t * dx;
  const cy = ay + t * dy;
  return Math.hypot(px - cx, py - cy);
}

// Only the trunk segment is a valid drag target — the two stub segments are
// anchored directly to a port's fixed exit point, so they aren't offered up
// for hit-testing here at all.
export function hitTestConnectionTrunk(geometry, worldX, worldY, threshold = 8) {
  if (!geometry || geometry.trunkIndex < 0) return false;
  const a = geometry.points[geometry.trunkIndex];
  const b = geometry.points[geometry.trunkIndex + 1];
  return distanceToSegment(worldX, worldY, a.x, a.y, b.x, b.y) <= threshold;
}
