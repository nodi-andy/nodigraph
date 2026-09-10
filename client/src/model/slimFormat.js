// A deliberately lossy, human-editable project format — the YAML export
// option (see model/yaml.js for the text codec this builds on). JSON stays
// the full-fidelity format (exactly project.toJSON()'s own shape); this
// one keeps only what actually describes the architecture: block names,
// positions, ports, and wires between them. Dropped on the way out,
// regenerated with a sensible default on the way back in:
//   - ids (blk_xyz, prt_xyz, io_xyz) — replaced with short keys scoped to
//     each level (b1, b2, ... / p1, p2, ...) purely for readability; fresh
//     real ids are minted on import, same policy model/clipboard.js already
//     uses for a pasted copy.
//   - a pin's *interior* placement once entered (see BlockRenderer's
//     getPortBoundaryPlacement) — falls back to mirroring its exterior
//     side/offset, its ordinary default before anyone drags it from inside.
//   - a wire's manually-dragged trunk bend — re-routes automatically,
//     same as a wire that was never dragged.
//   - block.description's text-editor view — it's a computed cache of
//     logicalPorts/props/name (see BlockDescription.serializeBlockDescription)
//     and gets rebuilt from those after import, never stored twice.
import { generateId, hydrateBlockTree, DEFAULT_BLOCK_WIDTH, DEFAULT_BLOCK_HEIGHT, DEFAULT_TEXT_WIDTH, DEFAULT_TEXT_HEIGHT, DEFAULT_BLOCK_COLOR } from './Block.js';

// A block's own `props` are host-defined data this module has no opinion
// about (see Block.js's own doc) — most of it (a pin number, a toggle
// value, a kind tag a host like noditron uses to know what a block *is*)
// is plain, small, human-editable data, exactly what this format is for.
// The exception is a *generated code* prop (a host's own `fn`/`render`/
// `html`/`dialog` — see runtime.js in noditron, the one host currently
// using props this way): a full JS source string, often hundreds of
// characters, that a host itself already knows how to regenerate from a
// short kind tag alone (see noditron's own palette.js rehydrateKindLogic)
// — writing that out in full would bloat every export without adding
// anything a paste/import can't already reconstruct, so those specific
// names are skipped here. Nothing below knows what noditron *is*; this is
// just "don't inline four particular prop names," the same way isText
// above is the one other single-purpose exception this format carries.
const CODE_PROP_NAMES = new Set(['fn', 'render', 'html', 'dialog']);
import { createDefaultBoundaryGeometry, GRID_SIZE } from './grid.js';
import { createConnection } from './Connection.js';
import { flow, stringifyYaml, parseYaml } from './yaml.js';

// ---------- project data (project.toJSON() shape) -> slim plain object ----------

function computePortsSlim(block) {
  const pins = block.ports || [];
  const pinKeys = new Map();
  const portsSlim = {};
  pins.forEach((pin, i) => {
    const key = `p${i + 1}`;
    pinKeys.set(pin.id, key);
    const logical = (block.logicalPorts || []).find((lp) => lp.id === pin.logicalId);
    const rec = {};
    if (logical?.name) rec.name = logical.name;
    if (logical?.direction) rec.dir = logical.direction;
    if (logical?.description) rec.desc = logical.description;
    const naturalSide = logical?.direction === 'out' ? 'right' : 'left';
    if (pin.side && pin.side !== naturalSide) rec.side = pin.side;
    if (pin.manualOffset && pin.offset !== undefined && pin.offset !== null) rec.offset = pin.offset;
    // A pin's *interior* placement (its position on the boundary frame,
    // once the block has been entered — see BlockRenderer's
    // getPortBoundaryPlacement) is a genuinely separate fact from its
    // exterior side/offset above, not a cosmetic default worth dropping:
    // this is the actual arranged layout of the container's own exposed
    // interface, and losing it collapses every boundary port back onto
    // one spot. Only written when it's ever actually been set (dragged
    // from inside at least once) and only the parts that differ from just
    // mirroring the exterior placement — the ordinary default before that.
    if (pin.boundary) {
      if (pin.boundary.side !== pin.side) rec.inSide = pin.boundary.side;
      if (pin.boundary.offset !== pin.offset) rec.inOffset = pin.boundary.offset;
      if (pin.boundary.width && pin.boundary.width > 1) rec.inWidth = pin.boundary.width;
    }
    portsSlim[key] = flow(rec);
  });
  return { portsSlim, pinKeys };
}

