import { FONTS } from '../render/fonts.js';

// The canvas-side controls for whatever is currently selected, one group
// among several sharing the bottom control bar (see styles.css's
// .control-bar). They exist so the things people do most often to a
// selection — delete it, restyle it — don't require opening the
// Inspector, which on a small screen covers the diagram it is describing.
//
// The group stays visible even with nothing selected — disabled rather
// than hidden, so it's a fixed landmark in the bar rather than something
// that pops in and out as the selection comes and goes.

// Chosen to stay legible on the dark canvas and to be tellable apart from
// each other at wire thickness — the point of coloring a pipe is grouping
// it with the other pipes of its kind, which fails if two of the choices
// read as the same color. Reused as-is for the fill picker below: the
// same eight choices work as a background too, since drawBlock always
// picks a legible ink color against whichever one lands there.
const SWATCHES = [
  { color: null, label: 'Default' },
  // A literal CSS keyword, not "no color" — canvas draws it as paint-nothing
  // (see BlockRenderer.drawBlock), which is what makes a block with both
  // this fill and this border read as plain floating text.
  { color: 'transparent', label: 'Transparent' },
  { color: '#4f8cff', label: 'Blue' },
  { color: '#3ecf5d', label: 'Green' },
  { color: '#ffb454', label: 'Amber' },
  { color: '#ff6b6b', label: 'Red' },
  { color: '#c77dff', label: 'Violet' },
  { color: '#5eead4', label: 'Teal' },
  { color: '#e6e9ef', label: 'White' },
];

// Reads as "customize appearance" generically — used on the one combined
// Style button rather than on a border-colour-only button now (see the
// former separate colour/fill/font icons this replaced).
const COLOR_ICON =
  'M12 3a9 9 0 0 0 0 18 1.5 1.5 0 0 0 1.5-1.5c0-.4-.15-.75-.4-1a1.5 1.5 0 0 1 1.1-2.5H16a5 5 0 0 0 5-5c0-4.42-4.03-8-9-8zm-5.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3.5 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z';
const DELETE_ICON = 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z';
// The Order button's own icon: two overlapping sheets, reading as "stacking
// order" the way a design tool's own layers icon does.
const ORDER_ICON =
  '<rect x="4" y="4" width="12" height="12" rx="1.6" fill="none" stroke="currentColor" stroke-width="1.6"/><rect x="9" y="9" width="12" height="12" rx="1.6" fill="currentColor"/>';
// One menu item's icon per z-order action — a single chevron for a one-step
// nudge (Forward/Backward), doubled for the "all the way" edge actions
// (Front/Back), the same convention a media player's skip-one vs. skip-to-
// end buttons use.
const ORDER_MENU_ICONS = {
  front:
    '<path d="M12 3.5l6.5 6.5-1.4 1.4L12 6.3l-5.1 5.1-1.4-1.4z" fill="currentColor"/><path d="M12 10l6.5 6.5-1.4 1.4L12 12.8l-5.1 5.1-1.4-1.4z" fill="currentColor"/>',
  forward: '<path d="M12 6.5l7 7-1.4 1.4L12 9.3l-5.6 5.6-1.4-1.4z" fill="currentColor"/>',
  backward: '<path d="M12 17.5l-7-7 1.4-1.4L12 14.7l5.6-5.6 1.4 1.4z" fill="currentColor"/>',
  back:
    '<path d="M12 20.5l-6.5-6.5 1.4-1.4L12 17.7l5.1-5.1 1.4 1.4z" fill="currentColor"/><path d="M12 14l-6.5-6.5 1.4-1.4L12 11.2l5.1-5.1 1.4 1.4z" fill="currentColor"/>',
};

function miniFab(className, title, iconMarkup, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `fab fab-mini ${className}`;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">${iconMarkup}</svg>`;
  button.addEventListener('click', onClick);
  return button;
}

