import {
  clamp,
  snap,
  sideNormal,
  sideAxis,
  getPortOffsetBounds,
  getPortSlotOffsets,
  nearestPortSlot,
  PORT_SLOT_SPACING,
  SIDES,
} from '../model/grid.js';
import { getStateColor, logicalPortOf } from '../model/BlockDescription.js';
import { DEFAULT_BLOCK_COLOR } from '../model/Block.js';
import { isImageUrl, getCachedImage } from './imageCache.js';
import { getCanvasPalette } from './canvasPalette.js';
import { getFontFamily, ensureFontLoaded } from './fonts.js';

const DEFAULT_PALETTE = getCanvasPalette('light');

const CORNER_RADIUS = 6;
// The drawn arrowhead is smaller than this — it's the hit-test radius
// around the handle's tip, padded like every other small handle.
export const CONNECTOR_HANDLE_RADIUS = 4;
export const CONNECTOR_NUB_LENGTH = 14;
const CONNECTOR_ARROW_SIZE = 8;
// An ordinary block's ports straddle its own border rather than sitting
// fully inside it — half juts out toward the connector handle it leads
// to, half stays inset in the block's face — sized like a short length of
// pipe: its cross-section (PORT_WIDTH) matches the connector handle it
// feeds, and it runs 1.5x that long (PORT_LENGTH) in the direction the
// wire travels. The boundary frame (drawBoundary) keeps the older dot
// style since it's a dashed abstract container, not a solid face with a
// border to straddle.
export const PORT_WIDTH = CONNECTOR_ARROW_SIZE;
export const PORT_LENGTH = PORT_WIDTH * 1.5;
// A boundary port draws as its own small block straddling the dashed
// line, not a pipe-sized sliver — big enough to actually read as "a
// thing", the way the flat-block ports in the design were meant to. Its
// footprint runs the full width of a grid slot per wire it holds (so a
// multi-wire port visibly widens) and this much thick across the edge.
export const BOUNDARY_PORT_THICKNESS = PORT_SLOT_SPACING / 2;
const INPUT_PORT_COLOR = '#8b93a3';
const DEFAULT_OUTPUT_PORT_COLOR = '#8b93a3';
const PORT_LABEL_GAP = 6;
const SLOT_RING_RADIUS = PORT_LENGTH / 2 + 4;
// Selected (clicked, ready to delete) uses the same blue as a selected
// block; an in-progress wire's own source stays that same "active" blue;
// a hovered drop target turns green once it's actually compatible, or red
// when it's a real port but the wrong effective direction to pair with.
const SELECTION_COLOR = '#4f8cff';
export const PORT_SELECTED_RING_COLOR = SELECTION_COLOR;
export const PORT_SOURCE_RING_COLOR = '#4f8cff';
export const PORT_TARGET_VALID_RING_COLOR = '#3ecf5d';
export const PORT_TARGET_INVALID_RING_COLOR = '#e5484d';

function sideLength(block, side) {
  return sideAxis(side) === 'x' ? block.geometry.height : block.geometry.width;
}

// The point on a geometry's own border for a given side + raw offset —
// shared by getPortPosition (a real port, offset already clamped) and
// drawEmptySlots (every valid slot, whether occupied or not).
export function borderPointForOffset(geometry, side, offset) {
  const { x, y, width, height } = geometry;
  switch (side) {
    case 'left':
      return { x, y: y + offset };
    case 'right':
      return { x: x + width, y: y + offset };
    case 'top':
      return { x: x + offset, y };
    case 'bottom':
    default:
      return { x: x + offset, y: y + height };
  }
}

// A port's world position is its own stored side + offset from that side's
// start corner, always resolved to the nearest valid connector slot (not
// used as-is) — this is what keeps every port grid-aligned even for data
// saved before slots existed, or one nudged slightly off by, say, a block
// resize shifting what "nearest" means, without needing a one-time data
// migration. The single place move/hit-test/render/wire-endpoint all agree
// on where a port actually is.
export function getPortPosition(block, port) {
  const length = sideLength(block, port.side);
  const bounds = getPortOffsetBounds(length);
  const rawOffset = clamp(port.offset ?? bounds.min, bounds.min, bounds.max);
  const offset = nearestPortSlot(length, rawOffset);
  return borderPointForOffset(block.geometry, port.side, offset);
}

export function getAllPortPositions(block) {
  return (block.ports || []).map((port) => ({ port, ...getPortPosition(block, port) }));
}

export function findPortPosition(block, portId) {
  const port = (block.ports || []).find((p) => p.id === portId);
  return port ? getPortPosition(block, port) : null;
}

// A port's placement *as a wire container on the boundary* — its own
// side/offset/width, independent of `port.side`/`port.offset` (which is
// only ever the outer face's attachment point). Absent until the user
// actually drags or resizes it from inside, at which point it's written
// once (see DragStateMachine) and from then on wins over the outer-face
// placement for every boundary computation below. `width` is in slot
// units (see PORT_SLOT_SPACING) — how many wire-slots this port reserves
// on the boundary, independent of how many wires currently fill it.
export function getPortBoundaryPlacement(port) {
  return port.boundary || { side: port.side, offset: port.offset, width: 1 };
}

// Only meaningful on the boundary/inverted face: a port that has more than
// one wire attached from inside (see Project.listBoundaryWires) widens
// into that many adjacent slots on its own side, so each wire lands at its
// own point instead of every one of them converging on getPortPosition's
// single pixel. Always resolved against the port's *boundary* placement
// (getPortBoundaryPlacement), never the outer face's — moving or resizing
// a port from inside the container never touches its outer-face side or
// offset, and vice versa.
// `connectionId` (optional) resolves this specific wire's own pinned slot
// (see getBoundaryWireRelativeIndex) instead of treating `index` as a bare
// rank among however many real wires there are — pass it whenever a
// concrete wire is what's being positioned (rendering, hit-testing, the
// move-within-the-port drag), and leave it off for a purely index-driven
// lookup (the "+" ghost's next-free-slot preview, the block rect's own
// first/last-index bounds), where there's no specific wire to resolve at
// all.
export function getBoundaryWirePosition(block, port, index, connectionId) {
  const placement = getPortBoundaryPlacement(port);
  const slotOffset = getBoundaryWireSlotOffset(block, port, index, connectionId);
  return borderPointForOffset(block.geometry, placement.side, slotOffset);
}

