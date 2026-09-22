import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlock } from '../src/model/Block.js';
import { Project } from '../src/model/Project.js';
import { hasSubArchitecture } from '../src/render/BlockRenderer.js';
import { isLevelEditable } from '../src/render/SubPreviewRenderer.js';
import { resolveFocus } from '../src/interaction/LevelFocus.js';

// Hit-testing measures the frame title, away from the body hit tested here.
// Supply only that canvas operation so navigation can run without a browser.
globalThis.document = {
  createElement: () => ({ getContext: () => ({ measureText: (text) => ({ width: text.length * 7 }) }) }),
};

function savedEmptyContainer() {
  const project = new Project();
  const block = createBlock({ name: 'Device' });
  block.geometry = { x: 0, y: 0, width: 640, height: 640 };
  block.boundaryGeometry = { x: 0, y: 0, width: 1920, height: 1920 };
  block.hasChildren = true;
  block.children = { blocks: new Map(), connections: new Map() };
  project.addBlock(block);
  return Project.fromJSON(project.toJSON());
}

const camera = { zoom: 3, offsetX: -460, offsetY: -560 };
const screen = { x: 500, y: 400 };
const viewport = { width: 1000, height: 800 };

test('a declared empty container stays editable after save and reload', () => {
  const project = savedEmptyContainer();
  const block = project.listBlocks()[0];
  assert.equal(block.children, null, 'empty children are omitted by serialization');
  assert.equal(hasSubArchitecture(block), true);
  assert.equal(isLevelEditable(block, camera.zoom), true);
  const focus = resolveFocus(project, camera, screen, viewport);
  assert.deepEqual(focus?.path, [block.id]);
  project.path = focus.path;
  project.addBlock(createBlock({ name: 'First component' }));
  assert.equal(block.children.blocks.size, 1);
  assert.equal(project.rootBlock.children.blocks.size, 1);
});

test('empty containers still obey host entry restrictions', () => {
  const project = savedEmptyContainer();
  let checked = false;
  const focus = resolveFocus(project, camera, screen, viewport, {
    canEnter: () => { checked = true; return false; },
  });
  assert.equal(checked, true);
  assert.equal(focus, null);
});

test('an ordinary leaf does not become an empty zoom target', () => {
  const project = savedEmptyContainer();
  project.listBlocks()[0].hasChildren = false;
  assert.equal(hasSubArchitecture(project.listBlocks()[0]), false);
  assert.equal(resolveFocus(project, camera, screen, viewport), null);
});

test('an interior with only boundary wires still counts as a level', () => {
  const block = createBlock({ name: 'Pass-through' });
  block.children = { blocks: new Map(), connections: new Map([['wire', {}]]) };
  assert.equal(hasSubArchitecture(block), true);
});
