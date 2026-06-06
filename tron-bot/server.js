// GPN-Tron Bot — WebSocket ↔ TCP proxy + static file server
// Usage: npm install && node server.js
// Then open http://localhost:8080

const WebSocket = require('ws');
const net       = require('net');
const http      = require('http');
const fs        = require('fs');
const path      = require('path');

const PORT = process.env.PORT || 8080;

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js':   'application/javascript',
  '.json': 'application/json',
  '.css':  'text/css',
  '.svg':  'image/svg+xml',
  '.png':  'image/png',
};

const httpServer = http.createServer((req, res) => {
  const urlPath = req.url.split('?')[0];
  const file = urlPath === '/' ? 'index.html' : urlPath.replace(/^\//, '');
  const filePath = path.join(__dirname, file);
  fs.readFile(filePath, (err, data) => {
    if (err) { res.writeHead(404); res.end('Not found'); return; }
    res.writeHead(200, { 'Content-Type': MIME[path.extname(filePath)] || 'text/plain' });
    res.end(data);
  });
});

const wss = new WebSocket.Server({ server: httpServer });

wss.on('connection', (ws, req) => {
  const url  = new URL(req.url, 'http://localhost');
  const host = url.searchParams.get('host') || '151.216.211.107';
  const port = parseInt(url.searchParams.get('port') || '4000', 10);

  console.log(`[proxy] Connecting to ${host}:${port}`);
  const tcp = net.createConnection({ host, port });

  tcp.on('connect', () => {
    console.log(`[proxy] Connected to ${host}:${port}`);
    if (ws.readyState === WebSocket.OPEN) ws.send('__connected__\n');
  });

  tcp.on('data', data => {
    if (ws.readyState === WebSocket.OPEN) ws.send(data.toString('utf8'));
  });

  tcp.on('error', err => {
    console.error('[proxy] TCP error:', err.message);
    if (ws.readyState === WebSocket.OPEN) ws.send(`__error__|${err.message}\n`);
    ws.close();
  });

  tcp.on('close', () => {
    console.log('[proxy] TCP closed');
    if (ws.readyState === WebSocket.OPEN) ws.close();
  });

  ws.on('message', msg => {
    if (tcp.writable) tcp.write(msg.toString());
  });

  ws.on('close', () => tcp.destroy());
  ws.on('error', () => tcp.destroy());
});

httpServer.listen(PORT, () => {
  console.log(`GPN-Tron Bot UI → http://localhost:${PORT}`);
});
