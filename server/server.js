import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { DatabaseSync } from 'node:sqlite';
import { fileURLToPath } from 'node:url';

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
const db = new DatabaseSync(path.join(DATA_DIR, 'tizon.db'));
db.exec(`
  CREATE TABLE IF NOT EXISTS users(email TEXT PRIMARY KEY, name TEXT, hash TEXT, role TEXT);
  CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, email TEXT, exp INTEGER);
  CREATE TABLE IF NOT EXISTS items(kind TEXT, id TEXT, data TEXT, PRIMARY KEY(kind, id));
`);

// --- storage ---
const SCHEMA = {
  campaigns: { name: 's', goal: 's', audience: 's', channels: 'a', budget: 'n', target: 'n', start: 's', end: 's', message: 's', spent: 'n', status: 's' },
  posts: { campaign: 's', channel: 's', at: 's', text: 's', status: 's', error: 's', publishedAt: 's', via: 's', attempts: 'n' },
  leads: { name: 's', phone: 's', email: 's', campaign: 's', value: 'n', stage: 's', created: 's', note: 's', followedUp: 'n' }
};
const uid = () => crypto.randomBytes(6).toString('hex');
function pick(kind, body, base = {}) {
  const out = { ...base };
  for (const [k, t] of Object.entries(SCHEMA[kind])) {
    if (!(k in body)) continue;
    const v = body[k];
    if (t === 's') out[k] = String(v ?? '').slice(0, 4000);
    else if (t === 'n') out[k] = Number.isFinite(+v) ? +v : 0;
    else out[k] = Array.isArray(v) ? v.map(x => String(x).slice(0, 50)).slice(0, 20) : [];
  }
  return out;
}
const list = kind => db.prepare('SELECT id, data FROM items WHERE kind=?').all(kind).map(r => ({ id: r.id, ...JSON.parse(r.data) }));
const get = (kind, id) => { const r = db.prepare('SELECT data FROM items WHERE kind=? AND id=?').get(kind, id); return r && { id, ...JSON.parse(r.data) }; };
const put = (kind, id, obj) => { const { id: _, ...d } = obj; db.prepare('INSERT OR REPLACE INTO items(kind,id,data) VALUES(?,?,?)').run(kind, id, JSON.stringify(d)); return { id, ...d }; };

// --- auth ---
const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
function checkPw(pw, stored) {
  const [salt, h] = stored.split(':');
  const a = Buffer.from(h, 'hex'), b = crypto.scryptSync(pw, salt, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const sha = s => crypto.createHash('sha256').update(s).digest('hex');
function addUser(email, name, pw, role) {
  db.prepare('INSERT INTO users(email,name,hash,role) VALUES(?,?,?,?)').run(email.toLowerCase(), name, hashPw(pw), role);
}
if (!db.prepare('SELECT 1 FROM users LIMIT 1').get()) {
  if (env('ADMIN_EMAIL') && env('ADMIN_PASSWORD')) { addUser(env('ADMIN_EMAIL'), 'מנהל', env('ADMIN_PASSWORD'), 'admin'); console.log('Admin user created:', env('ADMIN_EMAIL')); }
  else console.warn('No users yet. Set ADMIN_EMAIL and ADMIN_PASSWORD in .env and restart.');
}
function sessionUser(req) {
  const m = /(?:^|;\s*)sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
  if (!m) return null;
  const s = db.prepare('SELECT email, exp FROM sessions WHERE token=?').get(sha(m[1]));
  if (!s || s.exp < Date.now()) return null;
  return db.prepare('SELECT email, name, role FROM users WHERE email=?').get(s.email) || null;
}

// --- rate limit ---
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now(), arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now); hits.set(key, arr);
  return arr.length > max;
}
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some(t => now - t < 3600e3)) hits.delete(k); }, 600e3).unref();

