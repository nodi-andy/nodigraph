// A wire's hand-drawn route: the pieces a user has dragged it into, the
// same idea draw.io calls waypoints, but stored the way an orthogonal
// (right-angled) route actually needs.
//
// An orthogonal path alternates horizontal and vertical runs, so each
// movable piece is fully described by one number: the y a horizontal piece
// sits at, or the x a vertical one does. A route is just that list, in
// order from the source end:
//
//   { first: 'x', coords: [x1, y2, x3, ...] }
//
// `first` says which axis the first coordinate is on. It's always the axis
// the source port's side runs along (a left/right port leaves
// horizontally, so the first free piece is vertical and fixes an x), and is
// kept only to notice when a port has since moved to a side on the other
// axis, which makes the stored numbers mean something else entirely.
//
// The two runs at either end aren't in the list at all: they're pinned to a
// port, so they're rebuilt from the live port position every frame. That's
// what keeps a routed wire attached when a block moves, while every piece in
// between stays exactly where the user put it.
//
// Lines, pieces, corners: `buildRouteLines` turns the list into every line
// the path runs along (start run, the free pieces, end run), each
// { o: 'h' | 'v', value }. Consecutive lines are perpendicular, so each
// pair meets at exactly one corner, and the path is simply those corners
// in order. A "piece" is the stretch of one line between its two corners.
import { GRID_SIZE, sideAxis, snapToCellCenter } from './grid.js';

const flip = (o) => (o === 'h' ? 'v' : 'h');

// The line of orientation `o` through `point` — 'h' fixes y, 'v' fixes x.
function lineThrough(point, o) {
  return { o, value: o === 'h' ? point.y : point.x };
}

// Where two perpendicular lines meet.
function cornerOf(a, b) {
  return a.o === 'h' ? { x: b.value, y: a.value } : { x: a.value, y: b.value };
}

// The line a port's own stub runs along: a left/right port leaves
// horizontally, a top/bottom one vertically.
export function startLineFor(stubA, sourceSide) {
  return lineThrough(stubA, sideAxis(sourceSide) === 'x' ? 'h' : 'v');
}

function linesFrom(startLine, coords, stubB) {
  const lines = [startLine];
  let o = startLine.o;
  for (const value of coords) {
    o = flip(o);
    lines.push({ o, value });
  }
  lines.push(lineThrough(stubB, flip(o)));
  return lines;
}

export function buildRouteLines(stubA, sourceSide, stubB, coords) {
  return linesFrom(startLineFor(stubA, sourceSide), coords, stubB);
}

// Two ports whose sides run on the same axis (left to right, say) need an
// odd number of free pieces for the path to arrive running the way the
// target's stub does; ports on different axes need an even number. Every
// edit below adds or removes pieces two at a time, so a valid route stays
// valid, and one that stops matching (a port redocked onto the other axis)
// is noticed here rather than drawn as a wire doubling back into a block.
function fitsPorts(route, first, aligned) {
  return Boolean(route)
    && route.first === first
    && Array.isArray(route.coords)
    && route.coords.length % 2 === (aligned ? 1 : 0)
    && route.coords.every(Number.isFinite);
}

/**
 * The coordinates this wire routes through right now: its own stored route
 * when it still fits the ports, otherwise the automatic one — a single
 * trunk halfway between the stubs for aligned ports, a plain L for the
 * rest. `manual` says which. `routing` is the connection itself (anything
 * carrying `route`, or the older single-number `manualBend`).
 */
export function resolveRouteCoords(routing, sourceSide, targetSide, stubA, stubB) {
  const first = sideAxis(sourceSide);
  const aligned = first === sideAxis(targetSide);
  if (fitsPorts(routing?.route, first, aligned)) {
    return { first, coords: routing.route.coords, manual: true };
  }
  if (!aligned) return { first, coords: [], manual: false };
  // Diagrams saved before routes existed stored one dragged trunk
  // coordinate, which is exactly a one-piece route.
  if (routing?.manualBend != null && Number.isFinite(routing.manualBend)) {
    return { first, coords: [routing.manualBend], manual: true };
  }
  // Snapped to the cell-center family a port itself sits on (see
  // grid.snapToCellCenter) so a trunk between two ports runs true.
  const mid = first === 'x' ? (stubA.x + stubB.x) / 2 : (stubA.y + stubB.y) / 2;
  return { first, coords: [snapToCellCenter(mid)], manual: false };
}