function boundaryToSlim(boundaryGeometry) {
  if (!boundaryGeometry) return undefined;
  const d = createDefaultBoundaryGeometry();
  if (boundaryGeometry.x === d.x && boundaryGeometry.y === d.y && boundaryGeometry.width === d.width && boundaryGeometry.height === d.height) {
    return undefined;
  }
  return { x: boundaryGeometry.x, y: boundaryGeometry.y, w: boundaryGeometry.width, h: boundaryGeometry.height };
}

function wireToSlim(conn, endpoint) {
  const from = `${endpoint(conn.sourceBlockId)}.${endpoint(conn.sourceBlockId, conn.sourcePortId)}`;
  const to = `${endpoint(conn.targetBlockId)}.${endpoint(conn.targetBlockId, conn.targetPortId)}`;
  if (conn.label || conn.color || conn.dashStyle) {
    const rec = { from, to };
    if (conn.label) rec.label = conn.label;
    if (conn.color) rec.color = conn.color;
    if (conn.dashStyle) rec.dash = conn.dashStyle;
    return flow(rec);
  }
  return `${from} -> ${to}`;
}

// `selfBlock`/`selfPinKeys` represent the container these blocks/wires
// belong to, from its *own* ports' point of view — a wire from a child up
// to the container's own boundary port (see Project.addConnection's own
// "the container itself is exempt" carve-out) has that container as one
// endpoint, never one of the children being listed here.
function levelToSlim(blocksArray, connectionsArray, selfBlock, selfPinKeys) {
  const blockKeyById = new Map([[selfBlock.id, 'self']]);
  const pinKeysByBlockId = new Map([[selfBlock.id, selfPinKeys]]);
  const blocksSlim = {};

  blocksArray.forEach((block, i) => {
    const key = `b${i + 1}`;
    blockKeyById.set(block.id, key);
    const { slim, pinKeys } = blockToSlim(block);
    blocksSlim[key] = slim;
    pinKeysByBlockId.set(block.id, pinKeys);
  });

  const wiresSlim = [];
  for (const conn of connectionsArray) {
    const blockKey = (id) => blockKeyById.get(id);
    const pinKey = (blockId, pinId) => pinKeysByBlockId.get(blockId)?.get(pinId);
    if (!blockKey(conn.sourceBlockId) || !blockKey(conn.targetBlockId)) continue;
    if (!pinKey(conn.sourceBlockId, conn.sourcePortId) || !pinKey(conn.targetBlockId, conn.targetPortId)) continue;
    wiresSlim.push(
      wireToSlim(conn, (blockId, pinId) => (pinId === undefined ? blockKey(blockId) : pinKey(blockId, pinId))),
    );
  }

  return { blocksSlim, wiresSlim };
}

function blockToSlim(block) {
  const isText = block.kind === 'text';
  const slim = { name: block.name };
  if (isText) slim.kind = 'text';
  slim.x = block.geometry.x;
  slim.y = block.geometry.y;
  const defaultW = isText ? DEFAULT_TEXT_WIDTH : DEFAULT_BLOCK_WIDTH;
  const defaultH = isText ? DEFAULT_TEXT_HEIGHT : DEFAULT_BLOCK_HEIGHT;
  if (block.geometry.width !== defaultW) slim.w = block.geometry.width;
  if (block.geometry.height !== defaultH) slim.h = block.geometry.height;
  const defaultColor = isText ? 'transparent' : DEFAULT_BLOCK_COLOR;
  if (block.style?.color && block.style.color !== defaultColor) slim.color = block.style.color;
  if (block.style?.fill && block.style.fill !== 'transparent') slim.fill = block.style.fill;

  const { portsSlim, pinKeys } = computePortsSlim(block);
  if (Object.keys(portsSlim).length) slim.ports = portsSlim;

  const propsSlim = {};
  for (const p of block.props || []) {
    if (CODE_PROP_NAMES.has(p.name) || p.value === undefined) continue;
    propsSlim[p.name] = p.value;
  }
  if (Object.keys(propsSlim).length) slim.props = propsSlim;

  if (block.hasChildren) {
    const { blocksSlim, wiresSlim } = levelToSlim(block.children?.blocks || [], block.children?.connections || [], block, pinKeys);
    slim.blocks = blocksSlim;
    if (wiresSlim.length) slim.wires = wiresSlim;
    const boundary = boundaryToSlim(block.boundaryGeometry);
    if (boundary) slim.boundary = boundary;
  }

  return { slim, pinKeys };
}

