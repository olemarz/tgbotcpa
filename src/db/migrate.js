import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { pool } from './index.js';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const dir = path.join(__dirname, 'migrations');

async function applyMigrationsWithClient(client) {
  await client.query('CREATE TABLE IF NOT EXISTS _migrations(id text primary key, applied_at timestamptz default now())');
  const files = fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.sql')).sort() : [];
  for (const file of files) {
    const done = await client.query('SELECT 1 FROM _migrations WHERE id=$1', [file]);
    if (done.rowCount) continue;
    const sql = fs.readFileSync(path.join(dir, file), 'utf8');
    console.log('-> applying', file);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO _migrations(id) VALUES($1)', [file]);
      await client.query('COMMIT');
      console.log('✓', file);
    } catch (e) {
      await client.query('ROLLBACK');
      console.error('✗', file, e.message);
      throw e;
    }
  }
}

export async function runMigrations() {
  const connectionString = process.env.DATABASE_URL || '';
  if (connectionString.startsWith('pgmem://')) {
    const client = await pool.connect();
    try {
      await applyMigrationsWithClient(client);
      console.log('Migration complete');
    } finally {
      client.release();
    }
    return;
  }

  const client = new Client({ connectionString });
  await client.connect();
  try {
    await applyMigrationsWithClient(client);
    console.log('Migration complete');
  } finally {
    await client.end();
  }
}

if (process.argv[1] === __filename) {
  runMigrations()
    .then(async () => {
      const connectionString = process.env.DATABASE_URL || '';
      if (!connectionString.startsWith('pgmem://') && typeof pool?.end === 'function') {
        await pool.end().catch(() => {});
      }
    })
    .catch((e) => {
      console.error(e);
      process.exit(1);
    });
}
