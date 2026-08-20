// Shared plumbing for the three single-purpose share dialogs — Share
// (link), Export to Google Docs, and Live session. They used to be one
// tabbed dialog; split apart so each opens directly on the one thing its
// own toolbar button says, with nothing else to tab past to get there.

export function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// Momentary "Copied!" feedback on the button itself — a toast would be
// more machinery than a two-word confirmation needs.
export function flash(button, message = 'Copied!') {
  const original = button.dataset.label || button.textContent;
  button.dataset.label = original;
  button.textContent = message;
  clearTimeout(button._flashTimer);
  button._flashTimer = setTimeout(() => {
    button.textContent = button.dataset.label;
  }, 1400);
}

export async function copyText(value, button) {
  try {
    await navigator.clipboard.writeText(value);
    flash(button);
  } catch {
    // Clipboard can legitimately refuse (permissions, insecure context).
    // The value is already selectable in the field next to the button, so
    // say what happened rather than failing silently.
    flash(button, 'Press Ctrl+C');
  }
}

// A labelled read-only field plus its own copy button.
export function copyRow(labelText, value, hint) {
  const wrap = el('div', 'share-field');
  wrap.appendChild(el('label', null, labelText));

  const row = el('div', 'share-row');
  const input = el('input');
  input.type = 'text';
  input.readOnly = true;
  input.value = value;
  input.addEventListener('focus', () => input.select());

  const button = el('button', 'share-button', 'Copy');
  button.type = 'button';
  button.addEventListener('click', () => copyText(input.value, button));

  row.append(input, button);
  wrap.appendChild(row);
  if (hint) wrap.appendChild(el('p', 'share-hint', hint));
  return wrap;
}

// The shared modal shell every one of the three dialogs starts from: a
// <dialog>, a header with its own title and a close button, and an empty
// body the caller fills in each time it opens.
export function createDialogShell(title) {
  const dialog = el('dialog', 'share-dialog');

  const header = el('div', 'share-header');
  header.appendChild(el('h2', null, title));
  const closeButton = el('button', 'share-close', '✕');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Close');
  closeButton.addEventListener('click', () => dialog.close());
  header.appendChild(closeButton);

  const body = el('div', 'share-body');
  dialog.append(header, body);
  document.body.appendChild(dialog);

  return { dialog, body };
}
