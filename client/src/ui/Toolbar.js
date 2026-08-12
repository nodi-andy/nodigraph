// The FAB is the app's single primary action (mobile convention), reused
// as-is on desktop rather than a separate toolbar button.
export function mountToolbar(fabEl, { project, camera, canvas, selection, requestRender, persist }) {
  fabEl.addEventListener('click', () => {
    const center = camera.screenToWorld(canvas.clientWidth / 2, canvas.clientHeight / 2);
    const block = project.createDefaultBlock(center.x - 110, center.y - 70);
    selection.select(block.id);
    persist();
    requestRender();
  });
}
