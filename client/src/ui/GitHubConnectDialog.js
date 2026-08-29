// "Open from GitHub" — a small dialog for pointing nodigraph at a file
// already sitting in a repo, rather than uploading one from disk. The
// target and token stick around (target pre-filled from whatever's
// currently connected, token from localStorage — see model/githubSync.js)
// so re-opening this to switch files, or to save later, doesn't mean
// retyping a token from scratch.

import { el, createDialogShell, flash } from './shareDialogHelpers.js';
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
  // A function, not a value: re-read on every open() so a target set after
  // this dialog was created (e.g. by loading a different diagram from
  // GitHub in between) still pre-fills correctly instead of showing
  // whatever was current back when the dialog was first built.
  getInitialTarget = () => null,
  title = 'Open from GitHub',
  pathPlaceholder = 'owner/repo/path/to/diagram.nodigraph.json',
  buttonLabel = 'Open',
  busyLabel = 'Opening…',
  // Writing always needs a token, on any repo — GitHub never accepts an
  // unauthenticated write, public or not — so Save keeps the field shown
  // up front. Reading a public repo needs none at all, so Open starts
  // with it collapsed behind a link and only reveals it if it turns out
  // to be needed (see the 401/404 handling below), rather than making
  // every open ask for a credential most repos don't require.
  tokenRequired = true,
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
      const initialTarget = getInitialTarget();
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
      tokenHint.textContent = tokenRequired
        ? 'Needed to save changes back, even to a public repo. '
        : 'Only needed for a private repo — a public one opens with nothing. ';
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

      // Collapsed by default when a token isn't strictly required and none
      // is already on file — the common case (opening a public repo) then
      // never shows a credential field at all. The link itself still gets
      // built even when a stored token means it starts hidden: forgetting
      // that token (below) needs it to reappear, and it can't if this
      // never existed in the first place.
      let revealLink = null;
      if (!tokenRequired) {
        revealLink = el('button', 'share-link-button', 'Private repo? Add a personal access token');
        revealLink.type = 'button';
        revealLink.hidden = Boolean(getStoredToken());
        revealLink.addEventListener('click', () => {
          tokenField.hidden = false;
          revealLink.hidden = true;
          tokenInput.focus();
        });
        body.insertBefore(revealLink, tokenField);
      }
      tokenField.hidden = !tokenRequired && !getStoredToken();

      // Only shown once a token is actually on file — blanking the field
      // and submitting already clears it (setStoredToken('') removes the
      // key), but that's not a discoverable way to do it. This makes
      // "stop remembering my token" its own explicit action, worth having
      // on a shared or public machine.
      if (getStoredToken()) {
        const forgetButton = el('button', 'share-link-button', 'Forget this token');
        forgetButton.type = 'button';
        forgetButton.addEventListener('click', () => {
          setStoredToken('');
          tokenInput.value = '';
          flash(forgetButton, 'Forgotten');
          if (!tokenRequired) {
            // Back to the same collapsed state a repo that's never needed
            // a token starts in, once the "Forgotten" flash has been seen.
            setTimeout(() => {
              tokenField.hidden = true;
              if (revealLink) revealLink.hidden = false;
            }, 1400);
          }
        });
        tokenField.appendChild(forgetButton);
      }

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
          // A repo GitHub won't show to an unauthenticated request (private,
          // or nonexistent — it can't tell the two apart on purpose) comes
          // back as a 404 here; surfacing the token field right when that
          // happens beats leaving the user to guess why a plain path didn't
          // just work.
          if (!token && tokenField.hidden && (err.status === 401 || err.status === 404)) {
            tokenField.hidden = false;
            if (revealLink) revealLink.hidden = true;
            errorText.textContent = `${err.message} — this repo may be private and need a token below.`;
          } else {
            errorText.textContent = err.message;
          }
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
