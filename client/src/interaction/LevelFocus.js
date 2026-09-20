/**
 * Which level a pointer is editing.
 *
 * The scene is drawn from the root with every level open on its block's
 * face (see render/SubPreviewRenderer.js), so what is under the pointer
 * may belong to any depth: a block of the level being edited, a child
 * drawn inside one of its blocks, a grandchild inside that. Every edit
 * still happens in one level — the camera, hit-testing, selection and
 * the drag state machine all work in the coordinates of project.path —
 * so a click first decides which level that is. This walks down from the
 * root: at each level, hit-test the pointer; if it lands on the body of a
 * container whose level is drawn at full detail, look inside; keep going
 * while there is something to hit inside (a block, a pin, a wire) or the
 * container fills the view (then its empty space is the space you are
 * standing in, and a click there deselects or starts a marquee exactly as
 * empty root canvas would). Stop otherwise, and the container's body is
 * the hit — a container that sits well inside the view is still a block
 * you move as a whole by grabbing its empty parts.
 *
 * The result is a path and the camera re-based into that level (see
 * render/levelTransform.js), which the caller applies; nothing on screen
 * moves, because the level was already drawn where it is.
 */
import { hitTest } from './HitTest.js';
import { LevelView } from '../model/levelView.js';
import { hasSubArchitecture } from '../render/BlockRenderer.js';
import { isLevelEditable, MAX_DEPTH } from '../render/SubPreviewRenderer.js';
import { getConnectionGeometry, hitTestConnectionPath } from '../render/ConnectionRenderer.js';
import { chainToRoot, rootCameraFor, childCameraFor, screenToWorldWith, worldToScreenWith } from '../render/levelTransform.js';

// How much of the view a container's face has to cover before its empty
// interior counts as "the space you are standing in" rather than as the
// container's own body.
const FILLS_VIEW_FRACTION = 0.85;

function coversView(geometry, camera, viewport) {
  if (!viewport || viewport.width <= 0 || viewport.height <= 0) return false;
  const topLeft = worldToScreenWith(camera, geometry.x, geometry.y);
  const bottomRight = worldToScreenWith(camera, geometry.x + geometry.width, geometry.y + geometry.height);
  const w = Math.max(0, Math.min(bottomRight.x, viewport.width) - Math.max(topLeft.x, 0));
  const h = Math.max(0, Math.min(bottomRight.y, viewport.height) - Math.max(topLeft.y, 0));
  return (w * h) / (viewport.width * viewport.height) >= FILLS_VIEW_FRACTION;
}

function hitWire(view, boundary, x, y) {
  for (const connection of view.listConnections()) {
    const geometry = getConnectionGeometry(view, connection, boundary);
    if (geometry && hitTestConnectionPath(geometry, x, y)) return { type: 'connection', connectionId: connection.id };
  }
  return null;
}

function boundaryOf(container) {
  return container?.boundaryGeometry ? { block: container, geometry: container.boundaryGeometry } : null;
}

/**
 * Resolves the level a pointer at `screen` would edit.
 *
 * `camera` is the live camera, in the coordinates of project.path;
 * `viewport` is { width, height } of the canvas in CSS pixels. `canEnter`
 * is the host's veto on entering a specific block (see main.js's
 * canEnterBlock). Returns { path, camera } — the path of the level to
 * edit and the camera re-based into it — or null when the pointer's
 * level is the one already being edited.
 */
export function resolveFocus(project, camera, screen, viewport, { canEnter = () => true } = {}) {
  let cam = rootCameraFor(camera, chainToRoot(project.getPathBlocks()));
  let container = project.rootBlock;
  const path = [];

  for (let depth = 0; depth < MAX_DEPTH; depth += 1) {
    const view = new LevelView(container);
    const world = screenToWorldWith(cam, screen.x, screen.y);
    const hit = hitTest(view, world.x, world.y, boundaryOf(container), null, null, cam.zoom);
    if (!hit || hit.type === 'link') break;
    // The level already being edited keeps the pointer as long as it lands
    // anywhere on its container — its pins included: seen from inside they
    // are the frame's own pins, and grabbing one is how a pin is moved or
    // wired from in there. Only a click outside the container, or on
    // something that belongs to another level, moves the focus out.
    const staying = project.path[depth] === hit.blockId;
    if (hit.type !== 'body' && !staying) break;
    const block = view.getBlock(hit.blockId);
    if (!block || block.kind === 'text' || !hasSubArchitecture(block) || !block.boundaryGeometry) break;
    const childCamera = childCameraFor(cam, block);

    if (!staying) {
      if (!canEnter(block) || !isLevelEditable(block, cam.zoom)) break;
      const childView = new LevelView(block);
      const childWorld = screenToWorldWith(childCamera, screen.x, screen.y);
      const childBoundary = boundaryOf(block);
      const inside =
        hitTest(childView, childWorld.x, childWorld.y, childBoundary, null, null, childCamera.zoom)
        || hitWire(childView, childBoundary, childWorld.x, childWorld.y);
      if (!inside && !coversView(block.geometry, cam, viewport)) break;
    }

    path.push(block.id);
    container = block;
    cam = childCamera;
  }

  if (path.length === project.path.length && path.every((id, i) => id === project.path[i])) return null;
  return { path, camera: cam };
}
