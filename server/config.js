// Runtime configuration: values entered in the app's Settings screen (stored in the database)
// override environment variables, so integrations can be set up without touching hosting settings.
import crypto from 'node:crypto';
import { AsyncLocalStorage } from 'node:async_hooks';

// Each request/tick runs inside a workspace context { ws, overrides }, so one deployment can serve
// several clients (agency mode) without mixing their integrations or data.
const als = new AsyncLocalStorage();
export const runWith = (context, fn) => als.run(context, fn);
export const ctx = () => als.getStore();
// Workspaces other than "main" never inherit integration keys from the environment (so a client can
// never publish to another client's page); only the AI key is shared with the agency.
const SHARED_FALLBACK = new Set(['ANTHROPIC_API_KEY', 'AI_MODEL', 'OPENAI_API_KEY', 'IMAGE_MODEL']);
export const env = k => {
  const c = als.getStore();
  if (c && c.ws !== 'main' && FIELDS.has(k) && !SHARED_FALLBACK.has(k)) return c.overrides?.[k] || '';
  return (c?.overrides?.[k] || process.env[k]) || '';
};

const yesNo = [['on', 'פעיל'], ['off', 'כבוי']];
export const GROUPS = [
  { id: 'ai', title: '✨ בינה מלאכותית', desc: 'כתיבת קמפיינים ופוסטים, ותובנות מעמיקות.', test: 'ai', required: ['ANTHROPIC_API_KEY'],
    help: 'מפתח מ-console.anthropic.com ← API Keys ← Create Key.',
    fields: [
      { key: 'ANTHROPIC_API_KEY', label: 'מפתח API', secret: true, placeholder: 'sk-ant-…' },
      { key: 'AI_MODEL', label: 'מודל (אופציונלי)', placeholder: 'claude-sonnet-5-5' }
    ] },
  { id: 'image', title: '🎨 יצירת תמונות עם AI', desc: 'רקעים ותמונות לפוסטים ולבאנרים. המעצב של הבאנרים עובד גם בלי מפתח. יצירת תמונות בתשלום לפי שימוש אצל הספק.', test: 'image', required: ['OPENAI_API_KEY'],
    help: 'מפתח מ-platform.openai.com ← API keys. ייתכן שיידרש אימות ארגון לפני שימוש במודל התמונות.',
    fields: [
      { key: 'OPENAI_API_KEY', label: 'מפתח OpenAI', secret: true, placeholder: 'sk-…' },
      { key: 'IMAGE_MODEL', label: 'מודל תמונות (אופציונלי)', placeholder: 'gpt-image-1' }
    ] },
  { id: 'business', title: '🏢 על העסק', desc: 'ה-AI ישתמש בזה כדי לכתוב בקול של העסק שלכם.', required: [],
    fields: [{ key: 'BUSINESS_PROFILE', label: 'תיאור קצר של העסק', type: 'textarea', placeholder: 'מי אתם, מה אתם מציעים, באיזה טון לדבר, מה אסור לומר' },
      { key: 'CONTACT_PHONE', label: 'טלפון להצגה למטופלים בפורטל (אופציונלי)', placeholder: '052-318-6262' }] },
  { id: 'facebook', title: '📘 פייסבוק', desc: 'פרסום אוטומטי לדף העסקי.', test: 'facebook', required: ['FB_PAGE_ID', 'FB_PAGE_TOKEN'],
    help: 'ב-developers.facebook.com ← Graph API Explorer ← הרשאות pages_manage_posts ו-pages_show_list ← טוקן דף.',
    fields: [
      { key: 'FB_PAGE_ID', label: 'מזהה הדף (Page ID)' },
      { key: 'FB_PAGE_TOKEN', label: 'טוקן הדף', secret: true },
      { key: 'FB_ADS_TOKEN', label: 'טוקן לנתוני קידום ממומן (אופציונלי)', secret: true }
    ] },
  { id: 'telegram', title: '✈️ טלגרם', desc: 'פרסום לערוץ או לקבוצה, והתראות פרטיות אליכם על לידים.', test: 'telegram', required: ['TG_BOT_TOKEN'], needAny: ['TG_CHAT_ID', 'TG_NOTIFY_CHAT_ID'],
    help: 'ב-BotFather יוצרים בוט (/newbot) ומעתיקים את הטוקן. לפרסום: מוסיפים את הבוט כמנהל בערוץ, ומזינים @שם_הערוץ (ערוץ ציבורי) או מספר שיחה. להתראות: שולחים לבוט הודעה בצ׳אט פרטי, ומזינים את מספר הצ׳אט שלכם. פרטיות: התראות על לידים כוללות שמות וטלפונים, ולכן אף פעם לא נשלחות לערוץ הפרסום.',
    fields: [
      { key: 'TG_BOT_TOKEN', label: 'טוקן הבוט', secret: true },
      { key: 'TG_CHAT_ID', label: 'ערוץ/קבוצה לפרסום (@שם_הערוץ או מספר)', placeholder: '@my_channel' },
      { key: 'TG_NOTIFY_CHAT_ID', label: 'צ׳אט פרטי להתראות על לידים (מספר)', placeholder: '123456789' }
    ] },
  { id: 'webhook', title: '🔗 Webhook (Make / Zapier)', desc: 'אינסטגרם, לינקדאין, טיקטוק, וואטסאפ ועוד, דרך אוטומציה חיצונית.', test: 'webhook', required: ['PUBLISH_WEBHOOK_URL'],
    help: 'ב-Make או ב-Zapier יוצרים תרחיש עם Webhook, ומדביקים את הכתובת שלו.',
    fields: [{ key: 'PUBLISH_WEBHOOK_URL', label: 'כתובת Webhook', secret: true, placeholder: 'https://hook.make.com/…' }] },
  { id: 'email', title: '✉️ אימייל ותגובה אוטומטית', desc: 'מענה אוטומטי ללידים, והתראות אליכם במייל.', test: 'email', required: ['RESEND_API_KEY', 'EMAIL_FROM'],
    help: 'חשבון חינמי ב-resend.com ← API Keys. כתובת השולח צריכה להיות מדומיין שאימתתם שם.',
    fields: [
      { key: 'RESEND_API_KEY', label: 'מפתח Resend', secret: true, placeholder: 're_…' },
      { key: 'EMAIL_FROM', label: 'כתובת השולח', placeholder: 'TizonHealth <hello@yourdomain.com>' },
      { key: 'OWNER_EMAIL', label: 'האימייל שלכם לקבלת התראות', placeholder: 'you@example.com' },
      { key: 'AUTO_REPLY', label: 'תגובה אוטומטית לליד חדש', type: 'select', options: yesNo, default: 'off' },
      { key: 'AUTO_REPLY_TEXT', label: 'נוסח התגובה (אופציונלי)', type: 'textarea', placeholder: 'שלום, תודה שפניתם אלינו! נחזור אליכם בהקדם.' }
    ] },
  { id: 'general', title: '⚙️ כללי', desc: '', required: [],
    fields: [
      { key: 'WEEKLY_DIGEST', label: 'סיכום שבועי אליכם (טלגרם או אימייל)', type: 'select', options: yesNo, default: 'on' },
      { key: 'COMPLIANCE', label: 'בדיקת תאימות לפני פרסום (עוצרת ניסוחים רפואיים בעייתיים)', type: 'select', options: yesNo, default: 'on' },
      { key: 'FOLLOWUP', label: 'תזכורות מעקב ללידים (יום 1, 3, 7)', type: 'select', options: yesNo, default: 'on' },
      { key: 'AUTO_APPROVE', label: 'פוסטים שה-AI יוצר מתפרסמים בלי אישור', type: 'select', options: [['false', 'לא, לאשר ידנית'], ['true', 'כן, אוטומטית']], default: 'false' }
    ] }
];

