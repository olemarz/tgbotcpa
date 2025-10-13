/* eslint-disable no-console */
import fs from 'node:fs';
import path from 'node:path';

const root = path.resolve('src');
const files = [];
(function walk(d){ for (const f of fs.readdirSync(d)) {
  const p = path.join(d, f);
  const s = fs.statSync(p);
  if (s.isDirectory()) walk(p);
  else if (p.endsWith('.js')) files.push(p);
}})(root);

let fail = false;
for (const file of files) {
  const txt = fs.readFileSync(file, 'utf8');
  if (/adsUserFlow\.js|_adsUserFlow\.DISABLED\.js\s*['"]|handleAdsUserCommand/.test(txt)) {
    if (!file.endsWith('_adsUserFlow.DISABLED.js')) {
      console.error('OLD FLOW REF:', file);
      fail = true;
    }
  }
  if (/bot\.hears\(\s*['"]\/ads|bot\.hears\(\s*\/\\?ads|on\(['"]text['"]\)/.test(txt)) {
    // Поищем самодельные перехваты команд
    const maybe = /\/ads/.test(txt);
    if (maybe && !/startAdsWizard/.test(txt)) {
      console.error('POSSIBLE /ads TEXT INTERCEPTOR:', file);
      fail = true;
    }
  }
}
console.log('Audit complete. Problems:', fail ? 'FOUND' : 'NONE');
if (fail) process.exit(1);

