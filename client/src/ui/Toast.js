// A small stack of dismissible messages, independent of any single
// feature's own UI — unlike FileToolbar's inline toast (which only makes
// sense right next to the buttons it's reporting on), this one can be
// shown before the rest of the app has mounted anything (e.g. a corrupted
// share link, discovered while main.js is still loading the project) as
// well as from fully-mounted features like the onboarding sequence.
let stackEl = null;

function getStack() {
  if (!stackEl) {
    stackEl = document.createElement('div');
    stackEl.className = 'app-toast-stack';
    document.body.appendChild(stackEl);
  }
  return stackEl;
}

// `actions` are rendered as buttons; clicking any of them (or letting the
// auto-dismiss timer run out) removes the toast. Defaults to a single "OK"
// so a plain informational message doesn't need a caller-supplied action
// just to be dismissible. Pass `autoDismissMs: 0` for a message that should
// only go away when the user acts on it (e.g. an onboarding step).
export function showToast(message, { actions = [{ label: 'OK' }], autoDismissMs = 10000 } = {}) {
  const stack = getStack();
  const toast = document.createElement('div');
  toast.className = 'app-toast';

  const text = document.createElement('div');
  text.className = 'app-toast-text';
  text.textContent = message;
  toast.appendChild(text);

  const dismiss = () => toast.remove();

  const buttonRow = document.createElement('div');
  buttonRow.className = 'app-toast-actions';
  for (const action of actions) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'app-toast-button';
    button.textContent = action.label;
    button.addEventListener('click', () => {
      action.onClick?.();
      dismiss();
    });
    buttonRow.appendChild(button);
  }
  toast.appendChild(buttonRow);

  stack.appendChild(toast);
  if (autoDismissMs) setTimeout(dismiss, autoDismissMs);
  return dismiss;
}
