// Renders whatever level the project is currently pointed at to a real SVG
// document — same "the tool is its own renderer" property diagramImage.js's
// PNG export has (this calls the exact same renderScene), just handed a
// recording context (see render/svgContext.js) instead of a real canvas.
// Unlike the PNG path, there's no oversampling to reason about: a vector
// file scales losslessly at whatever size it's dropped into, so this
// renders at a plain 1 world-unit = 1 SVG-unit scale.
import { Camera } from '../render/Camera.js';
import { renderScene } from '../render/SceneRenderer.js';
import { getExportPalette } from '../render/canvasPalette.js';
import { createSvgContext } from '../render/svgContext.js';
import { safeFileStem } from './localFile.js';

const EMPTY_BOUNDS = { x: 0, y: 0, width: 1, height: 1 };
const PADDING = 40;

export function renderCurrentLevelSvgString(project) {
  const bounds = project.getLevelBounds() || EMPTY_BOUNDS;
  const width = Math.round(bounds.width + PADDING * 2);
  const height = Math.round(bounds.height + PADDING * 2);

  const camera = new Camera();
  camera.zoom = 1;
  camera.offsetX = PADDING - bounds.x;
  camera.offsetY = PADDING - bounds.y;

  const { ctx, serialize } = createSvgContext(width, height);
  renderScene(ctx, camera, project, {
    selectedBlockId: null,
    selectedPortId: null,
    dpr: 1,
    canvasWidth: width,
    canvasHeight: height,
    pendingConnectionPath: null,
    connectionSource: null,
    connectionTarget: null,
    wireSelection: null,
    showGrid: false,
    palette: getExportPalette(),
  });
  return serialize();
}

export function renderCurrentLevelSvgDataUrl(project) {
  const svg = renderCurrentLevelSvgString(project);
  return `data:image/svg+xml;base64,${btoa(unescape(encodeURIComponent(svg)))}`;
}

export function renderCurrentLevelSvgBlob(project) {
  return new Blob([renderCurrentLevelSvgString(project)], { type: 'image/svg+xml' });
}

// `figureName` is whatever the current level is called (see main.js's
// getFigureName) — the level you're looking at is the diagram this
// downloads, so its name is what the file should be named, not the
// project's own top-level name.
export function downloadCurrentLevelSvg(project, figureName) {
  const blob = renderCurrentLevelSvgBlob(project);
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeFileStem(figureName)}.svg`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
