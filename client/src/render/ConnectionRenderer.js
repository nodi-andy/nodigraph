import { WIRE_STUB_LENGTH, sideNormal, sideAxis, snap } from '../model/grid.js';
import { findConnectorPosition } from './BlockRenderer.js';

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

  const sourcePos = findConnectorPosition(source.block, sourcePort.id, source.isBoundary);
  const targetPos = findConnectorPosition(target.block, targetPort.id, target.isBoundary);
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

// Two wires that merely cross look exactly like two wires that join, which
// on a diagram whose whole job is saying what is connected to what is a
// real ambiguity, not a cosmetic one. The schematic convention fixes it
// with a hop: one of the two lines bows over the other. Only horizontal
// segments hop, so a crossing is never drawn twice and the choice needs no
// coordination between the two wires.
// Sized against the wire width rather than the grid: at 3px thick, a bow
// much under this reads as a nub on a straight line instead of a line
// going over something.
const HOP_RADIUS = 8;

// Every vertical run of a path, as { x, y1, y2 } with y1 < y2 — the
// candidates a horizontal segment might have to bow over.
export function verticalSegmentsOf(points) {
  const segments = [];
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (a.x === b.x && a.y !== b.y) {
      segments.push({ x: a.x, y1: Math.min(a.y, b.y), y2: Math.max(a.y, b.y) });
    }
  }
  return segments;
}

// Where along a horizontal segment the bows go. A crossing is skipped when
// it sits within a hop's own width of either end, since an arc merging into
// a corner reads as a kink rather than a hop. Crossings closer together
// than two hops are merged into one wider bow instead of drawing arcs that
// overlap each other.
function hopCentersOn(a, b, verticals) {
  const left = Math.min(a.x, b.x);
  const right = Math.max(a.x, b.x);
  const xs = [];
  for (const v of verticals) {
    if (v.x <= left + HOP_RADIUS || v.x >= right - HOP_RADIUS) continue;
    if (a.y <= v.y1 + 0.5 || a.y >= v.y2 - 0.5) continue;
    xs.push(v.x);
  }
  if (!xs.length) return [];

  xs.sort((m, n) => m - n);
  const clusters = [];
  let start = xs[0];
  let end = xs[0];
  for (let i = 1; i < xs.length; i += 1) {
    if (xs[i] - end <= HOP_RADIUS * 2) {
      end = xs[i];
      continue;
    }
    clusters.push({ start, end });
    start = xs[i];
    end = xs[i];
  }
  clusters.push({ start, end });

  return clusters.map(({ start: s, end: e }) => ({
    center: (s + e) / 2,
    radius: (e - s) / 2 + HOP_RADIUS,
  }));
}

// Always bows upward, whichever way the segment is being traced: the arc
// runs through the point above the crossing either way, so a diagram never
// mixes bows that go over with bows that go under.
function traceHorizontalWithHops(ctx, a, b, verticals) {
  const hops = hopCentersOn(a, b, verticals);
  if (!hops.length) {
    ctx.lineTo(b.x, b.y);
    return;
  }
  const forward = b.x > a.x;
  const ordered = forward ? hops : [...hops].reverse();
  for (const hop of ordered) {
    if (forward) ctx.arc(hop.center, a.y, hop.radius, Math.PI, 0, false);
    else ctx.arc(hop.center, a.y, hop.radius, 0, Math.PI, true);
  }
  ctx.lineTo(b.x, b.y);
}

// The marching pattern used for flow animation. Longer and gappier than
// the drag preview's, because at wire thickness a fine dash reads as a
// texture rather than as something moving.
export const FLOW_DASH = [14, 10];
export const PREVIEW_DASH = [6, 4];

// A wire's own resting line style, set from the Inspector (see
// ui/InspectorPanel.js) — independent of the flow animation's dashes,
// which take over the whole wire while Animate is running regardless of
// this setting (see SceneRenderer.drawConnections).
export const DASH_STYLES = ['solid', 'dashed', 'dotted'];
const DASH_PATTERNS = {
  dashed: [10, 6],
  // A short dash plus the round line cap already set in drawPath draws as
  // a dot, not a dash — no separate "dotted" rendering path needed.
  dotted: [1, 7],
};

export function getDashPattern(style) {
  return DASH_PATTERNS[style] || null;
}

