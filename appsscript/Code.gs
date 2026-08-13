/**
 * Google Apps Script Web App backing gravis-sysml's "Save" feature. Paste
 * this into the target Google Doc's own Apps Script editor (Extensions >
 * Apps Script — the script is bound directly to the Doc, so there's no id
 * to configure), then Deploy > New deployment > Web app. See
 * ../appsscript/README.md for the full setup walkthrough and
 * ../client/src/model/docSync.js for the client side of this contract.
 *
 * Why Apps Script at all, instead of the Docs REST API directly: it needs
 * no Google Cloud project, no OAuth client, no service account — just a
 * Doc you already own and a one-time "allow" click. The Web App URL it
 * hands you is a normal public HTTPS endpoint the app calls with fetch().
 *
 * The Doc holds two things, regenerated together on every Save:
 *  - a human-readable section per block (heading, description, diagram)
 *  - a "Raw Data" appendix of three tables (Blocks/Ports/Connections) that
 *    this script itself reads back on Load — the Doc IS the database, not
 *    just a report generated from one.
 */

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

// The revision lives in the Doc's own properties, not its body — so
// clearing and rebuilding the body on every Save never touches it.
function getRevision() {
  const value = PropertiesService.getDocumentProperties().getProperty('revision');
  return value ? parseInt(value, 10) : 0;
}

function setRevision(revision) {
  PropertiesService.getDocumentProperties().setProperty('revision', String(revision));
}

// Reads one data table back into row objects keyed by its header row.
// Docs table cells are always plain text; callers (client-side) are
// already responsible for coercing numeric fields back from strings.
function tableToObjects(table, headers) {
  const rows = [];
  for (let r = 1; r < table.getNumRows(); r += 1) {
    const row = table.getRow(r);
    const obj = {};
    headers.forEach((header, c) => {
      obj[header] = row.getCell(c).getText();
    });
    rows.push(obj);
  }
  return rows;
}

function objectsToTableArray(headers, rows) {
  const data = [headers];
  rows.forEach((row) => {
    data.push(headers.map((h) => (row[h] === undefined || row[h] === null ? '' : String(row[h]))));
  });
  return data;
}

// The three data tables always exist in this fixed order (see
// regenerateDoc) — a brand-new Doc that's never been saved to just has no
// tables yet, which reads back as empty rows and revision 0.
function loadCurrentState() {
  const tables = DocumentApp.getActiveDocument().getBody().getTables();
  return {
    blocks: tables[0] ? tableToObjects(tables[0], BLOCKS_HEADERS) : [],
    ports: tables[1] ? tableToObjects(tables[1], PORTS_HEADERS) : [],
    connections: tables[2] ? tableToObjects(tables[2], CONNECTIONS_HEADERS) : [],
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

  regenerateDoc(message.blocks, message.ports, message.connections, message.images || []);
  const newRevision = currentRevision + 1;
  setRevision(newRevision);

  return jsonResponse({ ok: true, revision: newRevision });
}

// Wipes the whole body and rebuilds it: narrative first (walking the block
// tree depth-first, root first — heading, diagram, description per block),
// then the raw data tables as an appendix. Never surgical — simpler, and
// can't drift from a partial-write bug, since nothing here is meant to
// survive hand-editing anyway (the tables are read back on Load, but only
// ever written by this function).
function regenerateDoc(blockRows, portRows, connectionRows, images) {
  const doc = DocumentApp.getActiveDocument();
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

  function appendBlock(row, depth) {
    const headingLevel = Math.min(depth + 1, 6);
    const heading = body.appendParagraph(row.name);
    heading.setHeading(DocumentApp.ParagraphHeading['HEADING' + headingLevel]);

    const dataUrl = imagesByBlockId[row.id];
    if (dataUrl) {
      const base64 = dataUrl.split(',')[1];
      const blob = Utilities.newBlob(Utilities.base64Decode(base64), 'image/png', row.name + '.png');
      const image = body.appendImage(blob);
      const maxWidth = 500; // keeps large diagrams from overflowing the page
      if (image.getWidth() > maxWidth) {
        const scale = maxWidth / image.getWidth();
        image.setWidth(maxWidth);
        image.setHeight(Math.round(image.getHeight() * scale));
      }
    }

    if (row.description) {
      body.appendParagraph(row.description).setFontFamily('Courier New');
    }

    (byParent[row.id] || []).forEach((child) => appendBlock(child, depth + 1));
  }

  if (rootRow) appendBlock(rootRow, 0);

  body.appendPageBreak();
  body.appendParagraph('Raw Data').setHeading(DocumentApp.ParagraphHeading.HEADING2);
  body.appendParagraph('Regenerated on every Save — editing these tables directly has no effect until the next Save overwrites them.');

  body.appendParagraph('Blocks').setHeading(DocumentApp.ParagraphHeading.HEADING3);
  body.appendTable(objectsToTableArray(BLOCKS_HEADERS, blockRows));
  body.appendParagraph('Ports').setHeading(DocumentApp.ParagraphHeading.HEADING3);
  body.appendTable(objectsToTableArray(PORTS_HEADERS, portRows));
  body.appendParagraph('Connections').setHeading(DocumentApp.ParagraphHeading.HEADING3);
  body.appendTable(objectsToTableArray(CONNECTIONS_HEADERS, connectionRows));

  doc.saveAndClose();
}
