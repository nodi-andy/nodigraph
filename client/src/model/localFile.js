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

// --- Remembering the open file across reloads ------------------------
// A file handle survives in IndexedDB (it is structured-cloneable; the
// browser re-asks for write permission on first use after a reload, from
// the Save click, which is a user gesture). What is remembered beside it
// is the diagram as the file last held it, so after a reload the unsaved
// dot compares the autosaved graph against the file rather than assuming
// either. Every function here swallows storage errors: a browser without
// IndexedDB, or one that refuses it in a private window, just does not
// remember, which is exactly what happened before this existed.
const DB_NAME = 'nodigraph';
const DB_STORE = 'files';
const DB_KEY = 'current';

function openFileDb() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('no IndexedDB'));
      return;
    }
    const request = indexedDB.open(DB_NAME, 1);
    request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

function withFileStore(mode, run) {
  return openFileDb().then(
    (db) =>
      new Promise((resolve, reject) => {
        const tx = db.transaction(DB_STORE, mode);
        const request = run(tx.objectStore(DB_STORE));
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
        tx.oncomplete = () => db.close();
      }),
  );
}

// `folder` (optional) is the diagram's folder — the directory handle the
// pictures of image blocks are read relative to (see relativeImageRef) —
// remembered with the file so those pictures come back after a reload
// too. Either one may be null.
export async function rememberFileHandle(handle, snapshot, folder = null) {
  try {
    await withFileStore('readwrite', (store) => store.put({ handle: handle ?? null, snapshot: snapshot ?? null, folder: folder ?? null }, DB_KEY));
  } catch {
    // Not remembered; see above.
  }
}

// { handle, snapshot, folder } as last remembered, or null when nothing is.
export async function recallFileHandle() {
  try {
    const entry = await withFileStore('readonly', (store) => store.get(DB_KEY));
    return entry?.handle || entry?.folder ? { handle: entry.handle ?? null, snapshot: entry.snapshot ?? null, folder: entry.folder ?? null } : null;
  } catch {
    return null;
  }
}

export async function forgetFileHandle() {
  try {
    await withFileStore('readwrite', (store) => store.delete(DB_KEY));
  } catch {
    // Nothing to forget, or nowhere it was kept.
  }
}

// Whether two project JSON texts describe the same diagram. A snapshot
// that went through storage comes back with its keys in a different order
// (see Block.hydrateBlock), so the plain string equality the in-session
// snapshots use is wrong across a reload; this compares them with keys
// sorted. Unparseable input is only ever equal to itself.
export function sameProjectText(a, b) {
  if (a === b) return true;
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const sorted = (value) => {
    if (Array.isArray(value)) return value.map(sorted);
    if (value && typeof value === 'object') {
      return Object.fromEntries(Object.keys(value).sort().map((key) => [key, sorted(value[key])]));
    }
    return value;
  };
  try {
    return JSON.stringify(sorted(JSON.parse(a))) === JSON.stringify(sorted(JSON.parse(b)));
  } catch {
    return false;
  }
}

// --- Pictures from the file system -----------------------------------
// An image block's picture can be a file next to the diagram: the block
// stores a path relative to the diagram's folder, so the diagram and its
// pictures move together as a folder. The folder is a directory handle
// the person picks once (pickProjectFolder), remembered beside the file
// (see rememberFileHandle). Chromium only, like everything above.

const IMAGE_FILE_TYPES = [
  { description: 'Picture', accept: { 'image/*': ['.png', '.jpg', '.jpeg', '.gif', '.webp', '.svg', '.avif'] } },
];

export function supportsFolderAccess() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function';
}

// A picked picture and its handle, or null if the picker was dismissed.
export async function pickImageFile() {
  try {
    const [handle] = await window.showOpenFilePicker({ types: IMAGE_FILE_TYPES, multiple: false });
    return { file: await handle.getFile(), handle };
  } catch (err) {
    if (err?.name === 'AbortError') return null;
    throw err;
  }
}

