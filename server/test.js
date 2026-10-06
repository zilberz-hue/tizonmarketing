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
    const body = b ? JSON.parse(b) : {};
    mock2log.push({ path: req.url, body, auth: req.headers.authorization || req.headers['x-api-key'] || '' });
    res.setHeader('content-type', 'application/json');
    if (req.url === '/anthropic') {
      const prompt = body.messages?.[0]?.content || '';
      const text = prompt.includes('"posts"') ? JSON.stringify({ name: 'קמפיין AI', goal: 'מכירות', audience: 'קהל', message: 'מסר', posts: [{ day: 0, channel: 'Facebook', text: 'פוסט א' }, { day: 3, channel: 'Nope', text: 'פוסט ב' }] })
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

// work-plan checklist: shared, validated, returned in /state
assert.equal((await call('POST', '/api/checklist', { key: 's1', done: true })).status, 200);
assert.equal((await call('POST', '/api/checklist', { key: 'k1@2026-10-04', done: true })).status, 200);
assert.equal((await call('POST', '/api/checklist', { key: 'bad key!', done: true })).status, 400);
let ck = (await call('GET', '/api/state')).data.checklist;
assert.ok(ck.s1 && ck['k1@2026-10-04']);
await call('POST', '/api/checklist', { key: 's1', done: false });
ck = (await call('GET', '/api/state')).data.checklist;
assert.ok(!ck.s1 && ck['k1@2026-10-04']);

const del = await call('DELETE', '/api/posts/' + p.id);
assert.equal(del.status, 200);
console.log('all tests passed');
process.exit(0);
