import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlock, hydrateBlock } from '../src/model/Block.js';
import { addPort, logicalPortOf, mergeSameNamedLogicalPort } from '../src/model/BlockDescription.js';
import { boundaryPortGroupOf, boundaryPortsOf } from '../src/model/levelView.js';

test('a module may expose several same-named inputs as one logical wire', () => {
  const raw = createBlock({ name: 'Module' });
  raw.logicalPorts = [
    { id: 'io_a', name: 'IN', direction: 'in', description: '' },
    { id: 'io_b', name: 'IN', direction: 'in', description: '' },
  ];
  raw.ports = [
    { id: 'pin_a', logicalId: 'io_a', side: 'left', offset: 20 },
    { id: 'pin_b', logicalId: 'io_b', side: 'left', offset: 60 },
  ];

  const block = hydrateBlock(raw);
  assert.equal(block.ports.length, 2, 'both physical sockets remain');
  assert.equal(block.logicalPorts.length, 1, 'they share one logical interface');
  assert.equal(block.ports[0].logicalId, block.ports[1].logicalId);
  assert.deepEqual(boundaryPortGroupOf(block, 'pin_a'), ['pin_a', 'pin_b']);
  assert.equal(boundaryPortsOf(block).length, 1, 'inside the module they are one wire');
});

test('renaming an input to an existing input name joins their wires', () => {
  const block = createBlock({ name: 'Module' });
  const first = addPort(block, { direction: 'in' });
  const second = addPort(block, { direction: 'in' });
  logicalPortOf(block, first).name = 'IN';
  const edited = logicalPortOf(block, second);
  edited.name = 'IN';

  assert.equal(mergeSameNamedLogicalPort(block, edited.id), true);
  assert.equal(block.logicalPorts.length, 1);
  assert.equal(first.logicalId, second.logicalId);
});

test('same names with different directions remain distinct interfaces', () => {
  const block = createBlock({ name: 'Module' });
  const input = addPort(block, { direction: 'in' });
  const output = addPort(block, { direction: 'out' });
  logicalPortOf(block, input).name = 'BUS';
  const edited = logicalPortOf(block, output);
  edited.name = 'BUS';

  assert.equal(mergeSameNamedLogicalPort(block, edited.id), false);
  assert.equal(block.logicalPorts.length, 2);
  assert.notEqual(input.logicalId, output.logicalId);
});
