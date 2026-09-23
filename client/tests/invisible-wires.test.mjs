import test from 'node:test';
import assert from 'node:assert/strict';
import { isWireShown } from '../src/render/SubPreviewRenderer.js';
import { projectDataToYamlText, yamlTextToProjectData } from '../src/model/slimFormat.js';
import { Project } from '../src/model/Project.js';
import { createBlock } from '../src/model/Block.js';
import { createConnection } from '../src/model/Connection.js';
import { addPort, logicalPortOf } from '../src/model/BlockDescription.js';

globalThis.document = {
  createElement: () => ({ getContext: () => ({ measureText: (text) => ({ width: String(text).length * 7 }) }) }),
};

// A wire set invisible stays in the diagram but off the picture until one
// of its own pins is hovered — for the connections that are real and
// would otherwise bury everything (a clock into every block, a ground).

const wire = { id: 'c1', sourceBlockId: 'a', sourcePortId: 'pa', targetBlockId: 'b', targetPortId: 'pb', invisible: true };
const plain = { id: 'c2', sourceBlockId: 'a', sourcePortId: 'pa', targetBlockId: 'b', targetPortId: 'pb' };
const selection = (...ids) => ({ isSelected: (id) => ids.includes(id) });

test('an ordinary wire is always shown', () => {
  assert.equal(isWireShown(plain), true);
  assert.equal(isWireShown(plain, null, selection()), true);
});

test('an invisible wire is not shown with nothing hovered', () => {
  assert.equal(isWireShown(wire), false);
  assert.equal(isWireShown(wire, null, selection()), false);
});

test('hovering either of its own pins shows it', () => {
  assert.equal(isWireShown(wire, { blockId: 'a', portId: 'pa' }), true);
  assert.equal(isWireShown(wire, { blockId: 'b', portId: 'pb' }), true);
});

test('hovering someone else’s pin does not show it', () => {
  assert.equal(isWireShown(wire, { blockId: 'c', portId: 'pc' }), false);
  // The right block but the wrong pin on it, and the reverse.
  assert.equal(isWireShown(wire, { blockId: 'a', portId: 'pb' }), false);
  assert.equal(isWireShown(wire, { blockId: 'b', portId: 'pa' }), false);
});

test('a selected invisible wire is shown whatever the pointer is doing', () => {
  // The Inspector is open on it, so it has to be on screen to be edited.
  assert.equal(isWireShown(wire, null, selection('c1')), true);
  assert.equal(isWireShown(wire, { blockId: 'c', portId: 'pc' }, selection('c1')), true);
  assert.equal(isWireShown(wire, null, selection('other')), false);
});

test('invisible survives a YAML save and reload', () => {
  const project = new Project();
  const a = createBlock({ name: 'A' });
  a.geometry = { x: 0, y: 0, width: 160, height: 90 };
  const aOut = addPort(a, { direction: 'out', side: 'right' });
  logicalPortOf(a, aOut).name = 'clk';
  project.addBlock(a);
  const b = createBlock({ name: 'B' });
  b.geometry = { x: 320, y: 0, width: 160, height: 90 };
  const bIn = addPort(b, { direction: 'in', side: 'left' });
  logicalPortOf(b, bIn).name = 'clk';
  project.addBlock(b);
  const conn = createConnection({ sourceBlockId: a.id, sourcePortId: aOut.id, targetBlockId: b.id, targetPortId: bIn.id });
  conn.invisible = true;
  conn.label = 'clock';
  project.addConnection(conn);

  const yaml = projectDataToYamlText(project.toJSON());
  assert.match(yaml, /invisible: true/);

  const reloaded = yamlTextToProjectData(yaml);
  const back = reloaded.rootBlock.children.connections[0];
  assert.equal(back.invisible, true);
  assert.equal(back.label, 'clock');
});

test('an ordinary wire carries no invisible field at all', () => {
  const project = new Project();
  const a = createBlock({ name: 'A' });
  a.geometry = { x: 0, y: 0, width: 160, height: 90 };
  const aOut = addPort(a, { direction: 'out', side: 'right' });
  project.addBlock(a);
  const b = createBlock({ name: 'B' });
  b.geometry = { x: 320, y: 0, width: 160, height: 90 };
  const bIn = addPort(b, { direction: 'in', side: 'left' });
  project.addBlock(b);
  project.addConnection(createConnection({ sourceBlockId: a.id, sourcePortId: aOut.id, targetBlockId: b.id, targetPortId: bIn.id }));

  const yaml = projectDataToYamlText(project.toJSON());
  assert.doesNotMatch(yaml, /invisible/);
  const reloaded = yamlTextToProjectData(yaml);
  assert.equal('invisible' in reloaded.rootBlock.children.connections[0], false);
});
