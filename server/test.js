import http from 'node:http';
import os from 'node:os';
import fs from 'node:fs';
import path from 'node:path';
import assert from 'node:assert/strict';

const received = [];
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c);
  req.on('end', () => { received.push(JSON.parse(b)); res.end('{}'); });
});
await new Promise(r => mock.listen(0, r));

const mock2log = [];
const mock2 = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c);
  req.on('end', () => {
    let body; try { body = b ? JSON.parse(b) : {}; } catch { body = { multipart: /multipart/.test(req.headers['content-type'] || ''), raw: b.slice(0, 2000) }; }
    mock2log.push({ path: req.url, method: req.method, body, auth: req.headers.authorization || req.headers['x-api-key'] || '' });
    res.setHeader('content-type', 'application/json');
    if (req.url.startsWith('/fb/')) {
      if (req.url.includes('/photos')) return res.end(JSON.stringify({ id: 'img1', post_id: 'PAGE_123' }));
      if (req.url.includes('/feed')) return res.end(JSON.stringify({ id: 'PAGE_555' }));
      if (req.url.includes('/insights')) return res.end(JSON.stringify({ data: [{ spend: '123.45', impressions: '1000', clicks: '50' }] }));
      if (req.url.includes('fan_count')) return res.end(JSON.stringify({ fan_count: 321 }));
      if (req.url.includes('reactions')) return res.end(JSON.stringify({ reactions: { summary: { total_count: 7 } }, comments: { summary: { total_count: 2 } }, shares: { count: 1 } }));
    }
    if (req.url === '/openai/images/generations') {
      const big = String(body.prompt || '').includes('BIGIMAGE');
      return res.end(JSON.stringify({ data: [{ b64_json: big ? Buffer.concat([Buffer.from([0xff, 0xd8, 0xff]), Buffer.alloc(800e3)]).toString('base64') : '/9j/4AAQSkZJRgABAQAAAQABAAD/2wBDAAgGBgcGBQgHBwcJCQgKDBQNDAsLDBkSEw8UHRofHh0aHBwgJC4nICIsIxwcKDcpLDAxNDQ0Hyc5PTgyPC4zNDL/2wBDAQkJCQwLDBgNDRgyIRwhMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjIyMjL/wAARCAAIAAgDASIAAhEBAxEB/8QAHwAAAQUBAQEBAQEAAAAAAAAAAAECAwQFBgcICQoL/8QAtRAAAgEDAwIEAwUFBAQAAAF9AQIDAAQRBRIhMUEGE1FhByJxFDKBkaEII0KxwRVS0fAkM2JyggkKFhcYGRolJicoKSo0NTY3ODk6Q0RFRkdISUpTVFVWV1hZWmNkZWZnaGlqc3R1dnd4eXqDhIWGh4iJipKTlJWWl5iZmqKjpKWmp6ipqrKztLW2t7i5usLDxMXGx8jJytLT1NXW19jZ2uHi4+Tl5ufo6erx8vP09fb3+Pn6/8QAHwEAAwEBAQEBAQEBAQAAAAAAAAECAwQFBgcICQoL/8QAtREAAgECBAQDBAcFBAQAAQJ3AAECAxEEBSExBhJBUQdhcRMiMoEIFEKRobHBCSMzUvAVYnLRChYkNOEl8RcYGRomJygpKjU2Nzg5OkNERUZHSElKU1RVVldYWVpjZGVmZ2hpanN0dXZ3eHl6goOEhYaHiImKkpOUlZaXmJmaoqOkpaanqKmqsrO0tba3uLm6wsPExcbHyMnK0tPU1dbX2Nna4uPk5ebn6Onq8vP09fb3+Pn6/9oADAMBAAIRAxEAPwDnKKKK8Q9E/9k=' }] }));
    }
    if (req.url === '/openai/models') return res.end(JSON.stringify({ data: [{ id: 'gpt-image-1' }] }));
    if (req.url === '/anthropic-bad') { res.statusCode = 401; return res.end(JSON.stringify({ type: 'error', error: { type: 'authentication_error', message: 'invalid x-api-key' } })); }
    if (req.url === '/anthropic') {
      const prompt = body.messages?.[0]?.content || '';
      const text = prompt.includes('ספר פעולה חי') ? '# ספר הפעולה שלנו\n## איך אנחנו עובדים\nעובדים לפי תוכנית שבועית, מפרסמים בפייסבוק ובטלגרם, ומודדים כל שבוע את עלות הליד. ## מה כדאי לעשות עכשיו: להמשיך.'
        : prompt.includes('המדריך של מערכת השיווק') ? 'לחצו על הסטודיו ובחרו גודל. [[lesson:banner-studio]]'
        : prompt.includes('כותרות לבאנר') ? JSON.stringify([{ headline: 'כותרת א', sub: 'שורה א', cta: 'התקשרו' }, { headline: 'המוצר מרפא', sub: '', cta: 'עכשיו' }, { headline: 'כותרת ג', sub: '', cta: '' }])
        : prompt.includes('Write ONE short English prompt') ? 'calm wellness background, soft light'
        : prompt.includes('ההנחיה של המשתמש') ? (prompt.includes('כתוב שזה מרפא') ? 'המוצר מרפא הכול' : 'טקסט משודרג')
        : prompt.includes('"posts"') ? JSON.stringify({ name: 'קמפיין AI', goal: 'מכירות', audience: 'קהל', message: 'מסר', posts: [{ day: 0, channel: 'Facebook', text: 'פוסט א' }, { day: 3, channel: 'Nope', text: 'פוסט ב' }] })
        : prompt.includes('תובנות') ? '- להגדיל את הקמפיין הטוב\n- לעצור את החלש' : 'שלום';
      return res.end(JSON.stringify({ content: [{ type: 'text', text }] }));
    }
    res.end('{}');
  });
});
await new Promise(r => mock2.listen(0, r));
const m2 = `http://127.0.0.1:${mock2.address().port}`;
process.env.ANTHROPIC_API_URL = m2 + '/anthropic';
process.env.RESEND_API_URL = m2 + '/emails';
process.env.TELEGRAM_API_URL = m2 + '/tg';
process.env.FACEBOOK_API_URL = m2 + '/fb';
process.env.OPENAI_BASE_URL = m2 + '/openai';

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tizon-'));
process.env.ADMIN_EMAIL = 'a@b.co';
process.env.ADMIN_PASSWORD = 'password123';
process.env.PUBLISH_WEBHOOK_URL = `http://127.0.0.1:${mock.address().port}/hook`;
const { server, tick } = await import('./server.js');
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

