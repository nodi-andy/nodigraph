import test from 'node:test';
import assert from 'node:assert/strict';

globalThis.document = globalThis.document || {
  createElement: () => ({ getContext: () => ({ measureText: (text) => ({ width: String(text).length * 7 }) }) }),
};
globalThis.window = globalThis.window || {};

const { Project } = await import('../src/model/Project.js');
const { Camera } = await import('../src/render/Camera.js');
const { SelectionManager } = await import('../src/interaction/SelectionManager.js');
const { WireSelection } = await import('../src/interaction/WireSelection.js');
const { DragStateMachine } = await import('../src/interaction/DragStateMachine.js');
const { addPort, logicalPortOf } = await import('../src/model/BlockDescription.js');

// A port pulled across its edge changes direction: into the block makes
// it an input, out of it an output. Along the edge it only moves (see
// DragStateMachine.flipPortByPull).

function setup(direction) {
  const project = new Project({ name: 'P' });
  const block = project.createDefaultBlock(120, 120, 'block');
  block.geometry = { x: 120, y: 120, width: 200, height: 120 };
  const port = addPort(block, { direction, side: 'left', offset: 60 });
  const sm = new DragStateMachine({
    camera: new Camera(),
    project,
    selection: new SelectionManager(),
    wireSelection: new WireSelection(),
    requestRender: () => {},
    persist: () => {},
  });
  return { block, port, sm, geometry: block.geometry };
}

test('pulled into the block, a port becomes an input; pulled out, an output', () => {
  const { block, port, sm, geometry } = setup('out');
  assert.equal(sm.flipPortByPull(block, port, geometry, 'left', { x: 120 + 40, y: 180 }), true);
  assert.equal(logicalPortOf(block, port).direction, 'in');
  assert.equal(sm.flipPortByPull(block, port, geometry, 'left', { x: 120 - 40, y: 180 }), true);
  assert.equal(logicalPortOf(block, port).direction, 'out');
});

test('a slide along the edge, or a small wobble across it, leaves the direction alone', () => {
  const { block, port, sm, geometry } = setup('in');
  assert.equal(sm.flipPortByPull(block, port, geometry, 'left', { x: 120 + 10, y: 220 }), false);
  assert.equal(sm.flipPortByPull(block, port, geometry, 'left', { x: 120 - 20, y: 140 }), false);
  assert.equal(logicalPortOf(block, port).direction, 'in');
});

test('pulling the way it already faces changes nothing, and the description follows a flip', () => {
  const { block, port, sm, geometry } = setup('in');
  assert.equal(sm.flipPortByPull(block, port, geometry, 'left', { x: 120 + 60, y: 180 }), false);
  const before = block.description;
  assert.equal(sm.flipPortByPull(block, port, geometry, 'left', { x: 120 - 60, y: 180 }), true);
  assert.notEqual(block.description, before);
  assert.match(block.description, /output/);
});

test('an undirected port takes the direction it is pulled toward', () => {
  const { block, port, sm, geometry } = setup(null);
  assert.equal(sm.flipPortByPull(block, port, geometry, 'right', { x: 320 + 50, y: 180 }), true);
  assert.equal(logicalPortOf(block, port).direction, 'out');
});
