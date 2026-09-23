import test from 'node:test';
import assert from 'node:assert/strict';
import { isWheelNotch } from '../src/interaction/InputRouter.js';

// A trackpad pinch reaches the page as a wheel event with ctrlKey set,
// indistinguishable from someone holding Ctrl and turning a wheel except
// by the shape of the numbers (see isWheelNotch). Ctrl+wheel scales a
// block's interior; a pinch must only ever zoom the camera. These are the
// event shapes the engines actually produce.

const wheel = (deltaY, { deltaMode = 0, wheelDeltaY } = {}) => ({
  deltaY,
  deltaMode,
  ...(wheelDeltaY === undefined ? {} : { wheelDeltaY }),
});

test('a mouse wheel notch in Chrome reads as a wheel', () => {
  // One notch: 100 pixels, reported alongside the legacy -120 step.
  assert.equal(isWheelNotch(wheel(100, { wheelDeltaY: -120 })), true);
  assert.equal(isWheelNotch(wheel(-100, { wheelDeltaY: 120 })), true);
  // Several notches at once, when the wheel is spun.
  assert.equal(isWheelNotch(wheel(300, { wheelDeltaY: -360 })), true);
});

test('a mouse wheel in Firefox reads as a wheel', () => {
  // Firefox scrolls a mouse wheel by lines and has no wheelDeltaY at all.
  assert.equal(isWheelNotch(wheel(3, { deltaMode: 1 })), true);
  assert.equal(isWheelNotch(wheel(-3, { deltaMode: 1 })), true);
  // Pages, on the rare setup configured that way.
  assert.equal(isWheelNotch(wheel(1, { deltaMode: 2 })), true);
});

test('a trackpad pinch does not read as a wheel', () => {
  // Small, often fractional steps, with a wheelDeltaY of exactly -3x the
  // delta rather than a multiple of 120.
  for (const delta of [-1, -2.5, -7, 1, 4.5, 12, 19.75]) {
    assert.equal(
      isWheelNotch(wheel(delta, { wheelDeltaY: -3 * delta })),
      false,
      `pinch step ${delta} was taken for a wheel`,
    );
  }
});

test('a trackpad pinch in Firefox does not read as a wheel', () => {
  // No wheelDeltaY, and pixel mode — so neither signal fires.
  assert.equal(isWheelNotch(wheel(-4.2)), false);
  assert.equal(isWheelNotch(wheel(9)), false);
});

test('a large pinch step is still not a wheel', () => {
  // The reason this is not a size threshold: a fast pinch can produce a
  // step as big as a wheel notch, and a pinch resizing a block would be
  // an edit to the document rather than a view change.
  assert.equal(isWheelNotch(wheel(100, { wheelDeltaY: -300 })), false);
  assert.equal(isWheelNotch(wheel(240, { wheelDeltaY: -720.5 })), false);
});

test('a wheelDeltaY that is near but not on the notch is not a wheel', () => {
  assert.equal(isWheelNotch(wheel(100, { wheelDeltaY: -119 })), false);
  assert.equal(isWheelNotch(wheel(100, { wheelDeltaY: -121 })), false);
});

test('a zero or missing wheelDeltaY in pixel mode is not a wheel', () => {
  assert.equal(isWheelNotch(wheel(0, { wheelDeltaY: 0 })), false);
  assert.equal(isWheelNotch(wheel(50)), false);
});
