// Deliberately separate from SelectionManager (which is single-select and
// drives the block Inspector): wire trunks support multi-select so several
// paved segments can be dragged together. It does now publish changes
// (see onChange) — the Inspector shows a selected wire's own properties,
// so it needs to know when that selection changes the same way it already
// knows about block selection.
export class WireSelection {
  constructor() {
    this.selected = new Set();
    this.listeners = new Set();
  }

  isSelected(id) {
    return this.selected.has(id);
  }

  selectOnly(id) {
    this.selected = new Set([id]);
    this.notify();
  }

  toggle(id) {
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    this.notify();
  }

  // Mirrors SelectionManager's add/remove: Ctrl always grows the
  // selection, Ctrl+Shift always shrinks it — neither can flip into doing
  // the other's job the way toggle does.
  add(id) {
    this.selected.add(id);
    this.notify();
  }

  remove(id) {
    this.selected.delete(id);
    this.notify();
  }

  clear() {
    if (this.selected.size === 0) return;
    this.selected.clear();
    this.notify();
  }

  list() {
    return Array.from(this.selected);
  }

  notify() {
    this.listeners.forEach((listener) => listener());
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