// Which slot (0-based, relative to the port's own anchor — see
// getBoundaryWireSlotOffset) a specific wire is actually pinned to, once
// it has one (see port.boundary.wireSlots, written by
// DragStateMachine whenever a port becomes — or already is — a
// container). `fallbackIndex` covers a wire that's never been explicitly
// pinned (an older diagram from before this existed, or a wire added
// through some path that didn't bother) — its plain rank among
// Project.listBoundaryWires, same positioning a wire has always had by
// default.
export function getBoundaryWireRelativeIndex(port, connectionId, fallbackIndex) {
  const stored = connectionId ? port.boundary?.wireSlots?.[connectionId] : undefined;
  return stored !== undefined ? stored : fallbackIndex;
}

// Every real wire's own resolved relative index, in the same order as
// `wireIds` (Project.listBoundaryWires) — the occupied set a resize needs
// to avoid orphaning, and the "add a wire"/"move a wire" gestures need to
// find (or land on) a genuinely free one among.
export function getOccupiedWireIndices(port, wireIds) {
  return wireIds.map((id, rank) => getBoundaryWireRelativeIndex(port, id, rank));
}

// Same as getOccupiedWireIndices, but excluding one wire's own index from
// the result — critically, ranks are still computed against the FULL
// `wireIds` list first (fallbackIndex only means anything as a rank among
// every wire the port actually has), so filtering `excludeId` out never
// shifts anyone else's fallback rank the way filtering the input list
// first would.
export function getOccupiedWireIndicesExcluding(port, wireIds, excludeId) {
  return wireIds
    .map((id, rank) => (id === excludeId ? null : getBoundaryWireRelativeIndex(port, id, rank)))
    .filter((index) => index !== null);
}

// The raw along-side offset behind getBoundaryWirePosition's point, without
// converting it to a world point yet — what the "add a wire to this port"
// ghost needs (see HitTest's portWireGhost and DragStateMachine's
// updateHoverGhost), since drawPortGhost/getEdgeZoneOffset both work in
// terms of a bare offset rather than an already-resolved point.
export function getBoundaryWireSlotOffset(block, port, index, connectionId) {
  const placement = getPortBoundaryPlacement(port);
  const length = sideLength(block, placement.side);
  const bounds = getPortOffsetBounds(length);
  const baseOffset = clamp(placement.offset ?? bounds.min, bounds.min, bounds.max);
  const baseSlot = nearestPortSlot(length, baseOffset);
  const slots = getPortSlotOffsets(length);
  const baseIndex = Math.max(0, slots.indexOf(baseSlot));
  const relativeIndex = getBoundaryWireRelativeIndex(port, connectionId, index);
  // Spills onto whichever slots follow the port's own base slot along this
  // side — fine for a handful of wires on an otherwise uncrowded side; a
  // side packed edge-to-edge with sibling ports can still overlap, a known
  // limitation of this first pass rather than something routed around.
  return slots[Math.max(0, Math.min(slots.length - 1, baseIndex + relativeIndex))];
}

// Kept clear of the cell boundary on every side — the previous version
// spanned the *full* grid cell per wire, which put its ends flush against
// (and, once the resize handles were added, overhanging past) whatever
// sits in the next cell over: a sibling port's own slot, or the "add a
// port here" ghost for the free one. Shrinking a few px in from each edge
// gives every port a real, visible gap from its neighbors, so nothing
// ever has to fight over the same pixels in the first place.
const PORT_CELL_MARGIN = 2;

// The one filled rectangle a boundary port draws as — spanning its full
// reserved width (at least as wide as however many wires it actually
// holds, see `count`; a manually widened, still-empty port stays that
// wide rather than shrinking back down), straddling the dashed line the
// same way an ordinary port straddles its own block's border, just sized
// to actually read as a small block rather than a sliver.
export function getBoundaryPortBlockRect(block, port, count) {
  const placement = getPortBoundaryPlacement(port);
  const width = Math.max(placement.width || 1, count, 1);
  const first = getBoundaryWirePosition(block, port, 0);
  const last = getBoundaryWirePosition(block, port, width - 1);
  const half = PORT_SLOT_SPACING / 2 - PORT_CELL_MARGIN;
  const thickHalf = BOUNDARY_PORT_THICKNESS / 2;
  if (sideAxis(placement.side) === 'y') {
    // 'top'/'bottom': wires spread along x, the block runs vertically thin.
    const x0 = Math.min(first.x, last.x) - half;
    const x1 = Math.max(first.x, last.x) + half;
    return { x: x0, y: first.y - thickHalf, width: x1 - x0, height: BOUNDARY_PORT_THICKNESS };
  }
  // 'left'/'right': wires spread along y, the block runs horizontally thin.
  const y0 = Math.min(first.y, last.y) - half;
  const y1 = Math.max(first.y, last.y) + half;
  return { x: first.x - thickHalf, y: y0, width: BOUNDARY_PORT_THICKNESS, height: y1 - y0 };
}