// `data` is exactly project.toJSON()'s own shape ({ rootBlock, path }).
export function projectDataToSlim(data) {
  const root = data.rootBlock;
  const { portsSlim, pinKeys } = computePortsSlim(root);
  const { blocksSlim, wiresSlim } = levelToSlim(root.children?.blocks || [], root.children?.connections || [], root, pinKeys);
  const slim = { name: root.name };
  if (Object.keys(portsSlim).length) slim.ports = portsSlim;
  slim.blocks = blocksSlim;
  if (wiresSlim.length) slim.wires = wiresSlim;
  const boundary = boundaryToSlim(root.boundaryGeometry);
  if (boundary) slim.boundary = boundary;
  return slim;
}

// ---------- slim plain object -> project data (Project.fromJSON's shape) ----------

function slimPortsToArrays(portsSlim) {
  const logicalPorts = [];
  const pins = [];
  const pinIdByKey = new Map();
  for (const [key, rec] of Object.entries(portsSlim || {})) {
    const direction = rec.dir || null;
    const name = rec.name || '';
    // Two entries sharing a name+direction are the same logical interface
    // (same rule model/clipboard.js's ancestor, Block.js's own legacy
    // migration, already uses) — this is how a hand-written duplicate pin
    // reads as "the same pin, cloned," matching what BlockDescription.
    // clonePort actually produces.
    let logical = name ? logicalPorts.find((lp) => lp.name === name && lp.direction === direction) : null;
    if (!logical) {
      logical = { id: generateId('io'), name, direction, description: rec.desc || '' };
      logicalPorts.push(logical);
    }
    const pinId = generateId('prt');
    pinIdByKey.set(key, pinId);
    const side = rec.side || (direction === 'out' ? 'right' : 'left');
    const pin = {
      id: pinId,
      logicalId: logical.id,
      side,
      offset: rec.offset,
      manualOffset: rec.offset !== undefined && rec.offset !== null,
    };
    // Present only when the exported pin actually had one (see
    // computePortsSlim) — an ordinary pin that's never been entered and
    // repositioned from inside gets no `.boundary` at all, same as a
    // freshly-created one, and falls back to mirroring side/offset above
    // (see BlockRenderer.getPortBoundaryPlacement).
    if (rec.inSide !== undefined || rec.inOffset !== undefined || rec.inWidth !== undefined) {
      pin.boundary = {
        side: rec.inSide || side,
        offset: rec.inOffset !== undefined ? rec.inOffset : pin.offset,
        width: rec.inWidth || 1,
      };
    }
    pins.push(pin);
  }
  return { logicalPorts, pins, pinIdByKey };
}

function parseWireEntry(entry) {
  const raw = typeof entry === 'string' ? { pair: entry } : { pair: `${entry.from} -> ${entry.to}`, ...entry };
  const match = String(raw.pair).match(/^(.+?)\s*->\s*(.+)$/);
  if (!match) return null;
  const [fromBlockKey, fromPinKey] = match[1].trim().split('.');
  const [toBlockKey, toPinKey] = match[2].trim().split('.');
  if (!fromBlockKey || !fromPinKey || !toBlockKey || !toPinKey) return null;
  return { fromBlockKey, fromPinKey, toBlockKey, toPinKey, label: raw.label, color: raw.color, dash: raw.dash };
}

