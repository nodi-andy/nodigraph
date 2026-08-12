import { hitTest } from './HitTest.js';
import { touchBlock, MIN_BLOCK_WIDTH, MIN_BLOCK_HEIGHT } from '../model/Block.js';
import { snap, clamp, getPortOffsetBounds } from '../model/grid.js';
import { findPortPosition } from '../render/BlockRenderer.js';
import { createConnection } from '../model/Connection.js';

const STATES = {
  IDLE: 'idle',
  PANNING: 'panning',
  DRAGGING_BLOCK: 'draggingBlock',
  RESIZING_BLOCK: 'resizingBlock',
  DRAGGING_PORT: 'draggingPort',
  DRAWING_CONNECTION: 'drawingConnection',
};

/**
 * Explicit finite states rather than ad-hoc booleans — this is what makes
 * "drag block body" vs "drag resize handle" vs "drag a port" vs "draw a
 * wire" vs "pan background" unambiguous.
 */
export class DragStateMachine {
  constructor({ camera, project, selection, requestRender, persist }) {
    this.camera = camera;
    this.project = project;
    this.selection = selection;
    this.requestRender = requestRender;
    this.persist = persist;
    this.state = STATES.IDLE;
    this.context = null;
  }

  onPointerDown(screen, world) {
    const hit = hitTest(this.project, world.x, world.y, this.selection.selectedBlockId);

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

    this.selection.clear();
    this.state = STATES.PANNING;
    this.context = { lastScreen: screen };
    this.requestRender();
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
        // Ports only slide along their own edge (vertically) — matches the
        // fixed input-on-left/output-on-right border model.
        const bounds = getPortOffsetBounds(block.geometry.height);
        port.offset = clamp(snap(world.y - block.geometry.y), bounds.min, bounds.max);
        this.requestRender();
        break;
      }
      case STATES.DRAWING_CONNECTION: {
        this.context.currentWorld = world;
        this.requestRender();
        break;
      }
      default:
        break;
    }
  }

  onPointerUp(world) {
    if (this.state === STATES.DRAGGING_BLOCK || this.state === STATES.RESIZING_BLOCK) {
      const block = this.project.getBlock(this.context.blockId);
      if (block) touchBlock(block);
      this.persist();
    } else if (this.state === STATES.DRAGGING_PORT) {
      const block = this.project.getBlock(this.context.blockId);
      if (block) touchBlock(block);
      this.persist();
    } else if (this.state === STATES.DRAWING_CONNECTION) {
      this.tryCompleteConnection(world);
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

  getPendingConnectionVisual() {
    if (this.state !== STATES.DRAWING_CONNECTION) return null;
    const block = this.project.getBlock(this.context.sourceBlockId);
    const source = block && findPortPosition(block, this.context.sourcePortId);
    if (!source) return null;
    return { source, target: this.context.currentWorld };
  }

  onWheelZoom(screen, factor) {
    this.camera.zoomAt(screen.x, screen.y, factor);
    this.requestRender();
  }
}
