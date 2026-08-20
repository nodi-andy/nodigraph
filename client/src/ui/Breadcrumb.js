// Every earlier crumb jumps back out to that level; the current (last) one
// instead opens the rename editor, the same one a click on the boundary
// label opens — the breadcrumb's own text is the more discoverable place to
// find that, and there is nowhere else to navigate to from here anyway.
export function mountBreadcrumb(container, { project, onNavigate, onRenameCurrent }) {
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
  return { refresh };
}
