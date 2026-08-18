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

  // Frames `bounds` (a world-space rect) in a viewport of the given size:
  // centered, and zoomed out only as far as needed to fit. Never zooms
  // past 1 — entering a level with one small block should show it at
  // normal size in the middle, not blown up to fill the screen.
  centerOn(bounds, viewportWidth, viewportHeight, padding = 60) {
    if (!bounds || viewportWidth <= 0 || viewportHeight <= 0) return;
    const availableWidth = Math.max(1, viewportWidth - padding * 2);
    const availableHeight = Math.max(1, viewportHeight - padding * 2);
    this.zoom = Math.min(1, availableWidth / bounds.width, availableHeight / bounds.height);
    this.offsetX = viewportWidth / 2 - (bounds.x + bounds.width / 2) * this.zoom;
    this.offsetY = viewportHeight / 2 - (bounds.y + bounds.height / 2) * this.zoom;
  }

  // dpr folds in devicePixelRatio so the camera transform and the canvas's
  // physical-pixel backing store combine into a single setTransform call.
  applyTransform(ctx, dpr = 1) {
    ctx.setTransform(this.zoom * dpr, 0, 0, this.zoom * dpr, this.offsetX * dpr, this.offsetY * dpr);
  }
}
