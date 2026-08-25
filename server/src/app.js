// Node builtins for everything except real-time push, where a raw
// hand-rolled WebSocket server would be a lot of fragile code for no
// benefit — `ws` is the one dependency this server has.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocketServer } from 'ws';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.join(here, '..', '..', 'client');
// NODITRON_DATA_DIR and BLOCK_MODELER_DATA_DIR (its own predecessor) stay
// honoured so an already-deployed instance keeps pointing at its data
// after each rename.
const DATA_DIR =
  process.env.NODIGRAPH_DATA_DIR ||
  process.env.NODITRON_DATA_DIR ||
  process.env.BLOCK_MODELER_DATA_DIR ||
  path.join(here, '..', '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'project.json');
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

// This server has exactly one file and no auth (see the README's own
// "Known limits") — a deliberate, documented convenience for someone
// running it on their OWN machine, never meant to back the public hosted
// product. Without this gate, deploying this same code anywhere shared
// (Cloud Run, a public Docker host, ...) turns that one file — and the
// WebSocket broadcast below — into a single global document every visitor
// silently reads AND writes, with live cursors and drag positions relayed
// between total strangers. The Dockerfile sets this to disable persistence
// by default for exactly that reason; a plain local `node src/app.js` run
// (the README's own instructions, no Docker involved) keeps working
// exactly as documented, since nothing sets it there.
const PERSISTENCE_DISABLED =
  process.env.NODIGRAPH_DISABLE_PERSISTENCE === 'true' || process.env.NODIGRAPH_DISABLE_PERSISTENCE === '1';

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  // Every extension the block-text-as-image feature accepts (see
  // client/src/render/imageCache.js) needs a real image Content-Type here
  // — browsers won't render an <img> (or a `new Image()`) from a response
  // served as application/octet-stream, whatever the URL's extension
  // claims. Without these, self-hosting an image on this same server for
  // that feature would silently fail to load.
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.webp': 'image/webp',
};

function serveStatic(req, res) {
  // Query string stripped *before* the root check — a shared-diagram link
  // (?d=...) lands on '/' with a query string attached, which needs the
  // same index.html this bare root gets, not a 404 from trying to read the
  // client directory itself as a file.
  const pathOnly = req.url.split('?')[0];
  const urlPath = pathOnly === '/' ? '/index.html' : pathOnly;
  const filePath = path.join(CLIENT_DIR, decodeURIComponent(urlPath));

  if (!filePath.startsWith(CLIENT_DIR)) {
    res.writeHead(403);
    res.end('Forbidden');
    return;
  }

  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404);
      res.end('Not found');
      return;
    }
    const ext = path.extname(filePath);
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(data);
  });
}

function handleGetProject(res) {
  if (PERSISTENCE_DISABLED) {
    // Same response shape as "no file yet" below — the client already
    // treats that as "nothing saved here, start fresh" and falls back to
    // its own localStorage, so a disabled server needs no special case on
    // the client side at all.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end('null');
    return;
  }
  fs.readFile(DATA_FILE, 'utf8', (err, data) => {
    // No file yet just means no project has been saved yet — not an error
    // the client needs to know about, it just starts fresh.
    res.writeHead(200, { 'Content-Type': 'application/json' });
    res.end(err ? 'null' : data);
  });
}

function handlePutProject(req, res) {
  let body = '';
  req.on('data', (chunk) => {
    body += chunk;
  });
  req.on('end', () => {
    if (PERSISTENCE_DISABLED) {
      // Accepted but deliberately dropped — nothing reaches disk, nothing
      // reaches another client. The browser's own localStorage (see
      // model/store.js) already holds this edit; that's the only copy
      // this deployment is willing to keep.
      res.writeHead(204);
      res.end();
      return;
    }
    let parsed;
    try {
      parsed = JSON.parse(body);
    } catch {
      res.writeHead(400);
      res.end('Invalid JSON');
      return;
    }
    fs.mkdir(DATA_DIR, { recursive: true }, (mkdirErr) => {
      if (mkdirErr) {
        res.writeHead(500);
        res.end('Could not create data directory');
        return;
      }
      fs.writeFile(DATA_FILE, body, 'utf8', (writeErr) => {
        if (writeErr) {
          res.writeHead(500);
          res.end('Write failed');
          return;
        }
        res.writeHead(204);
        res.end();
        // The PUT and this client's WebSocket are unrelated connections
        // (no client-id handshake ties them together), so this broadcasts
        // to every open socket including the saver's own — harmless, since
        // the client already skips re-applying a snapshot that matches
        // what it just sent (see main.js's lastSyncedSnapshot).
        broadcast({ type: 'project', data: parsed });
      });
    });
  });
}

const server = http.createServer((req, res) => {
  const [urlPath] = req.url.split('?');

  if (urlPath === '/api/project' && req.method === 'GET') {
    handleGetProject(res);
    return;
  }
  if (urlPath === '/api/project' && req.method === 'PUT') {
    handlePutProject(req, res);
    return;
  }
  if (req.method === 'GET') {
    serveStatic(req, res);
    return;
  }

  res.writeHead(404);
  res.end('Not found');
});

// A block being dragged broadcasts its position over this on every move,
// not just on release — that's what makes another open client see it move
// live instead of only once it lands. These are never written to disk;
// only a real PUT (on pointerup) persists anything, same as before.
const wss = new WebSocketServer({ server });

function broadcast(message, exclude) {
  // Disabled alongside the file itself (see PERSISTENCE_DISABLED) — this
  // is what would otherwise relay one visitor's live cursor and drag
  // positions to every *other* stranger also loading the page right now,
  // socket-level collaboration nobody involved asked for or consented to.
  if (PERSISTENCE_DISABLED) return;
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client !== exclude && client.readyState === client.OPEN) client.send(payload);
  }
}

wss.on('connection', (socket) => {
  socket.on('message', (raw) => {
    let message;
    try {
      message = JSON.parse(raw);
    } catch {
      return;
    }
    // Only 'live' (ephemeral, unpersisted drag positions) travels this way
    // from the client — relayed to everyone else as-is, no disk write.
    if (message?.type === 'live') broadcast(message, socket);
  });
});

server.listen(PORT, () => {
  console.log(`nodigraph server running at http://localhost:${PORT}`);
  console.log(
    PERSISTENCE_DISABLED
      ? 'Persistence disabled (NODIGRAPH_DISABLE_PERSISTENCE) — nothing is stored or broadcast server-side.'
      : `Project data stored at ${DATA_FILE}`,
  );
});
