// Bridges the in-memory Project tree to a flat, relational shape (three
// tables: Blocks/Ports/Connections) a Google Doc can hold, and talks
// directly to a Google Apps Script Web App — bound to that Doc — which
// reads/writes those tables and regenerates the Doc's narrative + diagram
// sections. See gravis-sysml/appsscript/Code.gs for the server side of
// this contract, and appsscript/README.md for why Apps Script (no Google
// Cloud project needed) rather than the Docs REST API.
import { generateId } from './Block.js';
import { parseBlockDescription } from './BlockDescription.js';
import { Camera } from '../render/Camera.js';
import { renderScene } from '../render/SceneRenderer.js';

function collectBlocks(block, parentBlockId, out) {
  out.blocks.push({
    id: block.id,
    parentBlockId: parentBlockId || '',
    name: block.name,
    description: block.description || '',
    color: block.style?.color || '',
    geometry_x: block.geometry.x,
    geometry_y: block.geometry.y,
    geometry_width: block.geometry.width,
    geometry_height: block.geometry.height,
    boundary_x: block.boundaryGeometry ? block.boundaryGeometry.x : '',
    boundary_y: block.boundaryGeometry ? block.boundaryGeometry.y : '',
    boundary_width: block.boundaryGeometry ? block.boundaryGeometry.width : '',
    boundary_height: block.boundaryGeometry ? block.boundaryGeometry.height : '',
    createdAt: block.createdAt || '',
    updatedAt: block.updatedAt || '',
  });

  for (const port of block.ports || []) {
    out.ports.push({
      id: port.id,
      blockId: block.id,
      direction: port.direction,
      name: port.name,
      description: port.description || '',
      side: port.side,
      offset: port.offset ?? '',
    });
  }

  if (block.children) {
    for (const connection of block.children.connections.values()) {
      out.connections.push({
        id: connection.id,
        parentBlockId: block.id,
        sourceBlockId: connection.sourceBlockId,
        sourcePortId: connection.sourcePortId,
        targetBlockId: connection.targetBlockId,
        targetPortId: connection.targetPortId,
        manualBend: connection.manualBend ?? '',
      });
    }
    for (const child of block.children.blocks.values()) {
      collectBlocks(child, block.id, out);
    }
  }
}

// Project (in-memory, Map-based tree) -> flat rows for the three Doc tables.
export function flattenProjectToRows(project) {
  const out = { blocks: [], ports: [], connections: [] };
  collectBlocks(project.rootBlock, '', out);
  return out;
}

// The inverse: flat rows -> a single nested root Block, in the same plain
// (array-based children, not yet hydrated into Maps) shape
// `serializeBlockTree`/`hydrateBlockTree` already use — callers pass this
// straight into `project.applyRemoteRootBlock(...)` or `new Project({rootBlock})`.
export function buildRootBlockFromRows({ blocks, ports, connections }) {
  const portsByBlock = new Map();
  for (const row of ports) {
    if (!portsByBlock.has(row.blockId)) portsByBlock.set(row.blockId, []);
    portsByBlock.get(row.blockId).push({
      id: row.id,
      direction: row.direction,
      name: row.name,
      description: row.description || '',
      side: row.side,
      offset: row.offset === '' || row.offset == null ? undefined : Number(row.offset),
      manualOffset: true,
    });
  }

  const connectionsByParent = new Map();
  for (const row of connections) {
    if (!connectionsByParent.has(row.parentBlockId)) connectionsByParent.set(row.parentBlockId, []);
    connectionsByParent.get(row.parentBlockId).push({
      id: row.id,
      sourceBlockId: row.sourceBlockId,
      sourcePortId: row.sourcePortId,
      targetBlockId: row.targetBlockId,
      targetPortId: row.targetPortId,
      manualBend: row.manualBend === '' || row.manualBend == null ? null : Number(row.manualBend),
    });
  }

  const childrenByParent = new Map();
  for (const row of blocks) {
    const key = row.parentBlockId || '';
    if (!childrenByParent.has(key)) childrenByParent.set(key, []);
    childrenByParent.get(key).push(row);
  }

  function buildBlock(row) {
    // A block's own boundary is only ever set when it has children (see
    // Block.js's hydrateBlock), so its presence in the row is the signal —
    // no separate hasChildren column needed.
    const hasChildren = row.boundary_x !== '' && row.boundary_x != null;
    // The DSL text already encodes props (see BlockDescription.js); ports
    // come from the Ports tab instead of a re-parse, since re-parsing would
    // mint fresh ids that wouldn't match what Connections rows reference.
    const props = parseBlockDescription(row.description || '').props.map((prop) => ({ id: generateId('prp'), ...prop }));

    return {
      id: row.id,
      name: row.name,
      type: 'block',
      description: row.description || '',
      geometry: {
        x: Number(row.geometry_x) || 0,
        y: Number(row.geometry_y) || 0,
        width: Number(row.geometry_width) || 0,
        height: Number(row.geometry_height) || 0,
      },
      style: { color: row.color || '#3b6fa0' },
      ports: portsByBlock.get(row.id) || [],
      props,
      hasChildren,
      boundaryGeometry: hasChildren
        ? {
            x: Number(row.boundary_x) || 0,
            y: Number(row.boundary_y) || 0,
            width: Number(row.boundary_width) || 0,
            height: Number(row.boundary_height) || 0,
          }
        : null,
      children: hasChildren
        ? {
            blocks: (childrenByParent.get(row.id) || []).map(buildBlock),
            connections: connectionsByParent.get(row.id) || [],
          }
        : null,
      requirementIds: [],
      createdAt: row.createdAt || new Date().toISOString(),
      updatedAt: row.updatedAt || new Date().toISOString(),
    };
  }

  const rootRow = blocks.find((row) => !row.parentBlockId);
  if (!rootRow) throw new Error('Doc has no root block (a Blocks row with an empty parentBlockId is required)');
  return buildBlock(rootRow);
}