// A color-swatch grid, shared by the border-color and fill-color sections
// of the combined style panel below — they differ only in which callback a
// pick reaches and which color (if any) opens the native picker already
// pointed at. `onCommit` fires (and closes the panel) on a definite pick;
// the native input also fires plain `onPick` per-keystroke/drag so a live
// preview still works while it's open.
function buildSwatchGrid(onPick, onCommit) {
  const grid = document.createElement('div');
  grid.className = 'swatch-grid';

  for (const { color, label } of SWATCHES) {
    const swatch = document.createElement('button');
    swatch.type = 'button';
    const isTransparent = color === 'transparent';
    swatch.className =
      'fab-swatch' + (color ? '' : ' fab-swatch-default') + (isTransparent ? ' fab-swatch-transparent' : '');
    swatch.title = label;
    swatch.setAttribute('aria-label', label);
    // Setting background to the literal string 'transparent' would just
    // show the popover's own background through — the checkerboard that
    // actually reads as "transparent" comes from the CSS class instead.
    if (color && !isTransparent) swatch.style.background = color;
    swatch.addEventListener('click', () => onCommit(color));
    grid.appendChild(swatch);
  }

  // The last swatch opens the OS picker, for the case the eight above
  // don't cover — a native input rather than a hand-built wheel, which
  // would be a lot of code to be worse at the job on every platform.
  const custom = document.createElement('input');
  custom.type = 'color';
  custom.className = 'fab-swatch fab-swatch-custom';
  custom.title = 'Custom colour';
  custom.value = '#4f8cff';
  custom.addEventListener('input', () => onPick(custom.value));
  custom.addEventListener('change', () => onCommit(custom.value));
  grid.appendChild(custom);

  return grid;
}

// One labeled group within the combined style panel (Border / Fill / Font)
// — just a heading over whatever controls that section holds.
function styleSection(label, children) {
  const section = document.createElement('div');
  section.className = 'style-section';
  const heading = document.createElement('div');
  heading.className = 'style-section-label';
  heading.textContent = label;
  section.append(heading, ...children);
  return section;
}

// One row in the Order menu — an icon plus a text label, the plain "list
// of named actions" shape a z-order menu needs rather than the swatch-grid
// shape the style panel's own sections use.
function orderMenuItem(iconKey, label, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'order-menu-item';
  button.innerHTML = `<svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true">${ORDER_MENU_ICONS[iconKey]}</svg><span>${label}</span>`;
  button.addEventListener('click', onClick);
  return button;
}

/**
 * `getSelectionCount()` reports how many things (blocks + wires) are
 * selected. `getSelectionStyle()` returns the representative block's
 * current `style` (or null), used only to pre-fill the font popover's
 * controls when it opens. `onDelete()` removes the selection, or (unlike
 * every other control here) arms delete mode when there isn't one — see
 * main.js's toggleDeleteMode — which `isDeleteMode()` reports so the button
 * can show it's armed. `onColor(hex | null)` recolors it (border for a
 * block, the line itself for a wire);
 * `onFill(hex | null)`, `onFont(key | null)`, `onFontSize(px | null)`,
 * `onBold(bool)` and `onItalic(bool)` only ever touch blocks, since a wire
 * has no fill and no label font of its own. Every "back to the default"
 * case passes null (or false) rather than the default's own literal
 * value, so an unmodified diagram carries no style data at all.
 *
 * `getBlockSelectionCount()` gates the Order button/menu — z-order is a
 * block-only concept (see main.js's reorderSelection), so unlike every
 * other control here it stays disabled on a wire-only selection even
 * though getSelectionCount() would report it as non-empty.
 * `onBringToFront()`, `onSendToBack()`, `onBringForward()` and
 * `onSendBackward()` are the Order menu's four actions, called with no
 * arguments — which blocks they act on is main.js's own concern (the
 * current selection), not something this component needs to know.
 *
 * `getExtraFab()`, if given, is called on every refresh (a selection
 * change, same as everything else here) and may return `null` for no
 * extra button, or `{ title, icon, className, onClick }` to show one —
 * this is the one hook here meant for a host page (see main.js's own
 * comment on window.nodigraphSelectionFab) rather than nodigraph itself,
 * letting it add its own selection-dependent action to this same stack
 * without this file needing to know anything about what that action is.
 * Read fresh each time rather than once, so it works however a host wires
 * itself up — a global set before this even mounts, or one that only
 * exists once something loads later — without either side caring which.
 */
