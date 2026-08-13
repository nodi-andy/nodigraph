// Small topbar control cluster for the Google Doc sync feature: a status
// readout, a Save button, and a settings gear for the one thing that needs
// configuring — the Apps Script Web App URL (see appsscript/Code.gs). Kept
// out of Toolbar.js since that's specifically canvas actions (add block).
const STORAGE_KEY = 'gravis-sysml:docWebAppUrl';

function getStoredUrl() {
  try {
    return localStorage.getItem(STORAGE_KEY) || '';
  } catch {
    return '';
  }
}

function setStoredUrl(url) {
  try {
    if (url) localStorage.setItem(STORAGE_KEY, url);
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Private browsing or similar — sync config just won't survive a reload.
  }
}

const STATUS_LABELS = {
  idle: 'Not connected',
  synced: 'Synced',
  saving: 'Saving…',
  loading: 'Loading…',
  error: 'Sync error',
};

export function mountDocSync(container, { onSave }) {
  container.innerHTML = '';
  container.className = 'doc-sync';

  const status = document.createElement('span');
  status.className = 'doc-sync-status';

  const saveButton = document.createElement('button');
  saveButton.type = 'button';
  saveButton.className = 'doc-sync-button';
  saveButton.textContent = 'Save';
  saveButton.addEventListener('click', () => onSave());

  const settingsButton = document.createElement('button');
  settingsButton.type = 'button';
  settingsButton.className = 'doc-sync-settings';
  settingsButton.setAttribute('aria-label', 'Configure Google Doc sync');
  settingsButton.textContent = '⚙';
  settingsButton.addEventListener('click', () => promptForUrl());

  container.append(status, saveButton, settingsButton);

  function setStatus(state, detail) {
    const label = STATUS_LABELS[state] || state;
    status.textContent = detail ? `${label}: ${detail}` : label;
    status.dataset.state = state;
  }

  function promptForUrl() {
    const current = getStoredUrl();
    // A plain prompt() rather than a form — this is a one-time paste-in of
    // a URL, not something that needs its own settings screen.
    const next = window.prompt(
      'Google Apps Script Web App URL for Doc sync (leave blank to disable):',
      current,
    );
    if (next === null) return; // cancelled
    const trimmed = next.trim();
    setStoredUrl(trimmed);
    setStatus('idle');
  }

  let overlay = null;

  function hideConflict() {
    overlay?.remove();
    overlay = null;
  }

  function showConflict({ onKeepMine, onTakeTheirs }) {
    hideConflict();
    overlay = document.createElement('div');
    overlay.className = 'sync-conflict-overlay';

    const dialog = document.createElement('div');
    dialog.className = 'sync-conflict-dialog';

    const heading = document.createElement('h3');
    heading.textContent = 'Doc changed since you loaded it';
    const body = document.createElement('p');
    body.textContent = "Someone else saved to the Doc while you were editing. Choose which version to keep — this can't be undone.";

    const row = document.createElement('div');
    row.className = 'sync-conflict-actions';

    const keepMineBtn = document.createElement('button');
    keepMineBtn.type = 'button';
    keepMineBtn.className = 'sync-conflict-keep-mine';
    keepMineBtn.textContent = 'Keep mine (overwrite)';
    keepMineBtn.addEventListener('click', () => {
      hideConflict();
      onKeepMine();
    });

    const takeTheirsBtn = document.createElement('button');
    takeTheirsBtn.type = 'button';
    takeTheirsBtn.className = 'sync-conflict-take-theirs';
    takeTheirsBtn.textContent = 'Take theirs (discard my changes)';
    takeTheirsBtn.addEventListener('click', () => {
      hideConflict();
      onTakeTheirs();
    });

    row.append(keepMineBtn, takeTheirsBtn);
    dialog.append(heading, body, row);
    overlay.appendChild(dialog);
    document.body.appendChild(overlay);
  }

  setStatus('idle');

  return {
    getWebAppUrl: getStoredUrl,
    promptForUrl,
    setStatus,
    showConflict,
  };
}
