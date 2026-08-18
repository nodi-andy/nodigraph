import { hitTest } from './HitTest.js';
import { touchBlock, MIN_BLOCK_WIDTH, MIN_BLOCK_HEIGHT } from '../model/Block.js';
import { snap, GRID_SIZE, sideAxis, nearestPortSlot } from '../model/grid.js';
import { findConnectorPosition, projectPointToPerimeter, getEdgeZoneOffset } from '../render/BlockRenderer.js';
import { getConnectionGeometry, previewPathToCursor, hitTestConnectionTrunk } from '../render/ConnectionRenderer.js';
import { createConnection } from '../model/Connection.js';
import { addPort } from '../model/BlockDescription.js';

// How long the cursor has to sit in a block's edge zone before the
// "click here to add a port" ghost actually appears — long enough that
// just passing through on the way to somewhere else never flashes one.
const HOVER_GHOST_DELAY_MS = 200;

const STATES = {
  IDLE: 'idle',
  PANNING: 'panning',
  DRAGGING_BLOCK: 'draggingBlock',
  DRAGGING_PORT: 'draggingPort',
  DRAWING_CONNECTION: 'drawingConnection',
  DRAGGING_WIRE_TRUNK: 'draggingWireTrunk',
  // A click on a block's or the boundary's edge is ambiguous until the
  // pointer either releases without moving much (add a port there) or
  // moves past the threshold (become an actual splitter-resize drag) —
  // every edge of both is a resize splitter now, there's no separate
  // corner-handle resize anymore.
  PENDING_EDGE: 'pendingEdge',
  RESIZING_EDGE: 'resizingEdge',
};

// Screen-space so the same finger/mouse movement counts as "a drag" the
// same way regardless of current zoom level. Exported since InspectorPanel
// uses the same threshold to decide whether a press was a tap (open the
// mobile sheet) or a drag (leave it alone).
export const CLICK_DRAG_THRESHOLD = 5;
const BOUNDARY_MIN_SIZE = GRID_SIZE * 3;

function invertDirection(direction) {
  return direction === 'out' ? 'in' : 'out';
}

/**
 * Explicit finite states rather than ad-hoc booleans — this is what makes
 * "drag block body" vs "drag an edge to resize" vs "drag a port" vs "draw
 * a wire" vs "drag a wire's trunk" vs "pan background" unambiguous.
 */
export class DragStateMachine {
  constructor({ camera, project, selection, wireSelection, requestRender, persist, onEnterBlock, onLiveUpdate }) {
    this.camera = camera;
    this.project = project;
    this.selection = selection;
    this.wireSelection = wireSelection;
    this.requestRender = requestRender;
    this.persist = persist;
    this.onEnterBlock = onEnterBlock;
    // Fired on every pointermove while dragging something positional (a
    // block, a port, a wire trunk, a boundary edge) — this is what lets
    // another open client see the move as it happens instead of only once
    // you release and it's actually saved to disk (see main.js/liveSync.js).
    this.onLiveUpdate = onLiveUpdate;
    this.state = STATES.IDLE;
    this.context = null;
    // { blockId, geometry, ports, side, offset, ready } while the cursor is
    // dwelling in a block's edge zone, or null — see updateHoverGhost.
    this.hoverGhost = null;
    this.ghostTimer = null;
  }

  // The block you're currently inside, with whatever boundary geometry the
  // user has it set to right now — just a stored rectangle, not something
  // recomputed from children.
  getBoundaryInfo() {
    const block = this.project.getContainerBlock();
    if (!block || !block.boundaryGeometry) return null;
    return { block, geometry: block.boundaryGeometry };
  }

