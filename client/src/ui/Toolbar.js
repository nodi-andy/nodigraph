import { DEFAULT_BLOCK_WIDTH, DEFAULT_BLOCK_HEIGHT, DEFAULT_TEXT_WIDTH, DEFAULT_TEXT_HEIGHT } from '../model/Block.js';

// The FAB is the app's single primary action (mobile convention), reused
// as-is on desktop rather than a separate toolbar button. `textFabEl` is
// the smaller "add text" mini-FAB stacked above it — same creation flow,
// just a different kind and default footprint (see Block.createBlock).
export function mountToolbar(
  fabEl,
  { project, camera, canvas, selection, requestRender, persist, textFabEl, getEnterableBlock, onEnterBlock },
) {
  function addCentered(kind, width, height) {
    const center = camera.screenToWorld(canvas.clientWidth / 2, canvas.clientHeight / 2);
    // createDefaultBlock snaps the position to the grid; centering against
    // the real default size just keeps that snapped block visually centered.
    const block = project.createDefaultBlock(center.x - width / 2, center.y - height / 2, kind);
    selection.select(block.id);
    persist();
    requestRender();
  }

  // With exactly one enterable block selected, "add a block" isn't a
  // sensible action for this same button to take (see main.js's draw(),
  // which disables it otherwise) — drilling into the one block already
  // selected is, and it's the same gesture as clicking it in the Inspector.
  fabEl.addEventListener('click', () => {
    const enterable = getEnterableBlock?.();
    if (enterable) {
      onEnterBlock(enterable.id);
      return;
    }
    addCentered('block', DEFAULT_BLOCK_WIDTH, DEFAULT_BLOCK_HEIGHT);
  });
  textFabEl?.addEventListener('click', () => addCentered('text', DEFAULT_TEXT_WIDTH, DEFAULT_TEXT_HEIGHT));
}
