import test from 'node:test';
import assert from 'node:assert/strict';
import { Project } from '../src/model/Project.js';
import { createBlock } from '../src/model/Block.js';
import { createConnection } from '../src/model/Connection.js';
import { addPort } from '../src/model/BlockDescription.js';
import { routeConnections } from '../src/render/SubPreviewRenderer.js';
import { getConnectionGeometry, beginRoutingPass, endRoutingPass } from '../src/render/ConnectionRenderer.js';

globalThis.document = {
  createElement: () => ({ getContext: () => ({ measureText: (text) => ({ width: String(text).length * 7 }) }) }),
};

// routeConnections memoizes each wire's route for the length of one pass
// (see ConnectionRenderer.beginRoutingPass — without it, routing a level
// of 57 wires took twenty seconds *per frame*, because working out one
// wire's route recomputed every earlier wire's, recursively).
//
// The whole point is that it is the same drawing, only arrived at once
// instead of exponentially many times. These compare a memoized pass
// against routes computed with no memo open at all.

// A grid of wired blocks with enough variety to exercise the interesting
// paths: wires that run straight, wires that share a trunk and have to fan
// out into channels, and long reaches that must detour around blocks.
function buildGrid(cols, rows, seed) {
  const project = new Project();
  const grid = [];
  let s = seed;
  const rnd = () => {
    s = (s * 1103515245 + 12345) & 0x7fffffff;
    return s / 0x7fffffff;
  };
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const block = createBlock({ name: `B${r}_${c}` });
      block.geometry = { x: c * 260 + Math.round(rnd() * 2) * 20, y: r * 160 + Math.round(rnd() * 2) * 20, width: 160, height: 90 };
      const out = addPort(block, { direction: 'out', side: 'right' }).id;
      const inp = addPort(block, { direction: 'in', side: 'left' }).id;
      const top = addPort(block, { direction: 'out', side: 'top' }).id;
      project.addBlock(block);
      grid.push({ block, out, inp, top });
    }
  }
  const wire = (a, aPort, b, bPort) =>
    project.addConnection(createConnection({ sourceBlockId: a.block.id, sourcePortId: aPort, targetBlockId: b.block.id, targetPortId: bPort }));
  for (let r = 0; r < rows; r += 1) {
    for (let c = 0; c < cols; c += 1) {
      const here = grid[r * cols + c];
      if (c + 1 < cols) wire(here, here.out, grid[r * cols + c + 1], grid[r * cols + c + 1].inp);
      if (c % 3 === 0 && r + 1 < rows) wire(here, here.top, grid[(r + 1) * cols + c], grid[(r + 1) * cols + c].inp);
      // A reach across several columns — the plain route runs through the
      // blocks between, so this one has to be routed around them.
      if (c === 0 && cols > 3) wire(here, here.top, grid[r * cols + 3], grid[r * cols + 3].inp);
    }
  }
  return project;
}

for (const [cols, rows, seed] of [[4, 3, 1], [5, 4, 7], [6, 4, 13], [4, 5, 29]]) {
  test(`a memoized routing pass draws the same routes as an unmemoized one (${cols}x${rows})`, () => {
    const project = buildGrid(cols, rows, seed);
    const routed = routeConnections(project, null, null, null);
    assert.ok(routed.length > 0, 'the fixture should produce wires to compare');
    for (const entry of routed) {
      // No pass is open out here, so this recomputes the route from
      // scratch the way it always did.
      const fresh = getConnectionGeometry(project, entry.connection, null, null);
      assert.deepEqual(entry.geometry, fresh, `route differs for ${entry.connection.id}`);
    }
  });
}

test('the memo does not outlive its pass, so a moved block re-routes', () => {
  const project = new Project();
  const a = createBlock({ name: 'A' });
  a.geometry = { x: 0, y: 0, width: 160, height: 90 };
  const aOut = addPort(a, { direction: 'out', side: 'right' }).id;
  project.addBlock(a);
  const b = createBlock({ name: 'B' });
  b.geometry = { x: 400, y: 0, width: 160, height: 90 };
  const bIn = addPort(b, { direction: 'in', side: 'left' }).id;
  project.addBlock(b);
  project.addConnection(createConnection({ sourceBlockId: a.id, sourcePortId: aOut, targetBlockId: b.id, targetPortId: bIn }));

  const before = routeConnections(project, null, null, null)[0].geometry;
  b.geometry = { ...b.geometry, y: 320 };
  const after = routeConnections(project, null, null, null)[0].geometry;
  assert.notDeepEqual(before.points, after.points);
});

test('routes are kept between frames while nothing moves', () => {
  // Panning, zooming and the flow animation cannot change a route, so a
  // redraw with nothing altered must not re-route the level.
  const project = buildGrid(4, 3, 11);
  const first = routeConnections(project, null, null, null);
  const second = routeConnections(project, null, null, null);
  assert.equal(second, first, 'an unchanged level should hand back the very same routes');
});

test('moving a pin re-routes the level', () => {
  const project = buildGrid(4, 3, 17);
  const before = routeConnections(project, null, null, null);
  const block = project.listBlocks()[0];
  block.ports[0].offset += 40;
  const after = routeConnections(project, null, null, null);
  assert.notEqual(after, before, 'a moved pin has to invalidate the kept routes');
});

test('hiding a wire mid-drag re-routes the level', () => {
  const project = buildGrid(4, 3, 23);
  const before = routeConnections(project, null, null, null);
  const dragged = project.listConnections()[0].id;
  const after = routeConnections(project, null, null, new Set([dragged]));
  assert.notEqual(after, before);
  assert.equal(after.length, before.length - 1, 'the hidden wire should be left out');
});

test('nested passes keep their own answers', () => {
  // Levels nest, so routing passes do too — an inner pass must not empty
  // the outer one's memo when it ends.
  const project = buildGrid(4, 3, 3);
  const connection = project.listConnections()[0];
  beginRoutingPass();
  const outer = getConnectionGeometry(project, connection, null, null);
  beginRoutingPass();
  getConnectionGeometry(project, connection, null, null);
  endRoutingPass();
  const stillOuter = getConnectionGeometry(project, connection, null, null);
  endRoutingPass();
  assert.equal(stillOuter, outer, 'the outer pass should still be serving its own memo');
});
