export function mountToolbar(container, { project, camera, canvas, selection, requestRender, persist }) {
  const button = document.createElement('button');
  button.textContent = '+ Add Block';
  button.addEventListener('click', () => {
    const center = camera.screenToWorld(canvas.clientWidth / 2, canvas.clientHeight / 2);
    const block = project.createDefaultBlock(center.x - 110, center.y - 70);
    selection.select(block.id);
    persist();
    requestRender();
  });

  const hint = document.createElement('span');
  hint.className = 'hint';
  hint.textContent = 'Drag to move · corner handle to resize · wheel to zoom · drag background to pan';

  container.appendChild(button);
  container.appendChild(hint);
}
