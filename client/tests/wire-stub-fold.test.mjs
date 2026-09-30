import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlock } from '../src/model/Block.js';
import { Project } from '../src/model/Project.js';
import { addPort, logicalPortOf } from '../src/model/BlockDescription.js';
import { createConnection } from '../src/model/Connection.js';
import { getConnectionGeometry, beginRoutingPass, endRoutingPass } from '../src/render/ConnectionRenderer.js';
import { getBlockTitleRect } from '../src/render/BlockRenderer.js';
import { WIRE_STUB_LENGTH } from '../src/model/grid.js';

globalThis.document = {
  createElement: () => ({ getContext: () => ({ measureText: (text) => ({ width: text.length * 7 }) }) }),
};

// A wire from a frame pin on the bottom edge, seen from inside, to a
// child's bottom pin a little way above it — the child sits up and to
// the right, so the wire has to climb, cross, and climb again. The two
// stubs point at each other and overlap: the pins are closer than two
// stubs' length.
function frameToChild(gapAbovePin) {
  const project = new Project();
  const container = createBlock({ name: 'Rack' });
  container.geometry = { x: 0, y: 0, width: 520, height: 440 };
  const framePin = addPort(container, { direction: 'in', side: 'bottom', offset: 100 });
  logicalPortOf(container, framePin).name = '24 V in';
  project.addBlock(container);
  project.enterBlock(container.id);
  const child = project.createDefaultBlock(400, 0, 'block');
  child.name = 'Aardvark';
  child.geometry = { x: 400, y: 0, width: 200, height: 120 };
  const childPin = addPort(child, { direction: 'in', side: 'bottom', offset: 100 });
  const connection = createConnection({ sourceBlockId: container.id, sourcePortId: framePin.id, targetBlockId: child.id, targetPortId: childPin.id });
  project.addConnection(connection);
  const boundary = { block: container, geometry: container.boundaryGeometry };
  const geometryOf = () => {
    beginRoutingPass();
    try {
      return getConnectionGeometry(project, connection, boundary, null);
    } finally {
      endRoutingPass();
    }
  };
  // Place the child so its pin sits `gapAbovePin` above the frame pin.
  const first = geometryOf();
  const dy = first.sourcePos.y - gapAbovePin - first.targetPos.y;
  child.geometry = { ...child.geometry, y: child.geometry.y + dy };
  return { project, connection, geometryOf, container, child };
}

// Every step of the path moves toward the far end on its axis: no piece
// runs back the way an earlier one came.
function assertNoFold(points) {
  for (const axis of ['x', 'y']) {
    let dir = 0;
    for (let i = 1; i < points.length; i += 1) {
      const d = Math.sign(points[i][axis] - points[i - 1][axis]);
      if (d === 0) continue;
      assert.ok(dir === 0 || d === dir, `path folds on ${axis} at point ${i}: ${JSON.stringify(points)}`);
      dir = d;
    }
  }
}

test('pins facing each other closer than two stubs: one trunk between them, both stubs shortened, no detour', () => {
  const { geometryOf } = frameToChild(43);
  const g = geometryOf();
  assert.equal(g.avoided, false, 'no obstacle detour');
  assert.equal(g.coords.length, 1);
  assertNoFold(g.points);
  // The trunk lies between the two pins, and each stub reaches it.
  const trunk = g.coords[0];
  assert.ok(trunk < g.sourcePos.y && trunk > g.targetPos.y, `trunk ${trunk} between ${g.targetPos.y} and ${g.sourcePos.y}`);
  assert.equal(g.stubA.y, trunk);
  assert.equal(g.stubB.y, trunk);
  assert.deepEqual(g.points.map((p) => [p.x, p.y]), [
    [g.sourcePos.x, g.sourcePos.y],
    [g.sourcePos.x, trunk],
    [g.targetPos.x, trunk],
    [g.targetPos.x, g.targetPos.y],
  ]);
});

test('with room for both stubs and the keep-out, nothing changes', () => {
  const { geometryOf } = frameToChild(200);
  const g = geometryOf();
  assert.equal(g.avoided, false);
  assertNoFold(g.points);
  assert.equal(Math.abs(g.stubA.y - g.sourcePos.y), WIRE_STUB_LENGTH);
  assert.equal(Math.abs(g.stubB.y - g.targetPos.y), WIRE_STUB_LENGTH);
});

test('a heading at the top starts below the names of the pins on the top edge', () => {
  const plain = createBlock({ name: 'Board' });
  plain.geometry = { x: 0, y: 0, width: 200, height: 120 };
  plain.subtitle = 'rev B';
  const withPins = createBlock({ name: 'Board' });
  withPins.geometry = { x: 0, y: 0, width: 200, height: 120 };
  withPins.subtitle = 'rev B';
  const pin = addPort(withPins, { direction: 'in', side: 'top', offset: 20 });
  logicalPortOf(withPins, pin).name = 'CAN';
  const a = getBlockTitleRect(plain);
  const b = getBlockTitleRect(withPins);
  assert.ok(b.y > a.y + 12, `heading moved down past the pin names: ${a.y} -> ${b.y}`);
  // A pin without a name reaches nothing into the face.
  logicalPortOf(withPins, pin).name = '';
  assert.equal(getBlockTitleRect(withPins).y, a.y);
});