// The two ends of a port's boundary block, along whichever axis it
// actually spreads on — the "resize its width" handles from the design.
// Kept *entirely inside* the block's own rect (never straddling past its
// edge) so there's no pixel a handle and a neighboring cell's own
// affordance both claim — the geometric fix for that, rather than the
// hit-testing priority order alone. Each still spans the block's full
// thickness so it reads as a graspable end-cap, not a dot in the middle.
// Kept short enough that, even after HitTest pads its hit area (see
// PORT_RESIZE_HIT_PADDING there), the two padded handle zones don't meet
// in the middle of a single-wire (narrowest) port — that gap is exactly
// what tells a plain "move this port" click apart from a resize. Only
// drawn/hit-tested while that port is the selected one (see
// DragStateMachine.getResizablePortId), same gating a block's own resize
// handles get.
export const PORT_RESIZE_HANDLE_LENGTH = 10;
export function getPortResizeHandleRects(block, port, count) {
  const rect = getBoundaryPortBlockRect(block, port, count);
  const placement = getPortBoundaryPlacement(port);
  // Never wider than half the block, so on a single-wire (narrowest) port
  // the two handles still leave a sliver of body between them rather than
  // overlapping each other.
  if (sideAxis(placement.side) === 'y') {
    const len = Math.min(PORT_RESIZE_HANDLE_LENGTH, rect.width / 2);
    return {
      start: { x: rect.x, y: rect.y, width: len, height: rect.height },
      end: { x: rect.x + rect.width - len, y: rect.y, width: len, height: rect.height },
    };
  }
  const len = Math.min(PORT_RESIZE_HANDLE_LENGTH, rect.height / 2);
  return {
    start: { x: rect.x, y: rect.y, width: rect.width, height: len },
    end: { x: rect.x, y: rect.y + rect.height - len, width: rect.width, height: len },
  };
}

