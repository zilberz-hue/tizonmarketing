// Shared application logic. Storage is injected (sqlite-store.js, memory-store.js, or the
// Firestore store in functions/index.js), so the same code runs on the self-hosted Node
// server and on Firebase Cloud Functions behind Netlify.
import crypto from 'node:crypto';
import { env, loadSettings, saveSettings, describeSettings, getMeta, setMeta, runWith, ctx } from './config.js';
import { computeStats, ruleInsights, insightsPrompt, parseBullets } from './insights.js';

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

const hashPw = (pw, salt = crypto.randomBytes(16).toString('hex')) => salt + ':' + crypto.scryptSync(pw, salt, 32).toString('hex');
function checkPw(pw, stored) {
  const [salt, h] = stored.split(':');
  const a = Buffer.from(h, 'hex'), b = crypto.scryptSync(pw, salt, 32);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}
const sha = s => crypto.createHash('sha256').update(s).digest('hex');

const httpErr = (status, message) => Object.assign(new Error(message), { status });
const send = (res, status, data, extra = {}) => {
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', ...extra });
  res.end(JSON.stringify(data));
};
function readBody(req) {
  if (req.rawBody !== undefined || (req.body && typeof req.body === 'object' && !req.readable)) {
    // already consumed by the Cloud Functions runtime
    if (req.rawBody !== undefined && Buffer.byteLength(req.rawBody) > 100e3) throw httpErr(413, 'גוף הבקשה גדול מדי');
    try { return Promise.resolve(req.rawBody !== undefined ? (req.rawBody.length ? JSON.parse(req.rawBody) : {}) : req.body); }
    catch { throw httpErr(400, 'JSON לא תקין'); }
  }
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > 100e3) { reject(httpErr(413, 'גוף הבקשה גדול מדי')); req.destroy(); } else chunks.push(c); });
    req.on('end', () => { try { resolve(chunks.length ? JSON.parse(Buffer.concat(chunks)) : {}); } catch { reject(httpErr(400, 'JSON לא תקין')); } });
  });
}
// Behind a trusted proxy (Netlify -> Cloud Functions) use the client IP it reports.
function clientIp(req) {
  if (env('TRUST_PROXY') === 'true') {
    const h = req.headers['x-nf-client-connection-ip'] || (req.headers['x-forwarded-for'] || '').split(',')[0].trim();
    if (h) return h;
  }
  return req.socket?.remoteAddress || 'unknown';
}

// --- rate limit (per instance; best-effort on serverless) ---
const hits = new Map();
function limited(key, max, windowMs) {
  const now = Date.now(), arr = (hits.get(key) || []).filter(t => now - t < windowMs);
  arr.push(now); hits.set(key, arr);
  if (hits.size > 5000) for (const [k, v] of hits) if (!v.some(t => now - t < windowMs)) hits.delete(k);
  return arr.length > max;
}

// --- connectors ---
const timeout = () => AbortSignal.timeout(15000);
async function postJson(url, body, headers = {}) {
  const r = await fetch(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body), signal: timeout() });
  if (!r.ok) throw new Error(`${new URL(url).hostname} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json().catch(() => ({}));
}
const tgApi = m => `${env('TELEGRAM_API_URL') || 'https://api.telegram.org'}/bot${env('TG_BOT_TOKEN')}/${m}`;
// Lead notifications contain personal data, so they must never go to a public channel/group:
// use the private notification chat, or TG_CHAT_ID only when it is a private user chat (positive number).
const notifyChat = () => env('TG_NOTIFY_CHAT_ID') || (/^\d+$/.test(env('TG_CHAT_ID')) ? env('TG_CHAT_ID') : '');
const connectors = () => ({
  facebook: !!(env('FB_PAGE_ID') && env('FB_PAGE_TOKEN')),
  telegram: !!(env('TG_BOT_TOKEN') && env('TG_CHAT_ID')),
  tgNotify: !!(env('TG_BOT_TOKEN') && notifyChat()),
  webhook: !!env('PUBLISH_WEBHOOK_URL'),
  email: !!(env('RESEND_API_KEY') && env('EMAIL_FROM'))
});

async function getJson(url) {
  const r = await fetch(url, { signal: timeout() });
  if (!r.ok) throw new Error(`${new URL(url).hostname} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r.json();
}
async function sendEmail(to, subject, text) {
  if (!connectors().email) throw new Error('האימייל לא מוגדר');
  return postJson(env('RESEND_API_URL') || 'https://api.resend.com/emails', { from: env('EMAIL_FROM'), to: [to], subject, text }, { authorization: 'Bearer ' + env('RESEND_API_KEY') });
}
// Israeli-friendly click-to-chat link from a phone number.
function waLink(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.startsWith('0')) d = '972' + d.slice(1);
  return d.length >= 9 && d.length <= 15 ? `https://wa.me/${d}` : '';
}
const oneLine = s => String(s || '').replace(/[\r\n]+/g, ' ').slice(0, 120);