// The diagram's folder, chosen by the person, or null if dismissed.
export async function pickProjectFolder() {
  try {
    return await window.showDirectoryPicker({ mode: 'readwrite' });
  } catch (err) {
    if (err?.name === 'AbortError') return null;
    throw err;
  }
}

async function ensurePermission(handle, mode) {
  if (typeof handle.queryPermission !== 'function') return true;
  let state = await handle.queryPermission({ mode });
  if (state !== 'granted') state = await handle.requestPermission({ mode });
  return state === 'granted';
}

// The reference an image block stores for `imageHandle`: its path
// relative to `folder` when the file is somewhere inside it, else the
// file is imported — copied into the folder under its own name (a
// numbered one if that name is taken) — and the reference is that name.
// Either way the diagram's folder holds everything the diagram shows.
export async function relativeImageRef(folder, imageHandle, file) {
  const inside = await folder.resolve(imageHandle);
  if (inside) return inside.join('/');
  if (!(await ensurePermission(folder, 'readwrite'))) throw new Error('write access to the folder was not granted');
  const dot = file.name.lastIndexOf('.');
  const stem = dot > 0 ? file.name.slice(0, dot) : file.name;
  const ext = dot > 0 ? file.name.slice(dot) : '';
  let name = file.name;
  for (let n = 2; ; n += 1) {
    let exists = true;
    try {
      await folder.getFileHandle(name);
    } catch {
      exists = false;
    }
    if (!exists) break;
    name = `${stem}-${n}${ext}`;
  }
  const target = await folder.getFileHandle(name, { create: true });
  const writable = await target.createWritable();
  await writable.write(await file.arrayBuffer());
  await writable.close();
  return name;
}

// Whether `folder` can be read right now without asking. Asking needs a
// user gesture, which the caller has to supply (see main.js).
export async function folderReadable(folder) {
  if (typeof folder.queryPermission !== 'function') return true;
  return (await folder.queryPermission({ mode: 'read' })) === 'granted';
}

export async function requestFolderRead(folder) {
  return ensurePermission(folder, 'read');
}

// An object URL for the file at `ref` (a '/'-separated path) inside
// `folder`, or null when there is no such file. The folder must be
// readable (see folderReadable).
export async function readFolderImageUrl(folder, ref) {
  const parts = ref.split('/').filter((part) => part && part !== '.');
  if (!parts.length || parts.includes('..')) return null;
  try {
    let dir = folder;
    for (const part of parts.slice(0, -1)) dir = await dir.getDirectoryHandle(part);
    const fileHandle = await dir.getFileHandle(parts[parts.length - 1]);
    return URL.createObjectURL(await fileHandle.getFile());
  } catch {
    return null;
  }
}

// A picture as a data: URL, to live inside the diagram itself — the
// choice when no diagram folder is known to reference it from (see
// main.js's chooseImage). Self-contained: it draws everywhere, exports
// with the diagram, and asks for no permission after a reload. The cost
// is size, which the caller warns about past a point.
export function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error || new Error('could not read the file'));
    reader.readAsDataURL(file);
  });
}

// A picture chosen through a plain file input — every browser has one —
// or null if none was chosen.
export function pickImageFileFallback() {
  return new Promise((resolve) => {
    const input = document.createElement('input');
    input.type = 'file';
    input.accept = 'image/*';
    input.style.display = 'none';
    document.body.appendChild(input);
    let settled = false;
    const finish = (file) => {
      if (settled) return;
      settled = true;
      input.remove();
      resolve(file || null);
    };
    input.addEventListener('change', () => finish(input.files?.[0] || null));
    // The dialog closing with nothing chosen fires no event; the window
    // regaining focus is the best hint, a moment later.
    window.addEventListener('focus', () => setTimeout(() => finish(input.files?.[0] || null), 400), { once: true });
    input.click();
  });
}
