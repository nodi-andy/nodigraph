import { MIN_BLOCK_WIDTH, MIN_BLOCK_HEIGHT } from '../model/Block.js';
import { snap } from '../model/grid.js';
import {
  applyDescriptionText,
  setPropValue,
  addPort,
  removeLogicalPort,
  serializeBlockDescription,
  uniqueLogicalPortName,
} from '../model/BlockDescription.js';
import { DASH_STYLES } from '../render/ConnectionRenderer.js';

// A structural port edit (name/direction/description/add/delete) changes
// the model directly, so the raw Description text has to be regenerated
// to match — the same "structured edit re-derives the text" rule already
// used for properties.
function syncPortChange(block, requestRender, persist) {
  block.description = serializeBlockDescription(block);
  requestRender();
  if (persist) persist();
}

const DESCRIPTION_PLACEHOLDER = `Block: PowerUnit

input.24V: This is the power input
output.5V: This is the output

prop.weight: 2kg
prop.state: ON, OFF, Disabled, Error = ON`;

// 'Description' hidden for now (not removed — renderDescriptionTab below
// still works, and is one entry away from coming back).
const TABS = ['Inspector'];

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

export function mountInspector(container, { project, selection, wireSelection, requestRender, persist, deleteBlock, enterBlock, deleteConnection, toggleButton }) {
  // Shows either the structured Inspector or the raw Description editor at
  // once, not both stacked — persists across refresh() calls (e.g. after
  // every prop edit) since it lives outside the rebuild functions below.
  let activeTab = 'Inspector';
  // The panel never opens itself just because something got selected — on
  // a small screen it used to cover most of the diagram the moment you
  // tapped a block, and on a large one it kept shoving the selection FABs
  // away from the edge they're meant to be docked to. Opening is always an
  // explicit tap on the header toggle button now, the same on every screen
  // size — selecting something only makes that button clickable.
  let sheetOpen = false;
  // Selection happens on pointerdown (so a drag has the right block from
  // the start) — the open state only updates once the press ends, so a
  // selection made mid-drag doesn't touch anything else until the drag
  // itself is done.
  let pointerDown = false;

  function renderEmpty() {
    container.innerHTML = '';
    container.appendChild(sheetHeader());
    const heading = document.createElement('h3');
    heading.textContent = 'Inspector';
    const empty = document.createElement('p');
    empty.className = 'empty';
    empty.textContent = 'Select a block or wire to edit its properties.';
    container.appendChild(heading);
    container.appendChild(empty);
  }

  const DASH_LABELS = { solid: 'Solid', dashed: 'Dashed', dotted: 'Dotted' };

  // A selected wire's own properties — label, line style, colour — plus
  // delete. Reachable the same way a block is (select it, panel opens),
  // rather than needing the Share-style dialog treatment a whole diagram
  // gets; a single wire's fields are exactly this small.
  function renderWire(connection, count) {
    container.innerHTML = '';
    container.appendChild(sheetHeader());
    const heading = document.createElement('h3');
    heading.textContent = 'Wire';
    container.appendChild(heading);

    if (count > 1) {
      const hint = document.createElement('p');
      hint.className = 'hint-text';
      hint.textContent = `${count} wires selected — showing the one you picked last.`;
      container.appendChild(hint);
    }

    const labelInput = document.createElement('input');
    labelInput.type = 'text';
    labelInput.placeholder = 'Unlabeled';
    labelInput.value = connection.label || '';
    labelInput.addEventListener('input', () => {
      if (labelInput.value) connection.label = labelInput.value;
      else delete connection.label;
      requestRender();
    });
    labelInput.addEventListener('change', persist);
    container.appendChild(field('Label', labelInput));

    const dashSelect = document.createElement('select');
    for (const style of DASH_STYLES) {
      const option = document.createElement('option');
      option.value = style;
      option.textContent = DASH_LABELS[style];
      option.selected = (connection.dashStyle || 'solid') === style;
      dashSelect.appendChild(option);
    }
    dashSelect.addEventListener('change', () => {
      // Stored as absent for 'solid' rather than the literal string, same
      // reason an uncoloured wire stores no colour: nothing to say for
      // the common case means nothing added to every share link either.
      if (dashSelect.value === 'solid') delete connection.dashStyle;
      else connection.dashStyle = dashSelect.value;
      requestRender();
      persist();
    });
    container.appendChild(field('Line style', dashSelect));

    const colorInput = document.createElement('input');
    colorInput.type = 'color';
    colorInput.value = connection.color || '#4f8cff';
    colorInput.addEventListener('input', () => {
      connection.color = colorInput.value;
      requestRender();
    });
    colorInput.addEventListener('change', persist);
    container.appendChild(field('Colour', colorInput));

    const deleteRow = document.createElement('div');
    deleteRow.className = 'delete-row';
    const deleteButton = document.createElement('button');
    deleteButton.type = 'button';
    deleteButton.className = 'delete-button';
    deleteButton.textContent = 'Delete wire';
    deleteButton.addEventListener('click', () => deleteConnection(connection.id));
    deleteRow.appendChild(deleteButton);
    container.appendChild(deleteRow);
  }

  function renderInspectorTab(container_, block) {
    const isContainer = block.id === project.getContainerBlock()?.id;
    // A text block is a plain floating label (see Block.createBlock) — no
    // sub-architecture to drill into and no sockets to wire, so neither
    // control applies to it.
    const isText = block.kind === 'text';

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
      requestRender();
    });
    colorInput.addEventListener('change', persist);
    container_.appendChild(field('Accent color', colorInput));

    if (!isContainer && !isText) {
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
            requestRender();
          });
          input.addEventListener('change', persist);
          container_.appendChild(field(prop.name, input));
        }
      }
    }

    if (!isText) {
    container_.appendChild(sectionHeading('Ports'));
    // One row per *logical* port (see BlockDescription's module doc), not
    // per pin — this list manages the block's interface, and a pin cloned
    // several times (Alt-drag on the canvas) is still exactly one entry in
    // it, never one row per exterior instance. The `×N` badge is the only
    // trace of how many pins it actually has; deleting the row removes the
    // whole logical port, every one of those pins included.
    for (const logical of block.logicalPorts) {
      const pinIds = block.ports.filter((p) => p.logicalId === logical.id).map((p) => p.id);
      const row = document.createElement('div');
      row.className = 'port-row';

      const dirSelect = document.createElement('select');
      dirSelect.className = 'port-dir-select';
      // '' stands in for null here — <option> values are always strings,
      // so the empty string is the only way to give "undecided" a value at
      // all, and the change handler below maps it back to null on the way out.
      for (const [value, label] of [['', '?'], ['in', 'IN'], ['out', 'OUT']]) {
        const option = document.createElement('option');
        option.value = value;
        option.textContent = label;
        option.selected = value === (logical.direction || '');
        dirSelect.appendChild(option);
      }
      dirSelect.addEventListener('change', () => {
        logical.direction = dirSelect.value || null;
        syncPortChange(block, requestRender, persist);
      });

      const nameInput = document.createElement('input');
      nameInput.type = 'text';
      nameInput.className = 'port-name-input';
      nameInput.placeholder = 'Name';
      nameInput.value = logical.name;
      nameInput.addEventListener('input', () => {
        logical.name = nameInput.value;
        syncPortChange(block, requestRender);
      });
      nameInput.addEventListener('change', () => {
        // Disambiguated only on commit, not on every keystroke — two
        // logical ports are never allowed to end up with the same name
        // (see BlockDescription.uniqueLogicalPortName), but fighting the
        // user's cursor mid-type would be worse than the rare case of two
        // *different* interfaces actually colliding on a name.
        logical.name = uniqueLogicalPortName(block, logical.name, logical.id);
        nameInput.value = logical.name;
        syncPortChange(block, requestRender, persist);
      });

      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'port-delete-button';
      deleteButton.textContent = '×';
      deleteButton.setAttribute('aria-label', `Delete port ${logical.name}`);
      deleteButton.addEventListener('click', () => {
        const removedPinIds = removeLogicalPort(block, logical.id);
        for (const pinId of removedPinIds) project.removeConnectionsForPort(pinId);
        syncPortChange(block, requestRender, persist);
      });

      row.appendChild(dirSelect);
      row.appendChild(nameInput);
      if (pinIds.length > 1) {
        const countBadge = document.createElement('span');
        countBadge.className = 'port-pin-count';
        countBadge.textContent = `×${pinIds.length}`;
        countBadge.title = `${pinIds.length} pins on the canvas — cloned with Alt-drag`;
        row.appendChild(countBadge);
      }
      row.appendChild(deleteButton);
      container_.appendChild(row);

      const descInput = document.createElement('input');
      descInput.type = 'text';
      descInput.className = 'port-desc-input';
      descInput.placeholder = 'Description';
      descInput.value = logical.description || '';
      descInput.addEventListener('input', () => {
        logical.description = descInput.value;
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

    if (block.logicalPorts.length) {
      const hint = document.createElement('p');
      hint.className = 'hint-text';
      hint.textContent = isContainer
        ? "Drag a port dot on the canvas to reposition it, or from the small handle beside it to wire a connection. From in here, wiring a second connection to the same port fans it out into several wires side by side — double-click each one to give it its own label."
        : 'Drag a port dot on the canvas to reposition it, or from the small handle beside it to wire a connection. Click a block\'s border to add a port right there.';
      container_.appendChild(hint);
    }
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
    // A bar with only one tab in it has nothing to switch between — skip
    // it rather than show a button that's always already selected.
    if (TABS.length > 1) {
      container.appendChild(
        tabBar(activeTab, (tab) => {
          activeTab = tab;
          refresh();
        }),
      );
    }

    if (activeTab === 'Inspector') renderInspectorTab(container, block);
    else renderDescriptionTab(container, block);
  }

  // body.inspector-open drives the layout (desktop column / mobile sheet
  // slide, FAB shift/hide); body.block-selected drives the header toggle
  // button's enabled state — named for the block case since that's the
  // common one, but it opens for a selected wire exactly the same way.
  function syncOpenState() {
    const hasSelection = Boolean(selection.selectedBlockId) || wireSelection.list().length > 0;
    if (!hasSelection) sheetOpen = false;
    const isOpen = hasSelection && sheetOpen;
    container.classList.toggle('open', isOpen);
    document.body.classList.toggle('inspector-open', isOpen);
    document.body.classList.toggle('block-selected', hasSelection);
    toggleButton.disabled = !hasSelection;
    toggleButton.setAttribute('aria-expanded', String(isOpen));
    toggleButton.title = hasSelection
      ? `${isOpen ? 'Close' : 'Open'} the ${selection.selectedBlockId ? 'block' : 'wire'} inspector`
      : 'Select a block or wire to inspect';
  }

  // The drawer's only opener, on every screen size — a header icon button
  // mirroring #menu-toggle on the opposite edge (see index.html), rather
  // than the panel popping open on its own the instant something is
  // selected.
  toggleButton.addEventListener('click', () => {
    sheetOpen = !sheetOpen;
    syncOpenState();
  });

  function refresh() {
    const block = selection.selectedBlockId ? project.getBlock(selection.selectedBlockId) : null;
    if (block) {
      renderBlock(block);
    } else {
      // The wire selected last is the one shown, same rule a multi-block
      // selection already uses to pick which one's fields the Inspector
      // displays (see SelectionManager's own `selectedBlockId`).
      const wireIds = wireSelection.list();
      const connection = wireIds.length ? project.getConnection(wireIds[wireIds.length - 1]) : null;
      if (connection) renderWire(connection, wireIds.length);
      else renderEmpty();
    }

    if (!pointerDown) syncOpenState();
  }

  selection.onChange(refresh);
  wireSelection.onChange(refresh);
  refresh();

  // Capture phase so this runs before the canvas's own pointerdown handler
  // selects a block/port — by the time selection changes, pointerDown is
  // already true and refresh() above knows to hold the layout change.
  window.addEventListener('pointerdown', () => {
    pointerDown = true;
  }, { capture: true });

  window.addEventListener('pointerup', () => {
    pointerDown = false;
    syncOpenState();
  });

  window.addEventListener('pointercancel', () => {
    pointerDown = false;
    syncOpenState();
  });

  return { refresh };
}
