const MIN_ZOOM = 0.1;
const MAX_ZOOM = 4;

/**
 * All world<->screen conversion lives here so rendering and hit-testing
 * never disagree about where something is on screen.
 */
export class Camera {
  constructor() {
    this.offsetX = 0;
    this.offsetY = 0;
    this.zoom = 1;
  }

  worldToScreen(x, y) {
    return { x: x * this.zoom + this.offsetX, y: y * this.zoom + this.offsetY };
  }

  screenToWorld(x, y) {
    return { x: (x - this.offsetX) / this.zoom, y: (y - this.offsetY) / this.zoom };
  }

  pan(dx, dy) {
    this.offsetX += dx;
    this.offsetY += dy;
  }

  zoomAt(screenX, screenY, factor) {
    const newZoom = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, this.zoom * factor));
    const worldBefore = this.screenToWorld(screenX, screenY);
    this.zoom = newZoom;
    const worldAfterScreen = this.worldToScreen(worldBefore.x, worldBefore.y);
    // Keep the point under the cursor stationary on screen while zooming.
    this.offsetX += screenX - worldAfterScreen.x;
    this.offsetY += screenY - worldAfterScreen.y;
  }

  // dpr folds in devicePixelRatio so the camera transform and the canvas's
  // physical-pixel backing store combine into a single setTransform call.
  applyTransform(ctx, dpr = 1) {
    ctx.setTransform(this.zoom * dpr, 0, 0, this.zoom * dpr, this.offsetX * dpr, this.offsetY * dpr);
  }
}
