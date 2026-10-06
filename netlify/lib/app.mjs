import { getStore } from '@netlify/blobs';
import { createApp } from '../../server/core.js';
import { blobsStore } from './blobs-store.mjs';

process.env.TRUST_PROXY ??= 'true';

// Long AI generations exceed the time limit of ordinary functions, so they run as a background function
// (up to 15 minutes). The API answers { job } immediately and the app polls /api/jobs/:id.
const startJob = async jobId => {
  const origin = process.env.URL || process.env.DEPLOY_URL;
  if (!origin) throw new Error('כתובת האתר לא זמינה');
  const r = await fetch(`${origin}/.netlify/functions/ai-job-background`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ jobId }), signal: AbortSignal.timeout(8000) });
  if (!r.ok && r.status !== 202) throw new Error(`background function ${r.status}`);
};

export const app = createApp(blobsStore(getStore({ name: 'tizon', consistency: 'strong' })), { startJob });
