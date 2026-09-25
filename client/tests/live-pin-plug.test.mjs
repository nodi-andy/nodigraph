import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlock } from '../src/model/Block.js';
import { addPort, logicalPortOf } from '../src/model/BlockDescription.js';
import { drawBlockPorts, drawBoundaryPins } from '../src/render/BlockRenderer.js';

// A host can colour a pin by its live state (window.nodigraphPortColor —
// noditron does it for a board's inputs). That colour used to be drawn as
// a plug, grip and all, on the exterior side of a pin nothing was wired to
// out there — while the wire itself arrived from inside the level. A plug
// is the wire at the pin, so it is drawn only where a wire is; a live
// colour on an unwired pin fills the socket and nothing more.

globalThis.window = globalThis.window || {};

// The grip is the one shape drawn with arcTo (see gripPath); the socket's
// filling and the port label are fill and fillText.
function recordingCtx() {
  const calls = { arcTo: 0, fill: 0, fillText: [] };
  return {
    calls,
    arcTo: () => { calls.arcTo += 1; },
    fill: () => { calls.fill += 1; },
    fillText: (text) => calls.fillText.push(text),
    fillRect() {}, save() {}, restore() {}, beginPath() {}, moveTo() {}, lineTo() {}, closePath() {}, stroke() {},
    translate() {}, rotate() {}, arc() {}, setLineDash() {}, strokeRect() {}, clip() {}, rect() {},
    measureText: (text) => ({ width: text.length * 7 }),
    globalAlpha: 1, lineDashOffset: 0, lineJoin: '', lineCap: '', strokeStyle: '', fillStyle: '', lineWidth: 0, font: '', textAlign: '', textBaseline: '',
  };
}

function boardWithInput() {
  const block = createBlock({ name: 'Board' });
  block.geometry = { x: 0, y: 0, width: 300, height: 200 };
  block.boundaryGeometry = { x: 0, y: 0, width: 300, height: 200 };
  const port = addPort(block, { direction: 'in' });
  logicalPortOf(block, port).name = 'DI1';
  return { block, port };
}

test('a live-coloured pin with no wire on the exterior fills its socket but grows no grip', () => {
  const { block } = boardWithInput();
  window.nodigraphPortColor = () => '#64748b';
  try {
    const ctx = recordingCtx();
    drawBlockPorts(ctx, block, { pinWires: new Map() });
    assert.equal(ctx.calls.arcTo, 0, 'no grip without a wire');
    assert.ok(ctx.calls.fill >= 1, 'the socket is filled in the live colour');
  } finally {
    delete window.nodigraphPortColor;
  }
});

test('the same pin grows its grip once a wire is on it out there', () => {
  const { block, port } = boardWithInput();
  window.nodigraphPortColor = () => '#3ecf5d';
  try {
    const ctx = recordingCtx();
    drawBlockPorts(ctx, block, { pinWires: new Map([[port.id, '#2f6fed']]) });
    assert.ok(ctx.calls.arcTo > 0, 'a wired pin has a grip');
  } finally {
    delete window.nodigraphPortColor;
  }
});

test('a level drawn inside its block can leave the pin names to the exterior', () => {
  const { block, port } = boardWithInput();
  const labels = new Map([[port.id, [{ id: 'w1', rank: 0, label: '', color: '#2f6fed' }]]]);
  const named = recordingCtx();
  drawBoundaryPins(named, block, block.boundaryGeometry, [port], { boundaryWireLabels: labels });
  assert.deepEqual(named.calls.fillText, ['DI1']);
  const unnamed = recordingCtx();
  drawBoundaryPins(unnamed, block, block.boundaryGeometry, [port], { boundaryWireLabels: labels, portNames: false });
  assert.deepEqual(unnamed.calls.fillText, []);
});
