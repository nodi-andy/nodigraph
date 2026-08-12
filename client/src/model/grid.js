// Single source of truth for the grid every block position/size and port
// position snaps to — game-like placement (Factorio/AoE), not freeform.
export const GRID_SIZE = 40;

// A wire's stub always extends one grid cell out from the port before it's
// allowed to turn — this is what gives paved wires their "leaves the block,
// then routes" look instead of a corner right at the border.
export const WIRE_STUB_LENGTH = GRID_SIZE;

export const SIDES = ['left', 'right', 'top', 'bottom'];

export function sideNormal(side) {
  switch (side) {
    case 'left':
      return { x: -1, y: 0 };
    case 'right':
      return { x: 1, y: 0 };
    case 'top':
      return { x: 0, y: -1 };
    case 'bottom':
      return { x: 0, y: 1 };
    default:
      return { x: 0, y: 0 };
  }
}

// Which axis a port's border-hugging offset runs along, and which axis a
// wire travels along as it leaves/arrives at that side.
export function sideAxis(side) {
  return side === 'left' || side === 'right' ? 'x' : 'y';
}

export function snap(value) {
  return Math.round(value / GRID_SIZE) * GRID_SIZE;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

// Keeps a port from ever sliding into a block's corner — both because a
// corner is where the resize handle's padded hit box lives (a port there
// would become ungrabbable), and because it just looks wrong tucked into
// the rounded corner radius.
const PORT_EDGE_MARGIN = 25;

export function getPortOffsetBounds(sideLength) {
  return { min: PORT_EDGE_MARGIN, max: Math.max(PORT_EDGE_MARGIN, sideLength - PORT_EDGE_MARGIN) };
}