export function mountSelectionFabs(
  container,
  {
    getSelectionCount,
    getBlockSelectionCount = getSelectionCount,
    getSelectionStyle,
    onDelete,
    isDeleteMode = () => false,
    onColor,
    onFill,
    onFont,
    onFontSize,
    onBold,
    onItalic,
    onBringToFront,
    onSendToBack,
    onBringForward,
    onSendBackward,
    getExtraFab,
  },
) {
  container.innerHTML = '';
  container.className = 'fab-stack';

  // Border colour, fill colour and font used to be three separate mini-FABs,
  // each with its own popover — now one "Style" button opens a single
  // combined panel with all three as stacked sections, the same way a
  // design tool's own style flyout groups everything about a selection's
  // appearance in one place rather than spreading it across several
  // buttons in the bar.
  const stylePanel = document.createElement('div');
  stylePanel.className = 'style-panel';
  stylePanel.hidden = true;

  const borderGrid = buildSwatchGrid(
    (value) => onColor(value),
    (value) => {
      onColor(value);
      closeAllPopovers();
    },
  );
  const fillGrid = buildSwatchGrid(
    (value) => onFill(value),
    (value) => {
      onFill(value);
      closeAllPopovers();
    },
  );

  // The font section reads like a small version of a word processor's font
  // dialog — family, size, bold, italic — rather than a plain list of
  // family names, since a block label needs the same handful of controls
  // any other piece of styled text does. It stays open across edits (no
  // control inside it closes the panel) so several of those can be changed
  // in one sitting, unlike the single-pick color swatches above.
  const familySelect = document.createElement('select');
  familySelect.className = 'fab-font-family';
  for (const { key, label } of FONTS) {
    const option = document.createElement('option');
    option.value = key || '';
    option.textContent = label;
    familySelect.appendChild(option);
  }
  familySelect.addEventListener('change', () => onFont(familySelect.value || null));

  const sizeRow = document.createElement('div');
  sizeRow.className = 'fab-font-row';
  const sizeLabel = document.createElement('label');
  sizeLabel.textContent = 'Size';
  const sizeInput = document.createElement('input');
  sizeInput.type = 'number';
  sizeInput.className = 'fab-font-size';
  sizeInput.min = '8';
  sizeInput.max = '72';
  sizeInput.step = '1';
  sizeInput.addEventListener('change', () => {
    const value = Number(sizeInput.value);
    onFontSize(Number.isFinite(value) && value > 0 ? value : null);
  });
  sizeRow.append(sizeLabel, sizeInput);

  const styleRow = document.createElement('div');
  styleRow.className = 'fab-font-row fab-font-style-row';
  const boldButton = document.createElement('button');
  boldButton.type = 'button';
  boldButton.className = 'fab-font-style-btn fab-font-bold';
  boldButton.title = 'Bold';
  boldButton.innerHTML = '<b>B</b>';
  boldButton.addEventListener('click', () => {
    const active = !boldButton.classList.contains('active');
    boldButton.classList.toggle('active', active);
    onBold(active);
  });
  const italicButton = document.createElement('button');
  italicButton.type = 'button';
  italicButton.className = 'fab-font-style-btn fab-font-italic';
  italicButton.title = 'Italic';
  italicButton.innerHTML = '<i>I</i>';
  italicButton.addEventListener('click', () => {
    const active = !italicButton.classList.contains('active');
    italicButton.classList.toggle('active', active);
    onItalic(active);
  });
  styleRow.append(boldButton, italicButton);

  // The divider between the colour sections and the font section — its own
  // plain element rather than part of styleSection, since it's not itself
  // a labeled group.
  const fontDivider = document.createElement('div');
  fontDivider.className = 'style-divider';

  stylePanel.append(
    styleSection('Border', [borderGrid]),
    styleSection('Fill', [fillGrid]),
    fontDivider,
    styleSection('Font', [familySelect, sizeRow, styleRow]),
  );

  // Bring to Front / Bring Forward / Send Backward / Send to Back — a
  // named-list menu (see orderMenuItem) rather than a swatch grid, since
  // these are four distinct actions rather than a value being picked.
  const orderMenu = document.createElement('div');
  orderMenu.className = 'order-menu';
  orderMenu.hidden = true;
  orderMenu.append(
    orderMenuItem('front', 'Bring to Front', () => {
      closeAllPopovers();
      onBringToFront();
    }),
    orderMenuItem('forward', 'Bring Forward', () => {
      closeAllPopovers();
      onBringForward();
    }),
    orderMenuItem('backward', 'Send Backward', () => {
      closeAllPopovers();
      onSendBackward();
    }),
    orderMenuItem('back', 'Send to Back', () => {
      closeAllPopovers();
      onSendToBack();
    }),
  );

  // Both popovers — any other action (another button's click, an outside
  // click) dismisses whichever one is currently open.
  const popovers = [stylePanel, orderMenu];
  function closeAllPopovers() {
    for (const popover of popovers) popover.hidden = true;
  }

  const styleButton = miniFab('fab-style', 'Style (border, fill, font)', `<path d="${COLOR_ICON}" fill="currentColor"/>`, (event) => {
    event.stopPropagation();
    const opening = stylePanel.hidden;
    closeAllPopovers();
    stylePanel.hidden = !opening;
    // Reflects whichever block the Inspector would show, the same
    // "last one picked" rule a multi-select uses everywhere else — read
    // fresh on every open rather than kept in sync continuously, since
    // nothing else here needs to react to a selection change moment to
    // moment.
    if (opening) {
      const style = getSelectionStyle?.() || {};
      familySelect.value = style.font || '';
      sizeInput.value = style.fontSize || 13;
      boldButton.classList.toggle('active', Boolean(style.bold));
      italicButton.classList.toggle('active', Boolean(style.italic));
    }
  });

  const orderButton = miniFab('fab-order', 'Order (bring to front, send to back)', ORDER_ICON, (event) => {
    event.stopPropagation();
    const opening = orderMenu.hidden;
    closeAllPopovers();
    orderMenu.hidden = !opening;
  });

  const deleteButton = miniFab('fab-danger', 'Delete the selection', `<path d="${DELETE_ICON}" fill="currentColor"/>`, () => {
    closeAllPopovers();
    onDelete();
  });

  // A host's own button (see getExtraFab's own doc above) — built lazily
  // the first time one is actually offered, so a session that never uses
  // this hook doesn't carry a dead button around. Its title/icon/className
  // are refreshed on every call in case a host wants to change them (e.g.
  // per selected block), not just its visibility.
  let extraButton = null;
  let activeExtra = null;
  function ensureExtraButton(descriptor) {
    if (!extraButton) {
      extraButton = miniFab(descriptor.className || 'fab-extra', descriptor.title || '', descriptor.icon || '', () => {
        closeAllPopovers();
        activeExtra?.onClick();
      });
      container.insertBefore(extraButton, deleteButton);
    }
    extraButton.title = descriptor.title || '';
    extraButton.setAttribute('aria-label', descriptor.title || '');
    extraButton.className = `fab fab-mini ${descriptor.className || 'fab-extra'}`;
    extraButton.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true">${descriptor.icon || ''}</svg>`;
  }

  // The panel sits next to its own button (see the .style-panel CSS,
  // positioned relative to this wrapper). It's a *sibling* of the button,
  // not a child of it: a <button> can't validly contain other interactive
  // content (the panel's own <select>/<input>/<button> controls), and
  // nesting them meant a click on, say, the bold toggle bubbled up through
  // the button it sat inside and re-triggered that button's own click
  // handler — closing the panel it was still trying to use.
  function miniFabWithPopover(button, popover) {
    const wrap = document.createElement('div');
    wrap.className = 'fab-mini-wrap';
    wrap.append(button, popover);
    return wrap;
  }

  container.append(
    miniFabWithPopover(styleButton, stylePanel),
    miniFabWithPopover(orderButton, orderMenu),
    deleteButton,
  );

  // Any click outside a popover dismisses it — including clicks on the
  // canvas, which is where someone goes to select something else. Excludes
  // the popover's own button (not just the popover itself): pointerdown
  // fires before the button's own click handler runs, so without this a
  // click on the toggle button while its popover is open would hide it
  // here first and then the click handler's own toggle would immediately
  // reopen it.
  const popoverButtons = [
    { popover: stylePanel, button: styleButton },
    { popover: orderMenu, button: orderButton },
  ];
  document.addEventListener('pointerdown', (event) => {
    for (const { popover, button } of popoverButtons) {
      if (!popover.hidden && !popover.contains(event.target) && !button.contains(event.target)) {
        popover.hidden = true;
      }
    }
  });

  // Called from the render loop, so it compares before touching the DOM —
  // setting `disabled` to the value it already has on every frame would be
  // needless layout churn. The delete button is deliberately not tracked
  // here — see onDelete's doc comment above, it stays clickable with
  // nothing selected so it can arm delete mode instead.
  let lastCount = null;
  let lastBlockCount = null;
  let lastDeleteMode = null;

  return {
    refresh() {
      const count = getSelectionCount();
      if (count !== lastCount) {
        lastCount = count;
        // The bar stays put and full-strength either way — disabled
        // rather than hidden, so its footprint doesn't reflow (or silently
        // swallow a click aimed at where a button *was*) the instant a
        // selection is made or cleared.
        styleButton.disabled = count === 0;
        if (count === 0) stylePanel.hidden = true;
      }
      // Order is block-only (see getBlockSelectionCount's own doc above) —
      // tracked separately so a wire-only selection disables it even while
      // styleButton (which a wire's own colour still uses) stays enabled.
      const blockCount = getBlockSelectionCount();
      if (blockCount !== lastBlockCount) {
        lastBlockCount = blockCount;
        orderButton.disabled = blockCount === 0;
        if (blockCount === 0) orderMenu.hidden = true;
      }
      const armed = isDeleteMode();
      if (armed !== lastDeleteMode) {
        lastDeleteMode = armed;
        deleteButton.classList.toggle('fab-danger-armed', armed);
      }

      const descriptor = getExtraFab?.() || null;
      activeExtra = descriptor;
      if (descriptor) {
        ensureExtraButton(descriptor);
        extraButton.hidden = false;
      } else if (extraButton) {
        extraButton.hidden = true;
      }
    },
  };
}
