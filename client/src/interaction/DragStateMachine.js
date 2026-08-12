import { hitTest } from './HitTest.js';
import { touchBlock, MIN_BLOCK_WIDTH, MIN_BLOCK_HEIGHT } from '../model/Block.js';
import { snap } from '../model/grid.js';
import { findPortPosition, projectPointToPerimeter } from '../render/BlockRenderer.js';
import { getConnectionGeometry, previewPathToCursor, hitTestConnectionTrunk } from '../render/ConnectionRenderer.js';
import { createConnection } from '../model/Connection.js';

const STATES = {
  IDLE: 'idle',
  PANNING: 'panning',
  DRAGGING_BLOCK: 'draggingBlock',
  RESIZING_BLOCK: 'resizingBlock',
  DRAGGING_PORT: 'draggingPort',
  DRAWING_CONNECTION: 'drawingConnection',
  DRAGGING_WIRE_TRUNK: 'draggingWireTrunk',
};

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

  onPointerDown(screen, world, modifiers = {}) {
    const hit = hitTest(this.project, world.x, world.y, this.selection.selectedBlockId);
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
      // Selection is left untouched: drawing a wire shouldn't disturb
      // whatever the inspector is currently showing.
      this.state = STATES.DRAWING_CONNECTION;
      this.context = { sourceBlockId: hit.blockId, sourcePortId: hit.portId, currentWorld: world };
      this.requestRender();
      return;
    }

    if (hit?.type === 'port') {
      const block = this.project.getBlock(hit.blockId);
      this.selection.select(block.id);
      this.state = STATES.DRAGGING_PORT;
      this.context = { blockId: block.id, portId: hit.portId };
      this.requestRender();
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

    const wireHit = this.hitTestWires(world.x, world.y);
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
      this.context = { items: this.buildTrunkDragItems(), startWorld: world };
      this.requestRender();
      return;
    }

    this.wireSelection.clear();
    this.selection.clear();
    this.state = STATES.PANNING;
    this.context = { lastScreen: screen };
    this.requestRender();
  }

  hitTestWires(worldX, worldY) {
    const connections = this.project.listConnections();
    for (let i = connections.length - 1; i >= 0; i -= 1) {
      const connection = connections[i];
      const geometry = getConnectionGeometry(this.project, connection);
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
  buildTrunkDragItems() {
    return this.wireSelection
      .list()
      .map((connectionId) => {
        const connection = this.project.getConnection(connectionId);
        const geometry = connection && getConnectionGeometry(this.project, connection);
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
        // Projects onto the nearest point on the block's border across all
        // four sides, so a port slides all the way around the perimeter and
        // switches sides at the corners rather than sticking to one edge.
        const projected = projectPointToPerimeter(block, world.x, world.y);
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
      default:
        break;
    }
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
    }

    this.state = STATES.IDLE;
    this.context = null;
  }

  tryCompleteConnection(world) {
    if (!world) {
      this.requestRender();
      return;
    }
    const { sourceBlockId, sourcePortId } = this.context;
    const targetHit = hitTest(this.project, world.x, world.y, this.selection.selectedBlockId);
    const isPortHit = targetHit?.type === 'port' || targetHit?.type === 'connector';

    if (!isPortHit || targetHit.blockId === sourceBlockId) {
      this.requestRender();
      return;
    }

    const sourceBlock = this.project.getBlock(sourceBlockId);
    const targetBlock = this.project.getBlock(targetHit.blockId);
    const sourcePort = sourceBlock?.ports.find((p) => p.id === sourcePortId);
    const targetPort = targetBlock?.ports.find((p) => p.id === targetHit.portId);
    if (!sourcePort || !targetPort || sourcePort.direction === targetPort.direction) {
      this.requestRender();
      return;
    }

    // Normalize so sourcePortId is always the 'out' port, regardless of
    // which handle the user actually grabbed first.
    const outSide = sourcePort.direction === 'out'
      ? { blockId: sourceBlockId, portId: sourcePortId }
      : { blockId: targetHit.blockId, portId: targetHit.portId };
    const inSide = sourcePort.direction === 'out'
      ? { blockId: targetHit.blockId, portId: targetHit.portId }
      : { blockId: sourceBlockId, portId: sourcePortId };

    this.project.addConnection(
      createConnection({
        sourceBlockId: outSide.blockId,
        sourcePortId: outSide.portId,
        targetBlockId: inSide.blockId,
        targetPortId: inSide.portId,
      }),
    );
    this.requestRender();
    this.persist();
  }

  // The live paving preview: an auto-routed path from the source port to
  // wherever the cursor is right now, so dragging visibly "lays down" the
  // wire rather than showing a plain rubber-band line.
  getPendingConnectionVisual() {
    if (this.state !== STATES.DRAWING_CONNECTION) return null;
    const block = this.project.getBlock(this.context.sourceBlockId);
    const port = block?.ports.find((p) => p.id === this.context.sourcePortId);
    const sourcePos = block && findPortPosition(block, this.context.sourcePortId);
    if (!sourcePos || !port) return null;
    return previewPathToCursor(sourcePos, port.side, this.context.currentWorld);
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
