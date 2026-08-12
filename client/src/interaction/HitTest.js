import { getResizeHandleWorldRect } from '../render/BlockRenderer.js';

// Handles are visually tiny, so their hit area is padded beyond what's drawn —
// a standard diagramming-tool trick, independent of render technology.
const HANDLE_HIT_PADDING = 6;

function pointInRect(px, py, rect, padding = 0) {
  return (
    px >= rect.x - padding &&
    px <= rect.x + rect.width + padding &&
    py >= rect.y - padding &&
    py <= rect.y + rect.height + padding
  );
}

/**
 * Tests smallest/highest-priority targets first (resize handle), then block
 * body, over blocks in reverse draw order (topmost first). Returns null if
 * nothing was hit (caller should start a pan/marquee instead).
 */
export function hitTest(project, worldX, worldY, selectedBlockId) {
  const blocks = project.listBlocks();

  if (selectedBlockId) {
    const selected = project.getBlock(selectedBlockId);
    if (selected) {
      const handleRect = getResizeHandleWorldRect(selected);
      if (pointInRect(worldX, worldY, handleRect, HANDLE_HIT_PADDING)) {
        return { type: 'resize', blockId: selected.id };
      }
    }
  }

  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    if (pointInRect(worldX, worldY, block.geometry)) {
      return { type: 'body', blockId: block.id };
    }
  }

  return null;
}
