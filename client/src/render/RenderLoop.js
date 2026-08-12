/**
 * Single rAF loop, gated by a dirty flag so we don't burn CPU redrawing an
 * idle canvas. Milestone 3's FlowAnimator will call requestRender() every
 * frame while an animation is active instead of relying on this dirty flag.
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