/**
 * Every corner of the path, and every piece as { index, o, value, a, b,
 * anchor } where `a`/`b` are its two ends and `anchor` is 'source' or
 * 'target' for the two runs pinned to a port (null for a free piece). A
 * pinned run's `a`/`b` cover only the part past its stub — the stub itself
 * belongs to the port, and grabbing it redirects the wire instead (see
 * DragStateMachine's stub handling).
 */
export function routePieces(lines, stubA, stubB) {
  const corners = [];
  for (let i = 0; i < lines.length - 1; i += 1) corners.push(cornerOf(lines[i], lines[i + 1]));
  const last = lines.length - 1;
  const pieces = lines.map((line, i) => ({
    index: i,
    o: line.o,
    value: line.value,
    a: i === 0 ? stubA : corners[i - 1],
    b: i === last ? stubB : corners[i],
    anchor: i === 0 ? 'source' : i === last ? 'target' : null,
  }));
  return { corners, pieces };
}

// Where a new jog goes when a pinned end run is pulled sideways: just past
// the stub, half a cell further out, so the port keeps its straight exit
// and the jog lands on the same cell-center family every free piece snaps
// to. `o` is the jog line's own orientation (perpendicular to the run).
export function jogCoordinate(stubEnd, portPos, o) {
  const key = o === 'v' ? 'x' : 'y';
  const outward = Math.sign(stubEnd[key] - portPos[key]) || 1;
  return snapToCellCenter(stubEnd[key] + (outward * GRID_SIZE) / 2);
}

// Piece `index` (a free one, 1-based among the lines) moved to `value`.
export function withMovedPiece(coords, index, value) {
  const next = coords.slice();
  next[index - 1] = value;
  return next;
}

// A pinned end run can't move itself, so pulling it sideways grows a jog
// at the stub instead: the stub stays put, a new short piece steps across,
// and the rest of the run becomes a free piece at `value`. Returns the new
// coords and that free piece's index, which is what keeps being dragged.
export function withEndJog(coords, anchor, value, jog) {
  if (anchor === 'source') return { coords: [jog, value, ...coords], index: 2 };
  return { coords: [...coords, value, jog], index: coords.length + 1 };
}

// Breaks `piece` in two at `at` (a position along it), joined by a
// zero-length step — nothing visibly changes until one half is dragged.
// A pinned run keeps its port-side half pinned; the far half becomes free.
export function withSplitPiece(coords, piece, at) {
  if (piece.anchor === 'source') return [at, piece.value, ...coords];
  if (piece.anchor === 'target') return [...coords, piece.value, at];
  const i = piece.index - 1;
  return [...coords.slice(0, i), piece.value, at, piece.value, ...coords.slice(i + 1)];
}

const same = (a, b) => Math.abs(a - b) < 0.5;

/**
 * Drops the bend a drag just straightened out. After piece `index` moves,
 * a neighbour of it can end up with zero length because the lines on
 * either side of that neighbour now coincide — the piece was dragged back
 * into line. Those three lines are really one, so the neighbour and the
 * extra line go (two coordinates, keeping the parity rule above).
 * Only the dragged piece's own neighbours are checked: a split the user
 * just made elsewhere is zero-length on purpose and must survive.
 * Returns `coords` itself when nothing changed.
 */
export function withoutStraightenedBends(coords, startLine, stubB, index) {
  let next = coords;
  for (const k of [index + 1, index - 1]) {
    const n = next.length;
    if (k < 1 || k > n) continue;
    const lines = linesFrom(startLine, next, stubB);
    if (!same(lines[k - 1].value, lines[k + 1].value)) continue;
    if (k + 1 <= n) next = [...next.slice(0, k - 1), ...next.slice(k + 1)];
    else if (k - 1 >= 1) next = [...next.slice(0, k - 2), ...next.slice(k)];
  }
  return next;
}

// The same route, shifted — used when both of a wire's blocks move together
// (a group drag, a paste) so its hand-drawn route travels with them.
export function translateRoute(route, dx, dy) {
  const other = route.first === 'x' ? 'y' : 'x';
  return {
    first: route.first,
    coords: route.coords.map((c, i) => c + ((i % 2 === 0 ? route.first : other) === 'x' ? dx : dy)),
  };
}
