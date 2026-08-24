// Canvas drawing colors that actually need to differ between light and dark
// — accent colors (selection blue, valid/invalid green/red, the default
// wire blue) read fine against either background and stay the same in both
// palettes; only surfaces, fills, and near-white/near-black details that
// would otherwise vanish against the new background are themed here.
const PALETTES = {
  light: {
    // Halfway between the old grid color and --bg-canvas (#f7f8fa) — half
    // the contrast against the background, so the lattice reads as a faint
    // editing aid instead of competing with the blocks drawn over it.
    grid: '#edf0f5',
    blockFill: '#ffffff',
    blockText: '#1c2431',
    portLabel: '#6b7686',
    connectorHandle: '#1c2431',
    portStroke: '#ffffff',
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
    // Halfway between the old grid color and --bg-canvas (#12161d) — see
    // the light palette's grid comment.
    grid: '#161c24',
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
