import {
  drawPortGhost,
  PORT_SELECTED_RING_COLOR,
  PORT_SOURCE_RING_COLOR,
  PORT_TARGET_VALID_RING_COLOR,
  PORT_TARGET_INVALID_RING_COLOR,
} from './BlockRenderer.js';
import { drawPath, drawWireGrips, PREVIEW_DASH } from './ConnectionRenderer.js';
import { drawGridDots, drawLevel, routeConnections } from './SubPreviewRenderer.js';
import { chainToRoot, rootCameraFor, screenToWorldWith } from './levelTransform.js';
import { LevelView } from '../model/levelView.js';
import { getCanvasPalette } from './canvasPalette.js';

const WIRE_COLOR = '#4f8cff';

// A handful of visually-distinct colors, deterministically picked per
// remote client id — enough to tell separate cursors apart without any
// identity/accounts system to draw real names from.
const CURSOR_COLORS = ['#ff6b6b', '#4f8cff', '#3ecf5d', '#ffb454', '#c77dff', '#5eead4', '#f472b6'];

// Exported so the header's own "who's online" list (see ui/OnlineUsers.js)
// colors each person's avatar to match the cursor they'd see moving on
// the canvas — the only "identity" either place has to go on, absent any
// accounts system.
export function colorForClientId(id) {
  let hash = 0;
  for (let i = 0; i < id.length; i += 1) hash = (hash * 31 + id.charCodeAt(i)) >>> 0;
  return CURSOR_COLORS[hash % CURSOR_COLORS.length];
}

// Drawn in world space like everything else, but scaled by 1/zoom so the
// cursor glyph stays a constant on-screen size regardless of zoom level —
// the same trick the grid uses for its dot radius.
function drawRemoteCursors(ctx, cursors, zoom) {
  const scale = 1 / zoom;
  for (const [clientId, cursor] of cursors) {
    const color = colorForClientId(clientId);
    ctx.save();
    ctx.translate(cursor.x, cursor.y);
    ctx.scale(scale, scale);

    ctx.beginPath();
    ctx.moveTo(0, 0);
    ctx.lineTo(0, 15);
    ctx.lineTo(4, 11.5);
    ctx.lineTo(7, 17.5);
    ctx.lineTo(9.5, 16.3);
    ctx.lineTo(6.5, 10.3);
    ctx.lineTo(11.5, 10.3);
    ctx.closePath();
    ctx.fillStyle = color;
    ctx.fill();
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 1;
    ctx.stroke();

    const label = clientId.slice(0, 4);
    ctx.font = '11px -apple-system, Segoe UI, Roboto, sans-serif';
    const textWidth = ctx.measureText(label).width;
    ctx.fillStyle = color;
    ctx.fillRect(15, 9, textWidth + 8, 16);
    ctx.fillStyle = '#0b0e13';
    ctx.textAlign = 'left';
    ctx.textBaseline = 'middle';
    ctx.fillText(label, 19, 17);

    ctx.restore();
  }
}

// The shift-drag selection rectangle. Line width is divided by zoom so it
// stays a constant on-screen thickness.
function drawMarquee(ctx, rect, zoom) {
  ctx.save();
  ctx.fillStyle = 'rgba(79, 140, 255, 0.12)';
  ctx.fillRect(rect.x, rect.y, rect.width, rect.height);
  ctx.setLineDash([6 / zoom, 4 / zoom]);
  ctx.strokeStyle = '#4f8cff';
  ctx.lineWidth = 1 / zoom;
  ctx.strokeRect(rect.x, rect.y, rect.width, rect.height);
  ctx.restore();
}

// One combined lookup so drawBlock/drawBoundary don't each need to know
// about selection vs. in-progress-wire state separately — every port ring
// this frame, keyed by "blockId:portId".
function buildPortHighlights(selectedBlockId, selectedPortId, connectionSource, connectionTarget) {
  const highlights = new Map();
  if (selectedBlockId && selectedPortId) {
    highlights.set(`${selectedBlockId}:${selectedPortId}`, PORT_SELECTED_RING_COLOR);
  }
  if (connectionSource) {
    highlights.set(`${connectionSource.blockId}:${connectionSource.portId}`, PORT_SOURCE_RING_COLOR);
  }
  if (connectionTarget) {
    const color = connectionTarget.valid ? PORT_TARGET_VALID_RING_COLOR : PORT_TARGET_INVALID_RING_COLOR;
    highlights.set(`${connectionTarget.blockId}:${connectionTarget.portId}`, color);
  }
  return highlights;
}

function applyCamera(ctx, cam, dpr) {
  ctx.setTransform(cam.zoom * dpr, 0, 0, cam.zoom * dpr, cam.offsetX * dpr, cam.offsetY * dpr);
}

