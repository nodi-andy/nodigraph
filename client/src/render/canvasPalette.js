// The canvas's own drawing colours — surfaces, fills and the near-white or
// near-black details drawn over them. There is one palette: the colours a
// diagram carries (block fills, accents, wire colours) mean something in
// the circuit it describes, and a second, dark rendering would show them
// on a background they were never picked against.
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
    // The ink a block's drop shadow is mixed from (see BlockRenderer's
    // PAPER_SHADOW_LAYERS). A bare rgb triple rather than a finished
    // colour, so the renderer can mix its own two alphas out of it — a
    // wide ambient layer and a tight contact one — without the palette
    // having to spell both out.
    blockShadowRgb: '15, 18, 24',
    // Laid over a connected output's tab (see BlockRenderer.shadeTab): a
    // shade darker than the face, which a free tab keeps.
    connectedTabShade: 'rgba(15, 18, 24, 0.14)',
  },
};

// The argument is accepted and ignored, so a caller still naming the old
// 'light' palette keeps working.
export function getCanvasPalette() {
  return PALETTES.light;
}

// What an exported image or SVG is drawn with — the same palette the
// editor shows, now that there is only one.
export function getExportPalette() {
  return PALETTES.light;
}
