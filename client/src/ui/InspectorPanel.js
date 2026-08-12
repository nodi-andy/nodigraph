import { touchBlock, MIN_BLOCK_WIDTH, MIN_BLOCK_HEIGHT } from '../model/Block.js';
import { snap } from '../model/grid.js';
import { applyDescriptionText, setPropValue } from '../model/BlockDescription.js';

const DESCRIPTION_PLACEHOLDER = `Block: PowerUnit

input.24V: This is the power input
output.5V: This is the output

prop.weight: 2kg
prop.state: ON, OFF, Disabled, Error = ON`;

function field(labelText, inputEl) {
  const wrapper = document.createElement('div');
  wrapper.className = 'field';
  const label = document.createElement('label');
  label.textContent = labelText;
  wrapper.appendChild(label);
  wrapper.appendChild(inputEl);
  return wrapper;
}

function sectionHeading(text) {
  const heading = document.createElement('h4');
  heading.textContent = text;
  return heading;
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
      input.step = 10;
      input.value = block.geometry[key];
      input.addEventListener('input', () => {
        const value = Number(input.value);
        block.geometry[key] = Number.isFinite(value) ? Math.max(min, value) : block.geometry[key];
        touchBlock(block);
        requestRender();
      });
      input.addEventListener('change', () => {
        // Snap on commit so a manually-typed value still lands on the grid,
        // same as a drag would.
        block.geometry[key] = key === 'width' || key === 'height'
          ? Math.max(min, snap(block.geometry[key]))
          : snap(block.geometry[key]);
        persist();
      });
      return input;
    };

    row.appendChild(field('X', makeGeomInput('x', -Infinity)));
    row.appendChild(field('Y', makeGeomInput('y', -Infinity)));
    container.appendChild(row);

    const row2 = document.createElement('div');
    row2.className = 'row';
    row2.appendChild(field('Width', makeGeomInput('width', MIN_BLOCK_WIDTH)));
    row2.appendChild(field('Height', makeGeomInput('height', MIN_BLOCK_HEIGHT)));
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

    // Properties get live controls here (the "simulation feel" the raw text
    // editor alone can't give): flipping an enum prop like state re-renders
    // immediately, and if it's named "state" the block's output ports
    // recolor to match (see BlockDescription.getStateColor).
    if (block.props.length) {
      container.appendChild(sectionHeading('Properties'));
      for (const prop of block.props) {
        if (prop.kind === 'enum') {
          const select = document.createElement('select');
          for (const option of prop.options) {
            const optionEl = document.createElement('option');
            optionEl.value = option;
            optionEl.textContent = option;
            optionEl.selected = option === prop.value;
            select.appendChild(optionEl);
          }
          select.addEventListener('change', () => {
            setPropValue(block, prop.id, select.value);
            touchBlock(block);
            requestRender();
            persist();
          });
          container.appendChild(field(prop.name, select));
        } else {
          const input = document.createElement('input');
          input.type = 'text';
          input.value = prop.value;
          input.addEventListener('input', () => {
            setPropValue(block, prop.id, input.value);
            touchBlock(block);
            requestRender();
          });
          input.addEventListener('change', persist);
          container.appendChild(field(prop.name, input));
        }
      }
    }

    if (block.ports.length) {
      container.appendChild(sectionHeading('Ports'));
      const list = document.createElement('ul');
      list.className = 'ports-summary';
      for (const port of block.ports) {
        const item = document.createElement('li');
        const badge = document.createElement('span');
        badge.className = `port-badge port-badge-${port.direction}`;
        badge.textContent = port.direction === 'in' ? 'IN' : 'OUT';
        const text = document.createElement('span');
        text.textContent = port.description ? `${port.name} — ${port.description}` : port.name;
        item.appendChild(badge);
        item.appendChild(text);
        list.appendChild(item);
      }
      container.appendChild(list);
    }

    container.appendChild(sectionHeading('Description'));
    const textarea = document.createElement('textarea');
    textarea.className = 'description-editor';
    textarea.rows = 7;
    textarea.value = block.description || '';
    textarea.placeholder = DESCRIPTION_PLACEHOLDER;
    container.appendChild(textarea);

    const applyDescription = () => {
      applyDescriptionText(block, textarea.value);
      touchBlock(block);
      requestRender();
      persist();
    };
    textarea.addEventListener('change', applyDescription);

    const applyRow = document.createElement('div');
    applyRow.className = 'apply-row';
    const applyButton = document.createElement('button');
    applyButton.type = 'button';
    applyButton.textContent = 'Apply description';
    applyButton.addEventListener('click', applyDescription);
    applyRow.appendChild(applyButton);
    container.appendChild(applyRow);
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
