// The search chip in the middle of the top HUD: type, and every block in
// the whole tree (not just the level on screen) whose name, subtitle,
// lines, link or props contain the text is listed as you go; picking one
// jumps to its level and selects it. Plain DOM combobox — an <input> plus
// a listbox — rather than a <datalist>, so a row can carry where the
// block lives and so Enter/arrow keys behave the same in every browser.

const MAX_RESULTS = 12;

function walk(level, path, out) {
  if (!level) return;
  for (const block of level.blocks.values()) {
    out.push({ block, path });
    if (block.children) walk(block.children, [...path, block.id], out);
  }
}

function haystack(block) {
  const parts = [block.name, block.subtitle, ...(block.lines || []), block.link];
  for (const p of block.props || []) parts.push(p.name, p.value);
  return parts
    .filter((v) => v !== undefined && v !== null && v !== '')
    .map(String)
    .join('\n')
    .toLowerCase();
}

export function mountSearchBox(container, { project, onPick }) {
  container.innerHTML = '';
  container.className = 'hud-chip hud-chip-search';
  container.setAttribute('role', 'combobox');
  container.setAttribute('aria-expanded', 'false');

  const input = document.createElement('input');
  input.type = 'search';
  input.className = 'search-input';
  input.placeholder = 'Search…';
  input.autocomplete = 'off';
  input.setAttribute('aria-autocomplete', 'list');
  const list = document.createElement('ul');
  list.className = 'search-results';
  list.setAttribute('role', 'listbox');
  list.hidden = true;
  container.append(input, list);

  let results = [];
  let active = -1;

  function close() {
    list.hidden = true;
    list.innerHTML = '';
    results = [];
    active = -1;
    container.setAttribute('aria-expanded', 'false');
  }

  function labelForPath(path) {
    const names = [];
    let level = project.rootBlock.children;
    for (const id of path) {
      const b = level?.blocks.get(id);
      if (!b) break;
      names.push(b.name || '…');
      level = b.children;
    }
    return names.length ? names.join(' › ') : project.rootBlock.name || 'top level';
  }

  function render() {
    list.innerHTML = '';
    results.forEach((r, i) => {
      const li = document.createElement('li');
      li.className = 'search-result' + (i === active ? ' active' : '');
      li.setAttribute('role', 'option');
      const name = document.createElement('span');
      name.className = 'search-result-name';
      name.textContent = r.block.name || '(unnamed)';
      const where = document.createElement('span');
      where.className = 'search-result-where';
      where.textContent = [r.block.subtitle, labelForPath(r.path)].filter(Boolean).join(' · ');
      li.append(name, where);
      // mousedown, not click: the input's blur would close the list first.
      li.addEventListener('mousedown', (e) => {
        e.preventDefault();
        pick(i);
      });
      list.appendChild(li);
    });
    list.hidden = results.length === 0;
    container.setAttribute('aria-expanded', String(!list.hidden));
  }

  function search() {
    const q = input.value.trim().toLowerCase();
    if (!q) return close();
    const all = [];
    walk(project.rootBlock.children, [], all);
    const terms = q.split(/\s+/);
    results = all
      .filter(({ block }) => {
        const h = haystack(block);
        return terms.every((t) => h.includes(t));
      })
      .slice(0, MAX_RESULTS);
    active = results.length ? 0 : -1;
    render();
  }

  function pick(i) {
    const r = results[i];
    if (!r) return;
    onPick(r.block.id, r.path);
    input.value = '';
    close();
    input.blur();
  }

  input.addEventListener('input', search);
  input.addEventListener('focus', search);
  input.addEventListener('blur', close);
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      input.value = '';
      close();
      input.blur();
      return;
    }
    if (list.hidden) return;
    if (e.key === 'ArrowDown') {
      e.preventDefault();
      active = (active + 1) % results.length;
      render();
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      active = (active - 1 + results.length) % results.length;
      render();
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(active);
    }
  });

  return {
    focus() {
      input.focus();
    },
  };
}
