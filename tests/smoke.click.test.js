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
  test('Smoke click test requires PostgreSQL DATABASE_URL', {
    skip: 'DATABASE_URL must point to a PostgreSQL instance',
  }, () => {});
} else {
  const app = createApp();

  before(async () => {
    await runMigrations();
  });

  afterEach(async () => {
    await query('DELETE FROM clicks');
  });

  describe('Smoke: GET /click/:offerId', () => {
    it('redirects to bot and stores start token', async () => {
      const offerId = uuid();
      const response = await request(app)
        .get(`/click/${offerId}`)
        .query({ uid: 'u1', click_id: 'c1' })
        .set('User-Agent', 'smoke-test');

      assert.equal(response.status, 302, 'should redirect');
      const location = response.headers.location;
      assert.ok(location?.startsWith('https://t.me/'), 'redirect location must point to Telegram');

      const { rows } = await query('SELECT start_token FROM clicks WHERE offer_id = $1', [offerId]);
      assert.equal(rows.length, 1, 'clicks entry must be created');
      const startToken = rows[0].start_token;
      assert.ok(startToken && startToken.length >= 6, 'start_token must be generated');

      const useStartApp = String(process.env.USE_STARTAPP ?? 'true').toLowerCase() === 'true';
      const param = useStartApp ? 'startapp' : 'start';
      const expected = `https://t.me/${process.env.BOT_USERNAME}?${param}=${encodeURIComponent(startToken)}`;
      assert.equal(location, expected, 'redirect URL must match generated start token');
    });
  });
}
