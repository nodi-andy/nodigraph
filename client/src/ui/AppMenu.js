import { showToast } from './Toast.js';
import { LEVEL_OPEN_ZOOMS } from '../render/viewOptions.js';

// Icons are raw inner-<svg> markup rather than a single fill path — several
// of these (the folded-corner page, the settings sliders) need more than
// one shape to read clearly at 18px.
const ICONS = {
  new: '<path d="M6 2h9l5 5v15H6V2z" fill="currentColor"/><path d="M15 2.5V8h5.5" fill="none" stroke="#1e2530" stroke-width="1.4"/>',
  open: '<path d="M4 6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6z" fill="currentColor"/>',
  save: '<path d="M6 2h12v20l-6-4.5L6 22V2z" fill="currentColor"/>',
  export: '<path d="M11 3h2v11.2l3.6-3.6L18 12l-6 6-6-6 1.4-1.4L11 14.2V3zM5 19h14v2H5z" fill="currentColor"/>',
  docs: '<path d="M6 2h9l5 5v15H6V2z" fill="currentColor"/><path d="M15 2.5V8h5.5" fill="none" stroke="#1e2530" stroke-width="1.4"/><path d="M8.5 12.5h7M8.5 15.5h7M8.5 18.5h4" stroke="#1e2530" stroke-width="1.3" stroke-linecap="round"/>',
  settings:
    '<path d="M3 6h9M17 6h4M3 12h3M9 12h12M3 18h12M18 18h3" stroke="currentColor" stroke-width="1.8" stroke-linecap="round"/><circle cx="13" cy="6" r="2" fill="currentColor"/><circle cx="6" cy="12" r="2" fill="currentColor"/><circle cx="15" cy="18" r="2" fill="currentColor"/>',
  chevron: '<path d="M9 6l6 6-6 6" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>',
  // A generic branch/network glyph (three connected nodes) rather than
  // GitHub's own octocat, which is a trademarked logo.
  github:
    '<circle cx="6" cy="6" r="2.5" fill="currentColor"/><circle cx="6" cy="18" r="2.5" fill="currentColor"/><circle cx="18" cy="12" r="2.5" fill="currentColor"/><path d="M6 8.5v7M8 6.8l8 3.7M8 17.2l8-3.7" fill="none" stroke="currentColor" stroke-width="1.6"/>',
};

function svg(name, size = 18) {
  return `<svg viewBox="0 0 24 24" width="${size}" height="${size}" aria-hidden="true">${ICONS[name]}</svg>`;
}

