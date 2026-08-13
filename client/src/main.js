import { Project } from './model/Project.js';
import { touchBlock } from './model/Block.js';
import { removePort } from './model/BlockDescription.js';
import { loadProject, saveProject } from './model/store.js';
import { connectLiveSync } from './model/liveSync.js';
import { buildUpdatePayload, updateDoc, buildRegionSnippet } from './model/docSync.js';
import { Camera } from './render/Camera.js';
import { RenderLoop } from './render/RenderLoop.js';
import { renderScene } from './render/SceneRenderer.js';
import { SelectionManager } from './interaction/SelectionManager.js';
import { WireSelection } from './interaction/WireSelection.js';
import { DragStateMachine } from './interaction/DragStateMachine.js';
import { attachInputRouter } from './interaction/InputRouter.js';
import { mountToolbar } from './ui/Toolbar.js';
import { mountInspector } from './ui/InspectorPanel.js';
import { mountBreadcrumb } from './ui/Breadcrumb.js';
import { mountDocSync } from './ui/DocSyncPanel.js';

const canvas = document.getElementById('scene-canvas');
const ctx = canvas.getContext('2d');
const fabEl = document.getElementById('fab-add-block');
const inspectorEl = document.getElementById('inspector');
const breadcrumbEl = document.getElementById('breadcrumb');
const backButtonEl = document.getElementById('btn-back');
const docSyncEl = document.getElementById('doc-sync');

// A per-tab identity purely for telling cursors apart on other clients'
// screens — there's no accounts system to draw a real name from yet.
const clientId = crypto.randomUUID();

