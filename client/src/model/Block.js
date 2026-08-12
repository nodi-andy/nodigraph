import { GRID_SIZE, snap } from './grid.js';

let counter = 0;

export function generateId(prefix) {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}

export const DEFAULT_BLOCK_WIDTH = GRID_SIZE * 6;
export const DEFAULT_BLOCK_HEIGHT = GRID_SIZE * 4;
export const MIN_BLOCK_WIDTH = GRID_SIZE * 2;
export const MIN_BLOCK_HEIGHT = GRID_SIZE * 2;

export function createBlock({ x, y, name } = {}) {
  const now = new Date().toISOString();
  const blockName = name || 'New Block';
  return {
    id: generateId('blk'),
    name: blockName,
    type: 'block',
    description: `Block: ${blockName}`,
    geometry: {
      x: snap(x ?? 0),
      y: snap(y ?? 0),
      width: DEFAULT_BLOCK_WIDTH,
      height: DEFAULT_BLOCK_HEIGHT,
    },
    style: { color: '#3b6fa0' },
    ports: [],
    props: [],
    hasChildren: false,
    // Populated lazily the first time someone enters this block (see
    // Project.enterBlock) — { blocks: Map, connections: Map } in memory,
    // { blocks: [], connections: [] } once serialized to JSON.
    children: null,
    requirementIds: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function touchBlock(block) {
  block.updatedAt = new Date().toISOString();
  return block;
}

// Fills in fields added after some blocks were already saved to localStorage,
// so older saved projects don't crash on load.
export function hydrateBlock(raw) {
  return {
    ...raw,
    ports: (raw.ports || []).map((port) => ({
      side: port.direction === 'out' ? 'right' : 'left',
      ...port,
    })),
    props: raw.props || [],
    description: raw.description || `Block: ${raw.name || 'Block'}`,
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
  if (block.children) {
    serialized.children = {
      blocks: Array.from(block.children.blocks.values()).map(serializeBlockTree),
      connections: Array.from(block.children.connections.values()),
    };
  }
  return serialized;
}