let token = '';
const call = async (method, p, body, hdr = {}) => {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', 'x-requested-with': 'tizon', ...(token && { authorization: 'Bearer ' + token }), ...hdr }, body: body && JSON.stringify(body) });
  const data = await r.json().catch(() => null);
  if (data?.token) token = data.token;
  return { status: r.status, data };
};

assert.equal((await call('GET', '/api/state')).status, 401, 'state requires login');
assert.equal((await call('POST', '/api/login', { email: 'a@b.co', password: 'bad' })).status, 401);
assert.equal((await call('POST', '/api/login', { email: 'a@b.co', password: 'password123' })).status, 200);
assert.equal((await call('POST', '/api/posts', {}, { 'x-requested-with': '' })).status, 403, 'CSRF header required');

const c = (await call('POST', '/api/campaigns', { name: 'T', channels: ['Facebook'], budget: 100 })).data;
assert.equal(c.status, 'פעיל');
const p = (await call('POST', '/api/posts', { campaign: c.id, channel: 'Instagram', text: 'hello', at: new Date(Date.now() - 1000).toISOString() })).data;
await tick();
let state = (await call('GET', '/api/state')).data;
assert.equal(state.posts[0].status, 'פורסם', 'due post published via webhook');
assert.equal(received.find(r => r.event === 'post.publish').text, 'hello');

const lead = await fetch(base + '/api/public/lead', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'דני', phone: '050', message: 'שלום' }) });
assert.equal(lead.status, 200);
state = (await call('GET', '/api/state')).data;
assert.equal(state.leads.length, 1);
assert.ok(received.some(r => r.event === 'lead.created'), 'lead notification sent');
assert.equal((await fetch(base + '/api/public/lead', { method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"name":"x"}' })).status, 400);

assert.equal((await fetch(base + '/server/server.js')).status, 404, 'server source not served');
assert.equal((await fetch(base + '/app/index.html')).status, 200);
assert.equal((await fetch(base + '/%2e%2e/package.json')).status, 404);


// quick campaign (no AI key configured -> built-in template cadence)
const qc = await call('POST', '/api/ai/quick-campaign', { idea: 'ייעוץ בריאות אישי לגיל 50+', channels: ['Instagram', 'Nope'], days: 7 });
assert.equal(qc.status, 200);
assert.equal(qc.data.ai, false);
assert.ok(qc.data.draft.posts.length >= 5 && qc.data.draft.posts.every(p => p.channel === 'Instagram' && p.day >= 0 && p.day <= 6));
assert.equal((await call('POST', '/api/ai/quick-campaign', { idea: 'x' })).status, 400);

// tracking link: lead attributed to an existing campaign, bogus ids ignored
const pub = body => fetch(base + '/api/public/lead', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) });
await pub({ name: 'עוקב', phone: '051', campaign: c.id });
await pub({ name: 'זר', phone: '052', campaign: 'does-not-exist' });
const leadsNow = (await call('GET', '/api/state')).data.leads;
assert.equal(leadsNow.find(l => l.name === 'עוקב').campaign, c.id);
assert.equal(leadsNow.find(l => l.name === 'זר').campaign, '');

// ---- Settings screen, connection tests, insights, auto-reply ----
{
  const root = token; // admin token
  await call('POST', '/api/users', { email: 'member@b.co', name: 'M', password: 'password123' });
  await call('POST', '/api/login', { email: 'member@b.co', password: 'password123' });
  assert.equal((await call('GET', '/api/settings')).status, 403, 'members cannot read settings');
  assert.equal((await call('PUT', '/api/settings', { values: {} })).status, 403, 'members cannot write settings');
  token = root;

  assert.equal((await call('PUT', '/api/settings', { values: { FB_PAGE_ID: 'abc' } })).status, 400);
  assert.equal((await call('PUT', '/api/settings', { values: { PUBLISH_WEBHOOK_URL: 'ftp://x' } })).status, 400);

  const saved = await call('PUT', '/api/settings', { values: {
    PUBLISH_WEBHOOK_URL: m2 + '/hook2', ANTHROPIC_API_KEY: 'sk-test-1234', RESEND_API_KEY: 're_abcd',
    EMAIL_FROM: 'Tizon <hello@x.co>', OWNER_EMAIL: 'owner@x.co', AUTO_REPLY: 'on', BUSINESS_PROFILE: 'עסק בריאות' } });
  assert.equal(saved.status, 200);
  const shown = JSON.stringify((await call('GET', '/api/settings')).data);
  assert.ok(!shown.includes('sk-test-1234') && !shown.includes('re_abcd') && !shown.includes('/hook2'), 'secrets are never returned');
  assert.ok(shown.includes('••••1234'), 'secret hint (last 4) is shown');
  const groups = (await call('GET', '/api/settings')).data.groups;
  assert.equal(groups.find(g => g.id === 'ai').connected, true);
  assert.equal(groups.find(g => g.id === 'telegram').connected, false);

  // connection tests hit the real code paths against the mocks
  assert.equal((await call('POST', '/api/settings/test', { service: 'webhook' })).data.ok, true);
  assert.ok(mock2log.some(r => r.path === '/hook2' && r.body.event === 'test'));
  assert.match((await call('POST', '/api/settings/test', { service: 'ai' })).data.detail, /שלום/);
  assert.equal((await call('POST', '/api/settings/test', { service: 'email' })).data.ok, true);
  assert.equal((await call('POST', '/api/settings/test', { service: 'telegram' })).data.ok, false, 'unconfigured service reports failure');
  assert.equal((await call('POST', '/api/settings/test', { service: 'nope' })).status, 400);

  // settings override the environment: publishing now goes to the webhook saved in Settings
  const before = received.length;
  const pp = (await call('POST', '/api/posts', { campaign: c.id, channel: 'Instagram', text: 'מהגדרות', at: new Date(Date.now() - 1000).toISOString() })).data;
  await tick();
  assert.ok(mock2log.some(r => r.path === '/hook2' && r.body.event === 'post.publish' && r.body.text === 'מהגדרות'));
  assert.equal(received.length, before, 'old env webhook no longer used');

  // AI quick campaign (parsed + sanitised: unknown channel falls back to the first requested)
  const ai = await call('POST', '/api/ai/quick-campaign', { idea: 'רעיון כלשהו', channels: ['Facebook'], days: 7 });
  assert.equal(ai.data.ai, true);
  assert.deepEqual(ai.data.draft.posts.map(p => p.channel), ['Facebook', 'Facebook']);
  assert.equal(ai.data.draft.goal, 'מכירות');

  // insights: rule-based, then AI
  const ri = (await call('POST', '/api/insights', {})).data;
  assert.equal(ri.ai, false); assert.ok(ri.insights.length > 0);
  const ai2 = (await call('POST', '/api/insights', { ai: true })).data;
  assert.equal(ai2.ai, true); assert.deepEqual(ai2.insights, ['להגדיל את הקמפיין הטוב', 'לעצור את החלש']);

  // auto-reply + owner email on a new website lead
  mock2log.length = 0;
  await fetch(base + '/api/public/lead', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ name: 'דנה\nבדיקה', phone: '052-318-6262', email: 'dana@x.co' }) });
  const mails = mock2log.filter(r => r.path === '/emails');
  assert.ok(mails.some(m => m.body.to[0] === 'owner@x.co' && m.body.text.includes('wa.me/972523186262')), 'owner notified with WhatsApp link');
  const reply = mails.find(m => m.body.to[0] === 'dana@x.co');
  assert.ok(reply && !reply.body.text.split('\n')[0].includes('\n'), 'auto reply sent');
  assert.equal(reply.auth, 'Bearer re_abcd');

  // clearing a secret disconnects the integration
  await call('PUT', '/api/settings', { clear: ['RESEND_API_KEY'] });
  assert.equal((await call('GET', '/api/settings')).data.groups.find(g => g.id === 'email').connected, false);
  void pp;
}

