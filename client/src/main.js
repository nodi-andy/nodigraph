import { Project } from './model/Project.js';
import { loadProject, saveProject } from './model/store.js';
import { Camera } from './render/Camera.js';
import { RenderLoop } from './render/RenderLoop.js';
import { renderScene } from './render/SceneRenderer.js';
import { SelectionManager } from './interaction/SelectionManager.js';
import { DragStateMachine } from './interaction/DragStateMachine.js';
import { attachInputRouter } from './interaction/InputRouter.js';
import { mountToolbar } from './ui/Toolbar.js';
import { mountInspector } from './ui/InspectorPanel.js';

const canvas = document.getElementById('scene-canvas');
const ctx = canvas.getContext('2d');
const fabEl = document.getElementById('fab-add-block');
const inspectorEl = document.getElementById('inspector');

const project = loadProject() || new Project({ name: 'Untitled Product' });
if (project.listBlocks().length === 0) {
  project.createDefaultBlock(80, 80);
}

const camera = new Camera();
const selection = new SelectionManager();
const renderLoop = new RenderLoop(draw);

let inspectorApi = null;

function persist() {
  saveProject(project);
  inspectorApi?.refresh();
}

function draw() {
  const dpr = window.devicePixelRatio || 1;
  renderScene(ctx, camera, project, {
    selectedBlockId: selection.selectedBlockId,
    dpr,
    canvasWidth: canvas.clientWidth,
    canvasHeight: canvas.clientHeight,
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
  requestRender: () => renderLoop.requestRender(),
  persist,
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
});

// Synchronous initial call covers the normal case (layout is already settled
// by the time a deferred module script runs); ResizeObserver covers window
// resizes and any layout pass still mid-flight in edge cases.
resizeCanvas();
new ResizeObserver(resizeCanvas).observe(canvas);
renderLoop.start();
