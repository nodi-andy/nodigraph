// Local file save/open — the draw.io-style escape hatch that doesn't
// depend on the server or Google at all: a plain JSON download you can
// keep in your own files/git repo and load back in exactly the same
// shape (rootBlock tree) the server persists as data/project.json.

// Exported for anything else that downloads a file named after the current
// diagram (see model/diagramSvg.js's SVG export) — one place deciding what
// makes a filename safe rather than each caller re-deriving it.
export function safeFileStem(name) {
  return (name || 'project').trim().replace(/[^a-z0-9 _-]/gi, '').replace(/\s+/g, '-') || 'project';
}

export function downloadProjectFile(project) {
  const data = project.toJSON();
  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = `${safeFileStem(project.name)}.nodigraph.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

// Throws if the file isn't parseable JSON or doesn't have the shape a
// nodigraph project needs (a rootBlock) — the caller is expected to
// surface that to the user rather than silently doing nothing.
export async function readProjectFile(file) {
  const text = await file.text();
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
