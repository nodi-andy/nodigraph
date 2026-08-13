import { hitTest } from './HitTest.js';
import { touchBlock, MIN_BLOCK_WIDTH, MIN_BLOCK_HEIGHT } from '../model/Block.js';
import { snap, GRID_SIZE } from '../model/grid.js';
import { findPortPosition, projectPointToPerimeter } from '../render/BlockRenderer.js';
import { getConnectionGeometry, previewPathToCursor, hitTestConnectionTrunk } from '../render/ConnectionRenderer.js';
import { createConnection } from '../model/Connection.js';
import { addPort } from '../model/BlockDescription.js';

const STATES = {
  IDLE: 'idle',
  PANNING: 'panning',
  DRAGGING_BLOCK: 'draggingBlock',
  RESIZING_BLOCK: 'resizingBlock',
  DRAGGING_PORT: 'draggingPort',
  DRAWING_CONNECTION: 'drawingConnection',
  DRAGGING_WIRE_TRUNK: 'draggingWireTrunk',
  // A click on the boundary's edge is ambiguous until the pointer either
  // releases without moving much (add a port there) or moves past the
  // threshold (become an actual splitter-resize drag).
  PENDING_BOUNDARY_EDGE: 'pendingBoundaryEdge',
  RESIZING_BOUNDARY_EDGE: 'resizingBoundaryEdge',
};

// Screen-space so the same finger/mouse movement counts as "a drag" the
// same way regardless of current zoom level.
const CLICK_DRAG_THRESHOLD = 5;
const BOUNDARY_MIN_SIZE = GRID_SIZE * 3;

function invertDirection(direction) {
  return direction === 'out' ? 'in' : 'out';
}

/**
 * Explicit finite states rather than ad-hoc booleans — this is what makes
 * "drag block body" vs "drag resize handle" vs "drag a port" vs "draw a
 * wire" vs "drag a wire's trunk" vs "pan background" unambiguous.
 */
export class DragStateMachine {
  constructor({ camera, project, selection, wireSelection, requestRender, persist, onEnterBlock }) {
    this.camera = camera;
    this.project = project;
    this.selection = selection;
    this.wireSelection = wireSelection;
    this.requestRender = requestRender;
    this.persist = persist;
    this.onEnterBlock = onEnterBlock;
    this.state = STATES.IDLE;
    this.context = null;
  }

  // The block you're currently inside, with whatever boundary geometry the
  // user has it set to right now — just a stored rectangle, not something
  // recomputed from children.
  getBoundaryInfo() {
    const block = this.project.getContainerBlock();
    if (!block || !block.boundaryGeometry) return null;
    return { block, geometry: block.boundaryGeometry };
  }

  onPointerDown(screen, world, modifiers = {}) {
    // Middle-button drag is always "pan the canvas," even over a block, a
    // port, or the boundary — it bypasses hit-testing entirely rather than
    // doing whatever a left-click there would do.
    if (modifiers.button === 1) {
      this.state = STATES.PANNING;
      this.context = { lastScreen: screen };
      return;
    }

    const boundary = this.getBoundaryInfo();
    const hit = hitTest(this.project, world.x, world.y, this.selection.selectedBlockId, boundary);
    if (hit) this.wireSelection.clear();

    if (hit?.type === 'enter') {
      // A discrete action, not a drag — fires immediately like a button.
      this.onEnterBlock?.(hit.blockId);
      return;
    }

    if (hit?.type === 'resize') {
      const block = this.project.getBlock(hit.blockId);
      this.state = STATES.RESIZING_BLOCK;
      this.context = { blockId: block.id, startWorld: world, startGeom: { ...block.geometry } };
      return;
    }

    if (hit?.type === 'connector') {
      const isBoundary = Boolean(boundary) && hit.blockId === boundary.block.id;
      // Selection is left untouched: drawing a wire shouldn't disturb
      // whatever the inspector is currently showing.
      this.state = STATES.DRAWING_CONNECTION;
      this.context = {
        sourceBlockId: hit.blockId,
        sourcePortId: hit.portId,
        sourceInverted: isBoundary,
        currentWorld: world,
      };
      this.requestRender();
      return;
    }

    if (hit?.type === 'port') {
      const isBoundary = Boolean(boundary) && hit.blockId === boundary.block.id;
      const block = this.project.getBlock(hit.blockId);
      this.selection.selectPort(block.id, hit.portId);
      this.state = STATES.DRAGGING_PORT;
      this.context = { blockId: block.id, portId: hit.portId, isBoundary };
      this.requestRender();
      return;
    }

    if (hit?.type === 'border') {
      // A precise click on a normal block's own edge — no drag ambiguity
      // to resolve here (unlike the boundary, an ordinary block's border
      // isn't also a resize splitter), so it just adds the port right away.
      this.addPortAt(hit.blockId, hit.side, hit.offset);
      return;
    }

    if (hit?.type === 'boundaryEdge') {
      this.state = STATES.PENDING_BOUNDARY_EDGE;
      this.context = {
        blockId: hit.blockId,
        edge: hit.edge,
        offset: hit.offset,
        startScreen: screen,
        startGeometry: { ...boundary.geometry },
      };
      return;
    }

    if (hit?.type === 'body') {
      const block = this.project.getBlock(hit.blockId);
      this.selection.select(block.id);
      this.state = STATES.DRAGGING_BLOCK;
      this.context = { blockId: block.id, startWorld: world, startGeom: { ...block.geometry } };
      this.requestRender();
      return;
    }

    const wireHit = this.hitTestWires(world.x, world.y, boundary);
    if (wireHit) {
      if (modifiers.shiftKey) {
        // Shift-click only toggles membership — a following drag (grabbing
        // any selected trunk) is what actually moves the group.
        this.wireSelection.toggle(wireHit.connectionId);
        this.requestRender();
        return;
      }
      if (!this.wireSelection.isSelected(wireHit.connectionId)) {
        this.wireSelection.selectOnly(wireHit.connectionId);
      }
      this.state = STATES.DRAGGING_WIRE_TRUNK;
      this.context = { items: this.buildTrunkDragItems(boundary), startWorld: world };
      this.requestRender();
      return;
    }

    this.wireSelection.clear();
    this.selection.clear();
    this.state = STATES.PANNING;
    this.context = { lastScreen: screen };
    this.requestRender();
  }

