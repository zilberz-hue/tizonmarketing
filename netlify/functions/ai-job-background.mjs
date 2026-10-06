import { app } from '../lib/app.mjs';

// Netlify "background" function (name ends with -background): returns 202 at once and may run for up to 15 minutes.
export default async req => {
  const { jobId } = await req.json().catch(() => ({}));
  if (typeof jobId === 'string' && /^[a-f0-9]{24}$/.test(jobId)) await app.runJob(jobId);
};
