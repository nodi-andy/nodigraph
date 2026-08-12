import { createBlock, hydrateBlock } from './Block.js';

/**
 * Milestone 1 scope: a single flat level of blocks (no hierarchy/manifest split yet —
 * that arrives in Milestone 3 alongside BreadcrumbStack). Structured as { name, blocks: Map }
 * so later milestones can slot in per-level manifests without reshaping this class.
 */
export class Project {
  constructor({ name = 'Untitled Product', blocks = [] } = {}) {
    this.name = name;
    this.blocks = new Map(blocks.map((block) => [block.id, hydrateBlock(block)]));
  }

  static fromJSON(data) {
    if (!data) return new Project();
    return new Project({ name: data.name, blocks: data.blocks || [] });
  }

  toJSON() {
    return { name: this.name, blocks: Array.from(this.blocks.values()) };
  }

  addBlock(block) {
    this.blocks.set(block.id, block);
    return block;
  }

  removeBlock(id) {
    this.blocks.delete(id);
  }

  getBlock(id) {
    return this.blocks.get(id) || null;
  }

  listBlocks() {
    return Array.from(this.blocks.values());
  }

  createDefaultBlock(x, y) {
    const block = createBlock({ x, y });
    this.addBlock(block);
    return block;
  }
}
