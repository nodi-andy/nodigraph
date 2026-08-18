import {
  getAllPortPositions,
  getConnectorHandlePosition,
  getBorderHit,
  getBoundaryLabelRect,
  getPortSlotRect,
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
 * Tests smallest/highest-priority targets first (port connector/move
 * handles across every block — including the surrounding boundary frame's
 * own ports — then block body, then the boundary's empty body last since
 * it covers the whole level). `boundary`, when the current level has one,
 * is `{ block, geometry }` for the container you're inside. Returns null
 * if nothing was hit (caller should try a wire trunk, then fall back to
 * pan/marquee).
 */
export function hitTest(project, worldX, worldY, boundary) {
  const blocks = project.listBlocks();

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

  // A precise click right on a block's own border is ambiguous the same
  // way the boundary's own edge already was (see 'boundaryEdge' below): a
  // release without much movement adds a port there, a drag past the
  // threshold resizes that edge instead (splitter-style — DragStateMachine
  // handles both hit types the same way). Checked before the body so it
  // doesn't get swallowed by "drag to move," but after ports so it never
  // shadows a more specific handle.
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    const border = getBorderHit(block.geometry, worldX, worldY);
    if (border) {
      return { type: 'border', blockId: block.id, side: border.side, offset: border.offset };
    }
  }

  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    if (pointInRect(worldX, worldY, block.geometry)) {
      return { type: 'body', blockId: block.id };
    }
  }

  if (boundary) {
    // A child block drawn over part of the boundary's edge should win —
    // hence this is checked only after every real block's body above. The
    // boundary's plain interior isn't a click target at all: there's
    // nothing to select there, so an unmatched click here just falls
    // through to a wire-trunk check and then panning.
    const edge = getBorderHit(boundary.geometry, worldX, worldY);
    if (edge) {
      return { type: 'boundaryEdge', blockId: boundary.block.id, side: edge.side, offset: edge.offset };
    }
  }

  return null;
}