const FIELDS = new Map(GROUPS.flatMap(g => g.fields.map(f => [f.key, f])));
const SECRETS = new Set([...FIELDS.values()].filter(f => f.secret).map(f => f.key));

// Optional encryption at rest for secrets: set SETTINGS_KEY (any long random string) in the environment.
const encKey = () => process.env.SETTINGS_KEY ? crypto.createHash('sha256').update(process.env.SETTINGS_KEY).digest() : null;
function seal(v) {
  const k = encKey(); if (!k) return v;
  const iv = crypto.randomBytes(12), c = crypto.createCipheriv('aes-256-gcm', k, iv);
  const ct = Buffer.concat([c.update(v, 'utf8'), c.final()]);
  return 'enc:' + Buffer.concat([iv, c.getAuthTag(), ct]).toString('base64');
}
function unseal(v) {
  if (!v.startsWith('enc:')) return v;
  const k = encKey(); if (!k) return '';
  try {
    const b = Buffer.from(v.slice(4), 'base64'), d = crypto.createDecipheriv('aes-256-gcm', k, b.subarray(0, 12));
    d.setAuthTag(b.subarray(12, 28));
    return Buffer.concat([d.update(b.subarray(28)), d.final()]).toString('utf8');
  } catch { return ''; }
}

const cache = new Map(); // workspace -> { at, values }
export async function loadSettings(store, ws = 'main', force = false) {
  const hit = cache.get(ws);
  if (!force && hit && Date.now() - hit.at < 15e3) return hit.values;
  let vals = hit?.values || {};
  try {
    const rec = await store.get('settings', 'main');
    vals = {};
    for (const [k, v] of Object.entries(rec?.values || {})) if (FIELDS.has(k) && typeof v === 'string') vals[k] = SECRETS.has(k) ? unseal(v) : v;
  } catch (e) { console.error('loadSettings:', e.message); }
  cache.set(ws, { at: Date.now(), values: vals });
  return vals;
}

