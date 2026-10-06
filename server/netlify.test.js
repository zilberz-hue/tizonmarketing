// Exercises the Netlify Functions adapter (Request/Response bridge + Blobs store) with an in-memory Blobs fake.
import http from 'node:http';
import assert from 'node:assert/strict';

const received = [];
const mock = http.createServer((req, res) => {
  let b = ''; req.on('data', c => b += c);
  req.on('end', () => { received.push(JSON.parse(b)); res.end('{}'); });
});
await new Promise(r => mock.listen(0, r));
process.env.ADMIN_EMAIL = 'a@b.co';
process.env.ADMIN_PASSWORD = 'password123';
process.env.PUBLISH_WEBHOOK_URL = `http://127.0.0.1:${mock.address().port}/hook`;

const mem = new Map();
const fakeBlobs = {
  async get(k) { return mem.has(k) ? JSON.parse(mem.get(k)) : null; },
  async setJSON(k, v) { mem.set(k, JSON.stringify(v)); },
  async delete(k) { mem.delete(k); },
  async list({ prefix }) { return { blobs: [...mem.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }; }
};

const { createApp } = await import('./core.js');
const { blobsStore } = await import('../netlify/lib/blobs-store.mjs');
const { makeHandler } = await import('../netlify/lib/handler.mjs');
const app = createApp(blobsStore(fakeBlobs));
const handler = makeHandler(app);

let token = '';
const call = async (method, path, body, headers = {}) => {
  const r = await handler(new Request('https://site.test/api' + path, {
    method, body: body && JSON.stringify(body),
    headers: { 'content-type': 'application/json', 'x-requested-with': 'tizon', ...(token && { authorization: 'Bearer ' + token }), ...headers }
  }), { ip: '1.2.3.4' });
  const data = await r.json().catch(() => null);
  if (data?.token) token = data.token;
  return { status: r.status, data };
};

assert.equal((await call('GET', '/state')).status, 401);
assert.equal((await call('POST', '/login', { email: 'a@b.co', password: 'nope' })).status, 401);
assert.equal((await call('POST', '/login', { email: 'a@b.co', password: 'password123' })).status, 200);
assert.equal((await call('POST', '/posts', {}, { 'x-requested-with': '' })).status, 403);

const c = (await call('POST', '/campaigns', { name: 'T', channels: ['Facebook'] })).data;
const p = (await call('POST', '/posts', { campaign: c.id, channel: 'Instagram', text: 'hi', at: new Date(Date.now() - 1000).toISOString() })).data;
await app.tick();
let state = (await call('GET', '/state')).data;
assert.equal(state.posts.find(x => x.id === p.id).status, 'פורסם');
assert.equal(received.find(r => r.event === 'post.publish').text, 'hi');

assert.equal((await call('POST', '/public/lead', { name: 'דני', phone: '050' }, { authorization: '' })).status, 200);
state = (await call('GET', '/state')).data;
assert.equal(state.leads.length, 1);

assert.equal((await call('POST', '/users', { email: 'x@y.co', name: 'X', password: 'longenough1' })).status, 201);
assert.equal((await call('POST', '/users', { email: 'x@y.co', name: 'X', password: 'longenough1' })).status, 409);
assert.equal((await call('PUT', '/leads/' + state.leads[0].id, { stage: 'נסגר' })).data.stage, 'נסגר');
assert.equal((await call('DELETE', '/posts/' + p.id)).status, 200);

// Settings persist through the Blobs store and hide secrets
assert.equal((await call('PUT', '/settings', { values: { TG_BOT_TOKEN: '123:SECRETXYZ', TG_CHAT_ID: '-100555', BUSINESS_PROFILE: 'פרופיל' } })).status, 200);
const st = (await call('GET', '/settings')).data;
assert.ok(!JSON.stringify(st).includes('SECRETXYZ'));
assert.equal(st.groups.find(g => g.id === 'telegram').connected, true);
assert.equal((await call('GET', '/state')).data.caps.telegram, true);

// Binary media through the Request/Response bridge, compliance, and workspace isolation on the Blobs store
const PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const up = await call('POST', '/media', { dataUrl: 'data:image/png;base64,' + PNG });
assert.equal(up.status, 201);
const mres = await handler(new Request('https://site.test' + up.data.url), {});
assert.equal(mres.status, 200); assert.equal(mres.headers.get('content-type'), 'image/png');
assert.deepEqual(Buffer.from(await mres.arrayBuffer()), Buffer.from(PNG, 'base64'));
assert.equal((await call('POST', '/compliance/check', { text: 'מבטיח ומרפא' })).data.level, 'high');
const ws = (await call('POST', '/workspaces', { name: 'לקוח' })).data;
const cInWs = (await call('POST', '/campaigns', { name: 'בלקוח' }, { 'x-workspace': ws.id })).data;
assert.ok(!(await call('GET', '/state')).data.campaigns.some(x => x.id === cInWs.id));
assert.deepEqual((await call('GET', '/state', undefined, { 'x-workspace': ws.id })).data.campaigns.map(x => x.id), [cInWs.id]);

// Background AI jobs (Netlify): the API answers { job } at once, the background function finishes it, the client polls
{
  const aiMock = http.createServer((req, res) => {
    let b = ''; req.on('data', c => b += c);
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (req.url === '/bad') { res.statusCode = 529; return res.end('{"error":"overloaded"}'); }
      const draft = { name: 'מרקע', goal: 'לידים', audience: 'קהל', message: 'מסר', posts: [{ day: 0, channel: 'Facebook', text: 'פוסט מהרקע' }] };
      res.end(JSON.stringify({ content: [{ type: 'text', text: JSON.stringify(draft) }] }));
    });
  });
  await new Promise(r => aiMock.listen(0, r));
  process.env.ANTHROPIC_API_KEY = 'sk-test'; process.env.ANTHROPIC_API_URL = `http://127.0.0.1:${aiMock.address().port}/ok`;
  const started = [];
  let jobApp;
  jobApp = createApp(blobsStore(fakeBlobs), { startJob: async id => { started.push(id); setTimeout(() => jobApp.runJob(id), 30); } });
  const jh = makeHandler(jobApp);
  const jcall = async (method, path, body) => {
    const r = await jh(new Request('https://site.test/api' + path, { method, body: body && JSON.stringify(body),
      headers: { 'content-type': 'application/json', 'x-requested-with': 'tizon', authorization: 'Bearer ' + token } }), { ip: '1.2.3.4' });
    return { status: r.status, data: await r.json().catch(() => null) };
  };
  const q = await jcall('POST', '/ai/quick-campaign', { idea: 'רעיון כלשהו', channels: ['Facebook'], days: 7 });
  assert.equal(q.status, 200); assert.ok(q.data.job, 'answers with a job id instead of waiting for the AI');
  assert.equal(started.length, 1);
  let job; for (let i = 0; i < 50; i++) { job = (await jcall('GET', '/jobs/' + q.data.job)).data; if (job.status === 'done' || job.status === 'error') break; await new Promise(r => setTimeout(r, 40)); }
  assert.equal(job.status, 'done'); assert.equal(job.result.draft.posts[0].text, 'פוסט מהרקע'); assert.equal(job.result.ai, true);
  assert.equal((await jcall('GET', '/jobs/' + 'f'.repeat(24))).status, 404);
  // a failing AI service is reported through the job, with the reason
  process.env.ANTHROPIC_API_URL = `http://127.0.0.1:${aiMock.address().port}/bad`;
  const bq = await jcall('POST', '/ai/quick-campaign', { idea: 'רעיון כלשהו', channels: ['Facebook'], days: 7 });
  let bj; for (let i = 0; i < 50; i++) { bj = (await jcall('GET', '/jobs/' + bq.data.job)).data; if (bj.status === 'done' || bj.status === 'error') break; await new Promise(r => setTimeout(r, 40)); }
  assert.equal(bj.status, 'error'); assert.match(bj.error, /529/);
  // without an AI key nothing is queued: the instant template path answers inline
  delete process.env.ANTHROPIC_API_KEY;
  const inline = await jcall('POST', '/ai/quick-campaign', { idea: 'רעיון כלשהו', channels: ['Facebook'], days: 7 });
  assert.equal(inline.data.ai, false); assert.ok(!inline.data.job);
  delete process.env.ANTHROPIC_API_URL; aiMock.close();
}
assert.equal((await call('POST', '/logout')).status, 200);
assert.equal((await call('GET', '/state')).status, 401);

