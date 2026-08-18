// Renders per-level diagrams and builds the payload googleDocSync.js pushes
// to a Google Doc. The tool stays the only source of truth for
// structure/layout; the Doc is a one-way, on-demand publish target, not
// something loaded back from.
import { Camera } from '../render/Camera.js';
import { renderScene } from '../render/SceneRenderer.js';

function pathToBlock(rootBlock, targetId) {
  if (rootBlock.id === targetId) return [];
  function search(block, currentPath) {
    if (!block.children) return null;
    for (const child of block.children.blocks.values()) {
      const nextPath = [...currentPath, child.id];
      if (child.id === targetId) return nextPath;
      const found = search(child, nextPath);
      if (found) return found;
    }
    return null;
  }
  return search(rootBlock, []) || [];
}

const EMPTY_BOUNDS = { x: 0, y: 0, width: 1, height: 1 };

const LEVEL_IMAGE_PADDING = 40;
// A diagram renders at native 1:1 scale (zoom stays 1) so text/port sizing
// looks identical to the live canvas — the image is CROPPED TO CONTENT
// instead of squeezing arbitrary content into a fixed frame. Only scaled
// down (never up) if a diagram is large enough that 1:1 would produce an
// unreasonably huge file.
const LEVEL_IMAGE_MAX_DIMENSION = 2200;

// One PNG per hierarchy level (every block with children), reusing the
// exact renderScene the live canvas uses — "using this tool as renderer."
// Works by briefly pointing the REAL project's `path` at each level in
// turn and restoring it synchronously afterward, so the live view never
// visibly changes and no second Project instance is needed. Transparent
// background (no grid, no canvas fill) so it drops cleanly onto a Doc page.
export function renderLevelImages(project) {
  const images = new Map();
  const originalPath = project.path;

  function capture(block) {
    if (!block.children) return;
    project.path = pathToBlock(project.rootBlock, block.id);

    const bounds = project.getLevelBounds() || EMPTY_BOUNDS;

    const rawWidth = bounds.width + LEVEL_IMAGE_PADDING * 2;
    const rawHeight = bounds.height + LEVEL_IMAGE_PADDING * 2;
    const zoom = Math.min(1, LEVEL_IMAGE_MAX_DIMENSION / rawWidth, LEVEL_IMAGE_MAX_DIMENSION / rawHeight);
    const width = Math.round(rawWidth * zoom);
    const height = Math.round(rawHeight * zoom);

    const camera = new Camera();
    camera.zoom = zoom;
    camera.offsetX = LEVEL_IMAGE_PADDING * zoom - bounds.x * zoom;
    camera.offsetY = LEVEL_IMAGE_PADDING * zoom - bounds.y * zoom;

    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    renderScene(canvas.getContext('2d'), camera, project, {
      selectedBlockId: null,
      selectedPortId: null,
      dpr: 1,
      canvasWidth: width,
      canvasHeight: height,
      pendingConnectionPath: null,
      connectionSource: null,
      connectionTarget: null,
      wireSelection: null,
      showGrid: false,
    });
    images.set(block.id, canvas.toDataURL('image/png'));

    for (const child of block.children.blocks.values()) capture(child);
  }

  capture(project.rootBlock);
  project.path = originalPath;
  return images;
}

// Every block in the tree, with its diagram (if any) attached — sending
// the whole tree keeps this simple rather than needing the client to track
// what's already been pushed.
export function buildUpdatePayload(project) {
  const images = renderLevelImages(project);
  const blocks = [];
  function walk(block) {
    blocks.push({
      id: block.id,
      name: block.name,
      description: block.description || '',
      imageDataUrl: images.get(block.id) || null,
    });
    if (block.children) for (const child of block.children.blocks.values()) walk(child);
  }
  walk(project.rootBlock);
  return blocks;
}
