import {
  getAllPortPositions,
  getConnectorHandlePosition,
  getResizeHandleRects,
  getBoundaryLabelRect,
  getPortSlotRect,
  PORT_RADIUS,
  CONNECTOR_HANDLE_RADIUS,
} from '../render/BlockRenderer.js';

// Handles are visually tiny, so their hit area is padded beyond what's drawn —
// a standard diagramming-tool trick, independent of render technology.
const HANDLE_HIT_PADDING = 6;
// Resize handles already float well clear of the block (see
// BlockRenderer.RESIZE_HANDLE_OUTSET) — a slightly bigger pad than the
// ports get costs nothing, and a bigger, easier-to-grab target is exactly
// the point of them existing on a touch screen.
const RESIZE_HANDLE_HIT_PADDING = 8;

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

function hitResizeHandle(geometry, worldX, worldY) {
  for (const rect of Object.values(getResizeHandleRects(geometry))) {
    if (pointInRect(worldX, worldY, rect, RESIZE_HANDLE_HIT_PADDING)) return rect.side;
  }
  return null;
}

function hitPortsAcrossBlocks(blocks, worldX, worldY, inverted = false) {
  // Connector handles first — they're the outermost/smallest target, and
  // sit close enough to their port that ambiguity should favor "start a wire"
  // when the cursor is right at the tip.
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    for (const { port, x, y } of getAllPortPositions(block)) {
      const handle = getConnectorHandlePosition({ x, y }, port.side, inverted);
      if (pointInCircle(worldX, worldY, handle.x, handle.y, CONNECTOR_HANDLE_RADIUS + HANDLE_HIT_PADDING)) {
        return { type: 'connector', blockId: block.id, portId: port.id };
      }
    }
  }

  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    for (const { port, x, y } of getAllPortPositions(block)) {
      // An ordinary block's port is drawn as a slot inset into the face
      // (see BlockRenderer's getSlotRectFromBorderPoint), not a dot on the
      // border — hit-test the actual rect drawn, not just a small circle
      // at its outer edge, or most of the visible square wouldn't be
      // clickable. The boundary frame's ports still render as plain dots.
      const hit = inverted
        ? pointInCircle(worldX, worldY, x, y, PORT_RADIUS + HANDLE_HIT_PADDING)
        : pointInRect(worldX, worldY, getPortSlotRect(block, port), HANDLE_HIT_PADDING);
      if (hit) {
        return { type: 'port', blockId: block.id, portId: port.id };
      }
    }
  }

  return null;
}

/**
 * Tests smallest/highest-priority targets first: port connector/move
 * handles across every block (including the surrounding boundary frame's
 * own ports) win over everything, then the boundary's own title, then a
 * resize handle — only for `resizableBlockId`, the one ordinary block
 * currently allowed to show them, or the boundary frame unconditionally
 * (see DragStateMachine.getResizableBlockId) — then block body, then the
 * boundary's own resize handle dead last. `boundary`, when the current
 * level has one, is `{ block, geometry }` for the container you're inside.
 * Returns null if nothing was hit (caller should try a wire trunk, then
 * fall back to pan/marquee).
 */
export function hitTest(project, worldX, worldY, boundary, resizableBlockId) {
  const blocks = project.listBlocks();

  // Ports outrank a resize handle exactly like they outranked the old
  // border-drag zone: a port is the more specific target, so on the rare
  // occasion a handle and a port's connector reach do overlap, the port
  // still wins.
  const portHit = hitPortsAcrossBlocks(blocks, worldX, worldY);
  if (portHit) return portHit;

  if (boundary) {
    const boundaryView = { ...boundary.block, geometry: boundary.geometry };
    const boundaryPortHit = hitPortsAcrossBlocks([boundaryView], worldX, worldY, true);
    if (boundaryPortHit) return boundaryPortHit;

    // The frame's title, sitting just above its top-left corner — a click
    // there renames the block you're inside. Checked before the blocks
    // below since it's outside the frame and can overlap one of them.
    const labelRect = getBoundaryLabelRect(boundary.block, boundary.geometry);
    if (pointInRect(worldX, worldY, labelRect, 2)) {
      return { type: 'boundaryLabel', blockId: boundary.block.id };
    }
  }

  // The one ordinary block currently allowed to show resize handles (see
  // DragStateMachine.getResizableBlockId) — checked before any block's
  // body so a handle floating just past this block's own border isn't
  // swallowed by "drag to move" if it happens to sit over another block.
  if (resizableBlockId) {
    const block = project.getBlock(resizableBlockId);
    if (block) {
      const side = hitResizeHandle(block.geometry, worldX, worldY);
      if (side) return { type: 'resizeHandle', blockId: block.id, side, isBoundary: false };
    }
  }

  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    if (pointInRect(worldX, worldY, block.geometry)) {
      return { type: 'body', blockId: block.id };
    }
  }

  if (boundary) {
    // Checked dead last, same position the old boundaryEdge hit held: a
    // child block drawn over part of the boundary's own resize zone
    // should still win the body check above it.
    const side = hitResizeHandle(boundary.geometry, worldX, worldY);
    if (side) return { type: 'resizeHandle', blockId: boundary.block.id, side, isBoundary: true };
  }

  return null;
}
