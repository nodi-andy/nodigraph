import { createBlock, hydrateBlock } from './Block.js';

/**
 * Milestone 1 scope: a single flat level of blocks (no hierarchy/manifest split yet —
 * that arrives in Milestone 3 alongside BreadcrumbStack). Structured as { name, blocks: Map }
 * so later milestones can slot in per-level manifests without reshaping this class.
 * Connections join sibling blocks' ports within this one level, same as they
 * will within any single manifest once hierarchy exists.
 */
export class Project {
  constructor({ name = 'Untitled Product', blocks = [], connections = [] } = {}) {
    this.name = name;
    this.blocks = new Map(blocks.map((block) => [block.id, hydrateBlock(block)]));
    this.connections = new Map(connections.map((connection) => [connection.id, connection]));
  }

  static fromJSON(data) {
    if (!data) return new Project();
    return new Project({ name: data.name, blocks: data.blocks || [], connections: data.connections || [] });
  }

  toJSON() {
    return {
      name: this.name,
      blocks: Array.from(this.blocks.values()),
      connections: Array.from(this.connections.values()),
    };
  }

  addBlock(block) {
    this.blocks.set(block.id, block);
    return block;
  }

  removeBlock(id) {
    this.blocks.delete(id);
    for (const [connId, connection] of this.connections) {
      if (connection.sourceBlockId === id || connection.targetBlockId === id) {
        this.connections.delete(connId);
      }
    }
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

  listConnections() {
    return Array.from(this.connections.values());
  }

  getConnection(id) {
    return this.connections.get(id) || null;
  }

  removeConnection(id) {
    this.connections.delete(id);
  }

  hasConnection(sourcePortId, targetPortId) {
    return this.listConnections().some(
      (c) => c.sourcePortId === sourcePortId && c.targetPortId === targetPortId,
    );
  }

  addConnection(connection) {
    if (this.hasConnection(connection.sourcePortId, connection.targetPortId)) return null;
    this.connections.set(connection.id, connection);
    return connection;
  }

  removeConnectionsForPort(portId) {
    for (const [id, connection] of this.connections) {
      if (connection.sourcePortId === portId || connection.targetPortId === portId) {
        this.connections.delete(id);
      }
    }
  }
}
