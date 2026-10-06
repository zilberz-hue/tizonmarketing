// Firebase Cloud Functions entry. Same logic as the self-hosted server (core.js is copied
// from ../server/core.js by the predeploy step), with Firestore as the database.
import { onRequest } from 'firebase-functions/v2/https';
import { onSchedule } from 'firebase-functions/v2/scheduler';
import { setGlobalOptions } from 'firebase-functions/v2';
import { initializeApp } from 'firebase-admin/app';
import { getFirestore } from 'firebase-admin/firestore';
import { createApp } from './core.js';

process.env.TRUST_PROXY ??= 'true';
setGlobalOptions({ region: process.env.FIREBASE_REGION || 'europe-west1', maxInstances: 5 });
initializeApp();
const fs = getFirestore();

const docId = s => encodeURIComponent(s);
const withId = d => ({ id: d.id, ...d.data() });

const store = {
  async userCount() { return (await fs.collection('users').limit(1).get()).size; },
  async getUser(email) { const d = await fs.collection('users').doc(docId(email)).get(); return d.exists ? d.data() : null; },
  async listUsers() { return (await fs.collection('users').get()).docs.map(d => { const { email, name, role } = d.data(); return { email, name, role }; }); },
  async addUser(email, name, hash, role) {
    try { await fs.collection('users').doc(docId(email)).create({ email, name, hash, role }); }
    catch (e) { throw e.code === 6 ? Object.assign(new Error('exists'), { code: 'EXISTS' }) : e; }
  },
  async createSession(token, email, exp) { await fs.collection('sessions').doc(token).set({ email, exp }); },
  async getSession(token) { const d = await fs.collection('sessions').doc(token).get(); return d.exists ? d.data() : null; },
  async delSession(token) { await fs.collection('sessions').doc(token).delete(); },
  async list(kind) { return (await fs.collection(kind).get()).docs.map(withId); },
  async get(kind, id) { if (!id) return null; const d = await fs.collection(kind).doc(id).get(); return d.exists ? withId(d) : null; },
  async put(kind, id, obj) { const { id: _, ...d } = obj; await fs.collection(kind).doc(id).set(d); return { id, ...d }; },
  async del(kind, id) { await fs.collection(kind).doc(id).delete(); },
  async claim(kind, id, from, to) {
    const ref = fs.collection(kind).doc(id);
    return fs.runTransaction(async t => {
      const d = await t.get(ref);
      if (!d.exists || d.data().status !== from) return false;
      t.update(ref, { status: to });
      return true;
    });
  }
};

const app = createApp(store);

// Netlify proxies /api/* here; the function sees paths like /login, /state, /posts/ID.
export const api = onRequest({ cors: false, timeoutSeconds: 300 }, (req, res) =>
  app.handle(req, res, new URL(req.originalUrl || req.url, 'http://x')));

// The autonomous part: publishes due posts and flags stale leads every minute.
export const scheduler = onSchedule({ schedule: 'every 1 minutes', timeoutSeconds: 300 }, () => app.tick());
