#!/usr/bin/env node
// nodigraph layout — turns a diagram description into a placed diagram,
// and hands it back in whichever form is wanted.
//
//   node client/tools/layout.mjs diagram.yaml                 # placed YAML on stdout
//   node client/tools/layout.mjs diagram.yaml --json          # full project JSON
//   node client/tools/layout.mjs diagram.yaml --link          # https://nodigraph.com/#d=…
//   node client/tools/layout.mjs diagram.yaml --out placed.yaml
//   node client/tools/layout.mjs diagram.yaml --force         # re-lay-out every level
//
// The input is the slim authoring format (docs/LLM-AUTHORING.md); a saved
// project .json works too. Every level whose blocks carry no `x`/`y` is
// laid out (see client/src/model/autoLayout.js) exactly as the editor
// would on opening the file, so the YAML this prints is what the editor
// would export after that: every coordinate and pin offset filled in,
// ready to be hand-edited, committed, or pasted. `--force` lays out every
// level again, coordinates or not. `--link` packs the result into a share
// link the way the editor's Share button does (gzip, base64url), so a
// diagram can go from text to a URL without opening a browser.
import fs from 'node:fs';
import path from 'node:path';

const src = (p) => new URL(`../src/${p}`, import.meta.url).href;
const { parseYaml, stringifyYaml } = await import(src('model/yaml.js'));
const { slimToProjectData, projectDataToSlim } = await import(src('model/slimFormat.js'));
const { autoLayoutProjectData } = await import(src('model/autoLayout.js'));
const { encodeProjectToParam } = await import(src('model/shareLink.js'));

const args = process.argv.slice(2);
const flag = (name) => args.includes(name);
const option = (name) => {
  const i = args.indexOf(name);
  return i === -1 ? null : args[i + 1] ?? null;
};
const file = args.find((a, i) => !a.startsWith('--') && args[i - 1] !== '--out' && args[i - 1] !== '--base');
if (!file) {
  console.error('usage: node client/tools/layout.mjs <diagram.yaml|project.json> [--json | --link] [--out file] [--force] [--base https://nodigraph.com/]');
  process.exit(2);
}

const text = fs.readFileSync(file, 'utf8');
let data;
if (file.endsWith('.json')) {
  data = autoLayoutProjectData(JSON.parse(text), { force: flag('--force') });
} else {
  const slim = parseYaml(text);
  if (!slim || typeof slim.blocks !== 'object') {
    console.error(`${file}: not a nodigraph YAML document (no \`blocks\` mapping)`);
    process.exit(2);
  }
  if (flag('--force')) slim.layout = 'auto';
  data = slimToProjectData(slim);
}

let out;
if (flag('--link')) {
  const base = option('--base') || 'https://nodigraph.com/';
  const param = await encodeProjectToParam({ toJSON: () => data });
  // In the fragment, never sent to the server (see model/shareLink.js).
  out = `${base.replace(/#.*$/, '')}#d=${param}\n`;
} else if (flag('--json')) {
  out = JSON.stringify(data, null, 2) + '\n';
} else {
  out = stringifyYaml(projectDataToSlim(data));
}

const target = option('--out');
if (target) {
  fs.writeFileSync(target, out);
  console.error(`wrote ${path.relative(process.cwd(), target)}`);
} else {
  process.stdout.write(out);
}
