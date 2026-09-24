import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlock } from '../src/model/Block.js';
import { Project } from '../src/model/Project.js';
import { Camera } from '../src/render/Camera.js';
import { SelectionManager } from '../src/interaction/SelectionManager.js';
import { WireSelection } from '../src/interaction/WireSelection.js';
import { DragStateMachine } from '../src/interaction/DragStateMachine.js';
import { hitTest } from '../src/interaction/HitTest.js';
import { addPort, logicalPortOf } from '../src/model/BlockDescription.js';
import { createConnection } from '../src/model/Connection.js';

globalThis.document = { createElement: () => ({ getContext: () => ({ measureText: text => ({ width: text.length * 7 }) }) }) };

function setup() {
  const project = new Project();
  const make = (name, x, direction) => {
    const block = createBlock({ name });
    block.geometry = { x, y: 0, width: 160, height: 90 };
    logicalPortOf(block, addPort(block, { direction })).name = direction;
    project.addBlock(block);
    return block;
  };
  const source = make('Source', 0, 'out');
  const sink = make('Sink', 400, 'in');
  const wire = project.addConnection(createConnection({
    sourceBlockId: source.id, sourcePortId: source.ports[0].id,
    targetBlockId: sink.id, targetPortId: sink.ports[0].id,
  }));
  const state = new DragStateMachine({
    project, camera: new Camera(), selection: new SelectionManager(), wireSelection: new WireSelection(),
    requestRender() {}, persist() {},
  });
  return { project, source, wire, state };
}

// The first point over the source block's wired port that hits `type`.
function pointHitting(project, block, type) {
  const g = block.geometry;
  for (let x = g.x - 40; x <= g.x + g.width + 40; x += 1) {
    for (let y = g.y - 40; y <= g.y + g.height + 40; y += 1) {
      const hit = hitTest(project, x, y);
      if (hit?.type === type && hit.blockId === block.id) return { point: { x, y }, hit };
    }
  }
  return null;
}

test('grabbing a wired connector picks up its wire; Ctrl draws a new one', () => {
  const { project, source, wire, state } = setup();
  const found = pointHitting(project, source, 'connector');
  assert.ok(found, 'the wired port shows a connector');
  assert.equal(found.hit.connectionId, wire.id);

  state.onPointerDown(found.point, found.point, {});
  assert.equal(state.context.redirectingConnectionId, wire.id);
  state.state = 'IDLE';

  state.onPointerDown(found.point, found.point, { ctrlKey: true });
  assert.equal(state.context.redirectingConnectionId, null);
  assert.equal(state.context.sourceBlockId, source.id);
  assert.equal(state.context.sourcePortId, source.ports[0].id);
});

test('Ctrl on a wired port body draws a new wire instead of moving the port', () => {
  const { project, source, state } = setup();
  const found = pointHitting(project, source, 'port');
  assert.ok(found, 'the port body is hittable');
  state.onPointerDown(found.point, found.point, { ctrlKey: true });
  assert.equal(state.context.redirectingConnectionId, null);
  assert.equal(state.context.sourcePortId, source.ports[0].id);
  assert.equal(state.context.portId, undefined, 'not a port drag');
});
