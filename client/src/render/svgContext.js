// A minimal CanvasRenderingContext2D-compatible recorder that builds a real
// SVG document instead of drawing pixels — this is what lets the existing
// renderScene (and every drawBlock/drawPath/etc. it calls) run completely
// unmodified and still produce a genuine, editable vector file. It only
// implements the subset of the Canvas2D API this renderer actually calls
// (see the grep of ctx.* across render/*.js this was built against) — it
// is not a general-purpose canvas polyfill.
//
// Paths are recorded in device space (the current transform is baked into
// every point the moment it's added), exactly matching real Canvas2D
// semantics — a path already begun doesn't retroactively move if the
// transform changes later. Groups double as both the transform-free
// coordinate space (points are pre-transformed, so drawn elements never
// need their own `transform` attribute) and the clip scope: `clip()` opens
// a new `<g clip-path="...">` that `restore()` closes back to wherever the
// matching `save()` found the group stack, so a clip set between a
// save/restore pair — the only pattern this renderer ever uses — is scoped
// exactly the way canvas scopes it.

const SVG_NS = 'http://www.w3.org/2000/svg';

function multiply(m1, m2) {
  // Both are [a, b, c, d, e, f] — the standard 2D affine 3x3-with-implicit-
  // bottom-row form. Composing m1 (existing) with m2 (new, applied in the
  // current local frame) matches Canvas2D's own translate/scale/rotate
  // semantics, where each call nests inside whatever transform came before.
  const [a1, b1, c1, d1, e1, f1] = m1;
  const [a2, b2, c2, d2, e2, f2] = m2;
  return [
    a1 * a2 + c1 * b2,
    b1 * a2 + d1 * b2,
    a1 * c2 + c1 * d2,
    b1 * c2 + d1 * d2,
    a1 * e2 + c1 * f2 + e1,
    b1 * e2 + d1 * f2 + f1,
  ];
}

function apply(m, x, y) {
  return { x: m[0] * x + m[2] * y + m[4], y: m[1] * x + m[3] * y + m[5] };
}

function fmt(n) {
  // Trims float noise (canvas math produces plenty) without rounding real
  // sub-pixel precision away — 3 decimal places is well past what a
  // diagram's own grid-snapped coordinates ever need.
  return Math.round(n * 1000) / 1000;
}

// Every canvas fillStyle/strokeStyle this renderer ever sets is already a
// valid CSS color string (hex, 'transparent', rgba(...), a palette
// constant) — SVG's fill/stroke attributes accept exactly the same syntax,
// so this only exists as a single documented pass-through rather than
// scattering `|| DEFAULT` fallbacks at every call site.
function cssColor(value) {
  return value == null ? '#000000' : value;
}

class SvgPath2D {
  constructor() {
    this.subpaths = [];
    this.current = null;
  }

  moveTo(x, y) {
    this.current = [{ x, y }];
    this.subpaths.push(this.current);
  }

  lineTo(x, y) {
    if (!this.current) this.moveTo(x, y);
    else this.current.push({ x, y });
  }

  close() {
    if (this.current?.length) this.current.push({ ...this.current[0], close: true });
  }
}

