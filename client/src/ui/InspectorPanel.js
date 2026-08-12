import { touchBlock } from '../model/Block.js';

function field(labelText, inputEl) {
  const wrapper = document.createElement('div');
  wrapper.className = 'field';
  const label = document.createElement('label');
  label.textContent = labelText;
  wrapper.appendChild(label);
  wrapper.appendChild(inputEl);
  return wrapper;
}

function sheetHeader() {
  // Purely a mobile affordance (drag grabber for the bottom sheet); hidden
  // by CSS above the mobile breakpoint.
  const header = document.createElement('div');
  header.className = 'sheet-header';
  const grabber = document.createElement('div');
  grabber.className = 'grabber';
  header.appendChild(grabber);
  return header;
}

export function mountInspector(container, { project, selection, requestRender, persist }) {
  function renderEmpty() {
    container.innerHTML = '';
    container.appendChild(sheetHeader());
    const heading = document.createElement('h3');
    heading.textContent = 'Inspector';
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Select a block to edit its properties.';
    container.appendChild(heading);
    container.appendChild(empty);
  }

  function renderBlock(block) {
    container.innerHTML = '';
    container.appendChild(sheetHeader());
    const heading = document.createElement('h3');
    heading.textContent = 'Inspector';
    container.appendChild(heading);

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = block.name;
    nameInput.addEventListener('input', () => {
      block.name = nameInput.value;
      touchBlock(block);
      requestRender();
    });
    nameInput.addEventListener('change', persist);
    container.appendChild(field('Name', nameInput));

    const row = document.createElement('div');
    row.className = 'row';

    const makeGeomInput = (key, min) => {
      const input = document.createElement('input');
      input.type = 'number';
      input.value = block.geometry[key];
      input.addEventListener('input', () => {
        const value = Number(input.value);
        block.geometry[key] = Number.isFinite(value) ? Math.max(min, value) : block.geometry[key];
        touchBlock(block);
        requestRender();
      });
      input.addEventListener('change', persist);
      return input;
    };

    row.appendChild(field('X', makeGeomInput('x', -Infinity)));
    row.appendChild(field('Y', makeGeomInput('y', -Infinity)));
    container.appendChild(row);

    const row2 = document.createElement('div');
    row2.className = 'row';
    row2.appendChild(field('Width', makeGeomInput('width', 40)));
    row2.appendChild(field('Height', makeGeomInput('height', 40)));
    container.appendChild(row2);

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = block.style.color;
    colorInput.addEventListener('input', () => {
      block.style.color = colorInput.value;
      touchBlock(block);
      requestRender();
    });
    colorInput.addEventListener('change', persist);
    container.appendChild(field('Header color', colorInput));
  }

  function refresh() {
    const block = selection.selectedBlockId ? project.getBlock(selection.selectedBlockId) : null;
    if (block) renderBlock(block);
    else renderEmpty();

    // Drives the mobile bottom-sheet slide + hides the FAB behind it so the
    // two floating controls never overlap; a no-op above the breakpoint.
    container.classList.toggle('open', Boolean(block));
    document.body.classList.toggle('inspector-open', Boolean(block));
  }

  selection.onChange(refresh);
  refresh();

  return { refresh };
}
