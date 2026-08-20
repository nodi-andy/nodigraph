// "Export to Google Docs" — one button that copies a diagram figure the
// way it needs to travel: as one clipboard write carrying the image and a
// linked caption together, so pasting into a Doc drops in both at once
// instead of asking someone to paste an image, then alt-text a title,
// then alt-text a description by hand.

import { el, flash, createDialogShell } from './shareDialogHelpers.js';

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// A single ClipboardItem with three representations of the same content —
// rich HTML (what Google Docs and every other rich-text target actually
// paste), a plain-text fallback for anything that only reads text, and the
// raw PNG for anything that only accepts an image. The HTML embeds the
// diagram as a data URI directly in the <img> tag rather than pointing at
// a URL, so the picture pastes even though nothing is hosting the file
// anywhere — Docs decodes and re-embeds it as a real image in the
// document, not a broken link.
// The visible link text is a short label, not the raw URL — a share link
// is long (the whole diagram lives in it), and spelling it out in the
// pasted paragraph would bury the one sentence anyone reading the doc
// actually needs. Plain text has no such thing as a hyperlink, so its
// fallback spells the URL out instead; that's the only place the raw
// address appears.
const LINK_LABEL = 'View the editable diagram';

async function copyFigure({ image, description, shareUrl }) {
  const caption = `${description} — ${LINK_LABEL}: ${shareUrl}`;
  const html =
    `<img src="${image.dataUrl}" alt="${escapeHtml(description)}">` +
    `<p>${escapeHtml(description)} — <a href="${shareUrl}">${escapeHtml(LINK_LABEL)}</a></p>`;

  await navigator.clipboard.write([
    new ClipboardItem({
      'text/html': new Blob([html], { type: 'text/html' }),
      'text/plain': new Blob([caption], { type: 'text/plain' }),
      'image/png': image.blob,
    }),
  ]);
}

/**
 * `getShareUrl` -> string, `renderImage` -> { dataUrl, blob }, and
 * `getFigureName` is whatever the current level is called — that's what
 * goes in the pasted caption as "Block <name>".
 */
export function createGoogleDocsExportDialog({ getShareUrl, renderImage, getFigureName }) {
  const { dialog, body } = createDialogShell('Export to Google Docs');

  return {
    async open() {
      body.innerHTML = '';
      body.appendChild(el('p', 'share-hint', 'Preparing…'));
      dialog.showModal();

      const [shareUrl, image] = await Promise.all([getShareUrl(), renderImage()]);
      const figureName = getFigureName();
      const description = `Block ${figureName}`;

      body.innerHTML = '';

      const preview = el('div', 'share-preview');
      const img = el('img');
      img.src = image.dataUrl;
      img.alt = `Diagram of ${figureName}`;
      preview.appendChild(img);
      body.appendChild(preview);

      const captionRow = el('p', 'share-hint', `${description} — `);
      const link = el('a', null, LINK_LABEL);
      link.href = shareUrl;
      captionRow.appendChild(link);
      body.appendChild(captionRow);

      const copyButton = el('button', 'share-button share-button-primary', 'Copy');
      copyButton.type = 'button';
      copyButton.addEventListener('click', async () => {
        try {
          await copyFigure({ image, description, shareUrl });
          flash(copyButton);
        } catch {
          // Clipboard writes with multiple MIME types need a secure
          // context and, in some browsers, an explicit permission — with
          // no visible fields left to fall back to (that's the whole
          // point of one Copy button), saying so is all there is to do.
          flash(copyButton, 'Copy blocked — check permissions');
        }
      });
      body.appendChild(copyButton);

      const hint = el(
        'p',
        'share-hint',
        'Paste directly into a Google Doc — the image and a linked caption come across together, so the figure still points back to the editable diagram months from now.',
      );
      body.appendChild(hint);
    },
  };
}
