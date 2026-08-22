// Renders whatever level the project is currently pointed at to a PNG,
// reusing the exact renderScene the live canvas uses — "the tool is its own
// renderer", so an exported figure can't drift from what you were just
// looking at.
import { Camera } from '../render/Camera.js';
import { renderScene } from '../render/SceneRenderer.js';
import { getExportPalette } from '../render/canvasPalette.js';

const EMPTY_BOUNDS = { x: 0, y: 0, width: 1, height: 1 };
const PADDING = 40;
// CROPPED TO CONTENT rather than squeezed into a fixed frame, and
// oversampled rather than rendered at native 1:1: a canvas PNG carries no
// DPI metadata, so whatever a paste target (Google Docs included) decides
// to display it at is unrelated to its actual pixel count — the same
// diagram that reads crisp on this screen can paste in soft and blurry.
// Rendering at up to 2x the diagram's own world-unit size is the same
// trick a HiDPI screenshot uses: more pixels than the display size needs
// means it still reads sharp even shown smaller than its raw dimensions.
// Only scaled below that (down to, in the largest diagrams, less than 1:1)
// when the result would otherwise produce an unreasonably large file.
const MAX_DIMENSION = 2200;
const EXPORT_SCALE = 2;

// Transparent background (no grid, no canvas fill) so it drops cleanly
// onto a white Doc page as well as a dark one.
export function renderCurrentLevelCanvas(project) {
  const bounds = project.getLevelBounds() || EMPTY_BOUNDS;
  const rawWidth = bounds.width + PADDING * 2;
  const rawHeight = bounds.height + PADDING * 2;
  const zoom = Math.min(EXPORT_SCALE, MAX_DIMENSION / rawWidth, MAX_DIMENSION / rawHeight);
  const width = Math.round(rawWidth * zoom);
  const height = Math.round(rawHeight * zoom);

  const camera = new Camera();
  camera.zoom = zoom;
  camera.offsetX = PADDING * zoom - bounds.x * zoom;
  camera.offsetY = PADDING * zoom - bounds.y * zoom;

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  renderScene(canvas.getContext('2d'), camera, project, {
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
  return canvas;
}

export function renderCurrentLevelDataUrl(project) {
  return renderCurrentLevelCanvas(project).toDataURL('image/png');
}

export function renderCurrentLevelBlob(project) {
  return new Promise((resolve) => {
    renderCurrentLevelCanvas(project).toBlob(resolve, 'image/png');
  });
}
