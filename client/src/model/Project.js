import { createBlock, hydrateBlockTree, serializeBlockTree } from './Block.js';
import { createDefaultBoundaryGeometry } from './grid.js';

/**
 * The whole product is itself a Block (`rootBlock`) — you're always inside
 * *some* block, even at the very top, so "the current system's interface"
 * always means "this container's own ports," root included. `path` is the
 * list of block ids from the root down to whichever level is currently
 * being viewed/edited; every method below (listBlocks, addBlock,
 * addConnection, ...) transparently operates on *that* level's children,
 * so callers never need to know whether they're at the root or three
 * levels deep. getBlock() additionally resolves the container itself (not
 * just its children), since selecting "the current system" to edit its
 * interface means selecting a block that isn't one of its own children.
 */
export class Project {
  constructor({ name = 'Untitled', blocks = [], connections = [], rootBlock } = {}) {
    if (rootBlock) {
      this.rootBlock = hydrateBlockTree(rootBlock);
    } else {
      this.rootBlock = createBlock({ name });
      this.rootBlock.hasChildren = true;
      this.rootBlock.boundaryGeometry = createDefaultBoundaryGeometry();
      this.rootBlock.children = {
        blocks: new Map(blocks.map((block) => [block.id, hydrateBlockTree(block)])),
        connections: new Map(connections.map((connection) => [connection.id, connection])),
      };
    }
    this.path = [];
  }

  static fromJSON(data) {
    if (!data) return new Project();
    if (data.rootBlock) {
      const project = new Project({ rootBlock: data.rootBlock });
      // Whichever block was open when this was saved/shared — trimmed to
      // whatever prefix still resolves, same as a live peer's tree
      // changing out from under you (see applyRemoteRootBlock), in case
      // the block a link points at has since been deleted or the JSON was
      // hand-edited.
      if (Array.isArray(data.path)) project.path = project.validPathPrefix(data.path);
      return project;
    }
    // Older saved shape (no rootBlock yet) — still loads, just starts with
    // a blank product interface.
    return new Project({ name: data.name, blocks: data.blocks || [], connections: data.connections || [] });
  }

  toJSON() {
    // `path` travels with the tree everywhere this gets serialized — a
    // `?d=` share link, "Save to URL", and the local/server autosave alike
    // — so opening any of them lands back on the block you were actually
    // looking at instead of always resetting to the top level.
    return { rootBlock: serializeBlockTree(this.rootBlock), path: this.path };
  }

  get name() {
    return this.rootBlock.name;
  }

  // Walks from the root through `path`, auto-creating a children level for
  // any block that doesn't have one yet (defensive — enterBlock already
  // does this up front for the block being entered).
  getLevel(path = this.path) {
    let level = this.rootBlock.children;
    for (const blockId of path) {
      const block = level.blocks.get(blockId);
      if (!block) return this.rootBlock.children;
      if (!block.children) {
        block.children = { blocks: new Map(), connections: new Map() };
        block.hasChildren = true;
        block.boundaryGeometry = block.boundaryGeometry || createDefaultBoundaryGeometry();
      }
      level = block.children;
    }
    return level;
  }

  get current() {
    return this.getLevel();
  }

  // The block whose interior is currently being viewed — this.rootBlock at
  // the top, otherwise the block at the end of `path` (found in the level
  // one step up from `current`).
  getContainerBlock() {
    if (this.path.length === 0) return this.rootBlock;
    const parentLevel = this.getLevel(this.path.slice(0, -1));
    return parentLevel.blocks.get(this.path[this.path.length - 1]) || this.rootBlock;
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
    const block = this.current.blocks.get(id);
    if (block) return block;
    const container = this.getContainerBlock();
    return container && container.id === id ? container : null;
  }

  listBlocks() {
    return Array.from(this.current.blocks.values());
  }