  hitTestWires(worldX, worldY, boundary) {
    const connections = this.project.listConnections();
    for (let i = connections.length - 1; i >= 0; i -= 1) {
      const connection = connections[i];
      const geometry = getConnectionGeometry(this.project, connection, boundary);
      if (hitTestConnectionTrunk(geometry, worldX, worldY)) {
        return { connectionId: connection.id };
      }
    }
    return null;
  }

  // Captures each selected trunk's current axis + displayed position once,
  // at drag start, so the group can be dragged together even when one of
  // them hasn't been manually bent before (its baseline is the live
  // auto-computed midpoint, not an arbitrary jump).
  buildTrunkDragItems(boundary) {
    return this.wireSelection
      .list()
      .map((connectionId) => {
        const connection = this.project.getConnection(connectionId);
        const geometry = connection && getConnectionGeometry(this.project, connection, boundary);
        if (!connection || !geometry || geometry.trunkIndex < 0) return null;
        const axis = geometry.trunkAxis;
        const point = geometry.points[geometry.trunkIndex];
        return { connectionId, axis, startBend: axis === 'x' ? point.x : point.y };
      })
      .filter(Boolean);
  }

  onPointerMove(screen, world) {
    switch (this.state) {
      case STATES.PANNING: {
        const dx = screen.x - this.context.lastScreen.x;
        const dy = screen.y - this.context.lastScreen.y;
        this.camera.pan(dx, dy);
        this.context.lastScreen = screen;
        this.requestRender();
        break;
      }
      case STATES.DRAGGING_BLOCK: {
        const block = this.project.getBlock(this.context.blockId);
        if (!block) break;
        // Snapping the absolute result (not the delta) is what gives the
        // Factorio/AoE feel of the block jumping between grid cells as you
        // drag, rather than drifting off-grid by accumulated pixel deltas.
        block.geometry.x = snap(this.context.startGeom.x + (world.x - this.context.startWorld.x));
        block.geometry.y = snap(this.context.startGeom.y + (world.y - this.context.startWorld.y));
        this.requestRender();
        break;
      }
      case STATES.RESIZING_BLOCK: {
        const block = this.project.getBlock(this.context.blockId);
        if (!block) break;
        block.geometry.width = Math.max(
          MIN_BLOCK_WIDTH,
          snap(this.context.startGeom.width + (world.x - this.context.startWorld.x)),
        );
        block.geometry.height = Math.max(
          MIN_BLOCK_HEIGHT,
          snap(this.context.startGeom.height + (world.y - this.context.startWorld.y)),
        );
        this.requestRender();
        break;
      }
      case STATES.DRAGGING_PORT: {
        const block = this.project.getBlock(this.context.blockId);
        const port = block?.ports.find((p) => p.id === this.context.portId);
        if (!block || !port) break;
        // Projects onto the nearest point on the block's own border across
        // all four sides (or the boundary frame's border, if this port
        // belongs to the current container) so a port slides all the way
        // around the perimeter and switches sides at the corners.
        const geometry = this.context.isBoundary ? this.getBoundaryInfo().geometry : block.geometry;
        const projected = projectPointToPerimeter({ geometry }, world.x, world.y);
        port.side = projected.side;
        port.offset = projected.offset;
        port.manualOffset = true;
        this.requestRender();
        break;
      }
      case STATES.DRAWING_CONNECTION: {
        this.context.currentWorld = world;
        this.requestRender();
        break;
      }
      case STATES.DRAGGING_WIRE_TRUNK: {
        const dx = world.x - this.context.startWorld.x;
        const dy = world.y - this.context.startWorld.y;
        for (const item of this.context.items) {
          const connection = this.project.getConnection(item.connectionId);
          if (!connection) continue;
          // Each wire moves along its own trunk axis, so a diagonal drag
          // over a mixed horizontal/vertical selection still moves each one
          // correctly instead of fighting over a single shared axis.
          const delta = item.axis === 'x' ? dx : dy;
          connection.manualBend = snap(item.startBend + delta);
        }
        this.requestRender();
        break;
      }
      case STATES.PENDING_BOUNDARY_EDGE: {
        const dx = screen.x - this.context.startScreen.x;
        const dy = screen.y - this.context.startScreen.y;
        if (Math.hypot(dx, dy) > CLICK_DRAG_THRESHOLD) {
          this.state = STATES.RESIZING_BOUNDARY_EDGE;
          this.resizeBoundaryEdge(world);
        }
        break;
      }
      case STATES.RESIZING_BOUNDARY_EDGE: {
        this.resizeBoundaryEdge(world);
        break;
      }
      default:
        break;
    }
  }

