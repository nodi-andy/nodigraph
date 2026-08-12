import { hitTest } from './HitTest.js';
import { touchBlock, MIN_BLOCK_WIDTH, MIN_BLOCK_HEIGHT } from '../model/Block.js';

const STATES = {
  IDLE: 'idle',
  PANNING: 'panning',
  DRAGGING_BLOCK: 'draggingBlock',
  RESIZING_BLOCK: 'resizingBlock',
};

/**
 * Explicit finite states rather than ad-hoc booleans — this is what makes
 * "drag block body" vs "drag resize handle" vs "pan background" unambiguous,
 * and gives Milestone 2 a clear place to add draggingPort/drawingConnection.
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
        block.geometry.x = this.context.startGeom.x + (world.x - this.context.startWorld.x);
        block.geometry.y = this.context.startGeom.y + (world.y - this.context.startWorld.y);
        this.requestRender();
        break;
      }
      case STATES.RESIZING_BLOCK: {
        const block = this.project.getBlock(this.context.blockId);
        if (!block) break;
        block.geometry.width = Math.max(
          MIN_BLOCK_WIDTH,
          this.context.startGeom.width + (world.x - this.context.startWorld.x),
        );
        block.geometry.height = Math.max(
          MIN_BLOCK_HEIGHT,
          this.context.startGeom.height + (world.y - this.context.startWorld.y),
        );
        this.requestRender();
        break;
      }
      default:
        break;
    }
  }

  onPointerUp() {
    if (this.state === STATES.DRAGGING_BLOCK || this.state === STATES.RESIZING_BLOCK) {
      const block = this.project.getBlock(this.context.blockId);
      if (block) touchBlock(block);
      this.persist();
    }
    this.state = STATES.IDLE;
    this.context = null;
  }

  onWheelZoom(screen, factor) {
    this.camera.zoomAt(screen.x, screen.y, factor);
    this.requestRender();
  }
}
