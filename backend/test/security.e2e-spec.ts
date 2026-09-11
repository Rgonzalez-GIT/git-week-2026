import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { setupSecurity } from './../src/security.js';

/**
 * Fase 13 - Seguridad HTTP (e2e).
 * Helmet headers presentes y rate limiting efectivo en auth.
 */
describe('Seguridad HTTP (Fase 13)', () => {
  let app: INestApplication;

  beforeAll(async () => {
    const { AppModule } = await import('./../src/app.module.js');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    setupSecurity(app);
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('sirve headers de seguridad de helmet', async () => {
    const res = await request(app.getHttpServer()).get('/coupons').expect(200);
    expect(res.headers['x-content-type-options']).toBe('nosniff');
    expect(res.headers['x-dns-prefetch-control']).toBe('off');
    expect(res.headers['x-frame-options']).toBe('SAMEORIGIN');
    expect(res.headers['strict-transport-security']).toBeDefined();
  });

  it('/auth/login hace rate limiting y responde 429 tras varios intentos', async () => {
    const base = '/auth/login';
    const body = { email: 'nobody@example.com', password: 'wrong-password' };

    let statuses: number[] = [];
    for (let i = 0; i < 6; i += 1) {
      const res = await request(app.getHttpServer()).post(base).send(body);
      statuses.push(res.status);
      if (res.status === 429) break;
    }
    expect(statuses.filter((s) => s === 429).length).toBeGreaterThanOrEqual(1);
    expect(statuses.filter((s) => s === 401).length).toBeGreaterThanOrEqual(1);
    expect(statuses.length).toBeGreaterThanOrEqual(2);
  });
});