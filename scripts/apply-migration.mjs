import 'dotenv/config';
import { readFileSync } from 'node:fs';
import { query } from '../src/db/index.js';

const file = process.argv[2];
if (!file) {
  console.error('Usage: node scripts/apply-migration.mjs <path-to-sql>');
  process.exit(1);
}
const sql = readFileSync(file, 'utf8');
console.log('[MIGRATION] applying:', file);
const res = await query(sql);
console.log('[MIGRATION] done:', res?.command ?? 'OK');
process.exit(0);
