// "Share" — the whole diagram as a URL, for handing to someone else. Its
// own dialog now rather than one tab of three: opening this used to mean
// landing on a page that also talked about Google Docs and live sessions,
// neither relevant to "I just want the link."

import { el, copyRow, createDialogShell } from './shareDialogHelpers.js';

/**
 * `getShareUrl` is async — encoding and compressing the project isn't free.
 */
export function createShareLinkDialog({ getShareUrl }) {
  const { dialog, body } = createDialogShell('Share');

  return {
    async open() {
      body.innerHTML = '';
      body.appendChild(el('p', 'share-hint', 'Preparing…'));
      dialog.showModal();

      const shareUrl = await getShareUrl();

      body.innerHTML = '';
      body.appendChild(
        copyRow(
          'Link to this diagram',
          shareUrl,
          'The whole diagram is encoded in the URL itself — no account, nothing stored on a server. Anyone with the link can open and edit it.',
        ),
      );

      const warning = el('p', 'share-warning');
      warning.textContent =
        'Editing a shared link makes a new link. Two people editing the same one will not see each other\'s changes — send the updated link back to share edits.';
      body.appendChild(warning);
    },
  };
}
