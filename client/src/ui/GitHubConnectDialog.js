// "Open from GitHub" — a small dialog for pointing nodigraph at a file
// already sitting in a repo, rather than uploading one from disk. The
// target and token stick around (target pre-filled from whatever's
// currently connected, token from localStorage — see model/githubSync.js)
// so re-opening this to switch files, or to save later, doesn't mean
// retyping a token from scratch.

import { el, createDialogShell } from './shareDialogHelpers.js';
import { getStoredToken, setStoredToken, parseGitHubTarget, formatGitHubTarget } from '../model/githubSync.js';

const TOKEN_HELP_URL = 'https://github.com/settings/tokens/new?scopes=repo&description=nodigraph';

/**
 * `onSubmit({ target, token })` does the actual read or write and is
 * expected to throw with a readable message on failure — this dialog just
 * shows it. Used for both "Open from GitHub" and, when nothing is
 * connected yet, "Save to GitHub" — `title`/`buttonLabel`/`busyLabel` are
 * the only things that differ between the two.
 */
export function createGitHubConnectDialog({
  onSubmit,
  initialTarget,
  title = 'Open from GitHub',
  pathPlaceholder = 'owner/repo/path/to/diagram.nodigraph.json',
  buttonLabel = 'Open',
  busyLabel = 'Opening…',
}) {
  const { dialog, body } = createDialogShell(title);

  return {
    open() {
      body.innerHTML = '';

      const targetField = el('div', 'share-field');
      targetField.appendChild(el('label', null, 'Repo path'));
      const targetInput = el('input');
      targetInput.type = 'text';
      targetInput.placeholder = pathPlaceholder;
      targetInput.value = initialTarget ? formatGitHubTarget(initialTarget) : '';
      targetField.appendChild(targetInput);
      targetField.appendChild(
        el('p', 'share-hint', 'A repo/path shorthand, or a github.com blob URL copied from the file.'),
      );
      body.appendChild(targetField);

      const tokenField = el('div', 'share-field');
      tokenField.appendChild(el('label', null, 'Personal access token'));
      const tokenInput = el('input');
      tokenInput.type = 'password';
      tokenInput.placeholder = 'ghp_…';
      tokenInput.value = getStoredToken();
      tokenField.appendChild(tokenInput);
      const tokenHint = el('p', 'share-hint');
      tokenHint.textContent = 'Needed to save changes back, and to read a private repo. ';
      const tokenLink = el('a', null, 'Create one on GitHub');
      tokenLink.href = TOKEN_HELP_URL;
      tokenLink.target = '_blank';
      tokenLink.rel = 'noopener noreferrer';
      tokenHint.appendChild(tokenLink);
      tokenField.appendChild(tokenHint);
      tokenField.appendChild(
        el(
          'p',
          'share-hint',
          'Kept only in this browser and sent only to api.github.com — never to any nodigraph server.',
        ),
      );
      body.appendChild(tokenField);

      const errorText = el('p', 'share-warning');
      errorText.hidden = true;
      body.appendChild(errorText);

      const submitButton = el('button', 'share-button share-button-primary', buttonLabel);
      submitButton.type = 'button';
      submitButton.addEventListener('click', async () => {
        const target = parseGitHubTarget(targetInput.value);
        if (!target) {
          errorText.textContent = "Couldn't read that as owner/repo/path.";
          errorText.hidden = false;
          return;
        }
        const token = tokenInput.value.trim();
        errorText.hidden = true;
        submitButton.disabled = true;
        submitButton.textContent = busyLabel;
        try {
          setStoredToken(token);
          await onSubmit({ target, token });
          dialog.close();
        } catch (err) {
          errorText.textContent = err.message;
          errorText.hidden = false;
        } finally {
          submitButton.disabled = false;
          submitButton.textContent = buttonLabel;
        }
      });
      body.appendChild(submitButton);

      dialog.showModal();
    },
  };
}