// Telegram privacy: lead notifications (personal data) never go to the public publishing channel
{
  process.env.TRUST_PROXY = 'true';
  const lead = ip => fetch(base + '/api/public/lead', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': ip }, body: JSON.stringify({ name: 'פרטי', phone: '050' }) });
  const sends = () => mock2log.filter(r => r.path.includes('/sendMessage'));
  await call('PUT', '/api/settings', { values: { TG_BOT_TOKEN: '111:AAA', TG_CHAT_ID: '@my_channel' } });
  mock2log.length = 0; await lead('7.7.7.1');
  assert.equal(sends().length, 0, 'public channel never receives lead details');
  await call('PUT', '/api/settings', { values: { TG_NOTIFY_CHAT_ID: '123456789' } });
  mock2log.length = 0; await lead('7.7.7.2');
  assert.deepEqual(sends().map(r => r.body.chat_id), ['123456789']);
  await call('POST', '/api/posts', { channel: 'Telegram', text: 'לערוץ', at: new Date(Date.now() - 1000).toISOString() });
  mock2log.length = 0; await tick();
  assert.ok(sends().some(r => r.body.chat_id === '@my_channel' && r.body.text === 'לערוץ'), 'posts still go to the channel');
  const tt = (await call('POST', '/api/settings/test', { service: 'telegram' })).data;
  assert.equal(tt.ok, true); assert.match(tt.detail, /ערוץ הפרסום/);
  await call('PUT', '/api/settings', { values: { TG_CHAT_ID: '555' }, clear: ['TG_NOTIFY_CHAT_ID'] });
  mock2log.length = 0; await lead('7.7.7.3');
  assert.deepEqual(sends().map(r => r.body.chat_id), ['555'], 'a private chat id doubles as the notification chat');
  await call('PUT', '/api/settings', { values: { TG_CHAT_ID: '-1001234' } });
  mock2log.length = 0; await lead('7.7.7.4');
  assert.equal(sends().length, 0, 'a group/channel id is never used for notifications');
  await call('PUT', '/api/settings', { clear: ['TG_BOT_TOKEN', 'TG_CHAT_ID'] });
}

// ---- Agency mode: workspaces are isolated (data, integrations, access) ----
{
  const adminTok = token;
  const w = (await call('POST', '/api/workspaces', { name: 'לקוח ב' })).data;
  assert.ok(w.id);
  const W = { 'x-workspace': w.id };
  const wc = (await call('POST', '/api/campaigns', { name: 'רק של לקוח ב' }, W)).data;
  assert.ok(!(await call('GET', '/api/state')).data.campaigns.some(x => x.id === wc.id), 'main does not see the client data');
  const wst = (await call('GET', '/api/state', undefined, W)).data;
  assert.deepEqual(wst.campaigns.map(x => x.id), [wc.id], 'workspace sees only its own data');
  assert.equal(wst.ws, w.id);
  assert.ok(wst.workspaces.length >= 2);

  // integrations never leak from main into a client workspace (env webhook is set for main)
  assert.equal(wst.caps.webhook, false);
  assert.equal((await call('GET', '/api/settings', undefined, W)).data.groups.find(g => g.id === 'webhook').connected, false);
  const before2 = received.length, log2 = mock2log.length;
  await call('POST', '/api/posts', { channel: 'Instagram', text: 'של לקוח ב', at: new Date(Date.now() - 1000).toISOString() }, W);
  await tick();
  assert.equal(received.length, before2); assert.equal(mock2log.length, log2 + (mock2log.length - log2), 'sanity');
  assert.ok(!mock2log.slice(log2).some(r => r.body?.text === 'של לקוח ב'), "client post is never sent to main's webhook");
  const cp = (await call('GET', '/api/state', undefined, W)).data.posts.find(p => p.text === 'של לקוח ב');
  assert.equal(cp.status, 'ידני');

  // public lead form of a client site targets its workspace
  const pub2 = await fetch(base + '/api/public/lead', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': '8.8.8.1' }, body: JSON.stringify({ name: 'ליד ללקוח', phone: '050', ws: w.id }) });
  assert.equal(pub2.status, 200);
  assert.ok((await call('GET', '/api/state', undefined, W)).data.leads.some(l => l.name === 'ליד ללקוח'));
  assert.ok(!(await call('GET', '/api/state')).data.leads.some(l => l.name === 'ליד ללקוח'));
  assert.equal((await fetch(base + '/api/public/lead', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': '8.8.8.2' }, body: JSON.stringify({ name: 'x', phone: '1', ws: 'nope' }) })).status, 404);

  // members only reach workspaces they were granted
  await call('POST', '/api/login', { email: 'member@b.co', password: 'password123' });
  assert.equal((await call('GET', '/api/state', undefined, W)).status, 403);
  assert.equal((await call('GET', '/api/state')).status, 200, 'default workspace is allowed');
  assert.equal((await call('GET', '/api/state', undefined, { 'x-workspace': 'nope' })).status, 403);
  assert.equal((await call('GET', '/api/workspaces')).status, 403);
  token = adminTok;
  assert.equal((await call('PUT', '/api/access', { email: 'member@b.co', workspaces: ['main', w.id] })).status, 200);
  await call('POST', '/api/login', { email: 'member@b.co', password: 'password123' });
  assert.equal((await call('GET', '/api/state', undefined, W)).status, 200);
  token = adminTok;
}

// ---- Compliance gate, images, Facebook metrics, follow-ups, A/B ----
{
  const due = () => new Date(Date.now() - 1000).toISOString();
  const postsNow = async () => (await call('GET', '/api/state')).data.posts;

  // compliance: risky medical claims wait for a person; the check endpoint and state expose the findings
  const chk = (await call('POST', '/api/compliance/check', { text: 'המוצר מרפא ומבטיח תוצאה' })).data;
  assert.equal(chk.level, 'high'); assert.ok(chk.findings.length >= 2);
  assert.equal((await call('POST', '/api/compliance/check', { text: 'ייעוץ בריאות אישי' })).data.level, '');
  const risky = (await call('POST', '/api/posts', { channel: 'Instagram', text: 'המוצר מרפא סוכרת', at: due() })).data;
  mock2log.length = 0; await tick();
  let rp = (await postsNow()).find(p => p.id === risky.id);
  assert.equal(rp.status, 'ממתין לבדיקה'); assert.equal(rp.risk.level, 'high');
  assert.ok(!mock2log.some(r => r.body?.text === 'המוצר מרפא סוכרת'), 'blocked post is never sent');
  await call('PUT', '/api/posts/' + risky.id, { override: 1, status: 'מתוזמן' });
  await tick();
  assert.equal((await postsNow()).find(p => p.id === risky.id).status, 'פורסם', 'approved post goes out');
  const fx = (await call('POST', '/api/compliance/fix', { text: 'המוצר מרפא' })).data;
  assert.equal(fx.risk.level, '');
  await call('PUT', '/api/settings', { values: { COMPLIANCE: 'off' } });
  assert.equal((await postsNow()).find(p => p.id === risky.id).risk.level, '', 'check can be turned off');
  await call('PUT', '/api/settings', { values: { COMPLIANCE: 'on' } });

  // images: validated upload, public GET, size and type limits
  const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
  const up = await call('POST', '/api/media', { dataUrl: 'data:image/png;base64,' + PNG });
  assert.equal(up.status, 201);
  const got = await fetch(base + up.data.url);
  assert.equal(got.status, 200); assert.equal(got.headers.get('content-type'), 'image/png');
  assert.deepEqual(Buffer.from(await got.arrayBuffer()), Buffer.from(PNG, 'base64'));
  assert.equal((await call('POST', '/api/media', { dataUrl: 'data:image/gif;base64,R0lGOD' })).status, 400);
  assert.equal((await call('POST', '/api/media', { dataUrl: 'data:image/png;base64,AAAA' })).status, 400, 'magic bytes must match');
  assert.equal((await call('POST', '/api/media', { dataUrl: 'data:image/jpeg;base64,/9j/' + 'A'.repeat(1.4e6) })).status, 413);
  assert.equal((await fetch(base + '/api/media/zzzz')).status, 404);

  // publishing with an image: Facebook photo upload (multipart) with a reference, plain text for text posts
  await call('PUT', '/api/settings', { values: { FB_PAGE_ID: '1234567890', FB_PAGE_TOKEN: 'EAAB', FB_ADS_TOKEN: 'ADSTOKEN' } });
  const fbImg = (await call('POST', '/api/posts', { channel: 'Facebook', text: 'עם תמונה', image: up.data.id, at: due() })).data;
  const fbTxt = (await call('POST', '/api/posts', { channel: 'Facebook', text: 'בלי תמונה', at: due() })).data;
  const igImg = (await call('POST', '/api/posts', { channel: 'Instagram', text: 'לאינסטגרם', image: up.data.id, at: due() })).data;
  mock2log.length = 0; await tick();
  const photo = mock2log.find(r => r.path.includes('/fb/1234567890/photos'));
  assert.ok(photo && photo.body.multipart && photo.body.raw.includes('עם תמונה'), 'photo uploaded as multipart with caption');
  assert.ok(mock2log.some(r => r.path.includes('/fb/1234567890/feed') && r.body.message === 'בלי תמונה'));
  const hook = mock2log.find(r => r.path === '/hook2' && r.body.text === 'לאינסטגרם');
  assert.match(hook.body.image_url, new RegExp(`/api/media/${up.data.id}$`), 'webhook receives a public image URL');
  let ps = await postsNow();
  assert.equal(ps.find(p => p.id === fbImg.id).ref, 'PAGE_123'); assert.equal(ps.find(p => p.id === fbTxt.id).ref, 'PAGE_555');

  // metrics: reactions/comments/shares for recent posts + ad spend per campaign
  const ac = (await call('POST', '/api/campaigns', { name: 'ממומן', fbCampaign: '99887766' })).data;
  const sync = (await call('POST', '/api/sync', {})).data;
  assert.ok(sync.posts >= 1 && sync.campaigns === 1);
  ps = await postsNow();
  assert.deepEqual([ps.find(p => p.id === fbImg.id).likes, ps.find(p => p.id === fbImg.id).comments, ps.find(p => p.id === fbImg.id).shares], [7, 2, 1]);
  const camp2 = (await call('GET', '/api/state')).data.campaigns.find(x => x.id === ac.id);
  assert.deepEqual([camp2.spent, camp2.impressions, camp2.clicks], [123.45, 1000, 50]);
  assert.ok((await call('POST', '/api/insights', {})).data.insights.some(i => i.includes('אינטראקציה')), 'top post insight');
  await call('PUT', '/api/settings', { clear: ['FB_PAGE_ID', 'FB_PAGE_TOKEN', 'FB_ADS_TOKEN'] });

  // follow-ups: new website leads get a next-contact date, reminders go to the private chat once, "contacted" advances 1 -> 3 -> 7
  await call('PUT', '/api/settings', { values: { TG_BOT_TOKEN: '222:BBB', TG_NOTIFY_CHAT_ID: '777' } });
  const ilDate = new Intl.DateTimeFormat('sv', { timeZone: 'Asia/Jerusalem' }).format(Date.now());
  const noon = Date.parse(ilDate + 'T12:00:00Z');                       // 14:00-15:00 in Israel, same date
  const addD = (d, n) => new Date(Date.parse(d + 'T12:00:00Z') + n * 864e5).toISOString().slice(0, 10);
  const pubLead = (ip, body) => fetch(base + '/api/public/lead', { method: 'POST', headers: { 'content-type': 'application/json', 'x-nf-client-connection-ip': ip }, body: JSON.stringify(body) });
  await pubLead('6.6.6.1', { name: 'מעקב', phone: '052-318-6262' });
  let fl = (await call('GET', '/api/state')).data.leads.find(l => l.name === 'מעקב');
  assert.equal(fl.next, addD(ilDate, 1), 'first contact due tomorrow');
  assert.equal((await call('PUT', '/api/leads/' + fl.id, { next: 'tomorrow' })).status, 400);
  await call('PUT', '/api/leads/' + fl.id, { next: addD(ilDate, -1) });
  mock2log.length = 0; await tick(noon);
  const rem = mock2log.filter(r => r.path.includes('/sendMessage') && String(r.body.text).includes('🔔'));
  assert.equal(rem.length, 1); assert.equal(rem[0].body.chat_id, '777'); assert.ok(rem[0].body.text.includes('wa.me/972523186262'));
  mock2log.length = 0; await tick(noon);
  assert.equal(mock2log.filter(r => String(r.body.text).includes('🔔')).length, 0, 'one reminder per due date');
  let c1 = (await call('POST', '/api/leads/' + fl.id + '/contacted', {})).data;
  assert.deepEqual([c1.seq, c1.next, c1.stage], [1, addD(ilDate, 3), 'בטיפול']);
  c1 = (await call('POST', '/api/leads/' + fl.id + '/contacted', {})).data; assert.deepEqual([c1.seq, c1.next], [2, addD(ilDate, 7)]);
  c1 = (await call('POST', '/api/leads/' + fl.id + '/contacted', {})).data; assert.deepEqual([c1.seq, c1.next], [3, '']);
  await call('PUT', '/api/settings', { clear: ['TG_BOT_TOKEN', 'TG_NOTIFY_CHAT_ID'] });

  // A/B: the landing page passes ?v=A / ?v=B and reports compare variants per campaign
  const ab = (await call('POST', '/api/campaigns', { name: 'בדיקת A/B', spent: 100 })).data;
  let n = 0;
  for (const [v, count] of [['A', 5], ['B', 2]]) for (let k = 0; k < count; k++) await pubLead('5.5.5.' + (++n), { name: `ab${v}${k}`, phone: '050', campaign: ab.id, v });
  assert.equal((await call('GET', '/api/state')).data.leads.find(l => l.name === 'abA0').variant, 'A');
  const abIns = (await call('POST', '/api/insights', {})).data.insights.find(i => i.startsWith('🧪'));
  assert.ok(abIns && abIns.includes('גרסה A מביאה 5 פניות מול 2'), abIns);
}

// An external-service failure must say what failed (502), never a generic server error
{
  const good = process.env.ANTHROPIC_API_URL;
  process.env.ANTHROPIC_API_URL = m2 + '/anthropic-bad';
  const bad = await call('POST', '/api/ai/generate', { channel: 'Facebook', brief: 'x' });
  assert.equal(bad.status, 502);
  assert.match(bad.data.error, /401/); assert.match(bad.data.error, /invalid x-api-key/);
  const badPlan = await call('POST', '/api/ai/quick-campaign', { idea: 'רעיון כלשהו', channels: ['Facebook'], days: 7 });
  assert.equal(badPlan.status, 502, 'quick campaign reports the AI failure');
  process.env.ANTHROPIC_API_URL = 'http://127.0.0.1:1/unreachable';
  const down = await call('POST', '/api/ai/generate', { channel: 'Facebook', brief: 'x' });
  assert.equal(down.status, 502); assert.match(down.data.error, /לא ניתן להתחבר/);
  process.env.ANTHROPIC_API_URL = good;
}

// campaign ordering + pause (drag & drop board persists through one call)
{
  const mk = async (name) => (await call('POST', '/api/campaigns', { name })).data;
  const [c1, c2, c3] = [await mk('א'), await mk('ב'), await mk('ג')];
  assert.ok(c1.order < c3.order, 'new campaigns are appended');
  const r = await call('POST', '/api/campaigns/order', { items: [{ id: c3.id, status: 'מושהה' }, { id: c1.id, status: 'פעיל' }, { id: c2.id, status: 'הסתיים' }, { id: 'ghost' }] });
  assert.equal(r.data.updated, 3);
  const cs = (await call('GET', '/api/state')).data.campaigns;
  const by = id => cs.find(x => x.id === id);
  assert.ok(by(c3.id).order < by(c1.id).order && by(c1.id).order < by(c2.id).order, 'order follows the request');
  assert.deepEqual([by(c3.id).status, by(c1.id).status, by(c2.id).status], ['מושהה', 'פעיל', 'הסתיים']);
  assert.equal((await call('POST', '/api/campaigns/order', { items: 'x' })).status, 400);
  // a paused campaign holds its scheduled posts; resuming releases them
  const pp = (await call('POST', '/api/posts', { campaign: c3.id, channel: 'Instagram', text: 'מושהה', at: new Date(Date.now() - 1000).toISOString() })).data;
  await tick();
  assert.equal((await call('GET', '/api/state')).data.posts.find(p => p.id === pp.id).status, 'מתוזמן', 'paused campaign does not publish');
  await call('PUT', '/api/campaigns/' + c3.id, { status: 'פעיל' });
  await tick();
  assert.equal((await call('GET', '/api/state')).data.posts.find(p => p.id === pp.id).status, 'פורסם');
}

// AI improve: any text field + a one-line instruction; the result is compliance-checked
{
  const imp = await call('POST', '/api/ai/improve', { text: 'פוסט ישן', instruction: 'קצר יותר', label: 'טקסט הפוסט', channel: 'Facebook' });
  assert.equal(imp.status, 200); assert.equal(imp.data.text, 'טקסט משודרג'); assert.equal(imp.data.risk.level, '');
  const prompts = mock2log.filter(r => r.path === '/anthropic').map(r => r.body.messages[0].content);
  const last = prompts[prompts.length - 1];
  assert.ok(last.includes('פוסט ישן') && last.includes('קצר יותר') && last.includes('טקסט הפוסט') && last.includes('Facebook'), 'prompt carries text, instruction, field and channel');
  const risky2 = await call('POST', '/api/ai/improve', { text: 'x', instruction: 'כתוב שזה מרפא' });
  assert.equal(risky2.data.risk.level, 'high', 'an AI rewrite that makes medical claims is flagged');
  assert.equal((await call('POST', '/api/ai/improve', { text: '', instruction: 'כתוב ברכה קצרה' })).status, 200, 'works from an empty field');
  assert.equal((await call('POST', '/api/ai/improve', { text: '', instruction: '' })).status, 400);
}

// Image studio: AI banner copy, image prompt, and image generation stored in the media library
{
  const copy = await call('POST', '/api/ai/banner-copy', { text: 'ייעוץ בריאות אישי' });
  assert.equal(copy.status, 200); assert.equal(copy.data.options.length, 3);
  assert.equal(copy.data.options[0].headline, 'כותרת א'); assert.equal(copy.data.options[1].risk.level, 'high', 'risky banner copy is flagged');
  assert.equal((await call('POST', '/api/ai/banner-copy', {})).status, 400);
  const ip = await call('POST', '/api/ai/image-prompt', { text: 'שיחת היכרות חינם' });
  assert.equal(ip.data.prompt, 'calm wellness background, soft light');

  assert.equal((await call('POST', '/api/ai/image', { prompt: 'שדה פתוח בשקיעה' })).status, 400, 'image generation needs an OpenAI key');
  await call('PUT', '/api/settings', { values: { OPENAI_API_KEY: 'sk-img-1234' } });
  assert.equal((await call('GET', '/api/state')).data.caps.image, true);
  assert.equal((await call('POST', '/api/settings/test', { service: 'image' })).data.ok, true);
  const img = await call('POST', '/api/ai/image', { prompt: 'open field at sunset', size: '1024x1536' });
  assert.equal(img.status, 200); assert.match(img.data.url, /^\/api\/media\/[a-f0-9]{24}$/);
  const got2 = await fetch(base + img.data.url);
  assert.equal(got2.status, 200); assert.equal(got2.headers.get('content-type'), 'image/jpeg');
  const sent = mock2log.filter(r => r.path === '/openai/images/generations').pop();
  assert.equal(sent.auth, 'Bearer sk-img-1234'); assert.equal(sent.body.size, '1024x1536'); assert.equal(sent.body.output_format, 'jpeg');
  assert.ok(sent.body.prompt.includes('open field at sunset') && sent.body.prompt.includes('No text'), 'prompt keeps the user text and bans text in the image');
  const huge = await call('POST', '/api/ai/image', { prompt: 'BIGIMAGE' });
  assert.equal(huge.status, 502); assert.match(huge.data.error, /גדולה מדי/);
  assert.equal((await call('POST', '/api/ai/image', { prompt: 'x' })).status, 400);
  await call('PUT', '/api/settings', { clear: ['OPENAI_API_KEY'] });
}

// ---- Training: lessons, progress, activity log, knowledge book, tutor, manual ----
{
  const { LESSONS, TRACKS, RELEASES, MANUAL } = await import('./guide-content.js');
  // content integrity: every track/release points at real lessons, every lesson has steps and a quiz
  for (const t of Object.values(TRACKS)) for (const l of t.lessons) assert.ok(LESSONS[l], 'track lesson exists: ' + l);
  for (const r of RELEASES) for (const l of r.lessons) assert.ok(LESSONS[l], `release ${r.id} lesson exists: ${l}`);
  for (const [id, l] of Object.entries(LESSONS)) { assert.ok(l.steps.length >= 2 && l.quiz.length >= 1, 'lesson has steps and quiz: ' + id); for (const q of l.quiz) assert.ok(q.o[q.a] && q.why, 'quiz answer valid: ' + id); }
  assert.equal(new Set(RELEASES.map(r => r.id)).size, RELEASES.length, 'release ids are unique');
  // the generated manual file is in sync with the source
  const fsm = await import('node:fs'); const { manualMarkdown } = await import('./guide-content.js');
  assert.equal(fsm.readFileSync(new URL('../docs/הוראות-הפעלה.md', import.meta.url), 'utf8'), manualMarkdown(), 'run `npm run manual` after editing guide-content.js');
  assert.ok(MANUAL.length >= 10);

  const adminTok = token;
  const content = (await call('GET', '/api/guide/content')).data;
  assert.ok(content.lessons.welcome && content.tracks.chief.lessons.includes('agency') && content.releases.length);

  // progress per user, default tracks, team view for admins
  let me = (await call('GET', '/api/guide/me')).data; assert.equal(me.track, 'chief');
  assert.equal((await call('POST', '/api/guide/progress', { lesson: 'nope' })).status, 400);
  assert.equal((await call('POST', '/api/guide/progress', { lesson: 'welcome', score: 100 })).status, 200);
  me = (await call('GET', '/api/guide/me')).data; assert.equal(me.done.welcome.score, 100);
  const team = (await call('GET', '/api/guide/team')).data;
  const mine = team.find(u => u.email === 'a@b.co'); assert.equal(mine.done, 1); assert.equal(mine.total, TRACKS.chief.lessons.length);
  assert.equal((await call('PUT', '/api/guide/track', { email: 'member@b.co', track: 'chief' })).status, 200);
  assert.equal((await call('PUT', '/api/guide/track', { email: 'member@b.co', track: 'zzz' })).status, 400);
  await call('POST', '/api/login', { email: 'member@b.co', password: 'password123' });
  assert.equal((await call('GET', '/api/guide/me')).data.track, 'chief', 'the owner can assign the chief-campaigner track');
  assert.equal((await call('GET', '/api/guide/team')).status, 403);
  assert.equal((await call('PUT', '/api/guide/track', { email: 'a@b.co', track: 'basic' })).status, 403);
  const memberTok = token;
  token = adminTok;

  // activity log: records what happened, in plain Hebrew, never secrets
  const act = (await call('GET', '/api/guide/activity?limit=200')).data;
  assert.ok(act.some(e => e.text.startsWith('נוצר קמפיין')) && act.some(e => e.type === 'settings.update') && act.some(e => e.type === 'academy.lesson'));
  assert.ok(act.some(e => e.type === 'post.published'), 'system events are logged too');
  const dump = JSON.stringify(act);
  for (const secret of ['sk-img-1234', 'sk-test-1234', 're_abcd', 'SECRETXYZ', 'ADS' + 'TOKEN']) assert.ok(!dump.includes(secret), 'no secrets in the activity log: ' + secret);

  // needs / decisions: stored, linked to lessons, author-only deletion
  const need = await call('POST', '/api/guide/knowledge', { type: 'need', title: 'אנחנו צריכים באנר לחג', body: 'לפוסט הפתיחה' });
  assert.equal(need.status, 201); assert.ok(need.data.related.some(r => r.id === 'banner-studio'), 'a banner need links to the banner lesson');
  assert.equal((await call('POST', '/api/guide/knowledge', { type: 'decision', title: 'x' })).status, 400);
  await call('POST', '/api/guide/knowledge', { type: 'decision', title: 'הערוץ המרכזי הוא פייסבוק' });
  token = memberTok;
  assert.equal((await call('DELETE', '/api/guide/knowledge/' + need.data.id)).status, 403, "members cannot delete someone else's entry");
  const mineNote = (await call('POST', '/api/guide/knowledge', { type: 'note', title: 'הערה של נטלי' })).data;
  assert.equal((await call('DELETE', '/api/guide/knowledge/' + mineNote.id)).status, 200, 'authors can delete their own');
  token = adminTok;
  let kn = (await call('GET', '/api/guide/knowledge')).data;
  assert.ok(kn.items.some(i => i.title === 'אנחנו צריכים באנר לחג'));

  // learning: AI rewrite of the knowledge book, and the deterministic weekly self-update
  const learned = await call('POST', '/api/guide/learn', {});
  assert.equal(learned.status, 200); assert.equal(learned.data.ai, true); assert.ok(learned.data.body.includes('## איך אנחנו עובדים'));
  const lp = mock2log.filter(r => r.path === '/anthropic').pop().body.messages[0].content;
  assert.ok(lp.includes('אנחנו צריכים באנר לחג') && lp.includes('הערוץ המרכזי הוא פייסבוק'), 'the prompt carries the needs and decisions');
  kn = (await call('GET', '/api/guide/knowledge')).data; assert.equal(kn.playbook.ai, true);
  await tick(Date.now() + 8 * 864e5);
  kn = (await call('GET', '/api/guide/knowledge')).data;
  assert.equal(kn.playbook.by, 'system'); assert.equal(kn.playbook.ai, false);
  assert.ok(kn.playbook.body.includes('אנחנו צריכים באנר לחג') && kn.playbook.body.includes('## שינויים אחרונים'), 'the knowledge book rewrote itself from what happened');

  // tutor: grounded answer with lesson links; keyword fallback without an AI key
  const asked = (await call('POST', '/api/guide/ask', { question: 'איך יוצרים באנר?' })).data;
  assert.equal(asked.ai, true); assert.ok(asked.lessons.some(l => l.id === 'banner-studio')); assert.ok(!asked.answer.includes('[[lesson'));
  const ap = mock2log.filter(r => r.path === '/anthropic').pop().body.messages[0].content;
  assert.ok(ap.includes('banner-studio') && ap.includes('אנחנו צריכים באנר לחג'), 'the tutor is grounded in lessons and our decisions');
  await call('PUT', '/api/settings', { clear: ['ANTHROPIC_API_KEY'] });
  const offline = (await call('POST', '/api/guide/ask', { question: 'איך יוצרים באנר?' })).data;
  assert.equal(offline.ai, false); assert.equal(offline.lessons[0].id, 'banner-studio'); assert.ok(offline.answer.includes('השלבים'));
  assert.equal((await call('POST', '/api/guide/ask', { question: '' })).status, 400);
  await call('PUT', '/api/settings', { values: { ANTHROPIC_API_KEY: 'sk-test-1234' } });

  // operating manual download: static sections + live knowledge and configuration
  const manual = await fetch(base + '/api/guide/manual', { headers: { authorization: 'Bearer ' + adminTok } });
  assert.equal(manual.status, 200); assert.match(manual.headers.get('content-type'), /markdown/);
  const md = await manual.text();
  assert.ok(md.startsWith('# הוראות הפעלה') && md.includes('## התצורה הנוכחית') && md.includes('אנחנו צריכים באנר לחג') && md.includes('## מה חדש'));
  assert.ok(!md.includes('sk-test-1234'), 'the manual never contains secrets');
  assert.equal((await fetch(base + '/api/guide/manual')).status, 401);
}

// work-plan checklist: shared, validated, returned in /state
assert.equal((await call('POST', '/api/checklist', { key: 's1', done: true })).status, 200);
assert.equal((await call('POST', '/api/checklist', { key: 'k1@2026-10-04', done: true })).status, 200);
assert.equal((await call('POST', '/api/checklist', { key: 'bad key!', done: true })).status, 400);
let ck = (await call('GET', '/api/state')).data.checklist;
assert.ok(ck.s1 && ck['k1@2026-10-04']);
await call('POST', '/api/checklist', { key: 's1', done: false });
ck = (await call('GET', '/api/state')).data.checklist;
assert.ok(!ck.s1 && ck['k1@2026-10-04']);

// patient care: private records, consent-gated portal link, no names/health data in logs or notifications
{
  const mk = await call('POST', '/api/patients', { name: 'דנה כהן', phone: '0501234567', goal: 'ירידה במשקל', next: '2020-01-01' });
  assert.equal(mk.status, 201); assert.ok(!('token' in mk.data));
  const pid = mk.data.id;
  assert.equal((await call('POST', '/api/patients', { name: '' })).status, 400);
  assert.equal((await call('PUT', '/api/patients/' + pid, { next: 'tomorrow' })).status, 400);
  assert.equal((await call('POST', `/api/patients/${pid}/link`, {})).status, 400, 'no link before consent');
  assert.equal((await call('PUT', '/api/patients/' + pid, { consent: true })).data.consent, 1);
  const lk = await call('POST', `/api/patients/${pid}/link`, {});
  assert.equal(lk.status, 200); assert.match(lk.data.path, /^\/care\/\?w=main&p=[a-f0-9]{12}&t=[a-f0-9]{32}$/);
  const q = lk.data.path.slice('/care/'.length);
  assert.equal((await call('POST', `/api/patients/${pid}/link`, {})).data.path, lk.data.path, 'link is stable');
  // staff entries: note stays private, measure and reply are visible to the patient
  await call('POST', `/api/patients/${pid}/entries`, { type: 'note', text: 'הערה פנימית רגישה' });
  await call('POST', `/api/patients/${pid}/entries`, { type: 'measure', weight: 82.5 });
  assert.equal((await call('POST', `/api/patients/${pid}/entries`, { type: 'note' })).status, 400);
  const before = mock2log.length;
  const post = await fetch(base + '/api/care' + q, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ w: 'main', p: pid, t: lk.data.path.split('t=')[1], type: 'question', text: 'האם אפשר לשלב קפה?', weight: 81, energy: 9 }) });
  assert.equal(post.status, 200);
  const pv = await post.json();
  assert.equal(pv.name, 'דנה כהן');
  assert.ok(pv.entries.some(e => e.text === 'האם אפשר לשלב קפה?' && e.energy === 5), 'energy is clamped');
  assert.ok(!JSON.stringify(pv).includes('הערה פנימית'), 'private notes never reach the patient');
  assert.ok(pv.entries.some(e => e.weight === 82.5 && e.by === 'staff'));
  await new Promise(r => setTimeout(r, 100));
  const notes = JSON.stringify(mock2log.slice(before).filter(x => x.path === '/hook2').map(x => x.body.text));
  assert.ok(notes.length > 4, 'portal message notifies the team');
  assert.ok(notes.includes('דנה') && !notes.includes('כהן') && !notes.includes('קפה'), 'notification: first name only, no content');
  // list + answer
  let list = (await call('GET', '/api/patients')).data;
  const row = list.find(x => x.id === pid);
  assert.equal(row.open, 1); assert.equal(row.lastWeight, 81); assert.ok(row.hasLink && row.due);
  const det = (await call('GET', '/api/patients/' + pid)).data;
  const question = det.entries.find(e => e.type === 'question');
  await call('POST', `/api/patients/${pid}/entries`, { type: 'reply', text: 'כוס אחת ביום בסדר.', replyTo: question.id });
  assert.equal((await call('GET', '/api/patients')).data.find(x => x.id === pid).open, 0);
  assert.ok((await (await fetch(base + '/api/care' + q + '&w=main')).json()).entries.some(e => e.type === 'reply'));
  // follow-up reminder fires once, with the first name only
  const b2 = mock2log.length; await tick(); await tick(); await new Promise(r => setTimeout(r, 100));
  const rem = mock2log.slice(b2).filter(x => x.path === '/hook2' && /היום ליווי/.test(x.body.text || ''));
  assert.equal(rem.length, 1, 'reminder fires exactly once'); assert.ok(rem[0].body.text.includes('דנה') && !rem[0].body.text.includes('כהן'));
  // activity log: no names, no health content
  const act2 = JSON.stringify((await call('GET', '/api/guide/activity?limit=200')).data);
  assert.ok(!act2.includes('כהן') && !act2.includes('קפה') && !act2.includes('82.5') && act2.includes('נוסף מטופל'));
  // bad / revoked / unconsented access is a uniform 404
  const bad = await fetch(base + `/api/care?w=main&p=${pid}&t=${'0'.repeat(32)}`); assert.equal(bad.status, 404);
  assert.equal((await fetch(base + `/api/care?w=main&p=${pid}`)).status, 404);
  await call('POST', `/api/patients/${pid}/link`, { rotate: true });
  assert.equal((await fetch(base + '/api/care' + q)).status, 404, 'rotating the link revokes the old one');
  const lk2 = await call('POST', `/api/patients/${pid}/link`, {});
  await call('POST', `/api/patients/${pid}/link`, { revoke: true });
  assert.equal((await fetch(base + '/api/care' + lk2.data.path.slice('/care/'.length))).status, 404);
  const lk3 = await call('POST', `/api/patients/${pid}/link`, {});
  await call('PUT', '/api/patients/' + pid, { consent: false });
  assert.equal((await fetch(base + '/api/care' + lk3.data.path.slice('/care/'.length))).status, 404, 'withdrawn consent closes the portal');
  assert.equal((await fetch(base + '/api/patients')).status, 401);
  // erasure
  assert.equal((await call('DELETE', '/api/patients/' + pid)).status, 200);
  assert.equal((await call('GET', '/api/patients/' + pid)).status, 404);
  assert.equal((await call('GET', '/api/patients')).data.length, 0);
}

// roles: admin can promote/demote; the last admin cannot be demoted; members cannot change roles
{
  assert.equal((await call('POST', '/api/users', { email: 'nat@x.co', name: 'נטלי', password: 'password123', role: 'member' })).status, 201);
  const tok = (await (await fetch(base + '/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'nat@x.co', password: 'password123' }) })).json()).token;
  const asMember = (m, p, b) => fetch(base + p, { method: m, headers: { 'content-type': 'application/json', 'x-requested-with': 'tizon', authorization: 'Bearer ' + tok }, body: b ? JSON.stringify(b) : undefined });
  assert.equal((await asMember('PUT', '/api/users', { email: 'nat@x.co', role: 'admin' })).status, 403);
  assert.equal((await call('PUT', '/api/users', { email: 'nat@x.co', role: 'owner' })).status, 400);
  assert.equal((await call('PUT', '/api/users', { email: 'nobody@x.co', role: 'admin' })).status, 404);
  assert.equal((await call('PUT', '/api/users', { email: 'nat@x.co', role: 'admin' })).status, 200);
  assert.equal((await (await asMember('GET', '/api/state')).json()).me.role, 'admin', 'promotion applies to the live session');
  assert.equal((await asMember('GET', '/api/users')).status, 200);
  assert.equal((await call('PUT', '/api/users', { email: 'nat@x.co', role: 'member' })).status, 200);
  assert.equal((await call('PUT', '/api/users', { email: 'a@b.co', role: 'member' })).status, 400, 'no self-demotion');
}

const del = await call('DELETE', '/api/posts/' + p.id);
assert.equal(del.status, 200);
console.log('all tests passed');
process.exit(0);
