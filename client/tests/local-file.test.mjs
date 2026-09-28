import test from 'node:test';
import assert from 'node:assert/strict';
import { formatForFileName, projectFileText, supportsFileSystemAccess } from '../src/model/localFile.js';
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
