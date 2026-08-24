import { FONTS } from '../render/fonts.js';

// The canvas-side controls for whatever is currently selected, stacked
// above the add-block FAB. They exist so the things people do most often
// to a selection — delete it, recolor it — don't require opening the
// Inspector, which on a small screen covers the diagram it is describing.
//
// The stack stays visible even with nothing selected — disabled rather
// than hidden, so it's a fixed landmark in that corner rather than
// something that pops in and out as the selection comes and goes.

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

const COLOR_ICON =
  'M12 3a9 9 0 0 0 0 18 1.5 1.5 0 0 0 1.5-1.5c0-.4-.15-.75-.4-1a1.5 1.5 0 0 1 1.1-2.5H16a5 5 0 0 0 5-5c0-4.42-4.03-8-9-8zm-5.5 9a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3-4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm5 0a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3zm3.5 4a1.5 1.5 0 1 1 0-3 1.5 1.5 0 0 1 0 3z';
// A rounded square, bottom half solid — reads as "fill" without needing a
// literal (and harder to get right at 20px) paint-bucket illustration.
const FILL_ICON =
  '<rect x="4" y="4" width="16" height="16" rx="3" fill="none" stroke="currentColor" stroke-width="2"/><path d="M5 13h14v5a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2z" fill="currentColor"/>';
const FONT_ICON =
  '<text x="12" y="17" text-anchor="middle" font-size="15" font-weight="700" fill="currentColor" font-family="Georgia, serif">Aa</text>';
const DELETE_ICON = 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z';

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

// A color-swatch grid, shared by the border-color and fill-color pickers —
// they differ only in which callback a pick reaches and which color (if
// any) opens the native picker already pointed at.
function buildColorPalette(onPick) {
  const palette = document.createElement('div');
  palette.className = 'fab-palette';
  palette.hidden = true;

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
    swatch.addEventListener('click', () => onPick(color, true));
    palette.appendChild(swatch);
  }

  // The last swatch opens the OS picker, for the case the eight above
  // don't cover — a native input rather than a hand-built wheel, which
  // would be a lot of code to be worse at the job on every platform.
  const custom = document.createElement('input');
  custom.type = 'color';
  custom.className = 'fab-swatch fab-swatch-custom';
  custom.title = 'Custom colour';
  custom.value = '#4f8cff';
  custom.addEventListener('input', () => onPick(custom.value, false));
  custom.addEventListener('change', () => onPick(custom.value, true));
  palette.appendChild(custom);

  return palette;
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
 */
export function mountSelectionFabs(
  container,
  { getSelectionCount, getSelectionStyle, onDelete, isDeleteMode = () => false, onColor, onFill, onFont, onFontSize, onBold, onItalic },
) {
  container.innerHTML = '';
  container.className = 'fab-stack';

  const openPopovers = [];
  function closeAllPopovers() {
    for (const el of openPopovers) el.hidden = true;
  }
  function togglePopover(el) {
    const wasHidden = el.hidden;
    closeAllPopovers();
    el.hidden = !wasHidden;
  }

  const colorPalette = buildColorPalette((value, commit) => {
    onColor(value);
    if (commit) closeAllPopovers();
  });
  const fillPalette = buildColorPalette((value, commit) => {
    onFill(value);
    if (commit) closeAllPopovers();
  });

  // The font popover reads like a small version of a word processor's font
  // dialog — family, size, bold, italic — rather than the earlier plain
  // list of family names, since a block label needed the same handful of
  // controls any other piece of styled text does. It stays open across
  // edits (togglePopover isn't called by any control inside it) so several
  // of those can be changed in one sitting, unlike the single-pick color
  // swatches.
  const fontPanel = document.createElement('div');
  fontPanel.className = 'fab-palette fab-font-panel';
  fontPanel.hidden = true;

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

  fontPanel.append(familySelect, sizeRow, styleRow);

  openPopovers.push(colorPalette, fillPalette, fontPanel);

  const colorButton = miniFab('fab-color', 'Border colour', `<path d="${COLOR_ICON}" fill="currentColor"/>`, (event) => {
    event.stopPropagation();
    togglePopover(colorPalette);
  });
  const fillButton = miniFab('fab-fill', 'Background colour', FILL_ICON, (event) => {
    event.stopPropagation();
    togglePopover(fillPalette);
  });
  const fontButton = miniFab('fab-font', 'Font', FONT_ICON, (event) => {
    event.stopPropagation();
    // Reflects whichever block the Inspector would show, the same
    // "last one picked" rule a multi-select uses everywhere else — read
    // fresh on every open rather than kept in sync continuously, since
    // nothing else here needs to react to a selection change moment to
    // moment.
    if (fontPanel.hidden) {
      const style = getSelectionStyle?.() || {};
      familySelect.value = style.font || '';
      sizeInput.value = style.fontSize || 13;
      boldButton.classList.toggle('active', Boolean(style.bold));
      italicButton.classList.toggle('active', Boolean(style.italic));
    }
    togglePopover(fontPanel);
  });
  const deleteButton = miniFab('fab-danger', 'Delete the selection', `<path d="${DELETE_ICON}" fill="currentColor"/>`, () => {
    closeAllPopovers();
    onDelete();
  });

  // Each popover sits next to its own button (see the .fab-palette CSS,
  // positioned relative to this wrapper) rather than one shared popover
  // reparented on open — simpler, and the three never show at once anyway
  // (togglePopover closes the others first). The popover is a *sibling* of
  // its button, not a child of it: a <button> can't validly contain other
  // interactive content (the font popover's own <select>/<input>/<button>
  // controls), and nesting them meant a click on, say, the bold toggle
  // bubbled up through the button it sat inside and re-triggered that
  // button's own click handler — closing the popover it was still trying
  // to use.
  function miniFabWithPopover(button, popover) {
    const wrap = document.createElement('div');
    wrap.className = 'fab-mini-wrap';
    wrap.append(button, popover);
    return wrap;
  }

  container.append(
    miniFabWithPopover(colorButton, colorPalette),
    miniFabWithPopover(fillButton, fillPalette),
    miniFabWithPopover(fontButton, fontPanel),
    deleteButton,
  );

  // Any click that isn't in an open popover dismisses it — including
  // clicks on the canvas, which is where someone goes to select something
  // else.
  document.addEventListener('pointerdown', (event) => {
    for (const el of openPopovers) {
      if (!el.hidden && !el.contains(event.target)) el.hidden = true;
    }
  });

  // Called from the render loop, so it compares before touching the DOM —
  // setting `disabled` to the value it already has on every frame would be
  // needless layout churn.
  let lastCount = null;
  let lastDeleteMode = null;
  // The delete button is deliberately not in this list — see onDelete's
  // doc comment above, it stays clickable with nothing selected so it can
  // arm delete mode instead.
  const buttons = [colorButton, fillButton, fontButton];

  return {
    refresh() {
      const count = getSelectionCount();
      if (count !== lastCount) {
        lastCount = count;
        // The stack stays put and full-strength either way — disabled
        // rather than hidden, so the corner it lives in doesn't reflow (or
        // silently swallow a click aimed at where a button *was*) the
        // instant a selection is made or cleared.
        const disabled = count === 0;
        for (const button of buttons) button.disabled = disabled;
        if (disabled) closeAllPopovers();
      }
      const armed = isDeleteMode();
      if (armed !== lastDeleteMode) {
        lastDeleteMode = armed;
        deleteButton.classList.toggle('fab-danger-armed', armed);
      }
    },
  };
}
