// Places and sizes the blocks of a level that came in without coordinates —
// what the slim YAML format (see slimFormat.js) hands over when an author,
// human or LLM, describes *what* connects to what and leaves *where* to
// the editor. Runs on the raw project data (Project.fromJSON's shape,
// arrays not Maps) so the same code serves the browser import, the paste
// handler and the command-line tools under client/tools/.
//
// The result is meant to be edited by hand afterwards, so it is tidy
// rather than tight:
//   - every block is as small as its text needs, and no smaller than the
//     editor's own default, so every string on it is fully visible;
//   - blocks are a column apart horizontally (room for a wire label and a
//     detour lane) and two cells apart vertically;
//   - wires flow left to right: a level's inputs (blocks fed by the
//     enclosing block's own ports, or by nothing) form the left column,
//     its outputs the right one, and the most connected block anchors the
//     middle. Blocks that are wired to nothing — captions, notes, panels
//     — go in a row above the flow, then below it.
// Nested levels are laid out first, bottom up: a container's face grows
// until its frame (an odd multiple of the face, see levelGeometry.js) has
// room for the level inside, so nothing inside is ever clipped by the
// frame it is drawn in.
//
// Layout is purely geometric. It never adds, removes or reconnects
// anything; the router (see obstacleRoute.js) still decides where each
// wire runs, so a wire that skips a column paves itself around whatever is
// in the way, and crossings remain crossings.
import { GRID_SIZE, getPortSlotOffsets, sideAxis } from './grid.js';
import { DEFAULT_BLOCK_WIDTH, DEFAULT_BLOCK_HEIGHT, DEFAULT_TEXT_HEIGHT } from './Block.js';

const G = GRID_SIZE;
// Horizontal distance between two columns of blocks: three cells hold a
// short wire label and leave a lane either side of it.
const COLUMN_GAP = 3 * G;
// Vertical distance between two blocks of one column: two cells, so a wire
// that has to pass between them has a lane of its own.
const ROW_GAP = 2 * G;
// Clearance between a level's content and the frame it is drawn in: the
// band the wires to the frame's own pins run in, wide enough for a wire
// to get around a block that sits right in front of a frame pin.
const FRAME_MARGIN = 3 * G;
// A container's face stops growing here; past it the frame factor grows
// instead (5×, 7×, …) so a deep tree does not push its top level to
// screen-filling sizes.
const FACE_CAP = { width: 12 * G, height: 8 * G };
const MAX_FRAME_FACTOR = 9;
// Mirrors BlockRenderer's text metrics (TEXT_PAD_X/Y, SUBTITLE_SCALE,
// LINE_SCALE and the row heights in blockTextRows). No canvas here, so
// glyph widths are estimated per character class — a little generous, so
// the estimate errs towards a block that is wide enough.
const TEXT_PAD_X = 10;
const TEXT_PAD_Y = 8;
const SUBTITLE_SCALE = 0.85;
const LINE_SCALE = 0.8;
const WIRE_LABEL_SIZE = 11;

const ceilGrid = (v) => Math.ceil(v / G - 1e-9) * G;
const snapGrid = (v) => Math.round(v / G) * G;

// ---------- text metrics ----------

