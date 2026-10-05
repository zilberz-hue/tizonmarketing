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

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'tizon-'));
process.env.ADMIN_EMAIL = 'a@b.co';
process.env.ADMIN_PASSWORD = 'password123';
process.env.PUBLISH_WEBHOOK_URL = `http://127.0.0.1:${mock.address().port}/hook`;
const { server, tick } = await import('./server.js');
await new Promise(r => server.listen(0, r));
const base = `http://127.0.0.1:${server.address().port}`;

let cookie = '';
const call = async (method, p, body, hdr = {}) => {
  const r = await fetch(base + p, { method, headers: { 'content-type': 'application/json', 'x-requested-with': 'tizon', cookie, ...hdr }, body: body && JSON.stringify(body) });
  const sc = r.headers.get('set-cookie'); if (sc) cookie = sc.split(';')[0];
  return { status: r.status, data: await r.json().catch(() => null) };
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

const del = await call('DELETE', '/api/posts/' + p.id);
assert.equal(del.status, 200);
console.log('all tests passed');
process.exit(0);
