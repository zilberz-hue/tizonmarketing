// Builds the static site for Netlify into dist/ and proxies /api/* to the backend.
// Backend is chosen by env vars set in Netlify:
//   BACKEND_URL           = https://your-own-server.example.com   (self-hosted Node server), or
//   FIREBASE_PROJECT_ID   = my-project   (+ optional FIREBASE_REGION, default europe-west1)
// With neither set, the Netlify Functions backend in netlify/functions/ handles /api/*.
import fs from 'node:fs';

const out = new URL('../dist/', import.meta.url);
fs.rmSync(out, { recursive: true, force: true });
fs.mkdirSync(new URL('app/', out), { recursive: true });
fs.mkdirSync(new URL('assets/', out), { recursive: true });
for (const f of ['index.html', 'style.css', 'script.js', 'app/index.html', 'app/app.css', 'app/app.js', 'app/plan.js', 'app/extras.js', 'app/ai-assist.js', 'app/studio.js', 'app/sw.js', 'app/manifest.webmanifest', 'assets/logo.webp', 'assets/favicon.png', 'assets/icon-192.png', 'assets/icon-512.png'])
  fs.copyFileSync(new URL('../' + f, import.meta.url), new URL(f, out));

let target;
if (process.env.BACKEND_URL) target = process.env.BACKEND_URL.replace(/\/$/, '') + '/api/:splat';
else if (process.env.FIREBASE_PROJECT_ID)
  target = `https://${process.env.FIREBASE_REGION || 'europe-west1'}-${process.env.FIREBASE_PROJECT_ID}.cloudfunctions.net/api/:splat`;
else console.log('No external backend configured: /api/* is served by the built-in Netlify Functions backend (netlify/functions/api.mjs).');

if (target) fs.writeFileSync(new URL('_redirects', out), `/api/*  ${target}  200\n`);
fs.writeFileSync(new URL('_headers', out), '/*\n  X-Content-Type-Options: nosniff\n  X-Frame-Options: DENY\n  Referrer-Policy: same-origin\n/app/sw.js\n  Cache-Control: no-cache\n');
console.log('Built dist/ with /api ->', target || '(no backend)');