// --- connectors ---
const timeout = () => AbortSignal.timeout(15000);
async function postJson(url, body, headers = {}) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: timeout() });
  if (!r.ok) throw new Error(`${new URL(url).hostname} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json().catch(() => ({}));
}
const connectors = () => ({
  facebook: !!(env('FB_PAGE_ID') && env('FB_PAGE_TOKEN')),
  telegram: !!(env('TG_BOT_TOKEN') && env('TG_CHAT_ID')),
  webhook: !!env('PUBLISH_WEBHOOK_URL')
});
async function publish(post, campaign) {
  const c = connectors(), ch = post.channel;
  if (ch === 'Facebook' && c.facebook) {
    await postJson(`https://graph.facebook.com/v19.0/${encodeURIComponent(env('FB_PAGE_ID'))}/feed`, { message: post.text, access_token: env('FB_PAGE_TOKEN') });
    return 'facebook';
  }
  if (ch === 'Telegram' && c.telegram) {
    await postJson(`https://api.telegram.org/bot${env('TG_BOT_TOKEN')}/sendMessage`, { chat_id: env('TG_CHAT_ID'), text: post.text });
    return 'telegram';
  }
  if (c.webhook) {
    await postJson(env('PUBLISH_WEBHOOK_URL'), { event: 'post.publish', channel: ch, text: post.text, campaign: campaign?.name || '', at: post.at });
    return 'webhook';
  }
  return null;
}
async function notify(text, event = 'notify', data = {}) {
  const c = connectors();
  try { if (c.telegram) await postJson(`https://api.telegram.org/bot${env('TG_BOT_TOKEN')}/sendMessage`, { chat_id: env('TG_CHAT_ID'), text }); } catch (e) { console.error('notify telegram:', e.message); }
  try { if (c.webhook) await postJson(env('PUBLISH_WEBHOOK_URL'), { event, text, ...data }); } catch (e) { console.error('notify webhook:', e.message); }
}

// --- scheduler ---
let ticking = false;
async function tick() {
  if (ticking) return; ticking = true;
  try {
    const now = Date.now();
    for (const p of list('posts')) {
      if (p.status !== 'מתוזמן' || !p.at || Date.parse(p.at) > now) continue;
      put('posts', p.id, { ...p, status: 'מפרסם' });
      try {
        const via = await publish(p, get('campaigns', p.campaign));
        put('posts', p.id, via
          ? { ...p, status: 'פורסם', via, publishedAt: new Date().toISOString(), error: '' }
          : { ...p, status: 'ידני', error: 'אין חיבור לערוץ – יש לפרסם ידנית' });
        if (!via) notify(`⏰ פוסט ל-${p.channel} ממתין לפרסום ידני:\n${p.text.slice(0, 200)}`, 'post.manual');
      } catch (e) {
        const attempts = (p.attempts || 0) + 1;
        put('posts', p.id, { ...p, attempts, error: e.message, status: attempts >= 3 ? 'נכשל' : 'מתוזמן', at: attempts >= 3 ? p.at : new Date(now + attempts * 5 * 60e3).toISOString() });
        if (attempts >= 3) notify(`❌ פרסום ל-${p.channel} נכשל: ${e.message}`, 'post.failed');
      }
    }
    for (const l of list('leads')) {
      if (l.stage === 'חדש' && !l.followedUp && now - Date.parse(l.created) > 2 * 864e5) {
        put('leads', l.id, { ...l, followedUp: 1 });
        notify(`📞 ליד ממתין יותר מיומיים: ${l.name} ${l.phone} ${l.email}`, 'lead.stale', { lead: l });
      }
    }
  } catch (e) { console.error('tick:', e); } finally { ticking = false; }
}
setInterval(tick, 30e3).unref();

// --- AI ---
async function claude(prompt, max = 1500) {
  if (!env('ANTHROPIC_API_KEY')) throw httpErr(400, 'לא הוגדר ANTHROPIC_API_KEY');
  const r = await postJson('https://api.anthropic.com/v1/messages',
    { model: env('AI_MODEL') || 'claude-sonnet-5-5', max_tokens: max, messages: [{ role: 'user', content: prompt }] },
    { 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' });
  return (r.content || []).map(b => b.text || '').join('').trim();
}
const brief = c => c ? `קמפיין: ${c.name}\nיעד: ${c.goal}\nקהל: ${c.audience}\nמסר: ${c.message}\nערוצים: ${(c.channels || []).join(', ')}` : '';

// --- http helpers ---
const httpErr = (status, message) => Object.assign(new Error(message), { status });
const send = (res, status, data, extra = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', ...extra });
  res.end(JSON.stringify(data));
};
function readBody(req) {
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > 100e3) { reject(httpErr(413, 'גוף הבקשה גדול מדי')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}); } catch { reject(httpErr(400, 'JSON לא תקין')); } });
  });
}
const ip = req => req.socket.remoteAddress;

