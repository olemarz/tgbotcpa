import '../setup-env.cjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import axios from 'axios';

import { createApp } from '../../src/api/app.js';

const app = createApp();

test('GET /health returns ok', async () => {
  const response = await request(app).get('/health');
  assert.equal(response.status, 200);
  assert.deepEqual(response.body, { ok: true });
});

test('POST /postbacks/relay without required fields returns 400', async () => {
  const response = await request(app).post('/postbacks/relay').send({});
  assert.equal(response.status, 400);
  assert.equal(response.body.ok, false);
});

if (process.env.DEBUG_TOKEN) {
  test('POST /debug/complete with minimal payload succeeds', async (t) => {
    const axiosPostMock = t.mock.method(axios, 'post', async () => ({ status: 200, data: {} }));

    const response = await request(app)
      .post('/debug/complete')
      .set('x-debug-token', process.env.DEBUG_TOKEN)
      .send({
        offer_id: '11111111-1111-1111-1111-111111111111',
        uid: 'user-123'
      });

    assert.ok(response.status >= 200 && response.status < 300);
    assert.equal(response.body.ok, true);
    assert.equal(axiosPostMock.mock.calls.length, 1);
  });
}
