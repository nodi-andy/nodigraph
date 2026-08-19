// Renders per-level diagrams and builds the payload googleDocSync.js pushes
// to a Google Doc. The tool stays the only source of truth for
// structure/layout; the Doc is a one-way, on-demand publish target, not
// something loaded back from.
import { renderCurrentLevelDataUrl } from './diagramImage.js';

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

// One PNG per hierarchy level (every block with children). Works by
// briefly pointing the REAL project's `path` at each level in turn and
// restoring it synchronously afterward, so the live view never visibly
// changes and no second Project instance is needed.
export function renderLevelImages(project) {
  const images = new Map();
  const originalPath = project.path;

  function capture(block) {
    if (!block.children) return;
    project.path = pathToBlock(project.rootBlock, block.id);
    images.set(block.id, renderCurrentLevelDataUrl(project));
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
