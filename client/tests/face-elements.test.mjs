import test from 'node:test';
import assert from 'node:assert/strict';
import { createBlock, hydrateBlock } from '../src/model/Block.js';
import { projectDataToYamlText, yamlTextToProjectData } from '../src/model/slimFormat.js';
import { Project } from '../src/model/Project.js';
import { faceBoxOf, getBlockTitleRect, getImageRect, getOpenHeaderRect, getTextStackRect, headerBoxOf } from '../src/render/BlockRenderer.js';

// What sits on a closed block's face is the person's to arrange: the text
// stack and the picture are boxes that can be dragged anywhere on the
// face and scaled from their corners (`titleBox`, `imageBox`, in world
// units from the block's corner). Resizing the block gives them more or
// less room and never resizes them; a box the face cannot hold is pulled
// in and, at worst, shrunk to fit — on screen only, the stored box stays.

globalThis.document = globalThis.document || {
  createElement: () => ({ getContext: () => ({ measureText: (text) => ({ width: String(text).length * 7 }) }) }),
};

function block(extra = {}) {
  const b = createBlock({ x: 100, y: 100, name: 'Robot' });
  b.geometry = { x: 100, y: 100, width: 200, height: 100 };
  return Object.assign(b, extra);
}

test('the text box sits where it was put, and stays inside the face', () => {
  const centred = getTextStackRect(block());
  assert.ok(Math.abs(centred.x + centred.width / 2 - 200) < 0.01, 'centred by default');
  assert.ok(Math.abs(centred.y + centred.height / 2 - 150) < 0.01);

  const placed = getTextStackRect(block({ titleBox: { x: 20, y: 10, w: 80, h: 30 } }));
  assert.deepEqual([placed.x, placed.y, placed.width, placed.height], [120, 110, 80, 30]);

  const hanging = getTextStackRect(block({ titleBox: { x: 180, y: 90, w: 80, h: 30 } }));
  assert.deepEqual([hanging.x, hanging.y, hanging.width, hanging.height], [220, 170, 80, 30], 'pulled in from the far corner');

  const title = getBlockTitleRect(block({ titleBox: { x: 20, y: 10, w: 80, h: 40 } }));
  assert.ok(title.y > 110 && title.y < 150, 'the title row is centred in the box top to bottom');
});

test('the picture is fitted into the face until a box says otherwise', () => {
  const img = { naturalWidth: 400, naturalHeight: 100 };
  const fitted = getImageRect(block(), img);
  assert.equal(fitted.width, 184, 'the face width less the margin');
  assert.equal(fitted.height, 46, 'the aspect ratio kept');
  assert.ok(Math.abs(fitted.y + fitted.height / 2 - 150) < 0.01, 'centred');
  assert.equal(getImageRect(block(), null), null, 'nothing to size from until it loads');

  const boxed = getImageRect(block({ imageBox: { x: 20, y: 20, w: 100, h: 50 } }), null);
  assert.deepEqual(boxed, { x: 120, y: 120, width: 100, height: 50 });
  assert.deepEqual(faceBoxOf(block(), boxed), { x: 20, y: 20, w: 100, h: 50 });
});

test('resizing the block does not resize what is on its face', () => {
  const b = block({ imageBox: { x: 20, y: 20, w: 100, h: 50 }, titleBox: { x: 10, y: 5, w: 60, h: 20 } });
  b.geometry = { x: 100, y: 100, width: 400, height: 300 };
  assert.deepEqual(getImageRect(b, null), { x: 120, y: 120, width: 100, height: 50 }, 'same size in a bigger block');
  const text = getTextStackRect(b);
  assert.deepEqual([text.x, text.y, text.width, text.height], [110, 105, 60, 20]);

  b.geometry = { x: 100, y: 100, width: 80, height: 60 };
  const squeezed = getImageRect(b, null);
  assert.equal(squeezed.width, 80, 'shrunk to what the face can hold');
  assert.equal(squeezed.height, 40, 'the aspect ratio kept while it is');
  assert.ok(squeezed.x >= 100 && squeezed.x + squeezed.width <= 180, 'and inside it');
  assert.deepEqual(b.imageBox, { x: 20, y: 20, w: 100, h: 50 }, 'the stored box is untouched');
});

test('titleBox and imageBox ride through JSON and YAML, and bad values are dropped', () => {
  const project = new Project({ name: 'Faces' });
  project.addBlock(block({ titleBox: { x: 10, y: 5, w: 60, h: 20 }, imageBox: { x: 20, y: 20, w: 100, h: 50 }, image: 'https://example.com/a.png' }));
  project.addBlock(block());
  const json = project.toJSON();
  const back = yamlTextToProjectData(projectDataToYamlText(json));
  const [a, b] = back.rootBlock.children.blocks;
  assert.deepEqual(a.titleBox, { x: 10, y: 5, w: 60, h: 20 });
  assert.deepEqual(a.imageBox, { x: 20, y: 20, w: 100, h: 50 });
  assert.equal('titleBox' in b, false);
  assert.equal('imageBox' in b, false);

  const hydrated = hydrateBlock({ ...json.rootBlock.children.blocks[0], titleBox: { x: 'no' }, imageBox: { x: 0, y: 0, w: 0, h: 1 } });
  assert.equal('titleBox' in hydrated, false);
  assert.equal('imageBox' in hydrated, false);
});

test('the open heading has a box of its own, in the level units, apart from the closed title box', () => {
  const b = block({ titleBox: { x: 10, y: 5, w: 60, h: 20 } });
  b.boundaryGeometry = { x: 0, y: 0, width: 600, height: 300 }; // three times the face: scale 1/3
  const along = getOpenHeaderRect(b);
  assert.equal(along.y, 100, 'along the top when nothing was dragged, whatever the closed title box says');

  b.headerBox = { x: 30, y: 60, w: 90, h: 30 };
  const placed = getOpenHeaderRect(b);
  assert.deepEqual([placed.x, placed.y, placed.width, placed.height], [110, 120, 30, 10], 'level units become face units through the frame scale');
  assert.deepEqual(headerBoxOf(b, placed), { x: 30, y: 60, w: 90, h: 30 });
  const closed = getTextStackRect(b);
  assert.deepEqual([closed.x, closed.y, closed.width, closed.height], [110, 105, 60, 20], 'the closed title box is untouched');

  b.headerBox = { x: 590, y: 290, w: 90, h: 30 };
  const pulled = getOpenHeaderRect(b);
  assert.deepEqual([pulled.x + pulled.width, pulled.y + pulled.height], [300, 200], 'kept inside the face');

  const project = new Project({ name: 'Headings' });
  project.addBlock(b);
  const back = yamlTextToProjectData(projectDataToYamlText(project.toJSON()));
  assert.deepEqual(back.rootBlock.children.blocks[0].headerBox, { x: 590, y: 290, w: 90, h: 30 });
});
