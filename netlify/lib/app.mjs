import { getStore } from '@netlify/blobs';
import { createApp } from '../../server/core.js';
import { blobsStore } from './blobs-store.mjs';

process.env.TRUST_PROXY ??= 'true';
export const app = createApp(blobsStore(getStore({ name: 'tizon', consistency: 'strong' })));
