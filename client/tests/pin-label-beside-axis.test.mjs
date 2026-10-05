import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlock } from '../src/model/Block.js';
import { addPort, logicalPortOf } from '../src/model/BlockDescription.js';
import { drawBlockPorts, drawBoundaryPins, getBoundaryWirePosition, getPortPosition, SOCKET_HALF_OUTER } from '../src/render/BlockRenderer.js';

// A wire leaves a pin straight along the pin's axis — so a name drawn on
// that axis was crossed out by its own wire wherever wires reach a pin
// from inside the face: a frame pin seen from inside, or an open block's
// pins with the level's wires arriving at them. There the name sits
// beside the axis instead: above it for a left or right pin, to its right
// for a top or bottom pin, and in both cases clear of the socket's own
// half-width. A closed block has no wires inside and keeps the plain,
// centred name.

globalThis.window = globalThis.window || {};

function recordingCtx() {
  const calls = { fillText: [] };
  return {
    calls,
    fillText(text, x, y) { calls.fillText.push({ text, x, y, align: this.textAlign, baseline: this.textBaseline }); },
    arcTo() {}, fill() {}, fillRect() {}, save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {},
    translate() {}, rotate() {}, arc() {}, setLineDash() {}, strokeRect() {}, clip() {}, rect() {},
    measureText: (text) => ({ width: text.length * 7 }),
    globalAlpha: 1, lineDashOffset: 0, lineJoin: '', lineCap: '', strokeStyle: '', fillStyle: '', lineWidth: 0, font: '', textAlign: '', textBaseline: '',
  };
}

function blockWithPins() {
  const block = createBlock({ name: 'Board' });
  block.geometry = { x: 0, y: 0, width: 300, height: 200 };
  block.boundaryGeometry = { x: 0, y: 0, width: 300, height: 200 };
  const left = addPort(block, { direction: 'in', side: 'left' });
  logicalPortOf(block, left).name = 'LEFT';
  const top = addPort(block, { direction: 'in', side: 'top' });
  logicalPortOf(block, top).name = 'TOP';
  return { block, left, top };
}

test('a closed block centres each name on its pin', () => {
  const { block, left, top } = blockWithPins();
  const ctx = recordingCtx();
  drawBlockPorts(ctx, block);
  const byText = new Map(ctx.calls.fillText.map((call) => [call.text, call]));
  const leftLabel = byText.get('LEFT');
  assert.equal(leftLabel.baseline, 'middle');
  assert.equal(leftLabel.y, getPortPosition(block, left).y);
  const topLabel = byText.get('TOP');
  assert.equal(topLabel.align, 'center');
  assert.equal(topLabel.x, getPortPosition(block, top).x);
});

test('with its level shown, a left pin\'s name sits above the pin axis, a top pin\'s to the right of it', () => {
  const { block, left, top } = blockWithPins();
  const ctx = recordingCtx();
  drawBlockPorts(ctx, block, { labelsBeside: 1 });
  const byText = new Map(ctx.calls.fillText.map((call) => [call.text, call]));

  const leftPos = getPortPosition(block, left);
  const leftLabel = byText.get('LEFT');
  assert.equal(leftLabel.baseline, 'bottom');
  assert.ok(leftLabel.y <= leftPos.y - SOCKET_HALF_OUTER, `bottom of the text (${leftLabel.y}) is above the socket's half-width`);
  assert.ok(leftLabel.x > leftPos.x, 'starts inward of the pin');

  const topPos = getPortPosition(block, top);
  const topLabel = byText.get('TOP');
  assert.equal(topLabel.align, 'left');
  assert.ok(topLabel.x >= topPos.x + SOCKET_HALF_OUTER, `starts (${topLabel.x}) right of the socket's half-width`);
  assert.ok(topLabel.y > topPos.y, 'starts inward of the pin');
});

test('a frame pin seen from inside keeps its name off the wire that reaches it', () => {
  const { block, left } = blockWithPins();
  const ctx = recordingCtx();
  const labels = new Map([[left.id, [{ id: 'w1', rank: 0, label: '', color: '#2f6fed' }]]]);
  drawBoundaryPins(ctx, block, block.boundaryGeometry, [left], { boundaryWireLabels: labels });
  const label = ctx.calls.fillText.find((call) => call.text === 'LEFT');
  const pos = getBoundaryWirePosition(block, left, 0);
  assert.ok(label.y <= pos.y - SOCKET_HALF_OUTER, 'above the axis the wire runs along');
});

test('with its level shown, only a pin a wire reaches from inside moves its name off the axis', () => {
  const { block, left, top } = blockWithPins();
  const ctx = recordingCtx();
  // What SubPreviewRenderer passes for an open block whose level wires
  // only the left pin: the top pin has nothing on its axis to cross out.
  drawBlockPorts(ctx, block, { labelsBeside: new Map([[left.id, 1]]) });
  const byText = new Map(ctx.calls.fillText.map((call) => [call.text, call]));
  assert.equal(byText.get('LEFT').baseline, 'bottom');
  const topLabel = byText.get('TOP');
  assert.equal(topLabel.align, 'center');
  assert.equal(topLabel.x, getPortPosition(block, top).x);
});