function pathToBlock(rootBlock, targetId) {
  if (rootBlock.id === targetId) return [];
  function search(block, currentPath) {
    if (!block.children) return null;
    for (const child of block.children.blocks.values()) {
      const nextPath = [...currentPath, child.id];
      if (child.id === targetId) return nextPath;
      const found = search(child, nextPath);
      if (found) return found;
    }
    return null;
  }
  return search(rootBlock, []) || [];
}

function computeLevelBounds(project, boundary) {
  let minX = boundary ? boundary.geometry.x : Infinity;
  let minY = boundary ? boundary.geometry.y : Infinity;
  let maxX = boundary ? boundary.geometry.x + boundary.geometry.width : -Infinity;
  let maxY = boundary ? boundary.geometry.y + boundary.geometry.height : -Infinity;
  for (const block of project.listBlocks()) {
    minX = Math.min(minX, block.geometry.x);
    minY = Math.min(minY, block.geometry.y);
    maxX = Math.max(maxX, block.geometry.x + block.geometry.width);
    maxY = Math.max(maxY, block.geometry.y + block.geometry.height);
  }
  if (!Number.isFinite(minX)) return { x: 0, y: 0, width: 1, height: 1 };
  return { x: minX, y: minY, width: Math.max(1, maxX - minX), height: Math.max(1, maxY - minY) };
}

const LEVEL_IMAGE_WIDTH = 1200;
const LEVEL_IMAGE_HEIGHT = 800;
const LEVEL_IMAGE_PADDING = 60;
const LEVEL_IMAGE_MAX_ZOOM = 1.5;

// One PNG per hierarchy level (every block with children), reusing the
// exact renderScene the live canvas uses — "using this tool as renderer."
// Works by briefly pointing the REAL project's `path` at each level in
// turn and restoring it synchronously afterward, so the live view never
// visibly changes and no second Project instance is needed.
export function renderLevelImages(project) {
  const images = [];
  const originalPath = project.path;

  function capture(block) {
    if (!block.children) return;
    project.path = pathToBlock(project.rootBlock, block.id);

    const containerBlock = project.getContainerBlock();
    const boundary = containerBlock?.boundaryGeometry
      ? { block: containerBlock, geometry: containerBlock.boundaryGeometry }
      : null;
    const bounds = computeLevelBounds(project, boundary);
    const zoom = Math.min(
      (LEVEL_IMAGE_WIDTH - LEVEL_IMAGE_PADDING * 2) / bounds.width,
      (LEVEL_IMAGE_HEIGHT - LEVEL_IMAGE_PADDING * 2) / bounds.height,
      LEVEL_IMAGE_MAX_ZOOM,
    );
    const camera = new Camera();
    camera.zoom = zoom;
    camera.offsetX = LEVEL_IMAGE_PADDING - bounds.x * zoom;
    camera.offsetY = LEVEL_IMAGE_PADDING - bounds.y * zoom;

    const canvas = document.createElement('canvas');
    canvas.width = LEVEL_IMAGE_WIDTH;
    canvas.height = LEVEL_IMAGE_HEIGHT;
    renderScene(canvas.getContext('2d'), camera, project, {
      selectedBlockId: null,
      selectedPortId: null,
      dpr: 1,
      canvasWidth: LEVEL_IMAGE_WIDTH,
      canvasHeight: LEVEL_IMAGE_HEIGHT,
      pendingConnectionPath: null,
      connectionSource: null,
      connectionTarget: null,
      wireSelection: null,
    });
    images.push({ blockId: block.id, dataUrl: canvas.toDataURL('image/png') });

    for (const child of block.children.blocks.values()) capture(child);
  }

  capture(project.rootBlock);
  project.path = originalPath;
  return images;
}

export async function loadFromDoc(webAppUrl) {
  const res = await fetch(`${webAppUrl}?action=load&t=${Date.now()}`, { cache: 'no-store' });
  if (!res.ok) throw new Error(`Load failed (${res.status})`);
  return res.json(); // { blocks, ports, connections, revision }
}

export async function saveToDoc(webAppUrl, rows, images, expectedRevision) {
  const res = await fetch(webAppUrl, {
    method: 'POST',
    // A plain-text content type keeps this a CORS "simple request" — Apps
    // Script Web Apps can't answer a preflight OPTIONS request the way a
    // normal server can, so anything that would trigger one just fails.
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify({ action: 'save', ...rows, images, expectedRevision }),
  });
  if (!res.ok) throw new Error(`Save failed (${res.status})`);
  return res.json(); // { ok:true, revision } | { ok:false, conflict:true, current }
}
