// The one export dialog, for "Export <block>" and "Export all" alike (see
// ui/AppMenu.js): four rows — JSON, YAML, SVG, Google Docs — each with a
// Download button and a copy-to-clipboard button. What the rows work on
// comes from model/exportTarget.js, so a block and the whole diagram go
// through exactly the same code.

import { el, createDialogShell } from './shareDialogHelpers.js';
import { downloadProjectFile, safeFileStem } from '../model/localFile.js';
import { projectDataToYamlText } from '../model/slimFormat.js';
import { downloadCurrentLevelSvg, renderCurrentLevelSvgString } from '../model/diagramSvg.js';
import { renderCurrentLevelDataUrl, renderCurrentLevelBlob } from '../model/diagramImage.js';

const COPY_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><rect x="8" y="7" width="11" height="13" rx="1.5" fill="none" stroke="currentColor" stroke-width="1.7"/><path d="M5 15V5.5A1.5 1.5 0 0 1 6.5 4H14" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round"/></svg>';
const DONE_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M5 12.5l4.5 4.5L19 7.5" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"/></svg>';
const FAIL_ICON =
  '<svg viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M7 7l10 10M17 7L7 17" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"/></svg>';

// Momentary feedback on the icon button itself, the icon standing in for
// the "Copied!" text flash() gives a text button.
function flashIcon(button, ok) {
  button.innerHTML = ok ? DONE_ICON : FAIL_ICON;
  button.classList.toggle('export-copy-failed', !ok);
  button.title = ok ? 'Copied' : 'Copy blocked — check clipboard permissions';
  clearTimeout(button._flashTimer);
  button._flashTimer = setTimeout(() => {
    button.innerHTML = COPY_ICON;
    button.classList.remove('export-copy-failed');
    button.title = button.dataset.title;
  }, 1400);
}

function downloadDataUrl(dataUrl, filename) {
  const link = document.createElement('a');
  link.href = dataUrl;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function escapeHtml(text) {
  return text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// What the Google Docs row copies: one clipboard write carrying the figure
// and a linked caption together — rich HTML (what Docs and every other
// rich-text target paste), a plain-text fallback, and the raw PNG for
// anything that only takes an image. The <img> embeds the PNG as a data
// URI, so it pastes with nothing hosting the file; Docs re-embeds it as a
// real image. The picture itself links back to the editable diagram, as
// does the caption, so the figure stays a way in months later.
const LINK_LABEL = 'View the editable diagram';

async function copyFigure({ image, description, shareUrl }) {
  const caption = `${description} — ${LINK_LABEL}: ${shareUrl}`;
  const html =
    `<a href="${shareUrl}"><img src="${image.dataUrl}" alt="${escapeHtml(description)}"></a>` +
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
 * `getTarget(scope)` -> exportTargetFor's result for 'selected' or 'all';
 * `getShareUrl(path)` -> the link the Google Docs figure carries, opening
 * the diagram on `path`.
 */
export function createExportDialog({ getTarget, getShareUrl }) {
  const { dialog, body } = createDialogShell('Export');
  const heading = dialog.querySelector('h2');

  function row({ label, hint, filename, onDownload, onCopy }) {
    const wrap = el('div', 'export-row');
    const text = el('div', 'export-row-text');
    text.appendChild(el('span', 'export-row-label', label));
    if (hint) text.appendChild(el('span', 'export-row-hint', hint));
    wrap.appendChild(text);

    const download = el('button', 'share-button', 'Download');
    download.type = 'button';
    download.title = `Download ${filename}`;
    download.addEventListener('click', async () => {
      try {
        await onDownload();
      } catch (err) {
        download.textContent = 'Failed';
        download.title = err.message;
        setTimeout(() => {
          download.textContent = 'Download';
          download.title = `Download ${filename}`;
        }, 1400);
      }
    });

    const copy = el('button', 'share-button export-copy');
    copy.type = 'button';
    copy.innerHTML = COPY_ICON;
    copy.dataset.title = `Copy ${label} to clipboard`;
    copy.title = copy.dataset.title;
    copy.setAttribute('aria-label', copy.title);
    copy.addEventListener('click', async () => {
      try {
        await onCopy();
        flashIcon(copy, true);
      } catch {
        // Clipboard access can legitimately be refused (permissions,
        // insecure context); Download beside it is the fallback.
        flashIcon(copy, false);
      }
    });

    wrap.append(download, copy);
    body.appendChild(wrap);
  }

  return {
    open(scope) {
      const { name, dataProject, figureProject, path } = getTarget(scope);
      const stem = safeFileStem(name);
      // Which level the picture shows — for a block, its interior; for the
      // whole diagram, the level on screen.
      const figureName = figureProject.getContainerBlock()?.name || figureProject.name;
      heading.textContent = scope === 'all' ? 'Export all' : `Export ${name}`;
      body.innerHTML = '';

      const jsonText = () => JSON.stringify(dataProject.toJSON({ linkedAsReference: true }), null, 2);
      const yamlText = () => projectDataToYamlText(dataProject.toJSON({ linkedAsReference: true }));
      const svgText = () => renderCurrentLevelSvgString(figureProject);

      row({
        label: 'JSON',
        hint: 'The full diagram tree, every detail kept.',
        filename: `${stem}.nodigraph.json`,
        onDownload: () => downloadProjectFile(dataProject, 'json'),
        onCopy: () => navigator.clipboard.writeText(jsonText()),
      });
      row({
        label: 'YAML',
        hint: 'A slim, hand-editable rewrite of the same diagram.',
        filename: `${stem}.nodigraph.yaml`,
        onDownload: () => downloadProjectFile(dataProject, 'yaml'),
        onCopy: () => navigator.clipboard.writeText(yamlText()),
      });
      row({
        label: 'SVG',
        hint: `A vector picture of ${figureName}.`,
        filename: `${stem}.svg`,
        onDownload: () => downloadCurrentLevelSvg(figureProject, name),
        onCopy: () => navigator.clipboard.writeText(svgText()),
      });

      // The figure and its link are prepared as the dialog opens rather
      // than on the click, so the clipboard write that follows the click
      // is not kept waiting past the user gesture that permits it.
      const figure = Promise.all([getShareUrl(path), renderCurrentLevelBlob(figureProject)]).then(([shareUrl, blob]) => ({
        shareUrl,
        image: { blob, dataUrl: renderCurrentLevelDataUrl(figureProject) },
      }));
      figure.catch(() => {});
      row({
        label: 'Google Docs',
        hint: 'A PNG figure. Copy carries a caption linking back to the editable diagram — paste straight into a Doc.',
        filename: `${stem}.png`,
        onDownload: () => downloadDataUrl(renderCurrentLevelDataUrl(figureProject), `${stem}.png`),
        onCopy: async () => {
          const { shareUrl, image } = await figure;
          await copyFigure({ image, description: `Block ${figureName}`, shareUrl });
        },
      });

      dialog.showModal();
    },
  };
}
