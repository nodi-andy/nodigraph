import {
  getAllPortPositions,
  getPortPosition,
  getBoundaryWirePosition,
  getBoundaryWireSlotOffset,
  getOccupiedWireIndices,
  getPortBoundaryPlacement,
  getConnectorHandlePosition,
  getResizeHandleRects,
  getBoundaryLabelRect,
  getPortSlotRect,
  getPortResizeHandleRects,
  getSlotRectFromBorderPoint,
  getBoundaryPortBlockRect,
  borderPointForOffset,
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
// A boundary port's own resize handles sit right next to each other (see
// BlockRenderer.getPortResizeHandleRects — a single-wire port is as
// narrow as this gets) — the generic HANDLE_HIT_PADDING above is wide
// enough that the two handles' padded zones would meet in the middle
// with no gap left at all, making the port's own body unclickable. This
// smaller pad still comfortably rounds up the small handle target
// without swallowing the body between them.
const PORT_RESIZE_HIT_PADDING = 4;
// How close a click has to land to the boundary's own dashed line to
// select it — a plain pixel-perfect hit on a 1.5px line would be
// unusably fussy.
const BORDER_HIT_THRESHOLD = 8;

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

function hitResizeHandle(geometry, worldX, worldY, zoom = 1) {
  // The padding, like the rects themselves (see getResizeHandleRects),
  // needs to shrink in world units as zoom grows so it reads as the same
  // constant few screen pixels of extra grab room at any zoom level.
  const padding = RESIZE_HANDLE_HIT_PADDING / zoom;
  for (const rect of Object.values(getResizeHandleRects(geometry, zoom))) {
    if (pointInRect(worldX, worldY, rect, padding)) return rect.side;
  }
  return null;
}

// A precise click on the boundary frame's own dashed line (not a floating
// handle, not the title, just the outline) selects it, the same way
// clicking a block's body selects that block — the boundary's handles
// only show once it's selected (see BlockRenderer.drawBoundary), so
// there has to be a way to select it at all.
function hitBoundaryLine(geometry, worldX, worldY, threshold = BORDER_HIT_THRESHOLD) {
  const { x, y, width, height } = geometry;
  const withinX = worldX >= x - threshold && worldX <= x + width + threshold;
  const withinY = worldY >= y - threshold && worldY <= y + height + threshold;
  if (!withinX || !withinY) return false;
  const nearVerticalEdge = Math.abs(worldX - x) <= threshold || Math.abs(worldX - (x + width)) <= threshold;
  const nearHorizontalEdge = Math.abs(worldY - y) <= threshold || Math.abs(worldY - (y + height)) <= threshold;
  return nearVerticalEdge || nearHorizontalEdge;
}

// An existing, already-drawn port is always directly clickable — no need
// to select its parent block first (a port sits ahead of the block's own
// body in priority, see hitTest). Only a *not-yet-existing* port (the
// "add a port here" edge-zone ghost, see DragStateMachine.resolveGhostZone)
// requires the block to already be selected, and that's gated separately,
// well before this ever runs.
// `wireIdsFor(portId)` (boundary calls only) returns the ids of every wire
// a port currently holds from inside, in Project.listBoundaryWires' own
// order — each one gets its own individually hit-tested slot square (see
// BlockRenderer.drawPorts), so both its connector handle and its body rect
// need to match what's actually drawn at that specific index, or a wide,
// multi-wire port would only be clickable/grabbable at its first wire.
function hitPortsAcrossBlocks(blocks, worldX, worldY, inverted = false, wireIdsFor = () => []) {
  // Connector handles first — they're the outermost/smallest target, and
  // sit close enough to their port that ambiguity should favor "start a wire"
  // when the cursor is right at the tip.
  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    for (const port of block.ports || []) {
      if (inverted) {
        // Every wire the port already holds gets its own grabbable handle
        // — grabbing one picks *that* wire up to redirect it (see
        // DragStateMachine's 'connector' handling). A reserved-but-empty
        // slot past the real wires has no handle of its own here — that
        // spare capacity is reached through the port's own "add a wire"
        // ghost instead (see the portWireGhost check in hitTest below),
        // not by grabbing a phantom connector at some point along it.
        const side = getPortBoundaryPlacement(port).side;
        const wireIds = wireIdsFor(port.id);
        const count = Math.max(1, wireIds.length);
        for (let wireIndex = 0; wireIndex < count; wireIndex += 1) {
          // Resolved against this specific wire's own pinned slot (see
          // getBoundaryWireRelativeIndex) — a wire moved into a slot other
          // than its plain rank (see DragStateMachine's MOVING_PORT_WIRE)
          // would otherwise be hit-tested at a position it's no longer
          // actually drawn at.
          const pos = getBoundaryWirePosition(block, port, wireIndex, wireIds[wireIndex]);
          const handle = getConnectorHandlePosition(pos, side, true);
          if (pointInCircle(worldX, worldY, handle.x, handle.y, CONNECTOR_HANDLE_RADIUS + HANDLE_HIT_PADDING)) {
            return { type: 'connector', blockId: block.id, portId: port.id, connectionId: wireIds[wireIndex] || null };
          }
        }
      } else {
        const pos = getPortPosition(block, port);
        const handle = getConnectorHandlePosition(pos, port.side, false);
        if (pointInCircle(worldX, worldY, handle.x, handle.y, CONNECTOR_HANDLE_RADIUS + HANDLE_HIT_PADDING)) {
          return { type: 'connector', blockId: block.id, portId: port.id, connectionId: null };
        }
      }
    }
  }

  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    if (inverted) {
      // Each real wire gets its own small slot square now (see
      // BlockRenderer.drawPorts) — the same rect an ordinary block's port
      // is drawn and hit-tested as (getSlotRectFromBorderPoint), not one
      // combined block spanning every wire. Grabbing a specific one is
      // what lets DragStateMachine reposition just that wire among the
      // port's own free slots, rather than always dragging the whole
      // port — a reserved-but-empty slot has nothing drawn here at all
      // (see the portWireGhost check above for reaching it instead).
      for (const port of block.ports || []) {
        const side = getPortBoundaryPlacement(port).side;
        const wireIds = wireIdsFor(port.id);
        // A totally unwired port still draws (and must hit-test) its one
        // default slot at index 0 — same Math.max(1, ...) drawPorts itself
        // uses for `count` — or a fresh, wireless port would have no body
        // to grab at all.
        const count = Math.max(1, wireIds.length);
        let hitWire = null;
        for (let wireIndex = 0; wireIndex < count; wireIndex += 1) {
          const pos = getBoundaryWirePosition(block, port, wireIndex, wireIds[wireIndex]);
          const rect = getSlotRectFromBorderPoint(pos.x, pos.y, side);
          if (pointInRect(worldX, worldY, rect, HANDLE_HIT_PADDING)) {
            hitWire = { type: 'port', blockId: block.id, portId: port.id, wireIndex, connectionId: wireIds[wireIndex] ?? null };
            break;
          }
        }
        if (hitWire) return hitWire;
        // Missed every individual wire, but a container (more than one
        // real wire, or reserved past just one) still reads as one group —
        // a click anywhere else within that group's own outline (see
        // BlockRenderer.drawContainerGroupOutline) grabs the WHOLE port to
        // relocate it, `wireIndex` left undefined so DragStateMachine's
        // 'port' handling falls to its plain whole-port move rather than
        // MOVING_PORT_WIRE (which requires a specific wire).
        const width = getPortBoundaryPlacement(port).width || 1;
        const rectCount = Math.max(1, wireIds.length, width);
        if (rectCount > 1) {
          const groupRect = getBoundaryPortBlockRect(block, port, rectCount);
          if (pointInRect(worldX, worldY, groupRect, HANDLE_HIT_PADDING)) {
            return { type: 'port', blockId: block.id, portId: port.id };
          }
        }
      }
    } else {
      for (const { port } of getAllPortPositions(block)) {
        // A port is drawn as a rect, not a dot on the border — hit-test
        // the actual rect drawn, not just a small circle at its outer
        // edge, or most of the visible shape wouldn't be clickable.
        const rect = getPortSlotRect(block, port);
        if (pointInRect(worldX, worldY, rect, HANDLE_HIT_PADDING)) {
          return { type: 'port', blockId: block.id, portId: port.id };
        }
      }
    }
  }

  return null;
}

