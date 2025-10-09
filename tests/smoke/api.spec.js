import request from 'supertest';
import axios from 'axios';
import { jest } from '@jest/globals';

let app;

beforeAll(async () => {
  const { createApp } = await import('../../src/api/app.js');
  app = createApp();
});

afterAll(() => {
  jest.restoreAllMocks();
});

describe('API smoke tests', () => {
  test('GET /health returns ok', async () => {
    const response = await request(app).get('/health');
    expect(response.status).toBe(200);
    expect(response.body).toEqual({ ok: true });
  });

  test('POST /postbacks/relay without required fields returns 400', async () => {
    const response = await request(app).post('/postbacks/relay').send({});
    expect(response.status).toBe(400);
    expect(response.body).toMatchObject({ ok: false });
  });

  if (process.env.DEBUG_TOKEN) {
    test('POST /debug/complete with minimal payload succeeds', async () => {
      jest.spyOn(axios, 'post').mockResolvedValue({ status: 200, data: {} });

      const response = await request(app)
        .post('/debug/complete')
        .set('x-debug-token', process.env.DEBUG_TOKEN)
        .send({
          offer_id: '11111111-1111-1111-1111-111111111111',
          uid: 'user-123'
        });

      expect(response.status).toBeGreaterThanOrEqual(200);
      expect(response.status).toBeLessThan(300);
      expect(response.body).toMatchObject({ ok: true });
      expect(axios.post).toHaveBeenCalledTimes(1);
    });
  }
});