  onPointerDown(screen, world, modifiers = {}) {
    // Middle-button drag is always "pan the canvas," even over a block, a
    // port, or the boundary — it bypasses hit-testing entirely rather than
    // doing whatever a left-click there would do.
    if (modifiers.button === 1) {
      this.state = STATES.PANNING;
      this.context = { lastScreen: screen };
      return;
    }

    // A ready ghost (shown only after the hover dwell) takes this click
    // directly — re-verified against the exact down position rather than
    // trusted as-is, in case it's gone stale since the last pointermove.
    if (this.hoverGhost?.ready) {
      const ghost = this.hoverGhost;
      const zone = getEdgeZoneOffset(ghost.geometry, ghost.ports, world.x, world.y);
      this.clearHoverGhost();
      if (zone && zone.side === ghost.side && zone.offset === ghost.offset) {
        this.addPortAt(ghost.blockId, zone.side, zone.offset, ghost.geometry);
        return;
      }
    } else {
      this.clearHoverGhost();
    }

    const boundary = this.getBoundaryInfo();
    const hit = hitTest(this.project, world.x, world.y, boundary);
    if (hit) this.wireSelection.clear();

    if (hit?.type === 'connector') {
      const isBoundary = Boolean(boundary) && hit.blockId === boundary.block.id;
      // Selection is left untouched: drawing a wire shouldn't disturb
      // whatever the inspector is currently showing.
      this.state = STATES.DRAWING_CONNECTION;
      this.context = {
        sourceBlockId: hit.blockId,
        sourcePortId: hit.portId,
        sourceInverted: isBoundary,
        currentWorld: world,
      };
      this.requestRender();
      return;
    }

    if (hit?.type === 'port') {
      const isBoundary = Boolean(boundary) && hit.blockId === boundary.block.id;
      const block = this.project.getBlock(hit.blockId);
      this.selection.selectPort(block.id, hit.portId);
      this.state = STATES.DRAGGING_PORT;
      this.context = { blockId: block.id, portId: hit.portId, isBoundary };
      this.requestRender();
      return;
    }

    if (hit?.type === 'border' || hit?.type === 'boundaryEdge') {
      // Ambiguous until release: a tap adds a port right there, a drag
      // resizes that edge (splitter-style — the opposite edge stays put),
      // same as the boundary's own edge already worked.
      const isBoundary = hit.type === 'boundaryEdge';
      const startGeometry = isBoundary ? boundary.geometry : this.project.getBlock(hit.blockId).geometry;
      this.state = STATES.PENDING_EDGE;
      this.context = {
        blockId: hit.blockId,
        edge: hit.side,
        offset: hit.offset,
        startScreen: screen,
        startGeometry: { ...startGeometry },
        isBoundary,
      };
      return;
    }

    if (hit?.type === 'body') {
      const block = this.project.getBlock(hit.blockId);
      this.selection.select(block.id);
      this.state = STATES.DRAGGING_BLOCK;
      this.context = { blockId: block.id, startWorld: world, startGeom: { ...block.geometry } };
      this.requestRender();
      return;
    }

    const wireHit = this.hitTestWires(world.x, world.y, boundary);
    if (wireHit) {
      if (modifiers.shiftKey) {
        // Shift-click only toggles membership — a following drag (grabbing
        // any selected trunk) is what actually moves the group.
        this.wireSelection.toggle(wireHit.connectionId);
        this.requestRender();
        return;
      }
      if (!this.wireSelection.isSelected(wireHit.connectionId)) {
        this.wireSelection.selectOnly(wireHit.connectionId);
      }
      this.state = STATES.DRAGGING_WIRE_TRUNK;
      this.context = { items: this.buildTrunkDragItems(boundary), startWorld: world };
      this.requestRender();
      return;
    }

    this.wireSelection.clear();
    this.selection.clear();
    this.state = STATES.PANNING;
    this.context = { lastScreen: screen };
    this.requestRender();
  }

  hitTestWires(worldX, worldY, boundary) {
    const connections = this.project.listConnections();
    for (let i = connections.length - 1; i >= 0; i -= 1) {
      const connection = connections[i];
      const geometry = getConnectionGeometry(this.project, connection, boundary);
      if (hitTestConnectionTrunk(geometry, worldX, worldY)) {
        return { connectionId: connection.id };
      }
    }
    return null;
  }