// The part of the world a camera shows, in that camera's world units.
function visibleRectFor(cam, canvasWidth, canvasHeight) {
  const topLeft = screenToWorldWith(cam, 0, 0);
  const bottomRight = screenToWorldWith(cam, canvasWidth, canvasHeight);
  return { x: topLeft.x, y: topLeft.y, width: bottomRight.x - topLeft.x, height: bottomRight.y - topLeft.y };
}

/**
 * Paints one frame. `camera` is in the coordinates of the level being
 * edited (project.path), as is every overlay — selection handles, wire
 * grips, the marquee, the wire being drawn. The scene itself is drawn
 * from the root: the camera is re-based into root coordinates through
 * the chain of frame→face transforms (see render/levelTransform.js) and
 * the root level is drawn with every nested level open on its block's
 * face (see SubPreviewRenderer.drawLevel), the one being edited among
 * them. There is no separate rendering for "inside a block": a level
 * looks the same whether it or its parent is being edited, so moving the
 * editing focus (see interaction/LevelFocus.js) changes nothing on
 * screen.
 */
export function renderScene(
  ctx,
  camera,
  project,
  {
    selectedBlockId,
    // Every highlighted block; selectedBlockId stays the Inspector's single
    // "primary" one. Defaulted so callers that only care about one block
    // (the diagram-image renderer) don't have to build a Set.
    selectedBlockIds = new Set(selectedBlockId ? [selectedBlockId] : []),
    selectedPortId,
    dpr,
    canvasWidth,
    canvasHeight,
    pendingConnectionPath,
    connectionSource,
    connectionTarget,
    wireSelection,
    remoteCursors,
    hoverGhost,
    // The pin under the mouse, lit as the socket or the plug (see
    // DragStateMachine.getHoverPin and BlockRenderer.drawPorts).
    hoverPin = null,
    marqueeRect,
    // The one connection (if any) currently being picked up to redirect —
    // see DragStateMachine.getRedirectingConnectionId's own doc.
    hiddenConnectionId = null,
    // Further connections to leave undrawn this frame: the plugs a block
    // drag is about to pull out (see DragStateMachine
    // .getUnpluggingConnectionIds), shown gone before the drop commits it.
    hiddenConnectionIds = [],
    // { portId, connectionId, previewIndex } while a wire is being dragged
    // to a different slot within its own port (see
    // DragStateMachine.getWireMoveOverride) — lets it visibly follow the
    // cursor for this frame instead of only snapping into place on drop.
    wireMoveOverride = null,
    // { connectionId, index } for the wire piece being dragged right now
    // (see DragStateMachine.getActiveWirePiece), so its grip draws filled.
    activeWirePiece = null,
    // Where the marching-dash pattern currently starts, or null for solid
    // wires. Null by default so an exported diagram image (see
    // model/diagramImage.js) is never caught mid-animation.
    flowOffset = null,
    // Off for exported diagram images (see docSync.js) — the grid is an
    // editing aid, not part of the diagram, and leaving it out keeps the
    // exported PNG's background genuinely transparent instead of a faint
    // lattice of grid dots on a light Doc page.
    showGrid = true,
    // The one container whose level draws the dotted background: the
    // block a new block would land in right now (see main.js's
    // addTargetForSelection) — the selected block, or the container of
    // the level being edited when nothing is selected. Every other level
    // draws without a grid, so the dots say where the FAB will put things
    // instead of tiling the whole scene. The root block's id means the
    // root level, which has no face to draw on and so gets the grid
    // across the whole viewport, as it always did. Null — the default,
    // and what both exporters pass — keeps the grid on every level.
    gridBlockId = null,
    // On for the live canvas: the scene is drawn from the root with every
    // level open on its block's face. Off for both exporters, whose
    // "zoom" is a resolution/scale choice rather than someone actually
    // leaning in — they draw the level being edited alone, its frame and
    // pins included, every block closed, the way a figure reads at one
    // level.
    showSubPreviews = true,
    // Lets a block whose name is an image URL (see render/imageCache.js)
    // ask for a redraw once that image finishes loading — a no-op by
    // default so one-shot renders (the diagram-image exporter) don't need
    // to supply one; they just draw with whatever's already cached.
    requestRender = () => {},
    // Defaults to whatever the live app's theme currently is; the diagram-
    // image exporter (model/diagramImage.js) always passes the light
    // palette explicitly instead, since an exported figure lands on a
    // white Doc page regardless of which theme its editor prefers.
    palette = getCanvasPalette(),
    // A generic embedding point for a host page (see main.js's own
    // window.nodigraph doc) that wants to draw its own thing onto a
    // specific block, in lockstep with this exact paint rather than a
    // separately-timed DOM overlay drifting out of sync on every pan/zoom
    // frame this canvas redraws but a slower host loop hasn't caught up
    // to yet. Called once per block of the level being edited, right
    // after it is drawn — `ctx` is under that level's camera transform at
    // that point, so the callback can draw straight in world coordinates
    // (block.geometry) with no transform math of its own to get right. A
    // third argument carries contentAlpha: hosts can fade their custom
    // face/DOM with the title instead of covering the opened interior. A
    // no-op by default, which is every caller today except a host that's
    // set one up.
    onDrawBlock = () => {},
  },
) {
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, ctx.canvas.width, ctx.canvas.height);

  const containerBlock = project.getContainerBlock();
  const boundary = containerBlock?.boundaryGeometry
    ? { block: containerBlock, geometry: containerBlock.boundaryGeometry }
    : null;
  const portHighlights = buildPortHighlights(selectedBlockId, selectedPortId, connectionSource, connectionTarget);
  const hidden = new Set(hiddenConnectionIds);
  if (hiddenConnectionId) hidden.add(hiddenConnectionId);

  // Everything the level being edited draws differently from the others
  // (see SubPreviewRenderer.drawLevel), and the blocks on the way down to
  // it, which always draw fully open.
  const pathBlocks = project.getPathBlocks();
  const focus = {
    containerId: containerBlock?.id ?? null,
    pathIds: new Set(pathBlocks.map((block) => block.id)),
    selectedBlockIds,
    selectedBlockId,
    portHighlights,
    wireSelection,
    hiddenConnectionId: hidden,
    wireMoveOverride,
    gridBlockId,
    hoverPin,
    // Filled in by drawLevel with the routed wires of the level being
    // edited, for the grips drawn over everything below.
    out: {},
  };
  const levelCamera = { zoom: camera.zoom, offsetX: camera.offsetX, offsetY: camera.offsetY };

  if (showSubPreviews && project.rootBlock) {
    const rootCamera = rootCameraFor(levelCamera, chainToRoot(pathBlocks));
    applyCamera(ctx, rootCamera, dpr);
    const visible = visibleRectFor(rootCamera, canvasWidth, canvasHeight);
    // The root level has no face anywhere to be drawn on, so its grid is
    // the whole viewport's background — drawn only when the root is
    // itself the container new blocks land in.
    if (showGrid && (gridBlockId === null || gridBlockId === project.rootBlock.id)) {
      drawGridDots(ctx, visible, rootCamera.zoom, palette);
    }
    const rootBoundary = project.rootBlock.boundaryGeometry
      ? { block: project.rootBlock, geometry: project.rootBlock.boundaryGeometry }
      : null;
    drawLevel(ctx, new LevelView(project.rootBlock), {
      zoom: rootCamera.zoom,
      palette,
      visible,
      focus,
      depth: 0,
      boundary: rootBoundary,
      showSubPreviews: true,
      flowOffset,
      requestRender,
      onDrawBlock,
    });
  } else {
    applyCamera(ctx, levelCamera, dpr);
    if (showGrid && (gridBlockId === null || gridBlockId === containerBlock?.id)) {
      drawGridDots(ctx, visibleRectFor(levelCamera, canvasWidth, canvasHeight), camera.zoom, palette);
    }
    drawLevel(ctx, project, {
      zoom: camera.zoom,
      palette,
      visible: null,
      focus,
      depth: 0,
      boundary,
      showSubPreviews: false,
      flowOffset,
      requestRender,
      onDrawBlock,
    });
  }

  // Overlays, in the coordinates of the level being edited.
  applyCamera(ctx, levelCamera, dpr);

  // A selected wire's grips (see ConnectionRenderer.drawWireGrips), drawn
  // after every block so none hides under a block its wire routes across —
  // a grip is exactly the thing being reached for. Exports pass no
  // wireSelection, so they never carry any.
  if (wireSelection) {
    const routed = focus.out.routed || routeConnections(project, boundary, wireMoveOverride, hidden);
    for (const entry of routed) {
      if (!wireSelection.isSelected(entry.connection.id)) continue;
      drawWireGrips(ctx, entry.geometry, camera.zoom, {
        fill: palette.resizeHandleFill,
        stroke: WIRE_COLOR,
        activeIndex: activeWirePiece?.connectionId === entry.connection.id ? activeWirePiece.index : null,
      });
    }
  }

  if (marqueeRect) drawMarquee(ctx, marqueeRect, camera.zoom);

  if (pendingConnectionPath) {
    drawPath(ctx, pendingConnectionPath, { color: WIRE_COLOR, dash: PREVIEW_DASH });
  }

  // The "click here to add a port" preview — drawn on top of the block it
  // belongs to, once the hover dwell has actually elapsed (see
  // DragStateMachine.getHoverGhost).
  if (hoverGhost) {
    drawPortGhost(ctx, hoverGhost.geometry, hoverGhost.side, hoverGhost.offset, palette);
  }

  // Drawn last so a remote cursor always reads on top of everything else.
  if (remoteCursors?.size) {
    drawRemoteCursors(ctx, remoteCursors, camera.zoom);
  }
}
