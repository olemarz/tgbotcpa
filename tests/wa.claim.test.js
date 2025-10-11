import './setup-env.cjs';
import assert from 'node:assert/strict';
import { before, afterEach, describe, it } from 'node:test';
import { createHash, createHmac } from 'node:crypto';
import express from 'express';
import request from 'supertest';

import { runMigrations } from '../src/db/migrate.js';
import { query } from '../src/db/index.js';
import { uuid } from '../src/util/id.js';
import { waRouter } from '../src/api/wa.js';

const app = express();
app.use(express.json());
app.use('/api/wa', waRouter);

function buildInitData({ token, userId = 4242, authDateSec = Math.floor(Date.now() / 1000), hashOverride }) {
  const baseParams = new URLSearchParams();
  baseParams.set('auth_date', String(authDateSec));
  baseParams.set('user', JSON.stringify({ id: userId }));
  if (token) {
    baseParams.set('start_param', token);
  }

  const pairs = [];
  for (const [key, value] of baseParams.entries()) {
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();

  const botToken = process.env.BOT_TOKEN || '';
  const secretKey = createHash('sha256').update(botToken).digest();
  const computedHash = createHmac('sha256', secretKey).update(pairs.join('\n')).digest('hex');

  const params = new URLSearchParams(baseParams);
  params.set('hash', hashOverride ?? computedHash);

  return params.toString();
}

before(async () => {
  await runMigrations();
});

afterEach(async () => {
  await query('DELETE FROM clicks');
});

describe('POST /api/wa/claim', () => {
  it('returns 401 for invalid initData signature', async () => {
    const token = 'token-invalid-signature';
    const validInitData = buildInitData({ token });
    const params = new URLSearchParams(validInitData);
    params.set('hash', '00');

    const response = await request(app)
      .post('/api/wa/claim')
      .send({ token, initData: params.toString() });

    assert.equal(response.status, 401);
    assert.equal(response.body.ok, false);
  });

  it('returns 404 for unknown token', async () => {
    const token = 'missing-token';
    const initData = buildInitData({ token });

    const response = await request(app)
      .post('/api/wa/claim')
      .send({ token, initData });

    assert.equal(response.status, 404);
    assert.equal(response.body.ok, false);
  });

  it('returns 200 and ok:true for existing token', async () => {
    const token = 'existing-token';
    const initData = buildInitData({ token, userId: 999 });
    const clickId = uuid();
    const offerId = uuid();

    await query(
      'INSERT INTO clicks (id, offer_id, start_token) VALUES ($1, $2, $3)',
      [clickId, offerId, token],
    );

    const response = await request(app)
      .post('/api/wa/claim')
      .send({ token, initData });

    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { ok: true });

    const { rows } = await query('SELECT tg_id FROM clicks WHERE id = $1', [clickId]);
    assert.equal(rows.length, 1);
    assert.equal(Number(rows[0].tg_id), 999);
  });
});