// --- API ---
async function api(req, res, url) {
  const parts = url.pathname.split('/').filter(Boolean).slice(1); // after "api"
  const method = req.method;

  if (parts[0] === 'public' && parts[1] === 'lead') {
    const cors = env('ALLOWED_ORIGIN') ? { 'access-control-allow-origin': env('ALLOWED_ORIGIN'), 'access-control-allow-headers': 'content-type' } : {};
    if (method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
    if (method !== 'POST') throw httpErr(405, 'Method not allowed');
    if (limited('lead:' + ip(req), 5, 600e3)) throw httpErr(429, 'יותר מדי בקשות, נסו שוב מאוחר יותר');
    const b = await readBody(req);
    if (b.website) return send(res, 200, { ok: true }, cors); // honeypot
    if (!String(b.name || '').trim() || !(String(b.phone || '').trim() || String(b.email || '').trim())) throw httpErr(400, 'נא למלא שם וטלפון או אימייל');
    const lead = put('leads', uid(), pick('leads', { ...b, note: b.message, stage: 'חדש', value: 0, campaign: '' }, { created: new Date().toISOString().slice(0, 10), stage: 'חדש' }));
    notify(`🆕 ליד חדש מהאתר: ${lead.name} ${lead.phone} ${lead.email}\n${lead.note || ''}`, 'lead.created', { lead });
    return send(res, 200, { ok: true }, cors);
  }

  if (parts[0] === 'login' && method === 'POST') {
    if (limited('login:' + ip(req), 10, 600e3)) throw httpErr(429, 'יותר מדי ניסיונות');
    const { email = '', password = '' } = await readBody(req);
    const u = db.prepare('SELECT * FROM users WHERE email=?').get(String(email).toLowerCase());
    if (!u || !checkPw(String(password), u.hash)) throw httpErr(401, 'אימייל או סיסמה שגויים');
    const token = crypto.randomBytes(32).toString('hex');
    db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(sha(token), u.email, Date.now() + 14 * 864e5);
    return send(res, 200, { email: u.email, name: u.name, role: u.role },
      { 'set-cookie': `sid=${token}; HttpOnly; SameSite=Lax; Path=/; Max-Age=${14 * 86400}${req.headers['x-forwarded-proto'] === 'https' ? '; Secure' : ''}` });
  }

  const user = sessionUser(req);
  if (!user) throw httpErr(401, 'נדרשת התחברות');
  if (method !== 'GET' && req.headers['x-requested-with'] !== 'tizon') throw httpErr(403, 'Forbidden');

  if (parts[0] === 'logout') {
    const m = /sid=([a-f0-9]{64})/.exec(req.headers.cookie || '');
    if (m) db.prepare('DELETE FROM sessions WHERE token=?').run(sha(m[1]));
    return send(res, 200, { ok: true }, { 'set-cookie': 'sid=; HttpOnly; Path=/; Max-Age=0' });
  }
  if (parts[0] === 'me') return send(res, 200, user);
  if (parts[0] === 'state') {
    return send(res, 200, { me: user, campaigns: list('campaigns'), posts: list('posts'), leads: list('leads'),
      caps: { ...connectors(), ai: !!env('ANTHROPIC_API_KEY') } });
  }

  if (parts[0] === 'users') {
    if (user.role !== 'admin') throw httpErr(403, 'למנהלים בלבד');
    if (method === 'GET') return send(res, 200, db.prepare('SELECT email,name,role FROM users').all());
    if (method === 'POST') {
      const { email, name, password, role } = await readBody(req);
      if (!/^\S+@\S+\.\S+$/.test(email || '') || String(password || '').length < 8) throw httpErr(400, 'אימייל תקין וסיסמה של 8 תווים לפחות');
      try { addUser(email, String(name || '').slice(0, 100), String(password), role === 'admin' ? 'admin' : 'member'); }
      catch { throw httpErr(409, 'המשתמש כבר קיים'); }
      return send(res, 201, { ok: true });
    }
  }

  if (parts[0] === 'ai') {
    if (limited('ai:' + user.email, 30, 3600e3)) throw httpErr(429, 'חריגה ממכסת AI לשעה');
    const b = await readBody(req);
    const c = get('campaigns', b.campaign);
    if (parts[1] === 'generate') {
      const text = await claude(`אתה קופירייטר שיווקי בעברית. כתוב פוסט אחד לערוץ ${String(b.channel).slice(0, 30)} בלבד, בלי הקדמות ובלי הסברים.\n${brief(c)}\nהנחיה נוספת: ${String(b.brief || '').slice(0, 500)}`, 700);
      return send(res, 200, { text });
    }
    if (parts[1] === 'plan') {
      if (!c) throw httpErr(404, 'קמפיין לא נמצא');
      const days = Math.min(Math.max(+b.days || 7, 1), 30);
      const raw = await claude(`תכנן לוח תוכן שיווקי בעברית ל-${days} ימים עבור הקמפיין. החזר JSON תקין בלבד: מערך של אובייקטים {"day":0..${days - 1},"channel":"אחד מ: ${(c.channels.length ? c.channels : ['Facebook']).join(', ')}","text":"..."}. עד 10 פוסטים.\n${brief(c)}`, 3000);
      let arr; try { arr = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1)); } catch { throw httpErr(502, 'ה-AI החזיר תשובה לא תקינה, נסו שוב'); }
      const base = Date.parse((c.start || new Date().toISOString().slice(0, 10)) + 'T10:00:00');
      const status = env('AUTO_APPROVE') === 'true' ? 'מתוזמן' : 'טיוטה';
      const made = arr.slice(0, 10).map(x => put('posts', uid(), pick('posts', { campaign: c.id, channel: x.channel, text: x.text, status, at: new Date(base + (+x.day || 0) * 864e5).toISOString() })));
      return send(res, 201, { created: made.length, status });
    }
  }

  if (SCHEMA[parts[0]]) {
    const kind = parts[0], id = parts[1];
    if (method === 'POST' && !id) {
      const b = await readBody(req);
      const defaults = { campaigns: { status: 'פעיל', spent: 0 }, posts: { status: 'מתוזמן' }, leads: { stage: 'חדש', created: new Date().toISOString().slice(0, 10) } }[kind];
      return send(res, 201, put(kind, uid(), pick(kind, b, defaults)));
    }
    if (id && method === 'PUT') {
      const cur = get(kind, id); if (!cur) throw httpErr(404, 'לא נמצא');
      return send(res, 200, put(kind, id, pick(kind, await readBody(req), cur)));
    }
    if (id && method === 'DELETE') { db.prepare('DELETE FROM items WHERE kind=? AND id=?').run(kind, id); return send(res, 200, { ok: true }); }
  }
  throw httpErr(404, 'Not found');
}

// --- static files (whitelist: only the site itself, never server/ data/ .env) ---
const TYPES = { '.html': 'text/html; charset=utf-8', '.css': 'text/css; charset=utf-8', '.js': 'text/javascript; charset=utf-8' };
function serveStatic(req, res, url) {
  let p = decodeURIComponent(url.pathname);
  if (p.endsWith('/')) p += 'index.html';
  const ok = /^\/(index\.html|style\.css|script\.js|app\/(index\.html|app\.css|app\.js))$/.test(p);
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
    if (url.pathname.startsWith('/api/')) await api(req, res, url);
    else serveStatic(req, res, url);
  } catch (e) {
    if (!e.status) console.error(e);
    if (!res.headersSent) send(res, e.status || 500, { error: e.status ? e.message : 'שגיאת שרת' });
  }
});
export { tick };
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const port = +env('PORT') || 3000;
  server.listen(port, () => console.log(`Tizon Marketing running on http://localhost:${port}`));
}
