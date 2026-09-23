#!/usr/bin/env node
// nodigraph lint — checks a diagram the way a reader would see it, and
// reports what is wrong as data instead of pixels.
//
//   node client/tools/lint.mjs diagram.yaml [--json]
//
// The YAML is the slim authoring format (docs/LLM-AUTHORING.md); a saved
// project .json works too. Every level is walked with the same model and
// routing code the canvas uses, so a wire reported here runs exactly
// where the editor would draw it. Findings carry a severity: `error` is
// something a reader will misread (a wire through a block, two blocks
// on top of each other, a pin off its slots), `warn` is clutter (labels
// colliding, wires lying on top of each other), `info` is worth knowing
// (crossings, a frame that will be grown to its block's shape). Exit
// code 1 when there is at least one error. Made for the loop "generate,
// lint, fix coordinates, repeat" — no browser, no screenshot.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const src = (p) => new URL(`../src/${p}`, import.meta.url).href;

const { parseYaml } = await import(src('model/yaml.js'));
const { slimToProjectData } = await import(src('model/slimFormat.js'));
const { hydrateBlockTree } = await import(src('model/Block.js'));
const { LevelView } = await import(src('model/levelView.js'));
const { GRID_SIZE, getPortSlotOffsets, sideAxis } = await import(src('model/grid.js'));
const { frameToFace } = await import(src('model/levelGeometry.js'));
const { getConnectionGeometry, getConnectionLabelPosition } = await import(src('render/ConnectionRenderer.js'));
const { getPortPosition, isPluggedConnection } = await import(src('render/BlockRenderer.js'));
const { DEFAULT_BLOCK_COLOR } = await import(src('model/Block.js'));
const { obstaclesFor, pathHitsObstacles, segmentHitsRect } = await import(src('model/obstacleRoute.js'));

const args = process.argv.slice(2);
const json = args.includes('--json');
const file = args.find((a) => !a.startsWith('--'));
if (!file) {
  console.error('usage: node client/tools/lint.mjs <diagram.yaml|project.json> [--json]');
  process.exit(2);
}

const text = fs.readFileSync(file, 'utf8');
const slim = file.endsWith('.json') ? null : parseYaml(text);
const data = slim ? slimToProjectData(slim) : JSON.parse(text);
const root = hydrateBlockTree(data.rootBlock);

// Text widths without a canvas: an average glyph of the UI font is a
// little over half the font size wide. Good enough to flag collisions.
const PIN_LABEL_SIZE = 10;
const WIRE_LABEL_SIZE = 11;
const textWidth = (s, size) => (s ? s.length * size * 0.56 : 0);

const findings = [];
const report = (severity, level, code, message, where = null) => findings.push({ severity, level, code, message, ...(where ? { at: where } : {}) });

function contains(outer, inner) {
  return inner.x >= outer.x && inner.y >= outer.y && inner.x + inner.width <= outer.x + outer.width && inner.y + inner.height <= outer.y + outer.height;
}
function overlaps(a, b) {
  return a.x < b.x + b.width && b.x < a.x + a.width && a.y < b.y + b.height && b.y < a.y + a.height;
}
function labelOf(block) {
  return block.name || (block.kind === 'text' ? 'text' : 'unnamed block');
}
function portName(block, port) {
  return block.logicalPorts.find((lp) => lp.id === port.logicalId)?.name || '';
}

// Wire endpoints are checked on the slim source: the importer drops a wire
// whose block or port does not exist, so it would be invisible afterwards.
function checkSlimEndpoints(level, where) {
  const blocks = level.blocks || {};
  for (const wire of level.wires || []) {
    const spec = typeof wire === 'string' ? wire : `${wire.from} -> ${wire.to}`;
    const [from, to] = spec.split('->').map((s) => s.trim());
    for (const end of [from, to]) {
      if (!end) continue;
      const [b, p] = end.split('.');
      if (b === 'self') {
        if (p && !(level.ports || {})[p]) report('error', where, 'dangling-endpoint', `wire "${spec}": self has no port "${p}"`);
        continue;
      }
      if (!blocks[b]) report('error', where, 'dangling-endpoint', `wire "${spec}": no block "${b}" at this level`);
      else if (p && !(blocks[b].ports || {})[p]) report('error', where, 'dangling-endpoint', `wire "${spec}": block "${b}" has no port "${p}"`);
    }
  }
  for (const [key, block] of Object.entries(blocks)) {
    if (block && block.blocks) checkSlimEndpoints(block, `${where}/${key}`);
  }
}
if (slim) checkSlimEndpoints(slim, slim.name || 'root');

