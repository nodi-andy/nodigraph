// Every crumb (including the product root) is clickable except the current
// (last) one, so jumping back out isn't limited to one level at a time.
export function mountBreadcrumb(container, { project, onNavigate }) {
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
      button.disabled = isCurrent;
      button.addEventListener('click', () => onNavigate(crumb.depth));
      container.appendChild(button);
    });
  }

  refresh();
  return { refresh };
}
