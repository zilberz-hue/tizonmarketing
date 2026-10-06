import fs from 'node:fs';
for (const f of ['core.js', 'config.js', 'insights.js'])
  fs.copyFileSync(new URL('../server/' + f, import.meta.url), new URL('../functions/' + f, import.meta.url));
console.log('synced server/{core,config,insights}.js -> functions/');
