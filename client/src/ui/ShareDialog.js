// The share surface, replacing the old window.prompt. Three tabs, because
// there are genuinely three different jobs:
//
//   Link         — hand someone the editable diagram (the URL *is* the file)
//   Google Docs  — drop a figure into a document that still points back at
//                  the editable diagram
//   Live session — edit it together, right now (see model/peerSession.js)
//
// The Google Docs tab exists because a picture in a doc is a dead end
// otherwise: six months later nobody knows where the source lives. Google
// Docs gives every image an alt-text "Title" and "Description" field, so
// the recipe here is to put the block's name in the description and the
// noditron link in the title — the figure carries its own way back.

const TABS = ['Link', 'Google Docs', 'Live session'];

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
export function createShareDialog({ getShareUrl, renderImage, getFigureName, session }) {
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
  let inviteUrl = '';

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

  // Peer-to-peer collaboration. Starting a session is a banner button (see
  // ui/FileToolbar.js) because it puts the whole app into a mode; this tab
  // is where the session's details live once it is running — above all the
  // invite link, which is the only thing anyone needs to copy out of it.
  // The point worth making in the UI is where the data goes: a public
  // broker introduces the two browsers to each other, and from then on
  // edits travel directly between them.
  function renderSessionTab() {
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
          'No session is running. Use \u201cStart Session\u201d in the toolbar above to edit this diagram together with someone in real time. The diagram itself never reaches a server: a public broker is used only to introduce the two browsers, then edits travel directly between them.',
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
      body.appendChild(el('p', 'share-hint', 'Connected to the host\u2019s session.'));
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
      renderBody();
    });
    body.appendChild(stop);

    const warning = el('p', 'share-warning');
    warning.textContent =
      'The session lasts only while this tab is open, and edits are last-write-wins — two people changing the same block at the same moment will still overwrite each other.';
    body.appendChild(warning);
  }

  function renderBody() {
    if (activeTab === 'Link') renderLinkTab();
    else if (activeTab === 'Google Docs') renderDocsTab();
    else renderSessionTab();
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
    // Called on every peer-session change so an open dialog reflects
    // people joining or leaving without needing to be reopened.
    refreshSession() {
      if (dialog.open && activeTab === 'Live session') renderSessionTab();
    },

    // The invite link is built by whoever started the session (main.js),
    // since only that side knows the session id.
    setInviteUrl(url) {
      inviteUrl = url;
    },

    async open(tab = TABS[0]) {
      activeTab = TABS.includes(tab) ? tab : TABS[0];
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
