// Undo/redo as whole-project snapshots rather than per-action inverse
// commands. The project already serialises to compact JSON and can rebuild
// itself from one in place (Project.applyRemoteRootBlock), so a snapshot
// costs little and — unlike a command log — cannot drift out of sync with
// the model as new kinds of edit are added. Every edit already funnels
// through one persist(), which is the single place snapshots are taken.
//
// Each entry carries the view path as well as the tree: undoing the act of
// entering a block should also put you back outside it, and the path isn't
// part of the serialised project.
const DEFAULT_LIMIT = 100;

export class History {
  constructor(entry, limit = DEFAULT_LIMIT) {
    this.limit = limit;
    this.current = entry;
    this.past = [];
    this.future = [];
  }

  get canUndo() {
    return this.past.length > 0;
  }

  get canRedo() {
    return this.future.length > 0;
  }

  // No-ops when nothing actually changed — persist() also runs for things
  // like navigating levels, which leave the serialised tree identical.
  record(entry) {
    if (entry.json === this.current.json) return false;
    this.past.push(this.current);
    if (this.past.length > this.limit) this.past.shift();
    this.current = entry;
    // A fresh edit is a new branch: whatever had been undone is no longer
    // reachable, same as every other editor.
    this.future = [];
    return true;
  }

  undo() {
    if (!this.canUndo) return null;
    this.future.push(this.current);
    this.current = this.past.pop();
    return this.current;
  }

  redo() {
    if (!this.canRedo) return null;
    this.past.push(this.current);
    this.current = this.future.pop();
    return this.current;
  }
}