/**
 * Tests smallest/highest-priority targets first: port connector/move
 * handles across every block (including the surrounding boundary frame's
 * own ports) win over everything, then the boundary's own title, then a
 * resize handle for `resizableBlockId` — whichever single block or the
 * boundary frame is currently selected (see
 * DragStateMachine.getResizableBlockId; both need to already be selected
 * to show a handle at all) — then block body, then the boundary's own
 * dashed line dead last, which selects it the way a block's body selects
 * that block. `boundary`, when the current level has one, is `{ block,
 * geometry }` for the container you're inside. An existing port is always
 * directly hit-testable, current-block boundary included — no need to
 * select its parent block first. Returns null if nothing was hit (caller
 * should try a wire trunk, then fall back to pan/marquee).
 */
export function hitTest(project, worldX, worldY, boundary, resizableBlockId, resizablePortId, zoom = 1) {
  const blocks = project.listBlocks();

  // Ports outrank a resize handle exactly like they outranked the old
  // border-drag zone: a port is the more specific target, so on the rare
  // occasion a handle and a port's connector reach do overlap, the port
  // still wins.
  const portHit = hitPortsAcrossBlocks(blocks, worldX, worldY, false);
  if (portHit) return portHit;

  if (boundary) {
    // Cloned exterior siblings (see BlockDescription.clonePort) collapse
    // onto one entry here — same reasoning as SceneRenderer's own use of
    // listBoundaryPorts — so only the single logical pin they represent is
    // ever actually hit-testable from inside.
    const boundaryView = { ...boundary.block, geometry: boundary.geometry, ports: project.listBoundaryPorts(boundary.block) };
    const wireIdsFor = (portId) => project.listBoundaryWires(boundary.block.id, portId);

    // A boundary port's own resize handles (its "resize its width" grips)
    // outrank the port's own body the same way a block's resize handles
    // outrank its body below — only the currently-selected port shows
    // them at all (see DragStateMachine.getResizablePortId).
    if (resizablePortId) {
      const port = boundary.block.ports.find((p) => p.id === resizablePortId);
      const wireCount = port ? wireIdsFor(port.id).length : 0;
      const effectiveWidth = port ? Math.max(getPortBoundaryPlacement(port).width || 1, wireCount, 1) : 1;
      // A still-plain (not yet a container) port has no resize handles at
      // all — same gate as whether they're even drawn (see
      // BlockRenderer.drawPorts) — the only way to grow one from here is
      // dragging its own wire sideways (DragStateMachine's
      // resolveConnectorDragPending), not a handle that doesn't exist yet.
      if (port && effectiveWidth > 1) {
        const count = Math.max(1, wireCount);
        // `boundaryView`, not the bare `boundary.block` — its own outer
        // geometry (how big/where it sits one level up) routinely differs
        // from its boundaryGeometry (this container's own, independently
        // resizable internal view, see DragStateMachine.resizeEdge's
        // isBoundary case), most obviously once either one's been resized
        // on its own. Every slot/rect position drawn in here (see
        // drawBoundary's own `{ ...block, geometry }` substitution) is
        // already resolved against boundaryGeometry — computing the hit
        // area from the unsubstituted block instead silently used the
        // wrong rectangle's width/height for `sideLength`, landing the
        // handles' hit area away from where they're actually drawn
        // whenever the two geometries disagree (which side felt it
        // depended on which axis diverged more — hence "vertical ports,
        // or nested" both being where it was noticed).
        for (const [edge, rect] of Object.entries(getPortResizeHandleRects(boundaryView, port, count))) {
          if (pointInRect(worldX, worldY, rect, PORT_RESIZE_HIT_PADDING)) {
            return { type: 'portResizeHandle', blockId: boundary.block.id, portId: port.id, edge };
          }
        }

        // The selected port's own reserved-but-unfilled capacity (see
        // getPortBoundaryPlacement's width) doubles as a plain "add a wire
        // here" target — the next unused slot past its real wires, same
        // spot the drawn ghost (DragStateMachine.updateHoverGhost) sits
        // over. Only reachable once the port is already selected, same
        // gate as its resize handles just above — otherwise this would
        // fight with "grab the body to move the port" over the exact same
        // pixels for anyone who hasn't selected it yet. Gated on at least
        // one *real* wire already existing, too: a totally unwired port
        // (however wide) has no "past its real wires" slot distinct from
        // its own single body/connector — that's still just the ordinary
        // "drag the tiny connector dot to wire it up" starting point (see
        // hitPortsAcrossBlocks' own connector loop above), not this ghost.
        const width = getPortBoundaryPlacement(port).width || 1;
        if (wireCount >= 1 && wireCount < width) {
          // The first genuinely free relative index within the reserved
          // span, not just `wireCount` — a wire individually moved out of
          // dense order (see DragStateMachine's MOVING_PORT_WIRE) can
          // leave a gap *before* the nominal "next" slot, and this should
          // offer that gap rather than skip past it.
          const occupied = new Set(getOccupiedWireIndices(port, wireIdsFor(port.id)));
          let freeIndex = -1;
          for (let idx = 0; idx < width; idx += 1) {
            if (!occupied.has(idx)) { freeIndex = idx; break; }
          }
          const side = getPortBoundaryPlacement(port).side;
          const slotOffset = freeIndex >= 0 ? getBoundaryWireSlotOffset(boundaryView, port, freeIndex) : null;
          const ghostPoint = slotOffset !== null ? borderPointForOffset(boundary.geometry, side, slotOffset) : null;
          const ghostRect = ghostPoint ? getSlotRectFromBorderPoint(ghostPoint.x, ghostPoint.y, side) : null;
          if (ghostRect && pointInRect(worldX, worldY, ghostRect)) {
            return { type: 'portWireGhost', blockId: boundary.block.id, portId: port.id, side, offset: slotOffset, relativeIndex: freeIndex };
          }
        }
      }
    }

    // Same as any other existing port: directly selectable without
    // selecting its block (the boundary itself) first.
    const boundaryPortHit = hitPortsAcrossBlocks([boundaryView], worldX, worldY, true, wireIdsFor);
    if (boundaryPortHit) return boundaryPortHit;

    // The frame's title, sitting just above its top-left corner — a click
    // there renames the block you're inside. Checked before the blocks
    // below since it's outside the frame and can overlap one of them.
    const labelRect = getBoundaryLabelRect(boundary.block, boundary.geometry);
    if (pointInRect(worldX, worldY, labelRect, 2)) {
      return { type: 'boundaryLabel', blockId: boundary.block.id };
    }
  }

  // Whichever single thing is currently selected — an ordinary block or
  // the boundary frame — is the only one allowed to show a resize handle
  // (see DragStateMachine.getResizableBlockId). The boundary's own
  // geometry for this is its boundaryGeometry (the frame drawn around its
  // children), not the plain `.geometry` project.getBlock resolves it
  // to — that's where it sits as a block one level up, a different
  // rectangle entirely. Checked before any block's body so a handle
  // floating just past this target's own border isn't swallowed by "drag
  // to move" if it happens to sit over another block.
  if (resizableBlockId) {
    const isBoundaryTarget = Boolean(boundary) && resizableBlockId === boundary.block.id;
    const geometry = isBoundaryTarget ? boundary.geometry : project.getBlock(resizableBlockId)?.geometry;
    if (geometry) {
      const side = hitResizeHandle(geometry, worldX, worldY, zoom);
      if (side) return { type: 'resizeHandle', blockId: resizableBlockId, side, isBoundary: isBoundaryTarget };
    }
  }

  for (let i = blocks.length - 1; i >= 0; i -= 1) {
    const block = blocks[i];
    if (pointInRect(worldX, worldY, block.geometry)) {
      return { type: 'body', blockId: block.id };
    }
  }

  if (boundary && hitBoundaryLine(boundary.geometry, worldX, worldY)) {
    return { type: 'boundaryLine', blockId: boundary.block.id };
  }

  return null;
}
