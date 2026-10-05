import fs from 'node:fs';
fs.copyFileSync(new URL('../server/core.js', import.meta.url), new URL('../functions/core.js', import.meta.url));
console.log('synced server/core.js -> functions/core.js');
