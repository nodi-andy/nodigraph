// Small topbar control cluster for the Google Doc publish feature: a
// status readout, an "Update Doc" button, and a settings gear that opens
// the Google Picker (main.js's onConnect) so the target doc is chosen from
// an actual Drive file list rather than pasted in. Kept out of Toolbar.js
// since that's specifically canvas actions (add block).
const STORAGE_KEY = 'block-modeler:docUrl';

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
  connected: 'Connected',
  updating: 'Updating…',
  updated: 'Updated',
  error: 'Sync error',
};

export function mountDocSync(container, { onUpdate, onConnect }) {
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
  settingsButton.setAttribute('aria-label', 'Choose the Google Doc to sync to');
  settingsButton.textContent = '⚙';
  settingsButton.addEventListener('click', () => onConnect());

  container.append(status, updateButton, settingsButton);

  function setStatus(state, detail) {
    const label = STATUS_LABELS[state] || state;
    status.textContent = detail ? `${label}: ${detail}` : label;
    status.dataset.state = state;
  }

  // Fallback for when the Picker itself can't be used (not configured, or
  // failed to load) — a plain paste-in rather than leaving the settings
  // button dead.
  function promptForUrl() {
    const current = getStoredUrl();
    const next = window.prompt(
      'Google Doc URL to push updates to (leave blank to disable):',
      current,
    );
    if (next === null) return; // cancelled
    const trimmed = next.trim();
    setStoredUrl(trimmed);
    setStatus(trimmed ? 'connected' : 'idle');
  }

  setStatus(getStoredUrl() ? 'connected' : 'idle');

  return {
    getDocUrl: getStoredUrl,
    setDocUrl: setStoredUrl,
    promptForUrl,
    setStatus,
  };
}
