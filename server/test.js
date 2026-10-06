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

const del = await call('DELETE', '/api/posts/' + p.id);
assert.equal(del.status, 200);
console.log('all tests passed');
process.exit(0);
