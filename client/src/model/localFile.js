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

// 'yaml' for a .yaml/.yml name, 'json' for anything else — the one rule
// both the download and the file-handle save go by, so a file keeps the
// format its name says.
export function formatForFileName(name) {
  return /\.ya?ml$/i.test(name || '') ? 'yaml' : 'json';
}

// The text a project file holds in the given format. A file, so linked
// blocks are written as references (see Block.js).
export function projectFileText(project, format = 'json') {
  const data = project.toJSON({ linkedAsReference: true });
  return format === 'yaml' ? projectDataToYamlText(data) : JSON.stringify(data, null, 2);
}

export function downloadProjectFile(project, format = 'json') {
  const isYaml = format === 'yaml';
  const text = projectFileText(project, format);
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

// --- File System Access API (Chromium: Chrome, Edge) ----------------
// Where the browser offers it, Open hands back a handle to the file as
// well as its contents, and a later Save writes straight back into that
// same file — no download, no "save as" every time. Firefox and Safari
// have no writable handles, so every function here reports that (false,
// null) and the callers keep their file-input / download paths.

const PROJECT_FILE_TYPES = [
  { description: 'nodigraph diagram', accept: { 'application/json': ['.json'], 'text/yaml': ['.yaml', '.yml'] } },
];

export function supportsFileSystemAccess() {
  return typeof window !== 'undefined' && typeof window.showOpenFilePicker === 'function';
}

// The picked file and its handle, or null if the picker was dismissed.
export async function pickProjectFile() {
  try {
    const [handle] = await window.showOpenFilePicker({ types: PROJECT_FILE_TYPES, multiple: false });
    return { file: await handle.getFile(), handle };
  } catch (err) {
    if (err?.name === 'AbortError') return null;
    throw err;
  }
}

// A handle for a new (or chosen existing) file to save into, or null if
// the picker was dismissed.
export async function pickSaveHandle(suggestedName) {
  try {
    return await window.showSaveFilePicker({ suggestedName, types: PROJECT_FILE_TYPES });
  } catch (err) {
    if (err?.name === 'AbortError') return null;
    throw err;
  }
}

// Writes the project into `handle`'s file, in the format its name says.
// Write access is asked for on first use (the browser prompts once per
// site session); a refusal throws, and the caller says so.
export async function writeProjectToHandle(project, handle) {
  if (typeof handle.queryPermission === 'function') {
    let state = await handle.queryPermission({ mode: 'readwrite' });
    if (state !== 'granted') state = await handle.requestPermission({ mode: 'readwrite' });
    if (state !== 'granted') throw new Error('write access to the file was not granted');
  }
  const format = formatForFileName(handle.name);
  const writable = await handle.createWritable();
  await writable.write(projectFileText(project, format));
  await writable.close();
  return format;
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
