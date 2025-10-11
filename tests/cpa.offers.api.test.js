import './setup-env.cjs';

import { before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../src/api/app.js';
import { query } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';

let app;
let offerId;

describe('CPA offers API', () => {
  before(async () => {
    await runMigrations();
    app = createApp();
  });

  beforeEach(async () => {
    await query('DELETE FROM offers');
    const result = await query(
      `INSERT INTO offers (target_url, event_type, name, caps_total, base_rate, premium_rate)
       VALUES ($1, $2, $3, $4, $5, $6)
       RETURNING id`,
      [
        'https://t.me/example_channel/123',
        'join_group',
        'Example Offer',
        150,
        100,
        200,
      ]
    );
    offerId = result.rows[0].id;

    await query(
      `UPDATE offers
         SET geo_mode = 'whitelist',
             geo_list = ARRAY['US', 'CA']::text[]
       WHERE id = $1`,
      [offerId]
    );

    await query(`UPDATE offers SET payout_cents = premium_rate WHERE id = $1`, [offerId]);
  });

  it('rejects requests with invalid API key', async () => {
    const response = await request(app)
      .get(`/api/cpa/offers/${offerId}`)
      .set('X-Api-Key', 'invalid-key');

    assert.equal(response.status, 401);
    assert.equal(response.body.error, 'unauthorized');
  });

  it('returns sanitized offer snapshot', async () => {
    const response = await request(app)
      .get(`/api/cpa/offers/${offerId}`)
      .set('X-Api-Key', process.env.CPA_API_KEY);

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, {
      id: offerId,
      title: 'Example Offer',
      action_type: 'join_group',
      target_link: 'https://t.me/example_channel/123',
      geo: { mode: 'whitelist', list: ['US', 'CA'] },
      daily_cap: 150,
      payout_cents: 200,
      tracking_url: `http://localhost:3000/click/${offerId}?uid={your_uid}`,
      status: 'active',
    });
  });
});
