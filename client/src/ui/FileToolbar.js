// Topbar control cluster for local save/open plus a shareable link —
// draw.io-style "File > Save As... / Open" as two plain buttons, plus a
// third for the URL export (see model/shareLink.js). A hidden
// <input type=file> drives Open (the only way to get a real file picker
// without extra permissions); Save just triggers a browser download.
export function mountFileToolbar(container, { onSave, onOpen, onExportLink, onUndo, onRedo, canUndo, canRedo }) {
  container.innerHTML = '';
  container.className = 'file-toolbar';

  // Icon-only, and first in the row: undo/redo are reached far more often
  // than the file actions, and the curved-arrow pair is universal enough
  // not to need a word.
  const iconButton = (path, title, onClick) => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'file-toolbar-button file-toolbar-icon';
    button.title = title;
    button.setAttribute('aria-label', title);
    button.innerHTML = `<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="${path}" fill="currentColor"/></svg>`;
    button.addEventListener('click', onClick);
    return button;
  };

  const undoButton = iconButton(
    'M12.5 8H7.8l2.6-2.6L9 4 4 9l5 5 1.4-1.4L7.8 10h4.7a4 4 0 0 1 0 8H10v2h2.5a6 6 0 0 0 0-12z',
    'Undo (Ctrl+Z)',
    () => onUndo(),
  );
  const redoButton = iconButton(
    'M11.5 8h4.7l-2.6-2.6L15 4l5 5-5 5-1.4-1.4 2.6-2.6h-4.7a4 4 0 0 0 0 8H14v2h-2.5a6 6 0 0 1 0-12z',
    'Redo (Ctrl+Shift+Z)',
    () => onRedo(),
  );

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'file-toolbar-button';
  saveButton.textContent = 'Save';
  saveButton.title = 'Save the project to a local file';
  saveButton.addEventListener('click', () => onSave());

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'file-toolbar-button';
  openButton.textContent = 'Open';
  openButton.title = 'Open a project from a local file';

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  fileInput.accept = 'application/json,.json';
  fileInput.hidden = true;
  openButton.addEventListener('click', () => fileInput.click());
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = ''; // allow picking the same file again later
    if (file) onOpen(file);
  });

  const linkButton = document.createElement('button');
  linkButton.type = 'button';
  linkButton.className = 'file-toolbar-button';
  linkButton.textContent = 'Share Link';
  linkButton.title = 'Get a URL that opens this diagram directly, with no server or account needed';
  linkButton.addEventListener('click', () => onExportLink());

  const divider = document.createElement('span');
  divider.className = 'file-toolbar-divider';

  container.append(undoButton, redoButton, divider, saveButton, openButton, linkButton, fileInput);

  return {
    // Called after anything that could change what's undoable, so the
    // buttons grey out rather than silently doing nothing.
    refreshHistory() {
      undoButton.disabled = !canUndo();
      redoButton.disabled = !canRedo();
    },
  };
}
