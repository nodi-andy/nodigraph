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
    childRef: null,
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
