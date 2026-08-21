const ZOOM_SPEED = 0.0015;

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a, b) {
  return { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 };
}

/**
 * Translates raw DOM pointer/wheel events into the {screen, world} pairs the
 * DragStateMachine works with. Uses pointer capture so a drag that leaves the
 * canvas bounds (fast mouse movement) keeps delivering move/up events.
 *
 * Pointer Events already unify mouse/touch/pen for a single active pointer,
 * which is why one-finger pan/tap/drag worked here with no touch-specific
 * code at all — but each finger of a multi-touch gesture is its own
 * separate pointer stream, and nothing below used to track more than one
 * at a time. A second finger landing just fired its own pointerdown into
 * the state machine as if it were an unrelated click, so pinch-to-zoom
 * never had a code path to run at all. `activePointers` is what closes
 * that gap: once two fingers are down, their movements are diffed against
 * each other for a pinch instead of being forwarded to the single-pointer
 * state machine individually.
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

  // Screen position of every pointer currently down, keyed by pointerId.
  const activePointers = new Map();
  // { lastDistance, lastMidpoint } while exactly two fingers are down and
  // being read as a pinch, else null.
  let pinch = null;

  canvas.addEventListener('pointerdown', (event) => {
    // The middle button is a universal "pan," even over a block/port/
    // boundary — browsers otherwise show an autoscroll icon for it, so
    // that default needs suppressing here too.
    if (event.button === 1) event.preventDefault();
    tryCapture(canvas.setPointerCapture, event.pointerId);
    const screen = toScreen(event);
    activePointers.set(event.pointerId, screen);

    if (activePointers.size === 2) {
      // A second finger landing mid-gesture: whatever the first finger's
      // own pointerdown already started (a pan, most likely) is no longer
      // a one-finger gesture, so it gets cancelled here rather than
      // continuing to run underneath the pinch.
      stateMachine.onPointerUp();
      const [p1, p2] = activePointers.values();
      pinch = { lastDistance: distance(p1, p2), lastMidpoint: midpoint(p1, p2) };
      return;
    }
    if (activePointers.size > 2) {
      // A third finger isn't a gesture this app reads at all — stop
      // reacting to anything until it's back down to one or two.
      pinch = null;
      return;
    }

    const world = camera.screenToWorld(screen.x, screen.y);
    stateMachine.onPointerDown(screen, world, {
      shiftKey: event.shiftKey,
      // Cmd is treated the same as Ctrl here, matching every other
      // Ctrl-based shortcut in the app (undo, save, ...) — Mac users don't
      // have a separate "Ctrl-click" gesture, Cmd-click is it.
      ctrlKey: event.ctrlKey || event.metaKey,
      button: event.button,
    });
    canvas.style.cursor = stateMachine.getCursor();
  });

  // On a Mac without a two-button mouse, Ctrl-click is also the OS gesture
  // for "open the context menu" — left unblocked, it would pop a browser
  // menu over the diagram exactly when someone is trying to add to a
  // selection. Scoped to the Ctrl-held case only, so a real right-click
  // still has room for a context menu later.
  canvas.addEventListener('contextmenu', (event) => {
    if (event.ctrlKey || event.metaKey) event.preventDefault();
  });

  canvas.addEventListener('pointermove', (event) => {
    const screen = toScreen(event);
    if (activePointers.has(event.pointerId)) activePointers.set(event.pointerId, screen);

    if (pinch && activePointers.size === 2) {
      const [p1, p2] = activePointers.values();
      const dist = distance(p1, p2);
      const mid = midpoint(p1, p2);
      if (pinch.lastDistance > 0 && dist > 0) {
        stateMachine.onPinchZoom(
          pinch.lastMidpoint,
          dist / pinch.lastDistance,
          mid.x - pinch.lastMidpoint.x,
          mid.y - pinch.lastMidpoint.y,
        );
      }
      pinch.lastDistance = dist;
      pinch.lastMidpoint = mid;
      canvas.style.cursor = stateMachine.getCursor();
      return;
    }
    // More than one finger down but not resolved into a pinch (the third
    // finger case above) — ignore until it's back to a single pointer.
    if (activePointers.size >= 2) return;

    const world = camera.screenToWorld(screen.x, screen.y);
    stateMachine.onPointerMove(screen, world);
    canvas.style.cursor = stateMachine.getCursor();
  });

  canvas.addEventListener('pointerup', (event) => {
    tryCapture(canvas.releasePointerCapture, event.pointerId);
    const wasPinching = Boolean(pinch) && activePointers.size === 2;
    activePointers.delete(event.pointerId);

    if (wasPinching) {
      pinch = null;
      // A finger may still be down after the pinch ends — read it as a
      // fresh press from wherever it already is, rather than leaving it
      // dead until the next tap or feeding its pinch-era movement into a
      // drag as though it had been pressed there the whole time (which
      // would jump).
      if (activePointers.size === 1) {
        const [remaining] = activePointers.values();
        const world = camera.screenToWorld(remaining.x, remaining.y);
        stateMachine.onPointerDown(remaining, world, { shiftKey: false, ctrlKey: false, button: 0 });
      }
      canvas.style.cursor = stateMachine.getCursor();
      return;
    }
    // A third finger was down (ignored above) and this wasn't it — still
    // one or more fingers left, nothing to resolve yet.
    if (activePointers.size >= 1) return;

    const screen = toScreen(event);
    const world = camera.screenToWorld(screen.x, screen.y);
    stateMachine.onPointerUp(world);
    canvas.style.cursor = stateMachine.getCursor();
  });

  canvas.addEventListener('pointercancel', (event) => {
    activePointers.delete(event.pointerId);
    pinch = null;
    stateMachine.onPointerUp();
  });

  canvas.addEventListener('dblclick', (event) => {
    const screen = toScreen(event);
    const world = camera.screenToWorld(screen.x, screen.y);
    stateMachine.onDoubleClick(world);
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
