import { hitTest } from './HitTest.js';
import { MIN_BLOCK_WIDTH, MIN_BLOCK_HEIGHT } from '../model/Block.js';
import { snap, snapToCellCenter, GRID_SIZE, sideAxis, nearestPortSlot, getPortSlotOffsets } from '../model/grid.js';
import {
  findConnectorPosition,
  projectPointToPerimeter,
  getEdgeZoneOffset,
  getPortBoundaryPlacement,
  getBoundaryPortBlockRect,
  getPortResizeHandleRects,
  getOccupiedWireIndicesExcluding,
  getBoundaryWireRelativeIndex,
} from '../render/BlockRenderer.js';
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
import { addPort, clonePort, logicalPortOf } from '../model/BlockDescription.js';

// How long the cursor has to sit in a block's edge zone before the
// "click here to add a port" ghost actually appears — long enough that
// just passing through on the way to somewhere else never flashes one.
const HOVER_GHOST_DELAY_MS = 200;

// How far a plain (not yet multi-wire) boundary port's own connector has to
// move before its drag commits to meaning something — either "stretch
// sideways into a container" or "redirect this wire elsewhere" (see
// resolveConnectorDragPending). Small enough that the two are still
// snappy to tell apart, big enough that a barely-moved click doesn't lock
// in either reading before the user's actually committed to one.
const CONNECTOR_STRETCH_THRESHOLD = 6;

// Just past a typical double-click window, so clicking a selected block to
// rename it doesn't fire when the user was actually double-clicking to
// enter it.
const RENAME_CLICK_DELAY_MS = 350;

