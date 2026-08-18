import { touchBlock, MIN_BLOCK_WIDTH, MIN_BLOCK_HEIGHT } from '../model/Block.js';
import { snap } from '../model/grid.js';
import { CLICK_DRAG_THRESHOLD } from '../interaction/DragStateMachine.js';
import {
  applyDescriptionText,
  setPropValue,
  addPort,
  removePort,
  serializeBlockDescription,
} from '../model/BlockDescription.js';

// A structural port edit (name/direction/description/add/delete) changes
// the model directly, so the raw Description text has to be regenerated
// to match — the same "structured edit re-derives the text" rule already
// used for properties.
function syncPortChange(block, requestRender, persist) {
  block.description = serializeBlockDescription(block);
  touchBlock(block);
  requestRender();
  if (persist) persist();
}

const DESCRIPTION_PLACEHOLDER = `Block: PowerUnit

input.24V: This is the power input
output.5V: This is the output

prop.weight: 2kg
prop.state: ON, OFF, Disabled, Error = ON`;

const TABS = ['Inspector', 'Description'];

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

function tabBar(activeTab, onSelect) {
  const bar = document.createElement('div');
  bar.className = 'tab-bar';
  for (const tab of TABS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = tab;
    button.className = 'tab-button' + (tab === activeTab ? ' active' : '');
    button.addEventListener('click', () => onSelect(tab));
    bar.appendChild(button);
  }
  return bar;
}

