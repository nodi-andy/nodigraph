// One geometry for a block and its own interior.
//
// A container block has two rectangles: its face (block.geometry, where
// it sits in its parent's level) and its frame (block.boundaryGeometry,
// the dashed rectangle its children are drawn inside). Before this
// module the two were unrelated: a boundary pin's interior placement was
// either a mirror of its exterior offset in raw pixels (which piles every
// pin into one corner as soon as the frame is bigger than the face) or a
// separately stored position dragged from inside. Zooming into a block
// could therefore never be continuous — the pins visibly jumped between
// the face and the opened level.
//
// The rule now: the frame is a scaled picture of the face. `frameToFace`
// is the single transform both directions use — the nested rendering
// draws a child level onto its block's face through it, the boundary
// pins sit where the exterior pins land through its inverse, and the
// endless zoom re-bases the camera through it when the view crosses into
// or out of a level. Pure geometry: no DOM, no canvas, so the slim YAML
// import and any headless renderer can run it in Node.
import { GRID_SIZE, DEFAULT_FRAME_FACTOR, getPortOffsetBounds, nearestPortSlot, sideAxis, clamp } from './grid.js';

export { DEFAULT_FRAME_FACTOR };

// How much bigger than its face a block's frame is by default. Odd on
// purpose: connector slots sit at grid-cell centres (20, 60, 100, ...),
// and an exterior slot maps onto an interior slot exactly only when the
// scale is an odd integer — 3 × (20 + 40i) = 20 + 40(3i + 1). A frame
// left at this default therefore gives pixel-exact pin alignment; a frame
// resized to another ratio still works, its pins just snap to the nearest
// interior slot. The constant itself lives in grid.js next to the slot
// spacing it is tied to.

// The frame a block gets the first time it is entered: its own face,
// scaled by DEFAULT_FRAME_FACTOR, at the level's origin. Without a face
// (an old save with no geometry) the historical 10 × 6 cells.
export function defaultBoundaryFor(geometry) {
  if (!geometry) return { x: 0, y: 0, width: GRID_SIZE * 10, height: GRID_SIZE * 6 };
  return { x: 0, y: 0, width: geometry.width * DEFAULT_FRAME_FACTOR, height: geometry.height * DEFAULT_FRAME_FACTOR };
}

export function sideLengthOf(geometry, side) {
  return sideAxis(side) === 'x' ? geometry.height : geometry.width;
}

// Maps a point in the frame's own level coordinates onto the face:
// facePoint = framePoint * scale + offset. Uniform scale so nothing is
// distorted; when the two aspect ratios differ the frame is centred in
// the face and the slack sits on the long axis.
export function frameToFace(face, frame) {
  const scale = Math.min(face.width / frame.width, face.height / frame.height);
  return {
    scale,
    offsetX: face.x + (face.width - frame.width * scale) / 2 - frame.x * scale,
    offsetY: face.y + (face.height - frame.height * scale) / 2 - frame.y * scale,
  };
}

// The exterior pin's position along its side (offset from that side's
// start corner, on the face) expressed as an offset along the same side
// of the frame. Unsnapped; callers snap to a slot.
export function faceOffsetToFrame(side, faceOffset, face, frame) {
  const t = frameToFace(face, frame);
  if (sideAxis(side) === 'y') return (face.x + faceOffset - t.offsetX) / t.scale - frame.x;
  return (face.y + faceOffset - t.offsetY) / t.scale - frame.y;
}

// The inverse: an offset along a side of the frame, as the offset along
// the same side of the face. Unsnapped.
export function frameOffsetToFace(side, frameOffset, face, frame) {
  const t = frameToFace(face, frame);
  if (sideAxis(side) === 'y') return (frame.x + frameOffset) * t.scale + t.offsetX - face.x;
  return (frame.y + frameOffset) * t.scale + t.offsetY - face.y;
}

// Where a pin sits on the frame, derived from where it sits on the face —
// same side, the exact proportional position, so the pin inside lands
// under the plug outside at any zoom. Not snapped to the frame's slot
// grid: a snapped pin could be off by up to half a cell from the plug
// the level above draws, and the two are the same connector. `width`/
// `wireSlots` are the only facts a pin still stores about its interior
// (see BlockRenderer.getBoundaryWirePosition); its interior side and
// offset are no longer data, they are this function.
export function boundaryPlacementFor(port, face, frame) {
  const width = port.boundary?.width || 1;
  const wireSlots = port.boundary?.wireSlots;
  if (!face || !frame) return { side: port.side, offset: port.offset, width, wireSlots };
  const faceLength = sideLengthOf(face, port.side);
  const bounds = getPortOffsetBounds(faceLength);
  const faceOffset = nearestPortSlot(faceLength, clamp(port.offset ?? bounds.min, bounds.min, bounds.max));
  const frameLength = sideLengthOf(frame, port.side);
  const raw = faceOffsetToFrame(port.side, faceOffset, face, frame);
  return { side: port.side, offset: clamp(raw, 0, frameLength), width, wireSlots };
}

// The frame grown to the face's aspect ratio, centred on the stored one.
// frameToFace scales uniformly and centres, so a frame with a different
// aspect ratio than its face leaves slack along one axis: its edge sits
// inside the face there, and every pin on that edge — with the wires
// reaching it — floats short of the block's own border. Growing the frame
// (never shrinking it, so nothing placed inside is lost) puts its edges
// exactly on the face's. Called wherever a frame or a face changes size
// (see Block.normalizeBoundary).
export function normalizeFrame(face, frame) {
  if (!face || !frame || face.width <= 0 || face.height <= 0 || frame.width <= 0 || frame.height <= 0) return frame;
  const aspect = face.width / face.height;
  const wantHeight = frame.width / aspect;
  if (Math.abs(wantHeight - frame.height) < 0.5) return frame;
  if (wantHeight > frame.height) {
    return { x: frame.x, y: frame.y - (wantHeight - frame.height) / 2, width: frame.width, height: wantHeight };
  }
  const wantWidth = frame.height * aspect;
  return { x: frame.x - (wantWidth - frame.width) / 2, y: frame.y, width: wantWidth, height: frame.height };
}

// The exterior pin placement that puts a pin at `frameOffset` on `side`
// of the frame — what an edit made from inside (dragging or adding a pin
// on the dashed frame) writes back to the pin. `occupied` lists the
// exterior slots already taken on that side so two pins never share one.
export function exteriorPlacementFor(side, frameOffset, face, frame, occupied = []) {
  const faceLength = sideLengthOf(face, side);
  const raw = frameOffsetToFace(side, frameOffset, face, frame);
  return { side, offset: nearestPortSlot(faceLength, raw, occupied) };
}