/**
 * `dash` is a dash pattern or null for a solid line, and `dashOffset`
 * shifts where the pattern starts — animating it is what makes the dashes
 * march. A negative offset moves them along the path's own direction,
 * which for a connection runs output to input (see model/Connection.js).
 */
export function drawPath(
  ctx,
  points,
  { color = '#4f8cff', width = 3, dash = null, dashOffset = 0, hopOver = null } = {},
) {
  if (points.length < 2) return;
  ctx.save();
  ctx.setLineDash(dash || []);
  ctx.lineDashOffset = dashOffset;
  ctx.lineJoin = 'miter';
  ctx.lineCap = 'round';
  ctx.beginPath();
  ctx.moveTo(points[0].x, points[0].y);
  for (let i = 1; i < points.length; i += 1) {
    const from = points[i - 1];
    const to = points[i];
    if (hopOver?.length && from.y === to.y && from.x !== to.x) {
      traceHorizontalWithHops(ctx, from, to, hopOver);
    } else {
      ctx.lineTo(to.x, to.y);
    }
  }
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
  ctx.restore();
}

// Where a wire's own label sits: the middle of the trunk when there is one
// (the one straight, centrally-placed segment every wire with a bend has),
// or the geometric midpoint by arc length when there isn't (a single-
// corner route). Either way this is also what places the inline editor
// over the label when you double-click it (see main.js).
export function getConnectionLabelPosition(geometry) {
  const { points, trunkIndex } = geometry;
  if (trunkIndex >= 0) {
    const a = points[trunkIndex];
    const b = points[trunkIndex + 1];
    return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
  }

  const lengths = [];
  let total = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    const len = Math.hypot(points[i + 1].x - points[i].x, points[i + 1].y - points[i].y);
    lengths.push(len);
    total += len;
  }
  let remaining = total / 2;
  for (let i = 0; i < lengths.length; i += 1) {
    if (remaining <= lengths[i]) {
      const t = lengths[i] === 0 ? 0 : remaining / lengths[i];
      const a = points[i];
      const b = points[i + 1];
      return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t };
    }
    remaining -= lengths[i];
  }
  return points[Math.floor(points.length / 2)];
}

const LABEL_FONT = '11px -apple-system, Segoe UI, Roboto, sans-serif';
const LABEL_PAD_X = 5;
const LABEL_PAD_Y = 3;

// A small pill behind the text — a wire crosses grid lines and other
// wires constantly, and text with nothing behind it reads poorly over
// either. Drawn centered on the label position, on top of the wire so
// it's always legible regardless of what color the wire itself is.
export function drawConnectionLabel(ctx, geometry, label) {
  if (!label) return;
  const pos = getConnectionLabelPosition(geometry);

  ctx.font = LABEL_FONT;
  const textWidth = ctx.measureText(label).width;
  const w = textWidth + LABEL_PAD_X * 2;
  const h = 14 + LABEL_PAD_Y;
  const rectX = pos.x - w / 2;
  const rectY = pos.y - h / 2;

  ctx.fillStyle = '#10151c';
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.15)';
  ctx.lineWidth = 1;
  ctx.fillRect(rectX, rectY, w, h);
  ctx.strokeRect(rectX, rectY, w, h);

  ctx.fillStyle = '#e6e9ef';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(label, pos.x, pos.y);
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
// for dragging at all. Selecting is a different question: see
// hitTestConnectionPath.
export function hitTestConnectionTrunk(geometry, worldX, worldY, threshold = 8) {
  if (!geometry || geometry.trunkIndex < 0) return false;
  const a = geometry.points[geometry.trunkIndex];
  const b = geometry.points[geometry.trunkIndex + 1];
  return distanceToSegment(worldX, worldY, a.x, a.y, b.x, b.y) <= threshold;
}

// Any part of the wire selects it, trunk or stub — picking a pipe to
// recolor it shouldn't require finding the one draggable segment, which on
// a short wire can be a few pixels long or absent entirely.
export function hitTestConnectionPath(geometry, worldX, worldY, threshold = 8) {
  if (!geometry) return false;
  const { points } = geometry;
  for (let i = 0; i < points.length - 1; i += 1) {
    const a = points[i];
    const b = points[i + 1];
    if (distanceToSegment(worldX, worldY, a.x, a.y, b.x, b.y) <= threshold) return true;
  }
  return false;
}
