// Local file save/open — the draw.io-style escape hatch that doesn't
// depend on the server or Google at all. Two formats:
//   - JSON: exactly project.toJSON()'s own shape (the rootBlock tree),
//     full fidelity, also what the server/localStorage autosave uses.
//   - YAML: model/slimFormat.js's deliberately slim rewrite of the same
//     graph — human-editable, but drops routing/placement cosmetics that
//     regenerate fine on their own (see that module's own doc).
// Import accepts either and hands back the same full JSON shape either
// way, so every other caller of readProjectFile stays oblivious to which
// one a given file actually was.
import { projectDataToYamlText, yamlTextToProjectData } from './slimFormat.js';

// Exported for anything else that downloads a file named after the current
// diagram (see model/diagramSvg.js's SVG export) — one place deciding what
// makes a filename safe rather than each caller re-deriving it.
export function safeFileStem(name) {
  return (name || 'project').trim().replace(/[^a-z0-9 _-]/gi, '').replace(/\s+/g, '-') || 'project';
}

export function downloadProjectFile(project, format = 'json') {
  const data = project.toJSON();
  const isYaml = format === 'yaml';
  const text = isYaml ? projectDataToYamlText(data) : JSON.stringify(data, null, 2);
  const blob = new Blob([text], { type: isYaml ? 'text/yaml' : 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeFileStem(project.name)}.nodigraph.${isYaml ? 'yaml' : 'json'}`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Throws if the file isn't parseable (JSON or YAML, by extension first,
// content sniffing as a fallback for a renamed file) or doesn't have the
// shape a nodigraph project needs — the caller is expected to surface that
// to the user rather than silently doing nothing.
export async function readProjectFile(file) {
  const text = await file.text();
  const isYaml = /\.(ya?ml)$/i.test(file.name) || (!/\.json$/i.test(file.name) && /^\s*(name|blocks)\s*:/.test(text));
  if (isYaml) return yamlTextToProjectData(text);

  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new Error('Not valid JSON');
  }
  if (!data?.rootBlock) {
    throw new Error('Not a nodigraph project file');
  }
  return data;
}