  // Captures each selected trunk's current axis + displayed position once,
  // at drag start, so the group can be dragged together even when one of
  // them hasn't been manually bent before (its baseline is the live
  // auto-computed midpoint, not an arbitrary jump).
  buildTrunkDragItems(boundary) {
    return this.wireSelection
      .list()
      .map((connectionId) => {
        const connection = this.project.getConnection(connectionId);
        const geometry = connection && getConnectionGeometry(this.project, connection, boundary);
        if (!connection || !geometry || geometry.trunkIndex < 0) return null;
        const axis = geometry.trunkAxis;
        const point = geometry.points[geometry.trunkIndex];
        return { connectionId, axis, startBend: axis === 'x' ? point.x : point.y };
      })
      .filter(Boolean);
  }

  onPointerMove(screen, world) {
    switch (this.state) {
      case STATES.PANNING: {
        const dx = screen.x - this.context.lastScreen.x;
        const dy = screen.y - this.context.lastScreen.y;
        this.camera.pan(dx, dy);
        this.context.lastScreen = screen;
        this.requestRender();
        break;
      }
      case STATES.DRAGGING_BLOCK: {
        const block = this.project.getBlock(this.context.blockId);
        if (!block) break;
        // Snapping the absolute result (not the delta) is what gives the
        // Factorio/AoE feel of the block jumping between grid cells as you
        // drag, rather than drifting off-grid by accumulated pixel deltas.
        block.geometry.x = snap(this.context.startGeom.x + (world.x - this.context.startWorld.x));
        block.geometry.y = snap(this.context.startGeom.y + (world.y - this.context.startWorld.y));
        this.requestRender();
        this.onLiveUpdate?.({ kind: 'block', blockId: block.id, geometry: block.geometry });
        break;
      }
      case STATES.DRAGGING_PORT: {
        const block = this.project.getBlock(this.context.blockId);
        const port = block?.ports.find((p) => p.id === this.context.portId);
        if (!block || !port) break;
        // Projects onto the nearest point on the block's own border across
        // all four sides (or the boundary frame's border, if this port
        // belongs to the current container) so a port slides all the way
        // around the perimeter and switches sides at the corners, then
        // snaps to that side's nearest free connector slot — ports sit in
        // fixed sockets now, not anywhere along the edge.
        const geometry = this.context.isBoundary ? this.getBoundaryInfo().geometry : block.geometry;
        const projected = projectPointToPerimeter({ geometry }, world.x, world.y);
        const sideLength = sideAxis(projected.side) === 'x' ? geometry.height : geometry.width;
        // Compared as each sibling's *resolved* slot (nearestPortSlot), not
        // its raw stored offset — a port saved before slots existed (or
        // just nudged there by an earlier bug) still correctly reserves
        // whichever slot it now actually renders at, so a new drag can't
        // land exactly on top of it.
        const occupied = block.ports
          .filter((p) => p.id !== port.id && p.side === projected.side)
          .map((p) => nearestPortSlot(sideLength, p.offset));
        port.side = projected.side;
        port.offset = nearestPortSlot(sideLength, projected.offset, occupied);
        port.manualOffset = true;
        this.requestRender();
        this.onLiveUpdate?.({ kind: 'port', blockId: block.id, portId: port.id, side: port.side, offset: port.offset });
        break;
      }
      case STATES.DRAWING_CONNECTION: {
        this.context.currentWorld = world;
        this.requestRender();
        break;
      }
      case STATES.DRAGGING_WIRE_TRUNK: {
        const dx = world.x - this.context.startWorld.x;
        const dy = world.y - this.context.startWorld.y;
        for (const item of this.context.items) {
          const connection = this.project.getConnection(item.connectionId);
          if (!connection) continue;
          // Each wire moves along its own trunk axis, so a diagonal drag
          // over a mixed horizontal/vertical selection still moves each one
          // correctly instead of fighting over a single shared axis.
          const delta = item.axis === 'x' ? dx : dy;
          connection.manualBend = snap(item.startBend + delta);
          this.onLiveUpdate?.({ kind: 'connection', connectionId: connection.id, manualBend: connection.manualBend });
        }
        this.requestRender();
        break;
      }
      case STATES.PENDING_EDGE: {
        const dx = screen.x - this.context.startScreen.x;
        const dy = screen.y - this.context.startScreen.y;
        if (Math.hypot(dx, dy) > CLICK_DRAG_THRESHOLD) {
          this.state = STATES.RESIZING_EDGE;
          this.resizeEdge(world);
        }
        break;
      }
      case STATES.RESIZING_EDGE: {
        this.resizeEdge(world);
        break;
      }
      default: {
        // Idle hover: recompute which cursor to show (see getCursor()) so
        // an edge you can resize looks like one before you've pressed
        // anything, not just once you're mid-drag.
        this.hoverCursor = this.computeHoverCursor(world);
        this.updateHoverGhost(world);
        break;
      }
    }
  }

