// Wires up the mobile overflow menu (see index.html's #menu-toggle /
// #topbar-menu) that the file-toolbar and doc-sync clusters live inside on
// narrow screens. On desktop `.topbar-menu`'s base CSS is `display:
// contents`, so this wrapper doesn't touch that layout at all — only the
// mobile media query turns it into an actual dropdown, and only there does
// any of this toggling become visible.
export function mountTopbarMenu(toggleButton, menu, backdrop) {
  function setOpen(open) {
    menu.classList.toggle('open', open);
    backdrop.hidden = !open;
    toggleButton.setAttribute('aria-expanded', String(open));
  }

  toggleButton.addEventListener('click', () => {
    setOpen(!menu.classList.contains('open'));
  });

  backdrop.addEventListener('click', () => setOpen(false));

  window.addEventListener('keydown', (event) => {
    if (event.key === 'Escape' && menu.classList.contains('open')) setOpen(false);
  });

  // Any actual action closes the menu behind it — clicking Save/Share/
  // Undo/etc should feel like it did the thing and got out of the way,
  // not leave a dropdown hanging open over whatever happens next (a
  // dialog, a toast, the canvas itself).
  menu.addEventListener('click', (event) => {
    if (event.target.closest('button, a')) setOpen(false);
  });
}
