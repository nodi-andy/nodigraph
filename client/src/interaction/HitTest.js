import {
  getResizeHandleWorldRect,
  getPortPositions,
  getConnectorHandlePosition,
  PORT_RADIUS,
  CONNECTOR_HANDLE_RADIUS,
} from '../render/BlockRenderer.js';

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

function pointInCircle(px, py, cx, cy, radius) {
  const dx = px - cx;
  const dy = py - cy;
  return dx * dx + dy * dy <= radius * radius;
}

function hitPortsAcrossBlocks(blocks, worldX, worldY) {
  // Connector handles first — they're the outermost/smallest target, and
  // sit close enough to their port that ambiguity should favor "start a wire"
  // when the cursor is right at the tip.
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    for (const direction of ['in', 'out']) {
      for (const { port, x, y } of getPortPositions(block, direction)) {
        const handle = getConnectorHandlePosition({ x, y }, direction);
        if (pointInCircle(worldX, worldY, handle.x, handle.y, CONNECTOR_HANDLE_RADIUS + HANDLE_HIT_PADDING)) {
          return { type: 'connector', blockId: block.id, portId: port.id };
        }
      }
    }
  }

  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    for (const direction of ['in', 'out']) {
      for (const { port, x, y } of getPortPositions(block, direction)) {
        if (pointInCircle(worldX, worldY, x, y, PORT_RADIUS + HANDLE_HIT_PADDING)) {
          return { type: 'port', blockId: block.id, portId: port.id };
        }
      }
    }
  }

  return null;
}

/**
 * Tests smallest/highest-priority targets first (resize handle, then port
 * connector/move handles across every block, then block body), over blocks
 * in reverse draw order (topmost first). Returns null if nothing was hit
 * (caller should start a pan/marquee instead).
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

  const portHit = hitPortsAcrossBlocks(blocks, worldX, worldY);
  if (portHit) return portHit;

  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    if (pointInRect(worldX, worldY, block.geometry)) {
      return { type: 'body', blockId: block.id };
    }
  }

  return null;
}
