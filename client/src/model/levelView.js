/**
 * A read-only, Project-shaped view of one block's children level.
 *
 * Everything that draws a level — SceneRenderer, ConnectionRenderer's
 * routing, BlockRenderer's boundary ports — talks to "a project" and asks
 * it about *the level currently being edited* (Project.current, driven by
 * Project.path). That's exactly right for the canvas, and exactly wrong
 * for the sub-architecture preview (see render/SubPreviewRenderer.js),
 * which needs to draw a level nobody has navigated into.
 *
 * LevelView is that same question surface pointed at an arbitrary
 * container block instead of at `path`, so the preview reuses the real
 * routing rather than approximating it. The shared resolution below lives
 * as free functions taking a view, and Project's own methods delegate to
 * them — one implementation, two ways in.
 */

// Which pins on `block` are the same logical port as `pinId` — see
// Project.boundaryPortGroup, whose doc this is the body of.
export function boundaryPortGroupOf(block, pinId) {
  const pin = block?.ports.find((p) => p.id === pinId);
  if (!pin) return [pinId];
  return block.ports.filter((p) => p.logicalId === pin.logicalId).map((p) => p.id);
}

// See Project.listBoundaryPorts — one entry per logical port, its first
// pin standing in as the representative.
export function boundaryPortsOf(block) {
  const seen = new Map();
  for (const pin of block?.ports || []) {
    if (!seen.has(pin.logicalId)) seen.set(pin.logicalId, pin);
  }
  return [...seen.values()];
}

// See Project.listBoundaryWires. `view` is anything with
// getContainerBlock()/listConnections() — a Project or a LevelView.
export function boundaryWiresOf(view, containerBlockId, portId) {
  const groupIds = new Set(boundaryPortGroupOf(view.getContainerBlock(), portId));
  const ids = [];
  for (const connection of view.listConnections()) {
    if (connection.sourceBlockId === containerBlockId && groupIds.has(connection.sourcePortId)) ids.push(connection.id);
    if (connection.targetBlockId === containerBlockId && groupIds.has(connection.targetPortId)) ids.push(connection.id);
  }
  return ids;
}

// See Project.getLevelBounds. Same `view` contract as above.
export function boundsOf(view) {
  const container = view.getContainerBlock();
  const rects = view.listBlocks().map((b) => b.geometry);
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
  // A hand-routed wire (see model/wireRoute.js) can run well clear of
  // every block — a detour around the outside of the diagram — and a box
  // sized to the blocks alone would cut it off. Every corner of a route
  // sits on one of its own coordinates or on a port, so widening the box
  // by the coordinates on each axis is enough.
  for (const connection of view.listConnections()) {
    const route = connection.route;
    if (!Array.isArray(route?.coords)) continue;
    const other = route.first === 'x' ? 'y' : 'x';
    route.coords.forEach((value, i) => {
      if (!Number.isFinite(value)) return;
      if ((i % 2 === 0 ? route.first : other) === 'x') {
        minX = Math.min(minX, value);
        maxX = Math.max(maxX, value);
      } else {
        minY = Math.min(minY, value);
        maxY = Math.max(maxY, value);
      }
    });
  }
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

export class LevelView {
  // `container` is the block whose interior this view exposes; it must
  // already have a children level (see BlockRenderer.hasSubArchitecture —
  // the only caller today checks that first), since nothing here ever
  // creates one the way Project.getLevel does.
  constructor(container) {
    this.container = container;
    this.level = container.children || { blocks: new Map(), connections: new Map() };
  }

  getContainerBlock() {
    return this.container;
  }

  listBlocks() {
    return Array.from(this.level.blocks.values());
  }

  listConnections() {
    return Array.from(this.level.connections.values());
  }

  getConnection(id) {
    return this.level.connections.get(id) || null;
  }

  // Resolves the container itself as well as its children, exactly like
  // Project.getBlock — a connection inside this level can legitimately
  // name the container as one of its endpoints (that's a boundary wire).
  getBlock(id) {
    return this.level.blocks.get(id) || (this.container.id === id ? this.container : null);
  }

  listBoundaryPorts(block) {
    return boundaryPortsOf(block);
  }

  boundaryPortGroup(block, pinId) {
    return boundaryPortGroupOf(block, pinId);
  }

  listBoundaryWires(containerBlockId, portId) {
    return boundaryWiresOf(this, containerBlockId, portId);
  }

  getLevelBounds() {
    return boundsOf(this);
  }
}
