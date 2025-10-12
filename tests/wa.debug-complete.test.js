import './setup-env.cjs';

import assert from 'node:assert/strict';
import { before, afterEach, describe, it } from 'node:test';
import express from 'express';
import request from 'supertest';

import { waRouter } from '../src/api/wa.js';
import { runMigrations } from '../src/db/migrate.js';
import { query } from '../src/db/index.js';
import { uuid } from '../src/util/id.js';

const app = express();
app.use(express.json());
app.use('/api/wa', waRouter);

before(async () => {
  await runMigrations();
});

afterEach(async () => {
  await query('DELETE FROM postbacks');
  await query('DELETE FROM events');
  await query('DELETE FROM attribution');
  await query('DELETE FROM clicks');
  await query('DELETE FROM offers');
});

describe('POST /api/wa/debug/complete', () => {
  it('requires debug token header', async () => {
    const response = await request(app).post('/api/wa/debug/complete').send({});

    assert.equal(response.status, 401);
    assert.deepEqual(response.body, { ok: false, error: 'unauthorized' });
  });

  it('records event and triggers postback using token', async () => {
    const offerId = uuid();
    const clickId = uuid();
    const token = 'token-123';
    const tgId = 123456;

    await query(
      `INSERT INTO offers (id, target_url, event_type) VALUES ($1, $2, $3)`,
      [offerId, 'https://example.com', 'join_group'],
    );

    await query(
      `INSERT INTO clicks (id, offer_id, start_token, tg_id, uid) VALUES ($1, $2, $3, $4, $5)`,
      [clickId, offerId, token, tgId, 'user-uid'],
    );

    const response = await request(app)
      .post('/api/wa/debug/complete')
      .set('x-debug-token', process.env.DEBUG_TOKEN)
      .send({ token, event: 'join_group' });

    assert.equal(response.status, 200);
    assert.equal(response.body.ok, true);
    assert.equal(response.body.dryRun, true);
    assert.equal(response.body.dedup, false);
    assert.ok(typeof response.body.signature === 'string');
    assert.equal(response.body.signature.length, 64);

    const { rows: events } = await query(
      `SELECT offer_id, tg_id, type FROM events WHERE offer_id = $1`,
      [offerId],
    );
    assert.equal(events.length, 1);
    assert.equal(events[0].offer_id, offerId);
    assert.equal(Number(events[0].tg_id), tgId);
    assert.equal(events[0].type, 'join_group');

    const { rows: attributionRows } = await query(
      `SELECT offer_id, tg_id, state FROM attribution WHERE click_id = $1`,
      [clickId],
    );
    assert.equal(attributionRows.length, 1);
    assert.equal(attributionRows[0].offer_id, offerId);
    assert.equal(Number(attributionRows[0].tg_id), tgId);
    assert.equal(attributionRows[0].state, 'converted');

    const { rows: postbacks } = await query(
      `SELECT offer_id, tg_id, event, status FROM postbacks WHERE offer_id = $1`,
      [offerId],
    );
    assert.equal(postbacks.length, 1);
    assert.equal(postbacks[0].offer_id, offerId);
    assert.equal(Number(postbacks[0].tg_id), tgId);
    assert.equal(postbacks[0].event, 'join_group');
    assert.equal(postbacks[0].status, 'dry-run');
  });
});
