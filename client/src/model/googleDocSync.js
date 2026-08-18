// Pushes block descriptions + diagrams straight into a Google Doc via the
// Docs/Drive REST APIs — no Apps Script, no per-doc setup beyond pasting
// its URL once. Unlike the old anchored-region approach, this only ever
// appends: every "Update Doc" click adds each block's current description
// (and, for a block with children, its diagram) to the end of the doc.
// Nothing already in the doc is read or touched.
import { getAccessToken } from './googleAuth.js';

const DOCS_API = 'https://docs.googleapis.com/v1/documents';
const DRIVE_UPLOAD_API = 'https://www.googleapis.com/upload/drive/v3/files';
const DRIVE_API = 'https://www.googleapis.com/drive/v3/files';

// Accepts a bare doc ID or any of the URL shapes Google Docs uses
// (.../document/d/ID/edit, .../document/d/ID) so pasting the address bar
// URL just works.
export function extractDocId(input) {
  const trimmed = (input || '').trim();
  const match = trimmed.match(/\/document\/d\/([a-zA-Z0-9_-]+)/);
  if (match) return match[1];
  if (/^[a-zA-Z0-9_-]{20,}$/.test(trimmed)) return trimmed;
  return null;
}

async function authedFetch(url, token, options = {}) {
  const res = await fetch(url, {
    ...options,
    headers: { ...options.headers, Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = await res.text().catch(() => '');
    throw new Error(`Google API request failed (${res.status}): ${body.slice(0, 200)}`);
  }
  return res;
}

// The doc's very last index is a trailing paragraph-end mark nothing can
// be inserted past — every write targets one position before it. Re-read
// fresh before each insert rather than tracked locally, so index math
// never has to account for how much a previous insert shifted things.
async function getInsertionIndex(docId, token) {
  const res = await authedFetch(`${DOCS_API}/${docId}?fields=body.content(endIndex)`, token);
  const doc = await res.json();
  const content = doc.body?.content || [];
  const last = content[content.length - 1];
  return Math.max(1, (last?.endIndex ?? 2) - 1);
}

function dataUrlToBlob(dataUrl) {
  const [meta, base64] = dataUrl.split(',');
  const mime = meta.match(/data:(.*);base64/)[1];
  const bytes = atob(base64);
  const array = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i += 1) array[i] = bytes.charCodeAt(i);
  return new Blob([array], { type: mime });
}

async function insertText(docId, token, index, text) {
  await authedFetch(`${DOCS_API}/${docId}:batchUpdate`, token, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ requests: [{ insertText: { location: { index }, text } }] }),
  });
}

// Drive is used purely as a scratch space to get a diagram in front of the
// Docs API, which can only insert an image it can fetch from a URL — the
// uploaded file is made link-readable just long enough for that one fetch,
// then deleted; Docs keeps its own copy of the pixels once inserted, so
// nothing about the doc depends on the Drive file surviving.
async function insertDiagramImage(docId, token, index, dataUrl, name) {
  const metadata = { name, mimeType: 'image/png' };
  const form = new FormData();
  form.append('metadata', new Blob([JSON.stringify(metadata)], { type: 'application/json' }));
  form.append('file', dataUrlToBlob(dataUrl));

  const uploadRes = await authedFetch(`${DRIVE_UPLOAD_API}?uploadType=multipart&fields=id`, token, {
    method: 'POST',
    body: form,
  });
  const { id: fileId } = await uploadRes.json();

  try {
    await authedFetch(`${DRIVE_API}/${fileId}/permissions`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'reader', type: 'anyone' }),
    });

    await authedFetch(`${DOCS_API}/${docId}:batchUpdate`, token, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        requests: [{ insertInlineImage: { location: { index }, uri: `https://drive.google.com/uc?id=${fileId}` } }],
      }),
    });
  } finally {
    // Best-effort: a leftover temp file in the app's own Drive space isn't
    // harmful, so a cleanup failure shouldn't fail the whole update.
    authedFetch(`${DRIVE_API}/${fileId}`, token, { method: 'DELETE' }).catch(() => {});
  }
}

function formatBlockText(block) {
  const heading = block.name || 'Untitled block';
  const body = block.description?.trim() || '(no description)';
  return `${heading}\n${body}\n`;
}

export async function appendBlocksToDoc(docIdOrUrl, blocks) {
  const docId = extractDocId(docIdOrUrl);
  if (!docId) throw new Error('Not a Google Doc URL or ID');
  const token = await getAccessToken();

  for (const block of blocks) {
    const textIndex = await getInsertionIndex(docId, token);
    await insertText(docId, token, textIndex, formatBlockText(block));
    if (block.imageDataUrl) {
      const imageIndex = await getInsertionIndex(docId, token);
      await insertDiagramImage(docId, token, imageIndex, block.imageDataUrl, `${block.id}.png`);
    }
  }
  return { updated: blocks.length };
}
