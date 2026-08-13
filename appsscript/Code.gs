/**
 * Google Apps Script Web App backing the gravis-sysml "Save to Sheets"
 * feature. Paste this into the Apps Script editor of the Google Sheet that
 * holds the project (Extensions > Apps Script), fill in DOC_ID below, then
 * Deploy > New deployment > Web app. See ../README.md for the full setup
 * walkthrough and ../client/src/model/sheetsSync.js for the client side of
 * this exact contract.
 *
 * Why Apps Script at all, instead of the Docs/Sheets REST APIs directly:
 * it needs no Google Cloud project, no OAuth client, no service account —
 * just a Sheet you already own and a one-time "allow" click. The Web App
 * URL it hands you is a normal public HTTPS endpoint the app calls with
 * plain fetch().
 */

// The target Doc's file id (from its URL: .../document/d/<THIS PART>/edit).
// The Doc is fully regenerated on every successful Save — it's presentation
// output, never a second source of truth, so there's nothing to preserve.
const DOC_ID = 'PASTE_YOUR_DOC_ID_HERE';

const BLOCKS_SHEET = 'Blocks';
const PORTS_SHEET = 'Ports';
const CONNECTIONS_SHEET = 'Connections';
const META_SHEET = 'Meta';

const BLOCKS_HEADERS = [
  'id', 'parentBlockId', 'name', 'description', 'color',
  'geometry_x', 'geometry_y', 'geometry_width', 'geometry_height',
  'boundary_x', 'boundary_y', 'boundary_width', 'boundary_height',
  'createdAt', 'updatedAt',
];
const PORTS_HEADERS = ['id', 'blockId', 'direction', 'name', 'description', 'side', 'offset'];
const CONNECTIONS_HEADERS = ['id', 'parentBlockId', 'sourceBlockId', 'sourcePortId', 'targetBlockId', 'targetPortId', 'manualBend'];

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function getOrCreateSheet(name, headers) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(headers);
  }
  return sheet;
}

// Rows as plain objects keyed by the header row — lets the rest of this
// script (and the client) work with named fields instead of column indexes.
function readSheetAsObjects(name, headers) {
  const sheet = getOrCreateSheet(name, headers);
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headerRow = values[0];
  return values.slice(1).map((row) => {
    const obj = {};
    headerRow.forEach((header, i) => {
      obj[header] = row[i] === undefined ? '' : row[i];
    });
    return obj;
  });
}

function writeObjectsToSheet(name, headers, rows) {
  const sheet = getOrCreateSheet(name, headers);
  sheet.clearContents();
  sheet.appendRow(headers);
  if (rows.length) {
    const values = rows.map((row) => headers.map((h) => (row[h] === undefined || row[h] === null ? '' : row[h])));
    sheet.getRange(2, 1, values.length, headers.length).setValues(values);
  }
}

function getRevision() {
  const sheet = getOrCreateSheet(META_SHEET, ['revision']);
  const value = sheet.getRange('A2').getValue();
  return typeof value === 'number' ? value : 0;
}

function setRevision(revision) {
  const sheet = getOrCreateSheet(META_SHEET, ['revision']);
  sheet.getRange('A2').setValue(revision);
}

function loadCurrentState() {
  return {
    blocks: readSheetAsObjects(BLOCKS_SHEET, BLOCKS_HEADERS),
    ports: readSheetAsObjects(PORTS_SHEET, PORTS_HEADERS),
    connections: readSheetAsObjects(CONNECTIONS_SHEET, CONNECTIONS_HEADERS),
    revision: getRevision(),
  };
}

function doGet(e) {
  if (e.parameter.action === 'load') {
    return jsonResponse(loadCurrentState());
  }
  return jsonResponse({ error: 'Unknown action' });
}

function doPost(e) {
  const message = JSON.parse(e.postData.contents);
  if (message.action !== 'save') {
    return jsonResponse({ error: 'Unknown action' });
  }

  const currentRevision = getRevision();
  if (message.expectedRevision !== currentRevision) {
    return jsonResponse({ ok: false, conflict: true, current: loadCurrentState() });
  }

  writeObjectsToSheet(BLOCKS_SHEET, BLOCKS_HEADERS, message.blocks);
  writeObjectsToSheet(PORTS_SHEET, PORTS_HEADERS, message.ports);
  writeObjectsToSheet(CONNECTIONS_SHEET, CONNECTIONS_HEADERS, message.connections);

  const newRevision = currentRevision + 1;
  setRevision(newRevision);

  regenerateDoc(message.blocks, message.images || []);

  return jsonResponse({ ok: true, revision: newRevision });
}

// ---- Doc regeneration ----
// Wipes the whole body and rebuilds it top-to-bottom by walking the block
// tree depth-first, root first — one heading + description per block, and
// the level's diagram right after any block that has children. Never
// surgical: the Doc is generated output, so a full rebuild every Save is
// simpler and can't drift from a partial-write bug.

function regenerateDoc(blockRows, images) {
  const doc = DocumentApp.openById(DOC_ID);
  const body = doc.getBody();
  body.clear();

  const imagesByBlockId = {};
  images.forEach((img) => {
    imagesByBlockId[img.blockId] = img.dataUrl;
  });

  const byParent = {};
  blockRows.forEach((row) => {
    const key = row.parentBlockId || '';
    if (!byParent[key]) byParent[key] = [];
    byParent[key].push(row);
  });
  const rootRow = blockRows.filter((row) => !row.parentBlockId)[0];
  if (!rootRow) return;

  function appendBlock(row, depth) {
    const headingLevel = Math.min(depth + 1, 6);
    const heading = body.appendParagraph(row.name);
    heading.setHeading(DocumentApp.ParagraphHeading['HEADING' + headingLevel]);

    if (row.description) {
      body.appendParagraph(row.description).setFontFamily('Courier New');
    }

    const dataUrl = imagesByBlockId[row.id];
    if (dataUrl) {
      const base64 = dataUrl.split(',')[1];
      const blob = Utilities.newBlob(Utilities.base64Decode(base64), 'image/png', row.name + '.png');
      const image = body.appendImage(blob);
      // Keep large diagrams from overflowing the page width.
      const maxWidth = 500;
      if (image.getWidth() > maxWidth) {
        const scale = maxWidth / image.getWidth();
        image.setWidth(maxWidth);
        image.setHeight(Math.round(image.getHeight() * scale));
      }
    }

    (byParent[row.id] || []).forEach((child) => appendBlock(child, depth + 1));
  }

  appendBlock(rootRow, 0);
  doc.saveAndClose();
}
