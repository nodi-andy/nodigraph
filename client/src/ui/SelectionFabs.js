// The canvas-side controls for whatever is currently selected, stacked
// above the add-block FAB. They exist so the two things people do most
// often to a selection — delete it, recolor it — don't require opening the
// Inspector, which on a small screen covers the diagram it is describing.
//
// The stack is empty-handed when nothing is selected: showing a delete
// button with nothing to delete just invites a click that does nothing.

// Chosen to stay legible on the dark canvas and to be tellable apart from
// each other at wire thickness — the point of coloring a pipe is grouping
// it with the other pipes of its kind, which fails if two of the choices
// read as the same color.
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
const DELETE_ICON = 'M6 19a2 2 0 0 0 2 2h8a2 2 0 0 0 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z';

function miniFab(className, title, iconPath, onClick) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = `fab fab-mini ${className}`;
  button.title = title;
  button.setAttribute('aria-label', title);
  button.innerHTML = `<svg viewBox="0 0 24 24" width="20" height="20" aria-hidden="true"><path d="${iconPath}" fill="currentColor"/></svg>`;
  button.addEventListener('click', onClick);
  return button;
}

/**
 * `getSelectionCount()` reports how many things (blocks + wires) are
 * selected, `onDelete()` removes them, and `onColor(hex | null)` recolors
 * them — null meaning "back to the default", which is stored as no color
 * at all rather than as the default's literal hex.
 */
export function mountSelectionFabs(container, { getSelectionCount, onDelete, onColor }) {
  container.innerHTML = '';
  container.className = 'fab-stack';

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
    swatch.addEventListener('click', () => {
      onColor(color);
      closePalette();
    });
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
  custom.addEventListener('input', () => onColor(custom.value));
  custom.addEventListener('change', () => closePalette());
  palette.appendChild(custom);

  function closePalette() {
    palette.hidden = true;
  }

  const colorButton = miniFab('fab-color', 'Colour the selection', COLOR_ICON, (event) => {
    event.stopPropagation();
    palette.hidden = !palette.hidden;
  });

  const deleteButton = miniFab('fab-danger', 'Delete the selection', DELETE_ICON, () => {
    closePalette();
    onDelete();
  });

  container.append(palette, colorButton, deleteButton);

  // Any click that isn't in the palette dismisses it — including clicks on
  // the canvas, which is where someone goes to select something else.
  document.addEventListener('pointerdown', (event) => {
    if (!palette.hidden && !palette.contains(event.target)) closePalette();
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
      if (count === 0) closePalette();
    },
  };
}
