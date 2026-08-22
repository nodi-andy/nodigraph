// "Live session" — status and the invite link for a session in progress.
// Starting one is a header action (see ui/HeaderActions.js: it puts the
// whole app into a mode, not a one-off share), but this is where its
// details live once it's running — this dialog is what that button opens.

import { el, copyRow, createDialogShell } from './shareDialogHelpers.js';

/**
 * `session.getState()` -> { state, role, peers }, `session.stop()` ends it.
 */
export function createLiveSessionDialog({ session }) {
  const { dialog, body } = createDialogShell('Live session');
  let inviteUrl = '';

  // Peer-to-peer collaboration. The point worth making in the UI is where
  // the data goes: a public broker introduces the two browsers to each
  // other, and from then on edits travel directly between them.
  function render() {
    body.innerHTML = '';
    const status = session.getState();

    if (status.state === 'connecting') {
      body.appendChild(el('p', 'share-hint', 'Connecting…'));
      return;
    }

    if (status.state !== 'live') {
      body.appendChild(
        el(
          'p',
          'share-hint',
          'No session is running. Use “Start Session” in the toolbar above to edit this diagram together with someone in real time. The diagram itself never reaches a server: a public broker is used only to introduce the two browsers, then edits travel directly between them.',
        ),
      );
      if (status.state === 'error') {
        body.appendChild(el('p', 'share-warning', 'The last session ended with a connection error.'));
      }
      return;
    }

    if (status.role === 'host' && inviteUrl) {
      body.appendChild(
        copyRow(
          'Invite link',
          inviteUrl,
          'Whoever opens this joins the same diagram live. Edits travel browser-to-browser; only the connection handshake goes through a public server.',
        ),
      );
    } else {
      body.appendChild(el('p', 'share-hint', 'Connected to the host’s session.'));
    }

    // Counted the same way the banner button counts, everyone including
    // you — two places reporting the same session with different numbers
    // reads as one of them being wrong.
    const total = status.peers + 1;
    body.appendChild(
      el(
        'p',
        'share-hint',
        total === 1 ? 'Just you so far — send someone the invite link.' : `${total} people in this session, including you.`,
      ),
    );

    const stop = el('button', 'share-button', 'End session');
    stop.type = 'button';
    stop.addEventListener('click', () => {
      session.stop();
      inviteUrl = '';
      render();
    });
    body.appendChild(stop);

    const warning = el('p', 'share-warning');
    warning.textContent =
      'The session lasts only while this tab is open, and edits are last-write-wins — two people changing the same block at the same moment will still overwrite each other.';
    body.appendChild(warning);
  }

  return {
    // Called on every peer-session change so an open dialog reflects
    // people joining or leaving without needing to be reopened.
    refresh() {
      if (dialog.open) render();
    },

    // The invite link is built by whoever started the session (main.js),
    // since only that side knows the session id.
    setInviteUrl(url) {
      inviteUrl = url;
    },

    open() {
      dialog.showModal();
      render();
    },
  };
}
