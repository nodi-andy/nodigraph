const ZOOM_SPEED = 0.0015;

/**
 * Translates raw DOM pointer/wheel events into the {screen, world} pairs the
 * DragStateMachine works with. Uses pointer capture so a drag that leaves the
 * canvas bounds (fast mouse movement) keeps delivering move/up events.
 */
export function attachInputRouter(canvas, camera, stateMachine) {
  const toScreen = (event) => {
    const rect = canvas.getBoundingClientRect();
    return { x: event.clientX - rect.left, y: event.clientY - rect.top };
  };

  // Capture is best-effort: it keeps a fast drag delivering events once the
  // cursor leaves the canvas, but a capture failure (seen in the wild for
  // synthetic/edge-case pointers) must never block the interaction logic below.
  const tryCapture = (fn, pointerId) => {
    try {
      fn.call(canvas, pointerId);
    } catch {
      // no-op: continue handling the event without capture
    }
  };

  canvas.addEventListener('pointerdown', (event) => {
    tryCapture(canvas.setPointerCapture, event.pointerId);
    const screen = toScreen(event);
    const world = camera.screenToWorld(screen.x, screen.y);
    stateMachine.onPointerDown(screen, world);
  });

  canvas.addEventListener('pointermove', (event) => {
    const screen = toScreen(event);
    const world = camera.screenToWorld(screen.x, screen.y);
    stateMachine.onPointerMove(screen, world);
  });

  canvas.addEventListener('pointerup', (event) => {
    tryCapture(canvas.releasePointerCapture, event.pointerId);
    const screen = toScreen(event);
    const world = camera.screenToWorld(screen.x, screen.y);
    stateMachine.onPointerUp(world);
  });

  canvas.addEventListener('pointercancel', () => {
    stateMachine.onPointerUp();
  });

  canvas.addEventListener(
    'wheel',
    (event) => {
      event.preventDefault();
      const screen = toScreen(event);
      const factor = Math.exp(-event.deltaY * ZOOM_SPEED);
      stateMachine.onWheelZoom(screen, factor);
    },
    { passive: false },
  );
}
