import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { Redis } from 'ioredis';

/**
 * Fase 9 - Cola virtual (e2e).
 * Requiere Redis activo (REDIS_HOST/REDIS_PORT). Si no hay Redis, se omite.
 */
describe('Cola virtual Redis (Fase 9)', () => {
  let app: INestApplication;
  let redisOk = false;
  let adminToken = '';
  let customerToken = '';
  let productId: number;

  beforeAll(async () => {
    // Verificar Redis
    const redis = new Redis({
      host: process.env.REDIS_HOST ?? 'localhost',
      port: Number(process.env.REDIS_PORT ?? 6379),
      lazyConnect: true,
      connectTimeout: 2000,
    });
    try {
      await redis.connect();
      await redis.ping();
      redisOk = true;
      redis.disconnect();
    } catch {
      redisOk = false;
      console.warn('Redis no disponible: omitiendo test de cola virtual.');
      return;
    }

    const { AppModule } = await import('./../src/app.module.js');
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();

    // Login como admin
    const adminRes = await request(app.getHttpServer())
      .post('/auth/login')
      .send({ email: 'admin@gitweek.local', password: 'ChangeMe123!' });
    adminToken = adminRes.body.accessToken ?? '';

    // Registrar un customer fresco
    const custRes = await request(app.getHttpServer())
      .post('/auth/register')
      .send({
        email: `test-queue-${Date.now()}@test.com`,
        password: 'TestPass123456',
        fullName: 'Queue Test User',
      });
    customerToken = custRes.body.accessToken ?? '';

    // Crear producto para la cola
    const { PrismaService } = await import('./../src/prisma/prisma.service.js');
    const prisma = app.get(PrismaService);
    const product = await prisma.product.create({
      data: {
        slug: `queue-test-${Date.now()}`,
        name: 'Plan Cola Test',
        description: 'Producto para test de cola virtual',
        priceCents: 5000,
      },
    });
    productId = product.id;
  });

  afterAll(async () => {
    if (app) await app.close();
  });

  it('se une a la cola y obtiene posición', async () => {
    if (!redisOk) return;

    const res = await request(app.getHttpServer())
      .post('/queue/join')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ productId })
      .expect(201);

    expect(res.body.position).toBe(1);
    expect(res.body.size).toBeGreaterThanOrEqual(1);
  });

  it('consulta posición en la cola', async () => {
    if (!redisOk) return;

    const res = await request(app.getHttpServer())
      .get(`/queue/${productId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    expect(res.body.position).toBe(1);
    expect(res.body.size).toBeGreaterThanOrEqual(1);
  });

  it('admin puede sacar siguiente de la cola', async () => {
    if (!redisOk || !adminToken) return;

    const res = await request(app.getHttpServer())
      .post('/queue/dequeue')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ productId })
      .expect(201);

    expect(res.body.userId).toBeDefined();
  });

  it('customer no puede hacer dequeue', async () => {
    if (!redisOk) return;

    await request(app.getHttpServer())
      .post('/queue/dequeue')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ productId })
      .expect(403);
  });

  it('abandona la cola', async () => {
    if (!redisOk) return;

    // Re-unirse primero
    await request(app.getHttpServer())
      .post('/queue/join')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ productId });

    const res = await request(app.getHttpServer())
      .delete(`/queue/${productId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    expect(res.body.left).toBe(true);
  });

  it('admin puede vaciar la cola', async () => {
    if (!redisOk || !adminToken) return;

    // Unirse primero
    await request(app.getHttpServer())
      .post('/queue/join')
      .set('Authorization', `Bearer ${customerToken}`)
      .send({ productId });

    await request(app.getHttpServer())
      .delete(`/queue/${productId}/flush`)
      .set('Authorization', `Bearer ${adminToken}`)
      .expect(200);

    // Verificar cola vacía
    const status = await request(app.getHttpServer())
      .get(`/queue/${productId}`)
      .set('Authorization', `Bearer ${customerToken}`)
      .expect(200);

    expect(status.body.position).toBe(0);
    expect(status.body.size).toBe(0);
  });
});