const bad = m => Object.assign(new Error(m), { status: 400 });
function validate(key, v) {
  const f = FIELDS.get(key);
  if (f.type === 'select' && !f.options.some(([o]) => o === v)) throw bad(`ערך לא תקין עבור ${f.label}`);
  if (key === 'PUBLISH_WEBHOOK_URL' && !/^https?:\/\/\S+$/.test(v)) throw bad('כתובת ה-Webhook חייבת להתחיל ב-https://');
  if (key === 'OWNER_EMAIL' && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v)) throw bad('אימייל לא תקין');
  if (key === 'FB_PAGE_ID' && !/^\d{5,25}$/.test(v)) throw bad('Page ID הוא מספר בלבד');
  if (/[\r\n]/.test(v) && f.type !== 'textarea') throw bad(`ערך לא תקין עבור ${f.label}`);
}

export async function saveSettings(store, ws, patch = {}, clear = []) {
  const rec = (await store.get('settings', 'main')) || {};
  const values = { ...(rec.values || {}) };
  for (const [k, raw] of Object.entries(patch)) {
    if (!FIELDS.has(k) || typeof raw !== 'string') continue;
    const v = raw.trim().slice(0, 2000);
    if (v === '') { if (!SECRETS.has(k)) delete values[k]; continue; } // empty secret = keep current
    validate(k, v);
    values[k] = SECRETS.has(k) ? seal(v) : v;
  }
  for (const k of Array.isArray(clear) ? clear : []) if (FIELDS.has(k)) delete values[k];
  await store.put('settings', 'main', { ...rec, id: undefined, values, updated: new Date().toISOString() });
  return loadSettings(store, ws, true);
}

export async function getMeta(store) { return (await store.get('settings', 'main'))?.meta || {}; }
export async function setMeta(store, patch) {
  const rec = (await store.get('settings', 'main')) || { values: {} };
  await store.put('settings', 'main', { ...rec, id: undefined, meta: { ...(rec.meta || {}), ...patch } });
}

// What the UI may see: never secret values, only whether they are set (+ last 4 characters).
export function describeSettings() {
  return GROUPS.map(g => ({
    id: g.id, title: g.title, desc: g.desc, help: g.help, test: g.test,
    connected: g.required.length > 0 && g.required.every(k => !!env(k)) && (!g.needAny || g.needAny.some(k => !!env(k))),
    fields: g.fields.map(f => {
      const v = env(f.key), secret = !!f.secret;
      return {
        key: f.key, label: f.label, type: f.type || 'text', secret, placeholder: f.placeholder, options: f.options,
        set: !!v, source: ctx()?.overrides?.[f.key] ? 'settings' : (v ? 'env' : ''),
        hint: secret && v ? '••••' + v.slice(-4) : undefined,
        value: secret ? undefined : (v || f.default || '')
      };
    })
  }));
}
