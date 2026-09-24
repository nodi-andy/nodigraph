import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlock } from '../src/model/Block.js';
import { Project } from '../src/model/Project.js';
import { Camera } from '../src/render/Camera.js';
import { SelectionManager } from '../src/interaction/SelectionManager.js';
import { WireSelection } from '../src/interaction/WireSelection.js';
import { DragStateMachine } from '../src/interaction/DragStateMachine.js';
import { hitTest } from '../src/interaction/HitTest.js';
import { resolveFocus } from '../src/interaction/LevelFocus.js';
import { getBlockTitleRect } from '../src/render/BlockRenderer.js';
import { isLevelOpen, toggleForcedContent } from '../src/render/SubPreviewRenderer.js';
import { projectDataToSlim, slimToProjectData } from '../src/model/slimFormat.js';
import { createNameEditor } from '../src/ui/NameEditor.js';

globalThis.document = { createElement: () => ({ getContext: () => ({ measureText: text => ({ width: text.length * 7 }) }) }) };

function setup() {
  const project = new Project();
  const block = createBlock({ name: 'Container' });
  block.geometry = { x: 0, y: 0, width: 300, height: 200 };
  block.hasChildren = true;
  project.addBlock(block);
  const camera = new Camera();
  const selection = new SelectionManager();
  const renamed = [];
  const state = new DragStateMachine({
    project, camera, selection, wireSelection: new WireSelection(), requestRender() {}, persist() {},
    onRequestRename: id => renamed.push(id), onToggleContent: () => toggleForcedContent(block),
    onEnterBlock() { assert.fail('double-click must not enter or zoom'); },
  });
  return { project, block, camera, selection, state, renamed };
}
const centre = r => ({ x: r.x + r.width / 2, y: r.y + r.height / 2 });

test('title bounds follow alignment and exclude subtitle and the rest of the face', () => {
  const { block, project } = setup();
  for (const titlePos of ['top', 'center', 'bottom']) {
    for (const titleAlign of ['left', 'center', 'right']) {
      block.style = { titlePos, titleAlign };
      block.subtitle = 'Not the title';
      const rect = getBlockTitleRect(block);
      assert.ok(rect.height < block.geometry.height / 4);
      const point = centre(rect);
      assert.equal(hitTest(project, point.x, point.y).title, true);
      assert.equal(hitTest(project, point.x, rect.y + rect.height + 3).title, false);
    }
  }
});

test('clicking a selected body never renames; a title click does', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { block, selection, state, renamed } = setup();
  selection.select(block.id);
  state.onPointerDown({ x: 70, y: 65 }, { x: 70, y: 65 }, {});
  state.onPointerUp({ x: 70, y: 65 });
  t.mock.timers.tick(1000);
  assert.deepEqual(renamed, []);
  const point = centre(getBlockTitleRect(block));
  state.onPointerDown(point, point, {});
  state.onPointerUp(point);
  t.mock.timers.tick(1000);
  assert.deepEqual(renamed, [block.id]);
});

test('body double-click forces the interior at low zoom and toggles back to automatic', () => {
  const { block, camera, state, renamed } = setup();
  camera.zoom = 0.1;
  const before = { ...camera };
  assert.equal(isLevelOpen(block, camera.zoom), false);
  state.onDoubleClick({ x: 70, y: 65 });
  assert.equal(isLevelOpen(block, camera.zoom), true);
  assert.deepEqual({ ...camera }, before);
  state.onDoubleClick({ x: 70, y: 65 });
  assert.equal(isLevelOpen(block, camera.zoom), false);
  assert.deepEqual(renamed, []);
});

test('title double-click renames without toggling contents', () => {
  const { block, state, renamed } = setup();
  state.onDoubleClick(centre(getBlockTitleRect(block)));
  assert.deepEqual(renamed, [block.id]);
  assert.equal(block.style.forceShowContent, undefined);
});

test('dragging the title moves the block without opening rename', t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const { block, state, renamed } = setup();
  const point = centre(getBlockTitleRect(block));
  state.onPointerDown(point, point, {});
  const end = { x: point.x + 80, y: point.y + 80 };
  state.onPointerMove(end, end);
  state.onPointerUp(end);
  t.mock.timers.tick(1000);
  assert.deepEqual(renamed, []);
  assert.notEqual(block.geometry.x, 0);
});

test('the editor uses the supplied title rectangle even at small zoom', () => {
  const before = globalThis.document;
  const input = { style: {}, addEventListener() {}, focus() {}, select() {} };
  globalThis.document = { createElement: () => input, body: { appendChild() {} } };
  try {
    const editor = createNameEditor({ onCommit() {} });
    editor.open('block', 'Title', { x: 10, y: 20, width: 40, height: 12, fontSize: 9 });
    assert.equal(input.style.width, '40px');
    assert.equal(input.style.height, '12px');
    assert.equal(input.style.fontSize, '9px');
  } finally { globalThis.document = before; }
});

test('open heading remains a title target rather than descending into children', () => {
  const { block, project, camera } = setup();
  toggleForcedContent(block);
  const rect = getBlockTitleRect(block, { open: true });
  assert.ok(rect.y < 10 && rect.height < 10);
  const point = centre(rect);
  assert.equal(hitTest(project, point.x, point.y).title, true);
  assert.equal(resolveFocus(project, camera, point, { width: 300, height: 200 }), null);
});

test('force-show survives project and slim-format round trips', () => {
  const { block, project } = setup();
  toggleForcedContent(block);
  const restored = Project.fromJSON(project.toJSON()).listBlocks()[0];
  assert.equal(isLevelOpen(restored, 0.01), true);
  const slimRestored = Project.fromJSON(slimToProjectData(projectDataToSlim(project.toJSON()))).listBlocks()[0];
  assert.equal(isLevelOpen(slimRestored, 0.01), true);
});
