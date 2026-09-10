// Canvas drawing colors that actually need to differ between light and dark
// — accent colors (selection blue, valid/invalid green/red, the default
// wire blue) read fine against either background and stay the same in both
// palettes; only surfaces, fills, and near-white/near-black details that
// would otherwise vanish against the new background are themed here.
const PALETTES = {
  light: {
    // A dot at every grid intersection (see SceneRenderer's drawGrid),
    // Figma-style, rather than a lattice of lines — needs a touch more
    // contrast against --bg-canvas (#e7e9ee) than a line would, since a
    // single dot has far less area to read against the background with.
    grid: '#c9cdd6',
    // A warm near-white rather than flat #ffffff — paired with the grey
    // canvas behind it (--bg-canvas) and BlockRenderer's own drop shadow,
    // this is what makes a block read as a sheet of paper resting on the
    // canvas instead of a plain colored rectangle.
    blockFill: '#fffefb',
    blockText: '#1c2431',
    portLabel: '#6b7686',
    connectorHandle: '#1c2431',
    portStroke: '#fffefb',
    emptySlotFill: 'rgba(20, 30, 45, 0.035)',
    emptySlotStroke: 'rgba(20, 30, 45, 0.16)',
    boundaryDash: 'rgba(28, 36, 49, 0.28)',
    boundaryLabel: '#6b7686',
    wireLabelBg: '#ffffff',
    wireLabelBorder: 'rgba(28, 36, 49, 0.16)',
    wireLabelText: '#1c2431',
    resizeHandleFill: '#ffffff',
  },
  dark: {
    // A dot grid (see the light palette's own comment) needs more contrast
    // than the old line grid did to still read against --bg-canvas
    // (#12161d).
    grid: '#2a3341',
    blockFill: '#1c2431',
    blockText: '#ffffff',
    portLabel: '#c3c9d4',
    connectorHandle: '#e6e9ef',
    portStroke: '#12161d',
    emptySlotFill: 'rgba(255, 255, 255, 0.04)',
    emptySlotStroke: 'rgba(255, 255, 255, 0.14)',
    boundaryDash: 'rgba(255, 255, 255, 0.25)',
    boundaryLabel: '#8b93a3',
    wireLabelBg: '#10151c',
    wireLabelBorder: 'rgba(255, 255, 255, 0.15)',
    wireLabelText: '#e6e9ef',
    resizeHandleFill: '#10151c',
  },
};

export function getCanvasPalette(themeName) {
  return PALETTES[themeName] || PALETTES.light;
}

// A diagram exported to Google Docs (or downloaded as an image) lands on a
// white page regardless of which theme the person editing it happens to be
// in — always render exports in the light palette so the result looks
// intentional rather than like a dark-mode screenshot pasted onto paper.
export function getExportPalette() {
  return PALETTES.light;
}