export function estimateTextWidth(text, size, { bold = false, mono = false } = {}) {
  let units = 0;
  for (const ch of String(text)) {
    if (mono) units += 0.62;
    else if (/[A-Z]/.test(ch)) units += 0.68;
    else if (/[0-9]/.test(ch)) units += 0.58;
    else if (/[ .,:;'`|!iIljt]/.test(ch)) units += 0.32;
    else if (/[a-z]/.test(ch)) units += 0.54;
    else units += 0.62;
  }
  return units * size * (bold ? 1.06 : 1);
}

function isImageUrl(name) {
  return /^https?:\/\/\S+\.(png|jpe?g|gif|svg|webp|avif)(\?\S*)?$/i.test(name || '');
}

// The same rows blockTextRows draws, with an estimated width each.
function textRowsOf(block) {
  const style = block.style || {};
  const size = style.fontSize || 13;
  const subtitleSize = Math.max(8, Math.round(size * SUBTITLE_SCALE));
  const lineSize = Math.max(8, Math.round(size * LINE_SCALE));
  const rows = [];
  if (block.name && !isImageUrl(block.name)) rows.push({ width: estimateTextWidth(block.name, size, { bold: !!style.bold }), height: size * 1.3 });
  if (typeof block.subtitle === 'string' && block.subtitle !== '') rows.push({ width: estimateTextWidth(block.subtitle, subtitleSize), height: subtitleSize * 1.3 });
  for (const line of block.lines || []) {
    if (line === null || line === undefined || line === '') continue;
    rows.push({ width: estimateTextWidth(line, lineSize, { mono: true }), height: lineSize * 1.4 });
  }
  return rows;
}

// How many slots a side needs for `n` pins spaced one slot apart where
// possible: at least the pins themselves.
function pinCounts(block) {
  const counts = { left: 0, right: 0, top: 0, bottom: 0 };
  for (const pin of block.ports || []) counts[pin.side] = (counts[pin.side] || 0) + 1;
  return counts;
}

function pinName(block, pin) {
  return (block.logicalPorts || []).find((lp) => lp.id === pin.logicalId)?.name || '';
}

// Where the block's text stack sits, in the block's own y, for a block of
// height `h` — the same placement drawBlockText makes. A pin's label is
// drawn inside the block beside the pin, so a labelled pin on the left or
// right edge must not sit level with the text.
function textStackOf(block, h) {
  const rows = textRowsOf(block);
  const total = rows.reduce((s, r) => s + r.height, 0);
  if (!total) return null;
  const style = block.style || {};
  const hasExtra = rows.length > 1 || !block.name;
  const pos = ['top', 'center', 'bottom'].includes(style.titlePos) ? style.titlePos : hasExtra ? 'top' : 'center';
  const top = pos === 'top' ? TEXT_PAD_Y : pos === 'bottom' ? h - TEXT_PAD_Y - total : h / 2 - total / 2;
  return { top, bottom: top + total };
}

// Half the height of a pin label: a slot this close to the text stack
// would overlap it.
const PIN_LABEL_HALF = 8;

// The slots on a left/right side, of a block `h` tall, where a labelled
// pin stays clear of the text.
function labelSlots(block, h) {
  const slots = getPortSlotOffsets(h);
  const stack = textStackOf(block, h);
  if (!stack) return slots;
  return slots.filter((s) => s + PIN_LABEL_HALF <= stack.top || s - PIN_LABEL_HALF >= stack.bottom);
}

// The smallest size whose text is fully visible and whose pins all fit,
// never below the editor's own defaults, never below what the author
// asked for. Multiples of the grid.
export function measureBlock(block) {
  const isText = block.kind === 'text';
  const auto = block._auto || {};
  let textW = 0;
  let textH = 0;
  for (const row of textRowsOf(block)) {
    textW = Math.max(textW, row.width);
    textH += row.height;
  }
  // drawBlockText squeezes rows into `width - 16`; the extra cell-quarter
  // keeps the estimate on the safe side of that.
  let w = textW ? textW + 2 * TEXT_PAD_X + 8 : 0;
  let h = textH ? textH + 2 * TEXT_PAD_Y : 0;
  if (isText) {
    w = Math.max(w, 2 * G);
    h = Math.max(h, DEFAULT_TEXT_HEIGHT);
  } else {
    w = Math.max(w, DEFAULT_BLOCK_WIDTH);
    h = Math.max(h, DEFAULT_BLOCK_HEIGHT);
  }
  const counts = pinCounts(block);
  h = Math.max(h, G * Math.max(counts.left, counts.right));
  w = Math.max(w, G * Math.max(counts.top, counts.bottom));
  // Labelled pins on the left/right edges need slots beside no text.
  const named = { left: 0, right: 0 };
  for (const pin of block.ports || []) {
    if ((pin.side === 'left' || pin.side === 'right') && pinName(block, pin)) named[pin.side] += 1;
  }
  const needLabelled = Math.max(named.left, named.right);
  if (needLabelled) {
    let hh = ceilGrid(h);
    while (labelSlots(block, hh).length < needLabelled && hh < 40 * G) hh += G;
    h = Math.max(h, hh);
  }
  // A container's face is its level's preview; give it something to show.
  if (block.hasChildren) {
    w = Math.max(w, 4 * G);
    h = Math.max(h, 3 * G);
  }
  if (auto.w === false && block.geometry?.width) w = Math.max(w, block.geometry.width);
  if (auto.h === false && block.geometry?.height) h = Math.max(h, block.geometry.height);
  // A face already fitted around the level inside it (see fitFrame) is a
  // floor too: the level above may only make it bigger.
  if (auto.laidOut && block.geometry) {
    w = Math.max(w, block.geometry.width);
    h = Math.max(h, block.geometry.height);
  }
  return { width: ceilGrid(w), height: ceilGrid(h) };
}

// ---------- pins ----------

// `n` pins on a side with `slots` slots: one slot apart when there is room,
// consecutive otherwise, centred either way.
function slotsForPins(slots, n) {
  if (n === 0) return [];
  const S = slots.length;
  if (S >= 2 * n - 1) {
    const start = Math.floor((S - (2 * n - 1)) / 2);
    return Array.from({ length: n }, (_, i) => slots[start + 2 * i]);
  }
  const start = Math.max(0, Math.floor((S - n) / 2));
  return Array.from({ length: n }, (_, i) => slots[Math.min(S - 1, start + i)]);
}

function sideLength(geometry, side) {
  return sideAxis(side) === 'x' ? geometry.height : geometry.width;
}

// Places the pins of one block on their sides: pins the author positioned
// keep their offset, the others take the centred slots that are left,
// ordered along the side by `rank(pin)` (where the wire on that pin goes),
// so wires leave a block in the order they arrive at the next one.
function placePins(block, rank = () => 0) {
  const bySide = new Map();
  for (const pin of block.ports || []) {
    if (!bySide.has(pin.side)) bySide.set(pin.side, []);
    bySide.get(pin.side).push(pin);
  }
  for (const [side, pins] of bySide) {
    const slots = getPortSlotOffsets(sideLength(block.geometry, side));
    // An offset this function assigned earlier is not the author's and
    // may be assigned again (`_autoOffset` is import-time only, see
    // stripMarkers); one the author wrote stays.
    const fixed = pins.filter((p) => p.manualOffset && !p._autoOffset && slots.includes(p.offset));
    const taken = new Set(fixed.map((p) => p.offset));
    const loose = pins.filter((p) => !fixed.includes(p));
    loose.sort((a, b) => rank(a) - rank(b) || pins.indexOf(a) - pins.indexOf(b));
    // Labelled pins on a left/right edge take the slots clear of the text
    // first (see labelSlots); the unlabelled ones fill in around them.
    const clear = sideAxis(side) === 'x' ? new Set(labelSlots(block, block.geometry.height)) : new Set(slots);
    const labelled = loose.filter((p) => pinName(block, p) && clear.size);
    const plain = loose.filter((p) => !labelled.includes(p));
    const assign = (group, pool) => {
      const chosen = slotsForPins(pool, group.length);
      group.forEach((pin, i) => {
        pin.offset = chosen[i] ?? pool[pool.length - 1] ?? slots[0];
        pin.manualOffset = true;
        pin._autoOffset = true;
        taken.add(pin.offset);
      });
    };
    assign(labelled, slots.filter((s) => !taken.has(s) && clear.has(s)));
    assign(plain, slots.filter((s) => !taken.has(s)));
  }
}

// ---------- the level graph ----------

function buildGraph(container, blocks, connections) {
  const nodes = new Map(blocks.map((b) => [b.id, { block: b, out: [], in: [], fromSelf: 0, toSelf: 0, degree: 0, wires: [] }]));
  const edges = [];
  for (const c of connections) {
    const s = c.sourceBlockId;
    const t = c.targetBlockId;
    if (s === container.id && nodes.has(t)) {
      nodes.get(t).fromSelf += 1;
      nodes.get(t).degree += 1;
      nodes.get(t).wires.push(c);
      continue;
    }
    if (t === container.id && nodes.has(s)) {
      nodes.get(s).toSelf += 1;
      nodes.get(s).degree += 1;
      nodes.get(s).wires.push(c);
      continue;
    }
    if (!nodes.has(s) || !nodes.has(t) || s === t) continue;
    // A dashed or dotted wire is drawn as the secondary path (telemetry,
    // a control bus, a status line) and is treated that way: it keeps
    // its blocks near each other but does not decide which comes first.
    edges.push({ s, t, conn: c, soft: Boolean(c.dashStyle) });
    nodes.get(s).out.push(t);
    nodes.get(t).in.push(s);
    nodes.get(s).degree += 1;
    nodes.get(t).degree += 1;
    nodes.get(s).wires.push(c);
    nodes.get(t).wires.push(c);
  }
  return { nodes, edges };
}

// Back edges of a depth-first walk, so ranking sees a DAG. The walk starts
// at the blocks fed by the enclosing block's own inputs, then follows the
// order the author listed the blocks in — the first block named is the
// natural start of the story — so in a loop it is the wire that returns
// to an earlier block that gets marked as the feedback path.
function backEdges(nodes, edges) {
  const back = new Set();
  const state = new Map();
  const order = [...nodes.keys()].sort((a, b) => (nodes.get(b).fromSelf > 0) - (nodes.get(a).fromSelf > 0));
  const visit = (id) => {
    state.set(id, 1);
    for (const e of edges) {
      if (e.s !== id || e.soft) continue;
      const st = state.get(e.t);
      if (st === 1) back.add(e);
      else if (!st) visit(e.t);
    }
    state.set(id, 2);
  };
  for (const id of order) if (!state.has(id)) visit(id);
  return back;
}

function rankNodes(nodes, edges, back) {
  const fwdIn = new Map([...nodes.keys()].map((id) => [id, []]));
  const fwdOut = new Map([...nodes.keys()].map((id) => [id, []]));
  const solid = new Set();
  for (const e of edges) {
    if (e.soft || back.has(e)) continue;
    solid.add(e.s);
    solid.add(e.t);
    fwdIn.get(e.t).push(e.s);
    fwdOut.get(e.s).push(e.t);
  }
  const rank = new Map();
  const visiting = new Set();
  const rankOf = (id) => {
    if (rank.has(id)) return rank.get(id);
    if (visiting.has(id)) return 0;
    visiting.add(id);
    const preds = fwdIn.get(id);
    const r = preds.length ? Math.max(...preds.map(rankOf)) + 1 : 0;
    visiting.delete(id);
    rank.set(id, r);
    return r;
  };
  for (const id of nodes.keys()) rankOf(id);
  let max = Math.max(0, ...rank.values());
  // Outputs sit in the last column; a block nothing feeds sits right
  // before whatever it feeds rather than far left on a long wire.
  for (const [id, n] of nodes) {
    if (n.toSelf > 0 && fwdOut.get(id).length === 0) rank.set(id, max);
  }
  for (const [id] of nodes) {
    if (fwdIn.get(id).length > 0) continue;
    const succ = fwdOut.get(id);
    if (succ.length) rank.set(id, Math.max(0, Math.min(...succ.map((t) => rank.get(t))) - 1));
  }
  // A block with only secondary wires (a supervisory controller on a
  // dashed bus) sits in the middle of the blocks it talks to.
  for (const [id, n] of nodes) {
    if (solid.has(id) || n.fromSelf || n.toSelf) continue;
    const around = edges.filter((e) => e.s === id || e.t === id).map((e) => rank.get(e.s === id ? e.t : e.s)).sort((a, b) => a - b);
    if (around.length) rank.set(id, around[Math.floor((around.length - 1) / 2)]);
  }
  max = Math.max(0, ...rank.values());
  return { rank, max };
}

function complexityOf(node) {
  const b = node.block;
  return node.degree + (b.hasChildren ? 3 : 0) + (b.lines?.length || 0) * 0.25 + (b.subtitle ? 0.25 : 0);
}

// Orders each column by the average position of a block's neighbours in
// the columns beside it (the barycenter heuristic), sweeping back and
// forth a few times, then sets the most connected block in the middle of
// its column so the level reads outwards from it.
function orderColumns(nodes, edges, rank, max) {
  const layers = Array.from({ length: max + 1 }, () => []);
  for (const [id, r] of rank) layers[r].push(id);
  const neighbours = new Map([...nodes.keys()].map((id) => [id, []]));
  for (const e of edges) {
    neighbours.get(e.s).push(e.t);
    neighbours.get(e.t).push(e.s);
  }
  const position = new Map();
  const refresh = () => layers.forEach((layer) => layer.forEach((id, i) => position.set(id, i)));
  refresh();
  const sweep = (r, adjacent) => {
    const layer = layers[r];
    const bary = new Map();
    for (const id of layer) {
      const ns = neighbours.get(id).filter((n) => rank.get(n) === adjacent);
      bary.set(id, ns.length ? ns.reduce((s, n) => s + position.get(n), 0) / ns.length : position.get(id));
    }
    layer.sort((a, b) => bary.get(a) - bary.get(b) || position.get(a) - position.get(b));
    layer.forEach((id, i) => position.set(id, i));
  };
  for (let it = 0; it < 4; it += 1) {
    for (let r = 1; r <= max; r += 1) sweep(r, r - 1);
    for (let r = max - 1; r >= 0; r -= 1) sweep(r, r + 1);
  }
  let hub = null;
  for (const [id, n] of nodes) if (!hub || complexityOf(n) > complexityOf(nodes.get(hub))) hub = id;
  if (hub) {
    const layer = layers[rank.get(hub)];
    layer.splice(layer.indexOf(hub), 1);
    layer.splice(Math.floor(layer.length / 2), 0, hub);
  }
  return { layers, hub };
}

// ---------- placement ----------

function labelGap(edges, rank, r) {
  let need = 0;
  for (const e of edges) {
    const a = rank.get(e.s);
    const b = rank.get(e.t);
    if (Math.min(a, b) !== r || Math.max(a, b) !== r + 1 || !e.conn.label) continue;
    need = Math.max(need, estimateTextWidth(e.conn.label, WIRE_LABEL_SIZE) + 2 * G);
  }
  return Math.max(COLUMN_GAP, ceilGrid(need));
}

function pinOf(block, pinId) {
  return (block.ports || []).find((p) => p.id === pinId) || null;
}

// The pin on `block` that `conn` uses, and the block at the other end.
function endOf(conn, block, byId) {
  if (conn.sourceBlockId === block.id) return { pin: pinOf(block, conn.sourcePortId), other: byId.get(conn.targetBlockId) || null, otherPinId: conn.targetPortId };
  return { pin: pinOf(block, conn.targetPortId), other: byId.get(conn.sourceBlockId) || null, otherPinId: conn.sourcePortId };
}

function centreY(block) {
  return block.geometry.y + block.geometry.height / 2;
}
function centreX(block) {
  return block.geometry.x + block.geometry.width / 2;
}

// Turns an unfixed pin towards its wire. A wire that runs with the flow
// leaves by the right edge and arrives by the left one; a wire that runs
// against it (a feedback path, back to an earlier column) leaves and
// arrives by the bottom edge, so the router takes it under the row
// instead of looping it back through the block it starts from; a wire
// between two blocks of one column uses the top or bottom edge.
function facePins(block, node, byId, rank, container) {
  for (const conn of node.wires) {
    const { pin, other, otherPinId } = endOf(conn, block, byId);
    if (!pin || !pin._autoSide) continue;
    const isSource = conn.sourceBlockId === block.id;
    if (!other) {
      // A wire to the enclosing block's own pin faces the edge of the
      // frame that pin sits on: inputs come from the left edge, outputs
      // leave by the right one (see placeSelfPins), unless the author
      // put the enclosing pin on another side.
      const selfPin = pinOf(container, otherPinId);
      pin.side = selfPin && !selfPin._autoSide ? selfPin.side : isSource ? 'right' : 'left';
      continue;
    }
    const dr = rank.get(other.id) - rank.get(block.id);
    if (dr === 0) pin.side = centreY(other) < centreY(block) ? 'top' : 'bottom';
    else if (isSource) pin.side = dr > 0 ? 'right' : 'bottom';
    else pin.side = dr < 0 ? 'left' : 'bottom';
  }
}

// Where the wire on `pin` is heading — the position of the pin at its
// other end, measured along this pin's own side — so a block's pins can
// be ordered the way their wires arrive and do not cross at its edge.
function pinRanker(block, node, byId) {
  const targets = new Map();
  for (const conn of node.wires) {
    const { pin, other, otherPinId } = endOf(conn, block, byId);
    if (!pin) continue;
    const along = sideAxis(pin.side) === 'x' ? 'y' : 'x';
    let at;
    if (!other) at = along === 'y' ? centreY(block) : centreX(block);
    else {
      const otherPin = pinOf(other, otherPinId);
      at = otherPin && otherPin.offset !== undefined && sideAxis(otherPin.side) === sideAxis(pin.side)
        ? other.geometry[along] + otherPin.offset
        : along === 'y' ? centreY(other) : centreX(other);
    }
    if (!targets.has(pin.id)) targets.set(pin.id, []);
    targets.get(pin.id).push(at);
  }
  return (pin) => {
    const list = targets.get(pin.id);
    return list ? list.reduce((s, v) => s + v, 0) / list.length : 0;
  };
}

// The vertical gap between two stacked blocks: two cells, plus one for
// each of them that has pins on the edge facing the gap — a pin's stub and
// the turn after it need most of a cell of their own.
function gapBetween(upper, lower) {
  const upperBottom = (upper.ports || []).some((p) => p.side === 'bottom');
  const lowerTop = (lower.ports || []).some((p) => p.side === 'top');
  return ROW_GAP + (upperBottom ? G : 0) + (lowerTop ? G : 0);
}

function stackColumn(ids, byId, x) {
  let y = 0;
  ids.forEach((id, i) => {
    const b = byId.get(id);
    b.geometry.x = x;
    b.geometry.y = y;
    y += b.geometry.height;
    if (i < ids.length - 1) y += gapBetween(b, byId.get(ids[i + 1]));
  });
  const shift = -snapGrid(y / 2);
  for (const id of ids) byId.get(id).geometry.y += shift;
}

// Slides each block of a column so the wire from its neighbour in the
// column towards the hub runs straight, keeping the column's order and
// its gaps. Works outwards from the hub column, which stays put.
function straighten(layers, hubRank, byId, nodes, rank) {
  const pass = (r, towards) => {
    const ids = layers[r];
    const desired = new Map();
    for (const id of ids) {
      const block = byId.get(id);
      const ys = [];
      for (const conn of nodes.get(id).wires) {
        const { pin, other, otherPinId } = endOf(conn, block, byId);
        if (!pin || !other || rank.get(other.id) !== towards) continue;
        const otherPin = pinOf(other, otherPinId);
        if (!otherPin || sideAxis(pin.side) !== 'x' || sideAxis(otherPin.side) !== 'x') continue;
        ys.push(other.geometry.y + otherPin.offset - pin.offset);
      }
      if (ys.length) {
        ys.sort((a, b) => a - b);
        desired.set(id, ys[Math.floor((ys.length - 1) / 2)]);
      }
    }
    if (!desired.size) return;
    // Anchor on the block with the most wires to the neighbour column;
    // place everything else around it in order without overlap.
    let anchor = null;
    for (const id of desired.keys()) if (!anchor || nodes.get(id).degree > nodes.get(anchor).degree) anchor = id;
    const block = byId.get(anchor);
    const delta = desired.get(anchor) - block.geometry.y;
    for (const id of ids) byId.get(id).geometry.y += delta;
    const at = ids.indexOf(anchor);
    for (let i = at + 1; i < ids.length; i += 1) {
      const prev = byId.get(ids[i - 1]);
      const cur = byId.get(ids[i]);
      const want = desired.has(ids[i]) ? desired.get(ids[i]) : cur.geometry.y;
      cur.geometry.y = Math.max(want, prev.geometry.y + prev.geometry.height + gapBetween(prev, cur));
    }
    for (let i = at - 1; i >= 0; i -= 1) {
      const next = byId.get(ids[i + 1]);
      const cur = byId.get(ids[i]);
      const want = desired.has(ids[i]) ? desired.get(ids[i]) : cur.geometry.y;
      cur.geometry.y = Math.min(want, next.geometry.y - gapBetween(cur, next) - cur.geometry.height);
    }
  };
  for (let r = hubRank + 1; r < layers.length; r += 1) pass(r, r - 1);
  for (let r = hubRank - 1; r >= 0; r -= 1) pass(r, r + 1);
}

function extentOf(blocks) {
  if (!blocks.length) return { x: 0, y: 0, width: 0, height: 0 };
  let minX = Infinity;
  let minY = Infinity;
  let maxX = -Infinity;
  let maxY = -Infinity;
  for (const b of blocks) {
    const g = b.geometry;
    minX = Math.min(minX, g.x);
    minY = Math.min(minY, g.y);
    maxX = Math.max(maxX, g.x + g.width);
    maxY = Math.max(maxY, g.y + g.height);
  }
  return { x: minX, y: minY, width: maxX - minX, height: maxY - minY };
}

function translate(blocks, dx, dy) {
  for (const b of blocks) {
    b.geometry.x += dx;
    b.geometry.y += dy;
  }
}

// Blocks wired to nothing go in rows above the flow, then below it —
// captions and notes read as headings, not as part of the signal path.
function placeFree(free, wired) {
  if (!free.length) return;
  const ext = extentOf(wired);
  const rowWidth = wired.length ? Math.max(ext.width, 6 * G) : Math.max(6 * G, ceilGrid(Math.sqrt(free.reduce((s, b) => s + (b.geometry.width + G) * (b.geometry.height + G), 0)) * 1.4));
  const rows = [[]];
  let x = 0;
  for (const b of free) {
    if (x > 0 && x + b.geometry.width > rowWidth) {
      rows.push([]);
      x = 0;
    }
    rows[rows.length - 1].push(b);
    x += b.geometry.width + G;
  }
  const above = wired.length ? rows.slice(0, Math.ceil(rows.length / 2)) : rows;
  const below = wired.length ? rows.slice(above.length) : [];
  const left = wired.length ? ext.x : 0;
  let y = wired.length ? ext.y : 0;
  for (const row of [...above].reverse()) {
    const h = Math.max(...row.map((b) => b.geometry.height));
    y -= h + ROW_GAP;
    let rx = left;
    for (const b of row) {
      b.geometry.x = rx;
      b.geometry.y = y + (h - b.geometry.height);
      rx += b.geometry.width + G;
    }
  }
  if (!wired.length) return;
  y = ext.y + ext.height;
  for (const row of below) {
    y += ROW_GAP;
    let rx = left;
    for (const b of row) {
      b.geometry.x = rx;
      b.geometry.y = y;
      rx += b.geometry.width + G;
    }
    y += Math.max(...row.map((b) => b.geometry.height));
  }
}

// Lays out one level whose blocks are all unplaced. Leaves the content
// around the origin; the caller frames it.
function layoutLevel(container, blocks, connections) {
  const byId = new Map(blocks.map((b) => [b.id, b]));
  for (const b of blocks) {
    const size = measureBlock(b);
    b.geometry.width = size.width;
    b.geometry.height = size.height;
  }
  const { nodes, edges } = buildGraph(container, blocks, connections);
  const wiredIds = [...nodes.keys()].filter((id) => nodes.get(id).degree > 0);
  const free = blocks.filter((b) => nodes.get(b.id).degree === 0);
  const wired = blocks.filter((b) => nodes.get(b.id).degree > 0);

  if (wiredIds.length) {
    const sub = new Map(wiredIds.map((id) => [id, nodes.get(id)]));
    const back = backEdges(sub, edges);
    const { rank, max } = rankNodes(sub, edges, back);
    const { layers, hub } = orderColumns(sub, edges, rank, max);
    // Pins face their wires before the block is sized for them, so a pin
    // that moves to the top edge counts against the width, not the height.
    for (const id of wiredIds) facePins(byId.get(id), sub.get(id), byId, rank, container);
    for (const id of wiredIds) {
      const b = byId.get(id);
      const size = measureBlock(b);
      b.geometry.width = size.width;
      b.geometry.height = size.height;
      // A container's face may just have grown for its pins; its frame
      // stays the face's shape and its level stays centred in it.
      if (b._auto?.laidOut) fitFrame(b, { width: size.width, height: size.height }, false);
      placePins(b);
    }
    let x = 0;
    layers.forEach((ids, r) => {
      stackColumn(ids, byId, x);
      x += Math.max(...ids.map((id) => byId.get(id).geometry.width)) + labelGap(edges, rank, r);
    });
    // Now that neighbours have positions, order each block's pins by where
    // their wires go, then line the wires up.
    for (const id of wiredIds) placePins(byId.get(id), pinRanker(byId.get(id), sub.get(id), byId));
    straighten(layers, rank.get(hub), byId, sub, rank);
    for (const id of wiredIds) placePins(byId.get(id), pinRanker(byId.get(id), sub.get(id), byId));
    straighten(layers, rank.get(hub), byId, sub, rank);
  }
  placeFree(free, wired);
  for (const b of free) placePins(b);
}

// ---------- frames ----------

// Sizes a container's face and frame around the level inside it. The face
// never shrinks below `minFace`; it grows to fit the level when the level
// above allows it (`growFace`), and past FACE_CAP the frame factor grows
// instead. The children are then centred in the frame.
function fitFrame(container, minFace, growFace) {
  const children = container.children?.blocks || [];
  const ext = extentOf(children);
  const need = { width: ext.width + 2 * FRAME_MARGIN, height: ext.height + 2 * FRAME_MARGIN };
  const face = container.geometry;
  let k = 3;
  if (growFace) {
    let w = Math.max(minFace.width, ceilGrid(need.width / k));
    let h = Math.max(minFace.height, ceilGrid(need.height / k));
    while ((w > FACE_CAP.width || h > FACE_CAP.height) && k < MAX_FRAME_FACTOR) {
      k += 2;
      w = Math.max(minFace.width, ceilGrid(need.width / k));
      h = Math.max(minFace.height, ceilGrid(need.height / k));
    }
    face.width = w;
    face.height = h;
  } else {
    while ((face.width * k < need.width || face.height * k < need.height) && k < 2 * MAX_FRAME_FACTOR + 1) k += 2;
  }
  const frame = { x: 0, y: 0, width: face.width * k, height: face.height * k };
  if (children.length) {
    translate(children, snapGrid(frame.width / 2 - (ext.x + ext.width / 2)), snapGrid(frame.height / 2 - (ext.y + ext.height / 2)));
  }
  container.boundaryGeometry = frame;
}

// The enclosing block's own pins, seen from inside: an input the level
// reads from sits on the left, an output it writes to on the right, in the
// order of the children they are wired to.
function placeSelfPins(container) {
  const children = container.children?.blocks || [];
  const byId = new Map(children.map((b) => [b.id, b]));
  const target = new Map();
  for (const conn of container.children?.connections || []) {
    if (conn.sourceBlockId === container.id) {
      const pin = pinOf(container, conn.sourcePortId);
      const child = byId.get(conn.targetBlockId);
      if (pin && child) {
        if (pin._autoSide) pin.side = 'left';
        target.set(pin.id, sideAxis(pin.side) === 'x' ? centreY(child) : centreX(child));
      }
    } else if (conn.targetBlockId === container.id) {
      const pin = pinOf(container, conn.targetPortId);
      const child = byId.get(conn.sourceBlockId);
      if (pin && child) {
        if (pin._autoSide) pin.side = 'right';
        target.set(pin.id, sideAxis(pin.side) === 'x' ? centreY(child) : centreX(child));
      }
    }
  }
  placePins(container, (pin) => target.get(pin.id) ?? 0);
}

function layoutContainer(container, isRoot, force) {
  const blocks = container.children?.blocks || [];
  const connections = container.children?.connections || [];
  for (const b of blocks) if (b.hasChildren) layoutContainer(b, false, force);
  const auto = force || (blocks.length > 0 && blocks.every((b) => b._auto?.place));
  if (auto && blocks.length) {
    layoutLevel(container, blocks, connections);
    if (isRoot) {
      const ext = extentOf(blocks);
      translate(blocks, FRAME_MARGIN - ext.x, FRAME_MARGIN - ext.y);
      container.boundaryGeometry = { x: 0, y: 0, width: ext.width + 2 * FRAME_MARGIN, height: ext.height + 2 * FRAME_MARGIN };
    } else {
      // The face is sized here from the block's own text and pins; the
      // level above may grow it further when it lays this block out.
      const minFace = measureBlock(container);
      container.geometry.width = Math.max(container.geometry.width, minFace.width);
      container.geometry.height = Math.max(container.geometry.height, minFace.height);
      fitFrame(container, minFace, force || !!container._auto?.place);
    }
    if (!isRoot || (container.ports || []).length) placeSelfPins(container);
    container._auto = { ...(container._auto || {}), laidOut: true };
  }
}

function stripMarkers(block) {
  delete block._auto;
  for (const pin of block.ports || []) {
    delete pin._autoSide;
    delete pin._autoOffset;
  }
  for (const child of block.children?.blocks || []) stripMarkers(child);
}

// Lays out every level whose blocks all came without coordinates (or every
// level, with `force`), bottom up, then removes the import-time markers
// slimFormat.js left on the data. Returns the same object.
export function autoLayoutProjectData(data, { force = false } = {}) {
  if (!data?.rootBlock) return data;
  layoutContainer(data.rootBlock, true, force);
  stripMarkers(data.rootBlock);
  return data;
}
