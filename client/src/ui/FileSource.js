// The header's answer to "what am I working on?": while the diagram is
// backed by a file on this computer (a File System Access handle — see
// model/localFile.js and main.js's handleOpenFile), its name sits in the
// top bar next to the breadcrumb, with a dot once there are edits the file
// does not have yet. Clicking it saves, the same as the menu's "Save to
// <file>" row. Hidden while no file is held, which is also every browser
// without the API.

const FILE_ICON =
  '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M6 2h9l5 5v15H6V2z" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linejoin="round"/><path d="M15 2.5V8h5.5" fill="none" stroke="currentColor" stroke-width="1.4"/></svg>';

export function mountFileSource(container, { onSave }) {
  container.innerHTML = '';
  container.hidden = true;
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'file-source';
  button.innerHTML = `${FILE_ICON}<span class="file-source-name"></span><span class="file-source-dot" aria-hidden="true"></span>`;
  button.addEventListener('click', () => onSave());
  container.appendChild(button);
  const nameEl = button.querySelector('.file-source-name');

  return {
    // `name` null hides the chip; `saved` false shows the dot.
    refresh({ name, saved }) {
      container.hidden = !name;
      if (!name) return;
      nameEl.textContent = name;
      button.classList.toggle('unsaved', saved === false);
      button.title =
        saved === false
          ? `Working on ${name} — edits not yet in the file. Click (or Ctrl+S) to save them.`
          : `Working on ${name} — the file has every edit. Click to save again.`;
      button.setAttribute('aria-label', button.title);
    },
  };
}
