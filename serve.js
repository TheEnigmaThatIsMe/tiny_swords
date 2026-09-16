'use strict';

const http = require('http');
const fs = require('fs');
const path = require('path');

const ROOT = __dirname;
const PORT = parseInt(process.env.PORT, 10) || 8080;
const HOST = process.env.HOST || '127.0.0.1';

const MIME_TYPES = {
  '.html': 'text/html',
  '.htm': 'text/html',
  '.js': 'text/javascript',
  '.mjs': 'text/javascript',
  '.css': 'text/css',
  '.json': 'application/json',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.gif': 'image/gif',
  '.svg': 'image/svg+xml',
  '.ico': 'image/x-icon',
  '.txt': 'text/plain',
  '.md': 'text/markdown',
  '.wasm': 'application/wasm',
  '.webmanifest': 'application/manifest+json',
};

function mimeFor(filePath) {
  const ext = path.extname(filePath).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

function send(res, status, body, headers) {
  if (res.headersSent) {
    res.destroy();
    return;
  }
  const finalHeaders = Object.assign({ 'Content-Type': 'text/plain' }, headers || {});
  res.writeHead(status, finalHeaders);
  if (res.req && res.req.method === 'HEAD') {
    res.end();
  } else {
    res.end(body);
  }
}

function respondWithFile(req, res, filePath, stats) {
  const headers = {
    'Content-Type': mimeFor(filePath),
    'Content-Length': stats.size,
    'Cache-Control': 'no-cache',
  };

  if (req.method === 'HEAD') {
    res.writeHead(200, headers);
    res.end();
    return;
  }

  const stream = fs.createReadStream(filePath);

  stream.on('error', () => {
    if (!res.headersSent) {
      send(res, 500, 'Internal Server Error');
    } else {
      res.destroy();
    }
  });

  stream.on('open', () => {
    res.writeHead(200, headers);
  });

  stream.pipe(res);
}

function handleFilePath(req, res, filePath) {
  fs.stat(filePath, (err, stats) => {
    if (err) {
      send(res, 404, 'Not Found');
      return;
    }

    if (stats.isDirectory()) {
      const indexPath = path.join(filePath, 'index.html');
      fs.stat(indexPath, (indexErr, indexStats) => {
        if (indexErr || !indexStats.isFile()) {
          send(res, 404, 'Not Found');
          return;
        }
        respondWithFile(req, res, indexPath, indexStats);
      });
      return;
    }

    respondWithFile(req, res, filePath, stats);
  });
}

const server = http.createServer((req, res) => {
  try {
    if (req.method !== 'GET' && req.method !== 'HEAD') {
      send(res, 405, 'Method Not Allowed', { Allow: 'GET, HEAD' });
      return;
    }

    const rawUrl = req.url || '/';
    const queryIndex = rawUrl.indexOf('?');
    const rawPath = queryIndex === -1 ? rawUrl : rawUrl.slice(0, queryIndex);

    let decodedPath;
    try {
      decodedPath = decodeURIComponent(rawPath);
    } catch (err) {
      send(res, 400, 'Bad Request');
      return;
    }

    // Resolve against root using real filesystem-style dot-segment math
    // (deliberately NOT using the WHATWG URL parser here, since it clamps
    // ".." at the root and silently rewrites escape attempts instead of
    // exposing them for the check below).
    const filePath = path.resolve(ROOT, '.' + decodedPath);

    if (filePath !== ROOT && !filePath.startsWith(ROOT + path.sep)) {
      send(res, 403, 'Forbidden');
      return;
    }

    handleFilePath(req, res, filePath);
  } catch (err) {
    send(res, 400, 'Bad Request');
  }
});

server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.error(`Port ${PORT} is already in use. Try: PORT=8081 npm run dev`);
    process.exit(1);
  }
  throw err;
});

server.listen(PORT, HOST, () => {
  console.log(`Tiny Swords dev server -> http://${HOST}:${PORT}/`);
  console.log('Press Ctrl+C to stop.');
});

function shutdown() {
  server.close(() => {
    process.exit(0);
  });
  if (typeof server.closeAllConnections === 'function') {
    server.closeAllConnections();
  }
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
