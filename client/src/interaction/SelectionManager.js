export class SelectionManager {
  constructor() {
    this.selectedBlockId = null;
    this.listeners = new Set();
  }

  select(blockId) {
    if (this.selectedBlockId === blockId) return;
    this.selectedBlockId = blockId;
    this.listeners.forEach((listener) => listener(blockId));
  }

  clear() {
    this.select(null);
  }

  onChange(listener) {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
}
