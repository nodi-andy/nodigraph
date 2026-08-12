import { Project } from './Project.js';

const STORAGE_KEY = 'gravis-sysml:project';

export function loadProject() {
  const raw = localStorage.getItem(STORAGE_KEY);
  if (!raw) return null;
  try {
    return Project.fromJSON(JSON.parse(raw));
  } catch {
    return null;
  }
}

export function saveProject(project) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(project.toJSON()));
}
