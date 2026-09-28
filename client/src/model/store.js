import { Project } from './Project.js';

const API_URL = '/api/project';
const LOCAL_STORAGE_KEY = 'nodigraph:project';

// Two layers, in priority order: the small server in server/src/app.js
// (reads/writes a real file on disk — see data/project.json), and this
// browser's own localStorage underneath it. The server is the shared,
// multi-client copy when it's reachable, but nothing here requires it to
// exist — a plain static deployment (or a dropped connection) still keeps
// every edit through the local layer alone, rather than losing work on
// the next reload just because there was no server to answer. A link's
// own `#d=` snapshot outranks both (see main.js's isSharedView) and is
// never written into either — this module never sees that case at all.

export async function loadProject() {
  try {
    const res = await fetch(API_URL);
    if (res.ok) {
      const data = await res.json();
      if (data) return Project.fromJSON(data);
    }
  } catch {
    // Server not reachable — fall through to the local copy below.
  }
  return loadProjectFromLocalStorage();
}

function loadProjectFromLocalStorage() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? Project.fromJSON(JSON.parse(raw)) : null;
  } catch {
    // Corrupt entry, storage disabled (private browsing, some embedded
    // webviews), or quota errors reading back — same outcome either way:
    // start from a blank project rather than throwing during boot.
    return null;
  }
}

// Resolves to whether the shared copy took the save: true from the server
// (or a host transport), false when it refused or could not be reached.
// The local layer's outcome is not part of it. `flush` is the explicit
// Save: a host transport that batches the autosaves writes this one now.
//
// window.nodigraphSaveProject(data, { flush }): a host page can take the
// shared copy's write over — a page served by a device whose own API
// cannot hold a body this size in RAM stores it through a different
// endpoint of that device (noditron's board page). It resolves to whether
// the write took.
export async function saveProject(project, { flush = false } = {}) {
  const data = project.toJSON();
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage full or unavailable — the shared write below is still worth
    // attempting; if that also fails the edit just isn't persisted this
    // time, exactly as before this local layer existed.
  }
  if (typeof window !== 'undefined' && typeof window.nodigraphSaveProject === 'function') {
    try {
      return Boolean(await window.nodigraphSaveProject(data, { flush }));
    } catch {
      return false;
    }
  }
  try {
    const res = await fetch(API_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
    return res.ok;
  } catch {
    // Best-effort: a network hiccup (or no server at all) shouldn't crash
    // the app or block the local save above, which already went through.
    return false;
  }
}
