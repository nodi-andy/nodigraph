import test from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULT_FRAME_FACTOR,
  MIN_FRAME_FACTOR,
  MAX_FRAME_FACTOR,
  frameFactorOf,
  frameAtFactor,
  frameToFace,
  defaultBoundaryFor,
  normalizeFrame,
} from '../src/model/levelGeometry.js';
import { isLevelOpen } from '../src/render/SubPreviewRenderer.js';
import { createBlock } from '../src/model/Block.js';

globalThis.document = {
  createElement: () => ({ getContext: () => ({ measureText: (text) => ({ width: String(text).length * 7 }) }) }),
};

// How much room a block has inside it is the ratio of its frame to its
// face, and Ctrl+wheel is that ratio on a control (see
// DragStateMachine.scaleInteriorAt). These cover the geometry underneath
// it — including the part the feature exists for, that a block with more
// room inside has to be zoomed further before its level is drawn at all.

const face = { x: 0, y: 0, width: 240, height: 160 };

test('a default frame reads back as the default factor', () => {
  const frame = defaultBoundaryFor(face);
  assert.equal(frameFactorOf(face, frame), DEFAULT_FRAME_FACTOR);
});

test('setting a factor gives a frame that reads back as that factor', () => {
  const frame = defaultBoundaryFor(face);
  for (const want of [1, 1.5, 4, 7.25, 24]) {
    const next = frameAtFactor(face, frame, want);
    assert.ok(Math.abs(frameFactorOf(face, next) - want) < 1e-9, `factor ${want} read back as ${frameFactorOf(face, next)}`);
  }
});

test('scaling is about the frame centre, so the children keep their place in it', () => {
  const frame = { x: 100, y: 50, width: 720, height: 480 };
  const centreX = frame.x + frame.width / 2;
  const centreY = frame.y + frame.height / 2;
  const next = frameAtFactor(face, frame, 6);
  assert.equal(next.x + next.width / 2, centreX);
  assert.equal(next.y + next.height / 2, centreY);
});

test('the factor is clamped at both ends', () => {
  const frame = defaultBoundaryFor(face);
  assert.equal(frameFactorOf(face, frameAtFactor(face, frame, 0.01)), MIN_FRAME_FACTOR);
  assert.equal(frameFactorOf(face, frameAtFactor(face, frame, 1000)), MAX_FRAME_FACTOR);
});

test('a bigger factor draws the level smaller on the face', () => {
  const frame = defaultBoundaryFor(face);
  const roomy = frameAtFactor(face, frame, 8);
  const tight = frameAtFactor(face, frame, 2);
  assert.ok(frameToFace(face, roomy).scale < frameToFace(face, tight).scale);
});

test('a block with more room inside opens only at a higher zoom', () => {
  // The point of the feature: some blocks have to be zoomed a long way in
  // before there is anything to see, and that follows from their own
  // scale rather than from one threshold for everything.
  const block = createBlock({ name: 'Subsystem' });
  block.geometry = { ...face };
  block.hasChildren = true;

  block.boundaryGeometry = normalizeFrame(face, frameAtFactor(face, defaultBoundaryFor(face), 2));
  assert.equal(isLevelOpen(block, 0.9), false, 'a 2x interior should still be closed below its threshold');
  assert.equal(isLevelOpen(block, 1.1), true, 'a 2x interior opens around zoom 1');

  block.boundaryGeometry = normalizeFrame(face, frameAtFactor(face, defaultBoundaryFor(face), 10));
  assert.equal(isLevelOpen(block, 1.1), false, 'a 10x interior is far from open at the same zoom');
  assert.equal(isLevelOpen(block, 5.1), true, 'a 10x interior opens around zoom 5');
});

test('scaling in then back out returns the frame it started from', () => {
  const frame = defaultBoundaryFor(face);
  let moved = frame;
  // The wheel applies a factor per tick; ten in and ten out must land
  // back where it began rather than drifting.
  for (let i = 0; i < 10; i += 1) moved = frameAtFactor(face, moved, frameFactorOf(face, moved) / 1.1);
  for (let i = 0; i < 10; i += 1) moved = frameAtFactor(face, moved, frameFactorOf(face, moved) * 1.1);
  assert.ok(Math.abs(frameFactorOf(face, moved) - DEFAULT_FRAME_FACTOR) < 1e-9);
});

test('a frame kept at the face aspect stays at it through a scale', () => {
  const frame = normalizeFrame(face, defaultBoundaryFor(face));
  const next = normalizeFrame(face, frameAtFactor(face, frame, 9));
  assert.ok(Math.abs(next.width / next.height - face.width / face.height) < 1e-9);
});

test('a frame whose aspect differs from its face does not creep as it is scaled', () => {
  // The live path normalizes on every wheel tick (a frame is grown to the
  // face's shape, never shrunk — see normalizeFrame), so a frame that
  // starts off-aspect must settle once and then scale cleanly rather than
  // growing a little more on each of a hundred ticks.
  let frame = normalizeFrame(face, { x: 0, y: 0, width: 1000, height: 1000 });
  const start = frameFactorOf(face, frame);
  const tick = (k) => { frame = normalizeFrame(face, frameAtFactor(face, frame, frameFactorOf(face, frame) * k)); };
  for (let i = 0; i < 8; i += 1) tick(1 / 1.1);
  assert.ok(frameFactorOf(face, frame) < start, 'scrolling in should reduce the factor');
  for (let i = 0; i < 8; i += 1) tick(1.1);
  assert.ok(Math.abs(frameFactorOf(face, frame) - start) < 1e-6, `came back to ${frameFactorOf(face, frame)}, not ${start}`);
  assert.ok(Math.abs(frame.width / frame.height - face.width / face.height) < 1e-9);
});

test('a scroll that has hit the end stays at the end', () => {
  let frame = defaultBoundaryFor(face);
  for (let i = 0; i < 200; i += 1) frame = frameAtFactor(face, frame, frameFactorOf(face, frame) * 1.1);
  assert.equal(frameFactorOf(face, frame), MAX_FRAME_FACTOR);
  for (let i = 0; i < 400; i += 1) frame = frameAtFactor(face, frame, frameFactorOf(face, frame) / 1.1);
  assert.equal(frameFactorOf(face, frame), MIN_FRAME_FACTOR);
});

test('a missing frame or face is handled rather than producing NaN', () => {
  assert.equal(frameFactorOf(null, null), DEFAULT_FRAME_FACTOR);
  assert.equal(frameFactorOf(face, { x: 0, y: 0, width: 0, height: 0 }), DEFAULT_FRAME_FACTOR);
  assert.equal(frameAtFactor(face, null, 4), null);
});
