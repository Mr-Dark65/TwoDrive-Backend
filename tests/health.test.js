const request = require('supertest');
const app = require('../server');

describe('Healthcheck', () => {
  it('GET /health should return 200 and {status:"ok"}', async () => {
    const res = await request(app).get('/health');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});
