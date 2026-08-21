import { hitTest } from './HitTest.js';
import { MIN_BLOCK_WIDTH, MIN_BLOCK_HEIGHT } from '../model/Block.js';
import { snap, GRID_SIZE, sideAxis, nearestPortSlot } from '../model/grid.js';
import { findConnectorPosition, projectPointToPerimeter, getEdgeZoneOffset } from '../render/BlockRenderer.js';
import {
  getConnectionGeometry,
  previewPathToCursor,
  hitTestConnectionTrunk,
  hitTestConnectionPath,
} from '../render/ConnectionRenderer.js';

// Resolves a click's modifiers into one selection verb, applied the same
// way to blocks, wires, and a marquee sweep so the convention doesn't
// differ by what's being clicked:
//   plain        -> replace the whole selection with just this
//   Shift        -> toggle this in or out
//   Ctrl/Cmd     -> add this, never removing anything already selected
//   Ctrl+Shift   -> remove this, never adding anything
function selectionVerb(modifiers) {
  if (modifiers.ctrlKey && modifiers.shiftKey) return 'remove';
  if (modifiers.ctrlKey) return 'add';
  if (modifiers.shiftKey) return 'toggle';
  return 'replace';
}
import { createConnection } from '../model/Connection.js';
import { addPort } from '../model/BlockDescription.js';

// How long the cursor has to sit in a block's edge zone before the
// "click here to add a port" ghost actually appears — long enough that
// just passing through on the way to somewhere else never flashes one.
const HOVER_GHOST_DELAY_MS = 200;

// Just past a typical double-click window, so clicking a selected block to
// rename it doesn't fire when the user was actually double-clicking to
// enter it.
const RENAME_CLICK_DELAY_MS = 350;

const STATES = {
  IDLE: 'idle',
  PANNING: 'panning',
  DRAGGING_BLOCK: 'draggingBlock',
  DRAGGING_PORT: 'draggingPort',
  DRAWING_CONNECTION: 'drawingConnection',
  DRAGGING_WIRE_TRUNK: 'draggingWireTrunk',
  // Dragging one of the four floating handles a selected block (or the
  // boundary frame) shows — every edge is a resize splitter, there's no
  // separate corner-handle resize.
  RESIZING_EDGE: 'resizingEdge',
  // Pressed the boundary frame's title. The editor opens on release, not
  // here: focusing an input during pointerdown loses that focus again when
  // the browser applies its own default focus handling on the way up.
  PENDING_LABEL_RENAME: 'pendingLabelRename',
  // Shift-dragging the background sweeps out a selection rectangle.
  MARQUEE: 'marquee',
};

const BOUNDARY_MIN_SIZE = GRID_SIZE * 3;

// Decomposes every resize-handle side (see BlockRenderer.getResizeHandleRects)
// into which single-axis edge(s) it drags — a plain edge only ever runs one,
// a corner runs both from the one gesture. resizeEdge below reads this
// instead of branching on the eight sides individually.
const RESIZE_EDGE_AXES = {
  left: { horizontal: 'left', vertical: null },
  right: { horizontal: 'right', vertical: null },
  top: { horizontal: null, vertical: 'top' },
  bottom: { horizontal: null, vertical: 'bottom' },
  nw: { horizontal: 'left', vertical: 'top' },
  ne: { horizontal: 'right', vertical: 'top' },
  sw: { horizontal: 'left', vertical: 'bottom' },
  se: { horizontal: 'right', vertical: 'bottom' },
};

function cursorForResizeEdge(edge) {
  if (edge === 'left' || edge === 'right') return 'ew-resize';
  if (edge === 'top' || edge === 'bottom') return 'ns-resize';
  if (edge === 'nw' || edge === 'se') return 'nwse-resize';
  return 'nesw-resize'; // 'ne' or 'sw'
}

function invertDirection(direction) {
  if (direction === 'out') return 'in';
  if (direction === 'in') return 'out';
  return null;
}

