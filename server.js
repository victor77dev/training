// Zero-dependency server: serves ./public and relays messages between devices
// in the same "room" via Server-Sent Events (device <- server) + POST (device -> server).
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

const PORT = Number(process.env.PORT) || 8080;
const PUBLIC = path.join(__dirname, 'public');
const TYPES = {
  '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json', '.svg': 'image/svg+xml',
  '.png': 'image/png', '.webmanifest': 'application/manifest+json',
};

const rooms = new Map(); // room -> Map(clientId -> {res, role})

function broadcast(room, msg, exceptId) {
  const clients = rooms.get(room);
  if (!clients) return;
  const data = `data: ${JSON.stringify(msg)}\n\n`;
  for (const [id, c] of clients) if (id !== exceptId) c.res.write(data);
}

function announcePeers(room) {
  const clients = rooms.get(room);
  if (!clients) return;
  const count = { display: 0, controller: 0 };
  for (const c of clients.values()) count[c.role] = (count[c.role] || 0) + 1;
  broadcast(room, { type: 'peers', ...count });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const room = (url.searchParams.get('room') || '').replace(/\D/g, '').slice(0, 6);
  const id = (url.searchParams.get('id') || '').slice(0, 40);

  if (url.pathname === '/events') {
    const role = url.searchParams.get('role') === 'display' ? 'display' : 'controller';
    if (!room || !id) { res.writeHead(400); return res.end(); }
    res.writeHead(200, {
      'Content-Type': 'text/event-stream', 'Cache-Control': 'no-cache',
      Connection: 'keep-alive', 'X-Accel-Buffering': 'no',
    });
    res.write('retry: 2000\n\n');
    if (!rooms.has(room)) rooms.set(room, new Map());
    rooms.get(room).set(id, { res, role });
    announcePeers(room);
    const ping = setInterval(() => res.write(': ping\n\n'), 15000);
    req.on('close', () => {
      clearInterval(ping);
      const clients = rooms.get(room);
      if (!clients) return;
      if (clients.get(id)?.res === res) clients.delete(id);
      if (clients.size === 0) rooms.delete(room); else announcePeers(room);
    });
    return;
  }

  if (url.pathname === '/send' && req.method === 'POST') {
    let body = '';
    req.on('data', (c) => { body += c; if (body.length > 1e6) req.destroy(); });
    req.on('end', () => {
      try { broadcast(room, JSON.parse(body), id); res.writeHead(204); }
      catch { res.writeHead(400); }
      res.end();
    });
    return;
  }

  // Static files
  let file = path.normalize(path.join(PUBLIC, decodeURIComponent(url.pathname)));
  if (!file.startsWith(PUBLIC)) { res.writeHead(403); return res.end(); }
  if (url.pathname.endsWith('/')) file = path.join(file, 'index.html');
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-cache' });
    res.end(data);
  });
});

server.listen(PORT, '0.0.0.0', () => {
  console.log(`\nReaction Trainer running:\n  Local:   http://localhost:${PORT}`);
  for (const nets of Object.values(os.networkInterfaces()))
    for (const n of nets || [])
      if (n.family === 'IPv4' && !n.internal) console.log(`  Network: http://${n.address}:${PORT}   <- open this on your phones / TV`);
  console.log('');
});