// The sliding drawer's contents — file actions plus a Settings section.
// Undo/redo and Share/Session stay in the header itself (see
// ui/HeaderActions.js); everything less frequent lives here instead, one
// tap behind the hamburger icon.
export function mountAppMenu(
  container,
  {
    onNew,
    onOpen,
    onImport,
    onSaveLocal,
    onExport,
    onOpenFromGitHub,
    onSaveToGitHub,
    onAnimate,
    onImprovedView,
    onLevelOpenZoom,
  },
) {
  container.innerHTML = '';
  container.className = 'app-menu';

  function item(iconName, label, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'app-menu-item';
    button.innerHTML = `${svg(iconName)}<span>${label}</span>`;
    button.addEventListener('click', onClick);
    container.appendChild(button);
    return button;
  }

  function divider() {
    const el = document.createElement('div');
    el.className = 'app-menu-divider';
    container.appendChild(el);
  }

  // A row that expands its body in place rather than opening a second
  // panel or a hover flyout — touch-friendly, and consistent with how
  // Settings (below) already does this. Marked data-keep-menu-open so
  // expanding it doesn't also dismiss the whole drawer (see
  // ui/TopbarMenu.js's click-to-close handling).
  function expandable(iconName, label) {
    const toggle = document.createElement('button');
    toggle.type = 'button';
    toggle.className = 'app-menu-item';
    toggle.setAttribute('aria-expanded', 'false');
    toggle.setAttribute('data-keep-menu-open', '');
    toggle.innerHTML = `${svg(iconName)}<span>${label}</span>${svg('chevron', 14).replace('<svg', '<svg class="app-menu-chevron"')}`;

    const body = document.createElement('div');
    body.className = 'app-menu-settings-body';
    body.hidden = true;

    toggle.addEventListener('click', () => {
      const expanded = toggle.getAttribute('aria-expanded') === 'true';
      toggle.setAttribute('aria-expanded', String(!expanded));
      body.hidden = expanded;
    });

    container.append(toggle, body);
    return body;
  }

  // A sub-item inside an expandable body — same look as a top-level item,
  // just indented under the row that expanded it.
  function subItem(body, label, onClick) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'app-menu-item app-menu-subitem';
    button.textContent = label;
    button.addEventListener('click', onClick);
    body.appendChild(button);
    return button;
  }

  item('new', 'New', () => onNew());

  // Open replaces what's on screen with the file (asking first if there
  // are unsaved edits); Import (below) adds the file as one new block of
  // the current level with the file's diagram inside it.
  const openInput = document.createElement('input');
  openInput.type = 'file';
  openInput.accept = 'application/json,.json,text/yaml,.yaml,.yml';
  openInput.hidden = true;
  openInput.addEventListener('change', () => {
    const file = openInput.files?.[0];
    openInput.value = '';
    if (file) onOpen(file);
  });
  container.appendChild(openInput);
  item('open', 'Open', () => openInput.click());

  // "Save" writes the diagram into this browser's own storage (see
  // model/store.js) — the document that comes back on the next plain
  // visit. Links live in Share (header), files in Export, repos in GitHub.
  const saveButton = item('save', 'Save', async () => {
    const result = await onSaveLocal();
    if (!result.ok) {
      showToast(`Couldn't save in this browser: ${result.error}. Use Export instead.`);
      return;
    }
    showToast('Saved in this browser.');
  });

  divider();

  const fileInput = document.createElement('input');
  fileInput.type = 'file';
  // .yaml/.yml alongside .json (and their MIME types) — model/localFile.js's
  // readProjectFile tells the two apart by extension, content as a
  // fallback for a renamed file.
  fileInput.accept = 'application/json,.json,text/yaml,.yaml,.yml';
  fileInput.hidden = true;
  fileInput.addEventListener('change', () => {
    const file = fileInput.files?.[0];
    fileInput.value = ''; // allow picking the same file again later
    if (file) onImport(file);
  });
  container.appendChild(fileInput);

  item('open', 'Import', () => fileInput.click());

  // Two plain rows, no submenu: the selected block, and the whole diagram.
  // Each opens the export dialog (ui/ExportDialog.js), where the format
  // (JSON, YAML, SVG, Google Docs) and download-or-copy are chosen. The
  // block row only exists while a block is selected — its label carries
  // the block's name (see refreshExportTarget), so an empty one would say
  // nothing.
  const exportSelectedButton = item('export', 'Export', () => onExport('selected'));
  exportSelectedButton.hidden = true;
  exportSelectedButton.querySelector('span').classList.add('app-menu-export-target');
  item('export', 'Export all', () => onExport('all'));

  divider();

  const githubBody = expandable('github', 'GitHub');
  subItem(githubBody, 'Open', () => onOpenFromGitHub());
  subItem(githubBody, 'Save', () => onSaveToGitHub());

  divider();

  const settingsBody = expandable('settings', 'Settings');

  const animateLabel = document.createElement('label');
  animateLabel.className = 'app-menu-toggle-row';
  const animateCheckbox = document.createElement('input');
  animateCheckbox.type = 'checkbox';
  animateCheckbox.addEventListener('change', () => onAnimate());
  const animateText = document.createElement('span');
  animateText.textContent = 'Animate';
  animateLabel.append(animateCheckbox, animateText);

  // The chip look — a block's side wall and the drop shadow under it (see
  // render/viewOptions.js). Off by default because it costs two blurred
  // fills per block, which is what a large diagram stalls on; on for
  // anyone whose diagram is small enough not to notice.
  const improvedLabel = document.createElement('label');
  improvedLabel.className = 'app-menu-toggle-row';
  improvedLabel.title = 'Draw blocks as raised chips with a shadow. Slower on large diagrams.';
  const improvedCheckbox = document.createElement('input');
  improvedCheckbox.type = 'checkbox';
  improvedCheckbox.addEventListener('change', () => onImprovedView(improvedCheckbox.checked));
  const improvedText = document.createElement('span');
  improvedText.textContent = 'Improved view';
  improvedLabel.append(improvedCheckbox, improvedText);

  // How early a block's level appears on its face. The blocks inside are
  // drawn smaller the sooner it opens, so this is a trade between seeing
  // the whole system at once and keeping the level you are editing clear
  // of everything below it (see render/viewOptions.js).
  const openRow = document.createElement('label');
  openRow.className = 'app-menu-toggle-row';
  openRow.title = 'How far you have to zoom in before a block shows what is inside it.';
  const openSelect = document.createElement('select');
  for (const { value, label } of LEVEL_OPEN_ZOOMS) {
    const option = document.createElement('option');
    option.value = String(value);
    option.textContent = label;
    openSelect.appendChild(option);
  }
  openSelect.addEventListener('change', () => onLevelOpenZoom(Number(openSelect.value)));
  const openText = document.createElement('span');
  openText.textContent = 'Show contents';
  openRow.append(openText, openSelect);

  settingsBody.append(animateLabel, improvedLabel, openRow);

  return {
    // The dot marks edits made since Save was last pressed, so "Save" is
    // never a row whose effect you have to guess at. It only appears once
    // there is something to be out of date *with* — before the first save
    // there is nothing to warn about.
    refreshSaved(saved) {
      saveButton.classList.toggle('unsaved', saved === false);
      saveButton.title =
        saved === false
          ? 'Edits since this diagram was last saved in this browser — click to save them'
          : 'Save this diagram in this browser, so a plain visit or a reload brings it back';
    },

    refreshAnimating(on) {
      animateCheckbox.checked = on;
    },

    refreshImprovedView(on) {
      improvedCheckbox.checked = on;
    },

    refreshLevelOpenZoom(value) {
      openSelect.value = String(value);
    },

    // The block row's label follows the selection: "Export <name>", or no
    // row at all while nothing is selected.
    refreshExportTarget(name) {
      exportSelectedButton.hidden = !name;
      if (name) exportSelectedButton.querySelector('span').textContent = `Export ${name}`;
    },

    // Ctrl/Cmd+S routes through the button rather than duplicating its
    // logic, so the shortcut and the click can't drift apart.
    triggerSave() {
      saveButton.click();
    },
  };
}
