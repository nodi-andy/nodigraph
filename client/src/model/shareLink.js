// Packs the whole project into a URL query param (?d=...) so a diagram can
// be shared as a link with no server round-trip and no account needed —
// the recipient's browser decodes it straight from the URL. Compression is
// the browser's own native gzip (CompressionStream/DecompressionStream —
// supported in every evergreen browser, no library needed) rather than
// plain base64 of the raw JSON: a good general-purpose starting point: if
// this ever isn't compact enough for a large diagram, the next step would
// be a custom binary encoding of the block tree instead of JSON+gzip, but
// that's real complexity not worth taking on until it's actually needed.

async function gzip(bytes) {
  const stream = new CompressionStream('gzip');
  const writer = stream.writable.getWriter();
  writer.write(bytes);
  writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

async function gunzip(bytes) {
  const stream = new DecompressionStream('gzip');
  const writer = stream.writable.getWriter();
  writer.write(bytes);
  writer.close();
  return new Uint8Array(await new Response(stream.readable).arrayBuffer());
}

function bytesToBase64Url(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function base64UrlToBytes(str) {
  const base64 = str.replace(/-/g, '+').replace(/_/g, '/');
  const pad = (4 - (base64.length % 4)) % 4;
  const binary = atob(base64 + '='.repeat(pad));
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i += 1) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

// `project.toJSON()`'s own shape (see Project.js/Block.js) is already lean
// — no timestamps, no empty children levels — so this doesn't need its own
// separate compact schema on top of it.
export async function encodeProjectToParam(project) {
  const json = JSON.stringify(project.toJSON());
  const compressed = await gzip(new TextEncoder().encode(json));
  return bytesToBase64Url(compressed);
}

// Returns the plain data object Project.fromJSON expects, or throws if the
// param isn't valid (caller decides how to surface that).
export async function decodeProjectFromParam(param) {
  const compressed = base64UrlToBytes(param);
  const bytes = await gunzip(compressed);
  return JSON.parse(new TextDecoder().decode(bytes));
}
