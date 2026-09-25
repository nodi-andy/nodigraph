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
import { getStateColor, logicalPortOf, isPortHidden } from '../model/BlockDescription.js';
import { DEFAULT_BLOCK_COLOR, TITLE_POSITIONS, TITLE_ALIGNMENTS } from '../model/Block.js';
import { boundaryPlacementFor, exteriorPlacementFor, frameToFace } from '../model/levelGeometry.js';
import { isImageUrl, getCachedImage } from './imageCache.js';
import { getCanvasPalette } from './canvasPalette.js';
import { getFontFamily, ensureFontLoaded } from './fonts.js';
import { isImprovedView } from './viewOptions.js';

const DEFAULT_PALETTE = getCanvasPalette('light');

// A touch softer/rounder than the old 6px — reads more like a card's
// corner and less like a plain rectangle, part of the "sheet of paper"
// look (see also the drop shadow in drawBlock below).
const CORNER_RADIUS = 8;
const BORDER_WIDTH = 1.5;
const BORDER_MAX_SCREEN_WIDTH = 6;
// Constant *screen*-pixel shadow (divided by zoom before use, the same
// trick this file already uses for grid dots/resize handles) — the
// elevation that makes a block read as a card resting on the canvas
// rather than a flat rectangle painted onto it.
//
// Two layers, the way the CSS box-shadow stacks in styles.css do it: a
// wide, soft ambient shadow supplies the height, and a tight contact
// shadow just under the bottom edge keeps the block anchored to the canvas
// instead of looking like it floats free of it. One shadow per fill is all
// a canvas context carries, so the two layers are two fills, ambient
// first. The colour is mixed per-theme (see canvasPalette's
// blockShadowRgb): the same ink that reads on a light canvas disappears
// on a dark one.
const PAPER_SHADOW_LAYERS = [
  { alpha: 0.16, blur: 16, offsetY: 6 },
  { alpha: 0.2, blur: 3, offsetY: 1 },
];
// A block is a chip, not a sheet: a thin slab with a visible side wall
// under its face, CHIP_DEPTH screen pixels deep at any zoom (divided by
// zoom before use, like the shadow). The side is the block's own outline,
// sockets and all, dropped by that depth, in the face's colour darkened by
// CHIP_SIDE_SHADE and edged in the border colour — so a tab has a side
// under it and a dent shows its wall. The shadow is cast by the whole chip
// rather than by the face alone.
const CHIP_DEPTH = 3.5;
const CHIP_SIDE_SHADE = 'rgba(15, 18, 24, 0.2)';

// Where a chip's side wall must not show: around every socket plugged
// straight into a neighbour (see pinsArePlugged). A tab seated in a dent
// fills it through the chip's whole depth, so neither the dent's wall nor
// the tab's own side can be seen there. The box covers the socket and the
// strip below it that the side wall, dropped by `depth`, would reach.
function pluggedSocketBox(pos, side, shape, depth) {
  const n = sideNormal(side);
  const along = shape === 'in' ? -SOCKET_DEPTH : SOCKET_DEPTH;
  const pad = 0.5;
  let x0;
  let x1;
  let y0;
  let y1;
  if (n.x !== 0) {
    x0 = Math.min(pos.x, pos.x + n.x * along);
    x1 = Math.max(pos.x, pos.x + n.x * along);
    y0 = pos.y - SOCKET_HALF_OUTER;
    y1 = pos.y + SOCKET_HALF_OUTER;
  } else {
    x0 = pos.x - SOCKET_HALF_OUTER;
    x1 = pos.x + SOCKET_HALF_OUTER;
    y0 = Math.min(pos.y, pos.y + n.y * along);
    y1 = Math.max(pos.y, pos.y + n.y * along);
  }
  return { x: x0 - pad, y: y0 - pad, width: x1 - x0 + 2 * pad, height: y1 - y0 + depth + 2 * pad };
}
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
const PORT_LABEL_GAP = 6;
// A port label is content, so it scales with the world the way a block's
// own name does — but only up to a point. Past twice its resting size on
// screen it stops growing: a label several times the height of the block
// it annotates stops reading as a label and starts covering the thing it
// points at, which is most obvious over a block big enough to be showing
// its sub-architecture preview (see render/SubPreviewRenderer.js). The cap
// is deliberately set at 2x rather than anything tighter so that nothing
// at zoom <= 2 changes at all — that covers the whole ordinary zoom range
// and both exporters, model/diagramImage.js oversampling at exactly 2x.
const PORT_LABEL_FONT_SIZE = 10;
const PORT_LABEL_MAX_SCREEN_SIZE = PORT_LABEL_FONT_SIZE * 2;

function portLabelFontSize(zoom) {
  return Math.min(PORT_LABEL_FONT_SIZE, PORT_LABEL_MAX_SCREEN_SIZE / zoom);
}
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

// A port's placement on the boundary frame — where the wires inside the
// container attach to it. Derived, not stored: the frame is a scaled
// picture of the block's face (see model/levelGeometry.js), so the pin
// sits on the same side, at the proportional position, snapped to the
// frame's slot grid. Only `width` (how many wire slots the pin reserves,
// in PORT_SLOT_SPACING units) and `wireSlots` (which wire sits in which
// of them) are still the pin's own data.
//
// `block` is either the real container (its `geometry` is the face and
// `boundaryGeometry` the frame) or a boundary view made by asBoundaryView
// below — the `{ ...block, geometry: frame }` substitute every inverted
// drawing/hit-testing path works on, which carries the face along as
// `outerGeometry` so the mapping still has both rectangles.
export function getPortBoundaryPlacement(port, block) {
  const face = block?.outerGeometry || (block?.boundaryGeometry ? block.geometry : null);
  const frame = block?.outerGeometry ? block.geometry : block?.boundaryGeometry;
  return boundaryPlacementFor(port, face, frame);
}

// The block as its own boundary frame: geometry swapped for the frame so
// every border/slot computation below resolves against the dashed
// rectangle, with the face kept as `outerGeometry` for the placement
// mapping. `ports` (optional) narrows the pins drawn/hit-tested to one
// per logical port (see Project.listBoundaryPorts).
export function asBoundaryView(block, frameGeometry, ports) {
  return { ...block, geometry: frameGeometry, outerGeometry: block.geometry, ...(ports ? { ports } : {}) };
}

