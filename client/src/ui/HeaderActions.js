// The handful of actions that stay visible in the header no matter what —
// undo/redo (reached far more often than anything in the app menu) and
// Share/Start Session (starting or handing off a diagram is a click you
// want available immediately, not one drawer-open away). Everything else
// lives in the sliding app menu instead (see ui/AppMenu.js).
export function mountHeaderActions(container, { onUndo, onRedo, canUndo, canRedo, onShare, onSession }) {
  container.innerHTML = '';
  container.className = 'header-actions';

  const iconButton = (path, title, onClick, extraClass = '') => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = `header-icon-button ${extraClass}`.trim();
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

  const shareButton = iconButton(
    'M18 16.08c-.76 0-1.44.3-1.96.77L8.91 12.7c.05-.23.09-.46.09-.7s-.04-.47-.09-.7l7.05-4.11c.54.5 1.25.81 2.04.81 1.66 0 3-1.34 3-3s-1.34-3-3-3-3 1.34-3 3c0 .24.04.47.09.7L8.04 9.81C7.5 9.31 6.79 9 6 9c-1.66 0-3 1.34-3 3s1.34 3 3 3c.79 0 1.5-.31 2.04-.81l7.12 4.16c-.05.21-.08.43-.08.65 0 1.61 1.31 2.92 2.92 2.92 1.61 0 2.92-1.31 2.92-2.92s-1.31-2.92-2.92-2.92z',
    'Get a URL that opens this diagram directly, with no server or account needed',
    () => onShare(),
  );

  // Two overlapping cursors rather than a generic "people" glyph — this is
  // literally what a live session shows you (see main.js's remote-cursor
  // broadcasting), so the icon is the feature rather than a stand-in for it.
  const sessionButton = document.createElement('button');
  sessionButton.type = 'button';
  sessionButton.className = 'header-icon-button session-button';
  sessionButton.innerHTML = `
    <svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true">
      <path d="M2 2L6.7 13L8 8.3L13 6.7Z" fill="currentColor" opacity="0.5"/>
      <path d="M8 8L14 20.5L15.7 15L21 13.3Z" fill="currentColor"/>
    </svg>
    <span class="session-peer-badge" hidden></span>
  `;
  sessionButton.addEventListener('click', () => onSession());
  const peerBadge = sessionButton.querySelector('.session-peer-badge');

  container.append(undoButton, redoButton, shareButton, sessionButton);

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
      sessionButton.classList.toggle('connecting', connecting);
      sessionButton.disabled = connecting;
      if (connecting) {
        sessionButton.title = 'Setting up the live session…';
        peerBadge.hidden = true;
        return;
      }
      sessionButton.title = live
        ? `Live session in progress · ${status.peers + 1} here — click for the invite link`
        : 'Edit this diagram together with someone, browser to browser';
      peerBadge.hidden = !live;
      if (live) peerBadge.textContent = String(status.peers + 1);
    },
  };
}
