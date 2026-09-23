import test from 'node:test';
import assert from 'node:assert/strict';
import { buildHopIndex, drawPath, verticalSegmentsOf } from '../src/render/ConnectionRenderer.js';

// The hop index replaced a per-wire filter/flatMap over every other wire
// in the level (see buildHopIndex's own note on why). It is the same
// drawing either way, so these pin down what "the same" means: a wire bows
// over a crossing, and only over the crossings it is supposed to.

// A recording stand-in for the canvas, keeping just the arcs — a hop is
// drawn as an arc and nothing else is.
function recordingCtx() {
  const arcs = [];
  return {
    arcs,
    arc: (x, y, radius) => arcs.push({ x, y, radius }),
    save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, stroke() {},
    setLineDash() {},
    lineDashOffset: 0, lineJoin: '', lineCap: '', strokeStyle: '', lineWidth: 0,
  };
}

// One wire's worth of what routeConnections produces.
function entry(points) {
  return { verticals: verticalSegmentsOf(points), points };
}

// A horizontal wire at y=50 running left to right, and a vertical wire
// crossing it at x=100.
const horizontal = [{ x: 0, y: 50 }, { x: 200, y: 50 }];
const crossing = [{ x: 100, y: 0 }, { x: 100, y: 100 }];

test('a wire bows over another wire that crosses it', () => {
  const routed = [entry(horizontal), entry(crossing)];
  const index = buildHopIndex(routed);
  const ctx = recordingCtx();
  drawPath(ctx, horizontal, { hopOver: index, hopSkip: (owner) => owner === 0 });
  assert.equal(ctx.arcs.length, 1);
  assert.equal(ctx.arcs[0].x, 100);
  assert.equal(ctx.arcs[0].y, 50);
});

test('a wire never bows over its own vertical runs', () => {
  // An L: down from the start, then across. Its own vertical sits at the
  // very start of the horizontal run, and is its own besides.
  const ell = [{ x: 0, y: 0 }, { x: 0, y: 50 }, { x: 200, y: 50 }];
  const routed = [entry(ell)];
  const index = buildHopIndex(routed);
  const ctx = recordingCtx();
  drawPath(ctx, ell, { hopOver: index, hopSkip: (owner) => owner === 0 });
  assert.equal(ctx.arcs.length, 0);
});

test('hopSkip keeps a wire from bowing over one it shares a pin with', () => {
  const routed = [entry(horizontal), entry(crossing)];
  const index = buildHopIndex(routed);
  const ctx = recordingCtx();
  // Both wires excluded — the second as if it hung off one of the first's
  // own pins, which is what drawOneConnection's sharesEndpoint decides.
  drawPath(ctx, horizontal, { hopOver: index, hopSkip: () => true });
  assert.equal(ctx.arcs.length, 0);
});

test('a crossing too close to either end of the run is not bowed over', () => {
  // HOP_RADIUS is 8; a crossing within that of an end reads as a kink.
  const near = [{ x: 4, y: 0 }, { x: 4, y: 100 }];
  const routed = [entry(horizontal), entry(near)];
  const index = buildHopIndex(routed);
  const ctx = recordingCtx();
  drawPath(ctx, horizontal, { hopOver: index, hopSkip: (owner) => owner === 0 });
  assert.equal(ctx.arcs.length, 0);
});

test('a vertical that stops short of the wire is not a crossing', () => {
  // Ends at y=20, well above the horizontal at y=50.
  const short = [{ x: 100, y: 0 }, { x: 100, y: 20 }];
  const routed = [entry(horizontal), entry(short)];
  const index = buildHopIndex(routed);
  const ctx = recordingCtx();
  drawPath(ctx, horizontal, { hopOver: index, hopSkip: (owner) => owner === 0 });
  assert.equal(ctx.arcs.length, 0);
});

test('crossings closer than two hops merge into one wider bow', () => {
  const a = [{ x: 100, y: 0 }, { x: 100, y: 100 }];
  const b = [{ x: 106, y: 0 }, { x: 106, y: 100 }];
  const routed = [entry(horizontal), entry(a), entry(b)];
  const index = buildHopIndex(routed);
  const ctx = recordingCtx();
  drawPath(ctx, horizontal, { hopOver: index, hopSkip: (owner) => owner === 0 });
  assert.equal(ctx.arcs.length, 1);
  assert.equal(ctx.arcs[0].x, 103);
  // Half the span, plus the hop's own radius either side.
  assert.equal(ctx.arcs[0].radius, 11);
});

test('several separate crossings each get their own bow, left to right', () => {
  const routed = [
    entry(horizontal),
    entry([{ x: 50, y: 0 }, { x: 50, y: 100 }]),
    entry([{ x: 100, y: 0 }, { x: 100, y: 100 }]),
    entry([{ x: 150, y: 0 }, { x: 150, y: 100 }]),
  ];
  const index = buildHopIndex(routed);
  const ctx = recordingCtx();
  drawPath(ctx, horizontal, { hopOver: index, hopSkip: (owner) => owner === 0 });
  assert.deepEqual(ctx.arcs.map((a) => a.x), [50, 100, 150]);
});

test('a wire traced right to left bows over the same crossings', () => {
  const reversed = [{ x: 200, y: 50 }, { x: 0, y: 50 }];
  const routed = [entry(reversed), entry(crossing)];
  const index = buildHopIndex(routed);
  const ctx = recordingCtx();
  drawPath(ctx, reversed, { hopOver: index, hopSkip: (owner) => owner === 0 });
  assert.equal(ctx.arcs.length, 1);
  assert.equal(ctx.arcs[0].x, 100);
});

test('the index sorts every run by x and keeps each one owner', () => {
  const routed = [
    entry([{ x: 150, y: 0 }, { x: 150, y: 10 }]),
    entry([{ x: 50, y: 0 }, { x: 50, y: 10 }]),
    entry([{ x: 100, y: 0 }, { x: 100, y: 10 }]),
  ];
  const index = buildHopIndex(routed);
  assert.equal(index.length, 3);
  assert.deepEqual([...index.x], [50, 100, 150]);
  assert.deepEqual([...index.owner], [1, 2, 0]);
});
