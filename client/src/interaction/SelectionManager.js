// Block selection. Multi-select (shift-drag a marquee, or shift-click)
// coexists with the single "primary" block the Inspector edits: the
// Inspector can only meaningfully show one block's fields, so
// `selectedBlockId` stays the last block picked, while `selectedBlockIds`
// is everything highlighted and moved/copied as a group.
export class SelectionManager {
  constructor() {
    this.selectedBlockIds = new Set();
    this.selectedBlockId = null;
    // A port belongs to whichever block is selected, but is tracked
    // separately so the canvas can mark just the port (a small ring) while
    // the Inspector still shows the whole block it lives on.
    this.selectedPortId = null;
    this.listeners = new Set();
  }

  isSelected(blockId) {
    return this.selectedBlockIds.has(blockId);
  }

  get count() {
    return this.selectedBlockIds.size;
  }

  list() {
    return Array.from(this.selectedBlockIds);
  }

  select(blockId) {
    if (this.selectedBlockId === blockId && this.count === 1 && this.selectedPortId === null) return;
    this.selectedBlockIds = new Set([blockId]);
    this.selectedBlockId = blockId;
    this.selectedPortId = null;
    this.notify();
  }

  // Replaces the whole selection (a finished marquee drag). The primary
  // is the last id, so the Inspector lands on something sensible rather
  // than nothing.
  selectMany(blockIds) {
    this.selectedBlockIds = new Set(blockIds);
    this.selectedBlockId = blockIds.length ? blockIds[blockIds.length - 1] : null;
    this.selectedPortId = null;
    this.notify();
  }

  // Shift-clicking a block adds or removes it without disturbing the rest.
  toggle(blockId) {
    if (this.selectedBlockIds.has(blockId)) this.remove(blockId);
    else this.add(blockId);
  }

  // Ctrl/Cmd-clicking a block: always adds, never removes — unlike toggle,
  // clicking an already-selected block is a no-op rather than dropping it.
  add(blockId) {
    this.selectedBlockIds.add(blockId);
    this.selectedBlockId = blockId;
    this.selectedPortId = null;
    this.notify();
  }

  // Ctrl/Cmd+Shift-clicking a block: always removes, never adds — the
  // counterpart to add(), so the two together read as "grow" and "shrink"
  // rather than one of them also being able to do the other's job.
  remove(blockId) {
    if (!this.selectedBlockIds.has(blockId)) return;
    this.selectedBlockIds.delete(blockId);
    if (this.selectedBlockId === blockId) {
      this.selectedBlockId = this.count ? this.list()[this.count - 1] : null;
    }
    this.selectedPortId = null;
    this.notify();
  }

  // Marquee sweep with Ctrl/Cmd held: the swept ids join the existing
  // selection instead of replacing it.
  addMany(blockIds) {
    for (const id of blockIds) this.selectedBlockIds.add(id);
    if (blockIds.length) this.selectedBlockId = blockIds[blockIds.length - 1];
    this.selectedPortId = null;
    this.notify();
  }

  // Marquee sweep with Ctrl/Cmd+Shift held: the swept ids drop out of the
  // existing selection instead of replacing it.
  removeMany(blockIds) {
    for (const id of blockIds) this.selectedBlockIds.delete(id);
    if (blockIds.includes(this.selectedBlockId)) {
      this.selectedBlockId = this.count ? this.list()[this.count - 1] : null;
    }
    this.selectedPortId = null;
    this.notify();
  }

  selectPort(blockId, portId) {
    if (this.selectedBlockId === blockId && this.selectedPortId === portId) return;
    this.selectedBlockIds = new Set([blockId]);
    this.selectedBlockId = blockId;
    this.selectedPortId = portId;
    this.notify();
  }

  clear() {
    if (this.count === 0 && this.selectedBlockId === null && this.selectedPortId === null) return;
    this.selectedBlockIds = new Set();
    this.selectedBlockId = null;
    this.selectedPortId = null;
    this.notify();
  }

  notify() {
    this.listeners.forEach((listener) => listener(this.selectedBlockId));
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
