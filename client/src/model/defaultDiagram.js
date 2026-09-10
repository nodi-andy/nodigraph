// A tiny worked example — three blocks wired left to right — shown the
// first time anyone opens the app with nothing saved yet, and whenever
// "New" is used (see main.js). A single unlabeled block with no ports (the
// old default) doesn't show what a diagram here even looks like; this
// does, in the couple of seconds before someone starts their own.
import { createBlock } from './Block.js';
import { addPort, logicalPortOf, serializeBlockDescription } from './BlockDescription.js';
import { createConnection } from './Connection.js';
import { Project } from './Project.js';
import { GRID_SIZE } from './grid.js';

// `direction` alone is enough — addPort already defaults an output's side
// to the right and an input's to the left, which is exactly the facing
// this left-to-right layout wants.
function addNamedPort(block, direction, name) {
  const pin = addPort(block, { direction });
  logicalPortOf(block, pin).name = name;
  block.description = serializeBlockDescription(block);
  return pin;
}

export function createDefaultDiagram() {
  const project = new Project({ name: 'Untitled' });
  const y = GRID_SIZE * 3;
  const gap = GRID_SIZE * 3;

  const blockA = createBlock({ x: GRID_SIZE * 1, y, name: 'Block A' });
  const aOut = addNamedPort(blockA, 'out', 'Out');
  project.addBlock(blockA);

  const blockB = createBlock({ x: blockA.geometry.x + blockA.geometry.width + gap, y, name: 'Block B' });
  const bIn = addNamedPort(blockB, 'in', 'In');
  const bOut = addNamedPort(blockB, 'out', 'Out');
  project.addBlock(blockB);

  const blockC = createBlock({ x: blockB.geometry.x + blockB.geometry.width + gap, y, name: 'Block C' });
  const cIn = addNamedPort(blockC, 'in', 'In');
  project.addBlock(blockC);

  project.addConnection(
    createConnection({
      sourceBlockId: blockA.id,
      sourcePortId: aOut.id,
      targetBlockId: blockB.id,
      targetPortId: bIn.id,
    }),
  );
  project.addConnection(
    createConnection({
      sourceBlockId: blockB.id,
      sourcePortId: bOut.id,
      targetBlockId: blockC.id,
      targetPortId: cIn.id,
    }),
  );

  return project;
}
