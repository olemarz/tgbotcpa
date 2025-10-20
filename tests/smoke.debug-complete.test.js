import './setup-env.cjs';
import assert from 'node:assert/strict';
import { afterEach, before, describe, it, test } from 'node:test';
import request from 'supertest';

import { createApp } from '../src/api/app.js';
import { query } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';
import { uuid } from '../src/util/id.js';

const databaseUrl = process.env.DATABASE_URL || '';
const isPgMem = databaseUrl.startsWith('pgmem://');

if (!databaseUrl || isPgMem) {
  test('Smoke debug-complete requires PostgreSQL DATABASE_URL', {
    skip: 'DATABASE_URL must point to a PostgreSQL instance',
  }, () => {});
} else {
  const app = createApp();

  before(async () => {
    await runMigrations();
  });

  afterEach(async () => {
    await query('DELETE FROM postbacks');
  });

  describe('Smoke: POST /debug/complete', () => {
    it('returns dry run response when CPA_PB_URL is empty', async () => {
      const offerId = uuid();
      const response = await request(app)
        .post('/debug/complete')
        .set('x-debug-token', process.env.DEBUG_TOKEN)
        .send({
          offer_id: offerId,
          tg_id: 123456,
          uid: 'smoke-uid',
          click_id: 'smoke-click',
          event_type: 'join_group',
        });

      assert.equal(response.status, 200, 'should respond with 200');
      assert.equal(response.body.ok, true, 'response ok must be true');
      assert.equal(response.body.dryRun, true, 'dryRun must be true when CPA url is empty');

      const { rows } = await query('SELECT status FROM postbacks WHERE tg_id = $1', [123456]);
      assert.equal(rows.length, 1, 'postback entry must be recorded');
      assert.equal(rows[0].status, 'dry-run', 'postback should be recorded as dry-run');
    });
  });
}
