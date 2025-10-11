import './setup-env.cjs';
import assert from 'node:assert/strict';
import { before, afterEach, describe, it } from 'node:test';
import request from 'supertest';

import { createApp } from '../src/api/app.js';
import { runMigrations } from '../src/db/migrate.js';
import { query } from '../src/db/index.js';
import { uuid } from '../src/util/id.js';

const app = createApp();

before(async () => {
  await runMigrations();
});

afterEach(async () => {
  await query('DELETE FROM postbacks');
  await query('DELETE FROM events');
  await query('DELETE FROM attribution');
  await query('DELETE FROM clicks');
  process.env.ALLOW_TEST_NO_SUB = 'false';
});

describe('GET /click/:offerId', () => {
  it('stores click and redirects to bot', async () => {
    const offerId = uuid();
    const response = await request(app)
      .get(`/click/${offerId}`)
      .query({ uid: 'u1', click_id: 'c1' })
      .set('User-Agent', 'jest-test');

    assert.equal(response.status, 302);
    assert.ok(response.headers.location?.startsWith('https://t.me/'), 'redirect location missing');

    const { rows } = await query('SELECT offer_id, uid, click_id, start_token FROM clicks WHERE offer_id = $1', [offerId]);
    assert.equal(rows.length, 1);

    const record = rows[0];
    assert.equal(record.uid, 'u1');
    assert.equal(record.click_id, 'c1');
    assert.ok(record.start_token?.length >= 6 && record.start_token.length <= 12);

    const useStartApp = String(process.env.USE_STARTAPP ?? 'true').toLowerCase() === 'true';
    const param = useStartApp ? 'startapp' : 'start';
    const expectedLocation = `https://t.me/${process.env.BOT_USERNAME}?${param}=${encodeURIComponent(record.start_token)}`;
    assert.equal(response.headers.location, expectedLocation);
  });

  it('rejects click without uid or click_id when manual mode disabled', async () => {
    process.env.ALLOW_TEST_NO_SUB = 'false';
    const offerId = uuid();
    const response = await request(app).get(`/click/${offerId}`);

    assert.equal(response.status, 400);
    assert.deepEqual(response.body, { ok: false, error: 'uid/sub or click_id is required' });

    const { rowCount } = await query('SELECT 1 FROM clicks WHERE offer_id = $1', [offerId]);
    assert.equal(rowCount, 0);
  });

  it('allows manual click when enabled', async () => {
    process.env.ALLOW_TEST_NO_SUB = 'true';
    const offerId = uuid();
    const response = await request(app).get(`/click/${offerId}`);

    assert.equal(response.status, 302);

    const { rows } = await query('SELECT offer_id, click_id FROM clicks WHERE offer_id = $1', [offerId]);
    assert.equal(rows.length, 1);
    assert.match(rows[0].click_id, /^manual-\d+$/);
  });
});
