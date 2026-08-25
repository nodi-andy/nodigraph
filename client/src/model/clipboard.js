// Copy/paste for a block selection. Blocks are copied whole — including
// any sub-architecture nested inside them — so pasting a subsystem brings
// its internals along rather than an empty shell.
//
// Every id is regenerated on paste (blocks, their ports, their props, and
// any nested connections). Reusing ids would put two blocks with the same
// port ids into one project, and a connection identifies its endpoint by
// port id alone — so the wires of a pasted copy would attach themselves to
// the original.
import { generateId, hydrateBlockTree, serializeBlockTree } from './Block.js';
import { GRID_SIZE } from './grid.js';

const FORMAT = 'nodigraph/clipboard-v1';

// Offsets a pasted copy so it doesn't land exactly on top of the original.
const PASTE_OFFSET = GRID_SIZE;

export function serializeSelection(project, blockIds) {
  const ids = new Set(blockIds);
  const blocks = project
    .listBlocks()
    .filter((block) => ids.has(block.id))
    .map(serializeBlockTree);
  // Only wires with *both* ends inside the selection: a wire to a block
  // that wasn't copied has nothing to attach to on paste.
  const connections = project
    .listConnections()
    .filter((c) => ids.has(c.sourceBlockId) && ids.has(c.targetBlockId));
  return { format: FORMAT, blocks, connections };
}

export function isClipboardPayload(value) {
  return Boolean(value) && value.format === FORMAT && Array.isArray(value.blocks);
}

// Recursively rebuilds a block with fresh ids, recording the old→new
// mapping so connections (at this level and any nested one) can be
// repointed at the copies.
function cloneWithNewIds(block, blockIdMap, portIdMap) {
  // Logical ports get fresh ids too, same policy as everything else here —
  // scoped to this one block's own `logicalPorts` list, so nothing else
  // needs to know about it except each pin's own `logicalId` reference,
  // remapped alongside.
  const logicalIdMap = new Map();
  const logicalPorts = (block.logicalPorts || []).map((logical) => {
    const newLogical = { ...logical, id: generateId('io') };
    logicalIdMap.set(logical.id, newLogical.id);
    return newLogical;
  });
  const clone = {
    ...block,
    id: generateId('blk'),
    geometry: { ...block.geometry },
    style: { ...block.style },
    boundaryGeometry: block.boundaryGeometry ? { ...block.boundaryGeometry } : null,
    logicalPorts,
    ports: (block.ports || []).map((port) => {
      const newPort = { ...port, id: generateId('prt'), logicalId: logicalIdMap.get(port.logicalId) ?? port.logicalId };
      portIdMap.set(port.id, newPort.id);
      return newPort;
    }),
    props: (block.props || []).map((prop) => ({ ...prop, id: generateId('prp') })),
    children: null,
  };
  blockIdMap.set(block.id, clone.id);

  if (block.children) {
    const blocks = new Map();
    // Children first, so their ids are in the maps before the connections
    // between them are remapped below.
    for (const child of block.children.blocks.values()) {
      const childClone = cloneWithNewIds(child, blockIdMap, portIdMap);
      blocks.set(childClone.id, childClone);
    }
    const connections = new Map();
    for (const connection of block.children.connections.values()) {
      const cloned = remapConnection(connection, blockIdMap, portIdMap);
      connections.set(cloned.id, cloned);
    }
    clone.children = { blocks, connections };
  }
  return clone;
}

function remapConnection(connection, blockIdMap, portIdMap) {
  return {
    ...connection,
    id: generateId('conn'),
    sourceBlockId: blockIdMap.get(connection.sourceBlockId) ?? connection.sourceBlockId,
    sourcePortId: portIdMap.get(connection.sourcePortId) ?? connection.sourcePortId,
    targetBlockId: blockIdMap.get(connection.targetBlockId) ?? connection.targetBlockId,
    targetPortId: portIdMap.get(connection.targetPortId) ?? connection.targetPortId,
  };
}

/**
 * Adds a copy of `payload` to the level the project is currently viewing,
 * offset from the original. Returns the new blocks' ids so the caller can
 * select them — pasting then dragging is the common next move.
 */
export function pasteSelection(project, payload, offset = PASTE_OFFSET) {
  if (!isClipboardPayload(payload)) return [];

  const blockIdMap = new Map();
  const portIdMap = new Map();
  const newIds = [];

  for (const raw of payload.blocks) {
    const clone = cloneWithNewIds(hydrateBlockTree(raw), blockIdMap, portIdMap);
    clone.geometry.x += offset;
    clone.geometry.y += offset;
    project.addBlock(clone);
    newIds.push(clone.id);
  }

  for (const connection of payload.connections || []) {
    project.addConnection(remapConnection(connection, blockIdMap, portIdMap));
  }

  return newIds;
}
