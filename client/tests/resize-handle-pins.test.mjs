import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlock } from '../src/model/Block.js';
import { Project } from '../src/model/Project.js';
import { addPort } from '../src/model/BlockDescription.js';
import {
  getResizeHandleRects,
  getPortSlotRect,
  pinSpansOf,
  PLUG_REACH,
  RESIZE_HANDLE_OUTSET,
  RESIZE_HANDLE_SIZE,
  SOCKET_DEPTH,
} from '../src/render/BlockRenderer.js';
import { hitTest } from '../src/interaction/HitTest.js';

// Same minimal stand-in the sibling tests use: hit-testing measures the
// boundary frame's title, the one canvas call in this path.
globalThis.document = {
  createElement: () => ({ getContext: () => ({ measureText: (text) => ({ width: text.length * 7 }) }) }),
};

// A 120x80 block: three slots along the top and bottom (20, 60, 100 —
// one exactly at the midpoint), two along each side (20, 60 — none at
// the midpoint of 40).
function block(pins = []) {
  const project = new Project();
  const b = createBlock({ name: 'B' });
  b.geometry = { x: 200, y: 100, width: 120, height: 80 };
  const added = pins.map(({ side, offset, direction = 'in' }) => {
    const pin = addPort(b, { direction, side, offset });
    return pin;
  });
  project.addBlock(b);
  return { project, block: b, pins: added };
}

const centre = (rect) => ({ x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 });
const overlaps = (a, b) => a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;

test('with no pin in the way, every handle sits where it always did', () => {
  const { block: b, pins } = block([{ side: 'left', offset: 20 }, { side: 'right', offset: 20, direction: 'out' }]);
  assert.equal(pins.length, 2);
  const plain = getResizeHandleRects(b.geometry, 1);
  const aware = getResizeHandleRects(b.geometry, 1, pinSpansOf(b));
  assert.deepEqual(aware, plain);
});

test('a pin at the midpoint of an edge moves that edge handle aside, along the edge', () => {
  const { block: b, pins } = block([{ side: 'top', offset: 60 }, { side: 'bottom', offset: 60, direction: 'out' }]);
  const spans = pinSpansOf(b);
  const rects = getResizeHandleRects(b.geometry, 1, spans);
  const plain = getResizeHandleRects(b.geometry, 1);
  for (const side of ['top', 'bottom']) {
    // Same distance from the block as before: it stepped sideways, not out.
    assert.equal(rects[side].y, plain[side].y, `${side} handle kept its outset`);
    assert.notEqual(rects[side].x, plain[side].x, `${side} handle moved along the edge`);
    // Clear of the pin's socket, the wire's axis included.
    const slot = getPortSlotRect(b, pins[side === 'top' ? 0 : 1]);
    const handleSpan = { x: rects[side].x, y: 0, width: rects[side].width, height: 1 };
    assert.equal(overlaps(handleSpan, { x: slot.x, y: 0, width: slot.width, height: 1 }), false, `${side} handle overlaps the pin`);
    // A top pin's name runs to the right of its stub, so the handle steps left.
    assert.ok(rects[side].x < plain[side].x, `${side} handle stepped to the pin's label-free side`);
  }
  // The other six handles are untouched.
  for (const side of ['left', 'right', 'nw', 'ne', 'sw', 'se']) assert.deepEqual(rects[side], plain[side]);
});

test('two pins in neighbouring slots still leave the midpoint between them to the handle', () => {
  const { block: b } = block([{ side: 'left', offset: 20 }, { side: 'left', offset: 60 }]);
  const rects = getResizeHandleRects(b.geometry, 1, pinSpansOf(b));
  const plain = getResizeHandleRects(b.geometry, 1);
  assert.deepEqual(rects.left, plain.left);
});

test('an edge too short to step along pushes its handle out past the plugs instead', () => {
  const project = new Project();
  const b = createBlock({ name: 'Narrow' });
  // One slot per side on the 40px-high sides, at the midpoint.
  b.geometry = { x: 0, y: 0, width: 120, height: 40 };
  addPort(b, { direction: 'in', side: 'left', offset: 20 });
  project.addBlock(b);
  const rects = getResizeHandleRects(b.geometry, 1, pinSpansOf(b));
  const plain = getResizeHandleRects(b.geometry, 1);
  assert.equal(centre(rects.left).y, centre(plain.left).y, 'kept the midpoint');
  assert.ok(rects.left.x + rects.left.width < -PLUG_REACH, 'sits wholly outside the plug');
  assert.ok(centre(rects.left).x < centre(plain.left).x, 'farther out than an unobstructed handle');
});

test('a hidden pin is not in the way', () => {
  const { block: b } = block([{ side: 'top', offset: 60 }]);
  const hidden = addPort(b, { direction: 'in', side: 'bottom', offset: 60, hidden: true });
  assert.ok(hidden);
  const rects = getResizeHandleRects(b.geometry, 1, pinSpansOf(b));
  const plain = getResizeHandleRects(b.geometry, 1);
  assert.notEqual(rects.top.x, plain.top.x);
  assert.deepEqual(rects.bottom, plain.bottom);
});

test('the handle is hit where it is drawn, and the pin is hit where the handle used to be', () => {
  const { project, block: b } = block([{ side: 'top', offset: 60 }]);
  const zoom = 1;
  const moved = getResizeHandleRects(b.geometry, zoom, pinSpansOf(b)).top;
  const at = centre(moved);
  const hit = hitTest(project, at.x, at.y, null, b.id, null, zoom);
  assert.deepEqual(hit, { type: 'resizeHandle', blockId: b.id, side: 'top', isBoundary: false });
  const old = centre(getResizeHandleRects(b.geometry, zoom).top);
  const oldHit = hitTest(project, old.x, old.y, null, b.id, null, zoom);
  assert.notEqual(oldHit?.type, 'resizeHandle');
});

test('zoomed in, the handles stay outside the sockets rather than shrinking into them', () => {
  const { block: b } = block([]);
  for (const zoom of [1, 2, 4, 8]) {
    const rects = getResizeHandleRects(b.geometry, zoom);
    // Never nearer than the screen-constant outset, never inside a socket.
    assert.ok(b.geometry.y - centre(rects.top).y >= RESIZE_HANDLE_OUTSET / zoom - 1e-9, `zoom ${zoom}: at least the usual outset`);
    assert.ok(b.geometry.y - (rects.top.y + rects.top.height) > SOCKET_DEPTH, `zoom ${zoom}: clear of the empty-slot squares`);
    assert.ok(b.geometry.x - (rects.left.x + rects.left.width) > SOCKET_DEPTH, `zoom ${zoom}: clear on the left too`);
  }
  // At zoom 1 nothing changed.
  assert.equal(b.geometry.y - centre(getResizeHandleRects(b.geometry, 1).top).y, RESIZE_HANDLE_OUTSET);
});

test('the same holds at other zoom levels, in screen terms', () => {
  const { block: b } = block([{ side: 'top', offset: 60 }]);
  for (const zoom of [0.5, 2, 4]) {
    const rects = getResizeHandleRects(b.geometry, zoom, pinSpansOf(b));
    assert.equal(rects.top.width, RESIZE_HANDLE_SIZE / zoom);
    const plain = getResizeHandleRects(b.geometry, zoom);
    assert.equal(centre(rects.top).y, centre(plain.top).y, `zoom ${zoom}: outset unchanged by the pin`);
    const slot = getPortSlotRect(b, b.ports[0]);
    assert.ok(rects.top.x + rects.top.width <= slot.x || rects.top.x >= slot.x + slot.width, `zoom ${zoom}: clear of the pin`);
  }
});
