// Routing a wire around the blocks in its way.
//
// The automatic route (see render/ConnectionRenderer.js) is a straight
// trunk or an L, which is right whenever nothing stands between the two
// pins. When something does, this finds an orthogonal path around it: an
// A* search over a 20 px lattice — half the grid, so a one-cell gap
// between two blocks holds exactly one free line — where a step costs its
// length and a bend costs extra, so the path bends as little as it can.
// The search leaves the source pin straight along its stub and arrives
// at the target pin straight along its stub, which is also what keeps
// the route's pieces alternating the way model/wireRoute.js expects.
//
// Pure geometry, no DOM: the lint CLI runs it in Node like the renderer.
import { sideNormal } from './grid.js';

export const LATTICE = 20;
// A bend costs this much extra length; a route with one bend fewer wins
// over one that is up to this much shorter.
const TURN_COST = 60;
// How far the path keeps from a block's edge. Under half the lattice
// step, so the lattice line in the middle of a one-cell gap stays free.
export const OBSTACLE_MARGIN = 10;
// Search budget: a level larger than this many lattice cells on a side
// falls back to the plain route rather than stalling a frame.
const MAX_CELLS = 400;
const MAX_EXPANSIONS = 60000;

const DIRS = [
  { dx: 1, dy: 0 },
  { dx: -1, dy: 0 },
  { dx: 0, dy: 1 },
  { dx: 0, dy: -1 },
];

function dirIndex(dx, dy) {
  return DIRS.findIndex((d) => d.dx === Math.sign(dx) && d.dy === Math.sign(dy));
}

function inflate(rect, m) {
  return { x: rect.x - m, y: rect.y - m, width: rect.width + 2 * m, height: rect.height + 2 * m };
}

function contains(rect, x, y) {
  return x >= rect.x && x <= rect.x + rect.width && y >= rect.y && y <= rect.y + rect.height;
}

// Whether the axis-aligned segment a→b passes through `rect`.
export function segmentHitsRect(a, b, rect) {
  const minX = Math.min(a.x, b.x);
  const maxX = Math.max(a.x, b.x);
  const minY = Math.min(a.y, b.y);
  const maxY = Math.max(a.y, b.y);
  return minX < rect.x + rect.width && maxX > rect.x && minY < rect.y + rect.height && maxY > rect.y;
}

// Whether any segment of `points` passes through any of `obstacles`
// (rects already inflated by the caller's margin).
export function pathHitsObstacles(points, obstacles) {
  for (let i = 0; i < points.length - 1; i += 1) {
    for (const rect of obstacles) {
      if (segmentHitsRect(points[i], points[i + 1], rect)) return true;
    }
  }
  return false;
}

// The blocks a wire between `stubA` and `stubB` must keep clear of: every
// block of the level except the two it connects and any block that
// encloses one of its ends — a lane or panel a pin sits inside is the
// space the wire lives in, not something in its way.
export function obstaclesFor(blocks, sourceBlockId, targetBlockId, stubA, stubB) {
  const out = [];
  for (const block of blocks) {
    if (block.id === sourceBlockId || block.id === targetBlockId) continue;
    const g = block.geometry;
    if (!g) continue;
    if (contains(g, stubA.x, stubA.y) || contains(g, stubB.x, stubB.y)) continue;
    out.push(g);
  }
  return out;
}

// A small binary heap on f-cost.
class Heap {
  constructor() {
    this.items = [];
  }

  push(item) {
    const a = this.items;
    a.push(item);
    let i = a.length - 1;
    while (i > 0) {
      const p = (i - 1) >> 1;
      if (a[p].f <= a[i].f) break;
      [a[p], a[i]] = [a[i], a[p]];
      i = p;
    }
  }

  pop() {
    const a = this.items;
    const top = a[0];
    const last = a.pop();
    if (a.length) {
      a[0] = last;
      let i = 0;
      for (;;) {
        const l = 2 * i + 1;
        const r = l + 1;
        let m = i;
        if (l < a.length && a[l].f < a[m].f) m = l;
        if (r < a.length && a[r].f < a[m].f) m = r;
        if (m === i) break;
        [a[m], a[i]] = [a[i], a[m]];
        i = m;
      }
    }
    return top;
  }

  get size() {
    return this.items.length;
  }
}

/**
 * Finds an orthogonal path from `stubA` (leaving straight along the source
 * stub) to `stubB` (arriving straight along the target stub) that stays
 * clear of `obstacles`, and returns it as the free-piece coordinates
 * model/wireRoute.js stores — the alternating x/y values of every piece
 * between the two stub runs. Returns null when there is no such path or
 * the level is too big to search, and the caller keeps the plain route.
 *
 * `sourceSide`/`targetSide` are the pins' sides; `sourceInverted` /
 * `targetInverted` mark a frame pin seen from inside (its stub points
 * into the frame). `lanes` are rectangles to keep clear of as well —
 * other wires' routes — that do not widen the search box.
 */
