import '../setup-env.cjs';
import assert from 'node:assert/strict';
import { after, before, describe, it, test } from 'node:test';
import { Client } from 'pg';

const databaseUrl = process.env.DATABASE_URL || '';
const isPgMem = databaseUrl.startsWith('pgmem://');

if (!databaseUrl || isPgMem) {
  test('Database contract checks require a PostgreSQL DATABASE_URL', {
    skip: 'DATABASE_URL must point to a PostgreSQL instance',
  }, () => {});
} else {
  const client = new Client({ connectionString: databaseUrl });

  before(async () => {
    await client.connect();
  });

  after(async () => {
    await client.end();
  });

  async function fetchRows(query, params = []) {
    const { rows } = await client.query(query, params);
    return rows;
  }

  describe('Database schema contracts', () => {
    it('contains required tables', async () => {
      const requiredTables = ['clicks', 'offers', 'attribution', 'events', 'postbacks'];
      const rows = await fetchRows(
        `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public' AND table_name = ANY($1::text[])`,
        [requiredTables]
      );
      const found = new Set(rows.map((row) => row.table_name));
      for (const table of requiredTables) {
        assert.ok(found.has(table), `Missing table: ${table}`);
      }
    });

    it('enforces clicks table structure', async () => {
      const columns = await fetchRows(
        `SELECT column_name, data_type FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'clicks'`
      );
      const types = Object.fromEntries(columns.map(({ column_name, data_type }) => [column_name, data_type]));
      assert.equal(types.start_token, 'text', 'clicks.start_token must be text');
      assert.equal(types.tg_id, 'bigint', 'clicks.tg_id must be bigint');
      assert.equal(types.used_at, 'timestamp with time zone', 'clicks.used_at must be timestamptz');
    });

    it('enforces timestamp defaults', async () => {
      const tables = ['attribution', 'events', 'postbacks'];
      for (const table of tables) {
        const columns = await fetchRows(
          `SELECT column_name, data_type, column_default FROM information_schema.columns WHERE table_schema = 'public' AND table_name = $1`,
          [table]
        );
        const tgColumn = columns.find((col) => col.column_name === 'tg_id');
        assert.ok(tgColumn, `${table}.tg_id column missing`);
        assert.equal(tgColumn.data_type, 'bigint', `${table}.tg_id must be bigint`);

        const createdAt = columns.find((col) => col.column_name === 'created_at');
        assert.ok(createdAt, `${table}.created_at column missing`);
        assert.equal(createdAt.data_type, 'timestamp with time zone', `${table}.created_at must be timestamptz`);
        assert.ok(
          typeof createdAt.column_default === 'string' && createdAt.column_default.includes('now'),
          `${table}.created_at must default to now()`
        );
      }
    });

    it('has required indexes', async () => {
      const requiredIndexes = new Map([
        ['idx_clicks_start_token', { unique: true }],
        ['idx_clicks_tg_id', { unique: false }],
        ['idx_attr_tg', { unique: false }],
        ['idx_events_tg', { unique: false }],
        ['idx_postbacks_tg', { unique: false }],
      ]);

      const rows = await fetchRows(
        `SELECT indexname, indexdef FROM pg_indexes WHERE schemaname = 'public' AND indexname = ANY($1::text[])`,
        [Array.from(requiredIndexes.keys())]
      );
      const indexMap = new Map(rows.map((row) => [row.indexname, row.indexdef]));

      for (const [name, { unique }] of requiredIndexes.entries()) {
        assert.ok(indexMap.has(name), `Missing index: ${name}`);
        const definition = indexMap.get(name) || '';
        if (unique) {
          assert.ok(/UNIQUE/i.test(definition), `${name} must be UNIQUE`);
        }
      }
    });
  });
}
