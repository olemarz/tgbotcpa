import './setup-env.js';
import assert from 'node:assert/strict';
import { before, afterEach, describe, it } from 'node:test';
import request from 'supertest';

import { createApp } from '../src/api/app.js';
import { runMigrations } from '../src/db/migrate.js';
import { query } from '../src/db/index.js';
import { uuid } from '../src/util/id.js';
import { _reset as resetIdempotency } from '../src/util/idempotency.js';

const app = createApp();

before(async () => {
  await runMigrations();
});

afterEach(async () => {
  await query('DELETE FROM postbacks');
  await query('DELETE FROM events');
  await query('DELETE FROM attribution');
  await query('DELETE FROM clicks');
  resetIdempotency();
});

describe('POST /debug/complete', () => {
  it('returns ok and signature on dry-run', async () => {
    const payload = {
      offer_id: uuid(),
      tg_id: 100500,
      uid: 'user-1',
      click_id: 'click-1',
      event: 'join_group',
    };

    const response = await request(app)
      .post('/debug/complete')
      .set('x-debug-token', process.env.DEBUG_TOKEN)
      .send(payload);

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.status, null);
    assert.equal(response.body.http_status, null);
    assert.equal(response.body.dryRun, true);
    assert.equal(response.body.dedup, false);
    assert.ok(typeof response.body.signature === 'string');
    assert.equal(response.body.signature.length, 64);

    const { rows } = await query('SELECT offer_id, tg_id, event, status FROM postbacks');
    assert.equal(rows.length, 1);
    assert.equal(rows[0].offer_id, payload.offer_id);
    assert.equal(Number(rows[0].tg_id), payload.tg_id);
    assert.equal(rows[0].event, payload.event);
    assert.equal(rows[0].status, 'dry-run');
  });
});
