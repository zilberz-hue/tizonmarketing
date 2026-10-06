// Generates docs/הוראות-הפעלה.md from the single source (server/guide-content.js).
import fs from 'node:fs';
import { manualMarkdown } from '../server/guide-content.js';

const out = new URL('../docs/הוראות-הפעלה.md', import.meta.url);
fs.mkdirSync(new URL('../docs/', import.meta.url), { recursive: true });
fs.writeFileSync(out, manualMarkdown());
console.log('wrote docs/הוראות-הפעלה.md');