async function onNewLead(lead) {
  const wa = waLink(lead.phone);
  const details = `${lead.name} ${lead.phone} ${lead.email}\n${lead.note || ''}`.trim();
  await notify(`🆕 ליד חדש מהאתר: ${details}${wa ? `\n💬 ${wa}` : ''}`, 'lead.created', { lead });
  if (connectors().email && env('OWNER_EMAIL')) await sendEmail(env('OWNER_EMAIL'), `ליד חדש: ${oneLine(lead.name)}`, `${details}${wa ? `\n\nוואטסאפ: ${wa}` : ''}`).catch(e => console.error('owner email:', e.message));
  if (env('AUTO_REPLY') === 'on' && connectors().email && lead.email) {
    const body = env('AUTO_REPLY_TEXT') || `שלום ${oneLine(lead.name)},\nתודה שפניתם אלינו! קיבלנו את הפרטים ונחזור אליכם בהקדם.`;
    await sendEmail(lead.email, 'קיבלנו את פנייתכם', body).catch(e => console.error('auto reply:', e.message));
  }
}

// "Test connection" buttons in Settings: a harmless real call per integration.
async function testService(name) {
  const c = connectors();
  if (name === 'ai') return `המודל ענה: ${await claude('כתוב את המילה "שלום" בלבד.', 20)}`;
  if (name === 'facebook') {
    if (!c.facebook) throw new Error('חסר Page ID או טוקן');
    const r = await getJson(`https://graph.facebook.com/v19.0/${encodeURIComponent(env('FB_PAGE_ID'))}?fields=name&access_token=${encodeURIComponent(env('FB_PAGE_TOKEN'))}`);
    return `מחובר לדף: ${r.name}`;
  }
  if (name === 'telegram') {
    if (!env('TG_BOT_TOKEN') || !(env('TG_CHAT_ID') || env('TG_NOTIFY_CHAT_ID'))) throw new Error('חסר טוקן או מזהה שיחה');
    const sent = [];
    if (env('TG_CHAT_ID')) { await postJson(tgApi('sendMessage'), { chat_id: env('TG_CHAT_ID'), text: '✅ החיבור לפרסום בטלגרם תקין' }); sent.push('ערוץ הפרסום'); }
    if (c.tgNotify && notifyChat() !== env('TG_CHAT_ID')) { await postJson(tgApi('sendMessage'), { chat_id: notifyChat(), text: '✅ החיבור להתראות פרטיות תקין' }); sent.push('צ׳אט ההתראות'); }
    return `נשלחה הודעת בדיקה אל: ${sent.join(' ו')}`;
  }
  if (name === 'webhook') {
    if (!c.webhook) throw new Error('חסרה כתובת Webhook');
    await postJson(env('PUBLISH_WEBHOOK_URL'), { event: 'test', text: 'חיבור תקין' });
    return 'נשלחה בקשת בדיקה ל-Webhook';
  }
  if (name === 'email') {
    if (!env('OWNER_EMAIL')) throw new Error('הגדירו קודם את האימייל שלכם לקבלת התראות');
    await sendEmail(env('OWNER_EMAIL'), 'בדיקת חיבור', 'החיבור לאימייל תקין ✅');
    return `נשלח מייל בדיקה אל ${env('OWNER_EMAIL')}`;
  }
  throw new Error('שירות לא מוכר');
}
async function publish(post, campaign) {
  const c = connectors(), ch = post.channel;
  if (ch === 'Facebook' && c.facebook) {
    await postJson(`https://graph.facebook.com/v19.0/${encodeURIComponent(env('FB_PAGE_ID'))}/feed`, { message: post.text, access_token: env('FB_PAGE_TOKEN') });
    return 'facebook';
  }
  if (ch === 'Telegram' && c.telegram) {
    await postJson(tgApi('sendMessage'), { chat_id: env('TG_CHAT_ID'), text: post.text });
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
  try { if (c.tgNotify) await postJson(tgApi('sendMessage'), { chat_id: notifyChat(), text }); } catch (e) { console.error('notify telegram:', e.message); }
  try { if (c.webhook) await postJson(env('PUBLISH_WEBHOOK_URL'), { event, text, ...data }); } catch (e) { console.error('notify webhook:', e.message); }
}

// --- AI ---
async function claude(prompt, max = 1500) {
  if (!env('ANTHROPIC_API_KEY')) throw httpErr(400, 'לא הוגדר ANTHROPIC_API_KEY');
  const r = await postJson(env('ANTHROPIC_API_URL') || 'https://api.anthropic.com/v1/messages',
    { model: env('AI_MODEL') || 'claude-sonnet-5-5', max_tokens: max, messages: [{ role: 'user', content: prompt }] },
    { 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' });
  return (r.content || []).map(b => b.text || '').join('').trim();
}
const brief = c => c ? `קמפיין: ${c.name}\nיעד: ${c.goal}\nקהל: ${c.audience}\nמסר: ${c.message}\nערוצים: ${(c.channels || []).join(', ')}` : '';


const CHANNELS = ['Facebook', 'Instagram', 'TikTok', 'LinkedIn', 'Google', 'Email', 'WhatsApp', 'Telegram'];
const GOALS = ['לידים', 'מכירות', 'מודעות למותג', 'תנועה לאתר', 'שימור לקוחות'];
const clamp = (n, lo, hi) => Math.min(Math.max(n, lo), hi);

// Used when no AI key is configured: a sensible 5-step cadence built from the user's own sentence.
function fallbackDraft(idea, channels, days) {
  const steps = [
    t => `${t}\n\nרוצים לשמוע עוד? השאירו פרטים ונחזור אליכם.`,
    t => `שאלה קטנה: מה הכי חשוב לכם בנושא הזה?\n${t}\nכתבו לנו בתגובה או בהודעה.`,
    t => `למה זה מתאים לכם? ${t}\nנשמח להסביר ולהתאים אישית.`,
    t => `שאלות ותשובות: יש לכם שאלה על ${t}? אנחנו כאן לענות.`,
    t => `הזדמנות אחרונה: ${t}\nצרו קשר עוד היום.`
  ];
  const n = Math.min(days, steps.length * 2);
  return {
    name: idea.slice(0, 40), goal: 'לידים', audience: '', message: idea,
    posts: Array.from({ length: n }, (_, i) => ({
      day: Math.floor(i * days / n), channel: channels[i % channels.length], text: steps[i % steps.length](idea)
    }))
  };
}
function cleanDraft(d, channels, days) {
  const ch = c => (CHANNELS.includes(c) ? c : channels[0]);
  return {
    name: String(d.name || '').slice(0, 80) || 'קמפיין חדש',
    goal: GOALS.includes(d.goal) ? d.goal : 'לידים',
    audience: String(d.audience || '').slice(0, 600),
    message: String(d.message || '').slice(0, 400),
    posts: (Array.isArray(d.posts) ? d.posts : []).slice(0, 14).map(p => ({
      day: clamp(Math.round(+p.day || 0), 0, days - 1), channel: ch(p.channel), text: String(p.text || '').slice(0, 1500)
    })).filter(p => p.text.trim())
  };
}

/**
 * store: {
 *   userCount(), getUser(email), listUsers(), addUser(email,name,hash,role) // throws {code:'EXISTS'}
 *   createSession(tokenHash,email,exp), getSession(tokenHash), delSession(tokenHash)
 *   list(kind), get(kind,id), put(kind,id,obj), del(kind,id)
 *   claim(kind,id,fromStatus,toStatus) -> bool   // atomic status change, prevents double publishing
 * }
 */
export function createApp(store) {
  let bootstrapped;
  const ensureAdmin = () => bootstrapped ??= (async () => {
    if (await store.userCount()) return;
    if (env('ADMIN_EMAIL') && env('ADMIN_PASSWORD')) {
      await store.addUser(env('ADMIN_EMAIL').toLowerCase(), 'מנהל', hashPw(env('ADMIN_PASSWORD')), 'admin');
      console.log('Admin user created:', env('ADMIN_EMAIL'));
    } else {
      console.warn('No users yet. Set ADMIN_EMAIL and ADMIN_PASSWORD (and redeploy).');
      bootstrapped = undefined; // retry on the next request instead of caching "no admin"
    }
  })().catch(e => { bootstrapped = undefined; throw e; });

  // ---- workspaces (agency mode): per-client data under kind prefixes; "main" keeps the original, unprefixed kinds ----
  const scoped = ws => {
    if (ws === 'main') return store;
    const k = kind => `${ws}__${kind}`;
    return { ...store, list: kind => store.list(k(kind)), get: (kind, id) => store.get(k(kind), id), put: (kind, id, o) => store.put(k(kind), id, o),
      del: (kind, id) => store.del(k(kind), id), claim: (kind, id, a, b) => store.claim(k(kind), id, a, b) };
  };
  async function listWorkspaces() {
    const rows = await store.list('workspaces');
    const main = rows.find(r => r.id === 'main');
    return [{ id: 'main', name: main?.name || 'ראשי' }, ...rows.filter(r => r.id !== 'main').map(({ id, name }) => ({ id, name }))];
  }
  async function accessFor(user) {
    const all = (await listWorkspaces()).map(w => w.id);
    if (user.role === 'admin') return all;
    const rec = await store.get('access', user.email);
    return (rec?.workspaces?.length ? rec.workspaces : ['main']).filter(id => all.includes(id));
  }

  async function sessionUser(req) {
    const m = /^Bearer ([a-f0-9]{64})$/.exec(req.headers.authorization || '');
    if (!m) return null;
    const s = await store.getSession(sha(m[1]));
    if (!s || s.exp < Date.now()) return null;
    const u = await store.getUser(s.email);
    return u && { email: u.email, name: u.name, role: u.role };
  }

  async function digest(store, now) {
    const c = connectors();
    if (env('WEEKLY_DIGEST') === 'off' || !(c.tgNotify || c.webhook || (c.email && env('OWNER_EMAIL')))) return;
    const last = Date.parse((await getMeta(store)).lastDigest || 0) || 0;
    if (now - last < 7 * 864e5) return;
    const st = await computeStats(store, now);
    if (!st.campaigns.length && !st.leadsTotal) return;
    let lines = ruleInsights(st);
    if (env('ANTHROPIC_API_KEY')) {
      const ai = parseBullets(await claude(insightsPrompt(st, env('BUSINESS_PROFILE')), 800).catch(() => ''));
      if (ai.length) lines = ai;
    }
    const text = '📊 סיכום שבועי\n' + lines.map(l => '• ' + l).join('\n');
    await notify(text, 'digest');
    if (c.email && env('OWNER_EMAIL')) await sendEmail(env('OWNER_EMAIL'), 'סיכום שבועי', text).catch(e => console.error('digest email:', e.message));
    await setMeta(store, { lastDigest: new Date(now).toISOString() });
  }

  async function tick() {
    await ensureAdmin();
    const now = Date.now();
    for (const { id: ws } of await listWorkspaces()) {
      const S = scoped(ws);
      await runWith({ ws, overrides: await loadSettings(S, ws) }, () => tickWorkspace(S, now)).catch(e => console.error('tick', ws, e));
    }
  }

  async function tickWorkspace(store, now) {
    for (const p of await store.list('posts')) {
      if (p.status !== 'מתוזמן' || !p.at || Date.parse(p.at) > now) continue;
      if (!await store.claim('posts', p.id, 'מתוזמן', 'מפרסם')) continue;
      try {
        const via = await publish(p, await store.get('campaigns', p.campaign || ''));
        await store.put('posts', p.id, via
          ? { ...p, status: 'פורסם', via, publishedAt: new Date().toISOString(), error: '' }
          : { ...p, status: 'ידני', error: 'אין חיבור לערוץ – יש לפרסם ידנית' });
        if (!via) await notify(`⏰ פוסט ל-${p.channel} ממתין לפרסום ידני:\n${p.text.slice(0, 200)}`, 'post.manual');
      } catch (e) {
        const attempts = (p.attempts || 0) + 1;
        await store.put('posts', p.id, { ...p, attempts, error: e.message, status: attempts >= 3 ? 'נכשל' : 'מתוזמן', at: attempts >= 3 ? p.at : new Date(now + attempts * 5 * 60e3).toISOString() });
        if (attempts >= 3) await notify(`❌ פרסום ל-${p.channel} נכשל: ${e.message}`, 'post.failed');
      }
    }
    for (const l of await store.list('leads')) {
      if (l.stage === 'חדש' && !l.followedUp && now - Date.parse(l.created) > 2 * 864e5) {
        await store.put('leads', l.id, { ...l, followedUp: 1 });
        await notify(`📞 ליד ממתין יותר מיומיים: ${l.name} ${l.phone} ${l.email}`, 'lead.stale', { lead: l });
      }
    }
    await digest(store, now).catch(e => console.error('digest:', e.message));
  }

  async function api(req, res, url, store, user, ws) {
    const parts = url.pathname.replace(/^\/api(?=\/|$)/, '').split('/').filter(Boolean);
    const method = req.method, ip = clientIp(req);

    if (parts[0] === 'public' && parts[1] === 'lead') {
      const cors = env('ALLOWED_ORIGIN') ? { 'access-control-allow-origin': env('ALLOWED_ORIGIN'), 'access-control-allow-headers': 'content-type' } : {};
      if (method === 'OPTIONS') { res.writeHead(204, cors); return res.end(); }
      if (method !== 'POST') throw httpErr(405, 'Method not allowed');
      if (limited('lead:' + ip, 5, 600e3)) throw httpErr(429, 'יותר מדי בקשות, נסו שוב מאוחר יותר');
      const b = await readBody(req);
      if (b.website) return send(res, 200, { ok: true }, cors); // honeypot
      if (!String(b.name || '').trim() || !(String(b.phone || '').trim() || String(b.email || '').trim())) throw httpErr(400, 'נא למלא שם וטלפון או אימייל');
      const lws = String(b.ws || 'main');
      if (lws !== 'main' && !(await listWorkspaces()).some(w => w.id === lws)) throw httpErr(404, 'לא נמצא');
      const LS = scoped(lws);
      await runWith({ ws: lws, overrides: await loadSettings(LS, lws) }, async () => {
        const cid = String(b.campaign || '').slice(0, 40);
        const attributed = cid && await LS.get('campaigns', cid) ? cid : '';
        const lead = await LS.put('leads', uid(), pick('leads', { name: b.name, phone: b.phone, email: b.email, note: b.message, campaign: attributed }, { created: new Date().toISOString().slice(0, 10), stage: 'חדש', value: 0 }));
        await onNewLead(lead);
      });
      return send(res, 200, { ok: true }, cors);
    }

    if (parts[0] === 'login' && method === 'POST') {
      if (limited('login:' + ip, 10, 600e3)) throw httpErr(429, 'יותר מדי ניסיונות');
      const { email = '', password = '' } = await readBody(req);
      const u = await store.getUser(String(email).toLowerCase());
      if (!u || !checkPw(String(password), u.hash)) throw httpErr(401, 'אימייל או סיסמה שגויים');
      const token = crypto.randomBytes(32).toString('hex');
      await store.createSession(sha(token), u.email, Date.now() + 14 * 864e5);
      return send(res, 200, { token, email: u.email, name: u.name, role: u.role });
    }

    if (!user) throw httpErr(401, 'נדרשת התחברות');
    if (method !== 'GET' && req.headers['x-requested-with'] !== 'tizon') throw httpErr(403, 'Forbidden');

    if (parts[0] === 'logout') {
      await store.delSession(sha(req.headers.authorization.slice(7)));
      return send(res, 200, { ok: true });
    }
    if (parts[0] === 'me') return send(res, 200, user);
    if (parts[0] === 'state') {
      const [[campaigns, posts, leads], checklist] = await Promise.all([
        Promise.all(['campaigns', 'posts', 'leads'].map(k => store.list(k))), store.get('checklist', 'main')]);
      const names = new Map((await listWorkspaces()).map(w => [w.id, w.name]));
      const workspaces = (await accessFor(user)).map(id => ({ id, name: names.get(id) }));
      return send(res, 200, { me: user, ws, workspaces, campaigns, posts, leads, checklist: checklist?.done || {}, caps: { ...connectors(), ai: !!env('ANTHROPIC_API_KEY') } });
    }

    if (parts[0] === 'workspaces') {
      if (user.role !== 'admin') throw httpErr(403, 'למנהלים בלבד');
      if (method === 'GET') return send(res, 200, await listWorkspaces());
      if (method === 'POST') {
        const name = String((await readBody(req)).name || '').trim().slice(0, 80);
        if (!name) throw httpErr(400, 'נא להזין שם');
        const w = await store.put('workspaces', uid(), { name, created: new Date().toISOString() });
        return send(res, 201, { id: w.id, name });
      }
      if (method === 'PUT' && parts[1]) {
        const name = String((await readBody(req)).name || '').trim().slice(0, 80);
        if (!name) throw httpErr(400, 'נא להזין שם');
        await store.put('workspaces', parts[1], { name, created: (await store.get('workspaces', parts[1]))?.created || new Date().toISOString() });
        return send(res, 200, { id: parts[1], name });
      }
    }
    if (parts[0] === 'access') {
      if (user.role !== 'admin') throw httpErr(403, 'למנהלים בלבד');
      if (method === 'GET') {
        const users = await store.listUsers();
        return send(res, 200, await Promise.all(users.map(async u => ({ ...u, workspaces: u.role === 'admin' ? ['*'] : (await store.get('access', u.email))?.workspaces || ['main'] }))));
      }
      if (method === 'PUT') {
        const { email, workspaces } = await readBody(req);
        const known = new Set((await listWorkspaces()).map(w => w.id));
        const list = (Array.isArray(workspaces) ? workspaces : []).filter(id => known.has(id));
        if (!(await store.getUser(String(email || '').toLowerCase()))) throw httpErr(404, 'משתמש לא נמצא');
        await store.put('access', String(email).toLowerCase(), { workspaces: list });
        return send(res, 200, { ok: true });
      }
    }

    if (parts[0] === 'users') {
      if (user.role !== 'admin') throw httpErr(403, 'למנהלים בלבד');
      if (method === 'GET') return send(res, 200, await store.listUsers());
      if (method === 'POST') {
        const { email, name, password, role, workspaces } = await readBody(req);
        if (!/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(email || '') || String(password || '').length < 8) throw httpErr(400, 'אימייל תקין וסיסמה של 8 תווים לפחות');
        try { await store.addUser(email.toLowerCase(), String(name || '').slice(0, 100), hashPw(String(password)), role === 'admin' ? 'admin' : 'member'); }
        catch (e) { throw e.code === 'EXISTS' ? httpErr(409, 'המשתמש כבר קיים') : e; }
        if (role !== 'admin' && Array.isArray(workspaces)) {
          const known = new Set((await listWorkspaces()).map(w => w.id));
          await store.put('access', email.toLowerCase(), { workspaces: workspaces.filter(id => known.has(id)) });
        }
        return send(res, 201, { ok: true });
      }
    }

    if (parts[0] === 'checklist' && method === 'POST') {
      const { key, done } = await readBody(req);
      if (!/^[a-z0-9@:_.-]{1,60}$/i.test(String(key || ''))) throw httpErr(400, 'מפתח לא תקין');
      const d = { ...((await store.get('checklist', 'main'))?.done || {}) };
      if (done) {
        if (Object.keys(d).length >= 500 && !(key in d)) throw httpErr(400, 'יותר מדי פריטים');
        d[key] = new Date().toISOString();
      } else delete d[key];
      await store.put('checklist', 'main', { done: d });
      return send(res, 200, { done: d });
    }

    if (parts[0] === 'settings') {
      if (user.role !== 'admin') throw httpErr(403, 'למנהלים בלבד');
      if (method === 'GET' && !parts[1]) return send(res, 200, { groups: describeSettings(), encrypted: !!process.env.SETTINGS_KEY });
      if (method === 'PUT' && !parts[1]) {
        const b = await readBody(req);
        ctx().overrides = await saveSettings(store, ws, b.values && typeof b.values === 'object' ? b.values : {}, b.clear);
        return send(res, 200, { groups: describeSettings() });
      }
      if (method === 'POST' && parts[1] === 'test') {
        if (limited('test:' + user.email, 20, 3600e3)) throw httpErr(429, 'יותר מדי בדיקות, נסו שוב מאוחר יותר');
        const { service } = await readBody(req);
        if (!['ai', 'facebook', 'telegram', 'webhook', 'email'].includes(service)) throw httpErr(400, 'שירות לא מוכר');
        try { return send(res, 200, { ok: true, detail: await testService(service) }); }
        catch (e) { return send(res, 200, { ok: false, detail: String(e.message).slice(0, 300) }); }
      }
    }

    if (parts[0] === 'insights' && method === 'POST') {
      const { ai } = await readBody(req);
      const st = await computeStats(store);
      if (ai && env('ANTHROPIC_API_KEY')) {
        if (limited('ai:' + user.email, 30, 3600e3)) throw httpErr(429, 'חריגה ממכסת AI לשעה');
        const lines = parseBullets(await claude(insightsPrompt(st, env('BUSINESS_PROFILE')), 900));
        if (lines.length) return send(res, 200, { ai: true, insights: lines });
      }
      return send(res, 200, { ai: false, insights: ruleInsights(st) });
    }

    if (parts[0] === 'ai') {
      if (limited('ai:' + user.email, 30, 3600e3)) throw httpErr(429, 'חריגה ממכסת AI לשעה');
      const b = await readBody(req);
      const c = await store.get('campaigns', String(b.campaign || ''));
      if (parts[1] === 'generate') {
        const text = await claude(`אתה קופירייטר שיווקי בעברית. כתוב פוסט אחד לערוץ ${String(b.channel).slice(0, 30)} בלבד, בלי הקדמות ובלי הסברים.\n${brief(c)}\nהנחיה נוספת: ${String(b.brief || '').slice(0, 500)}`, 700);
        return send(res, 200, { text });
      }
      if (parts[1] === 'quick-campaign') {
        const idea = String(b.idea || '').trim().slice(0, 600);
        if (idea.length < 3) throw httpErr(400, 'ספרו במשפט אחד מה רוצים לקדם');
        const days = clamp(Math.round(+b.days || 7), 1, 30);
        const channels = (Array.isArray(b.channels) ? b.channels : []).filter(x => CHANNELS.includes(x)).slice(0, 6);
        if (!channels.length) channels.push('Facebook');
        if (!env('ANTHROPIC_API_KEY')) return send(res, 200, { ai: false, draft: cleanDraft(fallbackDraft(idea, channels, days), channels, days) });
        const n = Math.min(days, 10);
        const raw = await claude(`אתה אסטרטג שיווק ישראלי. בנה קמפיין שלם בעברית לפי הרעיון.
חוקים: בלי הבטחות רפואיות או טענות ריפוי, בלי "לפני/אחרי", בלי מספרים או עובדות שלא ניתנו, קריאה אחת לפעולה בכל פוסט, טקסט קצר וברור, אימוג'י במידה.
${env('BUSINESS_PROFILE') ? 'על העסק: ' + env('BUSINESS_PROFILE').slice(0, 500) + '\n' : ''}החזר JSON תקין בלבד, בלי הסברים: {"name":"שם קצר","goal":"אחד מ: ${GOALS.join(', ')}","audience":"תיאור קהל היעד","message":"המסר המרכזי בשורה אחת","posts":[{"day":0,"channel":"אחד מ: ${channels.join(', ')}","text":"..."}]}
עד ${n} פוסטים לאורך ${days} ימים (day מ-0 עד ${days - 1}), מפוזרים בין הערוצים.
הרעיון: ${idea}`, 3500);
        let d; try { d = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch { throw httpErr(502, 'ה-AI החזיר תשובה לא תקינה, נסו שוב'); }
        const draft = cleanDraft(d, channels, days);
        if (!draft.posts.length) throw httpErr(502, 'ה-AI לא החזיר פוסטים, נסו שוב');
        return send(res, 200, { ai: true, draft });
      }
      if (parts[1] === 'plan') {
        if (!c) throw httpErr(404, 'קמפיין לא נמצא');
        const days = Math.min(Math.max(+b.days || 7, 1), 30);
        const raw = await claude(`תכנן לוח תוכן שיווקי בעברית ל-${days} ימים עבור הקמפיין. החזר JSON תקין בלבד: מערך של אובייקטים {"day":0..${days - 1},"channel":"אחד מ: ${(c.channels.length ? c.channels : ['Facebook']).join(', ')}","text":"..."}. עד 10 פוסטים.\n${brief(c)}`, 3000);
        let arr; try { arr = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1)); } catch { throw httpErr(502, 'ה-AI החזיר תשובה לא תקינה, נסו שוב'); }
        const base = Date.parse((c.start || new Date().toISOString().slice(0, 10)) + 'T10:00:00');
        const status = env('AUTO_APPROVE') === 'true' ? 'מתוזמן' : 'טיוטה';
        let created = 0;
        for (const x of arr.slice(0, 10)) {
          await store.put('posts', uid(), pick('posts', { campaign: c.id, channel: x.channel, text: x.text, status, at: new Date(base + (+x.day || 0) * 864e5).toISOString() }));
          created++;
        }
        return send(res, 201, { created, status });
      }
    }

    if (SCHEMA[parts[0]]) {
      const kind = parts[0], id = parts[1];
      if (method === 'POST' && !id) {
        const defaults = { campaigns: { status: 'פעיל', spent: 0 }, posts: { status: 'מתוזמן' }, leads: { stage: 'חדש', created: new Date().toISOString().slice(0, 10) } }[kind];
        return send(res, 201, await store.put(kind, uid(), pick(kind, await readBody(req), defaults)));
      }
      if (id && method === 'PUT') {
        const cur = await store.get(kind, id); if (!cur) throw httpErr(404, 'לא נמצא');
        return send(res, 200, await store.put(kind, id, pick(kind, await readBody(req), cur)));
      }
      if (id && method === 'DELETE') { await store.del(kind, id); return send(res, 200, { ok: true }); }
    }
    throw httpErr(404, 'Not found');
  }

  const handle = async (req, res, url) => {
    try {
      await ensureAdmin();
      const user = await sessionUser(req); // null for public and login endpoints
      let ws = 'main';
      if (user) {
        const want = String(req.headers['x-workspace'] || 'main');
        if (!(await accessFor(user)).includes(want)) throw httpErr(403, 'אין גישה לסביבת העבודה');
        ws = want;
      }
      const S = scoped(ws);
      await runWith({ ws, overrides: await loadSettings(S, ws) }, () => api(req, res, url, S, user, ws));
    } catch (e) {
      if (!e.status) console.error(e);
      if (!res.headersSent) send(res, e.status || 500, {
        error: e.status ? e.message : 'שגיאת שרת',
        // Opt-in diagnostics (DEBUG_ERRORS=true) for first-time setup; never enable on a public production site.
        ...(!e.status && env('DEBUG_ERRORS') === 'true' && { detail: `${e.name}: ${String(e.message).slice(0, 300)}` })
      });
    }
  };
  return { handle, tick, ensureAdmin };
}