const STATES = {
  IDLE: 'idle',
  PANNING: 'panning',
  DRAGGING_BLOCK: 'draggingBlock',
  DRAGGING_PORT: 'draggingPort',
  // Dragging one of a boundary port's own two resize handles — grows or
  // shrinks how many wire-slots it reserves (see
  // BlockRenderer.getBoundaryPortBlockRect), independent of its outer-face
  // size (a port has no such handles out there at all).
  RESIZING_PORT: 'resizingPort',
  // Dragging one specific wire of a *widened* (width > 1) boundary port to
  // a different, currently-free slot within that same port's own reserved
  // span — a single-wire port's own body drag still just moves the whole
  // port instead (see onPointerDown's 'port' handling), same as always.
  MOVING_PORT_WIRE: 'movingPortWire',
  // A plain (not yet multi-wire) boundary port's own connector is held
  // down but hasn't moved far enough yet to say whether this is a
  // sideways stretch (becomes a container) or an ordinary redirect (see
  // resolveConnectorDragPending) — a container's own wire never passes
  // through this state at all, its connector always means redirect
  // outright, exactly as before this existed.
  CONNECTOR_DRAG_PENDING: 'connectorDragPending',
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
    if (this.hoverGhost?.ready && this.hoverGhost.kind === 'portWire') {
      // Re-verified against the live hitTest rather than trusted as-is —
      // same reasoning as the plain edge-ghost below, just through the
      // ordinary hit-test path instead of getEdgeZoneOffset (which is
      // built around an *empty* edge and would misread this port's own
      // occupied span as "nothing here").
      const ghost = this.hoverGhost;
      this.clearHoverGhost();
      const reverify = hitTest(
        this.project,
        world.x,
        world.y,
        this.getBoundaryInfo(),
        this.getResizableBlockId(),
        this.getResizablePortId(),
        this.camera.zoom,
      );
      if (reverify?.type === 'portWireGhost' && reverify.portId === ghost.portId) {
        this.wireSelection.clear();
        this.state = STATES.DRAWING_CONNECTION;
        this.context = {
          sourceBlockId: ghost.blockId,
          sourcePortId: ghost.portId,
          sourceInverted: true,
          currentWorld: world,
          redirectingConnectionId: null,
        };
        this.requestRender();
        return;
      }
    } else if (this.hoverGhost?.ready) {
      const ghost = this.hoverGhost;
      const zone = getEdgeZoneOffset(
        ghost.geometry,
        ghost.ports,
        world.x,
        world.y,
        ghost.isBoundary,
        (portId) => this.wireCountFor(ghost.blockId, portId),
      );
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
      const zone = this.resolveGhostZone(world, { requireSelected: true });
      if (zone) {
        this.startConnectionFromNewPort(zone, world);
        return;
      }
      this.clearHoverGhost();
    } else {
      this.clearHoverGhost();
    }

    const boundary = this.getBoundaryInfo();
    // An existing port (hit.type === 'port') is always directly
    // grabbable/selectable, its parent block — the current-block boundary
    // included — need not already be selected (see hitPortsAcrossBlocks).
    const hit = hitTest(
      this.project,
      world.x,
      world.y,
      boundary,
      this.getResizableBlockId(),
      this.getResizablePortId(),
      this.camera.zoom,
    );
    if (hit) this.wireSelection.clear();

    // Same opt-in diagnostic as the hover pass (window.__ndDebug) — logged
    // here too since a real click-and-drag's mousedown is a separate DOM
    // event from whatever hover sample preceded it, and can land at a
    // slightly different point (or after the hoverGhost branch above has
    // already returned) than what the last [nd] hover log showed.
    if (typeof window !== 'undefined' && window.__ndDebug) {
      // eslint-disable-next-line no-console
      console.log('[nd:down]', { world, hit, hoverGhostReady: Boolean(this.hoverGhost?.ready) });
    }

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

    if (hit?.type === 'portResizeHandle') {
      const block = this.project.getBlock(hit.blockId);
      const port = block?.ports.find((p) => p.id === hit.portId);
      if (!port) return;
      // Captured once, at drag start, so the *other* end stays fixed at
      // its original world position throughout — recomputing this live
      // off the port's own (changing) placement would make the fixed end
      // drift as the drag continues. Width has to be the *effective*
      // one — at least as wide as the port's real wire count, same as
      // what's actually drawn and hit-tested (see getBoundaryPortBlockRect)
      // — not the raw stored value, or a port whose wire count already
      // exceeds its stored width would resize from the wrong far edge:
      // the handle you can see and grab sits at the effective width, but
      // the drag math would still measure from the smaller stored one.
      const placement = getPortBoundaryPlacement(port);
      const wireIds = this.project.listBoundaryWires(hit.blockId, hit.portId);
      const wireCount = wireIds.length;
      // Every real wire's own CURRENT relative index, snapshotted — the
      // baseline applyPortResize compensates from when the anchor itself
      // moves (see its own note on the 'start' edge), so an existing wire
      // never visually shifts just because the port grew to make room for
      // more.
      const wireSlots = {};
      wireIds.forEach((id, rank) => {
        wireSlots[id] = getBoundaryWireRelativeIndex(port, id, rank);
      });
      const startPlacement = { ...placement, width: Math.max(placement.width || 1, wireCount, 1), wireSlots };
      this.state = STATES.RESIZING_PORT;
      this.context = { blockId: hit.blockId, portId: hit.portId, edge: hit.edge, startPlacement };
      this.requestRender();
      return;
    }

    if (hit?.type === 'portWireGhost') {
      // The selected port's own spare reserved capacity, past its real
      // wires — same "+" affordance as an empty edge's add-port ghost
      // (see updateHoverGhost), but attaching a brand new wire straight
      // onto this already-existing port rather than creating a new one.
      this.state = STATES.DRAWING_CONNECTION;
      this.context = {
        sourceBlockId: hit.blockId,
        sourcePortId: hit.portId,
        sourceInverted: true,
        currentWorld: world,
        redirectingConnectionId: null,
        // Captured now, at the exact slot the ghost promised — resolved
        // fresh at drop time instead (see tryCompleteConnection) could
        // drift if another wire got added/removed to this same port
        // mid-drag (a remote collaborator, most plausibly).
        pendingWireSlotIndex: hit.relativeIndex,
      };
      this.requestRender();
      return;
    }

    if (hit?.type === 'connector') {
      const isBoundary = Boolean(boundary) && hit.blockId === boundary.block.id;
      // A boundary port that's still just a plain single wire (not yet a
      // container — see getPortBoundaryPlacement/wireCountFor) doesn't
      // decide what grabbing its own connector means until it's actually
      // moved: away from the border redirects it, same as always;
      // sideways along the border stretches it into a container instead
      // (see resolveConnectorDragPending). A port that's ALREADY a
      // container skips straight to redirect below, same as a
      // non-boundary connector always has — growing it further from here
      // on is what its own (now-visible) resize handles are for.
      if (isBoundary) {
        const block = this.project.getBlock(hit.blockId);
        const port = block.ports.find((p) => p.id === hit.portId);
        const placement = getPortBoundaryPlacement(port);
        const effectiveWidth = Math.max(placement.width || 1, this.wireCountFor(hit.blockId, hit.portId), 1);
        if (effectiveWidth === 1) {
          this.state = STATES.CONNECTOR_DRAG_PENDING;
          this.context = {
            blockId: hit.blockId,
            portId: hit.portId,
            side: placement.side,
            anchorWorld: world,
            redirectingConnectionId: hit.connectionId || null,
          };
          this.requestRender();
          return;
        }
      }
      // Selection is left untouched: drawing a wire shouldn't disturb
      // whatever the inspector is currently showing.
      this.state = STATES.DRAWING_CONNECTION;
      this.context = {
        sourceBlockId: hit.blockId,
        sourcePortId: hit.portId,
        sourceInverted: isBoundary,
        currentWorld: world,
        // Grabbing a wire this port *already has* (see HitTest's boundary
        // connector loop) picks that wire up to redirect it, rather than
        // adding a new one alongside it — the old connection is removed
        // only once a new one actually replaces it (see
        // tryCompleteConnection), so cancelling the drag or dropping it
        // somewhere invalid leaves the original wire untouched.
        redirectingConnectionId: hit.connectionId || null,
      };
      this.requestRender();
      return;
    }

    if (hit?.type === 'port') {
      const isBoundary = Boolean(boundary) && hit.blockId === boundary.block.id;
      const block = this.project.getBlock(hit.blockId);

      // Alt-drag duplicates the port instead of moving it — same name/
      // direction, dropped in the next free slot beside the original,
      // which stays put. Only meaningful on a port's *exterior* face
      // (isBoundary false): that's the one Project.addConnection caps at a
      // single wire for a container block, so a second, separately-wired
      // clone is the whole point (see BlockDescription.clonePort). From
      // *inside* the container, a port's own reserved width already gives
      // it unlimited fan-out (see DragStateMachine's own resize-handle/
      // ghost handling below) — cloning it there would just mint a second
      // port that immediately collapses back into the same interior pin
      // (see Project.listBoundaryPorts) and can never be reached again, so
      // Alt is left to mean nothing extra on that side and falls through
      // to the plain drag. Takes over regardless of which wire (if any)
      // was actually hit: cloning always means "a whole new port," never
      // "move just this one wire" (that's MOVING_PORT_WIRE below, a plain
      // drag's own thing). The new port starts the exact same
      // DRAGGING_PORT the ghost-click/new-port paths already use, so it
      // can be dragged straight to wherever it's actually wanted.
      if (modifiers.altKey && !isBoundary) {
        const sourcePort = block.ports.find((p) => p.id === hit.portId);
        const sideLength = sideAxis(sourcePort.side) === 'x' ? block.geometry.height : block.geometry.width;
        const clone = clonePort(block, sourcePort, sideLength);
        this.selection.selectPort(block.id, clone.id);
        this.persist();
        this.state = STATES.DRAGGING_PORT;
        this.context = { blockId: block.id, portId: clone.id, isBoundary: false };
        this.requestRender();
        return;
      }

      this.selection.selectPort(block.id, hit.portId);
      // Each real wire has its own independent slot within the port's
      // reserved width (see BlockRenderer.getBoundaryWireRelativeIndex) —
      // grabbing one moves just it to a different free slot, rather than
      // the whole port. Only meaningful once the port is actually a
      // container (reserved width > 1) — a still-plain single-wire port
      // has nowhere else for its one wire to go, so it keeps the plain
      // whole-port move exactly as before.
      if (isBoundary && hit.wireIndex !== undefined) {
        const port = block.ports.find((p) => p.id === hit.portId);
        const width = getPortBoundaryPlacement(port).width || 1;
        if (width > 1) {
          this.state = STATES.MOVING_PORT_WIRE;
          this.context = {
            blockId: block.id,
            portId: hit.portId,
            connectionId: hit.connectionId,
            previewIndex: getBoundaryWireRelativeIndex(port, hit.connectionId, hit.wireIndex),
          };
          this.requestRender();
          return;
        }
      }
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
        if (this.context.isBoundary) {
          // A boundary drag only ever moves the port's *boundary*
          // placement (see BlockRenderer.getPortBoundaryPlacement) — its
          // outer-face side/offset is a completely separate fact, and
          // stays exactly where it was, this is what lets a port be
          // redocked to a different edge from inside without moving
          // where it sits from outside.
          const width = getPortBoundaryPlacement(port).width || 1;
          const occupied = block.ports
            .filter((p) => p.id !== port.id)
            .map((p) => getPortBoundaryPlacement(p))
            .filter((placement) => placement.side === projected.side)
            .map((placement) => nearestPortSlot(sideLength, placement.offset));
          port.boundary = {
            side: projected.side,
            offset: nearestPortSlot(sideLength, projected.offset, occupied),
            width,
            // Carried over untouched — moving the whole port relocates
            // every wire on it together (each one's position is relative
            // to this same anchor), so none of their own individual
            // pinned slots (see getBoundaryWireRelativeIndex) needs to
            // change, only where the anchor itself now sits.
            wireSlots: port.boundary?.wireSlots,
          };
          this.requestRender();
          this.onLiveUpdate?.({ kind: 'portBoundary', blockId: block.id, portId: port.id, boundary: port.boundary });
          break;
        }
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
      case STATES.MOVING_PORT_WIRE: {
        const boundary = this.getBoundaryInfo();
        const block = boundary?.block;
        const port = block?.ports.find((p) => p.id === this.context.portId);
        if (!block || !port) break;
        // Same axis/slot math as RESIZING_PORT — the port's own side never
        // changes here, only which of its own reserved slots this one
        // wire previews landing on. Clamped to the port's full reserved
        // width, not just however many real wires exist — an independent
        // wire slot (see getBoundaryWireRelativeIndex) can land on any of
        // them, empty or not.
        const placement = getPortBoundaryPlacement(port);
        const side = placement.side;
        const geometry = boundary.geometry;
        const alongY = sideAxis(side) === 'x';
        const length = alongY ? geometry.height : geometry.width;
        const axisOrigin = alongY ? geometry.y : geometry.x;
        const cursorCoord = alongY ? world.y : world.x;
        const slots = getPortSlotOffsets(length);
        const cursorIndex = slots.indexOf(nearestPortSlot(length, cursorCoord - axisOrigin));
        const anchorIndex = Math.max(0, slots.indexOf(nearestPortSlot(length, placement.offset)));
        const width = placement.width || 1;
        const relativeIndex = Math.max(0, Math.min(width - 1, cursorIndex - anchorIndex));
        if (relativeIndex !== this.context.previewIndex) {
          this.context.previewIndex = relativeIndex;
          this.requestRender();
        }
        break;
      }
      case STATES.RESIZING_PORT: {
        this.applyPortResize(world);
        break;
      }
      case STATES.CONNECTOR_DRAG_PENDING: {
        this.resolveConnectorDragPending(world);
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
          // Cell-center family, matching the trunk's own auto-midpoint
          // (see ConnectionRenderer.computeConnectionPath) — plain grid-line
          // snap() would let a manual drag land the trunk a half-cell off
          // from where the ports it connects actually are.
          connection.manualBend = snapToCellCenter(item.startBend + delta);
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
        // Temporary, opt-in diagnostic: run `window.__ndDebug = true` in
        // the console, then hover the mouse — logs exactly what's being
        // hit-tested and computed at the real cursor position, in this
        // actual browser, with no screenshot round-trip needed to debug
        // a report that a fix "still doesn't work" here.
        if (typeof window !== 'undefined' && window.__ndDebug) {
          const boundary = this.getBoundaryInfo();
          const hit = hitTest(
            this.project,
            world.x,
            world.y,
            boundary,
            this.getResizableBlockId(),
            this.getResizablePortId(),
            this.camera.zoom,
          );
          const selectedPort = boundary?.block.ports.find((p) => p.id === this.selection.selectedPortId);
          // eslint-disable-next-line no-console
          console.log('[nd]', {
            world,
            hit,
            cursor: this.getCursor(),
            hoverCursor: this.hoverCursor,
            selectedBlockId: this.selection.selectedBlockId,
            selectedPortId: this.selection.selectedPortId,
            // The actual stored port + the rect/handles computed from it
            // right now — ground truth for whether the geometry itself
            // is where we think it is, independent of any assumption
            // about how it got there.
            selectedPortRaw: selectedPort ? JSON.parse(JSON.stringify(selectedPort)) : null,
            // { ...boundary.block, geometry: boundary.geometry } — not the
            // bare boundary.block — or this reports the wrong rect/handles
            // whenever the container's own boundaryGeometry has diverged
            // from its outer geometry (see HitTest's matching fix).
            selectedPortRect: selectedPort ? getBoundaryPortBlockRect({ ...boundary.block, geometry: boundary.geometry }, selectedPort, Math.max(1, this.project.listBoundaryWires(boundary.block.id, selectedPort.id).length)) : null,
            selectedPortHandles: selectedPort ? getPortResizeHandleRects({ ...boundary.block, geometry: boundary.geometry }, selectedPort, Math.max(1, this.project.listBoundaryWires(boundary.block.id, selectedPort.id).length)) : null,
          });
        }
        break;
      }
    }
  }

  // Finds whichever block's (or the current boundary's) edge zone the
  // cursor is in, topmost/nearest first — the same priority order other
  // hit-testing uses. Returns null outside every zone.
  //
  // `requireSelected`, when true, skips any block (current-block boundary
  // included) that isn't already selected — for *starting* a brand new
  // port/wire from a bare edge, the same "select it first" rule now
  // covers repositioning an existing port (see hitTest's own
  // selectedBlockIds). Left off (the default) for resolveConnectionTarget's
  // own call: *landing* a wire that's already being dragged from
  // elsewhere onto some other block's bare edge is completing a
  // connection, not picking a port, and was never gated by selection.
  resolveGhostZone(world, { requireSelected = false } = {}) {
    const eligible = (id) => !requireSelected || this.selection.selectedBlockIds.has(id);
    for (const block of this.project.listBlocks()) {
      if (!eligible(block.id)) continue;
      const zone = getEdgeZoneOffset(block.geometry, block.ports, world.x, world.y);
      if (zone) return { blockId: block.id, geometry: block.geometry, ports: block.ports, isBoundary: false, ...zone };
    }
    const boundary = this.getBoundaryInfo();
    if (boundary && eligible(boundary.block.id)) {
      const zone = getEdgeZoneOffset(
        boundary.geometry,
        boundary.block.ports,
        world.x,
        world.y,
        true,
        (portId) => this.wireCountFor(boundary.block.id, portId),
      );
      if (zone) return { blockId: boundary.block.id, geometry: boundary.geometry, ports: boundary.block.ports, isBoundary: true, ...zone };
    }
    return null;
  }

  // How many wires (see Project.listBoundaryWires) a port on the boundary
  // currently holds from inside — the ghost/occupancy logic above needs
  // this to treat a widened port's *entire* reserved span as occupied,
  // not just its anchor slot.
  wireCountFor(blockId, portId) {
    return this.project.listBoundaryWires(blockId, portId).length;
  }

  // Tracks how long the cursor has sat in one edge zone, without a real
  // render happening until either it's new (dim, not yet clickable) or the
  // dwell has actually elapsed (the ghost appears and starts accepting a
  // click) — see HOVER_GHOST_DELAY_MS.
  updateHoverGhost(world) {
    // A boundary port's own resize handle — or its plain body — sits
    // right at the same edge an "add a port here" ghost lives on for
    // whatever's just past it, and the body hit-test's own padding (see
    // HitTest's HANDLE_HIT_PADDING) reaches a little further than the
    // port's true rect. Without this check the ghost can win the cursor
    // (see getCursor's priority) while hovering a real, already-drawn
    // part of the port — either target is more specific than a bare-edge
    // ghost and wins outright, the same way a real port already outranks
    // one on the open canvas.
    const boundary = this.getBoundaryInfo();
    const hit = boundary
      ? hitTest(this.project, world.x, world.y, boundary, this.getResizableBlockId(), this.getResizablePortId(), this.camera.zoom)
      : null;
    if (hit?.type === 'portResizeHandle' || (hit?.type === 'port' && hit.blockId === boundary.block.id)) {
      this.clearHoverGhost();
      return;
    }

    // The selected port's own spare reserved capacity — shown with the
    // exact same "+" ghost as an empty edge (see getHoverGhost/SceneRenderer),
    // just sitting over the port's own next unused slot instead of a bare
    // border point, and ready the instant it's hovered (no dwell) the same
    // way an already-selected block's edge skips the dwell just below.
    if (hit?.type === 'portWireGhost') {
      const already = this.hoverGhost?.ready && this.hoverGhost.side === hit.side && this.hoverGhost.offset === hit.offset;
      if (!already) {
        this.clearHoverGhost();
        // `kind: 'portWire'` is what tells onPointerDown's ready-ghost
        // branch apart from the plain add-a-new-port ghost below — it
        // carries no `ports`/`isBoundary` at all, so treating it as that
        // other kind by mistake would run getEdgeZoneOffset with an
        // undefined ports list and try to add a port on a blockId that was
        // never set.
        this.hoverGhost = { geometry: boundary.geometry, side: hit.side, offset: hit.offset, blockId: hit.blockId, portId: hit.portId, kind: 'portWire', ready: true };
        this.requestRender();
      }
      return;
    }

    const target = this.resolveGhostZone(world, { requireSelected: true });
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

  // While a wire is being dragged to a different slot within its own port
  // (see MOVING_PORT_WIRE) — lets SceneRenderer/BlockRenderer draw that
  // ONE wire at the candidate slot for this frame, so it visibly follows
  // the cursor instead of only snapping into place once you release (see
  // BlockRenderer.drawPorts' own wireMoveOverride).
  getWireMoveOverride() {
    if (this.state !== STATES.MOVING_PORT_WIRE) return null;
    const { portId, connectionId, previewIndex } = this.context;
    return { portId, connectionId, previewIndex };
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

  // Whichever port is currently selected, if any — its resize handles
  // (see BlockRenderer.getPortResizeHandleRects) only ever show on the
  // boundary anyway (hitTest only looks for them inside `boundary`), so
  // there's no need to also gate this on which block owns it.
  getResizablePortId() {
    return this.selection.selectedPortId;
  }

  computeHoverCursor(world) {
    const boundary = this.getBoundaryInfo();
    const hit = hitTest(this.project, world.x, world.y, boundary, this.getResizableBlockId(), this.getResizablePortId(), this.camera.zoom);
    if (hit?.type === 'resizeHandle') return cursorForResizeEdge(hit.side);
    if (hit?.type === 'portResizeHandle') {
      const block = this.project.getBlock(hit.blockId);
      const port = block?.ports.find((p) => p.id === hit.portId);
      const axis = port ? sideAxis(getPortBoundaryPlacement(port).side) : 'x';
      return axis === 'y' ? 'ew-resize' : 'ns-resize';
    }
    // A boundary port's own body — as opposed to one of its resize
    // handles — is what you drag to move it, the same "grab this" cue a
    // draggable thing conventionally gets.
    if (hit?.type === 'port' && boundary && hit.blockId === boundary.block.id) return 'move';
    if (hit?.type === 'boundaryLabel') return 'text';
    return 'default';
  }

  // What InputRouter should set canvas.style.cursor to right now — a
  // resize cursor stays on for the whole drag once one starts (not just
  // while the pointer sits exactly on the handle), otherwise whatever the
  // last hover pass computed.
  getCursor() {
    if (this.state === STATES.RESIZING_EDGE) return cursorForResizeEdge(this.context.edge);
    if (this.state === STATES.RESIZING_PORT) {
      return sideAxis(this.context.startPlacement.side) === 'y' ? 'ew-resize' : 'ns-resize';
    }
    if (this.state === STATES.DRAGGING_PORT && this.context.isBoundary) return 'move';
    if (this.state === STATES.MOVING_PORT_WIRE) return 'move';
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
  // Shared by RESIZING_PORT's own onPointerMove case and the moment a
  // plain, not-yet-a-container port's own wire gets stretched sideways
  // past CONNECTOR_STRETCH_THRESHOLD (see resolveConnectorDragPending) —
  // both drive the exact same live anchor/width math off whatever's
  // already in this.context (blockId, portId, edge, startPlacement).
  // Pins `connectionId` to a definite relative slot (see
  // BlockRenderer.getBoundaryWireRelativeIndex) on `portId` — a no-op for
  // a still-plain (width <= 1) port, which needs no such bookkeeping at
  // all. `preferredIndex` (only ever passed for the drag's own source
  // port — see tryCompleteConnection) pins it exactly there if that slot
  // is actually free; otherwise (or with no preference at all) the first
  // genuinely free index within the port's reserved width is picked.
  assignWireSlot(blockId, portId, connectionId, preferredIndex) {
    const block = this.project.getBlock(blockId);
    const port = block?.ports.find((p) => p.id === portId);
    if (!port) return;
    const width = getPortBoundaryPlacement(port).width || 1;
    if (width <= 1) return;
    const wireIds = this.project.listBoundaryWires(blockId, portId);
    const occupied = new Set(getOccupiedWireIndicesExcluding(port, wireIds, connectionId));
    let index = preferredIndex;
    if (index === undefined || index === null || occupied.has(index)) {
      index = 0;
      while (occupied.has(index)) index += 1;
    }
    if (!port.boundary) port.boundary = { side: port.side, offset: port.offset, width: 1 };
    if (!port.boundary.wireSlots) port.boundary.wireSlots = {};
    port.boundary.wireSlots[connectionId] = index;
  }

  applyPortResize(world) {
    const boundary = this.getBoundaryInfo();
    const block = boundary?.block;
    const port = block?.ports.find((p) => p.id === this.context.portId);
    if (!block || !port) return;
    const { edge, startPlacement } = this.context;
    const side = startPlacement.side;
    const geometry = boundary.geometry;
    const alongY = sideAxis(side) === 'x'; // 'left'/'right' spread along y, 'top'/'bottom' along x
    const length = alongY ? geometry.height : geometry.width;
    const axisOrigin = alongY ? geometry.y : geometry.x;
    const cursorCoord = alongY ? world.y : world.x;
    const slots = getPortSlotOffsets(length);
    const cursorIndex = slots.indexOf(nearestPortSlot(length, cursorCoord - axisOrigin));
    const anchorIndex = Math.max(0, slots.indexOf(nearestPortSlot(length, startPlacement.offset)));
    const startWidth = startPlacement.width || 1;
    // Every real wire's own relative index as it stood when this drag
    // started (see onPointerDown's portResizeHandle branch) — resizing
    // must never let an existing wire fall outside the reserved range
    // that results, or it'd be silently orphaned past the port's own
    // edge.
    const startWireSlots = startPlacement.wireSlots || {};
    const existingRelIndices = Object.values(startWireSlots);
    const maxExistingRel = existingRelIndices.length ? Math.max(...existingRelIndices) : -1;
    const minExistingRel = existingRelIndices.length ? Math.min(...existingRelIndices) : 0;

    if (edge === 'end') {
      // The anchor (index 0 of the port's span) never moves; only how far
      // it reaches does — existing wires' relative indices are pinned
      // exactly as they were, completely untouched by this.
      const width = Math.max(1, maxExistingRel + 1, cursorIndex - anchorIndex + 1);
      port.boundary = { side, offset: startPlacement.offset, width, wireSlots: { ...startWireSlots } };
    } else {
      // The far end stays fixed at its original world position (same
      // idea as resizing a block from its left/top edge — see
      // resizeEdge) while the anchor itself slides to meet the cursor —
      // never past the closest-to-anchor existing wire, same reasoning as
      // the 'end' edge's own width floor above.
      const farIndex = anchorIndex + startWidth - 1;
      const maxNewAnchorIndex = anchorIndex + minExistingRel;
      const newAnchorIndex = Math.max(0, Math.min(cursorIndex, farIndex, maxNewAnchorIndex));
      const width = Math.max(1, farIndex - newAnchorIndex + 1);
      // The anchor just moved by this many slots — every existing wire's
      // OWN relative index shifts by the same amount the opposite way, so
      // its absolute position (what's actually drawn) stays exactly where
      // it visually was, instead of sliding along with the anchor the way
      // a bare anchor+index computation otherwise would.
      const compensation = anchorIndex - newAnchorIndex;
      const wireSlots = {};
      for (const [id, rel] of Object.entries(startWireSlots)) {
        wireSlots[id] = rel + compensation;
      }
      port.boundary = { side, offset: slots[newAnchorIndex], width, wireSlots };
    }
    this.requestRender();
    this.onLiveUpdate?.({ kind: 'portBoundary', blockId: block.id, portId: port.id, boundary: port.boundary });
  }

  // While a plain (not yet multi-wire) boundary port's own connector is
  // held down, which way it actually gets dragged decides what the whole
  // gesture means — same dot, two different outcomes: away from the
  // border (the ordinary redirect-this-wire drag, unchanged from always)
  // or sideways along the border (stretching it into a wider container
  // that can then hold more). Below CONNECTOR_STRETCH_THRESHOLD the
  // gesture stays undecided (a plain click, or a wobble not yet worth
  // committing to either reading) — the SAME small deadzone a real click
  // vs. drag distinction always needs somewhere.
  resolveConnectorDragPending(world) {
    const { anchorWorld, side } = this.context;
    const alongY = sideAxis(side) === 'x';
    const alongDelta = alongY ? world.y - anchorWorld.y : world.x - anchorWorld.x;
    const perpDelta = alongY ? world.x - anchorWorld.x : world.y - anchorWorld.y;
    if (Math.max(Math.abs(alongDelta), Math.abs(perpDelta)) < CONNECTOR_STRETCH_THRESHOLD) return;

    const { blockId, portId, redirectingConnectionId } = this.context;
    if (Math.abs(alongDelta) > Math.abs(perpDelta)) {
      // Stretching it sideways — becomes a container starting at width 1
      // (whatever it already reserved, or the plain single-wire default —
      // see getPortBoundaryPlacement), then resizes exactly like grabbing
      // one of its own two handles would, just kicked off from the wire
      // itself since a plain port doesn't show any handles yet.
      const block = this.project.getBlock(blockId);
      const port = block?.ports.find((p) => p.id === portId);
      if (!port) { this.state = STATES.IDLE; this.context = null; return; }
      const placement = getPortBoundaryPlacement(port);
      // Pin whatever real wire is already here (there may be none at all
      // — a totally unwired port's own connector is grabbable too) at
      // relative index 0, its own current position — so growing this
      // container from here on (see applyPortResize) never has to guess
      // where it started.
      const wireSlots = redirectingConnectionId ? { [redirectingConnectionId]: 0 } : {};
      port.boundary = { side: placement.side, offset: placement.offset, width: 1, wireSlots };
      this.state = STATES.RESIZING_PORT;
      this.context = { blockId, portId, edge: alongDelta > 0 ? 'end' : 'start', startPlacement: port.boundary };
      this.applyPortResize(world);
    } else {
      // Away from the border — the ordinary redirect-this-wire drag,
      // exactly as if the port were already a container and this were any
      // other wire's own connector (see onPointerDown's 'connector'
      // branch).
      this.state = STATES.DRAWING_CONNECTION;
      this.context = { sourceBlockId: blockId, sourcePortId: portId, sourceInverted: true, currentWorld: world, redirectingConnectionId };
    }
    this.requestRender();
  }

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
  addPortAt(blockId, side, offset, geometry, { select = true, persist = true, isBoundary = false } = {}) {
    const block = this.project.getBlock(blockId);
    if (!block) return null;
    const sideLength = sideAxis(side) === 'x' ? geometry.height : geometry.width;
    // No direction is inferred from which edge got clicked — a port
    // starts undecided regardless of where it's placed (see addPort's own
    // note); side is just where it visually sits.
    let port;
    if (isBoundary) {
      // Clicking a bare spot on the boundary gives the new port its
      // *boundary* placement right there — its outer-face side/offset is
      // a separate, auto-placed fact (see addPort), the same as any other
      // port only ever gets from the Inspector's own "+ Add port".
      const occupied = block.ports
        .map((p) => getPortBoundaryPlacement(p))
        .filter((placement) => placement.side === side)
        .map((placement) => nearestPortSlot(sideLength, placement.offset));
      const slotOffset = nearestPortSlot(sideLength, offset, occupied);
      port = addPort(block, {});
      port.boundary = { side, offset: slotOffset, width: 1 };
    } else {
      // Resolved slot, not raw offset — see the same note in the
      // DRAGGING_PORT case above.
      const occupied = block.ports.filter((p) => p.side === side).map((p) => nearestPortSlot(sideLength, p.offset));
      const slotOffset = nearestPortSlot(sideLength, offset, occupied);
      port = addPort(block, { side, offset: slotOffset });
    }
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
    const port = this.addPortAt(zone.blockId, zone.side, zone.offset, zone.geometry, { isBoundary: zone.isBoundary });
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
      // Tracked so resolveConnectionTarget can tell "this whole connection
      // is being quick-created from scratch" (both ends bare edges) apart
      // from "one end already existed" — only the former gets its ports'
      // direction decided outright (see resolveConnectionTarget), since an
      // existing port's direction is the user's own prior, deliberate
      // choice to leave undecided or not.
      sourcePortIsNew: true,
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
    } else if (this.state === STATES.RESIZING_EDGE || this.state === STATES.RESIZING_PORT) {
      this.persist();
    } else if (this.state === STATES.MOVING_PORT_WIRE) {
      // Committed only onto a genuinely free slot — its own current one
      // (a drop back where it started, a harmless no-op) or one no OTHER
      // real wire currently occupies; landing on another wire's own slot
      // is rejected outright rather than swapping the two, matching "move
      // it into a free spot" rather than "reorder however you like".
      const { blockId, portId, connectionId, previewIndex } = this.context;
      const block = this.project.getBlock(blockId);
      const port = block?.ports.find((p) => p.id === portId);
      const wireIds = this.project.listBoundaryWires(blockId, portId);
      const currentIndex = port ? getBoundaryWireRelativeIndex(port, connectionId, wireIds.indexOf(connectionId)) : previewIndex;
      if (port && previewIndex !== currentIndex) {
        const occupied = getOccupiedWireIndicesExcluding(port, wireIds, connectionId);
        if (!occupied.includes(previewIndex)) {
          this.assignWireSlot(blockId, portId, connectionId, previewIndex);
          this.persist();
        }
      }
      this.requestRender();
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
    const sourceLogical = logicalPortOf(sourceBlock, sourcePort);
    const sourceDirection = sourceLogical?.direction ?? null;
    const sourceEffective = sourceInverted ? invertDirection(sourceDirection) : sourceDirection;

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
      const targetDirection = logicalPortOf(targetBlock, targetPort)?.direction ?? null;
      const targetEffective = targetInverted ? invertDirection(targetDirection) : targetDirection;
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

    const newPort = this.addPortAt(zone.blockId, zone.side, zone.offset, zone.geometry, {
      select: false,
      persist: false,
      isBoundary: zone.isBoundary,
    });
    const targetInverted = Boolean(boundary) && zone.blockId === boundary.block.id;
    // A brand new port has no direction yet, so this is really just
    // resolveRoles(sourceEffective, null) — spelled out for clarity, since
    // invertDirection(null) is null anyway.
    const newLogical = logicalPortOf(this.project.getBlock(zone.blockId), newPort);
    const targetEffective = targetInverted ? invertDirection(newLogical?.direction ?? null) : newLogical?.direction ?? null;
    const blockId = zone.blockId;
    const portId = newPort.id;
    const outRole = this.resolveRoles(sourceEffective, targetEffective);

    // Quick-creating a whole connection from two bare edges (as opposed to
    // landing on — or dragging from — a port that already existed) leaves
    // nothing undecided: with both ends new, the wire itself is the only
    // fact either one has, so it's applied outright (source out, target
    // in) rather than leaving two fresh ports sitting there undecided. An
    // existing port's direction is never touched here — undecided is a
    // choice that port's own history already made (or didn't), not
    // something this drag gets to override. Written onto the *logical*
    // port (see BlockDescription's module doc), not the pin — a brand new
    // pin from addPortAt always comes with a brand new logical port of its
    // own, so this never touches a direction some OTHER pin is already
    // relying on.
    if (this.context.sourcePortIsNew) {
      const targetRole = outRole === 'out' ? 'in' : 'out';
      if (sourceLogical) sourceLogical.direction = sourceInverted ? invertDirection(outRole) : outRole;
      if (newLogical) newLogical.direction = targetInverted ? invertDirection(targetRole) : targetRole;
    }

    const outSide = outRole === 'out' ? { blockId: sourceBlockId, portId: sourcePortId } : { blockId, portId };
    const inSide = outRole === 'out' ? { blockId, portId } : { blockId: sourceBlockId, portId: sourcePortId };
    return { valid: true, blockId, portId, outSide, inSide };
  }

  tryCompleteConnection(world) {
    const target = this.resolveConnectionTarget(world, { create: true });
    if (typeof window !== 'undefined' && window.__ndDebug) {
      // eslint-disable-next-line no-console
      console.log('[nd:up]', { world, sourceContext: this.context, target });
    }
    if (!target?.valid) {
      this.requestRender();
      return;
    }

    const added = this.project.addConnection(
      createConnection({
        sourceBlockId: target.outSide.blockId,
        sourcePortId: target.outSide.portId,
        targetBlockId: target.inSide.blockId,
        targetPortId: target.inSide.portId,
      }),
    );
    // Only removed once a replacement actually lands — a drop rejected as
    // a duplicate, or anywhere invalid, leaves the wire being redirected
    // exactly as it was (see onPointerDown's 'connector' handling).
    if (added && this.context.redirectingConnectionId) {
      this.project.removeConnection(this.context.redirectingConnectionId);
    }
    // Whichever end (if either) landed on the boundary's own container
    // port needs a pinned slot now that it genuinely has one — a plain,
    // still-single-wire port needs none (see assignWireSlot's own early
    // return). `pendingWireSlotIndex` (only ever set for the end that
    // WAS the drag's source — see the portWireGhost branch) is honored
    // only for that specific port; the other end, if it's also a
    // container, just gets the next free slot instead.
    if (added) {
      const boundary = this.getBoundaryInfo();
      if (boundary) {
        for (const side of [target.outSide, target.inSide]) {
          if (side.blockId !== boundary.block.id) continue;
          const preferred = side.portId === this.context.sourcePortId ? this.context.pendingWireSlotIndex : undefined;
          this.assignWireSlot(side.blockId, side.portId, added.id, preferred);
        }
      }
    }
    if (typeof window !== 'undefined' && window.__ndDebug) {
      // eslint-disable-next-line no-console
      console.log('[nd:up:result]', { added: Boolean(added) });
    }
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
  // Where this drag's source wire sits (or will land) among a boundary
  // port's other wires — a redirect (see onPointerDown's 'connector'
  // handling) resolves to its OWN current index in
  // Project.listBoundaryWires (still there, unremoved, until the drag
  // actually completes — see tryCompleteConnection), not always the
  // anchor: grabbing the port's 2nd or 3rd wire to redirect it used to
  // show the live preview line snapping back to the 1st slot's position
  // regardless of which one was actually picked up, only correcting
  // itself once the drop landed. A brand new wire (no redirect underway —
  // from a totally fresh port, or from the portWireGhost) lands one past
  // however many real wires already exist, same index HitTest's
  // portWireGhost already computed when the drag started.
  getDragSourceSlotIndex() {
    const { sourceBlockId, sourcePortId, redirectingConnectionId } = this.context;
    const ids = this.project.listBoundaryWires(sourceBlockId, sourcePortId);
    if (redirectingConnectionId) {
      const index = ids.indexOf(redirectingConnectionId);
      return index < 0 ? ids.length : index;
    }
    return ids.length;
  }

  getPendingConnectionVisual() {
    if (this.state !== STATES.DRAWING_CONNECTION) return null;
    const { sourceBlockId, sourcePortId, sourceInverted, currentWorld } = this.context;
    const block = this.project.getBlock(sourceBlockId);
    const port = block?.ports.find((p) => p.id === sourcePortId);
    if (!block || !port) return null;

    const boundary = this.getBoundaryInfo();
    const geomBlock = sourceInverted && boundary ? { ...block, geometry: boundary.geometry } : block;
    const sourcePos = findConnectorPosition(geomBlock, sourcePortId, sourceInverted, sourceInverted ? { index: this.getDragSourceSlotIndex(), connectionId: this.context.redirectingConnectionId } : null);
    if (!sourcePos) return null;
    const side = sourceInverted ? getPortBoundaryPlacement(port).side : port.side;
    return previewPathToCursor(sourcePos, side, currentWorld, sourceInverted);
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
