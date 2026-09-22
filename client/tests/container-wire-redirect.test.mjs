import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlock } from '../src/model/Block.js';
import { Project } from '../src/model/Project.js';
import { addPort, logicalPortOf } from '../src/model/BlockDescription.js';
import { createConnection } from '../src/model/Connection.js';

globalThis.document = {
  createElement: () => ({ getContext: () => ({ measureText: (text) => ({ width: text.length * 7 }) }) }),
};

// A container block (its port capped at one crossing wire) feeding one of a
// plain sink's two inputs — the shape of an ESP32 DevKit's USB pin wired to
// a block outside it.
function wiredContainer() {
  const project = new Project();
  const make = (name, ports, hasChildren = false) => {
    const block = createBlock({ name });
    block.hasChildren = hasChildren;
    if (hasChildren) block.children = { blocks: new Map(), connections: new Map() };
    for (const [direction, portName] of ports) {
      logicalPortOf(block, addPort(block, { direction })).name = portName;
    }
    project.addBlock(block);
    return block;
  };
  const host = make('Host', [['out', 'usb']], true);
  const sink = make('Sink', [['in', 'in'], ['in', 'write']]);
  const pin = (block, name) => block.ports.find((p) => logicalPortOf(block, p)?.name === name);
  const original = project.addConnection(
    createConnection({
      sourceBlockId: host.id, sourcePortId: pin(host, 'usb').id,
      targetBlockId: sink.id, targetPortId: pin(sink, 'in').id,
    }),
  );
  assert.ok(original, 'the first wire is made');
  return { project, host, sink, pin, original };
}

test('a wire on a container port can be redirected to another input', () => {
  const { project, host, sink, pin, original } = wiredContainer();
  // The drag completes by adding the replacement first and dropping the
  // original only once that lands (see DragStateMachine.tryCompleteConnection),
  // so the wire being moved is still present at this moment and must not
  // count against its own port's cap.
  const replacement = project.addConnection(
    createConnection({
      sourceBlockId: host.id, sourcePortId: pin(host, 'usb').id,
      targetBlockId: sink.id, targetPortId: pin(sink, 'write').id,
    }),
    { replacing: original.id },
  );
  assert.ok(replacement, 'the redirected wire is accepted');
  project.removeConnection(original.id);
  const left = project.listConnections();
  assert.equal(left.length, 1);
  assert.equal(left[0].targetPortId, pin(sink, 'write').id);
});

test('the one-wire cap still holds for a genuinely second wire', () => {
  const { project, host, sink, pin } = wiredContainer();
  // No `replacing`: this is a new wire alongside the existing one, which is
  // exactly what the cap exists to refuse.
  const second = project.addConnection(
    createConnection({
      sourceBlockId: host.id, sourcePortId: pin(host, 'usb').id,
      targetBlockId: sink.id, targetPortId: pin(sink, 'write').id,
    }),
  );
  assert.equal(second, null);
  assert.equal(project.listConnections().length, 1);
});

test('replacing an unrelated wire does not lift the cap', () => {
  const { project, host, sink, pin } = wiredContainer();
  // An id that is not the wire occupying the port must not excuse it.
  const second = project.addConnection(
    createConnection({
      sourceBlockId: host.id, sourcePortId: pin(host, 'usb').id,
      targetBlockId: sink.id, targetPortId: pin(sink, 'write').id,
    }),
    { replacing: 'conn_somethingelse' },
  );
  assert.equal(second, null);
});
