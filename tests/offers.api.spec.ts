import './setup-env.cjs';

import { before, beforeEach, describe, it } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../src/api/app.js';
import { query } from '../src/db/index.js';
import { runMigrations } from '../src/db/migrate.js';

let app;

describe('offers API', () => {
  before(async () => {
    await runMigrations();
    app = createApp();
  });

  beforeEach(async () => {
    await query('DELETE FROM offers');
  });

  it('normalizes geo_input into geo_list', async () => {
    const response = await request(app)
      .post('/offers')
      .send({
        target_url: 'https://t.me/example_channel',
        event_type: 'join',
        geo_input: 'CIS, US, Италия',
      });

    assert.equal(response.status, 201);
    assert.equal(response.body.ok, true);
    assert.match(response.body.offer_id, /^[0-9a-f-]{36}$/i);

    const offerId = response.body.offer_id;
    const { rows } = await query('SELECT geo_list FROM offers WHERE id = $1', [offerId]);
    assert.equal(rows.length, 1);

    const { geo_list: geoList } = rows[0];
    assert.ok(Array.isArray(geoList));
    const sorted = [...geoList].sort();
    const expected = ['BY', 'IT', 'KZ', 'RU', 'US'];
    assert.deepStrictEqual(sorted, expected);
  });
});