function pathsEqual(a, b) {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

// Loading now means a network round-trip to the data server (see
// model/store.js), so the rest of setup — everything that touches
// `project` — waits inside here instead of running at module top level.
async function bootstrap() {
  const project = (await loadProject()) || new Project({ name: 'Untitled Product' });
  if (project.listBlocks().length === 0) {
    project.createDefaultBlock(80, 80);
  }

  const camera = new Camera();
  const selection = new SelectionManager();
  const wireSelection = new WireSelection();
  const renderLoop = new RenderLoop(draw);

  // clientId -> { x, y, path, lastSeen } — path is the hierarchy level the
  // cursor was reported from, so a cursor from a level you're not currently
  // looking at doesn't show up superimposed on unrelated blocks. Pruned by
  // age rather than an explicit "they disconnected" message, since the
  // server doesn't track which socket belongs to which clientId.
  const remoteCursors = new Map();
  const CURSOR_STALE_MS = 5000;
  let lastCursorSentAt = 0;

  // Tracks what the server should already contain, so a pushed update (see
  // liveSync below) can tell "someone else changed it" apart from "that's
  // just my own last save echoed back" without waiting on a round trip.
  let lastSyncedSnapshot = JSON.stringify(project.toJSON());

  let inspectorApi = null;
  let docSyncApi = null;

  function persist() {
    lastSyncedSnapshot = JSON.stringify(project.toJSON());
    saveProject(project);
    inspectorApi?.refresh();
  }

  function deleteBlock(blockId) {
    project.removeBlock(blockId);
    if (selection.selectedBlockId === blockId) selection.clear();
    persist();
    renderLoop.requestRender();
  }

  function deleteSelectedWires() {
    for (const id of wireSelection.list()) project.removeConnection(id);
    wireSelection.clear();
    persist();
    renderLoop.requestRender();
  }

  function deleteSelectedPort() {
    const block = project.getBlock(selection.selectedBlockId);
    const portId = selection.selectedPortId;
    if (!block || !portId) return;
    removePort(block, portId);
    project.removeConnectionsForPort(portId);
    touchBlock(block);
    selection.select(block.id);
    persist();
    renderLoop.requestRender();
  }

  // The only thing that reaches Google: renders a fresh diagram per level
  // and pushes every block's current description + diagram. Apps Script
  // finds whichever blocks actually have a region placed in the Doc and
  // updates just those in place; anything without a region is skipped, and
  // everything outside every region — the user's own writing — is never
  // touched (see appsscript/Code.gs).
  async function handleUpdateDoc() {
    const url = docSyncApi.getWebAppUrl();
    if (!url) {
      docSyncApi.promptForUrl();
      return;
    }
    docSyncApi.setStatus('updating');
    try {
      const result = await updateDoc(url, buildUpdatePayload(project));
      docSyncApi.setStatus('updated', `${result.updated.length} region${result.updated.length === 1 ? '' : 's'}`);
    } catch (err) {
      docSyncApi.setStatus('error', err.message);
    }
  }

  // Copies a ready-to-paste region snippet for one block to the clipboard —
  // the only practical way to get its real (internal, unguessable) id into
  // the Doc, since regions are placed by hand, not auto-inserted.
  async function copyDocRegionSnippet(blockId) {
    const block = project.getBlock(blockId);
    if (!block) return;
    await navigator.clipboard.writeText(buildRegionSnippet(block));
  }

  let breadcrumbApi = null;

  function updateNavigationUI() {
    breadcrumbApi?.refresh();
    backButtonEl.hidden = project.path.length === 0;
  }

  // Navigation is deliberately not persisted — reloading always starts back
  // at the product root, like most apps default to a home view.
  function resetCameraForNewLevel() {
    camera.offsetX = 0;
    camera.offsetY = 0;
    camera.zoom = 1;
  }

  function enterBlock(blockId) {
    if (!project.enterBlock(blockId)) return;
    selection.clear();
    wireSelection.clear();
    resetCameraForNewLevel();
    updateNavigationUI();
    persist();
    renderLoop.requestRender();
  }

  function navigateToDepth(depth) {
    project.exitToDepth(depth);
    selection.clear();
    wireSelection.clear();
    resetCameraForNewLevel();
    updateNavigationUI();
    persist();
    renderLoop.requestRender();
  }

  // A full, persisted change pushed from another client — replaces the
  // whole tree, so it's held back while this client is itself mid-drag or
  // mid-typing (that unsaved local change has no representation in the
  // incoming snapshot and would otherwise just vanish).
  function applyRemoteProject(data) {
    if (!stateMachine.isIdle()) return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    const incoming = JSON.stringify(data);
    if (incoming === lastSyncedSnapshot) return;

    lastSyncedSnapshot = incoming;
    project.applyRemoteRootBlock(data.rootBlock);
    selection.clear();
    wireSelection.clear();
    updateNavigationUI();
    renderLoop.requestRender();
  }

  // An in-progress drag from another client — patches just the one thing
  // that moved, never the whole tree, so it's safe to apply immediately
  // even while this client is dragging something else of its own (or, for
  // that matter, the same thing — last write simply wins, same as a save).
  function applyLiveUpdate(message) {
    if (message.kind === 'block') {
      const block = project.getBlock(message.blockId);
      if (block) Object.assign(block.geometry, message.geometry);
    } else if (message.kind === 'port') {
      const block = project.getBlock(message.blockId);
      const port = block?.ports.find((p) => p.id === message.portId);
      if (port) {
        port.side = message.side;
        port.offset = message.offset;
      }
    } else if (message.kind === 'connection') {
      const connection = project.getConnection(message.connectionId);
      if (connection) connection.manualBend = message.manualBend;
    } else if (message.kind === 'boundary') {
      const block = project.getBlock(message.blockId);
      if (block?.boundaryGeometry) Object.assign(block.boundaryGeometry, message.boundaryGeometry);
    } else if (message.kind === 'cursor') {
      remoteCursors.set(message.clientId, { x: message.x, y: message.y, path: message.path, lastSeen: Date.now() });
    } else if (message.kind === 'cursor-leave') {
      remoteCursors.delete(message.clientId);
    }
    renderLoop.requestRender();
  }

  function visibleRemoteCursors() {
    const now = Date.now();
    const visible = new Map();
    for (const [id, cursor] of remoteCursors) {
      if (now - cursor.lastSeen > CURSOR_STALE_MS) {
        remoteCursors.delete(id);
        continue;
      }
      if (pathsEqual(cursor.path, project.path)) visible.set(id, cursor);
    }
    return visible;
  }

  function draw() {
    const dpr = window.devicePixelRatio || 1;
    const dragHighlights = stateMachine.getConnectionDragHighlights();
    renderScene(ctx, camera, project, {
      selectedBlockId: selection.selectedBlockId,
      selectedPortId: selection.selectedPortId,
      dpr,
      canvasWidth: canvas.clientWidth,
      canvasHeight: canvas.clientHeight,
      pendingConnectionPath: stateMachine.getPendingConnectionVisual(),
      connectionSource: dragHighlights.source,
      connectionTarget: dragHighlights.target,
      wireSelection,
      remoteCursors: visibleRemoteCursors(),
    });
  }

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    renderLoop.requestRender();
  }

  const liveSync = connectLiveSync({ onProject: applyRemoteProject, onLive: applyLiveUpdate });

  const stateMachine = new DragStateMachine({
    camera,
    project,
    selection,
    wireSelection,
    requestRender: () => renderLoop.requestRender(),
    persist,
    onEnterBlock: enterBlock,
    onLiveUpdate: (message) => liveSync.sendLive(message),
  });

  attachInputRouter(canvas, camera, stateMachine);
  selection.onChange(() => renderLoop.requestRender());

  // Broadcasts where this client's own pointer is, independent of whatever
  // DragStateMachine is doing with it — a plain hover should show up on
  // other clients too, not just an active drag. Throttled to a modest rate;
  // a raw mousemove firing every few milliseconds is far more than needed
  // for another person to read where your cursor is.
  const CURSOR_SEND_INTERVAL_MS = 40;
  canvas.addEventListener('pointermove', (event) => {
    const now = Date.now();
    if (now - lastCursorSentAt < CURSOR_SEND_INTERVAL_MS) return;
    lastCursorSentAt = now;
    const rect = canvas.getBoundingClientRect();
    const world = camera.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    liveSync.sendLive({ kind: 'cursor', clientId, x: world.x, y: world.y, path: project.path });
  });
  canvas.addEventListener('pointerleave', () => {
    liveSync.sendLive({ kind: 'cursor-leave', clientId });
  });

  // Pure hygiene: without some activity to trigger a redraw, a cursor that
  // goes stale (its owner closed the tab) would just sit there forever
  // instead of fading out within CURSOR_STALE_MS.
  setInterval(() => renderLoop.requestRender(), 1000);

  mountToolbar(fabEl, {
    project,
    camera,
    canvas,
    selection,
    requestRender: () => renderLoop.requestRender(),
    persist,
  });

  inspectorApi = mountInspector(inspectorEl, {
    project,
    selection,
    requestRender: () => renderLoop.requestRender(),
    persist,
    deleteBlock,
    enterBlock,
    copyDocRegionSnippet,
  });

  breadcrumbApi = mountBreadcrumb(breadcrumbEl, { project, onNavigate: navigateToDepth });
  backButtonEl.addEventListener('click', () => navigateToDepth(project.path.length - 1));

  docSyncApi = mountDocSync(docSyncEl, { onUpdate: handleUpdateDoc });

  // Delete/Backspace removes the selected block or wire(s), but only when
  // focus isn't in a text field — otherwise editing the Name field or
  // description would delete something out from under you.
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (wireSelection.list().length > 0) {
      event.preventDefault();
      deleteSelectedWires();
      return;
    }

    if (selection.selectedPortId) {
      event.preventDefault();
      deleteSelectedPort();
      return;
    }

    if (!selection.selectedBlockId) return;
    event.preventDefault();
    const block = project.getBlock(selection.selectedBlockId);
    if (block && window.confirm(`Delete "${block.name}" and its connections? This can't be undone.`)) {
      deleteBlock(block.id);
    }
  });

  // Synchronous initial call covers the normal case (layout is already settled
  // by the time this runs); ResizeObserver covers window resizes and any
  // layout pass still mid-flight in edge cases.
  resizeCanvas();
  new ResizeObserver(resizeCanvas).observe(canvas);
  renderLoop.start();
}

bootstrap();