export function mountInspector(container, { project, selection, requestRender, persist, deleteBlock, enterBlock }) {
  // Shows either the structured Inspector or the raw Description editor at
  // once, not both stacked — persists across refresh() calls (e.g. after
  // every prop edit) since it lives outside the rebuild functions below.
  let activeTab = 'Inspector';
  // On mobile the inspector is a bottom sheet that slides up over the
  // canvas — but selection happens on pointerdown (so a drag has the right
  // block from the start), and sliding the sheet up the instant you press
  // a block, before you've even moved it, fights with "I just wanted to
  // drag this." Content still updates live; the slide-open transition
  // waits for the press to finish, and only actually opens if the whole
  // press turns out to have been a tap (barely moved) rather than a drag —
  // a drag leaves the sheet exactly as it was, open or closed.
  let pointerDown = false;
  let pointerDownPos = null;

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

  function renderInspectorTab(container_, block) {
    const isContainer = block.id === project.getContainerBlock()?.id;

    if (isContainer) {
      const hint = document.createElement('p');
      hint.className = 'hint-text';
      hint.textContent = "You're editing the interface of the current system — add input./output. lines in Description to change what shows up on the boundary frame.";
      container_.appendChild(hint);
    }

    const nameInput = document.createElement('input');
    nameInput.type = 'text';
    nameInput.value = block.name;
    nameInput.addEventListener('input', () => {
      block.name = nameInput.value;
      touchBlock(block);
      requestRender();
    });
    nameInput.addEventListener('change', persist);
    container_.appendChild(field('Name', nameInput));

    // Geometry/enter/delete only make sense for a block viewed as an
    // object from outside — while editing the container you're currently
    // inside, its own position/size on the *parent* canvas isn't relevant
    // here, and you can't enter or delete the thing you're standing in.
    if (!isContainer) {
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
      container_.appendChild(row);

      const row2 = document.createElement('div');
      row2.className = 'row';
      row2.appendChild(field('Width', makeGeomInput('width', MIN_BLOCK_WIDTH)));
      row2.appendChild(field('Height', makeGeomInput('height', MIN_BLOCK_HEIGHT)));
      container_.appendChild(row2);
    }

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = block.style.color;
    colorInput.addEventListener('input', () => {
      block.style.color = colorInput.value;
      touchBlock(block);
      requestRender();
    });
    colorInput.addEventListener('change', persist);
    container_.appendChild(field('Accent color', colorInput));

    if (!isContainer) {
      const architectureRow = document.createElement('div');
      architectureRow.className = 'apply-row';
      const enterButton = document.createElement('button');
      enterButton.type = 'button';
      enterButton.textContent = block.hasChildren
        ? `Enter block (${block.children?.blocks?.size ?? 0} inside) →`
        : 'Enter block →';
      enterButton.addEventListener('click', () => enterBlock(block.id));
      architectureRow.appendChild(enterButton);
      container_.appendChild(architectureRow);
    }

    // Properties get live controls here (the "simulation feel" the raw text
    // editor alone can't give): flipping an enum prop like state re-renders
    // immediately, and if it's named "state" the block's output ports
    // recolor to match (see BlockDescription.getStateColor).
    if (block.props.length) {
      container_.appendChild(sectionHeading('Properties'));
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
          container_.appendChild(field(prop.name, select));
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
          container_.appendChild(field(prop.name, input));
        }
      }
    }

    container_.appendChild(sectionHeading('Ports'));
    for (const port of block.ports) {
      const row = document.createElement('div');
      row.className = 'port-row';

      const dirSelect = document.createElement('select');
      dirSelect.className = 'port-dir-select';
      for (const dir of ['in', 'out']) {
        const option = document.createElement('option');
        option.value = dir;
        option.textContent = dir.toUpperCase();
        option.selected = dir === port.direction;
        dirSelect.appendChild(option);
      }
      dirSelect.addEventListener('change', () => {
        port.direction = dirSelect.value;
        syncPortChange(block, requestRender, persist);
      });

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'port-name-input';
      nameInput.value = port.name;
      nameInput.addEventListener('input', () => {
        port.name = nameInput.value;
        syncPortChange(block, requestRender);
      });
      nameInput.addEventListener('change', () => syncPortChange(block, requestRender, persist));

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'port-delete-button';
      deleteButton.textContent = '×';
      deleteButton.setAttribute('aria-label', `Delete port ${port.name}`);
      deleteButton.addEventListener('click', () => {
        removePort(block, port.id);
        project.removeConnectionsForPort(port.id);
        syncPortChange(block, requestRender, persist);
      });

      row.appendChild(dirSelect);
      row.appendChild(nameInput);
      row.appendChild(deleteButton);
      container_.appendChild(row);

      const descInput = document.createElement('input');
      descInput.type = 'text';
      descInput.className = 'port-desc-input';
      descInput.placeholder = 'Description';
      descInput.value = port.description || '';
      descInput.addEventListener('input', () => {
        port.description = descInput.value;
        syncPortChange(block, requestRender);
      });
      descInput.addEventListener('change', () => syncPortChange(block, requestRender, persist));
      container_.appendChild(descInput);
    }

    const addPortRow = document.createElement('div');
    addPortRow.className = 'apply-row';
    const addPortButton = document.createElement('button');
    addPortButton.type = 'button';
    addPortButton.textContent = '+ Add port';
    addPortButton.addEventListener('click', () => {
      addPort(block);
      syncPortChange(block, requestRender, persist);
    });
    addPortRow.appendChild(addPortButton);
    container_.appendChild(addPortRow);

    if (block.ports.length) {
      const hint = document.createElement('p');
      hint.className = 'hint-text';
      hint.textContent = 'Drag a port dot on the canvas to reposition it, or from the small handle beside it to wire a connection. Click a block\'s border to add a port right there.';
      container_.appendChild(hint);
    }

    if (!isContainer) {
      const deleteRow = document.createElement('div');
      deleteRow.className = 'delete-row';
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'delete-button';
      deleteButton.textContent = 'Delete block';
      deleteButton.addEventListener('click', () => {
        if (window.confirm(`Delete "${block.name}" and its connections? This can't be undone.`)) {
          deleteBlock(block.id);
        }
      });
      deleteRow.appendChild(deleteButton);
      container_.appendChild(deleteRow);
    }
  }

  function renderDescriptionTab(container_, block) {
    const textarea = document.createElement('textarea');
    textarea.className = 'description-editor';
    textarea.rows = 12;
    textarea.value = block.description || '';
    textarea.placeholder = DESCRIPTION_PLACEHOLDER;
    container_.appendChild(textarea);

    const applyDescription = () => {
      const previousPortIds = new Set(block.ports.map((p) => p.id));
      applyDescriptionText(block, textarea.value);
      const currentPortIds = new Set(block.ports.map((p) => p.id));
      for (const id of previousPortIds) {
        // A port removed from the text no longer has anything valid to
        // connect — drop any wires that referenced it rather than leave
        // them dangling.
        if (!currentPortIds.has(id)) project.removeConnectionsForPort(id);
      }
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
    container_.appendChild(applyRow);
  }

  function renderBlock(block) {
    container.innerHTML = '';
    container.appendChild(sheetHeader());
    container.appendChild(
      tabBar(activeTab, (tab) => {
        activeTab = tab;
        refresh();
      }),
    );

    if (activeTab === 'Inspector') renderInspectorTab(container, block);
    else renderDescriptionTab(container, block);
  }

  // Drives the mobile bottom-sheet slide + hides the FAB behind it so the
  // two floating controls never overlap; a no-op above the breakpoint,
  // since nothing there references these classes outside that media query.
  function syncOpenState() {
    const isOpen = Boolean(selection.selectedBlockId);
    container.classList.toggle('open', isOpen);
    document.body.classList.toggle('inspector-open', isOpen);
  }

  function refresh() {
    const block = selection.selectedBlockId ? project.getBlock(selection.selectedBlockId) : null;
    if (block) renderBlock(block);
    else renderEmpty();

    if (!pointerDown) syncOpenState();
  }

  selection.onChange(refresh);
  refresh();

  // Capture phase so this runs before the canvas's own pointerdown handler
  // selects a block/port — by the time selection changes, pointerDown is
  // already true and refresh() above knows to hold the sheet closed.
  window.addEventListener('pointerdown', (event) => {
    pointerDown = true;
    pointerDownPos = { x: event.clientX, y: event.clientY };
  }, { capture: true });

  window.addEventListener('pointerup', (event) => {
    pointerDown = false;
    const dx = event.clientX - (pointerDownPos?.x ?? event.clientX);
    const dy = event.clientY - (pointerDownPos?.y ?? event.clientY);
    pointerDownPos = null;
    if (Math.hypot(dx, dy) <= CLICK_DRAG_THRESHOLD) syncOpenState();
  });

  window.addEventListener('pointercancel', () => {
    pointerDown = false;
    pointerDownPos = null;
  });

  return { refresh };
}
