// Single source of truth for the grid every block position/size and port
// position snaps to — game-like placement (Factorio/AoE), not freeform.
export const GRID_SIZE = 40;

// Shared with BlockDescription.js (default port layout) so both stay in sync
// with BlockRenderer's actual drawn header without a circular import between
// the two.
export const HEADER_HEIGHT = 26;

export function snap(value) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Keeps a dragged port's offset from ever reaching the block's bottom
// corner, where it would sit inside the resize handle's hit area and become
// ungrabbable afterward (the resize handle takes priority there). The
// resize handle's own padded hit box already reaches ~11px from the corner,
// and the port's padded hit circle reaches another ~11px from its center,
// so the margin needs to clear both.
const PORT_EDGE_MARGIN = 25;

export function getPortOffsetBounds(blockHeight) {
  return { min: HEADER_HEIGHT, max: blockHeight - PORT_EDGE_MARGIN };
}
