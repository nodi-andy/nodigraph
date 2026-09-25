import test from 'node:test';
import assert from 'node:assert/strict';
import { Project } from '../src/model/Project.js';
import { exportTargetFor } from '../src/model/exportTarget.js';

globalThis.document = globalThis.document || {
  createElement: () => ({ getContext: () => ({ measureText: (text) => ({ width: String(text).length * 7 }) }) }),
};

function makeProject() {
  const project = new Project({ name: 'Product' });
  const outer = project.createDefaultBlock(0, 0, 'block');
  outer.name = 'Outer';
  project.enterBlock(outer.id);
  const inner = project.createDefaultBlock(10, 10, 'block');
  inner.name = 'Inner';
  project.exitToDepth(0);
  return { project, outer, inner };
}

test('exporting all is the live project itself', () => {
  const { project } = makeProject();
  const target = exportTargetFor(project, null);
  assert.equal(target.name, 'Product');
  assert.equal(target.dataProject, project);
  assert.equal(target.figureProject, project);
});

test('a block exports as a project rooted at that block, with its contents', () => {
  const { project, outer, inner } = makeProject();
  const target = exportTargetFor(project, outer.id);
  assert.equal(target.name, 'Outer');
  const json = target.dataProject.toJSON();
  assert.equal(json.rootBlock.name, 'Outer');
  assert.equal(json.rootBlock.children.blocks.length, 1);
  assert.equal(json.rootBlock.children.blocks[0].id, inner.id);
  assert.deepEqual(target.path, [outer.id]);
  // The figure is the block's interior: the level holding Inner.
  assert.equal(target.figureProject.listBlocks()[0].id, inner.id);
});

test('exporting a block leaves the live diagram untouched', () => {
  const { project, outer } = makeProject();
  const target = exportTargetFor(project, outer.id);
  target.dataProject.rootBlock.name = 'Renamed';
  target.dataProject.listBlocks()[0].name = 'Renamed';
  assert.equal(outer.name, 'Outer');
  assert.equal(outer.children.blocks.values().next().value.name, 'Inner');
});

test('a block with nothing inside is drawn as itself, not as an empty level', () => {
  const { project, outer, inner } = makeProject();
  project.enterBlock(outer.id);
  const target = exportTargetFor(project, inner.id);
  const drawn = target.figureProject.listBlocks();
  assert.equal(drawn.length, 1);
  assert.equal(drawn[0].name, 'Inner');
  assert.deepEqual(target.path, [outer.id]);
});

test('the container selected from inside exports its own level', () => {
  const { project, outer } = makeProject();
  project.enterBlock(outer.id);
  const target = exportTargetFor(project, outer.id);
  assert.equal(target.name, 'Outer');
  assert.deepEqual(target.path, [outer.id]);
});
