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
  };
}
