import { app } from '../lib/app.mjs';

// Publishes due posts and flags stale leads, every minute.
export default async () => { await app.tick(); };
export const config = { schedule: '* * * * *' };
