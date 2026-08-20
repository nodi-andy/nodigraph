// Topbar control cluster for local files, the shareable link, and the
// live session. The file buttons are named for what they actually do to
// the browser rather than for the abstract File-menu verbs: the project
// leaves as a downloaded file and comes back as an uploaded one, so
// "Download"/"Upload" describe the observable behaviour and "Save" doesn't
// (nothing is saved anywhere you could later find it). A hidden
// <input type=file> drives Upload — the only way to get a real file picker
// without extra permissions.
export function mountFileToolbar(
  container,
  { onSave, onOpen, onExportLink, onSession, onUndo, onRedo, canUndo, canRedo },
) {
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
  saveButton.textContent = 'Download';
  saveButton.title = 'Download the project as a local file';
  saveButton.addEventListener('click', () => onSave());

  const openButton = document.createElement('button');
  openButton.type = 'button';
  openButton.className = 'file-toolbar-button';
  openButton.textContent = 'Upload';
  openButton.title = 'Upload a project file from this device';

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

  // Starting a live session lives here rather than inside the Share dialog:
  // it is a mode the whole app is in, not a way of handing the diagram over
  // once, and the banner is where a mode belongs — visible at a glance,
  // whether or not any dialog happens to be open.
  const sessionButton = document.createElement('button');
  sessionButton.type = 'button';
  sessionButton.className = 'file-toolbar-button session-button';
  sessionButton.addEventListener('click', () => onSession());

  const divider = document.createElement('span');
  divider.className = 'file-toolbar-divider';

  container.append(
    undoButton,
    redoButton,
    divider,
    saveButton,
    openButton,
    linkButton,
    sessionButton,
    fileInput,
  );

  return {
    // Called after anything that could change what's undoable, so the
    // buttons grey out rather than silently doing nothing.
    refreshHistory() {
      undoButton.disabled = !canUndo();
      redoButton.disabled = !canRedo();
    },

    // `peers` counts connections, so on the host it is "everyone but me".
    refreshSession(status = {}) {
      const live = status.state === 'live';
      const connecting = status.state === 'connecting';
      sessionButton.classList.toggle('active', live);
      sessionButton.disabled = connecting;
      if (connecting) {
        sessionButton.textContent = 'Connecting…';
        sessionButton.title = 'Setting up the live session';
        return;
      }
      sessionButton.textContent = live ? `Live · ${status.peers + 1}` : 'Start Session';
      sessionButton.title = live
        ? 'Live session in progress — click for the invite link'
        : 'Edit this diagram together with someone, browser to browser';
    },
  };
}