function slimLevelToData(blocksSlim, wiresSlim, selfBlockId, selfPinIdByKey) {
  const blockIdByKey = new Map([['self', selfBlockId]]);
  const pinIdByKeyByBlockKey = new Map([['self', selfPinIdByKey]]);
  const blocksArray = [];

  for (const [key, slimBlock] of Object.entries(blocksSlim || {})) {
    const { block, pinIdByKey } = slimBlockToData(slimBlock);
    blockIdByKey.set(key, block.id);
    pinIdByKeyByBlockKey.set(key, pinIdByKey);
    blocksArray.push(block);
  }

  const connectionsArray = [];
  for (const entry of wiresSlim || []) {
    const parsed = parseWireEntry(entry);
    if (!parsed) continue;
    const sourceBlockId = blockIdByKey.get(parsed.fromBlockKey);
    const targetBlockId = blockIdByKey.get(parsed.toBlockKey);
    const sourcePortId = pinIdByKeyByBlockKey.get(parsed.fromBlockKey)?.get(parsed.fromPinKey);
    const targetPortId = pinIdByKeyByBlockKey.get(parsed.toBlockKey)?.get(parsed.toPinKey);
    if (!sourceBlockId || !targetBlockId || !sourcePortId || !targetPortId) continue;
    const conn = createConnection({ sourceBlockId, sourcePortId, targetBlockId, targetPortId });
    if (parsed.label) conn.label = parsed.label;
    if (parsed.color) conn.color = parsed.color;
    if (parsed.dash) conn.dashStyle = parsed.dash;
    connectionsArray.push(conn);
  }

  return { blocksArray, connectionsArray };
}

function slimBlockToData(slimBlock) {
  const isText = slimBlock.kind === 'text';
  const { logicalPorts, pins, pinIdByKey } = slimPortsToArrays(slimBlock.ports);
  const hasChildren = slimBlock.blocks !== undefined;
  const block = {
    id: generateId('blk'),
    name: slimBlock.name || (isText ? 'Text' : 'New Block'),
    type: 'block',
    kind: isText ? 'text' : 'block',
    geometry: {
      x: slimBlock.x || 0,
      y: slimBlock.y || 0,
      width: slimBlock.w ?? (isText ? DEFAULT_TEXT_WIDTH : DEFAULT_BLOCK_WIDTH),
      height: slimBlock.h ?? (isText ? DEFAULT_TEXT_HEIGHT : DEFAULT_BLOCK_HEIGHT),
    },
    style: {
      color: slimBlock.color || (isText ? 'transparent' : DEFAULT_BLOCK_COLOR),
      ...(slimBlock.fill ? { fill: slimBlock.fill } : isText ? { fill: 'transparent' } : {}),
    },
    logicalPorts,
    ports: pins,
    props: Object.entries(slimBlock.props || {}).map(([name, value]) => ({ id: generateId('prp'), name, kind: 'value', value })),
    hasChildren,
    boundaryGeometry: null,
    children: null,
  };
  if (hasChildren) {
    block.boundaryGeometry = slimBlock.boundary
      ? { x: slimBlock.boundary.x, y: slimBlock.boundary.y, width: slimBlock.boundary.w, height: slimBlock.boundary.h }
      : createDefaultBoundaryGeometry();
    const { blocksArray, connectionsArray } = slimLevelToData(slimBlock.blocks, slimBlock.wires, block.id, pinIdByKey);
    block.children = { blocks: blocksArray, connections: connectionsArray };
  }
  return { block, pinIdByKey };
}

