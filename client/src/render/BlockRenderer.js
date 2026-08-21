import {
  clamp,
  snap,
  sideNormal,
  sideAxis,
  getPortOffsetBounds,
  getPortSlotOffsets,
  nearestPortSlot,
  SIDES,
} from '../model/grid.js';
import { getStateColor } from '../model/BlockDescription.js';
import { DEFAULT_BLOCK_COLOR } from '../model/Block.js';
import { isImageUrl, getCachedImage } from './imageCache.js';

const CORNER_RADIUS = 6;
export const PORT_RADIUS = 5;
// The drawn arrowhead is smaller than this — it's the hit-test radius
// around the handle's tip, padded like every other small handle.
export const CONNECTOR_HANDLE_RADIUS = 4;
export const CONNECTOR_NUB_LENGTH = 14;
const CONNECTOR_ARROW_SIZE = 8;
// An ordinary block's ports render as sockets inset into its own face
// (see drawEmptySlots/getSlotRectFromBorderPoint) rather than dots
// straddling the border line — the boundary frame (drawBoundary) keeps the
// older dot style since it's a dashed abstract container, not a solid face
// with room to inset into.
export const PORT_SLOT_SIZE = 16;
const EMPTY_SLOT_FILL = 'rgba(255, 255, 255, 0.04)';
const EMPTY_SLOT_STROKE = 'rgba(255, 255, 255, 0.14)';
const INPUT_PORT_COLOR = '#8b93a3';
const DEFAULT_OUTPUT_PORT_COLOR = '#8b93a3';
const CONNECTOR_HANDLE_COLOR = '#e6e9ef';
const PORT_LABEL_COLOR = '#c3c9d4';
const PORT_LABEL_GAP = 6;
const PORT_RING_RADIUS = PORT_RADIUS + 4;
const SLOT_RING_RADIUS = PORT_SLOT_SIZE / 2 + 4;
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

