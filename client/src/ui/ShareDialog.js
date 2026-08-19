// The share surface, replacing the old window.prompt. Two tabs because
// there are genuinely two different jobs:
//
//   Link        — hand someone the editable diagram (the URL *is* the file)
//   Google Docs — drop a figure into a document that still points back at
//                 the editable diagram
//
// The Google Docs tab exists because a picture in a doc is a dead end
// otherwise: six months later nobody knows where the source lives. Google
// Docs gives every image an alt-text "Title" and "Description" field, so
// the recipe here is to put the block's name in the description and the
// noditron link in the title — the figure carries its own way back.

const TABS = ['Link', 'Google Docs'];

function el(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text != null) node.textContent = text;
  return node;
}

// Momentary "Copied!" feedback on the button itself — a toast would be
// more machinery than a two-word confirmation needs.
function flash(button, message = 'Copied!') {
  const original = button.dataset.label || button.textContent;
  button.dataset.label = original;
  button.textContent = message;
  clearTimeout(button._flashTimer);
  button._flashTimer = setTimeout(() => {
    button.textContent = button.dataset.label;
  }, 1400);
}

async function copyText(value, button) {
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
function copyRow(labelText, value, hint) {
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

/**
 * `getShareUrl` is async (encoding + compressing the project isn't free),
 * `renderImage` returns { dataUrl, blob }, and `getFigureName` is whatever
 * the current level is called — that's what goes in the figure's
 * description.
 */
export function createShareDialog({ getShareUrl, renderImage, getFigureName }) {
  const dialog = el('dialog', 'share-dialog');

  const header = el('div', 'share-header');
  header.appendChild(el('h2', null, 'Share'));
  const closeButton = el('button', 'share-close', '✕');
  closeButton.type = 'button';
  closeButton.setAttribute('aria-label', 'Close');
  closeButton.addEventListener('click', () => dialog.close());
  header.appendChild(closeButton);

  const tabBar = el('div', 'share-tabs');
  const body = el('div', 'share-body');
  dialog.append(header, tabBar, body);
  document.body.appendChild(dialog);

  let activeTab = TABS[0];
  let shareUrl = '';
  let image = null;

  function renderLinkTab() {
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
  }

  function renderDocsTab() {
    body.innerHTML = '';
    const figureName = getFigureName();

    const preview = el('div', 'share-preview');
    if (image) {
      const img = el('img');
      img.src = image.dataUrl;
      img.alt = `Diagram of ${figureName}`;
      preview.appendChild(img);
    }
    body.appendChild(preview);

    const actions = el('div', 'share-row');
    const copyImageButton = el('button', 'share-button share-button-primary', 'Copy image');
    copyImageButton.type = 'button';
    copyImageButton.addEventListener('click', async () => {
      try {
        // ClipboardItem is the only way to put real image bytes on the
        // clipboard; not every browser allows it, hence the download
        // button beside it.
        await navigator.clipboard.write([new ClipboardItem({ 'image/png': image.blob })]);
        flash(copyImageButton);
      } catch {
        flash(copyImageButton, 'Use Download');
      }
    });

    const downloadButton = el('button', 'share-button', 'Download PNG');
    downloadButton.type = 'button';
    downloadButton.addEventListener('click', () => {
      const link = el('a');
      link.href = image.dataUrl;
      link.download = `${figureName.replace(/[^a-z0-9 _-]/gi, '').trim() || 'diagram'}.png`;
      document.body.appendChild(link);
      link.click();
      link.remove();
    });
    actions.append(copyImageButton, downloadButton);
    body.appendChild(actions);

    const steps = el('ol', 'share-steps');
    for (const step of [
      'Paste the image into your Google Doc.',
      'Right-click it → Alt text.',
      'Paste the two values below into Title and Description.',
    ]) {
      steps.appendChild(el('li', null, step));
    }
    body.appendChild(steps);

    body.appendChild(
      copyRow('Title — the link back to this diagram', shareUrl, 'Anyone reading the doc can open the live, editable diagram from the figure itself.'),
    );
    body.appendChild(copyRow('Description — what the figure shows', `Block ${figureName}`));
  }

  function renderBody() {
    if (activeTab === 'Link') renderLinkTab();
    else renderDocsTab();
  }

  function renderTabs() {
    tabBar.innerHTML = '';
    for (const tab of TABS) {
      const button = el('button', 'share-tab' + (tab === activeTab ? ' active' : ''), tab);
      button.type = 'button';
      button.addEventListener('click', () => {
        activeTab = tab;
        renderTabs();
        renderBody();
      });
      tabBar.appendChild(button);
    }
  }

  return {
    async open() {
      body.innerHTML = '';
      body.appendChild(el('p', 'share-hint', 'Preparing…'));
      renderTabs();
      dialog.showModal();

      shareUrl = await getShareUrl();
      image = await renderImage();
      renderBody();
    },
  };
}
