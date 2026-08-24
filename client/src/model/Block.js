import { GRID_SIZE, snap, createDefaultBoundaryGeometry } from './grid.js';

let counter = 0;

export function generateId(prefix) {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}

export const DEFAULT_BLOCK_WIDTH = GRID_SIZE * 6;
export const DEFAULT_BLOCK_HEIGHT = GRID_SIZE * 4;
// A single grid cell is the floor — small enough for a block that's
// really just one named socket, and there's nothing smaller on the grid
// to snap to anyway.
export const MIN_BLOCK_WIDTH = GRID_SIZE * 1;
export const MIN_BLOCK_HEIGHT = GRID_SIZE * 1;
// The accent a block is drawn with until someone picks another one.
export const DEFAULT_BLOCK_COLOR = '#3b6fa0';
// A text block is a plain block with no fill/border of its own (see
// SelectionFabs' transparent swatch) — one grid cell tall reads as a
// single label line rather than the boxy default block footprint.
export const DEFAULT_TEXT_WIDTH = GRID_SIZE * 4;
export const DEFAULT_TEXT_HEIGHT = GRID_SIZE * 1;

export function createBlock({ x, y, name, kind = 'block' } = {}) {
  const isText = kind === 'text';
  const blockName = name || (isText ? 'Text' : 'New Block');
  return {
    id: generateId('blk'),
    name: blockName,
    type: 'block',
    // `kind` distinguishes a block used as a plain floating label from an
    // ordinary one — same shape either way (still has ports/props/children
    // available if someone wants them), just different creation defaults
    // below, so it never needs its own render path or serialization case.
    kind,
    description: `Block: ${blockName}`,
    geometry: isText
      ? { x: snap(x ?? 0), y: snap(y ?? 0), width: DEFAULT_TEXT_WIDTH, height: DEFAULT_TEXT_HEIGHT }
      : { x: snap(x ?? 0), y: snap(y ?? 0), width: DEFAULT_BLOCK_WIDTH, height: DEFAULT_BLOCK_HEIGHT },
    style: isText ? { color: 'transparent', fill: 'transparent' } : { color: DEFAULT_BLOCK_COLOR },
    ports: [],
    props: [],
    hasChildren: false,
    // Populated lazily the first time someone enters this block (see
    // Project.enterBlock) — { blocks: Map, connections: Map } in memory,
    // omitted entirely once serialized to JSON if still empty (see
    // serializeBlockTree).
    children: null,
    // The boundary frame's own position/size once this block has been
    // entered — just a container for its IOs, independent of where its
    // children happen to sit (see grid.createDefaultBoundaryGeometry).
    boundaryGeometry: null,
    requirementIds: [],
  };
}

// Fills in fields added after some blocks were already saved to localStorage,
// so older saved projects don't crash on load.
export function hydrateBlock(raw) {
  return {
    ...raw,
    kind: raw.kind || 'block',
    ports: (raw.ports || []).map((port) => ({
      side: port.direction === 'out' ? 'right' : 'left',
      ...port,
    })),
    props: raw.props || [],
    description: raw.description || `Block: ${raw.name || 'Block'}`,
    boundaryGeometry: raw.hasChildren ? raw.boundaryGeometry || createDefaultBoundaryGeometry() : raw.boundaryGeometry || null,
  };
}

// Recursively hydrates a block and, if it has a saved sub-architecture,
// its whole nested children tree — turning the JSON array shape back into
// the Map-based shape the rest of the app works with in memory.
export function hydrateBlockTree(raw) {
  const block = hydrateBlock(raw);
  if (raw.children) {
    block.children = {
      blocks: new Map((raw.children.blocks || []).map((b) => [b.id, hydrateBlockTree(b)])),
      connections: new Map((raw.children.connections || []).map((c) => [c.id, c])),
    };
  } else {
    block.children = null;
  }
  return block;
}

// The inverse of hydrateBlockTree — walks the whole nested tree turning
// Maps back into plain arrays for JSON.stringify.
export function serializeBlockTree(block) {
  const serialized = { ...block };
  // Entering a block lazily creates an empty children level (see
  // Project.enterBlock) even if nothing was ever placed inside it —
  // serializing that as `{blocks:[],connections:[]}` would be pure dead
  // weight, and omitting it round-trips fine (hydrateBlockTree treats a
  // missing children the same as an explicit null).
  const hasContent = block.children && (block.children.blocks.size > 0 || block.children.connections.size > 0);
  if (hasContent) {
    serialized.children = {
      blocks: Array.from(block.children.blocks.values()).map(serializeBlockTree),
      connections: Array.from(block.children.connections.values()),
    };
  } else {
    delete serialized.children;
  }
  return serialized;
}