  createDefaultBlock(x, y, kind = 'block') {
    const block = createBlock({ x, y, kind });
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

  // The world-space extent of everything drawn at the current level — its
  // blocks plus the container's own boundary frame. Used to center a level
  // when you navigate into it, and to crop exported diagram images.
  // Returns null when there's genuinely nothing to frame.
  getLevelBounds() {
    const container = this.getContainerBlock();
    const rects = this.listBlocks().map((b) => b.geometry);
    if (container?.boundaryGeometry) rects.push(container.boundaryGeometry);
    if (!rects.length) return null;

    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const r of rects) {
      minX = Math.min(minX, r.x);
      minY = Math.min(minY, r.y);
      maxX = Math.max(maxX, r.x + r.width);
      maxY = Math.max(maxY, r.y + r.height);
    }
    return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
  }

  // --- Hierarchy navigation ---

  // Wraps the whole product in a new top-level block, so what used to be
  // the root becomes that block's single child — "this system turned out to
  // be a component of something bigger." The view stays on the same content
  // the user was already looking at (now one level deeper), rather than
  // jumping up into the new, near-empty parent.
  createParent(name = 'New Parent') {
    const oldRoot = this.rootBlock;
    const newRoot = createBlock({ name });
    newRoot.hasChildren = true;
    newRoot.boundaryGeometry = createDefaultBoundaryGeometry();
    newRoot.children = { blocks: new Map([[oldRoot.id, oldRoot]]), connections: new Map() };
    this.rootBlock = newRoot;
    this.path = [oldRoot.id, ...this.path];
    return newRoot;
  }

  // Jumping into a block converts it into a container the first time (an
  // empty level to start filling in) and pushes it onto the path; jumping
  // out just pops. Both are no-ops on failure rather than throwing, since
  // they're driven directly by UI clicks that could race a deletion.
  enterBlock(blockId) {
    if (blockId === this.getContainerBlock()?.id) return false;
    const block = this.getBlock(blockId);
    if (!block) return false;
    // A text block is a plain floating label (see Block.createBlock) — it
    // has no sub-architecture to drill into, from any UI path that might
    // ask (double-click, the Inspector's "Enter block" button, ...).
    if (block.kind === 'text') return false;
    if (!block.children) {
      block.children = { blocks: new Map(), connections: new Map() };
      block.hasChildren = true;
      block.boundaryGeometry = block.boundaryGeometry || createDefaultBoundaryGeometry();
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

  // Trims a candidate path down to whatever longest prefix still resolves
  // against the *current* tree — shared by applyRemoteRootBlock (another
  // client deleted a block you were currently inside) and fromJSON (a
  // saved/shared path pointing at a block that no longer exists).
  validPathPrefix(candidatePath) {
    const validPath = [];
    let level = this.rootBlock.children;
    for (const blockId of candidatePath) {
      const block = level?.blocks.get(blockId);
      if (!block) break;
      validPath.push(blockId);
      level = block.children;
    }
    return validPath;
  }

  // Re-hydrates the tree in place from a freshly-fetched snapshot (see
  // store.js's polling) rather than replacing this Project instance —
  // every module that holds a reference to it (state machine, inspector,
  // toolbar, ...) expects that reference to stay stable for the session.
  applyRemoteRootBlock(rootBlockData) {
    this.rootBlock = hydrateBlockTree(rootBlockData);
    this.path = this.validPathPrefix(this.path);
  }

  // One entry per level from the product root down to the current view,
  // for breadcrumb display — crumb.depth is what exitToDepth expects.
  getBreadcrumb() {
    const crumbs = [{ name: this.rootBlock.name, depth: 0 }];
    let level = this.rootBlock.children;
    this.path.forEach((blockId, i) => {
      const block = level.blocks.get(blockId);
      crumbs.push({ name: block?.name || '…', depth: i + 1 });
      level = block?.children || { blocks: new Map(), connections: new Map() };
    });
    return crumbs;
  }
}