function drawPortResizeHandles(ctx, rects, palette) {
  ctx.save();
  ctx.globalAlpha = RESIZE_HANDLE_ALPHA;
  for (const rect of Object.values(rects)) {
    ctx.beginPath();
    ctx.rect(rect.x, rect.y, rect.width, rect.height);
    ctx.fillStyle = palette.resizeHandleFill;
    ctx.fill();
    ctx.strokeStyle = SELECTION_COLOR;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();
}

// Where a wire actually attaches — the connector handle out past the dot,
// not the dot itself. The dot is purely a drag-to-reposition handle; a wire
// that visually ran through it (rather than the handle it was dragged from)
// read as attached to the wrong thing.
// `slot` (optional, `{ index, connectionId }`) picks a specific point along
// a multi-wire port's widened strip instead of its plain base position —
// see getBoundaryWirePosition. `connectionId`, when given, resolves to
// that wire's own *pinned* slot rather than treating `index` as a bare
// rank — without it, a wire individually moved elsewhere in the port (see
// DragStateMachine's MOVING_PORT_WIRE) would render/preview at the wrong
// point. Omitted entirely by every non-boundary caller.
export function findConnectorPosition(block, portId, inverted = false, slot = null) {
  const port = (block.ports || []).find((p) => p.id === portId);
  if (!port) return null;
  // A boundary-resolved port uses its own boundary side (see
  // getPortBoundaryPlacement), which can differ from `port.side` — the
  // whole point of letting a port be redocked to a different edge once
  // you're inside its container.
  const side = slot ? getPortBoundaryPlacement(port).side : port.side;
  const basePos = slot ? getBoundaryWirePosition(block, port, slot.index, slot.connectionId) : getPortPosition(block, port);
  return getConnectorHandlePosition(basePos, side, inverted);
}

// The connector handle sits just outside the block, past the port dot on
// the border — a distinct, slightly harder-to-hit target so a drag can
// reliably tell "reposition this port" from "start a wire" apart.
// `inverted` flips it to point inward instead — used when this port is
// being drawn on the surrounding boundary frame (see drawBoundary) rather
// than on an ordinary block, since "outward" there would point off into
// space outside the diagram instead of toward anything wireable.
export function getConnectorHandlePosition(portPos, side, inverted = false) {
  const n = sideNormal(side);
  const sign = inverted ? -1 : 1;
  return { x: portPos.x + n.x * sign * CONNECTOR_NUB_LENGTH, y: portPos.y + n.y * sign * CONNECTOR_NUB_LENGTH };
}

// Projects an arbitrary world point onto the nearest point on the block's
// own border, across all four sides — this is what lets a dragged port
// slide around every side of the block, switching sides at the corners.
export function projectPointToPerimeter(block, worldX, worldY) {
  const { x, y, width, height } = block.geometry;
  const candidates = [
    { side: 'left', offset: worldY - y, dist: Math.abs(worldX - x) },
    { side: 'right', offset: worldY - y, dist: Math.abs(worldX - (x + width)) },
    { side: 'top', offset: worldX - x, dist: Math.abs(worldY - y) },
    { side: 'bottom', offset: worldX - x, dist: Math.abs(worldY - (y + height)) },
  ];
  candidates.sort((a, b) => a.dist - b.dist);
  const best = candidates[0];
  const bounds = getPortOffsetBounds(sideLength(block, best.side));
  return { side: best.side, offset: snap(clamp(best.offset, bounds.min, bounds.max)) };
}

// The eight resize handles a selected block (or the selected boundary
// frame) shows — one per edge plus one per corner, floating outside the
// block rather than sitting on the border the way the old drag-to-resize
// zone did, so they're a target of their own rather than sharing pixels
// with a port's connector nub. The outset is kept modest (half of an
// earlier, more cautious value) so the handles read as attached to the
// block rather than floating off on their own; a handle landing near a
// port's own nub on the odd block whose ports happen to sit at an edge's
// midpoint is a rarer case than the handles looking disconnected on every
// other block.
export const RESIZE_HANDLE_SIZE = 12;
export const RESIZE_HANDLE_OUTSET = 20;

export function getResizeHandleRects(geometry) {
  const { x, y, width, height } = geometry;
  const half = RESIZE_HANDLE_SIZE / 2;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const square = (side, cx2, cy2) => ({ side, x: cx2 - half, y: cy2 - half, width: RESIZE_HANDLE_SIZE, height: RESIZE_HANDLE_SIZE });
  // A corner's x and y offsets compound diagonally — offsetting both by
  // the same RESIZE_HANDLE_OUTSET an edge handle uses would put the corner
  // handle sqrt(2) times farther from the shape than an edge one is.
  // Dividing each axis by sqrt(2) cancels that out, so every handle sits
  // the same straight-line distance from the block/boundary regardless of
  // which one it is.
  const cornerOutset = RESIZE_HANDLE_OUTSET / Math.SQRT2;
  return {
    top: square('top', cx, y - RESIZE_HANDLE_OUTSET),
    bottom: square('bottom', cx, y + height + RESIZE_HANDLE_OUTSET),
    left: square('left', x - RESIZE_HANDLE_OUTSET, cy),
    right: square('right', x + width + RESIZE_HANDLE_OUTSET, cy),
    // Corners resize both axes from the one drag — 'nw' etc. name which
    // corner, and DragStateMachine.resizeEdge reads that as its own
    // horizontal + vertical edge pair rather than needing a separate code
    // path from the four single-axis handles above.
    nw: square('nw', x - cornerOutset, y - cornerOutset),
    ne: square('ne', x + width + cornerOutset, y - cornerOutset),
    sw: square('sw', x - cornerOutset, y + height + cornerOutset),
    se: square('se', x + width + cornerOutset, y + height + cornerOutset),
  };
}

// A grip bar running *along* its edge — wide and short on top/bottom
// (which resize vertically), tall and narrow on left/right (which resize
// horizontally) — the same "bar perpendicular to the drag axis" shape
// most resize grips use, so the handle's own silhouette already tells you
// which way it moves before you touch it. Independent of the square hit
// area from getResizeHandleRects, which stays generous and un-rotated —
// a bar this thin would be a fussy target to actually grab otherwise.
const RESIZE_GRIP_LENGTH = 20;
const RESIZE_GRIP_THICKNESS = 4;
// Selection used to also draw its own outline ring around the block (see
// drawBlock) — with these handles now the only thing that shows up on
// selecting something, that redundant ring is gone, and these lean a
// little translucent so they read as an overlaid control rather than
// another opaque shape competing with the block/boundary underneath.
const RESIZE_HANDLE_ALPHA = 0.75;

// A corner drags both axes at once, along the diagonal between its two
// edges — 'nw'/'se' run top-left to bottom-right (nwse-resize), 'ne'/'sw'
// run the other way (nesw-resize). Rotating the same vertical grip bar 45°
// either direction draws that diagonal directly, rather than needing a
// second shape just for corners.
const CORNER_ROTATION = { nw: Math.PI / 4, se: Math.PI / 4, ne: -Math.PI / 4, sw: -Math.PI / 4 };

export function drawResizeHandles(ctx, geometry, palette = DEFAULT_PALETTE) {
  const rects = getResizeHandleRects(geometry);
  ctx.save();
  ctx.globalAlpha = RESIZE_HANDLE_ALPHA;
  for (const rect of Object.values(rects)) {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const horizontalEdge = rect.side === 'top' || rect.side === 'bottom';
    const w = horizontalEdge ? RESIZE_GRIP_LENGTH : RESIZE_GRIP_THICKNESS;
    const h = horizontalEdge ? RESIZE_GRIP_THICKNESS : RESIZE_GRIP_LENGTH;
    ctx.save();
    ctx.translate(cx, cy);
    const rotation = CORNER_ROTATION[rect.side];
    if (rotation) ctx.rotate(rotation);
    roundRectPath(ctx, -w / 2, -h / 2, w, h, RESIZE_GRIP_THICKNESS / 2);
    ctx.fillStyle = palette.resizeHandleFill;
    ctx.fill();
    ctx.strokeStyle = SELECTION_COLOR;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

// Detects the cursor within a port's own hit distance of the border, on
// either side of it — hovering there is what reveals an add-port ghost
// (see DragStateMachine's hover-ghost handling), and it's also what a real
// port's own hover/highlight rides on. Matches the port's own drawn
// footprint exactly (see getSlotRectFromBorderPoint, which straddles the
// border by PORT_LENGTH/2 in *each* direction — inward and outward alike),
// so the hoverable zone lines up with what's actually visible rather than
// only ever covering the inward half of it.
// `useBoundaryPlacement` checks occupancy against each port's *boundary*
// placement (getPortBoundaryPlacement) instead of its outer-face
// side/offset — pass it when `geometry`/`ports` are the boundary's own,
// since a port redocked from inside no longer necessarily occupies the
// same slot out there that it does out here. `wireCountFor(portId)`
// (boundary calls only) reports how many wires a port actually holds, so
// a widened port's *entire* reserved span reads as occupied — checking
// only its anchor slot let the "add a port here" ghost (and a click
// through it) land right on top of one of its other wires.
export function getEdgeZoneOffset(geometry, ports, worldX, worldY, useBoundaryPlacement = false, wireCountFor = () => 1) {
  const { x, y, width, height } = geometry;
  const margin = PORT_LENGTH / 2;
  if (worldX < x - margin || worldX > x + width + margin || worldY < y - margin || worldY > y + height + margin) return null;

  const candidates = [
    { side: 'left', dist: Math.abs(worldX - x), offset: worldY - y },
    { side: 'right', dist: Math.abs(x + width - worldX), offset: worldY - y },
    { side: 'top', dist: Math.abs(worldY - y), offset: worldX - x },
    { side: 'bottom', dist: Math.abs(y + height - worldY), offset: worldX - x },
  ];
  candidates.sort((a, b) => a.dist - b.dist);
  const best = candidates[0];
  if (best.dist > margin) return null;

  const length = sideAxis(best.side) === 'x' ? height : width;
  // The cursor's own nearest slot on this side — not redirected toward
  // whatever's free. If that slot's already taken, the cursor is over an
  // *existing* port, not empty edge, so no ghost belongs here: it used to
  // snap sideways onto the nearest free slot instead, which drew the
  // add-port affordance right on top of (or beside) the real port it was
  // supposedly offering to avoid.
  const slots = getPortSlotOffsets(length);
  const slot = nearestPortSlot(length, best.offset);
  const slotIndex = slots.indexOf(slot);
  const occupied = (ports || []).some((p) => {
    const placement = useBoundaryPlacement ? getPortBoundaryPlacement(p) : p;
    if (placement.side !== best.side) return false;
    const baseIndex = slots.indexOf(nearestPortSlot(length, placement.offset));
    const span = useBoundaryPlacement ? Math.max(placement.width || 1, wireCountFor(p.id), 1) : 1;
    return slotIndex >= baseIndex && slotIndex < baseIndex + span;
  });
  if (occupied) return null;

  return { side: best.side, offset: slot };
}

// Grows away from wherever the connector handle points, so the two never
// overlap: normally that's inward (the handle points outward), but on an
// inverted (boundary) port the handle points inward instead, so the label
// has to swap to the outward side to stay clear of it.
// object-fit: contain, by hand — scales (including up, unlike CSS's
// default) so the whole image fits inside the block with a small margin,
// centered, without distorting its aspect ratio.
const IMAGE_PADDING = 8;

function drawContainImage(ctx, img, x, y, width, height) {
  const availW = width - IMAGE_PADDING * 2;
  const availH = height - IMAGE_PADDING * 2;
  const scale = Math.min(availW / img.naturalWidth, availH / img.naturalHeight);
  const w = img.naturalWidth * scale;
  const h = img.naturalHeight * scale;
  ctx.drawImage(img, x + width / 2 - w / 2, y + height / 2 - h / 2, w, h);
}

function drawPortLabel(ctx, port, pos, inverted = false, palette = DEFAULT_PALETTE) {
  if (!port.name) return;
  ctx.fillStyle = palette.portLabel;
  ctx.font = '10px -apple-system, Segoe UI, Roboto, sans-serif';

  const n = sideNormal(port.side);
  const sign = inverted ? 1 : -1;
  const dirX = n.x * sign;
  const dirY = n.y * sign;
  // Clears the inward-facing half of the port's own rectangle before the
  // label text starts — an ordinary block's pipe-sized slot on one side,
  // the much thicker boundary port block on the other (see
  // BOUNDARY_PORT_THICKNESS / getBoundaryPortBlockRect).
  const gap = (inverted ? BOUNDARY_PORT_THICKNESS / 2 : PORT_LENGTH / 2) + PORT_LABEL_GAP;

  if (Math.abs(dirX) > Math.abs(dirY)) {
    ctx.textAlign = dirX > 0 ? 'left' : 'right';
    ctx.textBaseline = 'middle';
    ctx.fillText(port.name, pos.x + dirX * gap, pos.y);
  } else {
    ctx.textAlign = 'center';
    ctx.textBaseline = dirY > 0 ? 'top' : 'bottom';
    ctx.fillText(port.name, pos.x, pos.y + dirY * gap);
  }
}

// An arrowhead pointing outward (away from the block) for an output and
// inward (back toward the block) for an input — reads as the direction
// data actually flows, not just "here's a handle." `side`/`inverted` give
// the handle's own outward-facing axis; isOutput then decides whether the
// arrow points along that axis or against it.
function drawConnectorArrow(ctx, handlePos, side, inverted, isOutput, palette = DEFAULT_PALETTE) {
  const n = sideNormal(side);
  const outwardSign = inverted ? -1 : 1;
  const directionSign = isOutput ? 1 : -1;
  const dirX = n.x * outwardSign * directionSign;
  const dirY = n.y * outwardSign * directionSign;
  const perpX = -dirY;
  const perpY = dirX;
  const half = CONNECTOR_ARROW_SIZE / 2;

  const tipX = handlePos.x + dirX * half;
  const tipY = handlePos.y + dirY * half;
  const backX = handlePos.x - dirX * half;
  const backY = handlePos.y - dirY * half;

  ctx.beginPath();
  ctx.moveTo(tipX, tipY);
  ctx.lineTo(backX + perpX * half, backY + perpY * half);
  ctx.lineTo(backX - perpX * half, backY - perpY * half);
  ctx.closePath();
  ctx.fillStyle = palette.connectorHandle;
  ctx.fill();
}

// A direction-less port still needs *something* marking where to grab it to
// start a wire — the arrowhead was doing double duty as both "which way
// data flows" and "here's the handle," so dropping it outright for an
// undecided port left the handle with no visible marker at all. This is
// the same handle with no directional claim: a plain dot, same place, same
// color, just no triangle pointing anywhere.
// `inverted` draws a small square instead of the ordinary block's round
// handle — on the boundary, a circular handle sitting right next to the
// port's own (now rectangular) slot read as just another plain wire
// endpoint rather than as part of a deliberately port-shaped thing.
function drawConnectorHandleDot(ctx, handlePos, inverted = false, palette = DEFAULT_PALETTE) {
  ctx.beginPath();
  if (inverted) {
    const half = CONNECTOR_ARROW_SIZE / 2;
    ctx.rect(handlePos.x - half, handlePos.y - half, CONNECTOR_ARROW_SIZE, CONNECTOR_ARROW_SIZE);
  } else {
    ctx.arc(handlePos.x, handlePos.y, CONNECTOR_ARROW_SIZE / 2, 0, Math.PI * 2);
  }
  ctx.fillStyle = palette.connectorHandle;
  ctx.fill();
}

function drawPortRing(ctx, x, y, color, radius) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
}

// A port's rect, centered *on* the border point rather than inset behind
// it — PORT_LENGTH/2 juts out past the border toward the connector handle,
// PORT_LENGTH/2 stays inset in the block's own face, so it reads as a
// short pipe straddling the wall rather than a socket sunk entirely into
// it. Exported so HitTest can hit-test the exact area actually drawn, not
// an approximation of it.
export function getSlotRectFromBorderPoint(px, py, side) {
  const horizontal = side === 'left' || side === 'right';
  const w = horizontal ? PORT_LENGTH : PORT_WIDTH;
  const h = horizontal ? PORT_WIDTH : PORT_LENGTH;
  return { x: px - w / 2, y: py - h / 2, width: w, height: h };
}

// The exact rect an ordinary (non-inverted) block's port slot is drawn at.
export function getPortSlotRect(block, port) {
  const { x, y } = getPortPosition(block, port);
  return getSlotRectFromBorderPoint(x, y, port.side);
}

function drawSlotSquare(ctx, rect, fill, stroke) {
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, rect.width, rect.height);
  ctx.fillStyle = fill;
  ctx.fill();
  ctx.strokeStyle = stroke;
  ctx.lineWidth = 1;
  ctx.stroke();
}

const GHOST_SLOT_FILL = 'rgba(79, 140, 255, 0.25)';
const GHOST_SLOT_STROKE = '#4f8cff';

// The "click here to add a port" preview shown after the cursor dwells in
// a block's edge zone for a moment (see DragStateMachine's hover-ghost
// handling) — visually distinct (blue, a "+") from the plain empty-slot
// squares so it reads as an active affordance, not just background grid.
export function drawPortGhost(ctx, geometry, side, offset, palette = DEFAULT_PALETTE) {
  const { x: px, y: py } = borderPointForOffset(geometry, side, offset);
  const rect = getSlotRectFromBorderPoint(px, py, side);
  drawSlotSquare(ctx, rect, GHOST_SLOT_FILL, GHOST_SLOT_STROKE);

  ctx.strokeStyle = palette.connectorHandle;
  ctx.lineWidth = 1.5;
  const cx = rect.x + rect.width / 2;
  const cy = rect.y + rect.height / 2;
  const arm = PORT_WIDTH / 2 - 1;
  ctx.beginPath();
  ctx.moveTo(cx - arm, cy);
  ctx.lineTo(cx + arm, cy);
  ctx.moveTo(cx, cy - arm);
  ctx.lineTo(cx, cy + arm);
  ctx.stroke();
}

// Every valid connector socket on this block's four sides that doesn't
// currently hold a port — drawn faint (background, not a real handle) so
// where a new port can go is discoverable without cluttering an
// already-wired block. Occupancy is checked against each port's *resolved*
// slot (nearestPortSlot), the same snapping getPortPosition applies — a
// port saved before slots existed still correctly claims whichever slot
// it now renders at, rather than leaving a stray empty square drawn right
// on top of it.
function drawEmptySlots(ctx, block, palette = DEFAULT_PALETTE) {
  const { width, height } = block.geometry;
  for (const side of SIDES) {
    const sideLength = sideAxis(side) === 'x' ? height : width;
    const occupied = (block.ports || [])
      .filter((p) => p.side === side)
      .map((p) => nearestPortSlot(sideLength, p.offset));
    for (const offset of getPortSlotOffsets(sideLength)) {
      if (occupied.includes(offset)) continue;
      const { x: px, y: py } = borderPointForOffset(block.geometry, side, offset);
      drawSlotSquare(ctx, getSlotRectFromBorderPoint(px, py, side), palette.emptySlotFill, palette.emptySlotStroke);
    }
  }
}

// Shared by both the container's per-wire loop and the plain single-wire
// case below — the stub line + slot square + arrowhead/dot every wire
// gets, wherever its own position resolves to.
function drawWireStubAndDot(ctx, { px, py, handle, side, inverted, isEffectivelyOutput, color, palette }) {
  // Drawn before the arrowhead/handle so it paints over its endpoint —
  // the stub reads as attached to the handle, not the other way around.
  ctx.strokeStyle = '#4a5568';
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(px, py);
  ctx.lineTo(handle.x, handle.y);
  ctx.stroke();

  drawSlotSquare(ctx, getSlotRectFromBorderPoint(px, py, side), color, palette.portStroke);

  if (isEffectivelyOutput !== null) drawConnectorArrow(ctx, handle, side, inverted, isEffectivelyOutput, palette);
  else drawConnectorHandleDot(ctx, handle, inverted, palette);
}

// A light, always-visible outline (never gated on selection — see
// drawPorts) around a multi-wire port's full reserved span, so the wires
// inside plainly read as one group even before anything's been clicked.
// Deliberately not filled/solid: the individual wires already carry their
// own slot squares, and a solid block behind them was the very
// "undifferentiated container" look this was changed away from.
const CONTAINER_GROUP_STROKE = 'rgba(79, 140, 255, 0.4)';
function drawContainerGroupOutline(ctx, rect, palette) {
  ctx.save();
  ctx.strokeStyle = palette.portGroupOutline || CONTAINER_GROUP_STROKE;
  ctx.lineWidth = 1;
  ctx.setLineDash([3, 3]);
  ctx.strokeRect(rect.x + 0.5, rect.y + 0.5, rect.width - 1, rect.height - 1);
  ctx.restore();
}

// `inverted` is set when drawing a container's ports on its boundary frame:
// a port that's an input from outside acts as a source from inside (data
// is available to route to children), and an output acts as a sink (a
// child's result flows into it, then out) — so which color/role a port
// gets flips, on top of the nub/arrow direction flipping. `portHighlights`
// (optional) is a `Map` of `"blockId:portId" -> ringColor` covering
// selection and in-progress-wire feedback, shared across every block/
// boundary drawn this frame.
function drawPorts(
  ctx,
  block,
  {
    inverted = false,
    portHighlights = null,
    showEmptySlots = false,
    palette = DEFAULT_PALETTE,
    // Boundary-only: Map<portId, string[]> of the label (possibly '') on
    // each wire currently attached to that port from inside, in the same
    // order Project.listBoundaryWires returns them — one dot gets drawn
    // per entry instead of the ordinary single dot per port. Absent (or a
    // port with 0-1 entries) draws exactly as before.
    boundaryWireLabels = null,
    // Boundary-only: { portId, connectionId, previewIndex } while
    // DragStateMachine.MOVING_PORT_WIRE is live — the one wire this
    // matches renders at `previewIndex` for this frame instead of its
    // actual stored slot, so it visibly follows the cursor mid-drag
    // rather than only snapping into place once you release.
    wireMoveOverride = null,
  } = {},
) {
  const outputColor = getStateColor(block) || DEFAULT_OUTPUT_PORT_COLOR;

  // Shown while selected (about to add or drag a port there) — showing
  // them all the time, on every block, cluttered ones you weren't
  // touching. The boundary frame gets the same treatment once it can be
  // selected too (see HitTest's 'boundaryLine' hit).
  if (showEmptySlots) drawEmptySlots(ctx, block, palette);

  for (const port of block.ports || []) {
    // A pin's own name/direction/description live on the logical port it
    // references, not on the pin itself (see BlockDescription's module
    // doc) — resolved once here rather than threading `block` any deeper
    // into the drawing helpers below.
    const logical = logicalPortOf(block, port);
    const portName = logical?.name || '';
    const portDirection = logical?.direction ?? null;
    // Boundary-only: [{ id, rank, label }] for every wire currently on
    // this port from inside (see SceneRenderer), `rank` being its plain
    // fallback position (Project.listBoundaryWires' own order) for
    // whichever of them hasn't been individually pinned to a slot yet
    // (see getBoundaryWireRelativeIndex).
    const wireEntries = inverted ? boundaryWireLabels?.get(port.id) || [] : [];
    const reservedWidth = inverted ? getPortBoundaryPlacement(port).width || 1 : 1;
    const rectCount = Math.max(1, wireEntries.length, reservedWidth);
    const effectiveSide = inverted ? getPortBoundaryPlacement(port).side : port.side;
    const isEffectivelyOutput0 = portDirection === null ? null : inverted ? portDirection === 'in' : portDirection === 'out';
    const color0 = isEffectivelyOutput0 ? outputColor : INPUT_PORT_COLOR;

    // A widened (or already multi-wire) boundary port reads as one visible
    // group — a light, *always-shown* outline (not gated on selection, so
    // "these wires belong together" doesn't require clicking anything
    // first), holding the port's own name once, centered on it, while
    // each wire inside keeps its own distinct pin with its OWN (child-
    // side) label. A still-plain, single-wire port draws neither: it's
    // just the one ordinary-looking pin an outer-face port has always
    // been, name and all — same "old wiring" look until it actually
    // becomes a container (see DragStateMachine.resolveConnectorDragPending).
    if (inverted && rectCount > 1) {
      const rect = getBoundaryPortBlockRect(block, port, rectCount);
      drawContainerGroupOutline(ctx, rect, palette);
      const ringColor = portHighlights?.get(`${block.id}:${port.id}`);
      if (ringColor === PORT_SELECTED_RING_COLOR) {
        drawPortResizeHandles(ctx, getPortResizeHandleRects(block, port, rectCount), palette);
      }
      const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      drawPortLabel(ctx, { name: portName, side: effectiveSide }, center, inverted, palette);

      for (const entry of wireEntries) {
        const isMoving = wireMoveOverride && wireMoveOverride.portId === port.id && wireMoveOverride.connectionId === entry.id;
        const { x: px, y: py } = isMoving
          ? getBoundaryWirePosition(block, port, wireMoveOverride.previewIndex)
          : getBoundaryWirePosition(block, port, entry.rank, entry.id);
        const handle = getConnectorHandlePosition({ x: px, y: py }, effectiveSide, inverted);
        drawWireStubAndDot(ctx, { px, py, handle, side: effectiveSide, inverted, isEffectivelyOutput: isEffectivelyOutput0, color: color0, palette });
        const wireRingColor = portHighlights?.get(`${block.id}:${port.id}`);
        if (wireRingColor) drawPortRing(ctx, px, py, wireRingColor, SLOT_RING_RADIUS);
        // Every wire shows only its OWN (child-side) label here — the
        // port's own name/identity is the centered one drawn once above,
        // never repeated (or substituted in) at any individual wire.
        if (entry.label) drawPortLabel(ctx, { name: entry.label, side: effectiveSide }, { x: px, y: py }, inverted, palette);
      }
      continue;
    }

    // Plain single-wire case (boundary or ordinary block alike) — exactly
    // one dot, the port's own name shown right there, same as it always
    // has been.
    const { x: px, y: py } = inverted ? getBoundaryWirePosition(block, port, 0) : getPortPosition(block, port);
    const handle = getConnectorHandlePosition({ x: px, y: py }, effectiveSide, inverted);
    drawWireStubAndDot(ctx, { px, py, handle, side: effectiveSide, inverted, isEffectivelyOutput: isEffectivelyOutput0, color: color0, palette });
    const ringColor = portHighlights?.get(`${block.id}:${port.id}`);
    if (ringColor) drawPortRing(ctx, px, py, ringColor, SLOT_RING_RADIUS);
    drawPortLabel(ctx, { name: portName, side: effectiveSide }, { x: px, y: py }, inverted, palette);
  }
}

function roundRectPath(ctx, x, y, width, height, radius) {
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + width, y, x + width, y + height, radius);
  ctx.arcTo(x + width, y + height, x, y + height, radius);
  ctx.arcTo(x, y + height, x, y, radius);
  ctx.arcTo(x, y, x + width, y, radius);
  ctx.closePath();
}

