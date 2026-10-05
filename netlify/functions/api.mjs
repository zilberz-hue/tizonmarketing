import { app } from '../lib/app.mjs';
import { makeHandler } from '../lib/handler.mjs';

export default makeHandler(app);
export const config = { path: '/api/*' };
