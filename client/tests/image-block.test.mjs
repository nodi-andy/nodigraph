import test from 'node:test';
import assert from 'node:assert/strict';
import { projectDataToYamlText, yamlTextToProjectData } from '../src/model/slimFormat.js';
import { Project } from '../src/model/Project.js';
import { createBlock, hydrateBlock } from '../src/model/Block.js';
import { imageSourceOf, isRelativeImageRef } from '../src/render/imageCache.js';
import { readFolderImageUrl, relativeImageRef } from '../src/model/localFile.js';

// An image block is an ordinary block with an `image`: an http(s) URL, or
// a path relative to the folder the diagram file is in (see
// localFile.js's relativeImageRef). The field rides through JSON and YAML
// like the other optional ones, and the picture is read from the folder.

globalThis.document = globalThis.document || {
  createElement: () => ({ getContext: () => ({ measureText: (text) => ({ width: String(text).length * 7 }) }) }),
};

test('image rides through JSON and YAML, and is absent when empty', () => {
  const project = new Project({ name: 'Pictures' });
  const pictured = createBlock({ x: 0, y: 0, name: 'Robot' });
  pictured.image = 'photos/robot.png';
  project.addBlock(pictured);
  project.addBlock(createBlock({ x: 200, y: 0, name: 'Plain' }));

  const json = project.toJSON();
  const [a, b] = json.rootBlock.children.blocks;
  assert.equal(a.image, 'photos/robot.png');
  assert.equal('image' in b, false);

  const back = yamlTextToProjectData(projectDataToYamlText(json));
  const [ya, yb] = back.rootBlock.children.blocks;
  assert.equal(ya.image, 'photos/robot.png');
  assert.equal(ya.name, 'Robot', 'the name stays the label');
  assert.equal('image' in yb, false);

  const hydrated = hydrateBlock({ ...a, image: '   ' });
  assert.equal('image' in hydrated, false, 'a blank image is dropped');
});

test('what fills a block: its image first, else a name that is an image URL', () => {
  assert.equal(imageSourceOf({ name: 'Robot', image: 'photos/robot.png' }), 'photos/robot.png');
  assert.equal(imageSourceOf({ name: 'https://example.com/a.png' }), 'https://example.com/a.png');
  assert.equal(imageSourceOf({ name: 'Robot' }), null);
  assert.equal(isRelativeImageRef('photos/robot.png'), true);
  assert.equal(isRelativeImageRef('https://example.com/a.png'), false);
  assert.equal(isRelativeImageRef('data:image/png;base64,AAAA'), false);
});

// A stand-in for the File System Access directory handle: nested
// { name: file | { ... } } maps, with the calls the helpers make.
function fakeFolder(tree) {
  const dir = {
    resolveTo: null,
    written: {},
    async resolve(handle) {
      return dir.resolveTo && handle === dir.resolveTo.handle ? dir.resolveTo.path : null;
    },
    async queryPermission() {
      return 'granted';
    },
    async getDirectoryHandle(name) {
      const sub = tree[name];
      if (!sub || sub.file) throw new Error('NotFound');
      return fakeFolder(sub);
    },
    async getFileHandle(name, { create = false } = {}) {
      const entry = tree[name];
      if (entry?.file) return { getFile: async () => entry.file };
      if (!create) throw new Error('NotFound');
      tree[name] = { file: { name } };
      return {
        createWritable: async () => ({
          write: async (bytes) => {
            dir.written[name] = bytes;
          },
          close: async () => {},
        }),
      };
    },
  };
  return dir;
}

test('a picture is read from the diagram folder by its relative path', async () => {
  const urls = [];
  globalThis.URL.createObjectURL = (file) => {
    urls.push(file.name);
    return `blob:${file.name}`;
  };
  const folder = fakeFolder({ photos: { 'robot.png': { file: { name: 'robot.png' } } } });
  assert.equal(await readFolderImageUrl(folder, 'photos/robot.png'), 'blob:robot.png');
  assert.equal(await readFolderImageUrl(folder, 'photos/missing.png'), null);
  assert.equal(await readFolderImageUrl(folder, '../outside.png'), null, 'never climbs out of the folder');
  assert.deepEqual(urls, ['robot.png']);
});

test('a picture inside the folder is referenced by its path, one outside is imported under its name', async () => {
  const folder = fakeFolder({ 'robot.png': { file: { name: 'robot.png' } } });
  const insideHandle = {};
  folder.resolveTo = { handle: insideHandle, path: ['photos', 'cam.png'] };
  assert.equal(await relativeImageRef(folder, insideHandle, { name: 'cam.png' }), 'photos/cam.png');

  const bytes = new ArrayBuffer(4);
  const outside = { name: 'robot.png', arrayBuffer: async () => bytes };
  const ref = await relativeImageRef(folder, {}, outside);
  assert.equal(ref, 'robot-2.png', 'a taken name gets a number');
  assert.equal(folder.written['robot-2.png'], bytes, 'the file was copied into the folder');
});
