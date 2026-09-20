// The transform between a nested level and the root level.
//
// Every container block's frame is a scaled picture of its face (see
// model/levelGeometry.js), so a chain of containers — root, a block in
// the root level, a block inside that, ... — composes into one similarity
// transform between the innermost level's coordinates and the root's.
// The scene is always drawn from the root through that chain (see
// SceneRenderer.renderScene), while the camera, hit-testing and every
// edit keep working in the coordinates of the level being edited. These
// three functions are the only place the two meet.
import { frameToFace } from '../model/levelGeometry.js';

// `chain` lists the container blocks from the root level down to the
// level in question, outermost first (see Project.getPathBlocks). The
// result maps a point in that level to the root level:
// rootPoint = point * scale + offset. An empty chain is the identity.
export function chainToRoot(chain) {
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  for (const block of chain) {
    if (!block?.boundaryGeometry) continue;
    const t = frameToFace(block.geometry, block.boundaryGeometry);
    // parentPoint = t.scale * point + t.offset, and the accumulated
    // transform then carries parentPoint the rest of the way up.
    offsetX += scale * t.offsetX;
    offsetY += scale * t.offsetY;
    scale *= t.scale;
  }
  return { scale, offsetX, offsetY };
}

// A camera expressed in a level's coordinates, as the equivalent camera
// in root coordinates — the one that puts every root-level point on the
// same screen pixel: screen = zoom * point + offset with
// point = (rootPoint - T.offset) / T.scale.
export function rootCameraFor(camera, transform) {
  const zoom = camera.zoom / transform.scale;
  return {
    zoom,
    offsetX: camera.offsetX - zoom * transform.offsetX,
    offsetY: camera.offsetY - zoom * transform.offsetY,
  };
}

// The inverse of rootCameraFor: a root camera re-based into a level.
export function levelCameraFor(rootCamera, transform) {
  return {
    zoom: rootCamera.zoom * transform.scale,
    offsetX: rootCamera.offsetX + rootCamera.zoom * transform.offsetX,
    offsetY: rootCamera.offsetY + rootCamera.zoom * transform.offsetY,
  };
}

// One step down: the camera for a child level drawn on `block`'s face,
// given the camera of the level `block` sits in.
export function childCameraFor(camera, block) {
  return levelCameraFor(camera, chainToRoot([block]));
}

export function screenToWorldWith(camera, x, y) {
  return { x: (x - camera.offsetX) / camera.zoom, y: (y - camera.offsetY) / camera.zoom };
}

export function worldToScreenWith(camera, x, y) {
  return { x: x * camera.zoom + camera.offsetX, y: y * camera.zoom + camera.offsetY };
}