function checkLevel(container, where, isRoot) {
  const view = new LevelView(container);
  const blocks = view.listBlocks();
  const boundary = container.boundaryGeometry ? { block: container, geometry: container.boundaryGeometry } : null;

  // Frame shape.
  if (!isRoot && container.boundaryGeometry && container.geometry) {
    const face = container.geometry;
    const frame = container.boundaryGeometry;
    const a = face.width / face.height;
    const b = frame.width / frame.height;
    if (Math.abs(a - b) > 0.01) {
      report('info', where, 'frame-aspect', `frame ${frame.width}×${frame.height} is not the block's shape (${face.width}×${face.height}); it is grown to ${a > b ? `${frame.width}×${Math.round(frame.width / a)}` : `${Math.round(frame.height * a)}×${frame.height}`} on load`);
    }
    const t = frameToFace(face, frame);
    const k = 1 / t.scale;
    if (Math.abs(k - Math.round(k)) > 0.01 || Math.round(k) % 2 === 0) {
      report('info', where, 'frame-scale', `frame is ${k.toFixed(2)}× the block; an odd integer (3×, 5×) puts self pins on the child grid's own slots`);
    }
  }

  // Blocks: grid, ports, overlaps.
  for (const block of blocks) {
    const g = block.geometry;
    for (const key of ['x', 'y', 'width', 'height']) {
      if (g[key] % GRID_SIZE !== 0) report('error', where, 'off-grid', `"${labelOf(block)}" ${key}=${g[key]} is not a multiple of ${GRID_SIZE}`);
    }
    for (const port of block.ports) {
      const length = sideAxis(port.side) === 'x' ? g.height : g.width;
      const slots = getPortSlotOffsets(length);
      if (!slots.includes(port.offset)) report('error', where, 'port-off-slot', `"${labelOf(block)}" pin "${portName(block, port)}" offset ${port.offset} on ${port.side} is not one of ${slots.join(',')}`);
    }
    // Neighbouring pin labels on one side.
    const bySide = new Map();
    for (const port of block.ports) {
      const name = portName(block, port);
      if (!name) continue;
      if (!bySide.has(port.side)) bySide.set(port.side, []);
      bySide.get(port.side).push({ offset: port.offset, name });
    }
    for (const [side, list] of bySide) {
      list.sort((p, q) => p.offset - q.offset);
      for (let i = 1; i < list.length; i += 1) {
        const a = list[i - 1];
        const b = list[i];
        // Labels along a top/bottom edge sit side by side; along a
        // left/right edge they stack and only collide when on one slot.
        if (sideAxis(side) === 'y') {
          const need = (textWidth(a.name, PIN_LABEL_SIZE) + textWidth(b.name, PIN_LABEL_SIZE)) / 2 + 6;
          if (b.offset - a.offset < need) report('warn', where, 'pin-labels-collide', `"${labelOf(block)}" ${side}: pin labels "${a.name}" and "${b.name}" are ${b.offset - a.offset} apart, need about ${Math.ceil(need)}`);
        } else if (b.offset - a.offset < 24) {
          report('warn', where, 'pin-labels-collide', `"${labelOf(block)}" ${side}: pin labels "${a.name}" and "${b.name}" overlap`);
        }
      }
    }
  }
  // A child must not wear its container's own colour. A level is drawn on
  // its container's face (see docs/ARCHITECTURE.md), so these are not two
  // blocks side by side that happen to match — the child sits *inside* the
  // parent's outline, and painting it the same colour dissolves its own
  // edge into the frame around it. The nesting is the one thing the
  // picture has to show, and this is what hides it.
  //
  // Only a deliberate choice counts. The default border, a transparent
  // one, and a `kind: text` block (which has no box to speak of) are the
  // baseline look every diagram starts from, not something an author
  // picked, so matching there is left alone.
  const parentColor = container.style?.color;
  const parentFill = container.style?.fill;
  for (const block of blocks) {
    if (block.kind === 'text') continue;
    const color = block.style?.color;
    const fill = block.style?.fill;
    const sameColor = Boolean(color) && color === parentColor && color !== DEFAULT_BLOCK_COLOR && color !== 'transparent';
    const sameFill = Boolean(fill) && fill === parentFill && fill !== 'transparent';
    if (!sameColor && !sameFill) continue;
    const what = sameColor && sameFill
      ? `border ${color} and fill ${fill}`
      : sameColor
        ? `border colour ${color}`
        : `fill ${fill}`;
    report('warn', where, 'parent-colour', `"${labelOf(block)}" has its container "${labelOf(container)}"'s ${what}; give a child its own shade so its edge still reads inside the parent`);
  }

  for (let i = 0; i < blocks.length; i += 1) {
    for (let j = i + 1; j < blocks.length; j += 1) {
      const a = blocks[i];
      const b = blocks[j];
      if (!overlaps(a.geometry, b.geometry)) continue;
      if (contains(a.geometry, b.geometry) || contains(b.geometry, a.geometry)) continue;
      report('error', where, 'blocks-overlap', `"${labelOf(a)}" and "${labelOf(b)}" overlap`);
    }
  }

  // Wires.
  const routed = [];
  for (const connection of view.listConnections()) {
    // Two blocks plugged straight together have no wire to check.
    if (isPluggedConnection(view, connection)) continue;
    const geometry = getConnectionGeometry(view, connection, boundary);
    if (!geometry) {
      report('error', where, 'unroutable', `wire ${connection.id} could not be resolved`);
      continue;
    }
    const src_ = view.getBlock(connection.sourceBlockId);
    const dst = view.getBlock(connection.targetBlockId);
    const name = `${labelOf(src_)} → ${labelOf(dst)}${connection.label ? ` (${connection.label})` : ''}`;
    routed.push({ connection, geometry, name });
    const obstacles = obstaclesFor(blocks, connection.sourceBlockId, connection.targetBlockId, geometry.stubA, geometry.stubB);
    const inflated = obstacles.map((r) => ({ x: r.x - 2, y: r.y - 2, width: r.width + 4, height: r.height + 4 }));
    // From stub to stub: a stub collinear with its corner is dropped from
    // `points`, so the run between them is named explicitly.
    const free = [geometry.stubA, ...geometry.points.slice(1, -1), geometry.stubB];
    if (pathHitsObstacles(free, inflated)) {
      const hit = blocks.find((bl) => bl.id !== connection.sourceBlockId && bl.id !== connection.targetBlockId && inflated.some((r) => r.x + 2 === bl.geometry.x && r.y + 2 === bl.geometry.y && free.some((p, k) => k < free.length - 1 && segmentHitsRect(p, free[k + 1], r))));
      report('error', where, 'wire-through-block', `wire ${name} runs through "${hit ? labelOf(hit) : 'a block'}" and no detour was found`);
    }
  }

  // Wires on top of each other, and crossings.
  const segmentsOf = (g) => {
    const out = [];
    for (let i = 1; i < g.points.length - 2; i += 1) {
      const a = g.points[i];
      const b = g.points[i + 1];
      out.push(a.y === b.y ? { o: 'h', c: a.y, lo: Math.min(a.x, b.x), hi: Math.max(a.x, b.x) } : { o: 'v', c: a.x, lo: Math.min(a.y, b.y), hi: Math.max(a.y, b.y) });
    }
    return out;
  };
  let crossings = 0;
  for (let i = 0; i < routed.length; i += 1) {
    for (let j = i + 1; j < routed.length; j += 1) {
      const A = routed[i];
      const B = routed[j];
      const shared = A.connection.sourcePortId === B.connection.sourcePortId || A.connection.targetPortId === B.connection.targetPortId
        || A.connection.sourcePortId === B.connection.targetPortId || A.connection.targetPortId === B.connection.sourcePortId;
      for (const s of segmentsOf(A.geometry)) {
        for (const t of segmentsOf(B.geometry)) {
          if (s.o === t.o) {
            if (Math.abs(s.c - t.c) < 1 && Math.min(s.hi, t.hi) - Math.max(s.lo, t.lo) > 12 && !shared) {
              report('warn', where, 'wires-overlap', `wires ${A.name} and ${B.name} lie on top of each other (${s.o === 'h' ? 'y' : 'x'}=${s.c})`);
            }
          } else {
            const hseg = s.o === 'h' ? s : t;
            const vseg = s.o === 'h' ? t : s;
            if (vseg.c > hseg.lo && vseg.c < hseg.hi && hseg.c > vseg.lo && hseg.c < vseg.hi) crossings += 1;
          }
        }
      }
    }
  }
  if (crossings) report('info', where, 'wire-crossings', `${crossings} wire crossing${crossings === 1 ? '' : 's'}`);

  // Labels: wire labels against blocks, other wire labels and pin labels.
  const labelBoxes = [];
  for (const { connection, geometry, name } of routed) {
    if (!connection.label) continue;
    const pos = getConnectionLabelPosition(geometry);
    const w = textWidth(connection.label, WIRE_LABEL_SIZE) + 10;
    const box = { x: pos.x - w / 2, y: pos.y - 8, width: w, height: 16, name: `label "${connection.label}"`, wire: name };
    labelBoxes.push(box);
    for (const block of blocks) {
      if (block.id === connection.sourceBlockId || block.id === connection.targetBlockId) continue;
      if (contains(block.geometry, box)) continue;
      if (overlaps(block.geometry, box)) report('warn', where, 'label-on-block', `${box.name} of ${name} sits on "${labelOf(block)}"`);
    }
  }
  const pinLabelBoxes = [];
  for (const block of blocks) {
    for (const port of block.ports) {
      const pn = portName(block, port);
      if (!pn) continue;
      const pos = getPortPosition(block, port);
      const w = textWidth(pn, PIN_LABEL_SIZE);
      const box = sideAxis(port.side) === 'y'
        ? { x: pos.x - w / 2, y: port.side === 'top' ? pos.y + 6 : pos.y - 20, width: w, height: 14 }
        : { x: port.side === 'left' ? pos.x + 12 : pos.x - 12 - w, y: pos.y - 7, width: w, height: 14 };
      pinLabelBoxes.push({ ...box, name: `pin label "${pn}" of "${labelOf(block)}"` });
    }
  }
  for (let i = 0; i < labelBoxes.length; i += 1) {
    for (let j = i + 1; j < labelBoxes.length; j += 1) {
      if (overlaps(labelBoxes[i], labelBoxes[j])) report('warn', where, 'labels-collide', `${labelBoxes[i].name} and ${labelBoxes[j].name} overlap`);
    }
    for (const pin of pinLabelBoxes) {
      if (overlaps(labelBoxes[i], pin)) report('warn', where, 'labels-collide', `${labelBoxes[i].name} of ${labelBoxes[i].wire} overlaps ${pin.name}`);
    }
  }
  // Wires through pin labels of blocks they do not belong to.
  for (const { geometry, name, connection } of routed) {
    const free = [geometry.stubA, ...geometry.points.slice(1, -1), geometry.stubB];
    for (const pin of pinLabelBoxes) {
      for (let k = 0; k < free.length - 1; k += 1) {
        if (segmentHitsRect(free[k], free[k + 1], pin)) {
          report('warn', where, 'wire-through-label', `wire ${name} runs through ${pin.name}`);
          break;
        }
      }
    }
    void connection;
  }

  for (const block of blocks) {
    if (block.children?.blocks?.size) checkLevel(block, `${where}/${labelOf(block)}`, false);
  }
}

checkLevel(root, root.name || 'root', true);

const order = { error: 0, warn: 1, info: 2 };
findings.sort((a, b) => order[a.severity] - order[b.severity] || a.level.localeCompare(b.level));
if (json) {
  console.log(JSON.stringify(findings, null, 2));
} else {
  for (const f of findings) console.log(`${f.severity.padEnd(5)} ${f.level} · ${f.code}: ${f.message}`);
  const counts = { error: 0, warn: 0, info: 0 };
  for (const f of findings) counts[f.severity] += 1;
  console.log(`\n${counts.error} error(s), ${counts.warn} warning(s), ${counts.info} note(s) in ${path.basename(file)}`);
}
process.exit(findings.some((f) => f.severity === 'error') ? 1 : 0);
