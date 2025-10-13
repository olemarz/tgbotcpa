/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('src');
const files = [];
(function walk(d) {
  for (const f of fs.readdirSync(d)) {
    const p = path.join(d, f);
    const s = fs.statSync(p);
    if (s.isDirectory()) walk(p);
    else if (p.endsWith('.js') && !p.endsWith('_adsUserFlow.DISABLED.js')) files.push(p);
  }
})(root);

let hasOld = false;
for (const file of files) {
  const txt = fs.readFileSync(file, 'utf8');
  if (/adsUserFlow\.js|handleAdsUserCommand/.test(txt)) {
    console.error('OLD FLOW REF:', file);
    hasOld = true;
  }
}
console.log('Audit complete. Old flow:', hasOld ? 'FOUND' : 'NOT FOUND');
if (hasOld) process.exit(1);