  // Finds whichever block's (or the current boundary's) edge zone the
  // cursor is in, topmost/nearest first — the same priority order other
  // hit-testing uses. Returns null outside every zone.
  resolveGhostZone(world) {
    for (const block of this.project.listBlocks()) {
      const zone = getEdgeZoneOffset(block.geometry, block.ports, world.x, world.y);
      if (zone) return { blockId: block.id, geometry: block.geometry, ports: block.ports, ...zone };
    }
    const boundary = this.getBoundaryInfo();
    if (boundary) {
      const zone = getEdgeZoneOffset(boundary.geometry, boundary.block.ports, world.x, world.y);
      if (zone) return { blockId: boundary.block.id, geometry: boundary.geometry, ports: boundary.block.ports, ...zone };
    }
    return null;
  }

  // Tracks how long the cursor has sat in one edge zone, without a real
  // render happening until either it's new (dim, not yet clickable) or the
  // dwell has actually elapsed (the ghost appears and starts accepting a
  // click) — see HOVER_GHOST_DELAY_MS.
  updateHoverGhost(world) {
    const target = this.resolveGhostZone(world);
    const current = this.hoverGhost;
    const same = target && current && current.blockId === target.blockId
      && current.side === target.side && current.offset === target.offset;
    if (same) return;

    this.clearHoverGhost();
    if (!target) return;

    // Captured by reference so the timeout only ever marks *this* ghost
    // ready — clearHoverGhost cancels the timer on any change, but this
    // guards against it firing anyway in some edge case.
    const ghost = { ...target, ready: false };
    this.hoverGhost = ghost;
    this.ghostTimer = setTimeout(() => {
      if (this.hoverGhost === ghost) {
        ghost.ready = true;
        this.requestRender();
      }
    }, HOVER_GHOST_DELAY_MS);
  }

  clearHoverGhost() {
    if (this.ghostTimer) {
      clearTimeout(this.ghostTimer);
      this.ghostTimer = null;
    }
    // Only worth a redraw if it was actually visible — a not-yet-ready
    // ghost never painted anything, so clearing it changes nothing onscreen.
    const wasVisible = this.hoverGhost?.ready;
    this.hoverGhost = null;
    if (wasVisible) this.requestRender();
  }

  // What SceneRenderer draws on top of everything once the dwell has
  // elapsed — null the rest of the time (including while still dwelling,
  // pre-ready), so nothing flashes on for a cursor just passing through.
  getHoverGhost() {
    return this.hoverGhost?.ready ? this.hoverGhost : null;
  }

  computeHoverCursor(world) {
    const boundary = this.getBoundaryInfo();
    const hit = hitTest(this.project, world.x, world.y, boundary);
    if (hit?.type === 'border' || hit?.type === 'boundaryEdge') {
      return hit.side === 'left' || hit.side === 'right' ? 'ew-resize' : 'ns-resize';
    }
    return 'default';
  }

  // What InputRouter should set canvas.style.cursor to right now — a
  // resize cursor stays on for the whole drag once one starts (not just
  // while the pointer sits exactly on the edge pixel), otherwise whatever
  // the last hover pass computed.
  getCursor() {
    if (this.state === STATES.PENDING_EDGE || this.state === STATES.RESIZING_EDGE) {
      return this.context.edge === 'left' || this.context.edge === 'right' ? 'ew-resize' : 'ns-resize';
    }
    if (this.hoverGhost?.ready) return 'pointer';
    return this.hoverCursor || 'default';
  }

