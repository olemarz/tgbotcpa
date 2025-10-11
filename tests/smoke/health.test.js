import '../setup-env.cjs';
import { describe, it } from 'node:test';
import { createApp } from '../../src/api/app.js';
import request from 'supertest';

const app = createApp();

describe('health', () => {
  it('GET /health -> 200 { ok: true }', async () => {
    const res = await request(app).get('/health');
    if (res.status !== 200) throw new Error('status not 200');
    const body = typeof res.body === 'object' ? res.body : JSON.parse(res.text);
    if (!body || body.ok !== true) throw new Error('body.ok !== true');
  });
});
