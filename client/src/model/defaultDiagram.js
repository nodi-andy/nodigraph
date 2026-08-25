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

  const power = createBlock({ x: GRID_SIZE * 1, y, name: 'Power Supply' });
  const powerOut = addNamedPort(power, 'out', '5V');
  project.addBlock(power);

  const controller = createBlock({ x: power.geometry.x + power.geometry.width + gap, y, name: 'Controller' });
  const controllerIn = addNamedPort(controller, 'in', '5V');
  const controllerOut = addNamedPort(controller, 'out', 'Signal');
  project.addBlock(controller);

  const led = createBlock({ x: controller.geometry.x + controller.geometry.width + gap, y, name: 'LED' });
  const ledIn = addNamedPort(led, 'in', 'Signal');
  project.addBlock(led);

  project.addConnection(
    createConnection({
      sourceBlockId: power.id,
      sourcePortId: powerOut.id,
      targetBlockId: controller.id,
      targetPortId: controllerIn.id,
    }),
  );
  project.addConnection(
    createConnection({
      sourceBlockId: controller.id,
      sourcePortId: controllerOut.id,
      targetBlockId: led.id,
      targetPortId: ledIn.id,
    }),
  );

  return project;
}