// Returns the shape Project.fromJSON expects ({ rootBlock, path }).
export function slimToProjectData(slim) {
  const rootId = generateId('blk');
  const { logicalPorts, pins, pinIdByKey } = slimPortsToArrays(slim.ports);
  const boundaryGeometry = slim.boundary
    ? { x: slim.boundary.x, y: slim.boundary.y, width: slim.boundary.w, height: slim.boundary.h }
    : createDefaultBoundaryGeometry();
  const { blocksArray, connectionsArray } = slimLevelToData(slim.blocks || {}, slim.wires || [], rootId, pinIdByKey);
  const rootBlock = {
    id: rootId,
    name: slim.name || 'Untitled',
    type: 'block',
    kind: 'block',
    geometry: { x: 0, y: 0, width: DEFAULT_BLOCK_WIDTH, height: DEFAULT_BLOCK_HEIGHT },
    style: { color: DEFAULT_BLOCK_COLOR },
    logicalPorts,
    ports: pins,
    props: [],
    hasChildren: true,
    boundaryGeometry,
    children: { blocks: blocksArray, connections: connectionsArray },
  };
  return { rootBlock, path: [] };
}

// ---------- text ----------

export function projectDataToYamlText(data) {
  return stringifyYaml(projectDataToSlim(data));
}

// Throws if the text isn't parseable YAML, or doesn't have a `blocks` key
// (every valid document has one — even an empty product interface still
// gets `blocks: {}` from projectDataToSlim) — the caller is expected to
// surface that to the user rather than silently doing nothing, same
// contract model/localFile.js's readProjectFile already has for JSON.
export function yamlTextToProjectData(text) {
  let slim;
  try {
    slim = parseYaml(text);
  } catch (err) {
    throw new Error(`Not valid YAML (${err.message})`);
  }
  if (!slim || typeof slim.blocks !== 'object') {
    throw new Error('Not a nodigraph YAML file');
  }
  return slimToProjectData(slim);
}

// Offsets a pasted circuit so it doesn't land exactly on top of whatever
// is already there — same reasoning as model/clipboard.js's own
// PASTE_OFFSET for a duplicated selection.
const PASTE_OFFSET = GRID_SIZE;

// Adds the blocks/wires described by a YAML *document* (this format's own
// top-level shape — see projectDataToYamlText above, e.g. what "Copy as
// YAML" puts on the clipboard) to the level the project is currently
// viewing, the same way model/clipboard.js's pasteSelection adds a
// duplicated selection. Unlike that one, no id-remapping pass is needed
// here: slimToProjectData already mints a fresh id for every block/port on
// each call (see slimBlockToData/slimPortsToArrays above), so two pastes
// of the same YAML text never collide. hydrateBlockTree still has to run
// on each block, though — the plain objects slimBlockToData builds are the
// same raw shape Project's own constructor expects to hydrate, not
// something already carrying computed fields like `description`.
//
// Returns the new top-level blocks' ids (for the caller to select), or an
// empty array if the text isn't valid nodigraph YAML at all -- deliberately
// non-throwing (unlike yamlTextToProjectData above) so a paste handler can
// just fall through to "not ours" without its own try/catch.
export function pasteSlimYamlText(project, text, offset = PASTE_OFFSET) {
  let data;
  try {
    data = yamlTextToProjectData(text);
  } catch {
    return [];
  }
  const newIds = [];
  for (const raw of data.rootBlock.children.blocks) {
    const hydrated = hydrateBlockTree(raw);
    hydrated.geometry.x += offset;
    hydrated.geometry.y += offset;
    // A host's one chance to fill in whatever this format itself couldn't
    // carry (see this module's own CODE_PROP_NAMES doc) — every block in
    // the pasted (sub)tree, not just the top-level ones, since a container
    // with its own children (e.g. noditron's Timer) needs each of *those*
    // filled in too. Optional and a plain no-op with nothing set (a host
    // with nothing to do here just never sets the hook, same as every
    // other window.nodigraph* hook this app calls).
    forEachBlockInTree(hydrated, (b) => window.nodigraphRehydrateBlock?.(b));
    project.addBlock(hydrated);
    newIds.push(hydrated.id);
  }
  for (const connection of data.rootBlock.children.connections) {
    project.addConnection(connection);
  }
  return newIds;
}

function forEachBlockInTree(block, fn) {
  fn(block);
  for (const child of block.children?.blocks.values() || []) forEachBlockInTree(child, fn);
}

