/**
 * Single rAF loop, gated by a dirty flag so we don't burn CPU redrawing an
 * idle canvas — every mutation calls requestRender() explicitly rather than
 * this looping continuously.
 */
export class RenderLoop {
  constructor(drawFn) {
    this.drawFn = drawFn;
    this.dirty = true;
    this.running = false;
  }

  requestRender() {
    this.dirty = true;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      if (this.dirty) {
        this.dirty = false;
        this.drawFn();
      }
      requestAnimationFrame(tick);
    };
    requestAnimationFrame(tick);
  }

  stop() {
    this.running = false;
  }
}