  // Splitter-style: dragging one edge of the boundary moves only that
  // edge, keeping the opposite one fixed, rather than resizing uniformly
  // from a corner the way a normal block does.
  resizeBoundaryEdge(world) {
    const block = this.project.getBlock(this.context.blockId);
    if (!block || !block.boundaryGeometry) return;
    const { edge, startGeometry } = this.context;
    const geom = block.boundaryGeometry;

    if (edge === 'left') {
      const rightEdge = startGeometry.x + startGeometry.width;
      const newX = Math.min(rightEdge - BOUNDARY_MIN_SIZE, snap(world.x));
      geom.x = newX;
      geom.width = rightEdge - newX;
    } else if (edge === 'right') {
      geom.width = Math.max(BOUNDARY_MIN_SIZE, snap(world.x) - startGeometry.x);
    } else if (edge === 'top') {
      const bottomEdge = startGeometry.y + startGeometry.height;
      const newY = Math.min(bottomEdge - BOUNDARY_MIN_SIZE, snap(world.y));
      geom.y = newY;
      geom.height = bottomEdge - newY;
    } else if (edge === 'bottom') {
      geom.height = Math.max(BOUNDARY_MIN_SIZE, snap(world.y) - startGeometry.y);
    }
    this.requestRender();
  }

  addPortAt(blockId, side, offset) {
    const block = this.project.getBlock(blockId);
    if (!block) return;
    const direction = side === 'right' ? 'out' : 'in';
    addPort(block, { direction, side, offset });
    touchBlock(block);
    this.selection.select(block.id);
    this.persist();
    this.requestRender();
  }

  onPointerUp(world) {
    if (
      this.state === STATES.DRAGGING_BLOCK ||
      this.state === STATES.RESIZING_BLOCK ||
      this.state === STATES.DRAGGING_PORT
    ) {
      const block = this.project.getBlock(this.context.blockId);
      if (block) touchBlock(block);
      this.persist();
    } else if (this.state === STATES.DRAWING_CONNECTION) {
      this.tryCompleteConnection(world);
    } else if (this.state === STATES.DRAGGING_WIRE_TRUNK) {
      this.persist();
    } else if (this.state === STATES.PENDING_BOUNDARY_EDGE) {
      // Released without ever crossing the drag threshold — resolve the
      // ambiguity as a click: add a port right where the boundary was hit.
      this.addPortAt(this.context.blockId, this.context.edge, this.context.offset);
    } else if (this.state === STATES.RESIZING_BOUNDARY_EDGE) {
      const block = this.project.getBlock(this.context.blockId);
      if (block) touchBlock(block);
      this.persist();
    }

    this.state = STATES.IDLE;
    this.context = null;
  }