// #rrggbb only — the one shape a custom fill is ever stored in (see
// SelectionFabs' swatches and its native <input type=color> fallback).
// Anything else (the theme palette's own fill, which can be any CSS
// color) never reaches this, since it only runs when block.style.fill is
// set by that same picker.
function readableTextColor(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  // Perceptual luminance (ITU-R BT.709) — picks whichever ink stays
  // legible, since a custom background can land anywhere from near-black
  // to near-white and the theme's own text color only ever assumed its
  // own default fill.
  const luminance = (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255;
  return luminance > 0.55 ? '#1c2431' : '#ffffff';
}

// A block is a plain titled box with its name centered — no header band.
// Its Input/Output ports are handles on the border, on any of the four
// sides. When you drill into a block, its own border becomes the frame
// that shows those same ports (Milestone 3).
export function drawBlock(
  ctx,
  block,
  { selected = false, portHighlights = null, requestRender = () => {}, palette = DEFAULT_PALETTE } = {},
) {
  const { x, y, width, height } = block.geometry;
  const accentColor = block.style?.color || DEFAULT_BLOCK_COLOR;
  const fillColor = block.style?.fill || palette.blockFill;
  // 'transparent' is a real fill value (see SelectionFabs' transparent
  // swatch), not a custom color readableTextColor can parse as hex — text
  // over it falls back to the theme's own ink instead of NaN-ing out.
  const textColor =
    block.style?.fill && block.style.fill !== 'transparent' ? readableTextColor(block.style.fill) : palette.blockText;

  // Selection used to also draw a second outline ring around the block,
  // and thicken this border a touch on top of that — the four resize
  // handles that appear on selection already say "this is the selected
  // one" on their own, so either was just the same fact told again. The
  // border stays exactly as it looks unselected, in the block's own
  // accent colour, whether or not it's the one picked right now.
  roundRectPath(ctx, x, y, width, height, CORNER_RADIUS);
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.lineWidth = 1.5;
  ctx.strokeStyle = accentColor;
  ctx.stroke();

  ctx.save();
  roundRectPath(ctx, x, y, width, height, CORNER_RADIUS);
  ctx.clip();

  // A block's name doubles as an image source: point it at a picture
  // instead of typing a label, and that's what fills the block. Falls
  // back to the plain name (as the URL, admittedly not pretty, but
  // truthful about what's there) until the image has actually loaded, or
  // if it never does.
  const image = isImageUrl(block.name) ? getCachedImage(block.name, requestRender) : null;
  if (image) {
    drawContainImage(ctx, image, x, y, width, height);
  } else {
    const fontFamily = getFontFamily(block.style?.font);
    const fontSize = block.style?.fontSize || 13;
    const fontWeight = block.style?.bold ? 'bold ' : '';
    const fontStyle = block.style?.italic ? 'italic ' : '';
    const cssFont = `${fontStyle}${fontWeight}${fontSize}px ${fontFamily}`;
    // Canvas text can't await a web font mid-render — draws with the
    // fallback stack immediately and asks for a redraw once the real one
    // is ready, the same pattern the image case above uses.
    if (block.style?.font) ensureFontLoaded(cssFont, requestRender);
    ctx.fillStyle = textColor;
    ctx.font = cssFont;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(block.name, x + width / 2, y + height / 2, width - 16);
  }

  ctx.restore();

  // A text block has no ports and can't gain one (see addPort's kind
  // guard) — showing the discoverable empty-slot squares on it would
  // advertise an affordance that doesn't work.
  drawPorts(ctx, block, { portHighlights, showEmptySlots: selected && block.kind !== 'text', palette });
  if (selected) drawResizeHandles(ctx, block.geometry, palette);
}

// The frame representing "the current system" — the block you're inside,
// drawn as a dashed outline (not a solid box: it's empty space you're
// standing in, not an object). It's purely a container for the block's own
// IOs — its geometry is whatever the user has dragged it to (see
// DragStateMachine's boundary-edge splitter drag) and has no relationship
// to where children happen to sit. Its ports are the container's own real
// ports, rendered inverted (see drawPorts) so wiring them to a child never
// has to cross back out over this outline. No resize handle, no enter
// icon, no centered name-as-content — just a small label so it reads as a
// frame.
export function drawBoundary(
  ctx,
  block,
  geometry,
  { selected = false, portHighlights = null, palette = DEFAULT_PALETTE, boundaryWireLabels = null, wireMoveOverride = null } = {},
) {
  const { x, y, width, height } = geometry;

  // No selected-state recolor here either (see drawBlock's own note) — the
  // resize handles below already say this frame is the selected one.
  ctx.save();
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = palette.boundaryDash;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, width, height);
  ctx.restore();

  ctx.fillStyle = selected ? SELECTION_COLOR : palette.boundaryLabel;
  ctx.font = BOUNDARY_LABEL_FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(block.name, x + 4, y - 6);

  // No empty-slot markers here, unlike an ordinary block: the boundary is
  // usually many grid cells per side, so "every unused slot, all at once"
  // reads as a wall of faint circles rather than a helpful preview — the
  // hover ghost already shows exactly one, right where you're about to
  // click, which is the affordance that actually matters.
  drawPorts(ctx, { ...block, geometry }, { inverted: true, portHighlights, palette, boundaryWireLabels, wireMoveOverride });
  // Gated on `selected` exactly like an ordinary block: clicking the
  // dashed line itself now selects the boundary (see HitTest's
  // 'boundaryLine' hit and DragStateMachine's handling of it), so there's
  // a real selected state to hang this on instead of showing handles
  // unconditionally.
  if (selected) drawResizeHandles(ctx, geometry, palette);
}

export const BOUNDARY_LABEL_FONT = '11px -apple-system, Segoe UI, Roboto, sans-serif';
const BOUNDARY_LABEL_HEIGHT = 14;

// Measuring text needs a 2d context, and hit-testing runs outside any
// render pass — so this keeps a tiny offscreen one purely for measurement
// rather than depending on whichever canvas happens to be drawing.
let measureCtx = null;
function measureText(text, font) {
  if (!measureCtx) measureCtx = document.createElement('canvas').getContext('2d');
  measureCtx.font = font;
  return measureCtx.measureText(text).width;
}

// The clickable box around the boundary frame's title (drawn above its
// top-left corner) — clicking it renames the block you're currently inside.
// Kept in step with drawBoundary's own fillText placement above.
export function getBoundaryLabelRect(block, geometry) {
  const width = Math.max(24, measureText(block.name || '', BOUNDARY_LABEL_FONT));
  return {
    x: geometry.x + 4,
    y: geometry.y - 6 - BOUNDARY_LABEL_HEIGHT,
    width,
    height: BOUNDARY_LABEL_HEIGHT,
  };
}