export function routeAroundObstacles({ stubA, sourceSide, sourceInverted = false, stubB, targetSide, targetInverted = false, obstacles, lanes = [] }) {
  if (!obstacles.length) return null;
  const sN = sideNormal(sourceSide);
  const tN = sideNormal(targetSide);
  const sSign = sourceInverted ? -1 : 1;
  const tSign = targetInverted ? -1 : 1;
  // Leaving the source: along its stub, away from the pin. Arriving at the
  // target: along its stub, toward the pin — the opposite of its outward
  // normal.
  const startDir = dirIndex(sN.x * sSign, sN.y * sSign);
  const endDir = dirIndex(-tN.x * tSign, -tN.y * tSign);
  if (startDir < 0 || endDir < 0) return null;

  // `lanes` are other wires' routes, already padded by the caller: kept
  // clear of like blocks, but not counted when sizing the search box.
  const blocked = [...obstacles.map((r) => inflate(r, OBSTACLE_MARGIN)), ...lanes];

  // Search box: everything involved, plus room to go around the outside.
  const pad = LATTICE * 4;
  let minX = Math.min(stubA.x, stubB.x);
  let maxX = Math.max(stubA.x, stubB.x);
  let minY = Math.min(stubA.y, stubB.y);
  let maxY = Math.max(stubA.y, stubB.y);
  for (const r of obstacles) {
    minX = Math.min(minX, r.x);
    maxX = Math.max(maxX, r.x + r.width);
    minY = Math.min(minY, r.y);
    maxY = Math.max(maxY, r.y + r.height);
  }
  minX = Math.floor((minX - pad) / LATTICE) * LATTICE;
  minY = Math.floor((minY - pad) / LATTICE) * LATTICE;
  maxX = Math.ceil((maxX + pad) / LATTICE) * LATTICE;
  maxY = Math.ceil((maxY + pad) / LATTICE) * LATTICE;
  const cols = (maxX - minX) / LATTICE + 1;
  const rows = (maxY - minY) / LATTICE + 1;
  if (cols > MAX_CELLS || rows > MAX_CELLS) return null;

  // The stubs need not lie on the lattice (a pin sits at a cell centre,
  // its stub one cell out — both multiples of 20 on a 40 grid, but a
  // hand-placed frame can put them anywhere). Snap for the search and
  // let the first and last pieces absorb the difference.
  const snapPoint = (p) => ({ x: Math.round(p.x / LATTICE) * LATTICE, y: Math.round(p.y / LATTICE) * LATTICE });
  const start = snapPoint(stubA);
  const goal = snapPoint(stubB);
  const key = (x, y, d) => ((y - minY) / LATTICE) * cols * 4 + ((x - minX) / LATTICE) * 4 + d;
  const isFree = (x, y) => {
    if (x < minX || x > maxX || y < minY || y > maxY) return false;
    for (const r of blocked) if (contains(r, x, y)) return false;
    return true;
  };
  const h = (x, y) => Math.abs(x - goal.x) + Math.abs(y - goal.y);

  const best = new Map();
  const heap = new Heap();
  const startKey = key(start.x, start.y, startDir);
  best.set(startKey, { g: 0, prev: null, x: start.x, y: start.y, d: startDir });
  heap.push({ f: h(start.x, start.y), g: 0, x: start.x, y: start.y, d: startDir });

  let expansions = 0;
  let found = null;
  while (heap.size && expansions < MAX_EXPANSIONS) {
    const cur = heap.pop();
    const curKey = key(cur.x, cur.y, cur.d);
    const rec = best.get(curKey);
    if (!rec || rec.g < cur.g) continue;
    expansions += 1;
    if (cur.x === goal.x && cur.y === goal.y && cur.d === endDir) {
      found = rec;
      break;
    }
    for (let d = 0; d < 4; d += 1) {
      const dir = DIRS[d];
      // No doubling back on the spot.
      if (dir.dx === -DIRS[cur.d].dx && dir.dy === -DIRS[cur.d].dy) continue;
      const nx = cur.x + dir.dx * LATTICE;
      const ny = cur.y + dir.dy * LATTICE;
      if (!isFree(nx, ny)) continue;
      const g = cur.g + LATTICE + (d === cur.d ? 0 : TURN_COST);
      const k = key(nx, ny, d);
      const prevRec = best.get(k);
      if (prevRec && prevRec.g <= g) continue;
      best.set(k, { g, prev: rec, x: nx, y: ny, d });
      heap.push({ f: g + h(nx, ny), g, x: nx, y: ny, d });
    }
  }
  if (!found) return null;

  // Walk back to the start, then merge the lattice steps into segments.
  const nodes = [];
  for (let rec = found; rec; rec = rec.prev) nodes.push(rec);
  nodes.reverse();
  const segments = [];
  for (let i = 1; i < nodes.length; i += 1) {
    const d = nodes[i].d;
    const o = DIRS[d].dx !== 0 ? 'h' : 'v';
    const last = segments[segments.length - 1];
    if (last && last.o === o) last.to = nodes[i];
    else segments.push({ o, from: nodes[i - 1], to: nodes[i] });
  }
  if (!segments.length) return null;
  // The first segment is the source's own run and the last the target's;
  // the pieces between them are the route. Each is one coordinate: the y
  // of a horizontal piece, the x of a vertical one.
  const coords = [];
  for (let i = 1; i < segments.length - 1; i += 1) {
    const seg = segments[i];
    coords.push(seg.o === 'h' ? seg.from.y : seg.from.x);
  }
  return coords;
}
