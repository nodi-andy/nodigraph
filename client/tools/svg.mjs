#!/usr/bin/env node
// nodigraph svg — draws a diagram to an SVG file without a browser.
//
//   node client/tools/svg.mjs diagram.yaml                    # top level, SVG on stdout
//   node client/tools/svg.mjs diagram.yaml --out figure.svg
//   node client/tools/svg.mjs diagram.yaml --level "Retrieval/Similarity search"
//   node client/tools/svg.mjs diagram.yaml --all --out-dir docs/figures
//
// The input is the slim authoring format (docs/LLM-AUTHORING.md) or a
// saved project .json; a YAML level without coordinates is laid out first,
// exactly as the editor would on opening it. The picture is drawn by the
// editor's own SVG export (see model/diagramSvg.js), which records the
// canvas calls of the real renderer into an SVG document, so this is the
// same figure Export → SVG gives — the only things standing in for the
// browser here are a small SVG document builder and an estimate of text
// widths (see model/autoLayout.js), which the renderer only uses to squeeze
// a label that would not fit its block.
//
// `--level` names a nested level by its block names from the top, joined
// with `/`; `--all` writes every level, named <stem>.svg for the top and
// <stem>--<Block>--<Child>.svg for the ones inside.
import fs from 'node:fs';
import path from 'node:path';

// ---------- a document just big enough for render/svgContext.js ----------

const ESC = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' };
const escape = (s) => String(s).replace(/[&<>"]/g, (c) => ESC[c]);

class Element {
  constructor(tag) {
    this.tag = tag;
    this.attrs = new Map();
    this.children = [];
    this.text = null;
  }
  setAttribute(name, value) {
    this.attrs.set(name, String(value));
  }
  setAttributeNS(ns, name, value) {
    this.setAttribute(name === 'href' && ns ? 'xlink:href' : name, value);
  }
  appendChild(child) {
    this.children.push(child);
    return child;
  }
  set textContent(value) {
    this.text = value === null || value === undefined ? null : String(value);
  }
  get textContent() {
    return this.text;
  }
  toString() {
    const attrs = [...this.attrs].map(([k, v]) => ` ${k}="${escape(v)}"`).join('');
    const inner = (this.text !== null ? escape(this.text) : '') + this.children.map(String).join('');
    return inner ? `<${this.tag}${attrs}>${inner}</${this.tag}>` : `<${this.tag}${attrs}/>`;
  }
}

class Document {
  constructor(rootTag) {
    this.documentElement = new Element(rootTag);
  }
  createElementNS(ns, tag) {
    return new Element(tag);
  }
}

// What the renderer asks a 2D context for when it is not drawing: the
// width of a string in a CSS font.
function parseFont(font) {
  const size = Number((font.match(/(\d+(?:\.\d+)?)px/) || [])[1]) || 13;
  return { size, bold: /\bbold\b|\b[6-9]00\b/.test(font), mono: /mono/i.test(font) };
}

function installDom(estimateTextWidth) {
  const measureContext = () => {
    const ctx = { font: '10px sans-serif' };
    ctx.measureText = (text) => {
      const f = parseFont(ctx.font);
      return { width: estimateTextWidth(text, f.size, { bold: f.bold, mono: f.mono }) };
    };
    return ctx;
  };
  globalThis.document = {
    implementation: { createDocument: (ns, rootTag) => new Document(rootTag) },
    createElement: () => ({ getContext: measureContext }),
    fonts: { load: () => Promise.resolve([]) },
  };
  globalThis.XMLSerializer = class {
    serializeToString(node) {
      return String(node);
    }
  };
  globalThis.Image = class {};
  globalThis.window = globalThis;
}

// ---------- CLI ----------

const src = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { estimateTextWidth } = await import(src('model/autoLayout.js'));
installDom(estimateTextWidth);
const { parseYaml } = await import(src('model/yaml.js'));
const { slimToProjectData } = await import(src('model/slimFormat.js'));
const { Project } = await import(src('model/Project.js'));
const { renderCurrentLevelSvgString } = await import(src('model/diagramSvg.js'));

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1] ?? null;
};
const valued = new Set(['--out', '--out-dir', '--level']);
const file = args.find((a, i) => !a.startsWith('--') && !valued.has(args[i - 1]));
if (!file) {
  console.error('usage: node client/tools/svg.mjs <diagram.yaml|project.json> [--level "A/B"] [--out file.svg] [--all --out-dir dir]');
  process.exit(2);
}

const text = fs.readFileSync(file, 'utf8');
const data = file.endsWith('.json') ? JSON.parse(text) : slimToProjectData(parseYaml(text));
const project = Project.fromJSON(data);
const stem = path.basename(file).replace(/\.nodigraph\.json$/i, '').replace(/\.(json|ya?ml)$/i, '');

// Every level as [names from the top], depth first.
function levels(block, trail = []) {
  const out = [{ trail, block }];
  for (const child of block.children?.blocks.values() || []) {
    if (child.children?.blocks?.size) out.push(...levels(child, [...trail, child.name]));
  }
  return out;
}

function enter(trail) {
  project.path = [];
  let container = project.rootBlock;
  for (const name of trail) {
    const next = [...container.children.blocks.values()].find((b) => b.name === name);
    if (!next) throw new Error(`no block "${name}" inside ${container.name}`);
    project.path = [...project.path, next.id];
    container = next;
  }
}

const safe = (s) => s.replace(/[^a-z0-9 _-]/gi, '').trim().replace(/\s+/g, '-');

if (flag('--all')) {
  const dir = option('--out-dir') || '.';
  fs.mkdirSync(dir, { recursive: true });
  for (const { trail } of levels(project.rootBlock)) {
    enter(trail);
    const name = trail.length ? `${stem}--${trail.map(safe).join('--')}.svg` : `${stem}.svg`;
    fs.writeFileSync(path.join(dir, name), renderCurrentLevelSvgString(project));
    console.error(`wrote ${path.join(dir, name)}`);
  }
} else {
  const level = option('--level');
  enter(level ? level.split('/').map((s) => s.trim()).filter(Boolean) : []);
  const svg = renderCurrentLevelSvgString(project);
  const target = option('--out');
  if (target) {
    fs.writeFileSync(target, svg);
    console.error(`wrote ${target}`);
  } else {
    process.stdout.write(svg);
  }
}
