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

async function copyFigure({ image, description, shareUrl, includeSvg }) {
  const caption = `${description} — ${LINK_LABEL}: ${shareUrl}`;
  // The <img> here always points at the PNG, even with "Also copy as SVG"
  // checked: Google Docs (and most other rich-text targets) paste from
  // this HTML flavor first, and its own paste handling doesn't reliably
  // rasterize an SVG source — so the one thing this dialog is actually
  // named for has to keep working regardless of the checkbox.
  // The image itself is a link too, not just the caption below it — most
  // people reach for the picture first, and a figure that's a dead end
  // until you notice the caption underneath defeats the point.
  const html =
    `<a href="${shareUrl}"><img src="${image.dataUrl}" alt="${escapeHtml(description)}"></a>` +
    `<p>${escapeHtml(description)} — <a href="${shareUrl}">${escapeHtml(LINK_LABEL)}</a></p>`;

  const items = {
    'text/html': new Blob([html], { type: 'text/html' }),
    'text/plain': new Blob([caption], { type: 'text/plain' }),
    'image/png': image.blob,
  };
  // A second, additional clipboard flavor — not a replacement for the PNG
  // above — for whatever the paste target is, if it specifically prefers
  // a vector image over the HTML flavor's raster one. Attempted rather
  // than assumed: not every browser accepts an SVG entry in a
  // ClipboardItem, and a paste that still works without it is better than
  // one that fails outright because this one extra flavor was rejected.
  if (includeSvg) {
    try {
      await navigator.clipboard.write([new ClipboardItem({ ...items, 'image/svg+xml': image.svgBlob })]);
      return;
    } catch {
      // Fall through to the PNG-only copy below.
    }
  }
  await navigator.clipboard.write([new ClipboardItem(items)]);
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

      // Off by default so the copy this dialog is named for — pasting
      // into a Google Doc — behaves exactly as it always has unless
      // someone opts into the extra flavor for a different paste target.
      const svgOption = el('label', 'share-checkbox-row');
      const svgCheckbox = document.createElement('input');
      svgCheckbox.type = 'checkbox';
      svgOption.appendChild(svgCheckbox);
      svgOption.appendChild(
        document.createTextNode(' Also copy as SVG (Google Docs still pastes the PNG above either way)'),
      );
      body.appendChild(svgOption);

      const copyButton = el('button', 'share-button share-button-primary', 'Copy');
      copyButton.type = 'button';
      copyButton.addEventListener('click', async () => {
        try {
          await copyFigure({ image, description, shareUrl, includeSvg: svgCheckbox.checked });
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
