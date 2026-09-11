import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';

/**
 * Fase 14 - Admin (e2e).
 * Verifica que solo el rol ADMIN accede a los endpoints de gestión.
 * Requiere DB sembrada con admin@gitweek.local (ChangeMe123!) y
 * customer@gitweek.local (demo-no-login).
 */
describe('Admin panel (Fase 14)', () => {
  let app: INestApplication;
  let adminToken: string;
  let customerToken: string;

  beforeAll(async () => {
    const { AppModule } = await import('./../src/app.module.js');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // Login como admin (seeded con password ChangeMe123!)
    const adminRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@gitweek.local', password: 'ChangeMe123!' });
    adminToken = adminRes.body.accessToken ?? '';

    // Registrar un usuario fresco como customer para no depender del seed
    const custRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `test-admin-${Date.now()}@test.com`,
        password: 'TestPass123456',
        fullName: 'Admin Test Customer',
      });
    customerToken = custRes.body.accessToken ?? '';
  });

  afterAll(async () => {
    await app.close();
  });

  const authHeaders = (token: string) => ({ Authorization: `Bearer ${token}` });

  it('GET /admin/stats sin token → 401', async () => {
    await request(app.getHttpServer()).get('/admin/stats').expect(401);
  });

  it('GET /admin/stats con token de customer → 403', async () => {
    await request(app.getHttpServer())
      .get('/admin/stats')
      .set(authHeaders(customerToken))
      .expect(403);
  });

  it('GET /admin/stats con token de admin → 200 + stats', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/stats')
      .set(authHeaders(adminToken))
      .expect(200);

    expect(res.body).toMatchObject({
      users: expect.any(Number),
      orders: expect.any(Number),
      products: expect.any(Number),
      promotions: expect.any(Number),
    });
  });

  it('GET /admin/users → lista de usuarios (admin)', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/users')
      .set(authHeaders(adminToken))
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0]).toHaveProperty('email');
    expect(res.body[0]).toHaveProperty('role');
  });

  it('GET /admin/promotions → lista de promociones (admin)', async () => {
    const res = await request(app.getHttpServer())
      .get('/admin/promotions')
      .set(authHeaders(adminToken))
      .expect(200);

    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);
    expect(res.body[0]).toHaveProperty('code');
  });
});