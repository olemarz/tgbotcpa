import 'dotenv/config';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import pg from 'pg';
import { pool } from './index.js';

const { Client } = pg;
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const migrationsDir = path.join(__dirname, 'migrations');
const seedsDir = path.join(__dirname, 'seeds');

async function applyMigrationsWithClient(client, { skip = new Set() } = {}) {
  await client.query('CREATE TABLE IF NOT EXISTS _migrations(id text primary key, applied_at timestamptz default now())');
  const files = fs.existsSync(migrationsDir) ? fs.readdirSync(migrationsDir).filter(f => f.endsWith('.sql')).sort() : [];
  for (const file of files) {
    if (skip.has(file)) {
      console.warn('[migrate] skipping', file, 'for in-memory database');
      continue;
    }
    const done = await client.query('SELECT 1 FROM _migrations WHERE id=$1', [file]);
    if (done.rowCount) continue;
    const sql = fs.readFileSync(path.join(migrationsDir, file), 'utf8');
    console.log('-> applying', file);
    await client.query('BEGIN');
    try {
      await client.query(sql);
      await client.query('INSERT INTO _migrations(id) VALUES($1)', [file]);
      await client.query('COMMIT');
      console.log('✓', file);
    } catch (e) {
      await client.query('ROLLBACK');
      const message = e?.message || '';
      if (/pg-mem/i.test(message) || /work-in-progress/i.test(message)) {
        console.warn('⚠️ skipping', file, 'due to pg-mem limitation:', message);
        await client
          .query('INSERT INTO _migrations(id) VALUES($1) ON CONFLICT (id) DO NOTHING', [file])
          .catch(() => {});
        continue;
      }
      console.error('✗', file, e.message);
      throw e;
    }
  }
}

async function applySeedsWithClient(client) {
  if (process.env.SEED !== '1') return;
  const files = fs.existsSync(seedsDir) ? fs.readdirSync(seedsDir).filter(f => f.endsWith('.sql')).sort() : [];
  for (const file of files) {
    const sql = fs.readFileSync(path.join(seedsDir, file), 'utf8');
    console.log('-> seeding', file);
    await client.query('BEGIN');
    try {
      await client.query(sql);
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
      const skip = new Set(['2025xxxx_core.sql']);
      await applyMigrationsWithClient(client, { skip });
      await client.query(
        `CREATE UNIQUE INDEX IF NOT EXISTS uniq_attr_click_tg ON attribution(click_id, tg_id)`
      );
      await applySeedsWithClient(client);
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
    await applySeedsWithClient(client);
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
