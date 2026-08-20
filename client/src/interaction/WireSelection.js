// Deliberately separate from SelectionManager (which is single-select and
// drives the block Inspector): wire trunks support multi-select so several
// paved segments can be dragged together, and nothing outside the canvas
// needs to react to changes here the way the Inspector reacts to block
// selection, so no pub-sub is needed.
export class WireSelection {
  constructor() {
    this.selected = new Set();
  }

  isSelected(id) {
    return this.selected.has(id);
  }

  selectOnly(id) {
    this.selected = new Set([id]);
  }

  toggle(id) {
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
  }

  // Mirrors SelectionManager's add/remove: Ctrl always grows the
  // selection, Ctrl+Shift always shrinks it — neither can flip into doing
  // the other's job the way toggle does.
  add(id) {
    this.selected.add(id);
  }

  remove(id) {
    this.selected.delete(id);
  }

  clear() {
    this.selected.clear();
  }

  list() {
    return Array.from(this.selected);
  }
}
