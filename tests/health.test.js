import './setup-env.cjs';
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import request from 'supertest';

import { createApp } from '../src/api/app.js';

const app = createApp();

describe('GET /health', () => {
  it('returns ok:true', async () => {
    const response = await request(app).get('/health');
    assert.equal(response.status, 200);
    assert.deepEqual(response.body, { ok: true });
  });
});
