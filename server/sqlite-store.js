import { DatabaseSync } from 'node:sqlite';

export function sqliteStore(file) {
  const db = new DatabaseSync(file);
  db.exec(`
    CREATE TABLE IF NOT EXISTS users(email TEXT PRIMARY KEY, name TEXT, hash TEXT, role TEXT);
    CREATE TABLE IF NOT EXISTS sessions(token TEXT PRIMARY KEY, email TEXT, exp INTEGER);
    CREATE TABLE IF NOT EXISTS items(kind TEXT, id TEXT, data TEXT, PRIMARY KEY(kind, id));
  `);
  const getItem = (kind, id) => { const r = db.prepare('SELECT data FROM items WHERE kind=? AND id=?').get(kind, id); return r ? { id, ...JSON.parse(r.data) } : null; };
  return {
    async userCount() { return db.prepare('SELECT COUNT(*) n FROM users').get().n; },
    async getUser(email) { return db.prepare('SELECT * FROM users WHERE email=?').get(email) || null; },
    async listUsers() { return db.prepare('SELECT email,name,role FROM users').all(); },
    async addUser(email, name, hash, role) {
      try { db.prepare('INSERT INTO users(email,name,hash,role) VALUES(?,?,?,?)').run(email, name, hash, role); }
      catch { throw Object.assign(new Error('exists'), { code: 'EXISTS' }); }
    },
    async setRole(email, role) { db.prepare('UPDATE users SET role=? WHERE email=?').run(role, email); },
    async createSession(token, email, exp) { db.prepare('DELETE FROM sessions WHERE exp<?').run(Date.now()); db.prepare('INSERT INTO sessions VALUES(?,?,?)').run(token, email, exp); },
    async getSession(token) { return db.prepare('SELECT email, exp FROM sessions WHERE token=?').get(token) || null; },
    async delSession(token) { db.prepare('DELETE FROM sessions WHERE token=?').run(token); },
    async list(kind) { return db.prepare('SELECT id, data FROM items WHERE kind=?').all(kind).map(r => ({ id: r.id, ...JSON.parse(r.data) })); },
    get: async (kind, id) => (id ? getItem(kind, id) : null),
    async put(kind, id, obj) { const { id: _, ...d } = obj; db.prepare('INSERT OR REPLACE INTO items(kind,id,data) VALUES(?,?,?)').run(kind, id, JSON.stringify(d)); return { id, ...d }; },
    async del(kind, id) { db.prepare('DELETE FROM items WHERE kind=? AND id=?').run(kind, id); },
    async claim(kind, id, from, to) {
      const cur = getItem(kind, id);
      if (!cur || cur.status !== from) return false;
      const { id: _, ...d } = cur; d.status = to;
      db.prepare('UPDATE items SET data=? WHERE kind=? AND id=?').run(JSON.stringify(d), kind, id);
      return true;
    }
  };
}
