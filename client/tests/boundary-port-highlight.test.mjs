import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlock } from '../src/model/Block.js';
import { Project } from '../src/model/Project.js';
import { addPort, clonePort } from '../src/model/BlockDescription.js';

globalThis.document = {
  createElement: () => ({ getContext: () => ({ measureText: (text) => ({ width: text.length * 7 }) }) }),
};

test('an exterior clone selection highlights the logical port shown inside', async () => {
  const { buildPortHighlights } = await import('../src/render/SceneRenderer.js');
  const project = new Project();
  const board = createBlock({ name: 'esp32-S3' });
  board.hasChildren = true;
  board.children = { blocks: new Map(), connections: new Map() };
  const representative = addPort(board, { name: 'DI2', direction: 'out', side: 'left', offset: 0.25 });
  const exteriorClone = clonePort(board, representative, board.geometry.height);
  project.addBlock(board);

  const highlights = buildPortHighlights(project, board.id, exteriorClone.id, null, null);
  assert.ok(highlights.has(`${board.id}:${exteriorClone.id}`));
  assert.ok(highlights.has(`${board.id}:${representative.id}`), 'the collapsed interior slot is visibly selected');
});
