import test from 'node:test';
import assert from 'node:assert/strict';
import { parseYaml, stringifyYaml } from '../src/model/yaml.js';
import { yamlTextToProjectData } from '../src/model/slimFormat.js';

// A key dropped into the middle of a sequence (the shape a hand edit or a
// bad merge produces) used to unwind the whole parse and hand back only
// what came before it -- whole sibling blocks, wires and the boundary
// silently gone. The reader must refuse such a file and say where.
const BROKEN = `name: demo
blocks:
  b1:
    name: first
    lines:
      - one
    link: https://example.com
      - two
    x: 0
  b2:
    name: second
    x: 100
`;

test('parseYaml throws on a line it cannot consume instead of truncating', () => {
  assert.throws(() => parseYaml(BROKEN), /unexpected indentation at line 8: - two/);
});

test('yamlTextToProjectData wraps the parse error so the importer surfaces it', () => {
  assert.throws(() => yamlTextToProjectData(BROKEN), /Not valid YAML \(unexpected indentation at line 8/);
});

test('a well-formed document still parses to the end', () => {
  const fixed = BROKEN.replace('    link: https://example.com\n      - two\n', '      - two\n    link: https://example.com\n');
  const slim = parseYaml(fixed);
  assert.deepEqual(Object.keys(slim.blocks), ['b1', 'b2']);
  assert.deepEqual(slim.blocks.b1.lines, ['one', 'two']);
  assert.equal(slim.blocks.b1.link, 'https://example.com');
});

test('the line number skips blank and comment-only lines correctly', () => {
  const text = '# header comment\n\nname: demo\nblocks:\n  b1:\n    name: x\n      bad: deeper\n';
  assert.throws(() => parseYaml(text), /at line 7: bad: deeper/);
});

test('round-trip of the writer output never trips the check', () => {
  const text = stringifyYaml({ name: 'demo', blocks: { b1: { name: 'x', lines: ['a', 'b'], props: { k: 'v' } } }, wires: [] });
  assert.deepEqual(parseYaml(text).blocks.b1.lines, ['a', 'b']);
});
