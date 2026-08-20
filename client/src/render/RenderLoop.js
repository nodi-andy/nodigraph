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
    this.continuous = false;
  }

  requestRender() {
    this.dirty = true;
  }

  // Holds the loop open for something that changes on its own rather than
  // in response to an edit — currently the wire flow animation, which has
  // no mutation to hang a requestRender() off.
  setContinuous(on) {
    this.continuous = on;
    if (on) this.dirty = true;
  }

  start() {
    if (this.running) return;
    this.running = true;
    const tick = () => {
      if (!this.running) return;
      if (this.dirty || this.continuous) {
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
