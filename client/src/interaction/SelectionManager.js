export class SelectionManager {
  constructor() {
    this.selectedBlockId = null;
    // A port belongs to whichever block is selected, but is tracked
    // separately so the canvas can mark just the port (a small ring) while
    // the Inspector still shows the whole block it lives on.
    this.selectedPortId = null;
    this.listeners = new Set();
  }

  select(blockId) {
    if (this.selectedBlockId === blockId && this.selectedPortId === null) return;
    this.selectedBlockId = blockId;
    this.selectedPortId = null;
    this.notify();
  }

  selectPort(blockId, portId) {
    if (this.selectedBlockId === blockId && this.selectedPortId === portId) return;
    this.selectedBlockId = blockId;
    this.selectedPortId = portId;
    this.notify();
  }

  clear() {
    if (this.selectedBlockId === null && this.selectedPortId === null) return;
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
