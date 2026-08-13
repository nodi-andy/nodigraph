// Deliberately dependency-free (Node builtins only), matching the same
// spirit as client/dev-server.js — this just replaces that file, now also
// persisting the project to a real file on disk instead of localStorage.
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const CLIENT_DIR = path.join(here, '..', '..', 'client');
const DATA_DIR = process.env.GRAVIS_DATA_DIR || path.join(here, '..', '..', 'data');
const DATA_FILE = path.join(DATA_DIR, 'project.json');
const PORT = process.env.PORT ? Number(process.env.PORT) : 8080;

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
};

function serveStatic(req, res) {
  const urlPath = req.url === '/' ? '/index.html' : req.url.split('?')[0];
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
    try {
      JSON.parse(body);
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

server.listen(PORT, () => {
  console.log(`gravis-sysml server running at http://localhost:${PORT}`);
  console.log(`Project data stored at ${DATA_FILE}`);
});
