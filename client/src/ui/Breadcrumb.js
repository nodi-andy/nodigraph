// Every earlier crumb jumps back out to that level; the current (last) one
// instead opens the rename editor, the same one a click on the boundary
// label opens — the breadcrumb's own text is the more discoverable place to
// find that, and there is nowhere else to navigate to from here anyway.
//
// The first crumb is the whole diagram, so it also says whether the
// diagram has edits not yet saved: a dot, the same one the file chip and
// the menu's save row show (see main.js refreshSaved and setUnsaved).
export function mountBreadcrumb(container, { project, onNavigate, onRenameCurrent }) {
  let unsaved = false;
  function refresh() {
    container.innerHTML = '';
    const crumbs = project.getBreadcrumb();

    crumbs.forEach((crumb, i) => {
      if (i > 0) {
        const sep = document.createElement('span');
        sep.className = 'crumb-sep';
        sep.textContent = '›';
        container.appendChild(sep);
      }

      const isCurrent = i === crumbs.length - 1;
      const button = document.createElement('button');
      button.type = 'button';
      button.className = 'crumb' + (isCurrent ? ' current' : '');
      button.textContent = crumb.name;
      if (i === 0) {
        button.classList.toggle('unsaved', unsaved);
        const dot = document.createElement('span');
        dot.className = 'crumb-unsaved-dot';
        dot.setAttribute('aria-hidden', 'true');
        button.appendChild(dot);
      }
      if (isCurrent) {
        button.title = 'Click to rename';
        button.addEventListener('click', () => onRenameCurrent());
      } else {
        button.addEventListener('click', () => onNavigate(crumb.depth));
      }
      container.appendChild(button);
    });
  }

  refresh();
  return {
    refresh,
    setUnsaved(value) {
      unsaved = Boolean(value);
      const first = container.querySelector('.crumb');
      if (!first) return;
      first.classList.toggle('unsaved', unsaved);
      if (unsaved) first.setAttribute('aria-label', `${first.textContent} — edits not saved yet`);
      else first.removeAttribute('aria-label');
    },
  };
}
