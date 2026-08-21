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
// BLOCK_MODELER_DATA_DIR stays honoured so an already-deployed instance
// keeps pointing at its data after the rename.
const DATA_DIR = process.env.NODITRON_DATA_DIR || process.env.BLOCK_MODELER_DATA_DIR || path.join(here, '..', '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'project.json');
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

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
  console.log(`noditron server running at http://localhost:${PORT}`);
  console.log(`Project data stored at ${DATA_FILE}`);
});
