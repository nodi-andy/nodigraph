import test from 'node:test';
import assert from 'node:assert/strict';
import { formatForFileName, projectFileText, sameProjectText, supportsFileSystemAccess } from '../src/model/localFile.js';
import { Project } from '../src/model/Project.js';

globalThis.document = globalThis.document || {
  createElement: () => ({ getContext: () => ({ measureText: (text) => ({ width: String(text).length * 7 }) }) }),
};

// A file keeps the format its name says: "Save to <file>" writes YAML into
// a .yaml and JSON into everything else (see writeProjectToHandle).
test('the format follows the file name', () => {
  assert.equal(formatForFileName('gravis.nodigraph.yaml'), 'yaml');
  assert.equal(formatForFileName('GRAVIS.YML'), 'yaml');
  assert.equal(formatForFileName('gravis.nodigraph.json'), 'json');
  assert.equal(formatForFileName('gravis'), 'json');
  assert.equal(formatForFileName(undefined), 'json');
});

test('the file text is the same project in either format', () => {
  const project = new Project({ name: 'Product' });
  project.createDefaultBlock(0, 0, 'block').name = 'A';
  const json = JSON.parse(projectFileText(project, 'json'));
  assert.equal(json.rootBlock.name, 'Product');
  assert.equal(json.rootBlock.children.blocks[0].name, 'A');
  const yaml = projectFileText(project, 'yaml');
  assert.match(yaml, /Product/);
  assert.match(yaml, /\bA\b/);
});

test('no picker outside a browser', () => {
  assert.equal(supportsFileSystemAccess(), false);
});

// The snapshot remembered beside the open file (see rememberFileHandle)
// is compared with the diagram after a reload, which came back through
// storage with its keys in another order — that must still count as the
// same diagram, and a real change must not.
test('a remembered snapshot matches the same diagram with keys reordered', () => {
  const a = JSON.stringify({ rootBlock: { id: 'r', ports: [{ id: 'p', side: 'left', offset: 20 }] } });
  const b = JSON.stringify({ rootBlock: { ports: [{ side: 'left', id: 'p', offset: 20 }], id: 'r' } });
  const c = JSON.stringify({ rootBlock: { ports: [{ side: 'left', id: 'p', offset: 60 }], id: 'r' } });
  assert.equal(sameProjectText(a, b), true);
  assert.equal(sameProjectText(a, c), false);
  assert.equal(sameProjectText(a, null), false);
  assert.equal(sameProjectText('not json', 'not json'), true);
});