// The first request may arrive before ADMIN_* env vars are available; the admin must still be created later.
{
  const mem2 = new Map();
  const blobs2 = { ...fakeBlobs, get: async k => mem2.has(k) ? JSON.parse(mem2.get(k)) : null, setJSON: async (k, v) => { mem2.set(k, JSON.stringify(v)); },
    delete: async k => { mem2.delete(k); }, list: async ({ prefix }) => ({ blobs: [...mem2.keys()].filter(k => k.startsWith(prefix)).map(key => ({ key })) }) };
  const h2 = makeHandler(createApp(blobsStore(blobs2)));
  const login = () => h2(new Request('https://site.test/api/login', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ email: 'late@b.co', password: 'password123' }) }), {});
  const saved = process.env.ADMIN_PASSWORD, savedEmail = process.env.ADMIN_EMAIL;
  delete process.env.ADMIN_PASSWORD; delete process.env.ADMIN_EMAIL;
  assert.equal((await login()).status, 401);
  process.env.ADMIN_EMAIL = 'late@b.co'; process.env.ADMIN_PASSWORD = 'password123';
  assert.equal((await login()).status, 200, 'admin is created once env vars appear');
  process.env.ADMIN_PASSWORD = saved; process.env.ADMIN_EMAIL = savedEmail;
}
console.log('netlify adapter tests passed');
process.exit(0);
