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

// Derived from the slot grid rather than an independent margin: a port can
// only ever sit on a slot, so the valid offset range is exactly "first slot
// to last slot". Keeping these as separate numbers is what previously made
// the outermost slots unusable — a 25px margin clamped the first slot (20)
// inward and pushed the last one (sideLength - 20) back off the grid.
export function getPortOffsetBounds(sideLength) {
  const slots = getPortSlotOffsets(sideLength);
  return { min: slots[0], max: slots[slots.length - 1] };
}

// One slot per grid cell — a side that's N grid cells long gets N slots
// (a 4-cell/160px side gets 4), so the connector count scales directly
// with how big the block is in grid terms.
export const PORT_SLOT_SPACING = GRID_SIZE;

// The fixed "connector socket" positions along a side of this length — a
// port sits at one of these now, not anywhere along the edge. Each slot is
// a grid cell's own center (GRID_SIZE/2, GRID_SIZE*1.5, ...), not a value
// stretched to span the full margin-to-margin range: since every block's
// own position is itself grid-snapped, `geometry.x/y + offset` always
// lands on the same fixed family of half-grid-cell absolute positions
// regardless of this particular block's size — which is what lets two
// *different* blocks' ports (or a block's and the boundary's) end up on
// the exact same absolute row/column and produce a straight wire, instead
// of each side computing its own independent, unaligned spacing. It also
// means an even slot count no longer clusters both slots at the two
// corners with nothing near the middle. Always at least one slot, even on
// a very short side.
export function getPortSlotOffsets(sideLength) {
  const cellCount = Math.max(1, Math.floor(sideLength / PORT_SLOT_SPACING));
  return Array.from({ length: cellCount }, (_, i) => GRID_SIZE / 2 + i * GRID_SIZE);
}

// The nearest slot to `offset`, preferring one not already in `occupied`
// so two ports don't land on top of each other — but if every slot on this
// side is already taken, still resolves to the nearest one rather than
// refusing the drop.
export function nearestPortSlot(sideLength, offset, occupied = []) {
  const slots = getPortSlotOffsets(sideLength);
  const free = slots.filter((s) => !occupied.includes(s));
  const pool = free.length ? free : slots;
  return pool.reduce((best, s) => (Math.abs(s - offset) < Math.abs(best - offset) ? s : best), pool[0]);
}

// The boundary is just a container for a block's own IOs, not a frame that
// has to enclose its children — this is its starting size/position the
// first time a block is entered; from then on it's whatever the user has
// dragged it to (see DragStateMachine's boundary-edge splitter drag).
export function createDefaultBoundaryGeometry() {
  return { x: 0, y: 0, width: GRID_SIZE * 8, height: GRID_SIZE * 6 };
}