  // Shared by the live hover-highlight (so what's shown while dragging is
  // exactly what dropping there will do) and the actual drop below. Returns
  // null when the cursor isn't over any port/connector at all; otherwise a
  // result that's either `valid` (with the normalized out/in sides ready to
  // connect) or not (the port under the cursor is real but its effective
  // direction can't pair with the source — e.g. a boundary port added on
  // the wrong edge).
  resolveConnectionTarget(world) {
    if (!world) return null;
    const boundary = this.getBoundaryInfo();
    const { sourceBlockId, sourcePortId, sourceInverted } = this.context;
    const targetHit = hitTest(this.project, world.x, world.y, this.selection.selectedBlockId, boundary);
    const isPortHit = targetHit?.type === 'port' || targetHit?.type === 'connector';
    if (!isPortHit || targetHit.blockId === sourceBlockId) return null;

    const sourceBlock = this.project.getBlock(sourceBlockId);
    const targetBlock = this.project.getBlock(targetHit.blockId);
    const sourcePort = sourceBlock?.ports.find((p) => p.id === sourcePortId);
    const targetPort = targetBlock?.ports.find((p) => p.id === targetHit.portId);
    if (!sourcePort || !targetPort) return null;

    // A boundary port's role is inverted from this level's point of view
    // (an outside input is an inside source, and vice versa) — comparing
    // effective roles, not raw stored direction, is what lets a boundary
    // port wire to a child of the same raw direction correctly.
    const targetInverted = Boolean(boundary) && targetHit.blockId === boundary.block.id;
    const sourceEffective = sourceInverted ? invertDirection(sourcePort.direction) : sourcePort.direction;
    const targetEffective = targetInverted ? invertDirection(targetPort.direction) : targetPort.direction;
    const blockId = targetHit.blockId;
    const portId = targetHit.portId;

    if (sourceEffective === targetEffective) {
      return { valid: false, blockId, portId };
    }

    // Normalize so sourcePortId is always the effective source, regardless
    // of which handle the user actually grabbed first.
    const outSide = sourceEffective === 'out'
      ? { blockId: sourceBlockId, portId: sourcePortId }
      : { blockId, portId };
    const inSide = sourceEffective === 'out'
      ? { blockId, portId }
      : { blockId: sourceBlockId, portId: sourcePortId };

    return { valid: true, blockId, portId, outSide, inSide };
  }

  tryCompleteConnection(world) {
    const target = this.resolveConnectionTarget(world);
    if (!target?.valid) {
      this.requestRender();
      return;
    }

    this.project.addConnection(
      createConnection({
        sourceBlockId: target.outSide.blockId,
        sourcePortId: target.outSide.portId,
        targetBlockId: target.inSide.blockId,
        targetPortId: target.inSide.portId,
      }),
    );
    this.requestRender();
    this.persist();
  }

  // While drawing a connection: the source port being dragged from, and
  // whatever's currently under the cursor (if anything) with whether it's
  // actually a valid drop target — lets the canvas mark both ends live
  // instead of only revealing compatibility on drop.
  getConnectionDragHighlights() {
    if (this.state !== STATES.DRAWING_CONNECTION) return { source: null, target: null };
    const { sourceBlockId, sourcePortId, currentWorld } = this.context;
    const hover = this.resolveConnectionTarget(currentWorld);
    return {
      source: { blockId: sourceBlockId, portId: sourcePortId },
      target: hover ? { blockId: hover.blockId, portId: hover.portId, valid: hover.valid } : null,
    };
  }

  // The live paving preview: an auto-routed path from the source port to
  // wherever the cursor is right now, so dragging visibly "lays down" the
  // wire rather than showing a plain rubber-band line.
  getPendingConnectionVisual() {
    if (this.state !== STATES.DRAWING_CONNECTION) return null;
    const { sourceBlockId, sourcePortId, sourceInverted, currentWorld } = this.context;
    const block = this.project.getBlock(sourceBlockId);
    const port = block?.ports.find((p) => p.id === sourcePortId);
    if (!block || !port) return null;

    const boundary = this.getBoundaryInfo();
    const geomBlock = sourceInverted && boundary ? { ...block, geometry: boundary.geometry } : block;
    const sourcePos = findPortPosition(geomBlock, sourcePortId);
    if (!sourcePos) return null;
    return previewPathToCursor(sourcePos, port.side, currentWorld, sourceInverted);
  }

  // Double-clicking a block is a shortcut for its enter icon — either way
  // gets you in, so it doesn't matter which one someone discovers first.
  onDoubleClick(world) {
    const hit = hitTest(this.project, world.x, world.y, this.selection.selectedBlockId);
    if (hit?.type === 'body' || hit?.type === 'enter') {
      this.onEnterBlock?.(hit.blockId);
    }
  }

  onWheelZoom(screen, factor) {
    this.camera.zoomAt(screen.x, screen.y, factor);
    this.requestRender();
  }
}
