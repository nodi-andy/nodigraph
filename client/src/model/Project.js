import { createBlock, hydrateBlockTree, serializeBlockTree } from './Block.js';

/**
 * A recursive tree of levels: the root level plus, for any block that's
 * been "entered", that block's own nested level of blocks/connections
 * (Block.children). `path` is the list of block ids from the root down to
 * whichever level is currently being viewed/edited — every method below
 * (listBlocks, addBlock, addConnection, ...) transparently operates on
 * *that* level, so callers (rendering, hit-testing, the inspector) never
 * need to know whether they're at the root or three levels deep.
 */
export class Project {
  constructor({ name = 'Untitled Product', blocks = [], connections = [] } = {}) {
    this.name = name;
    this.root = {
      blocks: new Map(blocks.map((block) => [block.id, hydrateBlockTree(block)])),
      connections: new Map(connections.map((connection) => [connection.id, connection])),
    };
    this.path = [];
  }

  static fromJSON(data) {
    if (!data) return new Project();
    return new Project({ name: data.name, blocks: data.blocks || [], connections: data.connections || [] });
  }

  toJSON() {
    return {
      name: this.name,
      blocks: Array.from(this.root.blocks.values()).map(serializeBlockTree),
      connections: Array.from(this.root.connections.values()),
    };
  }

  // Walks from the root through `path`, auto-creating a children level for
  // any block that doesn't have one yet (defensive — enterBlock already
  // does this up front for the block being entered).
  getLevel(path = this.path) {
    let level = this.root;
    for (const blockId of path) {
      const block = level.blocks.get(blockId);
      if (!block) return this.root;
      if (!block.children) {
        block.children = { blocks: new Map(), connections: new Map() };
        block.hasChildren = true;
      }
      level = block.children;
    }
    return level;
  }

  get current() {
    return this.getLevel();
  }

  addBlock(block) {
    this.current.blocks.set(block.id, block);
    return block;
  }

  removeBlock(id) {
    this.current.blocks.delete(id);
    for (const [connId, connection] of this.current.connections) {
      if (connection.sourceBlockId === id || connection.targetBlockId === id) {
        this.current.connections.delete(connId);
      }
    }
  }

  getBlock(id) {
    return this.current.blocks.get(id) || null;
  }

  listBlocks() {
    return Array.from(this.current.blocks.values());
  }

  createDefaultBlock(x, y) {
    const block = createBlock({ x, y });
    this.addBlock(block);
    return block;
  }

  listConnections() {
    return Array.from(this.current.connections.values());
  }

  getConnection(id) {
    return this.current.connections.get(id) || null;
  }

  removeConnection(id) {
    this.current.connections.delete(id);
  }

  hasConnection(sourcePortId, targetPortId) {
    return this.listConnections().some(
      (c) => c.sourcePortId === sourcePortId && c.targetPortId === targetPortId,
    );
  }

  addConnection(connection) {
    if (this.hasConnection(connection.sourcePortId, connection.targetPortId)) return null;
    this.current.connections.set(connection.id, connection);
    return connection;
  }

  removeConnectionsForPort(portId) {
    for (const [id, connection] of this.current.connections) {
      if (connection.sourcePortId === portId || connection.targetPortId === portId) {
        this.current.connections.delete(id);
      }
    }
  }

  // --- Hierarchy navigation ---

  // Jumping into a block converts it into a container the first time (an
  // empty level to start filling in) and pushes it onto the path; jumping
  // out just pops. Both are no-ops on failure rather than throwing, since
  // they're driven directly by UI clicks that could race a deletion.
  enterBlock(blockId) {
    const block = this.getBlock(blockId);
    if (!block) return false;
    if (!block.children) {
      block.children = { blocks: new Map(), connections: new Map() };
      block.hasChildren = true;
    }
    this.path = [...this.path, blockId];
    return true;
  }

  exitBlock() {
    this.path = this.path.slice(0, -1);
  }

  exitToDepth(depth) {
    this.path = this.path.slice(0, Math.max(0, depth));
  }

  // One entry per level from the product root down to the current view,
  // for breadcrumb display — crumb.depth is what exitToDepth expects.
  getBreadcrumb() {
    const crumbs = [{ name: this.name, depth: 0 }];
    let level = this.root;
    this.path.forEach((blockId, i) => {
      const block = level.blocks.get(blockId);
      crumbs.push({ name: block?.name || '…', depth: i + 1 });
      level = block?.children || { blocks: new Map(), connections: new Map() };
    });
    return crumbs;
  }
}