// The exterior pin placement an edit made *inside* a container writes
// back — a pin dragged along or added on the dashed frame at
// `frameOffset` on `side` lands on the face at the corresponding slot,
// avoiding the slots the block's other pins already occupy there. This
// is what keeps the two views one geometry: moving a pin from inside
// moves it outside by exactly the same amount.
export function exteriorPlacementFromBoundary(block, side, frameOffset, excludePortId = null) {
  const face = block.geometry;
  const frame = block.boundaryGeometry;
  const faceLength = sideLength(block, side);
  const occupied = (block.ports || [])
    .filter((p) => p.id !== excludePortId && p.side === side)
    .map((p) => nearestPortSlot(faceLength, p.offset));
  return exteriorPlacementFor(side, frameOffset, face, frame, occupied);
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
  const placement = getPortBoundaryPlacement(port, block);
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
  const placement = getPortBoundaryPlacement(port, block);
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
  const placement = getPortBoundaryPlacement(port, block);
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
  const placement = getPortBoundaryPlacement(port, block);
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
  const side = slot ? getPortBoundaryPlacement(port, block).side : port.side;
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

// These constants are screen-pixel sizes, not world sizes — geometry is
// drawn (and hit-tested) under the camera's zoom transform, so a rect this
// function returns has to be RESIZE_HANDLE_SIZE/zoom wide to still measure
// RESIZE_HANDLE_SIZE pixels once that transform scales it back down. Without
// this, a fixed world-unit handle shrinks toward nothing at low zoom (no way
// to grab it to resize a block you've zoomed out to see the whole diagram)
// and balloons absurdly large at high zoom.
export function getResizeHandleRects(geometry, zoom = 1) {
  const { x, y, width, height } = geometry;
  const handleSize = RESIZE_HANDLE_SIZE / zoom;
  const outset = RESIZE_HANDLE_OUTSET / zoom;
  const half = handleSize / 2;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const square = (side, cx2, cy2) => ({ side, x: cx2 - half, y: cy2 - half, width: handleSize, height: handleSize });
  // A corner's x and y offsets compound diagonally — offsetting both by
  // the same outset an edge handle uses would put the corner handle
  // sqrt(2) times farther from the shape than an edge one is. Dividing
  // each axis by sqrt(2) cancels that out, so every handle sits the same
  // straight-line distance from the block/boundary regardless of which
  // one it is.
  const cornerOutset = outset / Math.SQRT2;
  return {
    top: square('top', cx, y - outset),
    bottom: square('bottom', cx, y + height + outset),
    left: square('left', x - outset, cy),
    right: square('right', x + width + outset, cy),
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

export function drawResizeHandles(ctx, geometry, palette = DEFAULT_PALETTE, zoom = 1) {
  const rects = getResizeHandleRects(geometry, zoom);
  const gripLength = RESIZE_GRIP_LENGTH / zoom;
  const gripThickness = RESIZE_GRIP_THICKNESS / zoom;
  ctx.save();
  ctx.globalAlpha = RESIZE_HANDLE_ALPHA;
  for (const rect of Object.values(rects)) {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const horizontalEdge = rect.side === 'top' || rect.side === 'bottom';
    const w = horizontalEdge ? gripLength : gripThickness;
    const h = horizontalEdge ? gripThickness : gripLength;
    ctx.save();
    ctx.translate(cx, cy);
    const rotation = CORNER_ROTATION[rect.side];
    if (rotation) ctx.rotate(rotation);
    roundRectPath(ctx, -w / 2, -h / 2, w, h, gripThickness / 2);
    ctx.fillStyle = palette.resizeHandleFill;
    ctx.fill();
    ctx.strokeStyle = SELECTION_COLOR;
    ctx.lineWidth = 1.5 / zoom;
    ctx.stroke();
    ctx.restore();
  }
  ctx.restore();
}

// True once a block actually has something drawn one level down — not just
// `hasChildren` on its own, which Project.getLevel sets the moment a block
// is *entered* even if nothing was ever placed inside it (same "real
// content" check the Inspector's own "Enter block (N inside)" label uses).
export function hasSubArchitecture(block) {
  // Empty declared containers are still levels you can zoom into to add
  // their first component. Serialization omits their empty children maps,
  // but keeps hasChildren and the frame. Boundary-only wiring also counts.
  return Boolean(block.hasChildren || block.children?.blocks?.size || block.children?.connections?.size);
}

// A block with a `link` is a reference to an artifact that lives
// elsewhere — a source file on GitHub, a callable endpoint, a document.
// The glyph is a small "opens in a new tab" arrow in the block's top-right
// corner, fixed screen size like the sub-architecture badge, and it is
// the click target that opens the link (see HitTest's 'link' hit and
// DragStateMachine.onPointerDown); a double-click anywhere on a link block
// without an interior of its own opens it too.
const LINK_GLYPH_SIZE = 14;
const LINK_GLYPH_MARGIN = 5;

// Only web links open — the same string could otherwise smuggle in a
// `javascript:` URL through a shared diagram.
export function isOpenableLink(link) {
  return typeof link === 'string' && /^https?:\/\//i.test(link.trim());
}

export function getLinkGlyphRect(geometry, zoom = 1) {
  const size = LINK_GLYPH_SIZE / zoom;
  const margin = LINK_GLYPH_MARGIN / zoom;
  return { x: geometry.x + geometry.width - size - margin, y: geometry.y + margin, width: size, height: size };
}

function drawLinkGlyph(ctx, geometry, palette, zoom) {
  const { x, y, width: size } = getLinkGlyphRect(geometry, zoom);
  ctx.save();
  ctx.globalAlpha = 0.9;
  roundRectPath(ctx, x, y, size, size, size * 0.22);
  ctx.fillStyle = palette.blockFill;
  ctx.fill();
  ctx.strokeStyle = palette.boundaryLabel;
  ctx.lineWidth = 1.2 / zoom;
  ctx.stroke();
  // The arrow: a diagonal from lower-left to upper-right with a head.
  const inset = size * 0.3;
  const x0 = x + inset;
  const y0 = y + size - inset;
  const x1 = x + size - inset;
  const y1 = y + inset;
  const head = size * 0.28;
  ctx.beginPath();
  ctx.moveTo(x0, y0);
  ctx.lineTo(x1, y1);
  ctx.moveTo(x1 - head, y1);
  ctx.lineTo(x1, y1);
  ctx.lineTo(x1, y1 + head);
  ctx.lineWidth = 1.4 / zoom;
  ctx.lineCap = 'round';
  ctx.lineJoin = 'round';
  ctx.stroke();
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
// `boundaryBlock` (the container, when `geometry`/`ports` are its frame's)
// resolves each pin's boundary placement; null checks exterior pins.
export function getEdgeZoneOffset(geometry, ports, worldX, worldY, boundaryBlock = null, wireCountFor = () => 1) {
  const useBoundaryPlacement = Boolean(boundaryBlock);
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
    const placement = useBoundaryPlacement ? getPortBoundaryPlacement(p, boundaryBlock) : p;
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

// `outside` (0..1) moves an ordinary block's label from inside the face
// to beside the pin's stub outside it — the schematic convention, and
// the only place that stays clear of the block's own level once that is
// drawn on the face. Beside the stub, not on its axis, so the wire leaving
// the pin never runs through its own name. Fractions draw both, fading.
function drawPortLabel(ctx, port, pos, inverted = false, palette = DEFAULT_PALETTE, zoom = 1, outside = 0) {
  if (!port.name) return;
  ctx.fillStyle = palette.portLabel;
  ctx.font = `${portLabelFontSize(zoom)}px -apple-system, Segoe UI, Roboto, sans-serif`;

  if (!inverted && outside > 0) {
    const n = sideNormal(port.side);
    const mid = PORT_LENGTH / 2 + CONNECTOR_NUB_LENGTH / 2;
    const m = { x: pos.x + n.x * mid, y: pos.y + n.y * mid };
    ctx.save();
    ctx.globalAlpha *= Math.min(1, outside);
    if (n.y !== 0) {
      ctx.textAlign = 'left';
      ctx.textBaseline = 'middle';
      ctx.fillText(port.name, m.x + PORT_LABEL_GAP, m.y);
    } else {
      ctx.textAlign = 'center';
      ctx.textBaseline = 'bottom';
      ctx.fillText(port.name, m.x, m.y - PORT_LABEL_GAP * 0.6);
    }
    ctx.restore();
    if (outside >= 1) return;
    ctx.save();
    ctx.globalAlpha *= 1 - outside;
    drawPortLabelInside(ctx, port, pos, inverted, palette);
    ctx.restore();
    return;
  }
  drawPortLabelInside(ctx, port, pos, inverted, palette);
}

function drawPortLabelInside(ctx, port, pos, inverted, palette) {

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

// A pin is a socket cut into the block's own border, and the wire that
// reaches it is the plug that fits it. The direction is the shape: an
// input is a trapezoid dent into the face, an output the same trapezoid
// as a tab out of it, so the plug on a wire always narrows the way the
// data flows and no separate arrowhead is needed; a pin with no direction
// is a ring on the border and its plug a disc, never an arrow. The socket
// is part of the block's outline (see blockOutlinePath), in the border's
// own colour with the face's fill, so an unwired pin is plainly an empty
// socket. Once a wire is on the pin, a compact grip in the wire's colour
// sits just outside the socket, never over it (see drawPinPlug); that grip
// is where the wire is taken to redirect it (see getPlugRect and HitTest). A frame pin, seen from
// inside its container, keeps the exterior's shape: the wire arrives from
// the inside, so its plug sits on that side of the same socket.
export const SOCKET_HALF_OUTER = PORT_LENGTH / 2 + 1;
export const SOCKET_HALF_INNER = PORT_WIDTH / 2;
export const SOCKET_DEPTH = PORT_LENGTH / 2;
export const SOCKET_RING_RADIUS = SOCKET_HALF_OUTER - 0.5;
// How far out from the border a plug's body reaches: the connector handle
// (CONNECTOR_NUB_LENGTH) sits inside it.
export const PLUG_REACH = CONNECTOR_NUB_LENGTH + CONNECTOR_ARROW_SIZE / 2;
const PLUG_RADIUS = 2;
// A wired pin's grip, measured out from the border on the wire's side. It
// is the same compact body at the same place on every pin, whichever way
// the pin points, and it never touches the socket: GRIP_FROM leaves a gap
// past the deepest a socket reaches on that side (a tab, or a ring). The
// wire itself attaches inside the grip (CONNECTOR_NUB_LENGTH).
const GRIP_FROM = SOCKET_DEPTH + 3;
const GRIP_TO = PLUG_REACH;
const GRIP_HALF = SOCKET_HALF_INNER + 1.5;
// Each end of a wire has a grip, the handle a wire is connected and
// disconnected by (see getPlugRect and HitTest). It carries a dark border
// so it reads as something to take hold of, on any wire colour.
const GRIP_BORDER_COLOR = '#1c2431';
const GRIP_BORDER_WIDTH = 1.25;
// A socket the data flows INTO shows it is filled: the socket's own
// trapezoid in the wire's colour, reaching out to the border and set in
// from the socket's three walls by this gap, so its contour follows the
// socket's exactly.
const SOCKET_FILL_GAP = 1;
// The gap between a socket and its grip, the same on every pin: on an
// output it is measured from the tip of the tab, on a filled input from
// the border, where the filling ends.
const GRIP_GAP = GRIP_FROM - SOCKET_DEPTH;
const GRIP_LENGTH = GRIP_TO - GRIP_FROM;
// The line from a filled socket out to its grip, as wide as the wire, so
// the grip, the line and the filling read as one plug.
const PLUG_STEM_HALF = 1.5;
// The hover outline is drawn over a plug that may well be the same blue,
// so it sits on a white halo, which keeps it readable on any wire colour.
const SOCKET_HOVER_COLOR = SELECTION_COLOR;
const SOCKET_HOVER_WIDTH = 2;
const HOVER_HALO_COLOR = 'rgba(255, 255, 255, 0.9)';
const HOVER_HALO_EXTRA = 2.5;
const PLUG_HOVER_FILL = 'rgba(79, 140, 255, 0.35)';
const PLUG_HOVER_WIDTH = 1.5;

function strokeWithHalo(ctx, color, width) {
  ctx.lineJoin = 'round';
  ctx.strokeStyle = HOVER_HALO_COLOR;
  ctx.lineWidth = width + HOVER_HALO_EXTRA;
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.stroke();
}

// The exterior shape of a pin from its logical direction.
export function pinShapeOf(direction) {
  return direction === 'in' || direction === 'out' ? direction : 'both';
}

// Every socket the block's outline has to detour for, in world
// coordinates: [{ side, x, y, shape }].
export function socketsOf(block) {
  const sockets = [];
  for (const port of block.ports || []) {
    // A hidden port cuts no socket: the outline has to stay solid where a
    // pin isn't drawn, or hiding one would just turn it into a notch.
    if (isPortHidden(block, port)) continue;
    const { x, y } = getPortPosition(block, port);
    sockets.push({ side: port.side, x, y, shape: pinShapeOf(logicalPortOf(block, port)?.direction ?? null) });
  }
  return sockets;
}

// The four sides, clockwise from the top-left corner, as the constant part
// of each run: the unit vector along it and the one pointing into the
// face. The corner tangents and the run's own endpoints depend on the
// geometry and are computed per side below. Hoisted out of the function
// because it runs for every block of every level, several times over (the
// fill, the border, the clip and — in the detailed view — the chip's side
// wall all trace this same outline), and four fresh object literals a call
// was pure garbage.
const OUTLINE_RUNS = [
  { side: 'top', ux: 1, uy: 0, nx: 0, ny: 1 },
  { side: 'right', ux: 0, uy: 1, nx: -1, ny: 0 },
  { side: 'bottom', ux: -1, uy: 0, nx: 0, ny: -1 },
  { side: 'left', ux: 0, uy: -1, nx: 1, ny: 0 },
];

// Scratch space for the sockets of the side being traced, reused across
// calls: at most a handful of entries, and never held past the loop below.
// Parallel arrays rather than objects, so a frame's worth of outlines
// allocates nothing at all here.
const socketT = [];
const socketDepth = [];

// The block's outline with its pins' sockets cut into it: a rounded
// rectangle whose border steps into the face at every input and out of it
// at every output. Two-way pins leave the border alone; their ring is
// drawn on it afterwards (see drawSocket). This one path is the block's
// fill, border and clip alike, so a dent shows the canvas through it and a
// tab carries the face's fill out.
export function blockOutlinePath(ctx, geometry, sockets = []) {
  const { x, y, width, height } = geometry;
  const r = CORNER_RADIUS;
  const HO = SOCKET_HALF_OUTER;
  const HI = SOCKET_HALF_INNER;
  const D = SOCKET_DEPTH;
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  for (let i = 0; i < OUTLINE_RUNS.length; i += 1) {
    const run = OUTLINE_RUNS[i];
    const { ux, uy, nx, ny } = run;
    let fromX;
    let fromY;
    let toX;
    let toY;
    let cx1;
    let cy1;
    let cx2;
    let cy2;
    if (i === 0) {
      fromX = x + r; fromY = y; toX = x + width - r; toY = y;
      cx1 = x + width; cy1 = y; cx2 = x + width; cy2 = y + r;
    } else if (i === 1) {
      fromX = x + width; fromY = y + r; toX = x + width; toY = y + height - r;
      cx1 = x + width; cy1 = y + height; cx2 = x + width - r; cy2 = y + height;
    } else if (i === 2) {
      fromX = x + width - r; fromY = y + height; toX = x + r; toY = y + height;
      cx1 = x; cy1 = y + height; cx2 = x; cy2 = y + height - r;
    } else {
      fromX = x; fromY = y + height - r; toX = x; toY = y + r;
      cx1 = x; cy1 = y; cx2 = x + r; cy2 = y;
    }
    const length = (toX - fromX) * ux + (toY - fromY) * uy;

    // The sockets on this side that actually fit within the run, gathered
    // by insertion sort straight into the scratch arrays — `here` is only
    // ever a few entries, so this is the same order of work the old
    // filter/map/filter/sort chain did without any of its arrays.
    let count = 0;
    for (const s of sockets) {
      if (s.side !== run.side || s.shape === 'both') continue;
      const t = (s.x - fromX) * ux + (s.y - fromY) * uy;
      if (t - HO < 0 || t + HO > length) continue;
      let j = count;
      while (j > 0 && socketT[j - 1] > t) {
        socketT[j] = socketT[j - 1];
        socketDepth[j] = socketDepth[j - 1];
        j -= 1;
      }
      socketT[j] = t;
      socketDepth[j] = s.shape === 'in' ? D : -D;
      count += 1;
    }

    for (let k = 0; k < count; k += 1) {
      const t = socketT[k];
      const depth = socketDepth[k];
      ctx.lineTo(fromX + ux * (t - HO), fromY + uy * (t - HO));
      ctx.lineTo(fromX + ux * (t - HI) + nx * depth, fromY + uy * (t - HI) + ny * depth);
      ctx.lineTo(fromX + ux * (t + HI) + nx * depth, fromY + uy * (t + HI) + ny * depth);
      ctx.lineTo(fromX + ux * (t + HO), fromY + uy * (t + HO));
    }
    ctx.lineTo(toX, toY);
    ctx.arcTo(cx1, cy1, cx2, cy2, r);
  }
  ctx.closePath();
}

// The socket's own shape in pin coordinates: the origin on the border
// point, +x out of the face. A dent lies at negative x, a tab at positive.
function socketPath(ctx, shape) {
  const HO = SOCKET_HALF_OUTER;
  const HI = SOCKET_HALF_INNER;
  if (shape === 'both') {
    ctx.moveTo(SOCKET_RING_RADIUS, 0);
    ctx.arc(0, 0, SOCKET_RING_RADIUS, 0, Math.PI * 2);
    return;
  }
  const d = shape === 'in' ? -SOCKET_DEPTH : SOCKET_DEPTH;
  ctx.moveTo(0, -HO);
  ctx.lineTo(d, -HI);
  ctx.lineTo(d, HI);
  ctx.lineTo(0, HO);
  ctx.closePath();
}

function withPinFrame(ctx, p, side, draw) {
  const n = sideNormal(side);
  ctx.save();
  ctx.translate(p.x, p.y);
  ctx.rotate(Math.atan2(n.y, n.x));
  draw();
  ctx.restore();
}

// A socket drawn on its own: the ring of a two-way pin on a block's
// border, every pin of a frame, an exterior sub-slot, and the hover
// outline of any of them (`fill` null, `halo` on).
function drawSocket(ctx, p, side, shape, stroke, fill, lineWidth, halo = false) {
  withPinFrame(ctx, p, side, () => {
    ctx.beginPath();
    socketPath(ctx, shape);
    if (fill) {
      ctx.fillStyle = fill;
      ctx.fill();
    }
    if (halo) {
      strokeWithHalo(ctx, stroke, lineWidth);
      return;
    }
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.stroke();
  });
}


// A wire at a pin, in the wire's colour. Its grip — one compact rounded
// handle with a dark border, identical at both ends of every wire — never
// covers the socket. On an output it sits GRIP_GAP past the tip of the
// tab, which turns a shade darker once connected (see shadeTab). On a pin
// the data flows INTO, the socket itself is filled (see socketFillPath),
// the grip sits the same GRIP_GAP out from the border where that filling
// ends, and a wire-wide line joins the two. A two-way ring keeps just the
// grip. `inverted` puts the wire inside (a frame pin seen from within its
// container), which also flips which of in/out the data flows into.
// `hover` draws it translucent with the hover outline: the grip about to
// be picked up.
function gripPath(ctx, w, from) {
  const a = from;
  const b = from + GRIP_LENGTH;
  const h = GRIP_HALF;
  const r = PLUG_RADIUS;
  const X = (v) => w * v;
  ctx.moveTo(X(a), -h + r);
  ctx.arcTo(X(a), -h, X(a + r), -h, r);
  ctx.lineTo(X(b - r), -h);
  ctx.arcTo(X(b), -h, X(b), -h + r, r);
  ctx.lineTo(X(b), h - r);
  ctx.arcTo(X(b), h, X(b - r), h, r);
  ctx.lineTo(X(a + r), h);
  ctx.arcTo(X(a), h, X(a), h - r, r);
  ctx.closePath();
}

// The filling of a socket: the socket's trapezoid (see socketPath), open
// end on the border, its two slanted walls and its back wall each moved in
// by SOCKET_FILL_GAP — the slanted ones along their own normal — so the gap
// is even all round and every edge stays parallel to the wall behind it.
// `s` is the side the socket lies on: -1 for a dent into the face, +1 for
// a tab out of it.
function socketFillPath(ctx, s) {
  const HO = SOCKET_HALF_OUTER;
  const HI = SOCKET_HALF_INNER;
  const D = SOCKET_DEPTH;
  const g = SOCKET_FILL_GAP;
  const slope = (HO - HI) / D;
  const lift = (g * Math.hypot(D, HO - HI)) / D;
  const openHalf = HO - lift;
  const backHalf = HI + slope * g - lift;
  ctx.moveTo(0, -openHalf);
  ctx.lineTo(s * (D - g), -backHalf);
  ctx.lineTo(s * (D - g), backHalf);
  ctx.lineTo(0, openHalf);
  ctx.closePath();
}

// The socket's filling on its own (see socketFillPath), in a live colour:
// the state of a pin nothing is wired to on this side of the border.
function fillSocket(ctx, p, side, shape, color) {
  withPinFrame(ctx, p, side, () => {
    ctx.fillStyle = color;
    ctx.beginPath();
    socketFillPath(ctx, shape === 'in' ? -1 : 1);
    ctx.fill();
  });
}

function drawPinPlug(ctx, p, side, inverted, shape, color, hover = false, showGrip = true) {
  const w = inverted ? -1 : 1;
  const intoPin = (shape === 'in' && !inverted) || (shape === 'out' && inverted);
  const gripFrom = intoPin ? GRIP_GAP : GRIP_FROM;
  withPinFrame(ctx, p, side, () => {
    ctx.fillStyle = color;
    if (intoPin) {
      ctx.beginPath();
      socketFillPath(ctx, shape === 'in' ? -1 : 1);
      ctx.fill();
      // Out through the gap and on under the grip to where the wire itself
      // attaches (CONNECTOR_NUB_LENGTH), so the line runs unbroken.
      const x0 = Math.min(0, w * CONNECTOR_NUB_LENGTH);
      ctx.fillRect(x0, -PLUG_STEM_HALF, CONNECTOR_NUB_LENGTH, 2 * PLUG_STEM_HALF);
    }
    if (!showGrip) {
      // Boundary outputs already have a visible socket and wire. Drawing the
      // ordinary detachable-wire grip here made that one DI look like two
      // adjacent slots. Join the wire directly to the socket instead.
      const x0 = Math.min(0, w * CONNECTOR_NUB_LENGTH);
      ctx.fillRect(x0, -PLUG_STEM_HALF, CONNECTOR_NUB_LENGTH, 2 * PLUG_STEM_HALF);
      return;
    }
    ctx.beginPath();
    gripPath(ctx, w, gripFrom);
    ctx.fill();
    if (hover) {
      strokeWithHalo(ctx, SOCKET_HOVER_COLOR, PLUG_HOVER_WIDTH);
    } else {
      ctx.strokeStyle = GRIP_BORDER_COLOR;
      ctx.lineWidth = GRIP_BORDER_WIDTH;
      ctx.lineJoin = 'round';
      ctx.stroke();
    }
  });
}

// Two pins are plugged together — connected with no wire at all — when one
// block's output tab sits exactly in another block's input dent: the same
// point on the border, facing sides, one 'out' and one 'in'. The tab and
// the dent are the same trapezoid, so the two outlines then meet with no
// gap. Nothing is stored for it: a plug is an ordinary connection whose
// two pins happen to meet, so it saves, loads, shares and exports as the
// connection it is, and a reader that has never heard of plugs simply
// sees a very short wire.
const PLUG_EPSILON = 0.5;

export function pinsArePlugged(blockA, portA, blockB, portB) {
  if (!blockA || !blockB || !portA || !portB || blockA.id === blockB.id) return false;
  if (blockA.kind === 'text' || blockB.kind === 'text') return false;
  const na = sideNormal(portA.side);
  const nb = sideNormal(portB.side);
  if (na.x !== -nb.x || na.y !== -nb.y) return false;
  const shapes = [
    pinShapeOf(logicalPortOf(blockA, portA)?.direction ?? null),
    pinShapeOf(logicalPortOf(blockB, portB)?.direction ?? null),
  ].sort().join();
  if (shapes !== 'in,out') return false;
  const a = getPortPosition(blockA, portA);
  const b = getPortPosition(blockB, portB);
  return Math.abs(a.x - b.x) < PLUG_EPSILON && Math.abs(a.y - b.y) < PLUG_EPSILON;
}

// Whether `connection` is plugged rather than wired, in `view` (a Project
// or a LevelView). A wire to the container's own frame never is: the
// container is not a sibling that could be pushed up against a pin.
export function isPluggedConnection(view, connection) {
  const containerId = view.getContainerBlock?.()?.id;
  if (connection.sourceBlockId === containerId || connection.targetBlockId === containerId) return false;
  const a = view.getBlock(connection.sourceBlockId);
  const b = view.getBlock(connection.targetBlockId);
  const pa = a?.ports?.find((p) => p.id === connection.sourcePortId);
  const pb = b?.ports?.find((p) => p.id === connection.targetPortId);
  return pinsArePlugged(a, pa, b, pb);
}

// Where a wire's plug is grabbed: the body on the wire's side of the
// border, from the socket's edge out to PLUG_REACH, as an axis-aligned
// world rect. Kept clear of the socket itself, which is the pin's own
// body (see getSlotRectFromBorderPoint): on the socket you move the pin,
// on the plug you take the wire.
export function getPlugRect(pos, side, inverted = false) {
  const n = sideNormal(side);
  const w = inverted ? -1 : 1;
  const a = SOCKET_DEPTH * w;
  const b = PLUG_REACH * w;
  const lo = Math.min(a, b);
  const hi = Math.max(a, b);
  if (n.x !== 0) {
    const x0 = pos.x + (n.x > 0 ? lo : -hi);
    const x1 = pos.x + (n.x > 0 ? hi : -lo);
    return { x: x0, y: pos.y - SOCKET_HALF_OUTER, width: x1 - x0, height: 2 * SOCKET_HALF_OUTER };
  }
  const y0 = pos.y + (n.y > 0 ? lo : -hi);
  const y1 = pos.y + (n.y > 0 ? hi : -lo);
  return { x: pos.x - SOCKET_HALF_OUTER, y: y0, width: 2 * SOCKET_HALF_OUTER, height: y1 - y0 };
}

// One pin: its socket where the outline does not already carry it, the
// plug of the wire on it, and the hover feedback — `hover` is 'slot' (the
// socket outlined: this pin is about to be moved along its edge) or
// 'plug' (the plug outlined: the wire is about to be picked up).
function drawPin(ctx, pos, side, inverted, shape, { stroke, fill, lineWidth, wireColor = null, liveColor = null, hover = null, connected = false, shade = null }) {
  if (inverted || shape === 'both') drawSocket(ctx, pos, side, shape, stroke, fill, lineWidth);
  if (connected && shape === 'out' && !inverted && shade) shadeTab(ctx, pos, side, stroke, shade, lineWidth);
  if (wireColor) drawPinPlug(ctx, pos, side, inverted, shape, wireColor, false, !(inverted && shape === 'in'));
  // A pin with a live state but no wire on this side shows the state in
  // its socket alone. The plug is the wire at the pin, so a pin whose wire
  // arrives from the other side of the border (a board's input, wired
  // from inside its level) must not grow a grip out here as well.
  else if (liveColor && shape !== 'both') fillSocket(ctx, pos, side, shape, liveColor);
  if (hover === 'slot') drawSocket(ctx, pos, side, shape, SOCKET_HOVER_COLOR, null, SOCKET_HOVER_WIDTH, true);
  if (hover === 'plug') drawPinPlug(ctx, pos, side, inverted, shape, PLUG_HOVER_FILL, true);
}

// An output's tab once something is connected to it — by a wire or by a
// block plugged straight into it — shaded a little darker than the face it
// grows out of, so a connected output reads apart from a free one at a
// glance. Only the tab's three outer edges are re-stroked: its base lies
// along the block's own border, where no line is drawn.
function shadeTab(ctx, pos, side, stroke, shade, lineWidth) {
  withPinFrame(ctx, pos, side, () => {
    ctx.beginPath();
    socketPath(ctx, 'out');
    ctx.fillStyle = shade;
    ctx.fill();
    ctx.beginPath();
    ctx.moveTo(0, -SOCKET_HALF_OUTER);
    ctx.lineTo(SOCKET_DEPTH, -SOCKET_HALF_INNER);
    ctx.lineTo(SOCKET_DEPTH, SOCKET_HALF_INNER);
    ctx.lineTo(0, SOCKET_HALF_OUTER);
    ctx.strokeStyle = stroke;
    ctx.lineWidth = lineWidth;
    ctx.lineJoin = 'round';
    ctx.stroke();
  });
}

function drawPortRing(ctx, x, y, color, radius) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
}

// A pin's own rect, centered on the border point: the socket (see
// socketPath) whichever way it goes. Exported so HitTest hit-tests the
// area actually drawn, not an approximation of it.
export function getSlotRectFromBorderPoint(px, py, side) {
  const horizontal = side === 'left' || side === 'right';
  // The socket's footprint: SOCKET_DEPTH to either side of the border
  // (a dent's depth in, a tab's reach out), SOCKET_HALF_OUTER along it.
  const w = horizontal ? 2 * SOCKET_DEPTH : 2 * SOCKET_HALF_OUTER;
  const h = horizontal ? 2 * SOCKET_HALF_OUTER : 2 * SOCKET_DEPTH;
  return { x: px - w / 2, y: py - h / 2, width: w, height: h };
}

// The exact rect an ordinary (non-inverted) block's port slot is drawn at.
export function getPortSlotRect(block, port) {
  const { x, y } = getPortPosition(block, port);
  return getSlotRectFromBorderPoint(x, y, port.side);
}

// A pin is a small rounded pill in one colour, no outline: the pale halo
// that used to ring it read as a gap between the pin and its block. A
// stroke is drawn only when one is asked for (the add-port ghost).
const SLOT_CORNER_RADIUS = 1.5;
function drawSlotSquare(ctx, rect, fill, stroke = null) {
  roundRectPath(ctx, rect.x, rect.y, rect.width, rect.height, Math.min(SLOT_CORNER_RADIUS, rect.width / 2, rect.height / 2));
  ctx.fillStyle = fill;
  ctx.fill();
  if (!stroke) return;
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
    // Only the port *labels* use this, to stop growing past a readable
    // on-screen size (see portLabelFontSize) — every other measurement in
    // here is world-space geometry that scales with the diagram.
    zoom = 1,
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
    // See drawPortLabel — ordinary blocks only.
    labelsOutside = 0,
    // Ordinary blocks: Map<portId, wire colour | null> for every pin that
    // is connected in this level (see SubPreviewRenderer.drawLevel). A
    // colour is the wire's, for its grip; null is a pin plugged straight
    // into another block — connected, but with no wire and so no grip. A
    // frame's wires carry their colour on the boundaryWireLabels entries
    // instead.
    pinWires = null,
    // { blockId, portId, part: 'slot' | 'plug', connectionId, wireIndex }
    // for the pin under the mouse (see DragStateMachine.getHoverPin), or
    // null.
    hoverPin = null,
    // Whether each port's own name is written next to it. Off for a
    // level's pins drawn on the frame inside its block's face (see
    // SubPreviewRenderer.drawLevel): the block's exterior pin, drawn by
    // the level above, already carries the name just outside the same
    // border, and the two together read as one pin labelled twice. A
    // wire's own label (a widened port's per-wire entries) is not a port
    // name and is drawn regardless.
    portNames = true,
  } = {},
) {
  // A socket is drawn in the block's border colour — a host's state colour
  // (see BlockDescription.getStateColor) winning over the accent — with
  // the face's own fill, so it reads as part of the outline it sits in.
  const accent = block.style?.color && block.style.color !== 'transparent' ? block.style.color : null;
  const socketStroke = getStateColor(block) || accent || DEFAULT_BLOCK_COLOR;
  const socketFill = block.style?.fill === 'transparent' ? null : block.style?.fill || palette.blockFill;
  const socketWidth = Math.min(BORDER_WIDTH, BORDER_MAX_SCREEN_WIDTH / zoom);
  const hoverHere = hoverPin && hoverPin.blockId === block.id ? hoverPin : null;

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
    // Hidden (see BlockDescription.isPortHidden): the pin's slot stays
    // reserved in every offset/occupancy calculation around this loop, so
    // revealing it later puts it back exactly where it always was — it
    // just isn't painted, here or on a container's boundary frame.
    if (logical?.hidden) continue;
    const portName = logical?.name || '';
    const portDirection = logical?.direction ?? null;
    // Boundary-only: [{ id, rank, label }] for every wire currently on
    // this port from inside (see SceneRenderer), `rank` being its plain
    // fallback position (Project.listBoundaryWires' own order) for
    // whichever of them hasn't been individually pinned to a slot yet
    // (see getBoundaryWireRelativeIndex).
    const wireEntries = inverted ? boundaryWireLabels?.get(port.id) || [] : [];
    const reservedWidth = inverted ? getPortBoundaryPlacement(port, block).width || 1 : 1;
    // One slot per wire on the INSIDE — the fan the interface actually
    // has — even when the port was never explicitly widened. This is the
    // interior view (`inverted`), and it is the half that should split:
    // seen from in here, a container's single outer pin is exactly a
    // bundle of the individual wires attached to it, each with its own
    // child-side label. The EXTERIOR face is the half that must stay one
    // pin, and that is handled separately (see drawExteriorSubSlots).
    //
    // Wires have to be counted here and not just the reserved width: wire
    // routing positions each wire at its own slot index regardless, so
    // drawing fewer pins than there are wires left the extra wires running
    // to a point with no pin on it.
    const rectCount = Math.max(1, wireEntries.length, reservedWidth);
    const effectiveSide = inverted ? getPortBoundaryPlacement(port, block).side : port.side;
    const shape = pinShapeOf(portDirection);
    const hover = hoverHere && hoverHere.portId === port.id ? hoverHere : null;
    const liveColor = typeof window !== 'undefined' ? window.nodigraphPortColor?.(block, port) : null;
    const liveValue = typeof window !== 'undefined' ? window.nodigraphPortValue?.(block, port) : undefined;
    const displayedPortName = liveValue === undefined || liveValue === null ? portName : `${portName} ${liveValue ? 1 : 0}`;
    const pinStyle = { stroke: liveColor || socketStroke, fill: liveColor || socketFill, lineWidth: socketWidth, shade: liveColor || palette.connectedTabShade };

    // A widened (or already multi-wire) boundary port reads as one visible
    // group — a light, *always-shown* outline (not gated on selection, so
    // "these wires belong together" doesn't require clicking anything
    // first), holding the port's own name once, centered on it, while
    // each wire inside keeps its own distinct pin with its OWN (child-
    // side) label. A still-plain, single-wire port draws neither: it's
    // just the one ordinary-looking pin an outer-face port has always
    // been, name and all — same "old wiring" look until it actually
    // becomes a container (drag one of the width grips it shows once
    // selected — see the plain-case branch below, which draws the same
    // two).
    if (inverted && rectCount > 1) {
      const rect = getBoundaryPortBlockRect(block, port, rectCount);
      drawContainerGroupOutline(ctx, rect, palette);
      const ringColor = portHighlights?.get(`${block.id}:${port.id}`);
      if (ringColor === PORT_SELECTED_RING_COLOR) {
        drawPortResizeHandles(ctx, getPortResizeHandleRects(block, port, rectCount), palette);
      }
      const center = { x: rect.x + rect.width / 2, y: rect.y + rect.height / 2 };
      if (portNames) drawPortLabel(ctx, { name: displayedPortName, side: effectiveSide }, center, inverted, palette, zoom);

      wireEntries.forEach((entry, index) => {
        const isMoving = wireMoveOverride && wireMoveOverride.portId === port.id && wireMoveOverride.connectionId === entry.id;
        const { x: px, y: py } = isMoving
          ? getBoundaryWirePosition(block, port, wireMoveOverride.previewIndex)
          : getBoundaryWirePosition(block, port, entry.rank, entry.id);
        // The hover names one wire of the group (by id, or by slot for a
        // wire it has no id for); a hit on the group as a whole names none
        // and lights every sub-slot.
        const hoverThis = hover && (hover.connectionId ? hover.connectionId === entry.id : hover.wireIndex == null || hover.wireIndex === index);
        drawPin(ctx, { x: px, y: py }, effectiveSide, inverted, shape, { ...pinStyle, wireColor: entry.color || null, hover: hoverThis ? hover.part : null });
        const wireRingColor = portHighlights?.get(`${block.id}:${port.id}`);
        if (wireRingColor) drawPortRing(ctx, px, py, wireRingColor, SLOT_RING_RADIUS);
        // Every wire shows only its OWN (child-side) label here — the
        // port's own name/identity is the centered one drawn once above,
        // never repeated (or substituted in) at any individual wire.
        if (entry.label) drawPortLabel(ctx, { name: entry.label, side: effectiveSide }, { x: px, y: py }, inverted, palette, zoom);
      });
      continue;
    }

    // Plain single-wire case (boundary or ordinary block alike) — exactly
    // one dot, the port's own name shown right there, same as it always
    // has been.
    const { x: px, y: py } = inverted ? getBoundaryWirePosition(block, port, 0) : getPortPosition(block, port);
    // A plug only where a wire is, on this side of the border: a live
    // colour tints the plug of a wired pin, and fills the socket of an
    // unwired one (see drawPin), but never conjures a plug by itself.
    const wired = inverted ? wireEntries.length > 0 : Boolean(pinWires?.has(port.id));
    const wireColor = wired ? liveColor || (inverted ? wireEntries[0]?.color || null : pinWires?.get(port.id) || null) : null;
    const connected = !inverted && Boolean(pinWires?.has(port.id));
    drawPin(ctx, { x: px, y: py }, effectiveSide, inverted, shape, { ...pinStyle, wireColor, liveColor, connected, hover: hover ? hover.part : null });
    const ringColor = portHighlights?.get(`${block.id}:${port.id}`);
    if (ringColor) drawPortRing(ctx, px, py, ringColor, SLOT_RING_RADIUS);
    // Selecting a still-plain boundary port shows the same two width grips
    // a widened one has, so growing it into a multi-wire container is an
    // explicit target rather than a direction-sensitive drag of its own
    // wire — that overload used to swallow "move this wire to the port
    // next door," since both are a drag along the same edge.
    if (inverted && ringColor === PORT_SELECTED_RING_COLOR) {
      drawPortResizeHandles(ctx, getPortResizeHandleRects(block, port, rectCount), palette);
    }
    if (portNames) drawPortLabel(ctx, { name: displayedPortName, side: effectiveSide }, { x: px, y: py }, inverted, palette, zoom, labelsOutside);
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

// The text a block carries besides its ports: the name, an optional
// smaller `subtitle` under it, and optional monospace detail `lines`
// (a bus address, a rate, a package name). Before these existed a card
// with a heading and two detail rows needed an empty block plus three
// `kind: text` blocks stacked on top of it (see the old recipe in
// docs/LLM-AUTHORING.md) — four blocks that did not move together and
// collided with the sub-architecture miniature a container draws on its
// own face. This draws the whole stack as one block's own content.
//
// `style.titlePos` (top / center / bottom) places the stack; it defaults to
// `center` for a bare name — exactly where the name was always drawn — and
// to `top` once a subtitle or lines are present, so a card reads
// heading-first. `style.titleAlign` (left / center / right) aligns every
// row the same way. Rows are squeezed to the block width like the name
// always was, never wrapped.
const TEXT_PAD_X = 10;
const TEXT_PAD_Y = 8;
const SUBTITLE_SCALE = 0.85;
const LINE_SCALE = 0.8;
const SUBTITLE_ALPHA = 0.72;
const LINE_ALPHA = 0.85;

// The header band an open block keeps its heading in (see drawOpenHeader).
// The scrim is not fully opaque on purpose: the level behind it stays
// visible through the band, so the heading reads as a label on the face
// rather than a lid over it.
const HEADER_SCRIM_ALPHA = 0.86;
const HEADER_RULE_WIDTH = 1;

export function blockTextRows(block) {
  const style = block.style || {};
  const fontFamily = getFontFamily(style.font);
  const fontSize = style.fontSize || 13;
  const fontWeight = style.bold ? 'bold ' : '';
  const fontStyle = style.italic ? 'italic ' : '';
  const subtitle = typeof block.subtitle === 'string' && block.subtitle !== '' ? block.subtitle : null;
  const lines = Array.isArray(block.lines) ? block.lines.map((l) => (l === null || l === undefined ? '' : String(l))).filter((l) => l !== '') : [];
  const subtitleSize = Math.max(8, Math.round(fontSize * SUBTITLE_SCALE));
  const lineSize = Math.max(8, Math.round(fontSize * LINE_SCALE));
  const rows = [];
  if (block.name) rows.push({ role: 'title', text: block.name, font: `${fontStyle}${fontWeight}${fontSize}px ${fontFamily}`, height: fontSize * 1.3, alpha: 1 });
  if (subtitle) rows.push({ role: 'subtitle', text: subtitle, font: `${fontStyle}${subtitleSize}px ${fontFamily}`, height: subtitleSize * 1.3, alpha: SUBTITLE_ALPHA });
  for (const line of lines) rows.push({ role: 'line', text: line, font: `${lineSize}px ${getFontFamily('mono')}`, height: lineSize * 1.4, alpha: LINE_ALPHA });
  return rows;
}

// Shared by title hit-testing and the inline editor. Match both the closed
// text stack and the smaller heading drawn above an open interior.
export function getBlockTitleRect(block, { open = false } = {}) {
  const rows = blockTextRows(block);
  const title = rows.find(row => row.role === 'title');
  if (!title || isImageUrl(title.text)) return null;
  const g = block.geometry;
  const style = block.style || {};
  const scale = open && block.boundaryGeometry ? frameToFace(g, block.boundaryGeometry).scale : 1;
  const align = TITLE_ALIGNMENTS.includes(style.titleAlign) ? style.titleAlign : 'center';
  const total = rows.reduce((sum, row) => sum + row.height, 0);
  const pos = TITLE_POSITIONS.includes(style.titlePos) ? style.titlePos : rows.length > 1 ? 'top' : 'center';
  const y = open || pos === 'top' ? g.y + TEXT_PAD_Y * scale
    : pos === 'bottom' ? g.y + g.height - TEXT_PAD_Y - total : g.y + (g.height - total) / 2;
  const available = Math.max(1, g.width - 2 * TEXT_PAD_X * scale);
  const width = Math.min(available, measureText(title.text, title.font) * scale + 8 * scale);
  const x = align === 'left' ? g.x + TEXT_PAD_X * scale
    : align === 'right' ? g.x + g.width - TEXT_PAD_X * scale - width : g.x + (g.width - width) / 2;
  return { x, y, width, height: Math.min(title.height * scale, g.height), fontSize: (style.fontSize || 13) * scale };
}

function drawBlockText(ctx, block, { x, y, width, height, textColor, requestRender }) {
  const rows = blockTextRows(block);
  if (rows.length === 0) return;
  const style = block.style || {};
  const hasExtra = rows.length > 1 || !block.name;
  const titlePos = TITLE_POSITIONS.includes(style.titlePos) ? style.titlePos : hasExtra ? 'top' : 'center';
  const titleAlign = TITLE_ALIGNMENTS.includes(style.titleAlign) ? style.titleAlign : 'center';
  // Canvas text can't await a web font mid-render — draws with the
  // fallback stack immediately and asks for a redraw once the real one
  // is ready, the same pattern the image case uses.
  for (const row of rows) ensureFontLoaded(row.font, requestRender);
  const total = rows.reduce((sum, row) => sum + row.height, 0);
  let cursor = titlePos === 'top' ? y + TEXT_PAD_Y : titlePos === 'bottom' ? y + height - TEXT_PAD_Y - total : y + height / 2 - total / 2;
  const tx = titleAlign === 'left' ? x + TEXT_PAD_X : titleAlign === 'right' ? x + width - TEXT_PAD_X : x + width / 2;
  const maxWidth = width - 16;
  const baseAlpha = ctx.globalAlpha;
  ctx.fillStyle = textColor;
  ctx.textAlign = titleAlign;
  ctx.textBaseline = 'middle';
  for (const row of rows) {
    ctx.font = row.font;
    ctx.globalAlpha = baseAlpha * row.alpha;
    ctx.fillText(row.text, tx, cursor + row.height / 2, maxWidth);
    cursor += row.height;
  }
  ctx.globalAlpha = baseAlpha;
}

/**
 * The title and subtitle of a block whose level is open on its face.
 *
 * The centred text stack fades out as the level arrives (see
 * SubPreviewRenderer.contentAlphaFor) — it would otherwise sit in the
 * middle of the children — so the heading rows come back as a band along
 * the top of the face. Everything here is drawn in the coordinates of the
 * level inside, so the title is the same size as the names of the blocks
 * it contains rather than the frame scale times them, and a heading stays
 * proportional to its own contents however deep the nesting goes.
 *
 * Detail `lines` are deliberately left out: they are per-block data, not a
 * heading, and they keep fading with the centred stack. A name that is an
 * image URL is left out too — the picture is the label, and the raw URL
 * would be a worse one.
 *
 * Call it after the level has been painted onto the face, so the band sits
 * over the children rather than under them.
 */
export function drawOpenHeader(ctx, block, { alpha = 1, palette = DEFAULT_PALETTE, requestRender = () => {} } = {}) {
  const frame = block.boundaryGeometry;
  if (alpha <= 0 || !frame) return;
  const rows = blockTextRows(block).filter(
    (row) => row.role === 'subtitle' || (row.role === 'title' && !isImageUrl(row.text)),
  );
  if (rows.length === 0) return;

  const { x, y, width, height } = block.geometry;
  const layout = frameToFace(block.geometry, frame);
  const style = block.style || {};
  const scrimColor = style.fill && style.fill !== 'transparent' ? style.fill : palette.blockFill;
  const textColor = style.fill && style.fill !== 'transparent' ? readableTextColor(style.fill) : palette.blockText;
  const titleAlign = TITLE_ALIGNMENTS.includes(style.titleAlign) ? style.titleAlign : 'center';
  for (const row of rows) ensureFontLoaded(row.font, requestRender);

  ctx.save();
  // The same outline the face itself is drawn with (see drawBlock), so a
  // socket on the top edge cuts the band exactly as it cuts the block.
  blockOutlinePath(ctx, block.geometry, socketsOf(block));
  ctx.clip();
  ctx.globalAlpha *= alpha;
  ctx.translate(x, y);
  ctx.scale(layout.scale, layout.scale);

  // From here on the units are the level's own, the same ones its blocks
  // are laid out in.
  const faceWidth = width / layout.scale;
  const bandHeight = rows.reduce((sum, row) => sum + row.height, 0) + TEXT_PAD_Y * 2;
  const textWidth = Math.max(...rows.map((row) => measureText(row.text, row.font)));
  const bandWidth = Math.min(faceWidth, textWidth + TEXT_PAD_X * 2);
  const bandX = titleAlign === 'left' ? 0 : titleAlign === 'right' ? faceWidth - bandWidth : (faceWidth - bandWidth) / 2;
  const baseAlpha = ctx.globalAlpha;

  ctx.globalAlpha = baseAlpha * HEADER_SCRIM_ALPHA;
  ctx.fillStyle = scrimColor;
  ctx.fillRect(bandX, 0, bandWidth, bandHeight);
  ctx.globalAlpha = baseAlpha;
  ctx.fillStyle = palette.emptySlotStroke;
  ctx.fillRect(bandX, bandHeight - HEADER_RULE_WIDTH, bandWidth, HEADER_RULE_WIDTH);

  ctx.fillStyle = textColor;
  ctx.textAlign = titleAlign;
  ctx.textBaseline = 'middle';
  const tx = titleAlign === 'left' ? bandX + TEXT_PAD_X : titleAlign === 'right' ? bandX + bandWidth - TEXT_PAD_X : bandX + bandWidth / 2;
  let cursor = TEXT_PAD_Y;
  for (const row of rows) {
    ctx.font = row.font;
    ctx.globalAlpha = baseAlpha * row.alpha;
    ctx.fillText(row.text, tx, cursor + row.height / 2, bandWidth - TEXT_PAD_X * 2);
    cursor += row.height;
  }
  ctx.restore();
}

// A block is a plain titled box with its name centered — no header band.
// Its Input/Output ports are handles on the border, on any of the four
// sides. When you drill into a block, its own border becomes the frame
// that shows those same ports (Milestone 3).
export function drawBlock(
  ctx,
  block,
  {
    selected = false,
    portHighlights = null,
    requestRender = () => {},
    palette = DEFAULT_PALETTE,
    zoom = 1,
    // The opacity of the big centered name, which the block's own level
    // replaces once it is shown on the face (see
    // SubPreviewRenderer.contentAlphaFor). 1 for every block with no
    // level to show, which leaves this drawing precisely what it always
    // drew.
    contentAlpha = 1,
    // How far the pin labels have moved from inside the face to beside
    // the pins outside it (0..1) — they move out as the level inside
    // arrives, where they would otherwise sit right where its wires
    // reach the frame. See drawPortLabel.
    portLabelsOutside = 0,
    // See drawPorts.
    pinWires = null,
    hoverPin = null,
    // Whether this block draws as a chip — the side wall and the drop
    // shadow under it — or as its plain face alone. Defaults to the user's
    // own Settings > Improved view choice (see render/viewOptions.js),
    // which is off, because the chip costs two blurred fills per block and
    // that is what a large diagram stalls on.
    improvedView = isImprovedView(),
  } = {},
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
  //
  // The outline carries the pins' sockets (see blockOutlinePath): the
  // fill, the shadow, the border and the content clip all follow it.
  const sockets = socketsOf(block);
  // World units, so the border scales with the block like everything
  // else — capped in screen pixels, because the block you are editing
  // inside of (see SubPreviewRenderer.drawLevel) is drawn at three times
  // the zoom of its own level per nesting step, and its border would
  // otherwise turn into a wall around the level.
  const borderWidth = Math.min(BORDER_WIDTH, BORDER_MAX_SCREEN_WIDTH / zoom);

  // The chip's side wall and the shadow under it (see CHIP_DEPTH). A
  // deliberately paint-nothing block (fillColor === 'transparent', see
  // SelectionFabs' transparent swatch) is meant to read as bare floating
  // text with no chip at all, so it gets neither. Nor does the SVG
  // recording context (render/svgContext.js): it has no shadows, and an
  // exported figure is a flat drawing — it gets the plain face alone. Nor
  // does the plain view, which is the default (see improvedView above).
  if (improvedView && fillColor !== 'transparent' && 'shadowColor' in ctx) {
    const depth = CHIP_DEPTH / zoom;
    ctx.save();
    // A pin with a null entry in pinWires is plugged, not wired (see
    // drawPorts); its socket keeps the side wall out (see pluggedSocketBox).
    const plugged = (block.ports || []).filter((port) => pinWires?.has(port.id) && pinWires.get(port.id) === null && !isPortHidden(block, port));
    if (plugged.length) {
      ctx.beginPath();
      ctx.rect(x - 1e5, y - 1e5, 2e5, 2e5);
      for (const port of plugged) {
        const box = pluggedSocketBox(getPortPosition(block, port), port.side, pinShapeOf(logicalPortOf(block, port)?.direction ?? null), depth);
        ctx.rect(box.x, box.y, box.width, box.height);
      }
      ctx.clip('evenodd');
    }
    ctx.translate(0, depth);
    blockOutlinePath(ctx, block.geometry, sockets);
    ctx.fillStyle = fillColor;
    for (const layer of PAPER_SHADOW_LAYERS) {
      ctx.save();
      ctx.shadowColor = `rgba(${palette.blockShadowRgb}, ${layer.alpha})`;
      ctx.shadowBlur = layer.blur / zoom;
      ctx.shadowOffsetY = layer.offsetY / zoom;
      ctx.fill();
      ctx.restore();
    }
    ctx.fillStyle = CHIP_SIDE_SHADE;
    ctx.fill();
    ctx.lineWidth = borderWidth;
    ctx.strokeStyle = accentColor;
    ctx.stroke();
    ctx.restore();
  }

  // The face, over the side wall: what is left showing of the side is the
  // thin band under the face's bottom edge and under every tab.
  blockOutlinePath(ctx, block.geometry, sockets);
  ctx.fillStyle = fillColor;
  ctx.fill();
  ctx.lineWidth = borderWidth;
  ctx.strokeStyle = accentColor;
  ctx.stroke();

  ctx.save();
  blockOutlinePath(ctx, block.geometry, sockets);
  ctx.clip();

  // A block's name doubles as an image source: point it at a picture
  // instead of typing a label, and that's what fills the block. Falls
  // back to the plain name (as the URL, admittedly not pretty, but
  // truthful about what's there) until the image has actually loaded, or
  // if it never does.
  const image = isImageUrl(block.name) ? getCachedImage(block.name, requestRender) : null;
  if (contentAlpha < 1) ctx.globalAlpha = contentAlpha;
  if (image) {
    drawContainImage(ctx, image, x, y, width, height);
  } else {
    drawBlockText(ctx, block, { x, y, width, height, textColor, requestRender });
  }

  ctx.restore();

  // A text block has no ports and can't gain one (see addPort's kind
  // guard) — showing the discoverable empty-slot squares on it would
  // advertise an affordance that doesn't work.
  // The free slots also show while a pin of this block is hovered: they
  // are where it can be moved to.
  const slotHover = hoverPin?.blockId === block.id && hoverPin.part === 'slot';
  drawPorts(ctx, block, { portHighlights, showEmptySlots: (selected || slotHover) && block.kind !== 'text', palette, zoom, labelsOutside: portLabelsOutside, pinWires, hoverPin });
  if (isOpenableLink(block.link)) drawLinkGlyph(ctx, block.geometry, palette, zoom);
  if (selected) drawResizeHandles(ctx, block.geometry, palette, zoom);
}

// A block's pins alone, drawn again over the wires of its level (see
// SubPreviewRenderer.drawLevel): a wire's z-index is that of its front
// endpoint, so it would otherwise cover the arrowhead of the pin it
// leaves from on the other block.
export function drawBlockPorts(ctx, block, { portHighlights = null, palette = DEFAULT_PALETTE, zoom = 1, labelsOutside = 0, pinWires = null, hoverPin = null } = {}) {
  drawPorts(ctx, block, { portHighlights, palette, zoom, labelsOutside, pinWires, hoverPin });
}

// The sub-slots of a container's multi-wire pins, drawn at the exterior
// pin's own size, next to it: the plug outside is one connector, and once
// the level inside is open its wires attach to individual pins (see
// getBoundaryWirePosition). `wireCounts` maps port id → number of wires
// on it from inside; a pin with one wire has nothing to add. Each extra
// pin is one more pill of the same colour along the same edge, the whole
// row tied together by a light outline, so the connector reads as "one
// plug, n pins" without the level's own tiny frame glyphs having to.
export function drawExteriorSubSlots(ctx, block, wireCounts, { palette = DEFAULT_PALETTE, alpha = 1 } = {}) {
  const frame = block.boundaryGeometry;
  if (!frame || !wireCounts?.size) return;
  const accent = block.style?.color && block.style.color !== 'transparent' ? block.style.color : null;
  const color = getStateColor(block) || accent || DEFAULT_BLOCK_COLOR;
  const fill = block.style?.fill === 'transparent' ? null : block.style?.fill || palette.blockFill;
  const t = frameToFace(block.geometry, frame);
  const toFace = (p) => ({ x: p.x * t.scale + t.offsetX, y: p.y * t.scale + t.offsetY });
  ctx.save();
  ctx.globalAlpha *= alpha;
  for (const port of block.ports || []) {
    if (isPortHidden(block, port)) continue;
    const view = asBoundaryView(block, frame, [port]);
    // The reserved width, not the wire count — same rule as drawPorts (see
    // its own rectCount note). A port that was never widened is one pin
    // however many wires reach it from inside, so wiring a second thing to
    // it must not sprout a second socket on the face and wrap the pair in
    // a group outline: that made a single interface point look like two,
    // one of which nothing could be connected to.
    const count = Math.max(1, getPortBoundaryPlacement(port, view).width || 1, 0);
    if (count < 2) continue;
    if (!wireCounts.get(port.id)) continue;
    const side = getPortBoundaryPlacement(port, view).side;
    const shape = pinShapeOf(logicalPortOf(block, port)?.direction ?? null);
    for (let i = 1; i < count; i += 1) {
      const pos = toFace(getBoundaryWirePosition(view, port, i));
      drawSocket(ctx, pos, side, shape, color, fill, BORDER_WIDTH);
    }
    const group = getBoundaryPortBlockRect(view, port, count);
    const a = toFace({ x: group.x, y: group.y });
    const b = toFace({ x: group.x + group.width, y: group.y + group.height });
    const horizontal = side === 'left' || side === 'right';
    // The outline follows the pins' own footprint on the face: the group's
    // extent along the edge, the pin's length across it.
    const rect = horizontal
      ? { x: a.x - PORT_LENGTH / 2 + (b.x - a.x) / 2, y: Math.min(a.y, b.y), width: PORT_LENGTH, height: Math.abs(b.y - a.y) }
      : { x: Math.min(a.x, b.x), y: a.y - PORT_LENGTH / 2 + (b.y - a.y) / 2, width: Math.abs(b.x - a.x), height: PORT_LENGTH };
    drawContainerGroupOutline(ctx, { x: rect.x - 2, y: rect.y - 2, width: rect.width + 4, height: rect.height + 4 }, palette);
  }
  ctx.restore();
}

// A container's pins as seen from inside its own level, drawn on the
// frame — the same glyphs drawBoundary draws, without the frame or its
// label. A pin that carries several wires from inside shows one sub-slot
// per wire (see getBoundaryWirePosition): the plug outside is one
// connector, the level inside sees its individual pins.
export function drawBoundaryPins(ctx, block, geometry, ports, { portHighlights = null, palette = DEFAULT_PALETTE, boundaryWireLabels = null, wireMoveOverride = null, zoom = 1, hoverPin = null, portNames = true } = {}) {
  drawPorts(ctx, asBoundaryView(block, geometry, ports), { inverted: true, portHighlights, palette, boundaryWireLabels, wireMoveOverride, zoom, hoverPin, portNames });
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
  {
    selected = false,
    portHighlights = null,
    palette = DEFAULT_PALETTE,
    boundaryWireLabels = null,
    wireMoveOverride = null,
    zoom = 1,
    hoverPin = null,
  } = {},
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
  drawPorts(ctx, asBoundaryView(block, geometry), { inverted: true, portHighlights, palette, boundaryWireLabels, wireMoveOverride, zoom, hoverPin });
  // Gated on `selected` exactly like an ordinary block: clicking the
  // dashed line itself now selects the boundary (see HitTest's
  // 'boundaryLine' hit and DragStateMachine's handling of it), so there's
  // a real selected state to hang this on instead of showing handles
  // unconditionally.
  if (selected) drawResizeHandles(ctx, geometry, palette, zoom);
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
