import { Project } from './model/Project.js';
import { removePort } from './model/BlockDescription.js';
import { createDefaultDiagram } from './model/defaultDiagram.js';
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
import { mountHeaderActions } from './ui/HeaderActions.js';
import { mountAppMenu } from './ui/AppMenu.js';
import { mountTopbarMenu } from './ui/TopbarMenu.js';
import { createNameEditor } from './ui/NameEditor.js';
import { createShareLinkDialog } from './ui/ShareLinkDialog.js';
import { createGoogleDocsExportDialog } from './ui/GoogleDocsExportDialog.js';
import { createLiveSessionDialog } from './ui/LiveSessionDialog.js';
import { mountSelectionFabs } from './ui/SelectionFabs.js';
import { mountOnlineUsers } from './ui/OnlineUsers.js';
import { showToast } from './ui/Toast.js';
import { maybeShowOnboarding } from './ui/Onboarding.js';
import { renderCurrentLevelDataUrl, renderCurrentLevelBlob } from './model/diagramImage.js';
import { getBoundaryLabelRect } from './render/BlockRenderer.js';
import { getConnectionGeometry, getConnectionLabelPosition } from './render/ConnectionRenderer.js';
import { downloadProjectFile, readProjectFile, safeFileStem } from './model/localFile.js';
import { downloadCurrentLevelSvg, renderCurrentLevelSvgBlob } from './model/diagramSvg.js';
import { encodeProjectToParam, decodeProjectFromParam } from './model/shareLink.js';
import { serializeSelection, pasteSelection, isClipboardPayload } from './model/clipboard.js';
import { History } from './model/History.js';
import { createPeerSession } from './model/peerSession.js';
import { initTheme, getTheme, setTheme } from './theme.js';

// Applied before bootstrap() (which awaits a network round-trip) so there's
// no flash of the wrong theme while the rest of the app is still loading.
initTheme();

const canvas = document.getElementById('scene-canvas');
const ctx = canvas.getContext('2d');
const fabEl = document.getElementById('fab-add-block');
const textFabEl = document.getElementById('fab-add-text');
const inspectorEl = document.getElementById('inspector');
const breadcrumbEl = document.getElementById('breadcrumb');
const parentFabEl = document.getElementById('fab-parent');
const parentUpIconEl = parentFabEl.querySelector('[data-icon="up"]');
const parentAddIconEl = parentFabEl.querySelector('[data-icon="add-parent"]');
const docSyncEl = document.getElementById('doc-sync');
const appMenuEl = document.getElementById('app-menu');
const headerActionsEl = document.getElementById('header-actions');
const onlineUsersEl = document.getElementById('online-users');
const fabStackEl = document.getElementById('fab-stack');
const menuToggleEl = document.getElementById('menu-toggle');
const inspectorToggleEl = document.getElementById('inspector-toggle');
const topbarMenuEl = document.getElementById('topbar-menu');
const topbarMenuBackdropEl = document.getElementById('topbar-menu-backdrop');

mountTopbarMenu(menuToggleEl, topbarMenuEl, topbarMenuBackdropEl);

// A per-tab identity purely for telling cursors apart on other clients'
// screens — there's no accounts system to draw a real name from yet.
const clientId = crypto.randomUUID();

function pathsEqual(a, b) {
  return a.length === b.length && a.every((id, i) => id === b[i]);
}

// Loading now means a network round-trip to the data server (see
// model/store.js), so the rest of setup — everything that touches
// `project` — waits inside here instead of running at module top level.
// Bumped on every change to the port-resize/boundary-port work — a quick
// way to confirm from the console that a hard refresh actually picked up
// the latest code, rather than assuming it based on a "did you refresh"
// answer. Check with: window.__ndVersion
if (typeof window !== 'undefined') window.__ndVersion = 'port-resize-2026-08-25-m';

