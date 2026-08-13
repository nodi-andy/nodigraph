import { Project } from './model/Project.js';
import { touchBlock } from './model/Block.js';
import { removePort } from './model/BlockDescription.js';
import { loadProject, saveProject } from './model/store.js';
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

const canvas = document.getElementById('scene-canvas');
const ctx = canvas.getContext('2d');
const fabEl = document.getElementById('fab-add-block');
const inspectorEl = document.getElementById('inspector');
const breadcrumbEl = document.getElementById('breadcrumb');
const backButtonEl = document.getElementById('btn-back');

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

  let inspectorApi = null;

  function persist() {
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
    });
  }

  function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;
    canvas.width = canvas.clientWidth * dpr;
    canvas.height = canvas.clientHeight * dpr;
    renderLoop.requestRender();
  }

  const stateMachine = new DragStateMachine({
    camera,
    project,
    selection,
    wireSelection,
    requestRender: () => renderLoop.requestRender(),
    persist,
    onEnterBlock: enterBlock,
  });

  attachInputRouter(canvas, camera, stateMachine);
  selection.onChange(() => renderLoop.requestRender());

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
  backButtonEl.addEventListener('click', () => navigateToDepth(project.path.length - 1));

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
