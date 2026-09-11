import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { setupRequestLogging } from './../src/observability.js';

/**
 * Fase 15 - Observabilidad (e2e).
 * Liveness y readiness (chequeo real de PostgreSQL).
 */
describe('Health checks (Fase 15)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const { AppModule } = await import('./../src/app.module.js');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    setupRequestLogging(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('GET /health responde ok', async () => {
    const res = await request(app.getHttpServer()).get('/health').expect(200);
    expect(res.body.status).toBe('ok');
    expect(res.body.uptime).toBeDefined();
  });

  it('GET /health/ready chequea la base de datos', async () => {
    const res = await request(app.getHttpServer()).get('/health/ready');
    expect(res.body).toMatchObject({ status: 'ok', checks: { database: 'up' } });
  });

  it('responde con X-Request-Id', async () => {
    const res = await request(app.getHttpServer()).get('/coupons').expect(200);
    expect(res.headers['x-request-id']).toBeDefined();
  });
});