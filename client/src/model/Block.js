let counter = 0;

export function generateId(prefix) {
  counter += 1;
  return `${prefix}_${Date.now().toString(36)}${counter.toString(36)}`;
}

export const DEFAULT_BLOCK_WIDTH = 220;
export const DEFAULT_BLOCK_HEIGHT = 140;
export const MIN_BLOCK_WIDTH = 120;
export const MIN_BLOCK_HEIGHT = 80;

export function createBlock({ x, y, name } = {}) {
  const now = new Date().toISOString();
  return {
    id: generateId('blk'),
    name: name || 'New Block',
    type: 'block',
    description: '',
    geometry: {
      x: x ?? 0,
      y: y ?? 0,
      width: DEFAULT_BLOCK_WIDTH,
      height: DEFAULT_BLOCK_HEIGHT,
    },
    style: { color: '#3b6fa0' },
    ports: [],
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
