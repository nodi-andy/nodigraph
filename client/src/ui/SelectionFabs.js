import { FONTS } from '../render/fonts.js';

// The canvas-side controls for whatever is currently selected, stacked
// above the add-block FAB. They exist so the things people do most often
// to a selection — delete it, recolor it — don't require opening the
// Inspector, which on a small screen covers the diagram it is describing.
//
// The stack is empty-handed when nothing is selected: showing a delete
// button with nothing to delete just invites a click that does nothing.

// Chosen to stay legible on the dark canvas and to be tellable apart from
// each other at wire thickness — the point of coloring a pipe is grouping
// it with the other pipes of its kind, which fails if two of the choices
// read as the same color. Reused as-is for the fill picker below: the
// same eight choices work as a background too, since drawBlock always
// picks a legible ink color against whichever one lands there.
const SWATCHES = [
  { color: null, label: 'Default' },
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
    swatch.className = 'fab-swatch' + (color ? '' : ' fab-swatch-default');
    swatch.title = label;
    swatch.setAttribute('aria-label', label);
    if (color) swatch.style.background = color;
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
 * selected. `onDelete()` removes them. `onColor(hex | null)` recolors
 * them (border for a block, the line itself for a wire); `onFill(hex |
 * null)` and `onFont(key | null)` only ever touch blocks, since a wire has
 * no fill and no label font of its own. Every "back to the default" case
 * passes null rather than the default's own literal value, so an
 * unmodified diagram carries no style data at all.
 */
export function mountSelectionFabs(container, { getSelectionCount, onDelete, onColor, onFill, onFont }) {
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

  const fontPalette = document.createElement('div');
  fontPalette.className = 'fab-palette fab-palette-list';
  fontPalette.hidden = true;
  for (const { key, label, family } of FONTS) {
    const option = document.createElement('button');
    option.type = 'button';
    option.className = 'fab-font-option';
    option.style.fontFamily = family;
    option.textContent = label;
    option.addEventListener('click', () => {
      onFont(key);
      closeAllPopovers();
    });
    fontPalette.appendChild(option);
  }

  openPopovers.push(colorPalette, fillPalette, fontPalette);

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
    togglePopover(fontPalette);
  });
  const deleteButton = miniFab('fab-danger', 'Delete the selection', `<path d="${DELETE_ICON}" fill="currentColor"/>`, () => {
    closeAllPopovers();
    onDelete();
  });

  // Each button carries its own popover right next to it (see the
  // .fab-palette CSS, positioned relative to its own parent) rather than
  // one shared popover reparented on open — simpler, and the three never
  // show at once anyway (togglePopover closes the others first).
  colorButton.appendChild(colorPalette);
  fillButton.appendChild(fillPalette);
  fontButton.appendChild(fontPalette);

  container.append(colorButton, fillButton, fontButton, deleteButton);

  // Any click that isn't in an open popover dismisses it — including
  // clicks on the canvas, which is where someone goes to select something
  // else.
  document.addEventListener('pointerdown', (event) => {
    for (const el of openPopovers) {
      if (!el.hidden && !el.contains(event.target)) el.hidden = true;
    }
  });

  // Called from the render loop, so it compares before touching the DOM —
  // setting `hidden` to the value it already has on every frame would be
  // needless layout churn.
  let lastCount = null;

  return {
    refresh() {
      const count = getSelectionCount();
      if (count === lastCount) return;
      lastCount = count;
      container.hidden = count === 0;
      if (count === 0) closeAllPopovers();
    },
  };
}
