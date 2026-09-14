import { generateId } from './Block.js';

// sourcePortId is always the 'out' port and targetPortId always the 'in'
// port, regardless of which one the user grabbed first when drawing the
// wire — that keeps flow-animation direction (output -> input) consistent.
export function createConnection({ sourceBlockId, sourcePortId, targetBlockId, targetPortId }) {
  return {
    id: generateId('conn'),
    sourceBlockId,
    sourcePortId,
    targetBlockId,
    targetPortId,
    // The wire's path is always recomputed live from the current port
    // positions (see ConnectionRenderer.getConnectionGeometry) rather than
    // stored as an absolute point list — that way it stays attached when a
    // block moves. What dragging a wire changes is `route`: the pieces it
    // has been dragged into between its two port stubs (see
    // model/wireRoute.js). Absent until someone drags one, the same way
    // `color` below is absent until someone sets one. Diagrams saved before
    // routes existed may carry `manualBend` instead, a one-piece route.
    // `color` is deliberately absent rather than null: a wire nobody has
    // recolored is drawn in the default, and storing that as data would
    // put a field on every connection in every share link to say nothing.
    // main.js's colorSelection adds and deletes it.
  };
}
