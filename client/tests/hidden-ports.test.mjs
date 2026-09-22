import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlock } from '../src/model/Block.js';
import { Project } from '../src/model/Project.js';
import { addPort, applyDescriptionText, isPortHidden, logicalPortOf } from '../src/model/BlockDescription.js';
import { getPortPosition, getPortSlotRect, socketsOf } from '../src/render/BlockRenderer.js';
import { hitTest } from '../src/interaction/HitTest.js';
import { projectDataToYamlText, yamlTextToProjectData } from '../src/model/slimFormat.js';

// Same minimal stand-in the sibling test uses: hit-testing measures the
// boundary frame's title, the one canvas call in this path.
globalThis.document = {
  createElement: () => ({ getContext: () => ({ measureText: (text) => ({ width: text.length * 7 }) }) }),
};

// A block with one ordinary input and one hidden one, matching what
// noditron's Data block ships (see its palette.js: `in` shown, `write`
// hidden). Returned alongside both pins so a test can aim at either.
function blockWithHiddenPort() {
  const project = new Project();
  const block = createBlock({ name: 'Data' });
  block.geometry = { x: 0, y: 0, width: 160, height: 90 };
  const shown = addPort(block, { direction: 'in' });
  logicalPortOf(block, shown).name = 'in';
  const hidden = addPort(block, { direction: 'in', hidden: true });
  logicalPortOf(block, hidden).name = 'write';
  project.addBlock(block);
  return { project, block, shown, hidden };
}

test('a port created hidden reports as hidden, an ordinary one does not', () => {
  const { block, shown, hidden } = blockWithHiddenPort();
  assert.equal(isPortHidden(block, shown), false);
  assert.equal(isPortHidden(block, hidden), true);
  // Hiding is about painting only — the interface itself is all still there.
  assert.equal(block.logicalPorts.length, 2);
  assert.equal(logicalPortOf(block, hidden).name, 'write');
});

test('an ordinary port carries no hidden field at all', () => {
  const { block, shown } = blockWithHiddenPort();
  assert.equal('hidden' in logicalPortOf(block, shown), false);
});

test('a hidden port cuts no socket into the block outline', () => {
  const { block, shown, hidden } = blockWithHiddenPort();
  const sockets = socketsOf(block);
  assert.equal(sockets.length, 1);
  const shownAt = getPortPosition(block, shown);
  assert.equal(sockets[0].x, shownAt.x);
  assert.equal(sockets[0].y, shownAt.y);
  // The hidden pin still holds a slot of its own, so revealing it later
  // puts it beside the shown one rather than on top of it.
  assert.notDeepEqual(getPortPosition(block, hidden), shownAt);
});

test('a hidden port is not hit-testable, the shown one beside it still is', () => {
  const { project, block, shown, hidden } = blockWithHiddenPort();

  const shownRect = getPortSlotRect(block, shown);
  const onShown = hitTest(project, shownRect.x + shownRect.width / 2, shownRect.y + shownRect.height / 2, null, null, null, 1);
  assert.equal(onShown?.type, 'port');
  assert.equal(onShown.portId, shown.id);

  const hiddenRect = getPortSlotRect(block, hidden);
  const onHidden = hitTest(project, hiddenRect.x + hiddenRect.width / 2, hiddenRect.y + hiddenRect.height / 2, null, null, null, 1);
  // Whatever is under that point, it is never the hidden pin — the space
  // it would have occupied belongs to the block body instead.
  assert.notEqual(onHidden?.portId, hidden.id);
});

test('hidden survives a YAML save and reload', () => {
  const { project } = blockWithHiddenPort();
  // The real save path (see model/localFile.js): out to YAML text and back
  // in through the reader, not just the in-memory slim object — `hidden`
  // has to actually be written to the document to survive it.
  const yaml = projectDataToYamlText(project.toJSON());
  assert.match(yaml, /hidden/);
  const reloaded = yamlTextToProjectData(yaml);
  const block = reloaded.rootBlock.children.blocks.find((b) => b.name === 'Data');
  const byName = (name) => block.ports.find((p) => logicalPortOf(block, p)?.name === name);
  assert.ok(byName('in') && byName('write'), 'both ports came back');
  assert.equal(isPortHidden(block, byName('in')), false);
  assert.equal(isPortHidden(block, byName('write')), true);
});

test('editing the description text leaves a hidden port hidden', () => {
  const { block } = blockWithHiddenPort();
  // The Description field says nothing about visibility, so re-applying it
  // must not quietly reveal a port (it keeps the existing logical port
  // object whenever direction+name still match).
  applyDescriptionText(block, 'Block: Data\n\ninput.in: \ninput.write: now with a description');
  const byName = (name) => block.ports.find((p) => logicalPortOf(block, p)?.name === name);
  assert.equal(isPortHidden(block, byName('in')), false);
  assert.equal(isPortHidden(block, byName('write')), true);
  assert.equal(logicalPortOf(block, byName('write')).description, 'now with a description');
});
