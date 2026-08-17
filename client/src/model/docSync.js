// Publishes block descriptions + diagrams into a Google Doc, wherever the
// user has manually placed an anchored region for that block — see
// appsscript/Code.gs for the server side of this contract and
// appsscript/README.md for the region syntax and setup. The tool stays the
// only source of truth for structure/layout; the Doc is a one-way,
// on-demand publish target, not something loaded back from.
import { Camera } from '../render/Camera.js';
import { renderScene } from '../render/SceneRenderer.js';

// The exact text a region needs — the app's own per-block description DSL
// (already parsed/serialized elsewhere, see BlockDescription.js) plus a
// diagram placeholder. `id` is what lets a later Update find this same
// region again regardless of what prose the user has since written around
// it. Copy this into the Doc anywhere; the surrounding text is never
// touched.
export function buildRegionSnippet(block) {
  const lines = [
    `[block-modeler:begin id=${block.id}]`,
    block.description || `Block: ${block.name}`,
  ];
  if (block.hasChildren) {
    lines.push('', '{diagram}');
  }
  lines.push(`[block-modeler:end id=${block.id}]`);
  return lines.join('\n');
}

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

function computeLevelBounds(project, boundary) {
  let minX = boundary ? boundary.geometry.x : Infinity;
  let minY = boundary ? boundary.geometry.y : Infinity;
  let maxX = boundary ? boundary.geometry.x + boundary.geometry.width : -Infinity;
  let maxY = boundary ? boundary.geometry.y + boundary.geometry.height : -Infinity;
  for (const block of project.listBlocks()) {
    minX = Math.min(minX, block.geometry.x);
    minY = Math.min(minY, block.geometry.y);
    maxX = Math.max(maxX, block.geometry.x + block.geometry.width);
    maxY = Math.max(maxY, block.geometry.y + block.geometry.height);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 1, height: 1 };
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

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

    const containerBlock = project.getContainerBlock();
    const boundary = containerBlock?.boundaryGeometry
      ? { block: containerBlock, geometry: containerBlock.boundaryGeometry }
      : null;
    const bounds = computeLevelBounds(project, boundary);

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

// Every block in the tree, with the diagram (if any) attached — Apps
// Script decides which ones actually have a region to update; sending the
// whole tree keeps this simple rather than needing the client to somehow
// know in advance what's been placed in the Doc.
export function buildUpdatePayload(project) {
  const images = renderLevelImages(project);
  const blocks = [];
  function walk(block) {
    blocks.push({ id: block.id, description: block.description || '', imageDataUrl: images.get(block.id) || null });
    if (block.children) for (const child of block.children.blocks.values()) walk(child);
  }
  walk(project.rootBlock);
  return blocks;
}

export async function updateDoc(webAppUrl, blocks) {
  const res = await fetch(webAppUrl, {
    method: 'POST',
    // A plain-text content type keeps this a CORS "simple request" — Apps
    // Script Web Apps can't answer a preflight OPTIONS request the way a
    // normal server can, so anything that would trigger one just fails.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'update', blocks }),
  });
  if (!res.ok) throw new Error(`Update failed (${res.status})`);
  return res.json(); // { ok:true, updated:[ids], skipped:[ids] }
}
