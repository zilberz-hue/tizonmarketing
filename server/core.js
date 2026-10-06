// Shared application logic. Storage is injected (sqlite-store.js, memory-store.js, or the
// Firestore store in functions/index.js), so the same code runs on the self-hosted Node
// server and on Firebase Cloud Functions behind Netlify.
import crypto from 'node:crypto';
import { env, loadSettings, saveSettings, describeSettings, getMeta, setMeta, runWith, ctx } from './config.js';
import { computeStats, ruleInsights, insightsPrompt, parseBullets } from './insights.js';
import { checkText, fixPrompt } from './compliance.js';
import { TRACKS, LESSONS, RELEASES, MANUAL, publicContent, searchLessons, manualMarkdown } from './guide-content.js';

const SCHEMA = {
  campaigns: { name: 's', goal: 's', audience: 's', channels: 'a', budget: 'n', target: 'n', start: 's', end: 's', message: 's', spent: 'n', status: 's', fbCampaign: 's', impressions: 'n', clicks: 'n', order: 'n' },
  posts: { campaign: 's', channel: 's', at: 's', text: 's', status: 's', error: 's', publishedAt: 's', via: 's', attempts: 'n', override: 'n', image: 's', ref: 's', likes: 'n', comments: 'n', shares: 'n', metricsAt: 's' },
  leads: { name: 's', phone: 's', email: 's', campaign: 's', value: 'n', stage: 's', created: 's', note: 's', followedUp: 'n', variant: 's', next: 's', seq: 'n', remindedOn: 's' }
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
function readBody(req, max = 100e3) {
  if (req.rawBody !== undefined || (req.body && typeof req.body === 'object' && !req.readable)) {
    // already consumed by the Cloud Functions runtime
    if (req.rawBody !== undefined && Buffer.byteLength(req.rawBody) > max) throw httpErr(413, 'גוף הבקשה גדול מדי');
    try { return Promise.resolve(req.rawBody !== undefined ? (req.rawBody.length ? JSON.parse(req.rawBody) : {}) : req.body); }
    catch { throw httpErr(400, 'JSON לא תקין'); }
  }
  return new Promise((resolve, reject) => {
    let n = 0; const chunks = [];
    req.on('data', c => { n += c.length; if (n > max) { reject(httpErr(413, 'גוף הבקשה גדול מדי')); req.destroy(); } else chunks.push(c); });
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
// Calls to outside services (AI, Facebook, Telegram, email, webhooks). Failures become a 502 whose message
// says which service failed and why, instead of a generic "server error". Secrets are never part of the message.
async function ext(url, init, ms = 15000) {
  const host = new URL(url).hostname;
  let r;
  try { r = await fetch(url, { ...init, signal: AbortSignal.timeout(ms) }); }
  catch (e) { throw httpErr(502, `${host}: ${e.name === 'TimeoutError' ? 'השירות לא ענה בזמן' : 'לא ניתן להתחבר לשירות'}`); }
  if (!r.ok) throw httpErr(502, `${host} ${r.status}: ${(await r.text()).slice(0, 200)}`);
  return r;
}
async function postJson(url, body, headers = {}) {
  const r = await ext(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers }, body: JSON.stringify(body) });
  return r.json().catch(() => ({}));
}
const tgApi = m => `${env('TELEGRAM_API_URL') || 'https://api.telegram.org'}/bot${env('TG_BOT_TOKEN')}/${m}`;
// Lead notifications contain personal data, so they must never go to a public channel/group:
// use the private notification chat, or TG_CHAT_ID only when it is a private user chat (positive number).
const notifyChat = () => env('TG_NOTIFY_CHAT_ID') || (/^\d+$/.test(env('TG_CHAT_ID')) ? env('TG_CHAT_ID') : '');
const openaiBase = () => (env('OPENAI_BASE_URL') || 'https://api.openai.com/v1').replace(/\/$/, '');
const fbApi = () => env('FACEBOOK_API_URL') || 'https://graph.facebook.com/v19.0';
let lastOrigin = '';
const siteBase = () => (env('SITE_URL') || process.env.URL || lastOrigin).replace(/\/$/, '');
async function postForm(url, fd) {
  const r = await ext(url, { method: 'POST', body: fd }, 30000);
  return r.json().catch(() => ({}));
}
const connectors = () => ({
  facebook: !!(env('FB_PAGE_ID') && env('FB_PAGE_TOKEN')),
  telegram: !!(env('TG_BOT_TOKEN') && env('TG_CHAT_ID')),
  tgNotify: !!(env('TG_BOT_TOKEN') && notifyChat()),
  webhook: !!env('PUBLISH_WEBHOOK_URL'),
  email: !!(env('RESEND_API_KEY') && env('EMAIL_FROM')),
  image: !!env('OPENAI_API_KEY')
});

async function getJson(url) {
  return (await ext(url, {})).json();
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
const israelDate = (t = Date.now()) => new Intl.DateTimeFormat('sv', { timeZone: 'Asia/Jerusalem' }).format(t);
const israelHour = (t = Date.now()) => +new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', hour12: false }).format(t);
const addDays = (ymd, n) => new Date(Date.parse(ymd + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
const FOLLOW_STEPS = [1, 3, 7]; // days after the previous contact
// ---- Activity log: what was done, by whom, when. Never stores secrets or field values, only names and labels. ----
const EVENT_TEXT = {
  'campaigns.create': e => `נוצר קמפיין "${e.label}"`, 'campaigns.update': e => `עודכן קמפיין "${e.label}" (${(e.fields || []).join(', ')})`, 'campaigns.delete': e => `נמחק קמפיין "${e.label}"`, 'campaigns.reorder': () => 'שונה סדר הקמפיינים',
  'posts.create': e => `נוסף פוסט ל-${e.channel || 'ערוץ'}: "${e.label}"`, 'posts.update': e => `עודכן פוסט "${e.label}" (${(e.fields || []).join(', ')})`, 'posts.delete': e => `נמחק פוסט "${e.label}"`,
  'post.published': e => `פורסם פוסט ב-${e.channel}: "${e.label}"`, 'post.blocked': e => `פוסט נעצר בבדיקת תאימות: "${e.label}"`, 'post.failed': e => `פרסום נכשל ב-${e.channel}: "${e.label}"`,
  'leads.create': e => `נוסף ליד "${e.label}"`, 'leads.update': e => `עודכן ליד "${e.label}" (${(e.fields || []).join(', ')})`, 'leads.delete': e => `נמחק ליד "${e.label}"`, 'leads.contacted': e => `נרשמה שיחה עם "${e.label}"`, 'lead.website': e => `ליד חדש מהאתר: "${e.label}"`,
  'settings.update': e => `עודכנו הגדרות (${(e.fields || []).join(', ')})`, 'media.create': () => 'הועלתה תמונה או באנר', 'plan.tick': e => `${e.done ? 'סומנה' : 'בוטלה'} משימה בתוכנית העבודה (${e.label})`,
  'workspace.create': e => `נוצרה סביבת עבודה "${e.label}"`, 'access.update': e => `עודכנו הרשאות של ${e.label}`, 'user.create': e => `נוסף איש צוות ${e.label}`,
  'patients.create': () => 'נוסף מטופל', 'patients.update': () => 'עודכנו פרטי מטופל', 'patients.delete': () => 'נמחק מטופל וכל הנתונים שלו', 'care.entry': e => `נרשמה רשומת ליווי (${e.kind})`, 'care.link': e => (e.revoked ? 'בוטל קישור ליווי למטופל' : 'נוצר קישור ליווי למטופל'), 'care.patient': e => `מטופל שלח ${e.kind === 'question' ? 'שאלה' : 'עדכון'}`,
  'knowledge.add': e => `נרשם ${e.kind === 'need' ? 'צורך' : e.kind === 'decision' ? 'החלטה' : 'הערה'}: "${e.label}"`, 'academy.lesson': e => `הושלם שיעור "${e.label}" (${e.score}%)`
};
const describeEvent = e => (e.type.startsWith('ai.') ? `שימוש ב-AI (${e.type.slice(3)})` : (EVENT_TEXT[e.type]?.(e) || e.type));
const labelOf = o => String(o?.name || o?.title || o?.text || o?.channel || '').replace(/\s+/g, ' ').slice(0, 60);

// ---- Patient care: private health data. Names and health details never reach the activity log, AI prompts or notifications. ----
const DAYRE = /^\d{4}-\d{2}-\d{2}$/, PSTATUS = ['פעיל', 'מושהה', 'הושלם'];
const firstName = n => String(n || '').trim().split(/\s+/)[0].slice(0, 20);
function cleanPatient(b, cur = {}) {
  const out = { ...cur }, str = (k, max) => { if (k in b) out[k] = String(b[k] ?? '').trim().slice(0, max); };
  str('name', 80); str('phone', 30); str('email', 120); str('goal', 500); str('note', 2000);
  if ('status' in b && PSTATUS.includes(b.status)) out.status = b.status;
  if ('next' in b) { if (b.next && !DAYRE.test(String(b.next))) throw httpErr(400, 'תאריך לא תקין'); out.next = String(b.next || ''); }
  if ('consent' in b) { const c = b.consent ? 1 : 0; if (c && !cur.consent) out.consentAt = new Date().toISOString(); out.consent = c; if (!c) out.token = ''; }
  if (!out.name) throw httpErr(400, 'נא למלא שם');
  return out;
}
const num = (v, lo, hi) => { if (v === '' || v == null) return null; const n = +v; return Number.isFinite(n) ? clamp(n, lo, hi) : null; };
function cleanEntry(b) {
  const e = { weight: num(b.weight, 20, 400), energy: num(b.energy, 1, 5), mood: num(b.mood, 1, 5), text: String(b.text || '').trim().slice(0, 1500) };
  if (e.weight == null && e.energy == null && e.mood == null && !e.text) throw httpErr(400, 'נא למלא לפחות שדה אחד');
  return Object.fromEntries(Object.entries(e).filter(([, v]) => v !== null && v !== ''));
}
const sameToken = (a, b) => { const x = Buffer.from(String(a || '')), y = Buffer.from(String(b || '')); return x.length > 0 && x.length === y.length && crypto.timingSafeEqual(x, y); };
const careEntries = async (S, pid) => (await S.list('care')).filter(e => e.patient === pid).sort((a, b) => b.at.localeCompare(a.at));
async function addEntry(S, pid, by, type, body, extra = {}) {
  const at = new Date().toISOString();
  return S.put('care', `${pid}-${String(Date.now()).padStart(13, '0')}-${crypto.randomBytes(2).toString('hex')}`, { patient: pid, at, by, type, ...cleanEntry(body), ...extra });
}
async function logEvent(S, user, type, data = {}) {
  try {
    const clean = Object.fromEntries(Object.entries(data).map(([k, v]) => [k, typeof v === 'string' ? v.slice(0, 120) : Array.isArray(v) ? v.map(x => String(x).slice(0, 40)).slice(0, 12) : v]));
    await S.put('activity', `${String(Date.now()).padStart(13, '0')}-${crypto.randomBytes(3).toString('hex')}`, { type, by: user?.email || 'system', name: user?.name || '', at: new Date().toISOString(), ...clean });
  } catch (e) { console.error('activity:', e.message); }
}
const recentEvents = async (S, n = 60) => (await S.list('activity')).sort((a, b) => (a.id < b.id ? 1 : -1)).slice(0, n);

// Deterministic knowledge book: used by the weekly auto-update and when no AI key is configured.
function fallbackPlaybook({ stats, events, needs, prev }) {
  const byChannel = {};
  for (const e of events) if (e.type === 'post.published' && e.channel) byChannel[e.channel] = (byChannel[e.channel] || 0) + 1;
  const used = {};
  for (const e of events) { const k = e.type.split('.')[0]; used[k] = (used[k] || 0) + 1; }
  const best = stats.campaigns.filter(c => c.cpl !== null && c.spent > 0).sort((a, b) => a.cpl - b.cpl)[0];
  const lines = [
    '# ספר הפעולה שלנו', `_עודכן ${new Date().toLocaleDateString('he-IL')} (נוצר מהפעילות, הנתונים וההחלטות)_`, '',
    '## איך אנחנו עובדים',
    `- קמפיינים פעילים: ${stats.campaigns.filter(c => c.status === 'פעיל').length} מתוך ${stats.campaigns.length}. לידים בסך הכול: ${stats.leadsTotal}. פוסטים שפורסמו השבוע: ${stats.publishedWeek}.`,
    Object.keys(byChannel).length ? `- ערוצים שפורסם בהם לאחרונה: ${Object.entries(byChannel).map(([c, n]) => `${c} (${n})`).join(', ')}.` : '- עדיין לא פורסמו פוסטים אוטומטית.',
    `- פעילות אחרונה לפי תחום: ${Object.entries(used).map(([k, n]) => `${k} ${n}`).join(', ') || 'אין'}.`, '',
    '## מה עבד',
    best ? `- הקמפיין הכי משתלם: "${best.name}" (₪${Math.round(best.cpl)} לליד).` : '- עדיין אין מספיק נתונים על עלות לליד.',
    stats.topPost ? `- הפוסט עם הכי הרבה אינטראקציה: "${stats.topPost.text}" (${stats.topPost.channel}).` : '- אין עדיין נתוני אינטראקציה.', '',
    '## החלטות וצרכים שהוגדרו',
    ...(needs.length ? needs.map(n => `- **${n.type === 'decision' ? 'החלטה' : n.type === 'need' ? 'צורך' : 'הערה'}:** ${n.title}${n.body ? ` — ${String(n.body).slice(0, 160)}` : ''}`) : ['- עדיין לא נרשמו. אפשר להוסיף בכרטיס "אנחנו צריכים / החלטנו".']), '',
    '## שינויים אחרונים (נרשמו אוטומטית)',
    ...(events.slice(0, 12).map(e => `- ${String(e.at).slice(0, 10)}: ${describeEvent(e)}`)), '',
    '## מה כדאי לעשות עכשיו', ...ruleInsights(stats).slice(0, 4).map(i => `- ${i}`)
  ];
  return lines.join('\n');
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
  if (name === 'image') {
    if (!c.image) throw new Error('חסר מפתח OpenAI');
    await (await ext(`${openaiBase()}/models`, { headers: { authorization: 'Bearer ' + env('OPENAI_API_KEY') } })).json().catch(() => ({}));
    return `המפתח תקין. מודל התמונות: ${env('IMAGE_MODEL') || 'gpt-image-1'}`;
  }
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
async function publish(post, campaign, loadMedia) {
  const c = connectors(), ch = post.channel;
  const img = post.image ? await loadMedia(post.image) : null;
  const blob = img ? new Blob([Buffer.from(img.data, 'base64')], { type: img.type }) : null;
  if (ch === 'Facebook' && c.facebook) {
    const page = encodeURIComponent(env('FB_PAGE_ID'));
    if (blob) {
      const fd = new FormData();
      fd.append('source', blob, 'image'); fd.append('caption', post.text); fd.append('access_token', env('FB_PAGE_TOKEN'));
      const r = await postForm(`${fbApi()}/${page}/photos`, fd);
      return { via: 'facebook', ref: r.post_id || r.id || '' };
    }
    const r = await postJson(`${fbApi()}/${page}/feed`, { message: post.text, access_token: env('FB_PAGE_TOKEN') });
    return { via: 'facebook', ref: r.id || '' };
  }
  if (ch === 'Telegram' && c.telegram) {
    if (blob) {
      const fd = new FormData(), short = post.text.length <= 1000;
      fd.append('chat_id', env('TG_CHAT_ID')); fd.append('photo', blob, 'image'); if (short) fd.append('caption', post.text);
      const r = await postForm(tgApi('sendPhoto'), fd);
      if (!short) await postJson(tgApi('sendMessage'), { chat_id: env('TG_CHAT_ID'), text: post.text });
      return { via: 'telegram', ref: String(r.result?.message_id || '') };
    }
    const r = await postJson(tgApi('sendMessage'), { chat_id: env('TG_CHAT_ID'), text: post.text });
    return { via: 'telegram', ref: String(r.result?.message_id || '') };
  }
  if (c.webhook) {
    await postJson(env('PUBLISH_WEBHOOK_URL'), { event: 'post.publish', channel: ch, text: post.text, campaign: campaign?.name || '', at: post.at,
      ...(img && siteBase() ? { image_url: `${siteBase()}/api/media/${post.image}` } : {}) });
    return { via: 'webhook', ref: '' };
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
  const r = await (await ext(env('ANTHROPIC_API_URL') || 'https://api.anthropic.com/v1/messages', {
    method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': env('ANTHROPIC_API_KEY'), 'anthropic-version': '2023-06-01' },
    body: JSON.stringify({ model: env('AI_MODEL') || 'claude-sonnet-5-5', max_tokens: max, messages: [{ role: 'user', content: prompt }] })
  }, 60000)).json().catch(() => ({}));
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
export function createApp(store, opts = {}) {
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

  const base = store; // unscoped store (users, sessions, media, workspaces)
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

  async function tick(now = Date.now()) {
    await ensureAdmin();
    for (const j of await store.list('jobs')) if (Date.parse(j.created) < now - 864e5) await store.del('jobs', j.id);
    for (const { id: ws } of await listWorkspaces()) {
      const S = scoped(ws);
      await runWith({ ws, overrides: await loadSettings(S, ws) }, () => tickWorkspace(S, now)).catch(e => console.error('tick', ws, e));
    }
  }

  const loadMedia = id => (id ? base.get('media', id) : null);

  // Facebook reactions/comments/shares for recent posts, page followers, and ad spend per campaign (best effort).
  async function syncMetrics(S, now, force = false) {
    if (!connectors().facebook) return { posts: 0, campaigns: 0 };
    const meta = await getMeta(S);
    if (!force && now - (Date.parse(meta.lastMetrics) || 0) < 6 * 3600e3) return { posts: 0, campaigns: 0 };
    let posts = 0, campaigns = 0;
    for (const p of await S.list('posts')) {
      if (p.via !== 'facebook' || !p.ref || !p.publishedAt || now - Date.parse(p.publishedAt) > 30 * 864e5) continue;
      try {
        const r = await getJson(`${fbApi()}/${encodeURIComponent(p.ref)}?fields=reactions.summary(true),comments.summary(true),shares&access_token=${encodeURIComponent(env('FB_PAGE_TOKEN'))}`);
        await S.put('posts', p.id, { ...p, likes: r.reactions?.summary?.total_count || 0, comments: r.comments?.summary?.total_count || 0, shares: r.shares?.count || 0, metricsAt: new Date(now).toISOString() });
        posts++;
      } catch (e) { console.error('metrics post:', e.message); }
    }
    if (env('FB_ADS_TOKEN')) {
      for (const c of await S.list('campaigns')) {
        if (!c.fbCampaign) continue;
        try {
          const r = await getJson(`${fbApi()}/${encodeURIComponent(c.fbCampaign)}/insights?fields=spend,impressions,clicks&date_preset=maximum&access_token=${encodeURIComponent(env('FB_ADS_TOKEN'))}`);
          const d = r.data?.[0]; if (!d) continue;
          await S.put('campaigns', c.id, { ...c, spent: +d.spend || 0, impressions: +d.impressions || 0, clicks: +d.clicks || 0 });
          campaigns++;
        } catch (e) { console.error('metrics campaign:', e.message); }
      }
    }
    try {
      const f = await getJson(`${fbApi()}/${encodeURIComponent(env('FB_PAGE_ID'))}?fields=fan_count,followers_count&access_token=${encodeURIComponent(env('FB_PAGE_TOKEN'))}`);
      await setMeta(S, { fans: f.followers_count ?? f.fan_count ?? null });
    } catch (e) { console.error('metrics page:', e.message); }
    await setMeta(S, { lastMetrics: new Date(now).toISOString() });
    return { posts, campaigns };
  }

  // The knowledge book rewrites itself once a week from what happened (deterministic, no AI call inside a scheduled
  // function). The "🧠 עדכנו את הידע" button uses AI when a key exists.
  async function selfLearn(S, now) {
    const meta = await getMeta(S);
    if (now - (Date.parse(meta.lastLearn) || 0) < 7 * 864e5) return;
    const events = await recentEvents(S, 150);
    if (!events.length) return;
    await aiTasks.learn(S, { auto: true }, { user: 'system' }, true);
    await setMeta(S, { lastLearn: new Date(now).toISOString() });
    const all = (await S.list('activity')).sort((a, b) => (a.id < b.id ? 1 : -1));
    for (const e of all.slice(800)) await S.del('activity', e.id); // keep the most recent ~800 events
  }

  async function tickWorkspace(store, now) {
    const paused = new Set((await store.list('campaigns')).filter(c => c.status === 'מושהה').map(c => c.id));
    for (const p of await store.list('posts')) {
      if (p.status !== 'מתוזמן' || !p.at || Date.parse(p.at) > now) continue;
      if (p.campaign && paused.has(p.campaign)) continue; // paused campaign: its posts wait
      // Pre-publish compliance gate: risky health claims wait for a person to fix or approve.
      if (env('COMPLIANCE') !== 'off' && !p.override) {
        const risk = checkText(p.text);
        if (risk.level === 'high') {
          await logEvent(store, null, 'post.blocked', { id: p.id, label: labelOf(p), channel: p.channel });
          await store.put('posts', p.id, { ...p, status: 'ממתין לבדיקה', error: 'ניסוח עלול להיחשב הבטחה רפואית: ' + risk.findings.filter(f => f.level === 'high').map(f => f.match).join(', ') });
          await notify(`🛑 פוסט ל-${p.channel} נעצר לבדיקה (ניסוח רפואי בעייתי):\n${p.text.slice(0, 200)}`, 'post.blocked');
          continue;
        }
      }
      if (!await store.claim('posts', p.id, 'מתוזמן', 'מפרסם')) continue;
      try {
        const r = await publish(p, await store.get('campaigns', p.campaign || ''), loadMedia);
        await store.put('posts', p.id, r
          ? { ...p, status: 'פורסם', via: r.via, ref: r.ref, publishedAt: new Date().toISOString(), error: '' }
          : { ...p, status: 'ידני', error: 'אין חיבור לערוץ – יש לפרסם ידנית' });
        if (r) await logEvent(store, null, 'post.published', { id: p.id, label: labelOf(p), channel: p.channel });
        if (!r) await notify(`⏰ פוסט ל-${p.channel} ממתין לפרסום ידני:\n${p.text.slice(0, 200)}`, 'post.manual');
      } catch (e) {
        const attempts = (p.attempts || 0) + 1;
        await store.put('posts', p.id, { ...p, attempts, error: e.message, status: attempts >= 3 ? 'נכשל' : 'מתוזמן', at: attempts >= 3 ? p.at : new Date(now + attempts * 5 * 60e3).toISOString() });
        if (attempts >= 3) { await logEvent(store, null, 'post.failed', { id: p.id, label: labelOf(p), channel: p.channel }); await notify(`❌ פרסום ל-${p.channel} נכשל: ${e.message}`, 'post.failed'); }
      }
    }
    const today = israelDate(now), hourNow = israelHour(now);
    for (const l of await store.list('leads')) {
      if (l.stage === 'חדש' && !l.followedUp && now - Date.parse(l.created) > 2 * 864e5) {
        await store.put('leads', l.id, { ...l, followedUp: 1 });
        await notify(`📞 ליד ממתין יותר מיומיים: ${l.name} ${l.phone} ${l.email}`, 'lead.stale', { lead: l });
        continue;
      }
      // Follow-up reminders (from 08:00 Israel time, once per due date).
      if (env('FOLLOWUP') !== 'off' && hourNow >= 8 && l.next && l.next <= today && l.remindedOn !== l.next && !['נסגר', 'אבוד'].includes(l.stage)) {
        await store.put('leads', l.id, { ...l, remindedOn: l.next });
        const wa = waLink(l.phone);
        await notify(`🔔 היום לחזור אל ${oneLine(l.name)} ${l.phone || ''}${wa ? `\n💬 ${wa}` : ''}`, 'lead.followup', { lead: l });
      }
    }
    for (const pt of await store.list('patients')) {
      if (pt.status === 'פעיל' && hourNow >= 8 && pt.next && pt.next <= today && pt.remindedOn !== pt.next) {
        await store.put('patients', pt.id, { ...pt, remindedOn: pt.next });
        const wa = waLink(pt.phone);
        await notify(`🔔 היום ליווי: ${firstName(pt.name)}${wa ? `\n💬 ${wa}` : ''}`, 'care.followup');
      }
    }
    await selfLearn(store, now).catch(e => console.error('learn:', e.message));
    await syncMetrics(store, now).catch(e => console.error('metrics:', e.message));
    await digest(store, now).catch(e => console.error('digest:', e.message));
  }


  // ---- AI tasks. Inline by default; with opts.startJob (Netlify background functions) they run as background
  // jobs, because ordinary serverless functions time out long before a full campaign has been generated. ----
  const aiTasks = {
    async generate(S, b) {
      const c = await S.get('campaigns', String(b.campaign || ''));
      return { text: await claude(`אתה קופירייטר שיווקי בעברית. כתוב פוסט אחד לערוץ ${String(b.channel).slice(0, 30)} בלבד, בלי הקדמות ובלי הסברים.\n${brief(c)}\nהנחיה נוספת: ${String(b.brief || '').slice(0, 500)}`, 700) };
    },
    async 'quick-campaign'(S, b) {
      const idea = String(b.idea || '').trim().slice(0, 600);
      if (idea.length < 3) throw httpErr(400, 'ספרו במשפט אחד מה רוצים לקדם');
      const days = clamp(Math.round(+b.days || 7), 1, 30);
      const channels = (Array.isArray(b.channels) ? b.channels : []).filter(x => CHANNELS.includes(x)).slice(0, 6);
      if (!channels.length) channels.push('Facebook');
      if (!env('ANTHROPIC_API_KEY')) return { ai: false, draft: cleanDraft(fallbackDraft(idea, channels, days), channels, days) };
      const n = Math.min(days, 10);
      const raw = await claude(`אתה אסטרטג שיווק ישראלי. בנה קמפיין שלם בעברית לפי הרעיון.
חוקים: בלי הבטחות רפואיות או טענות ריפוי, בלי "לפני/אחרי", בלי מספרים או עובדות שלא ניתנו, קריאה אחת לפעולה בכל פוסט, טקסט קצר וברור, אימוג'י במידה.
${env('BUSINESS_PROFILE') ? 'על העסק: ' + env('BUSINESS_PROFILE').slice(0, 500) + '\n' : ''}החזר JSON תקין בלבד, בלי הסברים: {"name":"שם קצר","goal":"אחד מ: ${GOALS.join(', ')}","audience":"תיאור קהל היעד","message":"המסר המרכזי בשורה אחת","posts":[{"day":0,"channel":"אחד מ: ${channels.join(', ')}","text":"..."}]}
עד ${n} פוסטים לאורך ${days} ימים (day מ-0 עד ${days - 1}), מפוזרים בין הערוצים.
הרעיון: ${idea}`, 3500);
      let d; try { d = JSON.parse(raw.slice(raw.indexOf('{'), raw.lastIndexOf('}') + 1)); } catch { throw httpErr(502, 'ה-AI החזיר תשובה לא תקינה, נסו שוב'); }
      const draft = cleanDraft(d, channels, days);
      if (!draft.posts.length) throw httpErr(502, 'ה-AI לא החזיר פוסטים, נסו שוב');
      return { ai: true, draft };
    },
    async plan(S, b) {
      const c = await S.get('campaigns', String(b.campaign || ''));
      if (!c) throw httpErr(404, 'קמפיין לא נמצא');
      const days = Math.min(Math.max(+b.days || 7, 1), 30);
      const raw = await claude(`תכנן לוח תוכן שיווקי בעברית ל-${days} ימים עבור הקמפיין. החזר JSON תקין בלבד: מערך של אובייקטים {"day":0..${days - 1},"channel":"אחד מ: ${(c.channels.length ? c.channels : ['Facebook']).join(', ')}","text":"..."}. עד 10 פוסטים.\n${brief(c)}`, 3000);
      let arr; try { arr = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1)); } catch { throw httpErr(502, 'ה-AI החזיר תשובה לא תקינה, נסו שוב'); }
      const start = Date.parse((c.start || new Date().toISOString().slice(0, 10)) + 'T10:00:00');
      const status = env('AUTO_APPROVE') === 'true' ? 'מתוזמן' : 'טיוטה';
      let created = 0;
      for (const x of arr.slice(0, 10)) {
        await S.put('posts', uid(), pick('posts', { campaign: c.id, channel: x.channel, text: x.text, status, at: new Date(start + (+x.day || 0) * 864e5).toISOString() }));
        created++;
      }
      return { created, status };
    },
    // Rewrite any text field according to a one-line instruction from the user ("shorter", "warmer", ...).
    async improve(S, b) {
      const text = String(b.text || '').trim().slice(0, 4000);
      const instruction = String(b.instruction || '').trim().slice(0, 300);
      const label = String(b.label || 'טקסט').replace(/[\r\n]+/g, ' ').slice(0, 80);
      if (!text && !instruction) throw httpErr(400, 'כתבו טקסט, או הנחיה לגבי מה לכתוב');
      const channel = CHANNELS.includes(b.channel) ? b.channel : '';
      const improved = (await claude(`אתה עורך שיווקי מקצועי בעברית. השדה: "${label}".${channel ? ` הטקסט מיועד לערוץ ${channel}.` : ''}
${env('BUSINESS_PROFILE') ? 'על העסק: ' + env('BUSINESS_PROFILE').slice(0, 500) + '\n' : ''}${text ? `הטקסט הנוכחי:\n\"\"\"\n${text}\n\"\"\"` : 'אין עדיין טקסט בשדה, כתבו אותו מאפס.'}
ההנחיה של המשתמש: ${instruction || 'שפר את הטקסט: חד, ברור ומשכנע יותר.'}
כללים: החזר רק את הטקסט הסופי, בלי הסברים, בלי כותרות ובלי מרכאות מסביב. כתוב בעברית. שמור על המסר ועל העובדות; אל תמציא מחירים, מספרים או עובדות שלא ניתנו. בלי הבטחות רפואיות, בלי טענות ריפוי ובלי "לפני/אחרי". התאם את האורך לשדה (שם: קצר; פוסט: עד כ-600 תווים; הערה: קצרה).`, 900))
        .replace(/^["“״']+|["”״']+$/g, '').trim();
      if (!improved) throw httpErr(502, 'ה-AI לא החזיר טקסט, נסו שוב');
      return { text: improved, risk: checkText(improved) };
    },
    // Three short Hebrew banner texts (headline / subline / button) for the banner designer.
    async 'banner-copy'(S, b) {
      const text = String(b.text || '').trim().slice(0, 1500), instruction = String(b.instruction || '').trim().slice(0, 200);
      if (!text && !instruction) throw httpErr(400, 'כתבו טקסט או הנחיה כדי שאציע כותרות');
      const raw = await claude(`אתה קופירייטר שיווקי בעברית. הצע 3 וריאציות של כותרות לבאנר גרפי, לפי הטקסט.
${env('BUSINESS_PROFILE') ? 'על העסק: ' + env('BUSINESS_PROFILE').slice(0, 400) + '\n' : ''}טקסט: ${text || '(אין)'}
${instruction ? 'הנחיה: ' + instruction + '\n' : ''}כל וריאציה: "headline" עד 6 מילים, "sub" עד 12 מילים (אפשר ריק), "cta" עד 3 מילים. בלי הבטחות רפואיות, בלי טענות ריפוי, בלי להמציא עובדות או מספרים.
החזר JSON תקין בלבד: מערך של 3 אובייקטים {"headline":"","sub":"","cta":""}.`, 700);
      let arr; try { arr = JSON.parse(raw.slice(raw.indexOf('['), raw.lastIndexOf(']') + 1)); } catch { throw httpErr(502, 'ה-AI החזיר תשובה לא תקינה, נסו שוב'); }
      const options = arr.slice(0, 3).map(o => ({ headline: String(o.headline || '').slice(0, 80), sub: String(o.sub || '').slice(0, 140), cta: String(o.cta || '').slice(0, 40) }))
        .filter(o => o.headline).map(o => ({ ...o, risk: checkText(`${o.headline} ${o.sub} ${o.cta}`) }));
      if (!options.length) throw httpErr(502, 'ה-AI לא החזיר כותרות, נסו שוב');
      return { options };
    },
    // A short English description for the image model, written from the post text.
    async 'image-prompt'(S, b) {
      const text = String(b.text || '').trim().slice(0, 1500);
      if (!text) throw httpErr(400, 'כתבו קודם את טקסט הפוסט');
      const out = await claude(`Write ONE short English prompt (max 45 words) for an image generation model that creates a background image for this Hebrew marketing post. Calm, clean, professional style suitable for a health and wellness brand. The image must contain NO text, NO letters, NO logos, NO close-up faces, and must not imply medical results. Return only the prompt.
${env('BUSINESS_PROFILE') ? 'Business: ' + env('BUSINESS_PROFILE').slice(0, 300) + '\n' : ''}Post: ${text}`, 200);
      return { prompt: out.replace(/^["']+|["']+$/g, '').trim() };
    },
    // Generate an image with OpenAI and store it in the media library (JPEG keeps it under the 700KB document limit).
    async image(S, b, who) {
      const prompt = String(b.prompt || '').trim().slice(0, 600);
      if (prompt.length < 3) throw httpErr(400, 'תארו במשפט מה לצייר');
      if (!env('OPENAI_API_KEY')) throw httpErr(400, 'ליצירת תמונות חברו מפתח OpenAI בהגדרות ← יצירת תמונות');
      const size = ['1024x1024', '1024x1536', '1536x1024'].includes(b.size) ? b.size : '1024x1024';
      const r = await (await ext(`${openaiBase()}/images/generations`, {
        method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env('OPENAI_API_KEY') },
        body: JSON.stringify({ model: env('IMAGE_MODEL') || 'gpt-image-1', prompt: `${prompt}\nClean, professional marketing image. No text, no letters, no logos, no watermarks.`, size, n: 1, quality: 'medium', output_format: 'jpeg', output_compression: 65 })
      }, 120000)).json().catch(() => ({}));
      const b64 = r.data?.[0]?.b64_json;
      if (!b64) throw httpErr(502, 'לא התקבלה תמונה מהשירות');
      const buf = Buffer.from(b64, 'base64');
      if (!(buf[0] === 0xff && buf[1] === 0xd8)) throw httpErr(502, 'התמונה שהתקבלה אינה בפורמט צפוי');
      if (buf.length > 700e3) throw httpErr(502, 'התמונה שנוצרה גדולה מדי. נסו תיאור פשוט יותר');
      const id = crypto.randomBytes(12).toString('hex');
      await base.put('media', id, { ws: who.ws, type: 'image/jpeg', data: b64, created: new Date().toISOString() });
      return { id, url: `/api/media/${id}` };
    },
    // Rewrites the living knowledge book from activity, results and decisions.
    async learn(S, b, who, deterministic = false) {
      const [events, stats, kn] = await Promise.all([recentEvents(S, 120), computeStats(S), S.list('knowledge')]);
      const needs = kn.filter(k => k.id !== 'playbook' && k.type).sort((a, c) => (a.id < c.id ? 1 : -1)).slice(0, 40);
      const prev = kn.find(k => k.id === 'playbook')?.body || '';
      let body = '', ai = false;
      if (!deterministic && env('ANTHROPIC_API_KEY')) {
        body = (await claude(`אתה כותב "ספר פעולה חי" בעברית עבור צוות שיווק של עסק. החומר למטה הוא כל מה שידוע. כתוב ב-Markdown, עד 450 מילים, עם הכותרות: "איך אנחנו עובדים", "מה עבד", "החלטות וצרכים שהוגדרו", "שינויים אחרונים", "מה כדאי לעשות עכשיו" (3 פעולות קונקרטיות).
כללים: רק לפי החומר, בלי להמציא נתונים, החלטות או מספרים. אם אין מספיק נתונים כתבו זאת. שמרו מהספר הקודם את מה שעדיין נכון. בלי הבטחות רפואיות.
${env('BUSINESS_PROFILE') ? 'על העסק: ' + env('BUSINESS_PROFILE').slice(0, 400) + '\n' : ''}ספר קודם:
${prev.slice(0, 3000) || '(אין)'}

נתונים: ${JSON.stringify({ campaigns: stats.campaigns.map(c => ({ name: c.name, status: c.status, spent: c.spent, leads: c.leads, cpl: c.cpl })), leadsWeek: stats.leadsWeek, publishedWeek: stats.publishedWeek, topPost: stats.topPost, blocked: stats.blocked })}

פעילות אחרונה:
${events.slice(0, 60).map(e => `- ${String(e.at).slice(0, 10)} ${e.name || e.by}: ${describeEvent(e)}`).join('\n') || '(אין)'}

צרכים והחלטות:
${needs.map(n => `- [${n.type}] ${n.title}: ${String(n.body || '').slice(0, 200)}`).join('\n') || '(אין)'}

עדכוני מערכת אחרונים:
${RELEASES.slice(0, 4).map(r => `- ${r.date} ${r.title}: ${r.summary}`).join('\n')}`, 2200)).trim();
        ai = body.length > 80;
      }
      if (!ai) body = fallbackPlaybook({ stats, events, needs, prev });
      await S.put('knowledge', 'playbook', { type: 'playbook', title: 'ספר הפעולה', body, updated: new Date().toISOString(), by: who.user, ai });
      return { body, ai };
    },
    // The in-app tutor: answers from lessons, the manual, the knowledge book, decisions and recent activity.
    async ask(S, b, who) {
      const question = String(b.question || '').trim().slice(0, 500);
      if (question.length < 2) throw httpErr(400, 'כתבו שאלה');
      const hits = searchLessons(question, 3);
      if (!env('ANTHROPIC_API_KEY')) {
        const top = hits[0] && LESSONS[hits[0].id];
        return { ai: false, lessons: hits, answer: top
          ? `מצאתי שיעור מתאים: "${top.title}".\n${top.intro}\n\nהשלבים:\n${top.steps.map((st, i) => `${i + 1}. ${st.t}: ${st.d}`).join('\n')}\n\n(לתשובות חופשיות חברו מפתח AI בהגדרות.)`
          : 'לא מצאתי שיעור מתאים. נסו לנסח אחרת, או חברו מפתח AI בהגדרות לתשובות חופשיות.' };
      }
      const kn = await S.list('knowledge');
      const play = kn.find(k => k.id === 'playbook')?.body || '';
      const needs = kn.filter(k => k.id !== 'playbook' && k.type).sort((a, c) => (a.id < c.id ? 1 : -1)).slice(0, 15);
      const events = await recentEvents(S, 15);
      const q = new Set(question.toLowerCase().split(/[^א-תa-z0-9]+/).filter(w => w.length > 2));
      const sections = MANUAL.filter(m => [...q].some(w => (m.title + m.body).toLowerCase().includes(w))).slice(0, 3);
      const answer = (await claude(`אתה המדריך של מערכת השיווק, ומלמד את הקמפיינרית הראשית ואת הבעלים. ענה בעברית, קצר ומעשי, צעד אחרי צעד, רק לפי החומר שלמטה. אם התשובה לא בחומר, אמור שאין מידע ושאל מה חסר. אל תמציא כפתורים או תכונות. אם שיעור רלוונטי, הוסף בסוף [[lesson:מזהה]].
שיעורים מתאימים:
${hits.map(h => `- ${h.id}: ${LESSONS[h.id].title}. ${LESSONS[h.id].intro} שלבים: ${LESSONS[h.id].steps.map(st => st.t + ' - ' + st.d).join(' | ')}`).join('\n') || '(אין התאמה)'}
פרקים מספר ההפעלה:
${sections.map(m => `## ${m.title}\n${m.body.slice(0, 900)}`).join('\n\n') || '(אין)'}
ספר הידע שלנו:
${play.slice(0, 2500) || '(עדיין ריק)'}
צרכים והחלטות:
${needs.map(n => `- [${n.type}] ${n.title}: ${String(n.body || '').slice(0, 160)}`).join('\n') || '(אין)'}
פעילות אחרונה:
${events.map(e => `- ${describeEvent(e)}`).join('\n') || '(אין)'}
עדכוני מערכת: ${RELEASES.slice(0, 3).map(r => `${r.title} (${r.summary})`).join('; ')}

שאלה: ${question}`, 900)).trim();
      const ids = [...new Set([...answer.matchAll(/\[\[lesson:([\w-]+)\]\]/g)].map(m => m[1]).filter(id => LESSONS[id]))];
      return { ai: true, answer: answer.replace(/\[\[lesson:[\w-]+\]\]/g, '').trim(), lessons: [...new Set([...ids, ...hits.map(h => h.id)])].slice(0, 3).map(id => ({ id, title: LESSONS[id].title })) };
    },
    async fix(S, b) {
      const text = String(b.text || '').slice(0, 4000);
      const fixed = await claude(fixPrompt(text, checkText(text).findings, env('BUSINESS_PROFILE')), 800);
      return { text: fixed, risk: checkText(fixed) };
    },
    async insights(S) {
      const st = await computeStats(S);
      const lines = parseBullets(await claude(insightsPrompt(st, env('BUSINESS_PROFILE')), 900));
      return lines.length ? { ai: true, insights: lines } : { ai: false, insights: ruleInsights(st) };
    }
  };

  async function runAi(S, user, ws, kind, params) {
    if (!opts.startJob || !(env('ANTHROPIC_API_KEY') || env('OPENAI_API_KEY'))) { await logEvent(S, user, `ai.${kind}`); return aiTasks[kind](S, params, { ws, user: user.email }); }
    const id = crypto.randomBytes(12).toString('hex');
    await logEvent(S, user, `ai.${kind}`);
    const rec = { ws, kind, params, user: user.email, status: 'pending', created: new Date().toISOString() };
    await base.put('jobs', id, rec);
    try { await opts.startJob(id); }
    catch (e) { await base.put('jobs', id, { ...rec, status: 'error', error: 'לא ניתן להפעיל משימת רקע' }); throw httpErr(502, 'לא ניתן להפעיל משימת רקע: ' + String(e.message).slice(0, 120)); }
    return { job: id };
  }

  // Executes a queued job (called from the background function, or directly in tests).
  async function runJob(id) {
    const j = await base.get('jobs', id);
    if (!j || j.status !== 'pending') return;
    await base.put('jobs', id, { ...j, status: 'running' });
    const S = scoped(j.ws);
    await runWith({ ws: j.ws, overrides: await loadSettings(S, j.ws) }, async () => {
      try { await base.put('jobs', id, { ...j, status: 'done', result: await aiTasks[j.kind](S, j.params, { ws: j.ws, user: j.user }), finished: new Date().toISOString() }); }
      catch (e) { await base.put('jobs', id, { ...j, status: 'error', error: String(e.message).slice(0, 300), finished: new Date().toISOString() }); }
    });
  }

  async function api(req, res, url, store, user, ws) {
    const parts = url.pathname.replace(/^\/api(?=\/|$)/, '').split('/').filter(Boolean);
    const method = req.method, ip = clientIp(req);

    if (parts[0] === 'media' && method === 'GET' && parts[1]) {
      const m = /^[a-f0-9]{24}$/.test(parts[1]) ? await base.get('media', parts[1]) : null;
      if (!m) throw httpErr(404, 'לא נמצא');
      res.writeHead(200, { 'content-type': m.type, 'cache-control': 'public, max-age=31536000, immutable', 'x-content-type-options': 'nosniff' });
      return res.end(Buffer.from(m.data, 'base64'));
    }

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
        const lead = await LS.put('leads', uid(), pick('leads', { name: b.name, phone: b.phone, email: b.email, note: b.message, campaign: attributed, variant: /^[A-Za-z0-9]{1,10}$/.test(String(b.v || '')) ? String(b.v) : '', next: env('FOLLOWUP') !== 'off' ? addDays(israelDate(), 1) : '', seq: 0 }, { created: new Date().toISOString().slice(0, 10), stage: 'חדש', value: 0 }));
        await logEvent(LS, { email: 'visitor' }, 'lead.website', { id: lead.id, label: labelOf(lead) });
        await onNewLead(lead);
      });
      return send(res, 200, { ok: true }, cors);
    }

    if (parts[0] === 'care' && !parts[1]) {
      // Patient-facing page: a private link (patient id + secret token). Only the patient's own data, never staff notes.
      if (method !== 'GET' && method !== 'POST') throw httpErr(405, 'Method not allowed');
      if (limited('care:' + ip, 40, 600e3)) throw httpErr(429, 'יותר מדי בקשות, נסו שוב מאוחר יותר');
      const q = method === 'GET' ? Object.fromEntries(url.searchParams) : await readBody(req);
      const lws = String(q.w || 'main'), pid = String(q.p || '');
      if (lws !== 'main' && !(await listWorkspaces()).some(w => w.id === lws)) throw httpErr(404, 'הקישור אינו תקין');
      const CS = scoped(lws);
      return await runWith({ ws: lws, overrides: await loadSettings(CS, lws) }, async () => {
        const pt = /^[a-f0-9]{12}$/.test(pid) ? await CS.get('patients', pid) : null;
        if (!pt || !pt.consent || !sameToken(pt.token, q.t)) throw httpErr(404, 'הקישור אינו תקין או שבוטל');
        if (method === 'POST') {
          if (limited('care:' + pid, 30, 3600e3)) throw httpErr(429, 'יותר מדי עדכונים, נסו שוב מאוחר יותר');
          const type = q.type === 'question' ? 'question' : 'checkin';
          await addEntry(CS, pid, 'patient', type, q);
          await logEvent(CS, { email: 'patient' }, 'care.patient', { kind: type });
          await notify(`📩 ${firstName(pt.name)} שלח/ה ${type === 'question' ? 'שאלה' : 'עדכון'} דרך הפורטל. אפשר להיכנס למערכת ולענות.`, 'care.patient');
        }
        const entries = (await careEntries(CS, pid)).filter(e => e.by === 'patient' || e.type === 'reply' || (e.type === 'measure' && e.visible !== 0))
          .map(({ at, by, type, weight, energy, mood, text, answered }) => ({ at, by, type, weight, energy, mood, text, answered }));
        return send(res, 200, { ok: true, name: pt.name, goal: pt.goal, next: pt.next || '', contact: env('CONTACT_PHONE'), entries });
      });
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
      const risky = env('COMPLIANCE') === 'off' ? () => ({ level: '', findings: [] }) : p => checkText(p.text);
      return send(res, 200, { me: user, ws, workspaces, campaigns, posts: posts.map(p => ({ ...p, risk: risky(p) })), leads, checklist: checklist?.done || {}, caps: { ...connectors(), ai: !!env('ANTHROPIC_API_KEY') } });
    }

    if (parts[0] === 'workspaces') {
      if (user.role !== 'admin') throw httpErr(403, 'למנהלים בלבד');
      if (method === 'GET') return send(res, 200, await listWorkspaces());
      if (method === 'POST') {
        const name = String((await readBody(req)).name || '').trim().slice(0, 80);
        if (!name) throw httpErr(400, 'נא להזין שם');
        const w = await store.put('workspaces', uid(), { name, created: new Date().toISOString() });
        await logEvent(store, user, 'workspace.create', { label: name });
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
        await logEvent(store, user, 'access.update', { label: String(email) });
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
        await logEvent(store, user, 'user.create', { label: String(email) });
        if (role !== 'admin' && Array.isArray(workspaces)) {
          const known = new Set((await listWorkspaces()).map(w => w.id));
          await store.put('access', email.toLowerCase(), { workspaces: workspaces.filter(id => known.has(id)) });
        }
        return send(res, 201, { ok: true });
      }
    }

    if (parts[0] === 'media' && method === 'POST') {
      if (limited('media:' + user.email, 60, 3600e3)) throw httpErr(429, 'יותר מדי העלאות, נסו שוב מאוחר יותר');
      const { dataUrl } = await readBody(req, 1.5e6);
      const m = /^data:(image\/(?:jpeg|png|webp));base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl || ''));
      if (!m) throw httpErr(400, 'תמונה לא תקינה (JPEG, PNG או WebP)');
      const buf = Buffer.from(m[2], 'base64');
      if (buf.length > 700e3) throw httpErr(413, 'התמונה גדולה מדי (עד 700KB)'); // base64 must stay under Firestore's 1MB document limit
      const okMagic = { 'image/jpeg': [0xff, 0xd8, 0xff], 'image/png': [0x89, 0x50, 0x4e, 0x47], 'image/webp': [0x52, 0x49, 0x46, 0x46] }[m[1]].every((b, i) => buf[i] === b);
      if (!okMagic) throw httpErr(400, 'קובץ התמונה פגום');
      const id = crypto.randomBytes(12).toString('hex');
      await base.put('media', id, { ws, type: m[1], data: m[2], created: new Date().toISOString() });
      await logEvent(store, user, 'media.create');
      return send(res, 201, { id, url: `/api/media/${id}` });
    }

    if (parts[0] === 'compliance' && method === 'POST') {
      const b = await readBody(req);
      if (parts[1] === 'check' && Array.isArray(b.texts)) return send(res, 200, b.texts.slice(0, 30).map(x => checkText(String(x || '').slice(0, 4000))));
      const text = String(b.text || '').slice(0, 4000);
      if (parts[1] === 'check') return send(res, 200, checkText(text));
      if (parts[1] === 'fix') {
        if (!env('ANTHROPIC_API_KEY')) throw httpErr(400, 'לתיקון אוטומטי נדרש מפתח AI בהגדרות');
        if (limited('ai:' + user.email, 30, 3600e3)) throw httpErr(429, 'חריגה ממכסת AI לשעה');
        return send(res, 200, await runAi(store, user, ws, 'fix', { text }));
      }
    }

    if (parts[0] === 'sync' && method === 'POST') {
      if (limited('sync:' + user.email, 10, 3600e3)) throw httpErr(429, 'יותר מדי סנכרונים, נסו שוב מאוחר יותר');
      if (!connectors().facebook) throw httpErr(400, 'חברו קודם את פייסבוק בהגדרות');
      return send(res, 200, await syncMetrics(store, Date.now(), true));
    }

    if (parts[0] === 'leads' && parts[1] && parts[2] === 'contacted' && method === 'POST') {
      const l = await store.get('leads', parts[1]); if (!l) throw httpErr(404, 'לא נמצא');
      const seq = (l.seq || 0) + 1, gap = FOLLOW_STEPS[seq];
      const advanced = await store.put('leads', l.id, { ...l, seq, next: gap ? addDays(israelDate(), gap) : '', remindedOn: '', stage: l.stage === 'חדש' ? 'בטיפול' : l.stage });
      await logEvent(store, user, 'leads.contacted', { id: l.id, label: labelOf(l) });
      return send(res, 200, advanced);
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
      await logEvent(store, user, 'plan.tick', { label: String(key), done: !!done });
      return send(res, 200, { done: d });
    }

    if (parts[0] === 'settings') {
      if (user.role !== 'admin') throw httpErr(403, 'למנהלים בלבד');
      if (method === 'GET' && !parts[1]) return send(res, 200, { groups: describeSettings(), encrypted: !!process.env.SETTINGS_KEY });
      if (method === 'PUT' && !parts[1]) {
        const b = await readBody(req);
        ctx().overrides = await saveSettings(store, ws, b.values && typeof b.values === 'object' ? b.values : {}, b.clear);
        await logEvent(store, user, 'settings.update', { fields: [...Object.entries(b.values && typeof b.values === 'object' ? b.values : {}).filter(([, v]) => String(v || '').trim()).map(([k]) => k), ...(Array.isArray(b.clear) ? b.clear.map(k => `-${k}`) : [])] });
        return send(res, 200, { groups: describeSettings() });
      }
      if (method === 'POST' && parts[1] === 'test') {
        if (limited('test:' + user.email, 20, 3600e3)) throw httpErr(429, 'יותר מדי בדיקות, נסו שוב מאוחר יותר');
        const { service } = await readBody(req);
        if (!['ai', 'image', 'facebook', 'telegram', 'webhook', 'email'].includes(service)) throw httpErr(400, 'שירות לא מוכר');
        try { return send(res, 200, { ok: true, detail: await testService(service) }); }
        catch (e) { return send(res, 200, { ok: false, detail: String(e.message).slice(0, 300) }); }
      }
    }

    if (parts[0] === 'jobs' && parts[1] && method === 'GET') {
      const j = /^[a-f0-9]{24}$/.test(parts[1]) ? await base.get('jobs', parts[1]) : null;
      if (!j || j.ws !== ws || (j.user !== user.email && user.role !== 'admin')) throw httpErr(404, 'לא נמצא');
      return send(res, 200, { status: j.status, ...(j.status === 'done' ? { result: j.result } : {}), ...(j.status === 'error' ? { error: j.error } : {}) });
    }

    if (parts[0] === 'guide') {
      const sub = parts[1];
      const rec = async email => (await base.get('academy', email)) || {};
      const trackOf = (u, r) => (TRACKS[r.track] ? r.track : u.role === 'admin' ? 'chief' : 'basic');
      if (sub === 'content' && method === 'GET') return send(res, 200, publicContent());
      if (sub === 'me' && method === 'GET') { const r = await rec(user.email); return send(res, 200, { track: trackOf(user, r), done: r.done || {}, seenRelease: r.seenRelease || '' }); }
      if (sub === 'progress' && method === 'POST') {
        const { lesson, score } = await readBody(req);
        if (!LESSONS[lesson]) throw httpErr(400, 'שיעור לא מוכר');
        const r = await rec(user.email), sc = Math.max(0, Math.min(100, Math.round(+score || 0)));
        const done = { ...(r.done || {}), [lesson]: { at: new Date().toISOString(), score: sc } };
        await base.put('academy', user.email, { ...r, done, lastActive: new Date().toISOString() });
        await logEvent(store, user, 'academy.lesson', { label: LESSONS[lesson].title, score: sc });
        return send(res, 200, { done });
      }
      if (sub === 'seen' && method === 'POST') { const r = await rec(user.email); await base.put('academy', user.email, { ...r, seenRelease: RELEASES[0].id }); return send(res, 200, { seenRelease: RELEASES[0].id }); }
      if (sub === 'team' && method === 'GET') {
        if (user.role !== 'admin') throw httpErr(403, 'למנהלים בלבד');
        return send(res, 200, await Promise.all((await base.listUsers()).map(async u => {
          const r = await rec(u.email), tr = trackOf(u, r), ids = TRACKS[tr].lessons, done = ids.filter(id => r.done?.[id]);
          return { email: u.email, name: u.name, role: u.role, track: tr, trackName: TRACKS[tr].name, total: ids.length, done: done.length, avgScore: done.length ? Math.round(done.reduce((s, id) => s + (r.done[id].score || 0), 0) / done.length) : 0, lastActive: r.lastActive || '', lessons: Object.fromEntries(ids.map(id => [id, r.done?.[id]?.score ?? null])) };
        })));
      }
      if (sub === 'track' && method === 'PUT') {
        if (user.role !== 'admin') throw httpErr(403, 'למנהלים בלבד');
        const { email, track } = await readBody(req);
        if (!TRACKS[track]) throw httpErr(400, 'מסלול לא מוכר');
        if (!(await base.getUser(String(email || '').toLowerCase()))) throw httpErr(404, 'משתמש לא נמצא');
        const r = await rec(String(email).toLowerCase());
        await base.put('academy', String(email).toLowerCase(), { ...r, track });
        return send(res, 200, { ok: true });
      }
      if (sub === 'activity' && method === 'GET') {
        const n = Math.max(1, Math.min(200, +url.searchParams.get('limit') || 60));
        return send(res, 200, (await recentEvents(store, n)).map(e => ({ id: e.id, type: e.type, by: e.name || e.by, at: e.at, text: describeEvent(e) })));
      }
      if (sub === 'knowledge') {
        if (method === 'GET') {
          const all = await store.list('knowledge');
          const pb = all.find(k => k.id === 'playbook');
          return send(res, 200, { playbook: pb ? { body: pb.body, updated: pb.updated, ai: !!pb.ai, by: pb.by } : null, items: all.filter(k => k.id !== 'playbook').sort((a, c) => (a.id < c.id ? 1 : -1)).slice(0, 100) });
        }
        if (method === 'POST') {
          const b = await readBody(req);
          const type = ['need', 'decision', 'note'].includes(b.type) ? b.type : 'note';
          const title = String(b.title || '').trim().slice(0, 120), body = String(b.body || '').trim().slice(0, 1500);
          if (title.length < 3) throw httpErr(400, 'כתבו כותרת קצרה');
          const item = await store.put('knowledge', `${String(Date.now()).padStart(13, '0')}-${crypto.randomBytes(3).toString('hex')}`, { type, title, body, by: user.name || user.email, byEmail: user.email, at: new Date().toISOString(), related: searchLessons(`${title} ${body}`, 3) });
          await logEvent(store, user, 'knowledge.add', { kind: type, label: title });
          return send(res, 201, item);
        }
        if (method === 'DELETE' && parts[2] && parts[2] !== 'playbook') {
          const it = await store.get('knowledge', parts[2]);
          if (!it) throw httpErr(404, 'לא נמצא');
          if (user.role !== 'admin' && it.byEmail !== user.email) throw httpErr(403, 'אפשר למחוק רק פריטים שכתבתם');
          await store.del('knowledge', parts[2]);
          return send(res, 200, { ok: true });
        }
      }
      if (sub === 'learn' && method === 'POST') { if (env('ANTHROPIC_API_KEY')) { if (limited('ai:' + user.email, 30, 3600e3)) throw httpErr(429, 'חריגה ממכסת AI לשעה'); } return send(res, 200, await runAi(store, user, ws, 'learn', {})); }
      if (sub === 'ask' && method === 'POST') { if (env('ANTHROPIC_API_KEY')) { if (limited('ai:' + user.email, 30, 3600e3)) throw httpErr(429, 'חריגה ממכסת AI לשעה'); } return send(res, 200, await runAi(store, user, ws, 'ask', await readBody(req))); }
      if (sub === 'manual' && method === 'GET') {
        const pb = (await store.list('knowledge')).find(k => k.id === 'playbook');
        const needs = (await store.list('knowledge')).filter(k => k.id !== 'playbook').sort((a, c) => (a.id < c.id ? 1 : -1)).slice(0, 30);
        const c = connectors();
        const extra = `\n## התצורה הנוכחית (נוצר ב-${new Date().toLocaleDateString('he-IL')})\n\n- בינה מלאכותית: ${env('ANTHROPIC_API_KEY') ? 'מחוברת' : 'לא מחוברת'}\n- יצירת תמונות: ${c.image ? 'מחוברת' : 'לא מחוברת'}\n- פייסבוק: ${c.facebook ? 'מחובר' : 'לא מחובר'} · טלגרם: ${c.telegram ? 'מחובר לפרסום' : 'לא מחובר'}${c.tgNotify ? ' · התראות פרטיות פעילות' : ''} · Webhook: ${c.webhook ? 'מחובר' : 'לא מחובר'} · אימייל: ${c.email ? 'מחובר' : 'לא מחובר'}\n- סביבות עבודה: ${(await listWorkspaces()).map(w => w.name).join(', ')}\n${pb ? `\n## ספר הידע החי\n\n${pb.body}\n` : ''}${needs.length ? `\n## צרכים והחלטות\n\n${needs.map(n => `- **${n.type === 'decision' ? 'החלטה' : n.type === 'need' ? 'צורך' : 'הערה'}** (${n.by}, ${String(n.at).slice(0, 10)}): ${n.title}${n.body ? ` — ${n.body}` : ''}`).join('\n')}\n` : ''}`;
        res.writeHead(200, { 'content-type': 'text/markdown; charset=utf-8', 'content-disposition': 'attachment; filename="user-manual.md"', 'x-content-type-options': 'nosniff' });
        return res.end(manualMarkdown(extra));
      }
    }

    const aiLimit = () => { if (limited('ai:' + user.email, 30, 3600e3)) throw httpErr(429, 'חריגה ממכסת AI לשעה'); };
    if (parts[0] === 'insights' && method === 'POST') {
      const { ai } = await readBody(req);
      if (ai && env('ANTHROPIC_API_KEY')) { aiLimit(); return send(res, 200, await runAi(store, user, ws, 'insights', {})); }
      return send(res, 200, { ai: false, insights: ruleInsights(await computeStats(store)) });
    }

    if (parts[0] === 'ai' && method === 'POST') {
      aiLimit();
      const b = await readBody(req);
      if (parts[1] === 'quick-campaign' && String(b.idea || '').trim().length < 3) throw httpErr(400, 'ספרו במשפט אחד מה רוצים לקדם');
      if (parts[1] === 'plan' && !(await store.get('campaigns', String(b.campaign || '')))) throw httpErr(404, 'קמפיין לא נמצא');
      if (parts[1] === 'improve' && !env('ANTHROPIC_API_KEY')) throw httpErr(400, 'לשדרוג עם AI חברו מפתח בהגדרות ← בינה מלאכותית');
      if (['banner-copy', 'image-prompt'].includes(parts[1]) && !env('ANTHROPIC_API_KEY')) throw httpErr(400, 'חברו מפתח AI בהגדרות ← בינה מלאכותית');
      if (parts[1] === 'image') {
        if (!env('OPENAI_API_KEY')) throw httpErr(400, 'ליצירת תמונות חברו מפתח OpenAI בהגדרות ← יצירת תמונות');
        if (limited('img:' + user.email, 12, 3600e3)) throw httpErr(429, 'חריגה ממכסת יצירת תמונות לשעה');
      }
      if (['generate', 'quick-campaign', 'plan', 'improve', 'banner-copy', 'image-prompt', 'image'].includes(parts[1])) return send(res, 200, await runAi(store, user, ws, parts[1], b));
    }

    if (parts[0] === 'campaigns' && parts[1] === 'order' && method === 'POST') {
      const { items } = await readBody(req);
      if (!Array.isArray(items) || items.length > 500) throw httpErr(400, 'בקשה לא תקינה');
      const STATUSES = ['פעיל', 'מושהה', 'הסתיים'];
      let n = 0;
      for (const it of items) {
        const c = await store.get('campaigns', String(it?.id || '')); if (!c) continue;
        await store.put('campaigns', c.id, { ...c, order: ++n * 10, ...(STATUSES.includes(it.status) ? { status: it.status } : {}) });
      }
      await logEvent(store, user, 'campaigns.reorder', { count: n });
      return send(res, 200, { ok: true, updated: n });
    }

    if (parts[0] === 'patients') {
      const id = parts[1], sub = parts[2], today = israelDate();
      const need = async () => { const pt = /^[a-f0-9]{12}$/.test(id || '') ? await store.get('patients', id) : null; if (!pt) throw httpErr(404, 'לא נמצא'); return pt; };
      const pub = ({ token, ...rest }) => ({ ...rest, hasLink: !!token });
      if (!id && method === 'GET') {
        const all = await store.list('care'), by = new Map();
        for (const e of all) (by.get(e.patient) || by.set(e.patient, []).get(e.patient)).push(e);
        return send(res, 200, (await store.list('patients')).map(pt => {
          const es = (by.get(pt.id) || []).sort((a, b) => b.at.localeCompare(a.at)), ws_ = es.filter(e => e.weight != null);
          return { ...pub(pt), lastAt: es[0]?.at || '', lastWeight: ws_[0]?.weight ?? null, firstWeight: ws_.length > 1 ? ws_[ws_.length - 1].weight : null,
            open: es.filter(e => e.type === 'question' && !e.answered).length, due: !!(pt.next && pt.next <= today && pt.status === 'פעיל') };
        }).sort((a, b) => (b.open - a.open) || (+b.due - +a.due) || a.name.localeCompare(b.name, 'he')));
      }
      if (!id && method === 'POST') {
        const created = await store.put('patients', uid(), { ...cleanPatient(await readBody(req)), status: 'פעיל', created: today, token: '' });
        await logEvent(store, user, 'patients.create', {});
        return send(res, 201, pub(created));
      }
      if (id && !sub && method === 'GET') { const pt = await need(); return send(res, 200, { patient: pub(pt), entries: await careEntries(store, id) }); }
      if (id && !sub && method === 'PUT') {
        const pt = await need(), b = await readBody(req);
        const upd = await store.put('patients', id, cleanPatient(b, pt));
        await logEvent(store, user, 'patients.update', {});
        return send(res, 200, pub(upd));
      }
      if (id && !sub && method === 'DELETE') {
        await need();
        for (const e of await careEntries(store, id)) await store.del('care', e.id);
        await store.del('patients', id);
        await logEvent(store, user, 'patients.delete', {});
        return send(res, 200, { ok: true });
      }
      if (id && sub === 'entries' && method === 'POST') {
        await need();
        const b = await readBody(req), type = ['measure', 'note', 'reply'].includes(b.type) ? b.type : 'note';
        const extra = type === 'note' ? { visible: 0 } : {};
        if (type === 'reply' && b.replyTo) {
          const q = await store.get('care', String(b.replyTo));
          if (q && q.patient === id && q.type === 'question') await store.put('care', q.id, { ...q, answered: 1 });
        }
        const e = await addEntry(store, id, 'staff', type, b, extra);
        await logEvent(store, user, 'care.entry', { kind: type });
        return send(res, 201, e);
      }
      if (id && sub === 'link' && method === 'POST') {
        const pt = await need(), b = await readBody(req);
        if (b.revoke) { await store.put('patients', id, { ...pt, token: '' }); await logEvent(store, user, 'care.link', { revoked: 1 }); return send(res, 200, { ok: true }); }
        if (!pt.consent) throw httpErr(400, 'צריך קודם לסמן שהמטופל/ת אישר/ה שימוש בפורטל ואיסוף מידע');
        const token = (!pt.token || b.rotate) ? crypto.randomBytes(16).toString('hex') : pt.token;
        if (token !== pt.token) await store.put('patients', id, { ...pt, token });
        await logEvent(store, user, 'care.link', {});
        return send(res, 200, { path: `/care/?w=${encodeURIComponent(ws)}&p=${id}&t=${token}` });
      }
      throw httpErr(404, 'Not found');
    }

    if (SCHEMA[parts[0]]) {
      const kind = parts[0], id = parts[1];
      const guard = b => { if (kind === 'leads' && b.next && !/^\d{4}-\d{2}-\d{2}$/.test(String(b.next))) throw httpErr(400, 'תאריך לא תקין'); return b; };
      if (method === 'POST' && !id) {
        const defaults = { campaigns: { status: 'פעיל', spent: 0, order: Date.now(), channels: [] }, posts: { status: 'מתוזמן' }, leads: { stage: 'חדש', created: new Date().toISOString().slice(0, 10) } }[kind];
        const created = await store.put(kind, uid(), pick(kind, guard(await readBody(req)), defaults));
        await logEvent(store, user, `${kind}.create`, { id: created.id, label: labelOf(created), channel: created.channel });
        return send(res, 201, created);
      }
      if (id && method === 'PUT') {
        const cur = await store.get(kind, id); if (!cur) throw httpErr(404, 'לא נמצא');
        const body = guard(await readBody(req));
        const updated = await store.put(kind, id, pick(kind, body, cur));
        await logEvent(store, user, `${kind}.update`, { id, label: labelOf(updated), fields: Object.keys(body).filter(k => k in SCHEMA[kind]), ...(body.status ? { status: body.status } : {}), ...(body.stage ? { stage: body.stage } : {}) });
        return send(res, 200, updated);
      }
      if (id && method === 'DELETE') {
        const cur = await store.get(kind, id);
        await store.del(kind, id);
        await logEvent(store, user, `${kind}.delete`, { id, label: labelOf(cur) });
        if (cur?.image && !(await store.list('posts')).some(p => p.image === cur.image)) await base.del('media', cur.image);
        return send(res, 200, { ok: true });
      }
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
      const host = req.headers['x-forwarded-host'] || req.headers.host;
      // Only trust the Host of authenticated team members when deriving public image URLs (SITE_URL / Netlify's URL win).
      if (user && host && /^[\w.:-]+$/.test(host)) lastOrigin = `${req.headers['x-forwarded-proto'] || (/^(localhost|127\.)/.test(host) ? 'http' : 'https')}://${host}`;
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
  return { handle, tick, ensureAdmin, runJob };
}
