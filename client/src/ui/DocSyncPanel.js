// Small topbar control cluster for the Google Doc publish feature: a
// status readout, an "Update Doc" button, and a settings gear for the one
// thing that needs configuring — the Apps Script Web App URL (see
// appsscript/Code.gs). Kept out of Toolbar.js since that's specifically
// canvas actions (add block).
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
  updating: 'Updating…',
  updated: 'Updated',
  error: 'Sync error',
};

export function mountDocSync(container, { onUpdate }) {
  container.innerHTML = '';
  container.className = 'doc-sync';

  const status = document.createElement('span');
  status.className = 'doc-sync-status';

  const updateButton = document.createElement('button');
  updateButton.type = 'button';
  updateButton.className = 'doc-sync-button';
  updateButton.textContent = 'Update Doc';
  updateButton.addEventListener('click', () => onUpdate());

  const settingsButton = document.createElement('button');
  settingsButton.type = 'button';
  settingsButton.className = 'doc-sync-settings';
  settingsButton.setAttribute('aria-label', 'Configure Google Doc sync');
  settingsButton.textContent = '⚙';
  settingsButton.addEventListener('click', () => promptForUrl());

  container.append(status, updateButton, settingsButton);

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

  setStatus('idle');

  return {
    getWebAppUrl: getStoredUrl,
    promptForUrl,
    setStatus,
  };
}