async function bootstrap() {
  // A diagram opened via a shared link (?d=...) is a self-contained
  // snapshot, not this browser's connection to the live server project —
  // editing it locally is fine, but it must never silently overwrite (via
  // persist()) or get overwritten by (via liveSync) whatever the server's
  // own project currently is. See model/shareLink.js.
  const sharedParam = new URLSearchParams(window.location.search).get('d');
  // An invite link (?join=) carries only the session id, not the diagram —
  // the host pushes that over the data channel the moment this browser's
  // connection opens (see peerSession.join() near the end of this
  // function). Old-style links from before that carried both still work
  // unchanged: `project` is already set from `?d=` by the time the branch
  // below would otherwise apply.
  const joinId = new URLSearchParams(window.location.search).get('join');
  const isLiveGuest = Boolean(joinId);
  let project;
  let isSharedView = false;
  let sharedLinkFailed = false;
  if (sharedParam) {
    try {
      project = Project.fromJSON(await decodeProjectFromParam(sharedParam));
      isSharedView = true;
    } catch {
      // A truncated or otherwise mangled ?d= — there's nothing in it worth
      // salvaging, so fall through to a blank diagram rather than the
      // blocking alert() this used to be: an empty canvas is still
      // something to work with, and a toast says what happened without
      // stopping the page from finishing loading.
      sharedLinkFailed = true;
      window.history.replaceState(null, '', window.location.pathname);
      showToast("This link's diagram couldn't be read — it may be corrupted or incomplete. Starting a blank diagram instead.");
    }
  }
  if (sharedLinkFailed) {
    project = new Project({ name: 'Untitled' });
  } else if (!project) {
    // A live-session guest starts from a blank placeholder rather than
    // this browser's own local/server document — it's about to be
    // replaced by the host's diagram anyway, so loading (and briefly
    // showing) this browser's own unrelated one first would just be
    // wasted work, or worse, a confusing flash of the wrong diagram.
    project = isLiveGuest ? new Project({ name: 'Untitled' }) : (await loadProject()) || new Project({ name: 'Untitled' });
  }
  // Nothing saved anywhere (a genuine first visit, a failed shared link, or
  // a fresh live-session placeholder) — the worked example (see
  // model/defaultDiagram.js) rather than one bare, portless block, so a
  // blank canvas is never anyone's first look at what this even does.
  if (project.listBlocks().length === 0) {
    project = createDefaultDiagram();
  }

  const camera = new Camera();
  const selection = new SelectionManager();
  const wireSelection = new WireSelection();
  const renderLoop = new RenderLoop(draw);

  // clientId -> { x, y, path, hidden, lastSeen } — path is the hierarchy
  // level the cursor was reported from, so a cursor from a level you're
  // not currently looking at doesn't show up superimposed on unrelated
  // blocks; `hidden` is true while that person's own mouse is off their
  // canvas (see the pointerleave handler below) — no glyph to draw, but
  // still very much online. Pruned by age rather than an explicit
  // "they disconnected" message, since the server doesn't track which
  // socket belongs to which clientId. This also doubles as the header's
  // online-users presence list (see draw() below): it reads every entry
  // here regardless of `hidden`, which — combined with the heartbeat (see
  // CURSOR_HEARTBEAT_MS further down) — is what keeps someone listed as
  // online while they're using the rest of the app (a toolbar, the
  // Inspector) rather than actively hovering the diagram, or just
  // sitting still reading it. A presence list that vanishes the moment a
  // real person's mouse leaves the canvas, or simply stops moving, isn't
  // telling you who's online — just who happened to be mid-gesture over
  // the diagram a few seconds ago.
  const remoteCursors = new Map();
  const CURSOR_STALE_MS = 5000;
  let lastCursorSentAt = 0;
  // The world position a heartbeat re-announces between real cursor
  // moves — null until the mouse actually enters the canvas at least
  // once, so a peer who's never moved their cursor here doesn't get an
  // announced position of nowhere in particular.
  let lastCursorWorld = null;

  // Tracks what the server should already contain, so a pushed update (see
  // liveSync below) can tell "someone else changed it" apart from "that's
  // just my own last save echoed back" without waiting on a round trip.
  let lastSyncedSnapshot = JSON.stringify(project.toJSON());

  let inspectorApi = null;
  let docSyncApi = null;
  let headerActionsApi = null;
  let appMenuApi = null;
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
    headerActionsApi?.refreshHistory();
    // A live-session guest's project is the host's, streamed in over the
    // data channel — persisting it here would overwrite this browser's own
    // unrelated local/server document with someone else's diagram.
    if (!isSharedView && !isLiveGuest) saveProject(project);
    // The tab title is what a bookmark gets named, so it has to be the
    // diagram's name rather than the app's.
    document.title = project.name ? `${project.name} · nodigraph` : 'nodigraph';
    appMenuApi?.refreshSaved(urlSnapshot === null ? null : urlSnapshot === lastSyncedSnapshot);
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

  // Deleting one specific wire — the Inspector's own delete button, as
  // opposed to deleteSelectedWires() which drops the whole selection (the
  // Delete key, or the canvas FAB). Removed from the selection too, since
  // leaving a now-nonexistent id in there would make the next repaint
  // try to draw geometry for a connection that's gone.
  function deleteConnection(connectionId) {
    project.removeConnection(connectionId);
    wireSelection.remove(connectionId);
    persist();
    renderLoop.requestRender();
  }

  // What the delete FAB acts on: whichever kind of thing is currently
  // selected. Wires go without a prompt (a wire is one fact, and undo is a
  // click away); blocks ask first, since deleting one takes its whole
  // sub-architecture and every wire touching it with it.
  // `skipConfirm` is for delete mode (see toggleDeleteMode below): entering
  // that mode by clicking the delete FAB with nothing selected is itself
  // the confirmation, so the per-block/multi-block prompts below would
  // just be a dialog spamming every click of an otherwise fast erase tool.
  function deleteSelection({ skipConfirm = false } = {}) {
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
      if (skipConfirm || window.confirm(`Delete ${selection.count} blocks and their connections?`)) deleteSelectedBlocks();
      return;
    }
    const block = project.getBlock(selection.selectedBlockId);
    if (block && (skipConfirm || window.confirm(`Delete "${block.name}" and its connections?`))) deleteBlock(block.id);
  }

  // The delete FAB is always active (unlike the other mini-FABs, which are
  // inert with nothing selected — see SelectionFabs.js): clicking it with
  // an empty selection instead arms this mode, in which the *next*
  // selection made any of the usual ways (a plain click, a shift-click, or
  // a shift-drag marquee) is deleted the instant it lands rather than
  // sitting there — see the check in draw() below. Clicking the FAB again
  // with still nothing selected (the only way to reach it while armed,
  // since a delete clears the selection right back to empty) disarms it.
  let deleteMode = false;
  function toggleDeleteMode() {
    deleteMode = !deleteMode;
    renderLoop.requestRender();
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

  // Shared by every block-only style toggle below (fill, font family,
  // size, bold, italic): "no value" means dropping the key entirely rather
  // than storing a falsy/default literal, so an untouched block carries no
  // style data — for `fill` specifically, the theme itself supplies the
  // default (see canvasPalette.js), and a stored literal would get stuck
  // on whichever theme was active when it was picked.
  function applyBlockStyle(key, value) {
    for (const blockId of selection.list()) {
      const block = project.getBlock(blockId);
      if (!block) continue;
      if (value) {
        block.style = { ...block.style, [key]: value };
      } else {
        const rest = { ...block.style };
        delete rest[key];
        block.style = rest;
      }
    }
    persist();
    renderLoop.requestRender();
  }

  function fillSelection(color) {
    applyBlockStyle('fill', color);
  }

  function fontSelection(key) {
    applyBlockStyle('font', key);
  }

  function fontSizeSelection(size) {
    applyBlockStyle('fontSize', size);
  }

  function fontWeightSelection(bold) {
    applyBlockStyle('bold', bold || null);
  }

  function fontStyleSelection(italic) {
    applyBlockStyle('italic', italic || null);
  }

  // The representative block the font popover pre-fills its controls
  // from — same "last one picked" block the Inspector itself shows.
  function selectionStyle() {
    const block = project.getBlock(selection.selectedBlockId);
    return block?.style || null;
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
      // persist() already retitles the tab from the product's own name;
      // this covers the other case, an ancestor's name changing while its
      // boundary label is what shows in the breadcrumb.
      breadcrumbApi?.refresh();
      renderLoop.requestRender();
    },
  });

  // Opens an inline editor over a wire's own label, positioned the same
  // place the label itself is drawn — the middle of its trunk, or the
  // arc-length midpoint of the whole path when it has no trunk (see
  // ConnectionRenderer.getConnectionLabelPosition).
  function openWireLabelRename(connectionId) {
    const connection = project.getConnection(connectionId);
    if (!connection) return;
    const container = project.getContainerBlock();
    const boundary = container?.boundaryGeometry ? { block: container, geometry: container.boundaryGeometry } : null;
    const geometry = getConnectionGeometry(project, connection, boundary);
    if (!geometry) return;

    const labelPos = getConnectionLabelPosition(geometry);
    const topLeft = camera.worldToScreen(labelPos.x, labelPos.y);
    const canvasRect = canvas.getBoundingClientRect();
    // A wire has no box of its own the way a block does, so the editor
    // gets a fixed size centered on the label position rather than one
    // measured from anything.
    const width = 120;
    const height = 24;
    wireLabelEditor.open(connectionId, connection.label || '', {
      x: canvasRect.left + topLeft.x - width / 2,
      y: canvasRect.top + topLeft.y - height / 2,
      width,
      height,
    });
  }

  const wireLabelEditor = createNameEditor({
    // A blank commit is a real answer here (clear the label), unlike a
    // block's name, which always needs something.
    allowEmpty: true,
    onCommit: (connectionId, label) => {
      const connection = project.getConnection(connectionId);
      if (!connection) return;
      if (label) connection.label = label;
      else delete connection.label;
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
    appMenuApi?.refreshAnimating(animating);
    renderLoop.requestRender();
  }

  function handleExportFile(format) {
    downloadProjectFile(project, format);
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
    appMenuApi?.refreshSaved(true);
    return { ok: true, length: url.length };
  }

  // A shareable link, not a save — the whole diagram packed into the URL's
  // own ?d= param (see model/shareLink.js), so opening it needs nothing
  // but a browser: no server, no account.
  async function buildShareUrl() {
    const encoded = await encodeProjectToParam(project);
    return `${window.location.origin}${window.location.pathname}?d=${encoded}`;
  }

  const buildShareUrlOrError = async () => {
    try {
      return await buildShareUrl();
    } catch (err) {
      return `Couldn't create a share link: ${err.message}`;
    }
  };
  const renderFigureImage = async () => ({
    dataUrl: renderCurrentLevelDataUrl(project),
    blob: await renderCurrentLevelBlob(project),
    // Google Docs itself only ever pastes the PNG above — its own paste
    // handling doesn't reliably rasterize an SVG source either way it
    // might arrive — but a target that DOES honor a vector clipboard
    // flavor (see GoogleDocsExportDialog's "Also copy as SVG") can use
    // this instead of a screenshot of the same diagram.
    svgBlob: renderCurrentLevelSvgBlob(project),
  });
  // The level you're looking at is the thing the figure depicts, so its
  // name is what the figure's description should say.
  const getFigureName = () => project.getContainerBlock()?.name || project.name;

  // The obvious way to keep a diagram embedded in Markdown from going
  // stale is to never bake a snapshot into the reference at all: save this
  // file at a stable path next to (or in) whatever repo the .md file
  // lives in, reference it there by relative path, and the next commit
  // that overwrites this same file is the entire "update" — GitHub (and
  // most Markdown renderers) already show whatever's currently on disk at
  // that path, with nothing to re-sync by hand. The copied snippet assumes
  // exactly that — the file saved alongside the Markdown that pastes it.
  function handleExportSvg() {
    const figureName = getFigureName();
    downloadCurrentLevelSvg(project, figureName);
    const filename = `${safeFileStem(figureName)}.svg`;
    showToast(`Downloaded ${filename}.`, {
      actions: [
        {
          label: 'Copy Markdown',
          onClick: () => {
            navigator.clipboard.writeText(`![${figureName}](./${filename})`).catch(() => {
              // Clipboard access can legitimately be refused (permissions,
              // insecure context) — the file itself already downloaded, so
              // there's nothing left to fall back to beyond leaving it to
              // be typed by hand.
            });
          },
        },
        { label: 'OK' },
      ],
    });
  }

  const shareLinkDialog = createShareLinkDialog({ getShareUrl: buildShareUrlOrError });
  const googleDocsExportDialog = createGoogleDocsExportDialog({
    getShareUrl: buildShareUrlOrError,
    renderImage: renderFigureImage,
    getFigureName,
  });
  const liveSessionDialog = createLiveSessionDialog({
    session: {
      getState: () => peerSession?.getState() || { state: 'idle', peers: 0 },
      stop: () => peerSession.stop(),
    },
  });

  // Starting a session is a header action (see ui/HeaderActions.js). The
  // first click just starts it and hands over the invite link — a dialog
  // whose only content would be "here's a link, click Copy" is a detour
  // from what starting a session is actually for. Once it's live, the same
  // button instead opens that dialog, which is where the participant count
  // and "End session" live for the rest of the session's life.
  async function handleSession() {
    if (peerSession.getState().state === 'live') {
      liveSessionDialog.open();
      return;
    }
    let inviteUrl;
    try {
      const sessionId = await peerSession.host();
      // Just the session id — no need to also pack the whole diagram in
      // here the way a plain share link does: the host pushes it over the
      // data channel the moment the guest's connection opens (see
      // peerSession.js's onStatus 'joined' handling below), so nothing
      // else needs to travel through the link itself.
      inviteUrl = `${window.location.origin}${window.location.pathname}?join=${encodeURIComponent(sessionId)}`;
      liveSessionDialog.setInviteUrl(inviteUrl);
    } catch (err) {
      headerActionsApi?.refreshSession(peerSession.getState());
      window.alert(`Couldn't start a live session: ${err.message}`);
      return;
    }
    try {
      await navigator.clipboard.writeText(inviteUrl);
      showToast('Live session started — invite link copied to clipboard.');
    } catch {
      // Clipboard access can legitimately be refused (permissions,
      // insecure context) — the link is short now that it's just a
      // session id (see setInviteUrl above), so showing it plainly is a
      // real fallback rather than an unreadable wall of text. Longer than
      // the default so there's real time to select and copy it by hand,
      // but still a toast — one that never went away on its own would be
      // one more thing to remember to dismiss.
      showToast(`Live session started. Invite link: ${inviteUrl}`, { autoDismissMs: 20000 });
    }
  }

  function handleShare() {
    shareLinkDialog.open();
  }

  function handleExportGoogleDocs() {
    googleDocsExportDialog.open();
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
    frameCurrentLevel();
    updateNavigationUI();
    persist();
    renderLoop.requestRender();
  }

  // Blanks the whole tree the same way opening a file does, just with a
  // freshly-created one instead of a loaded one — including every level
  // drilled into, since that's all part of the same rootBlock being
  // replaced. Confirmed up front, unlike opening a file, since picking a
  // file to load is already a deliberate act but a stray click on a
  // toolbar button isn't.
  function handleNewDiagram() {
    const proceed = window.confirm(
      "Start a new diagram? This clears everything currently open — every block, wire, and nested level you've drilled into. (Nothing you draw here ever leaves your browser, so this only affects what's open in this tab.)",
    );
    if (!proceed) return;
    const blank = createDefaultDiagram();
    project.applyRemoteRootBlock(blank.toJSON().rootBlock);
    selection.clear();
    wireSelection.clear();
    frameCurrentLevel();
    updateNavigationUI();
    // A shared/opened link's URL still points at the diagram just cleared —
    // strip it so a reload (or someone else's copy of the link) doesn't
    // bring back what was just confirmed gone.
    if (isSharedView || urlSnapshot !== null) {
      isSharedView = false;
      urlSnapshot = null;
      window.history.replaceState(null, '', window.location.pathname);
    }
    appMenuApi?.refreshSaved(null);
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
    } else if (message.kind === 'portBoundary') {
      // A port being dragged or resized *on the boundary* — its own
      // placement there (see BlockRenderer.getPortBoundaryPlacement),
      // separate from the outer-face 'port' case above.
      const block = project.getBlock(message.blockId);
      const port = block?.ports.find((p) => p.id === message.portId);
      if (port) port.boundary = message.boundary;
    } else if (message.kind === 'connection') {
      const connection = project.getConnection(message.connectionId);
      if (connection) connection.manualBend = message.manualBend;
    } else if (message.kind === 'boundary') {
      const block = project.getBlock(message.blockId);
      if (block?.boundaryGeometry) Object.assign(block.boundaryGeometry, message.boundaryGeometry);
    } else if (message.kind === 'cursor') {
      remoteCursors.set(message.clientId, {
        x: message.x,
        y: message.y,
        path: message.path,
        hidden: Boolean(message.hidden),
        lastSeen: Date.now(),
      });
    } else if (message.kind === 'cursor-leave') {
      // No longer sent (see the pointerleave handler below, which sends a
      // hidden cursor instead so the person stays in the online-users
      // list) — kept so an older cached client's stray message still does
      // something sane rather than silently piling up as an unknown kind.
      remoteCursors.delete(message.clientId);
    }
    renderLoop.requestRender();
  }

  function selectionCount() {
    return selection.count + wireSelection.list().length;
  }

  // Drops anyone not heard from recently — shared by the canvas's own
  // cursor glyphs and the header's online-users list (see draw() below),
  // so "who's considered online" never disagrees between the two.
  function pruneStaleCursors() {
    const now = Date.now();
    for (const [id, cursor] of remoteCursors) {
      if (now - cursor.lastSeen > CURSOR_STALE_MS) remoteCursors.delete(id);
    }
  }

  // Only the cursors actually worth drawing a glyph for: on the level
  // currently being viewed (someone editing three levels away is still
  // online — see the header list, which isn't filtered either way — just
  // not something to draw a cursor for on a canvas that isn't showing
  // their block at all), and not currently hidden (their own mouse is off
  // their canvas — see the pointerleave handler — so there's no real
  // cursor position of theirs to point at right now).
  function currentLevelCursors() {
    const visible = new Map();
    for (const [id, cursor] of remoteCursors) {
      if (!cursor.hidden && pathsEqual(cursor.path, project.path)) visible.set(id, cursor);
    }
    return visible;
  }

  function draw() {
    // Delete mode: whatever just got selected (see toggleDeleteMode above)
    // is deleted right away instead of waiting for another FAB click.
    if (deleteMode && selectionCount() > 0) deleteSelection({ skipConfirm: true });
    // Both block and wire selection have observers, and every change to
    // either already ends in a render — refreshing here covers both,
    // and refresh() itself no-ops unless the count actually moved.
    selectionFabsApi?.refresh();
    // The add-block FAB is disabled rather than hidden while something is
    // selected — same "present but inert" treatment as the mini-FABs it
    // sits below, driven from the same count they use.
    fabEl.disabled = selectionCount() > 0;
    if (textFabEl) textFabEl.disabled = selectionCount() > 0;
    pruneStaleCursors();
    onlineUsersApi.refresh(clientId, [...remoteCursors.keys()]);
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
      remoteCursors: currentLevelCursors(),
      hoverGhost: stateMachine.getHoverGhost(),
      wireMoveOverride: stateMachine.getWireMoveOverride(),
      marqueeRect: stateMachine.getMarqueeRect(),
      // Derived from the clock rather than counted in frames, so the
      // dashes travel at the same speed on any refresh rate. Negative
      // because a decreasing offset moves them along the path's own
      // direction, which runs output to input.
      flowOffset: animating ? -(performance.now() / 1000) * FLOW_SPEED : null,
      // So a block whose text is an image URL can ask for a redraw once
      // that image finishes loading (see render/imageCache.js) — it isn't
      // loaded yet the first time a frame reaches it, so nothing else
      // would trigger the frame where it actually appears.
      requestRender: () => renderLoop.requestRender(),
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
      liveSessionDialog.refresh();
      headerActionsApi?.refreshSession(status);
    },
  });

  function broadcastToPeers(message) {
    if (peerSession?.isActive()) peerSession.send(message);
  }

  // A live-session guest's own local/server document is unrelated to
  // whatever the host is sharing — connecting to it here would just
  // overwrite this browser's screen with someone else's diagram the
  // moment it next changed.
  const liveSync = isSharedView || isLiveGuest
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
    onRequestWireLabel: openWireLabelRename,
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
  // Whether OUR OWN mouse is currently over the canvas — false the moment
  // it leaves (pointerleave below), true again on the next move. Tracked
  // outside sendCursor so the heartbeat can keep re-announcing whichever
  // state is current without needing its own copy of the logic.
  let cursorHidden = false;
  // `hidden` travels with every cursor message this sends: false while
  // actually hovering the canvas, true once the mouse has left it, but a
  // message keeps going out either way via the heartbeat. A receiver
  // skips drawing a glyph for a hidden cursor (see currentLevelCursors)
  // without dropping that person from remoteCursors entirely, which is
  // what the online-users list reads.
  function sendCursor() {
    if (!lastCursorWorld) return;
    const cursor = { kind: 'cursor', clientId, x: lastCursorWorld.x, y: lastCursorWorld.y, path: project.path, hidden: cursorHidden };
    liveSync.sendLive(cursor);
    broadcastToPeers({ type: 'live', ...cursor });
  }

  canvas.addEventListener('pointermove', (event) => {
    const now = Date.now();
    if (now - lastCursorSentAt < CURSOR_SEND_INTERVAL_MS) return;
    lastCursorSentAt = now;
    const rect = canvas.getBoundingClientRect();
    lastCursorWorld = camera.screenToWorld(event.clientX - rect.left, event.clientY - rect.top);
    cursorHidden = false;
    sendCursor();
  });
  canvas.addEventListener('pointerleave', () => {
    // The position itself is kept (not cleared) — a person who moved
    // their mouse from the canvas onto, say, the Inspector is still
    // right where they were on the diagram as far as anyone else's screen
    // should show, just without a glyph actively tracking a cursor that
    // isn't over the canvas anymore.
    cursorHidden = true;
    sendCursor();
  });

  // Re-announces the last known position (and hidden state) on a steady
  // clock, independent of whether the mouse has actually moved — a real,
  // still-connected person who has simply stopped moving their cursor
  // (reading, or working in a panel outside the canvas) would otherwise
  // age out of every other peer's remoteCursors (see CURSOR_STALE_MS) and
  // quietly disappear from the online-users list despite still being
  // right here. Comfortably under CURSOR_STALE_MS so a single missed beat
  // (a dropped packet, a throttled background tab) doesn't cost a false
  // "they left".
  const CURSOR_HEARTBEAT_MS = 2000;
  setInterval(sendCursor, CURSOR_HEARTBEAT_MS);

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
    textFabEl,
  });

  inspectorApi = mountInspector(inspectorEl, {
    project,
    selection,
    wireSelection,
    requestRender: () => renderLoop.requestRender(),
    persist,
    deleteBlock,
    enterBlock,
    deleteConnection,
    toggleButton: inspectorToggleEl,
  });

  breadcrumbApi = mountBreadcrumb(breadcrumbEl, {
    project,
    onNavigate: navigateToDepth,
    onRenameCurrent: () => openRename(project.getContainerBlock().id),
  });
  parentFabEl.addEventListener('click', () => {
    if (project.path.length === 0) {
      // Wrapping the whole product changes what "the top level" means —
      // worth a confirmation, unlike navigating up, which shows nothing it
      // can't be undone by simply navigating back.
      const name = project.rootBlock.name || 'this product';
      if (window.confirm(`Create a new parent above "${name}"? This adds a level containing everything you have now.`)) {
        createParent();
      }
      return;
    }
    navigateToDepth(project.path.length - 1);
  });

  // Doc sync is parked behind a flag (see config.js) — the handlers above
  // stay wired so flipping the flag is the only step to bring it back.
  if (ENABLE_DOC_SYNC) {
    docSyncApi = mountDocSync(docSyncEl, { onUpdate: handleUpdateDoc, onConnect: handleConnectDoc });
  }
  const onlineUsersApi = mountOnlineUsers(onlineUsersEl);
  headerActionsApi = mountHeaderActions(headerActionsEl, {
    onUndo: undo,
    onRedo: redo,
    canUndo: () => history.canUndo,
    canRedo: () => history.canRedo,
    onShare: handleShare,
    onSession: handleSession,
  });
  appMenuApi = mountAppMenu(appMenuEl, {
    onNew: handleNewDiagram,
    onOpen: handleOpenFile,
    onSaveUrl: handleSaveToUrl,
    onExportFile: handleExportFile,
    onExportSvg: handleExportSvg,
    onExportGoogleDocs: handleExportGoogleDocs,
    onAnimate: toggleAnimation,
    onToggleDarkMode: (on) => {
      setTheme(on ? 'dark' : 'light');
      renderLoop.requestRender();
    },
  });
  headerActionsApi.refreshHistory();
  headerActionsApi.refreshSession(peerSession.getState());
  appMenuApi.refreshSaved(urlSnapshot === null ? null : true);
  appMenuApi.refreshAnimating(animating);
  appMenuApi.refreshDarkMode(getTheme() === 'dark');
  document.title = project.name ? `${project.name} · nodigraph` : 'nodigraph';

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
    getSelectionStyle: selectionStyle,
    // Nothing selected: this click arms delete mode instead of deleting.
    onDelete: () => (selectionCount() > 0 ? deleteSelection() : toggleDeleteMode()),
    isDeleteMode: () => deleteMode,
    onColor: colorSelection,
    onFill: fillSelection,
    onFont: fontSelection,
    onFontSize: fontSizeSelection,
    onBold: fontWeightSelection,
    onItalic: fontStyleSelection,
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
      appMenuApi?.triggerSave();
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
  maybeShowOnboarding();

  // joinId/isLiveGuest were resolved back at the top of bootstrap(), before
  // `project` was chosen. There's nothing on screen yet worth keeping if
  // this fails — a corporate firewall blocking WebRTC is exactly the case
  // where silence would be baffling.
  if (isLiveGuest) {
    peerSession.join(joinId).catch((err) => {
      window.alert(`Couldn't join the live session: ${err.message}\nAsk whoever invited you to send a regular Share link instead.`);
    });
  }
}

bootstrap();
