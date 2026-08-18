import { Project } from './model/Project.js';
import { removePort } from './model/BlockDescription.js';
import { loadProject, saveProject } from './model/store.js';
import { connectLiveSync } from './model/liveSync.js';
import { buildUpdatePayload } from './model/docSync.js';
import { appendBlocksToDoc } from './model/googleDocSync.js';
import { getAccessToken } from './model/googleAuth.js';
import { pickGoogleDoc } from './model/googlePicker.js';
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
import { ENABLE_DOC_SYNC } from './config.js';
import { mountFileToolbar } from './ui/FileToolbar.js';
import { createNameEditor } from './ui/NameEditor.js';
import { getBoundaryLabelRect } from './render/BlockRenderer.js';
import { downloadProjectFile, readProjectFile } from './model/localFile.js';
import { encodeProjectToParam, decodeProjectFromParam } from './model/shareLink.js';

const canvas = document.getElementById('scene-canvas');
const ctx = canvas.getContext('2d');
const fabEl = document.getElementById('fab-add-block');
const inspectorEl = document.getElementById('inspector');
const breadcrumbEl = document.getElementById('breadcrumb');
const backButtonEl = document.getElementById('btn-back');
const docSyncEl = document.getElementById('doc-sync');
const fileToolbarEl = document.getElementById('file-toolbar');

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
  // A diagram opened via a shared link (?d=...) is a self-contained
  // snapshot, not this browser's connection to the live server project —
  // editing it locally is fine, but it must never silently overwrite (via
  // persist()) or get overwritten by (via liveSync) whatever the server's
  // own project currently is. See model/shareLink.js.
  const sharedParam = new URLSearchParams(window.location.search).get('d');
  let project;
  let isSharedView = false;
  if (sharedParam) {
    try {
      project = Project.fromJSON(await decodeProjectFromParam(sharedParam));
      isSharedView = true;
    } catch (err) {
      window.alert(`Couldn't load the diagram from this link: ${err.message}`);
    }
  }
  if (!project) project = (await loadProject()) || new Project({ name: 'Untitled Product' });
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
    if (!isSharedView) saveProject(project);
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
    selection.select(block.id);
    persist();
    renderLoop.requestRender();
  }

  // Signs in (if needed) and opens the Google Picker so the target doc is
  // chosen from the user's actual Drive listing rather than pasted by
  // hand. Falls back to the plain URL prompt if the Picker itself can't be
  // used (not configured yet, failed to load, etc.) — the settings button
  // should never just do nothing.
  async function handleConnectDoc() {
    try {
      const token = await getAccessToken();
      const docId = await pickGoogleDoc(token);
      if (docId) {
        docSyncApi.setDocUrl(docId);
        docSyncApi.setStatus('connected');
      }
    } catch (err) {
      docSyncApi.promptForUrl();
    }
  }

  // The only thing that reaches Google: renders a fresh diagram per level
  // and appends every block's current description + diagram to the end of
  // the target Doc. Nothing above where this appends is ever read or
  // touched. The button itself stays disabled until a doc is connected
  // (see DocSyncPanel's refreshConnectedState), so this guard is just
  // defense against a stale/programmatic call.
  async function handleUpdateDoc() {
    const url = docSyncApi.getDocUrl();
    if (!url) return;
    docSyncApi.setStatus('updating');
    try {
      const result = await appendBlocksToDoc(url, buildUpdatePayload(project));
      docSyncApi.setStatus('updated', `${result.updated} block${result.updated === 1 ? '' : 's'}`);
    } catch (err) {
      docSyncApi.setStatus('error', err.message);
    }
  }

  let breadcrumbApi = null;

  function updateNavigationUI() {
    breadcrumbApi?.refresh();
    // Always available: one level up when there is one, otherwise the
    // offer to wrap the whole product in a new parent.
    const atRoot = project.path.length === 0;
    backButtonEl.textContent = atRoot ? '+' : '‹';
    backButtonEl.title = atRoot ? 'Create a parent for this system' : 'Go to parent';
    backButtonEl.setAttribute('aria-label', backButtonEl.title);
  }

  // Navigation is deliberately not persisted — reloading always starts back
  // at the product root, like most apps default to a home view. Each level
  // is framed on its own content, since a child level's blocks generally
  // sit nowhere near the parent's coordinates.
  // Navigating usually also clears the selection, which hides the
  // inspector and resizes the canvas. The canvas can report a stale size
  // for a frame or more while that settles (observed: a 1280x977 box in an
  // 800px-tall window), which would center the view on the wrong spot — so
  // framing is applied right away *and* re-applied by resizeCanvas above
  // for a short window afterwards, letting the settled size win.
  const FRAME_SETTLE_MS = 300;
  let framingUntil = 0;

  function applyLevelFraming() {
    if (performance.now() > framingUntil) return;
    camera.centerOn(project.getLevelBounds(), canvas.clientWidth, canvas.clientHeight);
  }

  function frameCurrentLevel() {
    framingUntil = performance.now() + FRAME_SETTLE_MS;
    applyLevelFraming();
  }

  function enterBlock(blockId) {
    if (!project.enterBlock(blockId)) return;
    selection.clear();
    wireSelection.clear();
    frameCurrentLevel();
    updateNavigationUI();
    persist();
    renderLoop.requestRender();
  }

  function navigateToDepth(depth) {
    project.exitToDepth(depth);
    selection.clear();
    wireSelection.clear();
    frameCurrentLevel();
    updateNavigationUI();
    persist();
    renderLoop.requestRender();
  }

  // "This system is actually a component of something bigger" — wraps the
  // product in a new top level, keeping the view on the content already
  // onscreen (now one level deeper) rather than jumping into the new,
  // nearly-empty parent.
  function createParent() {
    project.createParent();
    selection.clear();
    wireSelection.clear();
    updateNavigationUI();
    persist();
    renderLoop.requestRender();
  }

  // Opens the inline editor over whichever name was clicked: a block's own
  // centered title, or — for the block you're currently inside — the
  // boundary frame's label above its top-left corner.
  function openRename(blockId) {
    const block = project.getBlock(blockId);
    if (!block) return;
    const container = project.getContainerBlock();
    const isContainer = container?.id === blockId;
    const worldRect = isContainer
      ? getBoundaryLabelRect(block, container.boundaryGeometry)
      : block.geometry;

    const topLeft = camera.worldToScreen(worldRect.x, worldRect.y);
    const canvasRect = canvas.getBoundingClientRect();
    nameEditor.open(blockId, block.name, {
      x: canvasRect.left + topLeft.x,
      y: canvasRect.top + topLeft.y,
      width: worldRect.width * camera.zoom,
      height: worldRect.height * camera.zoom,
    });
  }

  const nameEditor = createNameEditor({
    onCommit: (blockId, name) => {
      const block = project.getBlock(blockId);
      if (!block) return;
      block.name = name;
      persist();
      renderLoop.requestRender();
    },
  });

  function handleSaveFile() {
    downloadProjectFile(project);
  }

  // A shareable link, not a save — the whole diagram packed into the URL's
  // own ?d= param (see model/shareLink.js), so opening it needs nothing
  // but a browser: no server, no account. Shown via prompt() (pre-filled
  // and selected) rather than copied silently, so there's always something
  // visible to confirm it actually worked.
  async function handleExportLink() {
    let encoded;
    try {
      encoded = await encodeProjectToParam(project);
    } catch (err) {
      window.alert(`Couldn't create a share link: ${err.message}`);
      return;
    }
    const url = `${window.location.origin}${window.location.pathname}?d=${encoded}`;
    window.prompt('Shareable link for this diagram:', url);
  }

  // Opening a local file replaces the whole tree the same way a pushed
  // remote update does (see applyRemoteProject below) — just triggered
  // locally instead of over the WebSocket. The loaded project is
  // immediately persisted to the server too, same as any other change.
  async function handleOpenFile(file) {
    let data;
    try {
      data = await readProjectFile(file);
    } catch (err) {
      window.alert(`Couldn't open that file: ${err.message}`);
      return;
    }
    project.applyRemoteRootBlock(data.rootBlock);
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
      hoverGhost: stateMachine.getHoverGhost(),
    });
  }

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    // A resize right after navigating means the framing below was computed
    // against a canvas that hadn't settled yet — redo it now that it has.
    applyLevelFraming();
    renderLoop.requestRender();
  }

  // A shared-link view has nothing to do with the server's live project —
  // connecting would just overwrite this snapshot with whatever's actually
  // on the server the moment anyone else saves.
  const liveSync = isSharedView
    ? { sendLive: () => {} }
    : connectLiveSync({ onProject: applyRemoteProject, onLive: applyLiveUpdate });

  const stateMachine = new DragStateMachine({
    camera,
    project,
    selection,
    wireSelection,
    requestRender: () => renderLoop.requestRender(),
    persist,
    onEnterBlock: enterBlock,
    onRequestRename: openRename,
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
  });

  breadcrumbApi = mountBreadcrumb(breadcrumbEl, { project, onNavigate: navigateToDepth });
  backButtonEl.addEventListener('click', () => {
    if (project.path.length === 0) createParent();
    else navigateToDepth(project.path.length - 1);
  });

  // Doc sync is parked behind a flag (see config.js) — the handlers above
  // stay wired so flipping the flag is the only step to bring it back.
  if (ENABLE_DOC_SYNC) {
    docSyncApi = mountDocSync(docSyncEl, { onUpdate: handleUpdateDoc, onConnect: handleConnectDoc });
  }
  mountFileToolbar(fileToolbarEl, { onSave: handleSaveFile, onOpen: handleOpenFile, onExportLink: handleExportLink });

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
  // Framed once the canvas has real dimensions — same treatment a level
  // gets when you navigate into it, so a freshly-opened project (or a
  // shared link) starts centered rather than wherever world 0,0 happens
  // to land.
  frameCurrentLevel();
  updateNavigationUI();
  renderLoop.start();
}

bootstrap();
