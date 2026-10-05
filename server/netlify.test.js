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
