import { Project } from './model/Project.js';
import { removePort } from './model/BlockDescription.js';
import { DEFAULT_BLOCK_COLOR } from './model/Block.js';
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
import { createShareDialog } from './ui/ShareDialog.js';
import { mountSelectionFabs } from './ui/SelectionFabs.js';
import { renderCurrentLevelDataUrl, renderCurrentLevelBlob } from './model/diagramImage.js';
import { getBoundaryLabelRect } from './render/BlockRenderer.js';
import { downloadProjectFile, readProjectFile } from './model/localFile.js';
import { encodeProjectToParam, decodeProjectFromParam } from './model/shareLink.js';
import { serializeSelection, pasteSelection, isClipboardPayload } from './model/clipboard.js';
import { History } from './model/History.js';
import { createPeerSession } from './model/peerSession.js';

const canvas = document.getElementById('scene-canvas');
const ctx = canvas.getContext('2d');
const fabEl = document.getElementById('fab-add-block');
const inspectorEl = document.getElementById('inspector');
const breadcrumbEl = document.getElementById('breadcrumb');
const parentFabEl = document.getElementById('fab-parent');
const parentUpIconEl = parentFabEl.querySelector('[data-icon="up"]');
const parentAddIconEl = parentFabEl.querySelector('[data-icon="add-parent"]');
const docSyncEl = document.getElementById('doc-sync');
const fileToolbarEl = document.getElementById('file-toolbar');
const fabStackEl = document.getElementById('fab-stack');

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
  let fileToolbarApi = null;
  let selectionFabsApi = null;
  // The diagram the address bar currently encodes, or null when it encodes
  // none — which is how "Save" knows whether there is anything to save.
  // A page opened from a link starts out already saved, by definition.
  let urlSnapshot = isSharedView ? JSON.stringify(project.toJSON()) : null;
  // Assigned further down, once applyRemoteProject/applyLiveUpdate exist —
  // declared here so persist() can reach it without a dead-zone error.
  let peerSession = null;

  const history = new History({ json: lastSyncedSnapshot, path: [] });

  function persist() {
    lastSyncedSnapshot = JSON.stringify(project.toJSON());
    // Recorded here because every edit already ends in a persist() — and
    // only here, so a drag is one history entry rather than one per
    // pointer move. Identical snapshots (navigating a level, say) are
    // dropped by History itself.
    history.record({ json: lastSyncedSnapshot, path: [...project.path] });
    fileToolbarApi?.refreshHistory();
    if (!isSharedView) saveProject(project);
    // The tab title is what a bookmark gets named, so it has to be the
    // diagram's name rather than the app's.
    document.title = project.name ? `${project.name} · noditron` : 'noditron';
    fileToolbarApi?.refreshSaved(urlSnapshot === null ? null : urlSnapshot === lastSyncedSnapshot);
    // Peers get the whole tree; applyRemoteProject on the far side drops
    // it if it matches what they already have, so this can't loop.
    broadcastToPeers({ type: 'project', data: JSON.parse(lastSyncedSnapshot) });
    inspectorApi?.refresh();
  }

  // Restores a snapshot: the tree, and the level you were viewing when it
  // was taken. Setting `path` first lets applyRemoteRootBlock trim it to
  // whatever still resolves, in case the undone state didn't have that
  // block. The persist() at the end saves and refreshes; History drops its
  // own snapshot as a duplicate, so undoing never appends to the stack.
  function applyHistoryEntry(entry) {
    if (!entry) return;
    project.path = [...entry.path];
    project.applyRemoteRootBlock(JSON.parse(entry.json).rootBlock);
    selection.clear();
    wireSelection.clear();
    updateNavigationUI();
    frameCurrentLevel();
    persist();
    renderLoop.requestRender();
  }

  function undo() {
    applyHistoryEntry(history.undo());
  }

  function redo() {
    applyHistoryEntry(history.redo());
  }

  function deleteBlock(blockId) {
    project.removeBlock(blockId);
    if (selection.selectedBlockId === blockId) selection.clear();
    persist();
    renderLoop.requestRender();
  }

  function deleteSelectedBlocks() {
    for (const id of selection.list()) project.removeBlock(id);
    selection.clear();
    persist();
    renderLoop.requestRender();
  }

  function deleteSelectedWires() {
    for (const id of wireSelection.list()) project.removeConnection(id);
    wireSelection.clear();
    persist();
    renderLoop.requestRender();
  }

  // What the delete FAB acts on: whichever kind of thing is currently
  // selected. Wires go without a prompt (a wire is one fact, and undo is a
  // click away); blocks ask first, since deleting one takes its whole
  // sub-architecture and every wire touching it with it.
  function deleteSelection() {
    if (wireSelection.list().length > 0) {
      deleteSelectedWires();
      return;
    }
    // A selected port is a selection *within* the selected block, so it
    // wins over the block it belongs to — otherwise picking a port and
    // pressing delete would take the whole block.
    if (selection.selectedPortId) {
      deleteSelectedPort();
      return;
    }
    if (selection.count > 1) {
      if (window.confirm(`Delete ${selection.count} blocks and their connections?`)) deleteSelectedBlocks();
      return;
    }
    const block = project.getBlock(selection.selectedBlockId);
    if (block && window.confirm(`Delete "${block.name}" and its connections?`)) deleteBlock(block.id);
  }

  // `color` of null means "back to the default", which is stored as the
  // absence of a color rather than as the default's own hex — so a diagram
  // nobody has recolored carries no color data at all, and changing the
  // default later still reaches it.
  function colorSelection(color) {
    for (const connectionId of wireSelection.list()) {
      const connection = project.getConnection(connectionId);
      if (!connection) continue;
      if (color) connection.color = color;
      else delete connection.color;
    }
    for (const blockId of selection.list()) {
      const block = project.getBlock(blockId);
      if (block) block.style = { ...block.style, color: color || DEFAULT_BLOCK_COLOR };
    }
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
    // style.display rather than the `hidden` attribute: `hidden` is an
    // HTMLElement property and these are SVG elements, where assigning it
    // just sets a JS expando and leaves both icons drawn on top of each
    // other.
    parentUpIconEl.style.display = atRoot ? 'none' : '';
    parentAddIconEl.style.display = atRoot ? '' : 'none';
    parentFabEl.title = atRoot ? 'Create a parent for this system' : 'Go to parent';
    parentFabEl.setAttribute('aria-label', parentFabEl.title);
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

  // Marching dashes along every wire, to show which way things flow. Purely
  // a way of looking at the diagram: nothing about it is stored, shared or
  // undoable, so it lives here as a plain flag rather than in the project.
  const FLOW_SPEED = 55; // world units per second
  let animating = false;

  function toggleAnimation() {
    animating = !animating;
    // The render loop is dirty-gated, and an animation has no edit to hang
    // a redraw off — so it asks the loop to keep running while it lasts.
    renderLoop.setContinuous(animating);
    fileToolbarApi?.refreshAnimating(animating);
    renderLoop.requestRender();
  }

  function handleSaveFile() {
    downloadProjectFile(project);
  }

  // "Saving" here means writing the diagram into the page's own address:
  // there is no server document to update and no account to store one
  // under, so the URL is the file (see model/shareLink.js). replaceState
  // rather than pushState — the Back button is for leaving the page, not
  // for stepping through saves, which is what undo is for.
  async function handleSaveToUrl() {
    let url;
    try {
      url = await buildShareUrl();
    } catch (err) {
      return { ok: false, error: err.message };
    }
    window.history.replaceState(null, '', url);
    urlSnapshot = lastSyncedSnapshot;
    fileToolbarApi?.refreshSaved(true);
    return { ok: true, length: url.length };
  }

  // A shareable link, not a save — the whole diagram packed into the URL's
  // own ?d= param (see model/shareLink.js), so opening it needs nothing
  // but a browser: no server, no account.
  async function buildShareUrl() {
    const encoded = await encodeProjectToParam(project);
    return `${window.location.origin}${window.location.pathname}?d=${encoded}`;
  }

  const shareDialog = createShareDialog({
    getShareUrl: async () => {
      try {
        return await buildShareUrl();
      } catch (err) {
        return `Couldn't create a share link: ${err.message}`;
      }
    },
    renderImage: async () => ({
      dataUrl: renderCurrentLevelDataUrl(project),
      blob: await renderCurrentLevelBlob(project),
    }),
    // The level you're looking at is the thing the figure depicts, so its
    // name is what the figure's description should say.
    getFigureName: () => project.getContainerBlock()?.name || project.name,
    session: {
      getState: () => peerSession?.getState() || { state: 'idle', peers: 0 },
      stop: () => peerSession.stop(),
    },
  });

  // Starting a session is a banner action (see ui/FileToolbar.js); the
  // Share dialog is where the invite link and the participant count live
  // once it is running, so starting opens it there.
  async function handleSession() {
    if (peerSession.getState().state === 'live') {
      shareDialog.open('Live session');
      return;
    }
    try {
      const sessionId = await peerSession.host();
      // The invite carries the diagram as well as the session id, so a
      // guest still sees it if the peer connection can't be established.
      shareDialog.setInviteUrl(`${await buildShareUrl()}&join=${encodeURIComponent(sessionId)}`);
    } catch (err) {
      fileToolbarApi?.refreshSession(peerSession.getState());
      window.alert(`Couldn't start a live session: ${err.message}`);
      return;
    }
    shareDialog.open('Live session');
  }

  function handleExportLink() {
    shareDialog.open();
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

  function selectionCount() {
    return selection.count + wireSelection.list().length;
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
    // Block selection has an observer; the wire selection deliberately
    // doesn't (see WireSelection), and every change to either already ends
    // in a render. Refreshing here therefore covers both, and refresh()
    // itself no-ops unless the count actually moved.
    selectionFabsApi?.refresh();
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
      selectedBlockIds: selection.selectedBlockIds,
      wireSelection,
      remoteCursors: visibleRemoteCursors(),
      hoverGhost: stateMachine.getHoverGhost(),
      marqueeRect: stateMachine.getMarqueeRect(),
      // Derived from the clock rather than counted in frames, so the
      // dashes travel at the same speed on any refresh rate. Negative
      // because a decreasing offset moves them along the path's own
      // direction, which runs output to input.
      flowOffset: animating ? -(performance.now() / 1000) * FLOW_SPEED : null,
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
  // Peer messages carry the same shapes liveSync uses, so they route into
  // exactly the same handlers.
  peerSession = createPeerSession({
    onMessage: (message) => {
      if (message?.type === 'project') applyRemoteProject(message.data);
      else if (message?.type === 'live') applyLiveUpdate(message);
    },
    onStatus: (status) => {
      // A guest that has just opened its channel needs the current
      // diagram; nothing else would send it one until the next edit.
      if (status.joined) {
        peerSession.sendTo(status.joined, { type: 'project', data: project.toJSON() });
      }
      shareDialog.refreshSession?.(status);
      fileToolbarApi?.refreshSession(status);
    },
  });

  function broadcastToPeers(message) {
    if (peerSession?.isActive()) peerSession.send(message);
  }

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
    onLiveUpdate: (message) => {
      liveSync.sendLive(message);
      broadcastToPeers({ type: 'live', ...message });
    },
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
    const cursor = { kind: 'cursor', clientId, x: world.x, y: world.y, path: project.path };
    liveSync.sendLive(cursor);
    broadcastToPeers({ type: 'live', ...cursor });
  });
  canvas.addEventListener('pointerleave', () => {
    liveSync.sendLive({ kind: 'cursor-leave', clientId });
    broadcastToPeers({ type: 'live', kind: 'cursor-leave', clientId });
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
  parentFabEl.addEventListener('click', () => {
    if (project.path.length === 0) createParent();
    else navigateToDepth(project.path.length - 1);
  });

  // Doc sync is parked behind a flag (see config.js) — the handlers above
  // stay wired so flipping the flag is the only step to bring it back.
  if (ENABLE_DOC_SYNC) {
    docSyncApi = mountDocSync(docSyncEl, { onUpdate: handleUpdateDoc, onConnect: handleConnectDoc });
  }
  fileToolbarApi = mountFileToolbar(fileToolbarEl, {
    onSaveUrl: handleSaveToUrl,
    onSave: handleSaveFile,
    onOpen: handleOpenFile,
    onExportLink: handleExportLink,
    onSession: handleSession,
    onAnimate: toggleAnimation,
    onUndo: undo,
    onRedo: redo,
    canUndo: () => history.canUndo,
    canRedo: () => history.canRedo,
  });
  fileToolbarApi.refreshHistory();
  fileToolbarApi.refreshSession(peerSession.getState());
  fileToolbarApi.refreshSaved(urlSnapshot === null ? null : true);
  fileToolbarApi.refreshAnimating(animating);
  document.title = project.name ? `${project.name} · noditron` : 'noditron';

  // A diagram opened from a link lives nowhere but this tab until it is
  // saved back into the address bar, so closing with unsaved edits loses
  // them outright. A server-backed one is already on the server, and gets
  // no prompt — a confirmation dialog that fires when nothing is at stake
  // is one people learn to dismiss without reading.
  window.addEventListener('beforeunload', (event) => {
    if (!isSharedView || urlSnapshot === lastSyncedSnapshot) return;
    event.preventDefault();
    event.returnValue = '';
  });

  selectionFabsApi = mountSelectionFabs(fabStackEl, {
    getSelectionCount: selectionCount,
    onDelete: deleteSelection,
    onColor: colorSelection,
  });
  selectionFabsApi.refresh();

  // Delete/Backspace removes the selected block or wire(s), but only when
  // focus isn't in a text field — otherwise editing the Name field or
  // description would delete something out from under you.
  window.addEventListener('keydown', (event) => {
    if (event.key !== 'Delete' && event.key !== 'Backspace') return;
    const tag = document.activeElement?.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT') return;

    if (selectionCount() === 0) return;
    event.preventDefault();
    deleteSelection();
  });

  window.addEventListener('keydown', (event) => {
    if (!(event.ctrlKey || event.metaKey)) return;
    const key = event.key.toLowerCase();

    // Ctrl/Cmd+S is claimed even while typing: it saves the diagram, which
    // is worth doing mid-rename, and the browser's own "save this page"
    // dialog is never what someone wants here.
    if (key === 's') {
      event.preventDefault();
      fileToolbarApi?.triggerSave();
      return;
    }

    // Ctrl+Y is the Windows redo; Ctrl/Cmd+Shift+Z is the one everywhere
    // else. Both are offered rather than picking a side.
    if (key !== 'z' && key !== 'y') return;
    // Text fields have their own undo stack; hijacking it while someone is
    // renaming a block would be worse than not offering the shortcut.
    if (editingText()) return;
    event.preventDefault();
    if (key === 'y' || event.shiftKey) redo();
    else undo();
  });

  // Copy/paste rides the browser's own copy/paste events rather than the
  // async clipboard API: those fire on Ctrl/Cmd+C and +V without any
  // permission prompt, and they hand over the clipboard data directly.
  // Writing the selection as JSON text also means it survives being pasted
  // into another tab, or into a text editor to inspect.
  function editingText() {
    const tag = document.activeElement?.tagName;
    return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT';
  }

  document.addEventListener('copy', (event) => {
    if (editingText() || selection.count === 0) return;
    event.preventDefault();
    event.clipboardData.setData('text/plain', JSON.stringify(serializeSelection(project, selection.list())));
  });

  document.addEventListener('paste', (event) => {
    if (editingText()) return;
    let payload;
    try {
      payload = JSON.parse(event.clipboardData.getData('text/plain'));
    } catch {
      return; // Not ours — leave whatever else was copied alone.
    }
    if (!isClipboardPayload(payload)) return;
    event.preventDefault();

    const newIds = pasteSelection(project, payload);
    if (!newIds.length) return;
    // Selecting the copies means the obvious next move — dragging them
    // where you want them — works immediately.
    selection.selectMany(newIds);
    persist();
    renderLoop.requestRender();
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

  // An invite link (?join=) carries the diagram too, so the guest already
  // has something on screen; joining then upgrades it to a live session.
  // A failure here is worth surfacing — a corporate firewall blocking
  // WebRTC is exactly the case where silence would be baffling.
  const joinId = new URLSearchParams(window.location.search).get('join');
  if (joinId) {
    peerSession.join(joinId).catch((err) => {
      window.alert(`Couldn't join the live session: ${err.message}\nYou can still edit this copy of the diagram.`);
    });
  }
}

bootstrap();
