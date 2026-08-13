import { Project } from './Project.js';

const API_URL = '/api/project';

// Talks to the small server in server/src/app.js, which reads/writes a
// real file on disk (see data/project.json) — this replaced the earlier
// localStorage version, which only worked in one browser and was easy to
// lose entirely by clearing site data.

// Raw JSON, not yet hydrated into a Project — main.js's poll needs this to
// compare against what it already has before deciding whether to re-hydrate.
export async function fetchProjectSnapshot() {
  try {
    const res = await fetch(API_URL);
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

export async function loadProject() {
  const data = await fetchProjectSnapshot();
  return data ? Project.fromJSON(data) : null;
}

export async function saveProject(project) {
  try {
    await fetch(API_URL, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(project.toJSON()),
    });
  } catch {
    // Best-effort: a network hiccup shouldn't crash the app. The in-memory
    // state is still correct, it just isn't saved yet.
  }
}
