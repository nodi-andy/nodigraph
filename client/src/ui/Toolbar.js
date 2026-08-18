import { DEFAULT_BLOCK_WIDTH, DEFAULT_BLOCK_HEIGHT } from '../model/Block.js';

// The FAB is the app's single primary action (mobile convention), reused
// as-is on desktop rather than a separate toolbar button.
export function mountToolbar(fabEl, { project, camera, canvas, selection, requestRender, persist }) {
  fabEl.addEventListener('click', () => {
    const center = camera.screenToWorld(canvas.clientWidth / 2, canvas.clientHeight / 2);
    // createDefaultBlock snaps the position to the grid; centering against
    // the real default size just keeps that snapped block visually centered.
    const block = project.createDefaultBlock(
      center.x - DEFAULT_BLOCK_WIDTH / 2,
      center.y - DEFAULT_BLOCK_HEIGHT / 2,
    );
    selection.select(block.id);
    persist();
    requestRender();
  });
}
