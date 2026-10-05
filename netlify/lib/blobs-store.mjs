// Store adapter over a Netlify Blobs store (anything with get/setJSON/delete/list).
const enc = encodeURIComponent;

export function blobsStore(blobs) {
  const getJSON = async key => (await blobs.get(key, { type: 'json' })) ?? null;
  const listKeys = async prefix => (await blobs.list({ prefix })).blobs.map(b => b.key);
  const withId = (id, d) => d && { id, ...d };
  return {
    async userCount() { return (await listKeys('users/')).length; },
    async getUser(email) { return getJSON('users/' + enc(email)); },
    async listUsers() {
      const all = await Promise.all((await listKeys('users/')).map(getJSON));
      return all.filter(Boolean).map(({ email, name, role }) => ({ email, name, role }));
    },
    async addUser(email, name, hash, role) {
      const key = 'users/' + enc(email);
      if (await getJSON(key)) throw Object.assign(new Error('exists'), { code: 'EXISTS' });
      await blobs.setJSON(key, { email, name, hash, role });
    },
    async createSession(token, email, exp) { await blobs.setJSON('sessions/' + token, { email, exp }); },
    getSession: token => getJSON('sessions/' + token),
    async delSession(token) { await blobs.delete('sessions/' + token); },
    async list(kind) {
      const keys = await listKeys(`items/${kind}/`);
      const rows = await Promise.all(keys.map(async k => withId(k.split('/')[2], await getJSON(k))));
      return rows.filter(Boolean);
    },
    async get(kind, id) { return id ? withId(id, await getJSON(`items/${kind}/${enc(id)}`)) : null; },
    async put(kind, id, obj) { const { id: _, ...d } = obj; await blobs.setJSON(`items/${kind}/${enc(id)}`, d); return { id, ...d }; },
    async del(kind, id) { await blobs.delete(`items/${kind}/${enc(id)}`); },
    // Best-effort (Blobs has no transactions); the scheduler runs as a single instance per minute.
    async claim(kind, id, from, to) {
      const key = `items/${kind}/${enc(id)}`, cur = await getJSON(key);
      if (!cur || cur.status !== from) return false;
      await blobs.setJSON(key, { ...cur, status: to });
      return true;
    }
  };
}