  // Splitter-style: dragging one edge moves only that edge, keeping the
  // opposite one fixed, rather than resizing uniformly from a corner.
  // Works the same for an ordinary block's own geometry and the boundary's
  // — only which geometry object and minimum size apply differs.
  resizeEdge(world) {
    const block = this.project.getBlock(this.context.blockId);
    const { edge, startGeometry, isBoundary } = this.context;
    const geom = isBoundary ? block?.boundaryGeometry : block?.geometry;
    if (!geom) return;
    const minWidth = isBoundary ? BOUNDARY_MIN_SIZE : MIN_BLOCK_WIDTH;
    const minHeight = isBoundary ? BOUNDARY_MIN_SIZE : MIN_BLOCK_HEIGHT;

    if (edge === 'left') {
      const rightEdge = startGeometry.x + startGeometry.width;
      const newX = Math.min(rightEdge - minWidth, snap(world.x));
      geom.x = newX;
      geom.width = rightEdge - newX;
    } else if (edge === 'right') {
      geom.width = Math.max(minWidth, snap(world.x) - startGeometry.x);
    } else if (edge === 'top') {
      const bottomEdge = startGeometry.y + startGeometry.height;
      const newY = Math.min(bottomEdge - minHeight, snap(world.y));
      geom.y = newY;
      geom.height = bottomEdge - newY;
    } else if (edge === 'bottom') {
      geom.height = Math.max(minHeight, snap(world.y) - startGeometry.y);
    }
    this.requestRender();
    if (isBoundary) {
      this.onLiveUpdate?.({ kind: 'boundary', blockId: block.id, boundaryGeometry: geom });
    } else {
      this.onLiveUpdate?.({ kind: 'block', blockId: block.id, geometry: geom });
    }
  }

  addPortAt(blockId, side, offset, geometry) {
    const block = this.project.getBlock(blockId);
    if (!block) return;
    const direction = side === 'right' ? 'out' : 'in';
    const sideLength = sideAxis(side) === 'x' ? geometry.height : geometry.width;
    // Resolved slot, not raw offset — see the same note in the
    // DRAGGING_PORT case above.
    const occupied = block.ports.filter((p) => p.side === side).map((p) => nearestPortSlot(sideLength, p.offset));
    const slotOffset = nearestPortSlot(sideLength, offset, occupied);
    addPort(block, { direction, side, offset: slotOffset });
    touchBlock(block);
    this.selection.select(block.id);
    this.persist();
    this.requestRender();
  }

  onPointerUp(world) {
    if (
      this.state === STATES.DRAGGING_BLOCK ||
      this.state === STATES.DRAGGING_PORT
    ) {
      const block = this.project.getBlock(this.context.blockId);
      if (block) touchBlock(block);
      this.persist();
    } else if (this.state === STATES.DRAWING_CONNECTION) {
      this.tryCompleteConnection(world);
    } else if (this.state === STATES.DRAGGING_WIRE_TRUNK) {
      this.persist();
    } else if (this.state === STATES.PENDING_EDGE) {
      // Released without ever crossing the drag threshold — the border is
      // resize-only now (see the hover-ghost handling in onPointerDown for
      // how a port actually gets added), so a plain press-release here
      // just does nothing.
    } else if (this.state === STATES.RESIZING_EDGE) {
      const block = this.project.getBlock(this.context.blockId);
      if (block) touchBlock(block);
      this.persist();
    }

    this.state = STATES.IDLE;
    this.context = null;
  }