/**
 * Explicit finite states rather than ad-hoc booleans — this is what makes
 * "drag block body" vs "drag an edge to resize" vs "drag a port" vs "draw
 * a wire" vs "drag a wire's trunk" vs "pan background" unambiguous.
 */
export class DragStateMachine {
  constructor({ camera, project, selection, wireSelection, requestRender, persist, onEnterBlock, onRequestRename, onRequestWireLabel, onLiveUpdate }) {
    this.camera = camera;
    this.project = project;
    this.selection = selection;
    this.wireSelection = wireSelection;
    this.requestRender = requestRender;
    this.persist = persist;
    this.onEnterBlock = onEnterBlock;
    // Opens an inline name editor over a block (see main.js). Clicking an
    // already-selected block renames it, but that click is also the first
    // half of a potential double-click (which enters the block instead) —
    // so it's deferred by RENAME_CLICK_DELAY_MS and cancelled if a second
    // click lands first.
    this.onRequestRename = onRequestRename;
    this.renameTimer = null;
    // Opens an inline label editor over a wire (see main.js) — double
    // click only, unlike a block's rename, since a wire has no "already
    // selected, click it again" gesture to reuse for it.
    this.onRequestWireLabel = onRequestWireLabel;
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
        // `ghost` itself carries blockId/geometry alongside the just-
        // reverified side/offset — `zone` alone is only ever {side,
        // offset} (see getEdgeZoneOffset), so passing that bare would
        // start a connection with no source block at all.
        this.startConnectionFromNewPort(ghost, world);
        return;
      }
    } else if (modifiers.pointerType && modifiers.pointerType !== 'mouse') {
      // Touch (or pen) has no hover phase before the first contact — the
      // dwell above exists purely to filter a *mouse cursor* merely
      // passing through on its way elsewhere, a hazard that doesn't apply
      // to a single discrete tap. So a touch landing directly in an
      // otherwise-empty edge zone (nothing else there to hit — an
      // existing port, a resize handle, ...) skips the dwell entirely and
      // acts on it immediately: grab a block's middle to move it, grab
      // its edge to wire it, the same split most touch diagram tools use.
      const zone = this.resolveGhostZone(world);
      if (zone) {
        this.startConnectionFromNewPort(zone, world);
        return;
      }
      this.clearHoverGhost();
    } else {
      this.clearHoverGhost();
    }

    const boundary = this.getBoundaryInfo();
    const hit = hitTest(this.project, world.x, world.y, boundary, this.getResizableBlockId());
    if (hit) this.wireSelection.clear();

    if (hit?.type === 'resizeHandle') {
      // Unambiguous, unlike the old border-drag: a handle only ever means
      // "resize," so the drag starts immediately rather than waiting to
      // see whether the pointer crosses a threshold.
      const startGeometry = hit.isBoundary ? boundary.geometry : this.project.getBlock(hit.blockId).geometry;
      this.state = STATES.RESIZING_EDGE;
      this.context = { blockId: hit.blockId, edge: hit.side, startGeometry: { ...startGeometry }, isBoundary: hit.isBoundary };
      this.requestRender();
      return;
    }

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

    // The boundary frame's own title — unambiguous (nothing else uses a
    // double-click there), so it renames on release without waiting out a
    // double-click window the way a block's own name does.
    if (hit?.type === 'boundaryLabel') {
      this.state = STATES.PENDING_LABEL_RENAME;
      this.context = { blockId: hit.blockId };
      return;
    }

    if (hit?.type === 'body') {
      const block = this.project.getBlock(hit.blockId);

      // A modified click adjusts the selection rather than starting a drag —
      // same convention used for a wire trunk just below.
      const verb = selectionVerb(modifiers);
      if (verb !== 'replace') {
        if (verb === 'toggle') this.selection.toggle(block.id);
        else if (verb === 'add') this.selection.add(block.id);
        else this.selection.remove(block.id);
        this.requestRender();
        return;
      }

      // Captured before select() so onPointerUp can tell "clicked a block
      // that was already selected" (rename) from "clicked to select it"
      // (just select). Only a lone selected block renames — with several
      // selected, a click is far more likely to be repositioning them.
      const wasSelected =
        this.selection.selectedBlockId === block.id
        && this.selection.count === 1
        && !this.selection.selectedPortId;

      // Grabbing a block that's part of a multi-selection drags the whole
      // group; grabbing anything else selects just it first.
      if (!this.selection.isSelected(block.id)) this.selection.select(block.id);

      this.state = STATES.DRAGGING_BLOCK;
      this.context = {
        blockId: block.id,
        startWorld: world,
        // Every block that moves, with the position it started at — the
        // group moves by one shared delta, so each stays put relative to
        // the others.
        items: this.selection
          .list()
          .map((id) => ({ id, startGeom: { ...(this.project.getBlock(id)?.geometry || {}) } }))
          .filter((item) => item.startGeom.x !== undefined),
        wasSelected,
        moved: false,
      };
      this.requestRender();
      return;
    }

    // A click on the boundary frame's own dashed line — selects it, the
    // same modifier convention as a block's body, but never starts a
    // drag: the boundary has nowhere to be dragged to from in here, only
    // resized (via its own handles, once this selects it).
    if (hit?.type === 'boundaryLine') {
      const verb = selectionVerb(modifiers);
      if (verb === 'toggle') this.selection.toggle(hit.blockId);
      else if (verb === 'add') this.selection.add(hit.blockId);
      else if (verb === 'remove') this.selection.remove(hit.blockId);
      else this.selection.select(hit.blockId);
      this.requestRender();
      return;
    }

    const wireHit = this.hitTestWires(world.x, world.y, boundary);
    if (wireHit) {
      const wireVerb = selectionVerb(modifiers);
      if (wireVerb !== 'replace') {
        // A modified click only adjusts membership — a following drag
        // (grabbing any selected trunk) is what actually moves the group.
        if (wireVerb === 'toggle') this.wireSelection.toggle(wireHit.connectionId);
        else if (wireVerb === 'add') this.wireSelection.add(wireHit.connectionId);
        else this.wireSelection.remove(wireHit.connectionId);
        this.requestRender();
        return;
      }
      if (!this.wireSelection.isSelected(wireHit.connectionId)) {
        this.wireSelection.selectOnly(wireHit.connectionId);
        // Mirrors what hitting a block does to the wire selection: only one
        // kind of thing is selected at a time, so the delete/color controls
        // never have to guess which of two selections was meant.
        this.selection.clear();
      }
      // Grabbing a stub selects the wire but starts no drag: a stub is
      // anchored to its port's fixed exit point and has nothing to move.
      if (wireHit.onTrunk) {
        this.state = STATES.DRAGGING_WIRE_TRUNK;
        this.context = { items: this.buildTrunkDragItems(boundary), startWorld: world };
      }
      this.requestRender();
      return;
    }

    // Empty background. Shift (or Ctrl, or both) turns the drag into a
    // selection marquee instead of a pan — panning is the far more frequent
    // action, so it keeps the unmodified drag. The verb travels with the
    // marquee so pointerUp knows whether to replace, add, or remove.
    if (modifiers.shiftKey || modifiers.ctrlKey) {
      // Matches every block hit above: selecting blocks always clears
      // whatever wires were selected, regardless of which verb is in play.
      this.wireSelection.clear();
      this.state = STATES.MARQUEE;
      this.context = { startWorld: world, currentWorld: world, verb: selectionVerb(modifiers) };
      this.requestRender();
      return;
    }

    this.wireSelection.clear();
    this.selection.clear();
    this.state = STATES.PANNING;
    this.context = { lastScreen: screen };
    this.requestRender();
  }

  // The marquee rectangle in world space, or null when not marqueeing —
  // SceneRenderer draws it, and onPointerUp resolves it to a selection.
  getMarqueeRect() {
    if (this.state !== STATES.MARQUEE) return null;
    const { startWorld, currentWorld } = this.context;
    return {
      x: Math.min(startWorld.x, currentWorld.x),
      y: Math.min(startWorld.y, currentWorld.y),
      width: Math.abs(currentWorld.x - startWorld.x),
      height: Math.abs(currentWorld.y - startWorld.y),
    };
  }

  // Anything the marquee touches counts, not only blocks entirely inside
  // it — dragging a box that fully encloses every target is fussy on a
  // dense diagram.
  blocksIntersecting(rect) {
    return this.project
      .listBlocks()
      .filter((block) => {
        const g = block.geometry;
        return (
          rect.x < g.x + g.width
          && g.x < rect.x + rect.width
          && rect.y < g.y + g.height
          && g.y < rect.y + rect.height
        );
      })
      .map((block) => block.id);
  }

  // Trunks are checked across every wire before any stub is, so a trunk
  // lying under another wire's stub stays draggable rather than being
  // shadowed by the segment on top of it.
  hitTestWires(worldX, worldY, boundary) {
    const connections = this.project.listConnections();
    const geometries = connections.map((connection) => ({
      connection,
      geometry: getConnectionGeometry(this.project, connection, boundary),
    }));

    for (let i = geometries.length - 1; i >= 0; i -= 1) {
      const { connection, geometry } = geometries[i];
      if (hitTestConnectionTrunk(geometry, worldX, worldY)) {
        return { connectionId: connection.id, onTrunk: true };
      }
    }
    for (let i = geometries.length - 1; i >= 0; i -= 1) {
      const { connection, geometry } = geometries[i];
      if (hitTestConnectionPath(geometry, worldX, worldY)) {
        return { connectionId: connection.id, onTrunk: false };
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
        const dx = world.x - this.context.startWorld.x;
        const dy = world.y - this.context.startWorld.y;
        for (const item of this.context.items) {
          const block = this.project.getBlock(item.id);
          if (!block) continue;
          // Snapping the absolute result (not the delta) is what gives the
          // Factorio/AoE feel of blocks jumping between grid cells as you
          // drag, rather than drifting off-grid by accumulated pixel
          // deltas. Applied per block against its own start position, so a
          // group keeps its internal spacing exactly.
          block.geometry.x = snap(item.startGeom.x + dx);
          block.geometry.y = snap(item.startGeom.y + dy);
          // Any actual movement means this was a drag, not the click that
          // would otherwise open the rename editor on release.
          if (block.geometry.x !== item.startGeom.x || block.geometry.y !== item.startGeom.y) {
            this.context.moved = true;
          }
          this.onLiveUpdate?.({ kind: 'block', blockId: block.id, geometry: block.geometry });
        }
        this.requestRender();
        break;
      }
      case STATES.MARQUEE: {
        this.context.currentWorld = world;
        this.requestRender();
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

    // The dwell exists so a cursor merely passing through doesn't flash a
    // ghost at every edge it crosses — that doesn't apply to a block
    // that's already selected, since you're already looking right at it.
    // Skips straight to ready with no timer at all.
    if (target.blockId === this.getResizableBlockId()) {
      this.hoverGhost = { ...target, ready: true };
      this.requestRender();
      return;
    }

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
  //
  // Mid-connection-drag is the one exception: no dwell there at all,
  // since actively dragging a wire onto a spot is already the deliberate
  // action a dwell exists to filter out for a cursor just passing by —
  // the empty-zone target it'd land on (see resolveConnectionTarget's
  // `pendingZone`) shows immediately instead.
  getHoverGhost() {
    if (this.state === STATES.DRAWING_CONNECTION) {
      const target = this.resolveConnectionTarget(this.context.currentWorld);
      return target?.pendingZone || null;
    }
    return this.hoverGhost?.ready ? this.hoverGhost : null;
  }

  // Which block, if any, is allowed to show resize handles right now — a
  // lone selected block, or none. Multi-select has no defined "resize all
  // of these together" behavior, so nothing offers a handle once more than
  // one block is selected. The boundary frame isn't gated by this at all
  // (see hitTest): its handles are always available while you're inside it,
  // the same as its edge-drag was before.
  getResizableBlockId() {
    return this.selection.count === 1 ? this.selection.selectedBlockId : null;
  }

  computeHoverCursor(world) {
    const boundary = this.getBoundaryInfo();
    const hit = hitTest(this.project, world.x, world.y, boundary, this.getResizableBlockId());
    if (hit?.type === 'resizeHandle') return cursorForResizeEdge(hit.side);
    if (hit?.type === 'boundaryLabel') return 'text';
    return 'default';
  }

  // What InputRouter should set canvas.style.cursor to right now — a
  // resize cursor stays on for the whole drag once one starts (not just
  // while the pointer sits exactly on the handle), otherwise whatever the
  // last hover pass computed.
  getCursor() {
    if (this.state === STATES.RESIZING_EDGE) return cursorForResizeEdge(this.context.edge);
    if (this.hoverGhost?.ready) return 'pointer';
    return this.hoverCursor || 'default';
  }

  // Splitter-style: dragging one edge moves only that edge, keeping the
  // opposite one fixed, rather than resizing uniformly from a corner.
  // Works the same for an ordinary block's own geometry and the boundary's
  // — only which geometry object and minimum size apply differs. A corner
  // handle (see RESIZE_EDGE_AXES) just runs both a horizontal and a
  // vertical edge from the one drag, so it's the same two blocks of logic
  // below rather than a separate code path of its own.
  resizeEdge(world) {
    const block = this.project.getBlock(this.context.blockId);
    const { edge, startGeometry, isBoundary } = this.context;
    const geom = isBoundary ? block?.boundaryGeometry : block?.geometry;
    if (!geom) return;
    const minWidth = isBoundary ? BOUNDARY_MIN_SIZE : MIN_BLOCK_WIDTH;
    const minHeight = isBoundary ? BOUNDARY_MIN_SIZE : MIN_BLOCK_HEIGHT;
    const { horizontal, vertical } = RESIZE_EDGE_AXES[edge];

    if (horizontal === 'left') {
      const rightEdge = startGeometry.x + startGeometry.width;
      const newX = Math.min(rightEdge - minWidth, snap(world.x));
      geom.x = newX;
      geom.width = rightEdge - newX;
    } else if (horizontal === 'right') {
      geom.width = Math.max(minWidth, snap(world.x) - startGeometry.x);
    }

    if (vertical === 'top') {
      const bottomEdge = startGeometry.y + startGeometry.height;
      const newY = Math.min(bottomEdge - minHeight, snap(world.y));
      geom.y = newY;
      geom.height = bottomEdge - newY;
    } else if (vertical === 'bottom') {
      geom.height = Math.max(minHeight, snap(world.y) - startGeometry.y);
    }

    this.requestRender();
    if (isBoundary) {
      this.onLiveUpdate?.({ kind: 'boundary', blockId: block.id, boundaryGeometry: geom });
    } else {
      this.onLiveUpdate?.({ kind: 'block', blockId: block.id, geometry: geom });
    }
  }

  // `select`/`persist` default on for the plain "click a ghost, get a
  // port" path, where this is the entire action and needs its own history
  // entry. resolveConnectionTarget's create-on-drop branch passes both
  // false: selecting the target block would yank the Inspector away from
  // whatever it's showing mid-drag, and the persist that follows right
  // after (once the connection itself is added) already covers this
  // port's creation too, folding "port + wire" into one undo step instead
  // of two.
  addPortAt(blockId, side, offset, geometry, { select = true, persist = true } = {}) {
    const block = this.project.getBlock(blockId);
    if (!block) return null;
    const sideLength = sideAxis(side) === 'x' ? geometry.height : geometry.width;
    // Resolved slot, not raw offset — see the same note in the
    // DRAGGING_PORT case above.
    const occupied = block.ports.filter((p) => p.side === side).map((p) => nearestPortSlot(sideLength, p.offset));
    const slotOffset = nearestPortSlot(sideLength, offset, occupied);
    // No direction is inferred from which edge got clicked — a port
    // starts undecided regardless of where it's placed (see addPort's own
    // note); side is just where it visually sits.
    const port = addPort(block, { side, offset: slotOffset });
    if (select) this.selection.select(block.id);
    if (persist) this.persist();
    this.requestRender();
    // Returned so a click-and-drag from an empty ghost zone can chain
    // straight into a wire drag sourced from the port it just made (see
    // onPointerDown's ghost-click branch) — a plain click, with no drag,
    // just leaves the port sitting there same as before.
    return port;
  }

  // Creates a port at `zone` and immediately starts a connection drag from
  // it — shared by the ready-ghost click (mouse, after the hover dwell)
  // and the touch fast path (no dwell at all) in onPointerDown. Dropping
  // straight back onto the block it came from is never a valid target
  // (see resolveConnectionTarget), so a press with no real drag away from
  // here just leaves the new port sitting there, same as clicking a ghost
  // always has.
  startConnectionFromNewPort(zone, world) {
    const port = this.addPortAt(zone.blockId, zone.side, zone.offset, zone.geometry);
    // addPortAt only fails to make one when its own blockId doesn't
    // resolve to a real block — shouldn't happen for a zone that was
    // just resolved against the live project, but leaving state/context
    // untouched here is what keeps a bad zone a no-op instead of stranding
    // the state machine in DRAWING_CONNECTION with nothing behind it.
    if (!port) return;
    const boundary = this.getBoundaryInfo();
    this.state = STATES.DRAWING_CONNECTION;
    this.context = {
      sourceBlockId: zone.blockId,
      sourcePortId: port.id,
      sourceInverted: Boolean(boundary) && zone.blockId === boundary.block.id,
      currentWorld: world,
    };
    this.requestRender();
  }

  onPointerUp(world) {
    if (
      this.state === STATES.DRAGGING_BLOCK ||
      this.state === STATES.DRAGGING_PORT
    ) {
      // A click (not a drag) on a block that was already selected opens
      // its name editor — deferred, since this same click could turn out
      // to be the first half of a double-click that enters the block.
      if (this.state === STATES.DRAGGING_BLOCK && this.context.wasSelected && !this.context.moved) {
        const blockId = this.context.blockId;
        clearTimeout(this.renameTimer);
        this.renameTimer = setTimeout(() => {
          this.renameTimer = null;
          this.onRequestRename?.(blockId);
        }, RENAME_CLICK_DELAY_MS);
      }
      this.persist();
    } else if (this.state === STATES.DRAWING_CONNECTION) {
      this.tryCompleteConnection(world);
    } else if (this.state === STATES.DRAGGING_WIRE_TRUNK) {
      this.persist();
    } else if (this.state === STATES.RESIZING_EDGE) {
      this.persist();
    } else if (this.state === STATES.MARQUEE) {
      const rect = this.getMarqueeRect();
      const ids = this.blocksIntersecting(rect);
      const verb = this.context.verb || 'replace';
      if (verb === 'add') this.selection.addMany(ids);
      else if (verb === 'remove') this.selection.removeMany(ids);
      else if (verb === 'toggle') {
        // No batch toggle: each swept block flips independently, so
        // sweeping back over a mix of selected and unselected blocks does
        // the expected per-block thing rather than one all-or-nothing flip.
        for (const id of ids) this.selection.toggle(id);
      } else if (ids.length) {
        this.selection.selectMany(ids);
      } else {
        // A plain drag on empty background with no real sweep reads as
        // "start over" — an empty marquee clears rather than leaving the
        // previous selection stranded. Add/remove/toggle with an empty
        // sweep are correctly no-ops instead, since there's nothing to
        // apply the verb to.
        this.selection.clear();
      }
    } else if (this.state === STATES.PENDING_LABEL_RENAME) {
      this.onRequestRename?.(this.context.blockId);
    }

    this.state = STATES.IDLE;
    this.context = null;
  }

  // Given both ends' *effective* direction (already inverted for a
  // boundary port where that applies), decides which is the out side and
  // which is the in side, or that they conflict. Shared by the real-port
  // branch and the create-a-port-on-drop branch below, since a target
  // that doesn't exist yet is just a target whose effective direction is
  // always null (undecided).
  resolveRoles(sourceEffective, targetEffective) {
    // Only two ports both already committed to the same real role (in-in,
    // out-out) actually conflict — an undecided (null) side never does,
    // since it just takes on whichever role the other side leaves open.
    if (sourceEffective && targetEffective && sourceEffective === targetEffective) return null;
    // Whichever side has a committed role decides; if neither does, the
    // dragged-from port defaults to being the source (out) end so a
    // connection between two undecided ports still resolves to something.
    return sourceEffective === 'out' || (!sourceEffective && targetEffective !== 'out') ? 'out' : 'in';
  }

  // Shared by the live hover-highlight (so what's shown while dragging is
  // exactly what dropping there will do) and the actual drop below. Returns
  // null when the cursor isn't over any port/connector *and* isn't over a
  // valid empty edge zone either; otherwise a result that's either `valid`
  // (with the normalized out/in sides ready to connect) or not (the port
  // under the cursor is real but its effective direction can't pair with
  // the source — e.g. a boundary port added on the wrong edge).
  //
  // `create` gates whether landing on empty edge actually adds a port
  // there (only true on the real drop — see tryCompleteConnection) or
  // just previews that it's a valid spot to drop on (mid-drag, via
  // getConnectionDragHighlights/getHoverGhost) — a hover alone must never
  // have the side effect of creating anything, only the release does.
  resolveConnectionTarget(world, { create = false } = {}) {
    if (!world) return null;
    const boundary = this.getBoundaryInfo();
    const { sourceBlockId, sourcePortId, sourceInverted } = this.context;
    const sourceBlock = this.project.getBlock(sourceBlockId);
    const sourcePort = sourceBlock?.ports.find((p) => p.id === sourcePortId);
    if (!sourcePort) return null;
    const sourceEffective = sourceInverted ? invertDirection(sourcePort.direction) : sourcePort.direction;

    const targetHit = hitTest(this.project, world.x, world.y, boundary);
    const isPortHit = targetHit?.type === 'port' || targetHit?.type === 'connector';

    if (isPortHit) {
      if (targetHit.blockId === sourceBlockId) return null;
      const targetBlock = this.project.getBlock(targetHit.blockId);
      const targetPort = targetBlock?.ports.find((p) => p.id === targetHit.portId);
      if (!targetPort) return null;

      // A boundary port's role is inverted from this level's point of view
      // (an outside input is an inside source, and vice versa) — comparing
      // effective roles, not raw stored direction, is what lets a boundary
      // port wire to a child of the same raw direction correctly.
      const targetInverted = Boolean(boundary) && targetHit.blockId === boundary.block.id;
      const targetEffective = targetInverted ? invertDirection(targetPort.direction) : targetPort.direction;
      const blockId = targetHit.blockId;
      const portId = targetHit.portId;

      const outRole = this.resolveRoles(sourceEffective, targetEffective);
      if (!outRole) return { valid: false, blockId, portId };

      // Normalize so sourcePortId is always the effective source,
      // regardless of which handle the user actually grabbed first.
      const outSide = outRole === 'out' ? { blockId: sourceBlockId, portId: sourcePortId } : { blockId, portId };
      const inSide = outRole === 'out' ? { blockId, portId } : { blockId: sourceBlockId, portId: sourcePortId };
      return { valid: true, blockId, portId, outSide, inSide };
    }

    // Nothing existing under the cursor — but an empty edge zone on some
    // *other* block is still a valid place to land a wire: dragging one
    // there is enough to give it a port to connect to, the same way
    // dragging one from a bare edge (rather than an existing port) is now
    // enough to give the wire a starting port too (see onPointerDown's
    // ghost-click handling).
    const zone = this.resolveGhostZone(world);
    if (!zone || zone.blockId === sourceBlockId) return null;
    if (!create) {
      // Preview only, mid-drag: a not-yet-created port is always
      // undecided, so it's always a compatible drop target — nothing to
      // check roles against yet. `pendingZone` lets the hover-ghost
      // renderer draw the same "add a port here" square this zone would
      // show outside of a wire drag, so the preview reads the same way.
      return { valid: true, blockId: zone.blockId, portId: null, pendingZone: zone };
    }

    const newPort = this.addPortAt(zone.blockId, zone.side, zone.offset, zone.geometry, { select: false, persist: false });
    const targetInverted = Boolean(boundary) && zone.blockId === boundary.block.id;
    // A brand new port has no direction yet, so this is really just
    // resolveRoles(sourceEffective, null) — spelled out for clarity, since
    // invertDirection(null) is null anyway.
    const targetEffective = targetInverted ? invertDirection(newPort.direction) : newPort.direction;
    const blockId = zone.blockId;
    const portId = newPort.id;
    const outRole = this.resolveRoles(sourceEffective, targetEffective);
    const outSide = outRole === 'out' ? { blockId: sourceBlockId, portId: sourcePortId } : { blockId, portId };
    const inSide = outRole === 'out' ? { blockId, portId } : { blockId: sourceBlockId, portId: sourcePortId };
    return { valid: true, blockId, portId, outSide, inSide };
  }

  tryCompleteConnection(world) {
    const target = this.resolveConnectionTarget(world, { create: true });
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

  // Double-clicking a block's body drills into it — and cancels the rename
  // the first of those two clicks had queued up.
  onDoubleClick(world) {
    clearTimeout(this.renameTimer);
    this.renameTimer = null;
    const hit = hitTest(this.project, world.x, world.y);
    if (hit?.type === 'body') {
      this.onEnterBlock?.(hit.blockId);
      return;
    }
    // Anywhere along a wire, not only its draggable trunk — same reach as
    // clicking to select it (see hitTestWires), so there's no dead length
    // of wire double-clicking does nothing on.
    const wireHit = this.hitTestWires(world.x, world.y, this.getBoundaryInfo());
    if (wireHit) this.onRequestWireLabel?.(wireHit.connectionId);
  }

  onWheelZoom(screen, factor) {
    this.camera.zoomAt(screen.x, screen.y, factor);
    this.requestRender();
  }

  // A two-finger pinch: zooms around the pinch's own center point (same
  // pivot math as onWheelZoom) and pans by however much that center
  // itself drifted since the last move — a real pinch rarely holds
  // perfectly still, so the pivot alone would leave the view sliding out
  // from under the fingers instead of tracking them.
  onPinchZoom(pivot, factor, panDx, panDy) {
    this.camera.zoomAt(pivot.x, pivot.y, factor);
    this.camera.pan(panDx, panDy);
    this.requestRender();
  }

  // Used by the remote-sync poll (see store.js/main.js) to avoid replacing
  // the model out from under an in-progress drag, resize, or wire draw.
  isIdle() {
    return this.state === STATES.IDLE;
  }
}
