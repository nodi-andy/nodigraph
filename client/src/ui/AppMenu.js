import { showToast } from './Toast.js';

// Icons are raw inner-<svg> markup rather than a single fill path — several
// of these (the folded-corner page, the settings sliders) need more than
// one shape to read clearly at 18px.
const ICONS = {
  new: '<path d="M6 2h9l5 5v15H6V2z" fill="currentColor"/><path d="M15 2.5V8h5.5" fill="none" stroke="#1e2530" stroke-width="1.4"/>',
  open: '<path d="M4 6a2 2 0 0 1 2-2h4l2 2h6a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6z" fill="currentColor"/>',
  save: '<path d="M6 2h12v20l-6-4.5L6 22V2z" fill="currentColor"/>',
  export: '<path d="M11 3h2v11.2l3.6-3.6L18 12l-6 6-6-6 1.4-1.4L11 14.2V3zM5 19h14v2H5z" fill="currentColor"/>',
  image:
    '<rect x="3.5" y="4.5" width="17" height="14" rx="2" fill="none" stroke="currentColor" stroke-width="1.6"/><circle cx="9" cy="10" r="1.6" fill="currentColor"/><path d="M4.5 16.5l4.5-4.5 3 3 4-4 4.5 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/>',
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
    onSaveUrl,
    onExportFile,
    onExportSvg,
    onExportGoogleDocs,
    onOpenFromGitHub,
    onSaveToGitHub,
    onAnimate,
    onToggleDarkMode,
  },
) {
  container.innerHTML = '';
  container.className = 'app-menu';

  const BOOKMARK_KEYS = /Mac|iPhone|iPad/.test(navigator.userAgent) ? '⌘D' : 'Ctrl+D';
  // Reloading sends the whole address to the server, and a lot of servers
  // and proxies cap the request line around 8 KB — so a diagram can be
  // saved successfully and still fail to open later.
  const LONG_URL_CHARS = 8000;

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

  // "Save" writes the diagram into the address bar, because that is where
  // this app's documents actually live — there is no server file to write
  // and no account to write it under (see model/shareLink.js).
  const saveButton = item('save', 'Save', async () => {
    const result = await onSaveUrl();
    if (!result.ok) {
      showToast(`Couldn't save into the address: ${result.error}. Use Export instead.`);
      return;
    }
    const bookmark = `press ${BOOKMARK_KEYS} to bookmark it, or copy the address bar`;
    showToast(
      result.length > LONG_URL_CHARS
        ? `Saved — ${bookmark}. Note this address is ${Math.round(result.length / 1024)} KB; some servers and proxies reject links over about 8 KB, so keep an exported file as well.`
        : `Saved into this page's address — ${bookmark}.`,
    );
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
    if (file) onOpen(file);
  });
  container.appendChild(fileInput);

  item('open', 'Import', () => fileInput.click());
  item('github', 'Open from GitHub', () => onOpenFromGitHub());

  const exportBody = expandable('export', 'Export');
  subItem(exportBody, 'JSON', () => onExportFile('json'));
  subItem(exportBody, 'YAML', () => onExportFile('yaml'));

  // A rendered picture of the diagram, not project data — kept as its own
  // row rather than a third format under Export above, the same way
  // "Export to Google Docs" right below it is also a picture, not data.
  item('image', 'Export as SVG', () => onExportSvg());
  item('docs', 'Export to Google Docs', () => onExportGoogleDocs());
  item('github', 'Save to GitHub', () => onSaveToGitHub());

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

  const darkModeLabel = document.createElement('label');
  darkModeLabel.className = 'app-menu-toggle-row';
  const darkModeCheckbox = document.createElement('input');
  darkModeCheckbox.type = 'checkbox';
  darkModeCheckbox.addEventListener('change', () => onToggleDarkMode(darkModeCheckbox.checked));
  const darkModeText = document.createElement('span');
  darkModeText.textContent = 'Dark mode';
  darkModeLabel.append(darkModeCheckbox, darkModeText);

  settingsBody.append(animateLabel, darkModeLabel);

  return {
    // The dot marks edits made since the address bar was last written, so
    // "Save" is never a row whose effect you have to guess at. It only
    // appears once there is something to be out of date *with* — before
    // the first save there is no stale URL to warn about.
    refreshSaved(saved) {
      saveButton.classList.toggle('unsaved', saved === false);
      saveButton.title =
        saved === false
          ? 'Edits since this page’s address was last updated — click to save them into it'
          : 'Save this diagram into the page address, so a bookmark or a reload keeps it';
    },

    refreshAnimating(on) {
      animateCheckbox.checked = on;
    },

    refreshDarkMode(on) {
      darkModeCheckbox.checked = on;
    },

    // Ctrl/Cmd+S routes through the button rather than duplicating its
    // logic, so the shortcut and the click can't drift apart.
    triggerSave() {
      saveButton.click();
    },
  };
}
