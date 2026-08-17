/**
 * Google Apps Script Web App backing block-modeler's "Update Doc" feature.
 * Paste this into the target Google Doc's own Apps Script editor
 * (Extensions > Apps Script — the script is bound directly to the Doc, so
 * there's no id to configure), then Deploy > New deployment > Web app.
 * See ../appsscript/README.md for the full setup walkthrough and
 * ../client/src/model/docSync.js for the client side of this contract.
 *
 * The Doc is yours — write whatever you want in it. Anywhere you want a
 * block's description + diagram to live, paste a region:
 *
 *   [block-modeler:begin id=<block id>]
 *   Block: EXAMPLE
 *
 *   input.Upper Structure:
 *   input.HMI A/D/CAN:
 *
 *   {diagram}
 *   [block-modeler:end id=<block id>]
 *
 * (the app's Inspector has a "Copy Doc region" button that copies this for
 * whichever block you have selected, with the real id already filled in —
 * you can't type that id by hand). Everything strictly between a matching
 * begin/end pair is replaced on every Update; everything outside every
 * region — all your own writing — is never touched. A block with no region
 * in the Doc is just skipped, not auto-inserted anywhere.
 */

function jsonResponse(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return ContentService.createTextOutput('block-modeler Doc sync endpoint — POST only.').setMimeType(ContentService.MimeType.TEXT);
}

function beginMarkerFor(id) {
  return '[block-modeler:begin id=' + id + ']';
}
function endMarkerFor(id) {
  return '[block-modeler:end id=' + id + ']';
}

function findParagraphIndex(body, text, fromIndex) {
  const n = body.getNumChildren();
  for (let i = fromIndex; i < n; i += 1) {
    const child = body.getChild(i);
    if (child.getType() === DocumentApp.ElementType.PARAGRAPH && child.asParagraph().getText().trim() === text) {
      return i;
    }
  }
  return -1;
}

// Inserts the description text (one paragraph per line) and, if present,
// the diagram image, starting right after `afterIndex` — used for both the
// initial fill of a freshly-pasted region and every subsequent Update.
function insertRegionContent(body, afterIndex, description, imageDataUrl) {
  let index = afterIndex + 1;
  const lines = (description || '').split('\n');
  lines.forEach((line) => {
    body.insertParagraph(index, line).setFontFamily('Courier New');
    index += 1;
  });

  if (imageDataUrl) {
    body.insertParagraph(index, '');
    index += 1;
    const base64 = imageDataUrl.split(',')[1];
    const blob = Utilities.newBlob(Utilities.base64Decode(base64), 'image/png', 'diagram.png');
    const image = body.insertImage(index, blob);
    const maxWidth = 500; // keeps large diagrams from overflowing the page
    if (image.getWidth() > maxWidth) {
      const scale = maxWidth / image.getWidth();
      image.setWidth(maxWidth);
      image.setHeight(Math.round(image.getHeight() * scale));
    }
  }
}

// Replaces one block's region content in place. Returns false (no write)
// if the block has no region in this Doc, or its region is malformed
// (a begin with no matching end) — either way, left untouched rather than
// guessed at.
function updateRegion(body, block) {
  const beginIndex = findParagraphIndex(body, beginMarkerFor(block.id), 0);
  if (beginIndex === -1) return false;

  const endIndex = findParagraphIndex(body, endMarkerFor(block.id), beginIndex + 1);
  if (endIndex === -1) return false;

  for (let i = endIndex - 1; i > beginIndex; i -= 1) {
    body.getChild(i).removeFromParent();
  }

  insertRegionContent(body, beginIndex, block.description, block.imageDataUrl);
  return true;
}

function doPost(e) {
  const message = JSON.parse(e.postData.contents);
  if (message.action !== 'update') {
    return jsonResponse({ error: 'Unknown action' });
  }

  const doc = DocumentApp.getActiveDocument();
  const body = doc.getBody();

  const updated = [];
  const skipped = [];
  (message.blocks || []).forEach((block) => {
    if (updateRegion(body, block)) updated.push(block.id);
    else skipped.push(block.id);
  });

  doc.saveAndClose();
  return jsonResponse({ ok: true, updated: updated, skipped: skipped });
}