export function createSvgContext(width, height) {
  const doc = document.implementation.createDocument(SVG_NS, 'svg', null);
  const svg = doc.documentElement;
  svg.setAttribute('xmlns', SVG_NS);
  svg.setAttribute('width', String(width));
  svg.setAttribute('height', String(height));
  svg.setAttribute('viewBox', `0 0 ${width} ${height}`);
  const defs = doc.createElementNS(SVG_NS, 'defs');
  svg.appendChild(defs);
  let clipCounter = 0;

  // A hidden real 2D context purely for measureText — reimplementing font
  // shaping/metrics from scratch isn't worth it when the browser already
  // has one sitting right there; this context is never drawn to.
  const measureCtx = document.createElement('canvas').getContext('2d');

  let state = {
    matrix: [1, 0, 0, 1, 0, 0],
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    font: '10px sans-serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    dash: [],
    dashOffset: 0,
  };
  const stateStack = [];
  const groupStack = [svg];
  const groupDepthStack = [];

  function currentGroup() {
    return groupStack[groupStack.length - 1];
  }

  function el(tag, attrs) {
    const node = doc.createElementNS(SVG_NS, tag);
    for (const [key, value] of Object.entries(attrs)) {
      if (value != null) node.setAttribute(key, value);
    }
    currentGroup().appendChild(node);
    return node;
  }

  function strokeAttrs() {
    const attrs = {
      stroke: cssColor(ctx.strokeStyle),
      'stroke-width': fmt(ctx.lineWidth),
      'stroke-linecap': ctx.lineCap,
      'stroke-linejoin': ctx.lineJoin,
      fill: 'none',
    };
    if (state.globalAlpha < 1) attrs['stroke-opacity'] = state.globalAlpha;
    if (ctx._dash?.length) {
      attrs['stroke-dasharray'] = ctx._dash.map(fmt).join(' ');
      if (ctx._dashOffset) attrs['stroke-dashoffset'] = fmt(-ctx._dashOffset);
    }
    return attrs;
  }

  function fillAttrs() {
    const attrs = { fill: cssColor(ctx.fillStyle) };
    if (state.globalAlpha < 1) attrs['fill-opacity'] = state.globalAlpha;
    return attrs;
  }

  let path = new SvgPath2D();

  const ctx = {
    canvas: { width, height },
    fillStyle: '#000000',
    strokeStyle: '#000000',
    lineWidth: 1,
    lineCap: 'butt',
    lineJoin: 'miter',
    globalAlpha: 1,
    font: '10px sans-serif',
    textAlign: 'left',
    textBaseline: 'alphabetic',
    lineDashOffset: 0,
    _dash: [],
    _dashOffset: 0,

    setLineDash(segments) {
      this._dash = segments || [];
    },

    save() {
      stateStack.push({ ...state, matrix: [...state.matrix] });
      groupDepthStack.push(groupStack.length);
    },

    restore() {
      const prev = stateStack.pop();
      if (prev) state = prev;
      const depth = groupDepthStack.pop();
      if (depth != null) groupStack.length = depth;
    },

    translate(x, y) {
      state.matrix = multiply(state.matrix, [1, 0, 0, 1, x, y]);
    },
    scale(x, y) {
      state.matrix = multiply(state.matrix, [x, 0, 0, y, 0, 0]);
    },
    rotate(angle) {
      const cos = Math.cos(angle);
      const sin = Math.sin(angle);
      state.matrix = multiply(state.matrix, [cos, sin, -sin, cos, 0, 0]);
    },
    setTransform(a, b, c, d, e, f) {
      state.matrix = [a, b, c, d, e, f];
    },

    beginPath() {
      path = new SvgPath2D();
    },
    moveTo(x, y) {
      const p = apply(state.matrix, x, y);
      path.moveTo(p.x, p.y);
    },
    lineTo(x, y) {
      const p = apply(state.matrix, x, y);
      path.lineTo(p.x, p.y);
    },
    closePath() {
      path.close();
    },
    rect(x, y, w, h) {
      this.moveTo(x, y);
      this.lineTo(x + w, y);
      this.lineTo(x + w, y + h);
      this.lineTo(x, y + h);
      this.closePath();
    },

    // Full-circle arcs (dots/handles) split into two semicircles, since a
    // single SVG `A` command can't represent a 360° sweep — its start and
    // end point would coincide, which the spec treats as a zero-length
    // arc. Anything else becomes one `A` command with the standard
    // large-arc/sweep flags derived from the swept angle's sign and size.
    arc(cx, cy, r, startAngle, endAngle, anticlockwise = false) {
      const span = anticlockwise ? startAngle - endAngle : endAngle - startAngle;
      const normalizedSpan = ((span % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
      const isFullCircle = Math.abs(span) >= 2 * Math.PI - 1e-6;
      const start = { x: cx + r * Math.cos(startAngle), y: cy + r * Math.sin(startAngle) };
      const pStart = apply(state.matrix, start.x, start.y);
      path.lineTo(pStart.x, pStart.y);

      const drawArcTo = (fromAngle, toAngle) => {
        const end = { x: cx + r * Math.cos(toAngle), y: cy + r * Math.sin(toAngle) };
        const pEnd = apply(state.matrix, end.x, end.y);
        const sub = anticlockwise ? fromAngle - toAngle : toAngle - fromAngle;
        const normSub = ((sub % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        const largeArc = normSub > Math.PI ? 1 : 0;
        const sweep = anticlockwise ? 0 : 1;
        // Radius transformed the same way a point offset by it would be —
        // exact only when the CTM has no differential x/y scale, true for
        // every transform this renderer ever builds (uniform camera zoom,
        // pure rotations for resize-grip corners).
        const pCenter = apply(state.matrix, cx, cy);
        const pEdge = apply(state.matrix, cx + r, cy);
        const rDevice = Math.hypot(pEdge.x - pCenter.x, pEdge.y - pCenter.y);
        path.current.push({
          arc: true,
          rx: rDevice,
          ry: rDevice,
          largeArc,
          sweep,
          x: pEnd.x,
          y: pEnd.y,
        });
      };

      if (isFullCircle) {
        const mid = startAngle + (anticlockwise ? -Math.PI : Math.PI);
        drawArcTo(startAngle, mid);
        drawArcTo(mid, startAngle + (anticlockwise ? -2 * Math.PI : 2 * Math.PI));
      } else {
        drawArcTo(startAngle, anticlockwise ? startAngle - normalizedSpan : startAngle + normalizedSpan);
      }
    },

    // The standard "tangent circle at the corner" construction used by
    // every real Canvas2D implementation — reimplemented here rather than
    // special-cased for this renderer's one call pattern (rounded-rect
    // corners, see BlockRenderer.roundRectPath) so any future arcTo call
    // still renders correctly instead of silently degrading to a square
    // corner.
    arcTo(x1, y1, x2, y2, radius) {
      const cur = path.current?.[path.current.length - 1];
      if (!cur) {
        this.moveTo(x1, y1);
        return;
      }
      // Current point is already in device space; invert isn't needed —
      // do the tangent-circle math in device space directly, treating
      // (x1,y1)/(x2,y2) through the same transform as any other point.
      const p1 = apply(state.matrix, x1, y1);
      const p2 = apply(state.matrix, x2, y2);
      const p0 = { x: cur.x, y: cur.y };
      const dx1 = p0.x - p1.x;
      const dy1 = p0.y - p1.y;
      const dx2 = p2.x - p1.x;
      const dy2 = p2.y - p1.y;
      const len1 = Math.hypot(dx1, dy1);
      const len2 = Math.hypot(dx2, dy2);
      const cross = dx1 * dy2 - dy1 * dx2;
      if (len1 === 0 || len2 === 0 || cross === 0 || radius === 0) {
        path.lineTo(p1.x, p1.y);
        return;
      }
      const dot = dx1 * dx2 + dy1 * dy2;
      const angle = Math.acos(Math.max(-1, Math.min(1, dot / (len1 * len2))));
      // Radius scaled by the CTM the same approximating way arc() does.
      const pCenter = apply(state.matrix, 0, 0);
      const pEdge = apply(state.matrix, radius, 0);
      const rDevice = Math.hypot(pEdge.x - pCenter.x, pEdge.y - pCenter.y);
      const dist = rDevice / Math.tan(angle / 2);
      const t1 = { x: p1.x + (dx1 / len1) * dist, y: p1.y + (dy1 / len1) * dist };
      const t2 = { x: p1.x + (dx2 / len2) * dist, y: p1.y + (dy2 / len2) * dist };
      path.lineTo(t1.x, t1.y);
      path.current.push({ arc: true, rx: rDevice, ry: rDevice, largeArc: 0, sweep: cross < 0 ? 1 : 0, x: t2.x, y: t2.y });
    },

    fill() {
      el('path', { d: pathToD(path), ...fillAttrs() });
    },
    stroke() {
      el('path', { d: pathToD(path), ...strokeAttrs() });
    },
    clip() {
      const id = `clip-${clipCounter}`;
      clipCounter += 1;
      const clipPath = doc.createElementNS(SVG_NS, 'clipPath');
      clipPath.setAttribute('id', id);
      const shape = doc.createElementNS(SVG_NS, 'path');
      shape.setAttribute('d', pathToD(path));
      clipPath.appendChild(shape);
      defs.appendChild(clipPath);
      const group = doc.createElementNS(SVG_NS, 'g');
      group.setAttribute('clip-path', `url(#${id})`);
      currentGroup().appendChild(group);
      groupStack.push(group);
    },

    fillRect(x, y, w, h) {
      const corners = [
        apply(state.matrix, x, y),
        apply(state.matrix, x + w, y),
        apply(state.matrix, x + w, y + h),
        apply(state.matrix, x, y + h),
      ];
      el('path', { d: cornersToD(corners), ...fillAttrs() });
    },
    strokeRect(x, y, w, h) {
      const corners = [
        apply(state.matrix, x, y),
        apply(state.matrix, x + w, y),
        apply(state.matrix, x + w, y + h),
        apply(state.matrix, x, y + h),
      ];
      el('path', { d: cornersToD(corners), ...strokeAttrs() });
    },
    // No-op: an SVG document starts empty, so there's nothing a mid-render
    // clear needs to erase (see renderScene's one call at the very top).
    clearRect() {},

    fillText(text, x, y, maxWidth) {
      if (!text) return;
      const width = this.measureText(text).width;
      const squeeze = maxWidth && width > maxWidth ? maxWidth / width : 1;
      const p = apply(state.matrix, x, y);
      const anchor = { left: 'start', right: 'end', center: 'middle' }[this.textAlign] || 'start';
      // SVG has no single-keyword equivalent of canvas's 'middle' vertical
      // baseline that every renderer agrees on — 0.35em is the standard
      // approximation for visually centering a line of text on its own
      // baseline-to-cap-height midpoint.
      const dy = { top: '0.75em', middle: '0.35em', bottom: '-0.1em', alphabetic: '0' }[this.textBaseline] || '0';
      const attrs = {
        x: fmt(p.x),
        y: fmt(p.y),
        'text-anchor': anchor,
        dy,
        'font-family': fontPart(this.font, 'family'),
        'font-size': fontPart(this.font, 'size'),
        'font-weight': fontPart(this.font, 'weight'),
        'font-style': fontPart(this.font, 'style'),
        ...fillAttrs(),
      };
      if (squeeze !== 1) attrs.transform = `translate(${fmt(p.x)} 0) scale(${fmt(squeeze)} 1) translate(${fmt(-p.x)} 0)`;
      const node = el('text', attrs);
      node.textContent = text;
    },
    measureText(text) {
      measureCtx.font = this.font;
      return measureCtx.measureText(text);
    },

    drawImage(img, dx, dy, dw, dh) {
      const corners = [apply(state.matrix, dx, dy), apply(state.matrix, dx + dw, dy + dh)];
      const x = Math.min(corners[0].x, corners[1].x);
      const y = Math.min(corners[0].y, corners[1].y);
      const w = Math.abs(corners[1].x - corners[0].x);
      const h = Math.abs(corners[1].y - corners[0].y);
      const node = doc.createElementNS(SVG_NS, 'image');
      node.setAttributeNS('http://www.w3.org/1999/xlink', 'href', img.src);
      node.setAttribute('href', img.src);
      node.setAttribute('x', fmt(x));
      node.setAttribute('y', fmt(y));
      node.setAttribute('width', fmt(w));
      node.setAttribute('height', fmt(h));
      currentGroup().appendChild(node);
    },
  };

  // fillStyle/etc. are plain read/write properties on `ctx` (not the
  // internal `state`) so ordinary `ctx.fillStyle = '#fff'` assignments
  // just work — save()/restore() sync them into/out of `state` explicitly
  // since they need to be part of the snapshot.
  for (const key of ['fillStyle', 'strokeStyle', 'lineWidth', 'lineCap', 'lineJoin', 'globalAlpha', 'font', 'textAlign', 'textBaseline']) {
    Object.defineProperty(ctx, key, {
      get() {
        return state[key];
      },
      set(value) {
        state[key] = value;
      },
    });
  }
  Object.defineProperty(ctx, 'lineDashOffset', {
    get() {
      return state.dashOffset;
    },
    set(value) {
      state.dashOffset = value;
      ctx._dashOffset = value;
    },
  });
  const realSetLineDash = ctx.setLineDash.bind(ctx);
  ctx.setLineDash = (segments) => {
    state.dash = segments || [];
    ctx._dash = state.dash;
    realSetLineDash(segments);
  };

  function pathToD(p) {
    return p.subpaths
      .map((sub) => {
        const [start, ...rest] = sub;
        let d = `M ${fmt(start.x)} ${fmt(start.y)}`;
        for (const seg of rest) {
          if (seg.close) d += ' Z';
          else if (seg.arc) d += ` A ${fmt(seg.rx)} ${fmt(seg.ry)} 0 ${seg.largeArc} ${seg.sweep} ${fmt(seg.x)} ${fmt(seg.y)}`;
          else d += ` L ${fmt(seg.x)} ${fmt(seg.y)}`;
        }
        return d;
      })
      .join(' ');
  }

  function cornersToD(corners) {
    return `M ${corners.map((c) => `${fmt(c.x)} ${fmt(c.y)}`).join(' L ')} Z`;
  }

  return {
    ctx,
    serialize() {
      return new XMLSerializer().serializeToString(svg);
    },
  };
}

function fontPart(font, part) {
  // `font` is always a CSS font shorthand string this app builds itself
  // (see render/fonts.js) — small, regular tokens, not arbitrary user
  // input, so a couple of regexes cover every case rather than needing a
  // real CSS font-shorthand parser.
  const sizeMatch = font.match(/(\d+(?:\.\d+)?)px/);
  const weight = /\bbold\b/.test(font) ? 'bold' : 'normal';
  const style = /\bitalic\b/.test(font) ? 'italic' : 'normal';
  const family = font.replace(/^\s*(italic\s+)?(bold\s+)?\d+(?:\.\d+)?px\s+/, '').trim() || 'sans-serif';
  if (part === 'size') return sizeMatch ? `${sizeMatch[1]}px` : '10px';
  if (part === 'weight') return weight;
  if (part === 'style') return style;
  return family;
}
