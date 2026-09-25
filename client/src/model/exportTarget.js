// What "Export <block>" and "Export all" hand to the export dialog (see
// ui/ExportDialog.js): one name, and the project(s) each format is
// rendered from, so the dialog's four rows never have to know whether they
// are exporting the whole diagram or one block of it.
//
// A block exports as a project whose root is that block — exactly the
// inverse of Import, which adds a file's root block as one block of the
// current level. So JSON/YAML of a block, imported back, give the same
// block, contents and all.
import { Project } from './Project.js';
import { serializeBlockTree } from './Block.js';
import { hasSubArchitecture } from '../render/BlockRenderer.js';

/**
 * `blockId` null means the whole diagram. Returns:
 *   name          — what the export is called (file stems, captions)
 *   dataProject   — what JSON/YAML serialize
 *   figureProject — what SVG/PNG draw (its current level)
 *   path          — the tree path a share link should open on
 */
export function exportTargetFor(project, blockId = null) {
  const block = blockId ? project.getBlock(blockId) : null;
  if (!block) {
    // The whole tree, as a file has always been; the figure is the level on
    // screen, since one picture can only ever show one level.
    return { name: project.name, dataProject: project, figureProject: project, path: project.path };
  }

  // A detached copy: hydrating the serialized tree builds fresh Maps, and
  // nothing the exporters do writes back, so the live diagram is untouched.
  const dataProject = new Project({ rootBlock: JSON.parse(JSON.stringify(serializeBlockTree(block))) });

  const isContainer = project.getContainerBlock()?.id === block.id;
  let figureProject = dataProject;
  if (!hasSubArchitecture(block)) {
    // A block with nothing inside it has no level to draw, so the picture
    // is the block itself: a level holding just it, as it looks where it
    // sits. Its interior would be an empty rectangle.
    figureProject = new Project({ name: block.name, blocks: [JSON.parse(JSON.stringify(serializeBlockTree(block)))] });
  }

  const path = isContainer || !hasSubArchitecture(block) ? project.path : [...project.path, block.id];
  return { name: block.name || 'block', dataProject, figureProject, path };
}
