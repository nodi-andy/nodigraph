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

// One drag on a port does one thing (see DragStateMachine's DRAGGING_PORT):
// moved to another slot first, it only moves and its type never changes in
// that drag; pulled across its edge first, it stays in its slot and the
// pull sets its type — into the block an input, out of it an output, the
// pointer back in the middle on the edge both (no direction, the circle).

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
  // What onPointerDown sets for a grab of the port's body.
  sm.state = 'draggingPort';
  sm.context = { blockId: block.id, portId: port.id, isBoundary: false, portMode: null, startSide: port.side, startOffset: port.offset };
  const drag = (...points) => { for (const [x, y] of points) sm.onPointerMove({ x, y }, { x, y }); };
  return { block, port, sm, drag, direction: () => logicalPortOf(block, port).direction ?? null };
}

test('the drag state is the one onPointerDown uses for a port', async () => {
  const src = (await import('node:fs')).readFileSync(new URL('../src/interaction/DragStateMachine.js', import.meta.url), 'utf8');
  assert.match(src, /DRAGGING_PORT: 'draggingPort'/);
});

test('pulled into the block a port becomes an input, out of it an output, back on the edge both', () => {
  const { port, drag, direction } = setup('out');
  drag([120 + 40, 180]);
  assert.equal(direction(), 'in');
  drag([120 - 40, 180]);
  assert.equal(direction(), 'out');
  drag([120 + 5, 180]);
  assert.equal(direction(), null, 'the middle is both');
  assert.equal(port.side, 'left');
  assert.equal(port.offset, 60, 'a type change never moves the slot');
});

test('a type change keeps its slot even when the pointer wanders along the edge', () => {
  const { port, drag, direction } = setup('in');
  drag([120 - 40, 180], [120 - 40, 230], [120 - 40, 140]);
  assert.equal(direction(), 'out');
  assert.equal(port.offset, 60);
});

test('a moved port never changes type in that drag, however far it is pulled', () => {
  const { port, drag, direction } = setup('in');
  drag([120 + 5, 220]);
  assert.notEqual(port.offset, 60, 'it moved');
  drag([120 - 60, 220], [120 + 60, 220]);
  assert.equal(direction(), 'in');
});

test('a small wobble across the edge changes nothing', () => {
  const { port, drag, direction } = setup('in');
  drag([120 - 20, 180], [120 + 10, 180]);
  assert.equal(direction(), 'in');
  assert.equal(port.offset, 60);
});

test('the description follows a type change', () => {
  const { block, drag } = setup('in');
  const before = block.description;
  drag([120 - 60, 180]);
  assert.notEqual(block.description, before);
  assert.match(block.description, /output/);
});
