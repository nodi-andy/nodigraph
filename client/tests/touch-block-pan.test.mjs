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

// On touch, a finger on a block that is not selected pans the canvas; a
// tap selects it, and only then does a drag move it (see DragStateMachine
// onPointerDown's body branch). A mouse press on a block grabs it at once.

function setup() {
  const project = new Project({ name: 'P' });
  const block = project.createDefaultBlock(100, 100, 'block');
  block.geometry = { x: 120, y: 120, width: 200, height: 120 }; // on the 40px grid, so a drop snaps back to itself
  const camera = new Camera();
  camera.zoom = 1;
  camera.offsetX = 0;
  camera.offsetY = 0;
  const selection = new SelectionManager();
  const wireSelection = new WireSelection();
  const sm = new DragStateMachine({
    camera,
    project,
    selection,
    wireSelection,
    requestRender: () => {},
    persist: () => {},
  });
  // Screen == world with this camera.
  const at = (x, y) => [{ x, y }, { x, y }];
  return { project, block, camera, selection, sm, at };
}

test('touch-dragging an unselected block pans the camera and leaves the block put', () => {
  const { block, camera, selection, sm, at } = setup();
  const [screen, world] = at(200, 160);
  sm.onPointerDown(screen, world, { pointerType: 'touch', button: 0 });
  sm.onPointerMove({ x: 260, y: 200 }, { x: 260, y: 200 });
  sm.onPointerUp({ x: 260, y: 200 });
  assert.deepEqual([block.geometry.x, block.geometry.y], [120, 120]);
  assert.deepEqual([camera.offsetX, camera.offsetY], [60, 40]);
  assert.equal(selection.count, 0, 'a swipe does not select');
});

test('a tap selects the block, and the next touch drag moves it', () => {
  const { block, camera, selection, sm, at } = setup();
  const [screen, world] = at(200, 160);
  sm.onPointerDown(screen, world, { pointerType: 'touch', button: 0 });
  sm.onPointerMove({ x: 203, y: 161 }, { x: 203, y: 161 }); // finger jitter
  sm.onPointerUp({ x: 203, y: 161 });
  assert.ok(selection.isSelected(block.id));
  assert.deepEqual([camera.offsetX, camera.offsetY], [3, 1]);

  sm.onPointerDown({ x: 200, y: 160 }, { x: 200, y: 160 }, { pointerType: 'touch', button: 0 });
  sm.onPointerMove({ x: 280, y: 200 }, { x: 280, y: 200 });
  sm.onPointerUp({ x: 280, y: 200 });
  assert.deepEqual([block.geometry.x, block.geometry.y], [200, 160]);
  assert.deepEqual([camera.offsetX, camera.offsetY], [3, 1], 'the camera stays');
});

test('a mouse press on an unselected block still grabs it', () => {
  const { block, camera, selection, sm, at } = setup();
  const [screen, world] = at(200, 160);
  sm.onPointerDown(screen, world, { pointerType: 'mouse', button: 0 });
  sm.onPointerMove({ x: 280, y: 200 }, { x: 280, y: 200 });
  sm.onPointerUp({ x: 280, y: 200 });
  assert.ok(selection.isSelected(block.id));
  assert.deepEqual([block.geometry.x, block.geometry.y], [200, 160]);
  assert.deepEqual([camera.offsetX, camera.offsetY], [0, 0]);
});
