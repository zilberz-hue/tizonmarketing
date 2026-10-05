import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createApp } from './core.js';
import { sqliteStore } from './sqlite-store.js';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

// --- .env loader (no dependencies) ---
try {
  for (const line of fs.readFileSync(path.join(ROOT, '.env'), 'utf8').split('\n')) {
    const m = line.match(/^\s*([A-Z_]+)\s*=\s*(.*?)\s*$/);
    if (m && !(m[1] in process.env)) process.env[m[1]] = m[2];
  }
} catch {}
const env = k => process.env[k] || '';

const DATA_DIR = path.resolve(env('DATA_DIR') || path.join(ROOT, 'data'));
fs.mkdirSync(DATA_DIR, { recursive: true });
const app = createApp(sqliteStore(path.join(DATA_DIR, 'tizon.db')));

// --- static files (whitelist: only the site itself, never server/ data/ .env) ---
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.webp': 'image/webp', '.png': 'image/png' };
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const ok = /^\/(index\.html|style\.css|script\.js|assets\/(logo\.webp|favicon\.png)|app\/(index\.html|app\.css|app\.js))$/.test(p);
  if (!ok) { res.writeHead(404); return res.end('Not found'); }
  const file = path.join(ROOT, p);
  fs.readFile(file, (err, buf) => {
    if (err) { res.writeHead(404); return res.end('Not found'); }
    res.writeHead(200, { 'content-type': TYPES[path.extname(file)], 'x-content-type-options': 'nosniff', 'x-frame-options': 'DENY' });
    res.end(buf);
  });
}


export const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, 'http://x');
    if (url.pathname.startsWith('/api/')) await app.handle(req, res, url);
    else serveStatic(req, res, url);
  } catch (e) {
    console.error(e);
    if (!res.headersSent) { res.writeHead(500); res.end('error'); }
  }
});

let running = false;
export const tick = async () => {
  if (running) return; running = true;
  try { await app.tick(); } catch (e) { console.error('tick:', e); } finally { running = false; }
};
setInterval(tick, 30e3).unref();
app.ensureAdmin().catch(e => console.error(e));

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = +env('PORT') || 3000;
  server.listen(port, () => console.log(`Tizon Marketing running on http://localhost:${port}`));
}
