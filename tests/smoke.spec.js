import './setup-env.cjs';
import { before, describe, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';

import { createApp } from '../src/api/server.js';
import { runMigrations } from '../src/db/migrate.js';
import { uuid } from '../src/util/id.js';

const expect = (received) => ({
  toBe(expected) {
    assert.strictEqual(received, expected);
  },
});

describe('Smoke', () => {
  let app;

  before(async () => {
    await runMigrations();
    app = await createApp();
  });

  test('/health', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
  });

  test('/click/:offerId (redirect)', async () => {
    const offerId = uuid();
    const res = await request(app)
      .get(`/click/${offerId}`)
      .query({ uid: '42', source: 'test', sub1: 'a', sub2: 'b' })
      .redirects(0);

    expect(res.status).toBe(302);

    const loc = res.headers.location;
    assert.ok(loc.includes('https://t.me/'));
    assert.ok(loc.includes('start=') || loc.includes('startapp='));
  });
});
