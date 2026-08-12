// Single source of truth for the grid every block position/size and (later)
// port position snaps to — game-like placement (Factorio/AoE), not freeform.
export const GRID_SIZE = 40;

export function snap(value) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}