  // Shared by the live hover-highlight (so what's shown while dragging is
  // exactly what dropping there will do) and the actual drop below. Returns
  // null when the cursor isn't over any port/connector at all; otherwise a
  // result that's either `valid` (with the normalized out/in sides ready to
  // connect) or not (the port under the cursor is real but its effective
  // direction can't pair with the source — e.g. a boundary port added on
  // the wrong edge).
  resolveConnectionTarget(world) {
    if (!world) return null;
    const boundary = this.getBoundaryInfo();
    const { sourceBlockId, sourcePortId, sourceInverted } = this.context;
    const targetHit = hitTest(this.project, world.x, world.y, boundary);
    const isPortHit = targetHit?.type === 'port' || targetHit?.type === 'connector';
    if (!isPortHit || targetHit.blockId === sourceBlockId) return null;

    const sourceBlock = this.project.getBlock(sourceBlockId);
    const targetBlock = this.project.getBlock(targetHit.blockId);
    const sourcePort = sourceBlock?.ports.find((p) => p.id === sourcePortId);
    const targetPort = targetBlock?.ports.find((p) => p.id === targetHit.portId);
    if (!sourcePort || !targetPort) return null;

    // A boundary port's role is inverted from this level's point of view
    // (an outside input is an inside source, and vice versa) — comparing
    // effective roles, not raw stored direction, is what lets a boundary
    // port wire to a child of the same raw direction correctly.
    const targetInverted = Boolean(boundary) && targetHit.blockId === boundary.block.id;
    const sourceEffective = sourceInverted ? invertDirection(sourcePort.direction) : sourcePort.direction;
    const targetEffective = targetInverted ? invertDirection(targetPort.direction) : targetPort.direction;
    const blockId = targetHit.blockId;
    const portId = targetHit.portId;

    if (sourceEffective === targetEffective) {
      return { valid: false, blockId, portId };
    }

    // Normalize so sourcePortId is always the effective source, regardless
    // of which handle the user actually grabbed first.
    const outSide = sourceEffective === 'out'
      ? { blockId: sourceBlockId, portId: sourcePortId }
      : { blockId, portId };
    const inSide = sourceEffective === 'out'
      ? { blockId, portId }
      : { blockId: sourceBlockId, portId: sourcePortId };

    return { valid: true, blockId, portId, outSide, inSide };
  }

  tryCompleteConnection(world) {
    const target = this.resolveConnectionTarget(world);
    if (!target?.valid) {
      this.requestRender();
      return;
    }

    this.project.addConnection(
      createConnection({
        sourceBlockId: target.outSide.blockId,
        sourcePortId: target.outSide.portId,
        targetBlockId: target.inSide.blockId,
        targetPortId: target.inSide.portId,
      }),
    );
    this.requestRender();
    this.persist();
  }

  // While drawing a connection: the source port being dragged from, and
  // whatever's currently under the cursor (if anything) with whether it's
  // actually a valid drop target — lets the canvas mark both ends live
  // instead of only revealing compatibility on drop.
  getConnectionDragHighlights() {
    if (this.state !== STATES.DRAWING_CONNECTION) return { source: null, target: null };
    const { sourceBlockId, sourcePortId, currentWorld } = this.context;
    const hover = this.resolveConnectionTarget(currentWorld);
    return {
      source: { blockId: sourceBlockId, portId: sourcePortId },
      target: hover ? { blockId: hover.blockId, portId: hover.portId, valid: hover.valid } : null,
    };
  }

  // The live paving preview: an auto-routed path from the source port to
  // wherever the cursor is right now, so dragging visibly "lays down" the
  // wire rather than showing a plain rubber-band line.
  getPendingConnectionVisual() {
    if (this.state !== STATES.DRAWING_CONNECTION) return null;
    const { sourceBlockId, sourcePortId, sourceInverted, currentWorld } = this.context;
    const block = this.project.getBlock(sourceBlockId);
    const port = block?.ports.find((p) => p.id === sourcePortId);
    if (!block || !port) return null;

    const boundary = this.getBoundaryInfo();
    const geomBlock = sourceInverted && boundary ? { ...block, geometry: boundary.geometry } : block;
    const sourcePos = findConnectorPosition(geomBlock, sourcePortId, sourceInverted);
    if (!sourcePos) return null;
    return previewPathToCursor(sourcePos, port.side, currentWorld, sourceInverted);
  }

  // Double-clicking a block's body drills into it.
  onDoubleClick(world) {
    const hit = hitTest(this.project, world.x, world.y);
    if (hit?.type === 'body') {
      this.onEnterBlock?.(hit.blockId);
    }
  }

  onWheelZoom(screen, factor) {
    this.camera.zoomAt(screen.x, screen.y, factor);
    this.requestRender();
  }

  // Used by the remote-sync poll (see store.js/main.js) to avoid replacing
  // the model out from under an in-progress drag, resize, or wire draw.
  isIdle() {
    return this.state === STATES.IDLE;
  }
}