// Where a wire actually attaches — the connector handle out past the dot,
// not the dot itself. The dot is purely a drag-to-reposition handle; a wire
// that visually ran through it (rather than the handle it was dragged from)
// read as attached to the wrong thing.
export function findConnectorPosition(block, portId, inverted = false) {
  const port = (block.ports || []).find((p) => p.id === portId);
  if (!port) return null;
  return getConnectorHandlePosition(getPortPosition(block, port), port.side, inverted);
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

// The four resize handles a selected block (or the selected boundary
// frame) shows — one per edge, floating outside the block rather than
// sitting on the border the way the old drag-to-resize zone did, so
// they're a target of their own rather than sharing pixels with a port's
// connector nub. The outset is kept modest (half of an earlier, more
// cautious value) so the handles read as attached to the block rather
// than floating off on their own; a handle landing near a port's own nub
// on the odd block whose ports happen to sit at an edge's midpoint is a
// rarer case than the handles looking disconnected on every other block.
export const RESIZE_HANDLE_SIZE = 12;
export const RESIZE_HANDLE_OUTSET = 20;

export function getResizeHandleRects(geometry) {
  const { x, y, width, height } = geometry;
  const half = RESIZE_HANDLE_SIZE / 2;
  const cx = x + width / 2;
  const cy = y + height / 2;
  const square = (side, cx2, cy2) => ({ side, x: cx2 - half, y: cy2 - half, width: RESIZE_HANDLE_SIZE, height: RESIZE_HANDLE_SIZE });
  return {
    top: square('top', cx, y - RESIZE_HANDLE_OUTSET),
    bottom: square('bottom', cx, y + height + RESIZE_HANDLE_OUTSET),
    left: square('left', x - RESIZE_HANDLE_OUTSET, cy),
    right: square('right', x + width + RESIZE_HANDLE_OUTSET, cy),
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
const RESIZE_GRIP_THICKNESS = 8;
// Selection used to also draw its own outline ring around the block (see
// drawBlock) — with these handles now the only thing that shows up on
// selecting something, that redundant ring is gone, and these lean a
// little translucent so they read as an overlaid control rather than
// another opaque shape competing with the block/boundary underneath.
const RESIZE_HANDLE_ALPHA = 0.75;

export function drawResizeHandles(ctx, geometry) {
  const rects = getResizeHandleRects(geometry);
  ctx.save();
  ctx.globalAlpha = RESIZE_HANDLE_ALPHA;
  for (const rect of Object.values(rects)) {
    const cx = rect.x + rect.width / 2;
    const cy = rect.y + rect.height / 2;
    const horizontalEdge = rect.side === 'top' || rect.side === 'bottom';
    const w = horizontalEdge ? RESIZE_GRIP_LENGTH : RESIZE_GRIP_THICKNESS;
    const h = horizontalEdge ? RESIZE_GRIP_THICKNESS : RESIZE_GRIP_LENGTH;
    roundRectPath(ctx, cx - w / 2, cy - h / 2, w, h, RESIZE_GRIP_THICKNESS / 2);
    ctx.fillStyle = '#10151c';
    ctx.fill();
    ctx.strokeStyle = SELECTION_COLOR;
    ctx.lineWidth = 1.5;
    ctx.stroke();
  }
  ctx.restore();
}

// Detects the cursor sitting *inside* the block, just past the border's own
// no deeper than a slot square's own depth — this is "inside the box, no
// deeper than a socket reaches" — hovering there is what reveals an
// add-port ghost (see DragStateMachine's hover-ghost handling). Matches
// the ghost square's own drawn footprint exactly (see
// getSlotRectFromBorderPoint, same PORT_SLOT_SIZE depth from the same
// border point) — it used to stop 8 units short of the border, a leftover
// from when this zone also had to leave room for the old border-drag-
// resize gesture. That gesture is gone (resize is floating handles now,
// nowhere near here), so the exclusion just meant the near half of the
// visible ghost square didn't respond to the hover or the click that was
// supposed to confirm it.
export function getEdgeZoneOffset(geometry, ports, worldX, worldY) {
  const { x, y, width, height } = geometry;
  if (worldX < x || worldX > x + width || worldY < y || worldY > y + height) return null;

  const candidates = [
    { side: 'left', dist: worldX - x, offset: worldY - y },
    { side: 'right', dist: x + width - worldX, offset: worldY - y },
    { side: 'top', dist: worldY - y, offset: worldX - x },
    { side: 'bottom', dist: y + height - worldY, offset: worldX - x },
  ];
  candidates.sort((a, b) => a.dist - b.dist);
  const best = candidates[0];
  if (best.dist > PORT_SLOT_SIZE) return null;

  const length = sideAxis(best.side) === 'x' ? height : width;
  // The cursor's own nearest slot on this side — not redirected toward
  // whatever's free. If that slot's already taken, the cursor is over an
  // *existing* port, not empty edge, so no ghost belongs here: it used to
  // snap sideways onto the nearest free slot instead, which drew the
  // add-port affordance right on top of (or beside) the real port it was
  // supposedly offering to avoid.
  const slot = nearestPortSlot(length, best.offset);
  const occupied = (ports || []).some((p) => p.side === best.side && nearestPortSlot(length, p.offset) === slot);
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

function drawPortLabel(ctx, port, pos, inverted = false) {
  if (!port.name) return;
  ctx.fillStyle = PORT_LABEL_COLOR;
  ctx.font = '10px -apple-system, Segoe UI, Roboto, sans-serif';

  const n = sideNormal(port.side);
  const sign = inverted ? 1 : -1;
  const dirX = n.x * sign;
  const dirY = n.y * sign;
  // Clears the dot (boundary) or the bigger inset slot square (ordinary
  // block) before the label text starts.
  const gap = (inverted ? PORT_RADIUS : PORT_SLOT_SIZE) + PORT_LABEL_GAP;

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
function drawConnectorArrow(ctx, handlePos, side, inverted, isOutput) {
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
  ctx.fillStyle = CONNECTOR_HANDLE_COLOR;
  ctx.fill();
}

// A direction-less port still needs *something* marking where to grab it to
// start a wire — the arrowhead was doing double duty as both "which way
// data flows" and "here's the handle," so dropping it outright for an
// undecided port left the handle with no visible marker at all. This is
// the same handle with no directional claim: a plain dot, same place, same
// color, just no triangle pointing anywhere.
function drawConnectorHandleDot(ctx, handlePos) {
  ctx.beginPath();
  ctx.arc(handlePos.x, handlePos.y, CONNECTOR_ARROW_SIZE / 2, 0, Math.PI * 2);
  ctx.fillStyle = CONNECTOR_HANDLE_COLOR;
  ctx.fill();
}

function drawPortRing(ctx, x, y, color, radius = PORT_RING_RADIUS) {
  ctx.beginPath();
  ctx.arc(x, y, radius, 0, Math.PI * 2);
  ctx.strokeStyle = color;
  ctx.lineWidth = 2;
  ctx.stroke();
}

// A slot's rect, inset from the border point into the block's own face —
// flush with the border on the outward-facing edge, extending inward by
// PORT_SLOT_SIZE, so it reads as a socket built into the block rather than
// a shape straddling the outline. Exported so HitTest can hit-test the
// exact area actually drawn, not an approximation of it.
export function getSlotRectFromBorderPoint(px, py, side) {
  const half = PORT_SLOT_SIZE / 2;
  const base = (() => {
    switch (side) {
      case 'left':
        return { x: px, y: py - half };
      case 'right':
        return { x: px - PORT_SLOT_SIZE, y: py - half };
      case 'top':
        return { x: px - half, y: py };
      case 'bottom':
      default:
        return { x: px - half, y: py - PORT_SLOT_SIZE };
    }
  })();
  return { ...base, width: PORT_SLOT_SIZE, height: PORT_SLOT_SIZE };
}

// The exact rect an ordinary (non-inverted) block's port slot is drawn at.
export function getPortSlotRect(block, port) {
  const { x, y } = getPortPosition(block, port);
  return getSlotRectFromBorderPoint(x, y, port.side);
}

function drawSlotSquare(ctx, rect, fill, stroke) {
  ctx.beginPath();
  ctx.rect(rect.x, rect.y, PORT_SLOT_SIZE, PORT_SLOT_SIZE);
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
export function drawPortGhost(ctx, geometry, side, offset) {
  const { x: px, y: py } = borderPointForOffset(geometry, side, offset);
  const rect = getSlotRectFromBorderPoint(px, py, side);
  drawSlotSquare(ctx, rect, GHOST_SLOT_FILL, GHOST_SLOT_STROKE);

  ctx.strokeStyle = '#e6e9ef';
  ctx.lineWidth = 1.5;
  const cx = rect.x + PORT_SLOT_SIZE / 2;
  const cy = rect.y + PORT_SLOT_SIZE / 2;
  const arm = 4;
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
function drawEmptySlots(ctx, block, inverted = false) {
  const { width, height } = block.geometry;
  for (const side of SIDES) {
    const sideLength = sideAxis(side) === 'x' ? height : width;
    const occupied = (block.ports || [])
      .filter((p) => p.side === side)
      .map((p) => nearestPortSlot(sideLength, p.offset));
    for (const offset of getPortSlotOffsets(sideLength)) {
      if (occupied.includes(offset)) continue;
      const { x: px, y: py } = borderPointForOffset(block.geometry, side, offset);
      if (inverted) {
        // The boundary's real ports are plain dots, not inset squares (see
        // the note on drawPorts) — its empty slots match that so a
        // selected frame reads the same way a selected block does, not
        // like it borrowed the wrong shape.
        ctx.beginPath();
        ctx.arc(px, py, PORT_RADIUS, 0, Math.PI * 2);
        ctx.fillStyle = EMPTY_SLOT_FILL;
        ctx.fill();
        ctx.strokeStyle = EMPTY_SLOT_STROKE;
        ctx.lineWidth = 1;
        ctx.stroke();
      } else {
        drawSlotSquare(ctx, getSlotRectFromBorderPoint(px, py, side), EMPTY_SLOT_FILL, EMPTY_SLOT_STROKE);
      }
    }
  }
}

// `inverted` is set when drawing a container's ports on its boundary frame:
// a port that's an input from outside acts as a source from inside (data
// is available to route to children), and an output acts as a sink (a
// child's result flows into it, then out) — so which color/role a port
// gets flips, on top of the nub/arrow direction flipping. `portHighlights`
// (optional) is a `Map` of `"blockId:portId" -> ringColor` covering
// selection and in-progress-wire feedback, shared across every block/
// boundary drawn this frame.
function drawPorts(ctx, block, { inverted = false, portHighlights = null, showEmptySlots = false } = {}) {
  const outputColor = getStateColor(block) || DEFAULT_OUTPUT_PORT_COLOR;

  // Shown while selected (about to add or drag a port there) — showing
  // them all the time, on every block, cluttered ones you weren't
  // touching. The boundary frame gets the same treatment once it can be
  // selected too (see HitTest's 'boundaryLine' hit); drawEmptySlots just
  // draws its dot style instead of a square one when inverted.
  if (showEmptySlots) drawEmptySlots(ctx, block, inverted);

  for (const { port, x: px, y: py } of getAllPortPositions(block)) {
    // A port with no direction yet isn't "effectively an input" — it's
    // neither, so it gets the neutral (input-colored) nub with no arrowhead
    // at all rather than a color/arrow that would falsely claim a role.
    const isEffectivelyOutput = port.direction === null ? null : inverted ? port.direction === 'in' : port.direction === 'out';
    const color = isEffectivelyOutput ? outputColor : INPUT_PORT_COLOR;
    const handle = getConnectorHandlePosition({ x: px, y: py }, port.side, inverted);

    // Drawn before the dot/slot and arrowhead so both paint over its
    // endpoint — the stub reads as attached to the handle, not the other
    // way around.
    ctx.strokeStyle = '#4a5568';
    ctx.lineWidth = 1.5;
    ctx.beginPath();
    ctx.moveTo(px, py);
    ctx.lineTo(handle.x, handle.y);
    ctx.stroke();

    if (inverted) {
      ctx.beginPath();
      ctx.arc(px, py, PORT_RADIUS, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
      ctx.strokeStyle = '#12161d';
      ctx.lineWidth = 2;
      ctx.stroke();
    } else {
      drawSlotSquare(ctx, getSlotRectFromBorderPoint(px, py, port.side), color, '#12161d');
    }

    if (isEffectivelyOutput !== null) drawConnectorArrow(ctx, handle, port.side, inverted, isEffectivelyOutput);
    else drawConnectorHandleDot(ctx, handle);
    drawPortLabel(ctx, port, { x: px, y: py }, inverted);

    const ringColor = portHighlights?.get(`${block.id}:${port.id}`);
    if (ringColor) drawPortRing(ctx, px, py, ringColor, inverted ? PORT_RING_RADIUS : SLOT_RING_RADIUS);
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

// A block is a plain titled box with its name centered — no header band.
// Its Input/Output ports are handles on the border, on any of the four
// sides. When you drill into a block, its own border becomes the frame
// that shows those same ports (Milestone 3).
export function drawBlock(ctx, block, { selected = false, portHighlights = null, requestRender = () => {} } = {}) {
  const { x, y, width, height } = block.geometry;
  const accentColor = block.style?.color || DEFAULT_BLOCK_COLOR;

  // Selection used to also draw a second outline ring around the block,
  // and thicken this border a touch on top of that — the four resize
  // handles that appear on selection already say "this is the selected
  // one" on their own, so either was just the same fact told again. The
  // border stays exactly as it looks unselected, in the block's own
  // accent colour, whether or not it's the one picked right now.
  roundRectPath(ctx, x, y, width, height, CORNER_RADIUS);
  ctx.fillStyle = '#1c2431';
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
    ctx.fillStyle = '#ffffff';
    ctx.font = '13px -apple-system, Segoe UI, Roboto, sans-serif';
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillText(block.name, x + width / 2, y + height / 2, width - 16);
  }

  ctx.restore();

  drawPorts(ctx, block, { portHighlights, showEmptySlots: selected });
  if (selected) drawResizeHandles(ctx, block.geometry);
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
export function drawBoundary(ctx, block, geometry, { selected = false, portHighlights = null } = {}) {
  const { x, y, width, height } = geometry;

  // No selected-state recolor here either (see drawBlock's own note) — the
  // resize handles below already say this frame is the selected one.
  ctx.save();
  ctx.setLineDash([8, 6]);
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.25)';
  ctx.lineWidth = 1.5;
  ctx.strokeRect(x, y, width, height);
  ctx.restore();

  ctx.fillStyle = selected ? '#4f8cff' : '#8b93a3';
  ctx.font = BOUNDARY_LABEL_FONT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'bottom';
  ctx.fillText(block.name, x + 4, y - 6);

  drawPorts(ctx, { ...block, geometry }, { inverted: true, portHighlights, showEmptySlots: selected });
  // Gated on `selected` exactly like an ordinary block: clicking the
  // dashed line itself now selects the boundary (see HitTest's
  // 'boundaryLine' hit and DragStateMachine's handling of it), so there's
  // a real selected state to hang this on instead of showing handles
  // unconditionally.
  if (selected) drawResizeHandles(ctx, geometry);
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
