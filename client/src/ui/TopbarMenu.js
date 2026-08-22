// Wires up the sliding app menu (see index.html's #menu-toggle /
// #topbar-menu): a drawer that slides in from the left on every screen
// size, holding the app-menu items (ui/AppMenu.js) and the doc-sync panel.
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

  // Any actual action closes the drawer behind it — clicking New/Save/
  // Export/etc should feel like it did the thing and got out of the way,
  // not leave the drawer hanging open over whatever happens next (a
  // dialog, a toast, the canvas itself). The Settings row is a control
  // that lives *in* the menu rather than an exit from it, so it (and
  // anything else marked data-keep-menu-open) is excluded.
  menu.addEventListener('click', (event) => {
    const actionEl = event.target.closest('button, a');
    if (actionEl && !actionEl.hasAttribute('data-keep-menu-open')) setOpen(false);
  });
}
