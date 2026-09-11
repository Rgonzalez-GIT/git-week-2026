import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';
import { AppModule } from './../src/app.module.js';
import { PrismaService } from './../src/prisma/prisma.service.js';

/**
 * Fase 7 - Carrito por HTTP (guest cart con sessionKey).
 * Requiere PostgreSQL activo. Prueba endpoints + validación de DTO.
 */
describe('CartController (e2e)', () => {
  let app: INestApplication;
  let prisma: PrismaService;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);
  });

  afterAll(async () => {
    await app.close();
  });

  async function createProduct(priceCents: number) {
    return prisma.product.create({
      data: { slug: `cart-e2e-${randomUUID()}`, name: 'Producto e2e', priceCents },
    });
  }

  it('flujo completo: agregar -> listar -> actualizar -> eliminar', async () => {
    const product = await createProduct(1000);
    const sessionKey = `e2e-${randomUUID()}`;
    const server = app.getHttpServer();

    await request(server).post(`/cart/session/${sessionKey}/items`).send({ productId: product.id }).expect(201);

    let res = await request(server).get(`/cart/session/${sessionKey}`).expect(200);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.subtotalCents).toBe(1000);

    await request(server)
      .patch(`/cart/session/${sessionKey}/items/${product.id}`)
      .send({ quantity: 3 })
      .expect(200);

    res = await request(server).get(`/cart/session/${sessionKey}`).expect(200);
    expect(res.body.items[0].quantity).toBe(3);
    expect(res.body.subtotalCents).toBe(3000);

    await request(server).delete(`/cart/session/${sessionKey}/items/${product.id}`).expect(200);

    res = await request(server).get(`/cart/session/${sessionKey}`).expect(200);
    expect(res.body.items).toHaveLength(0);

    await prisma.product.delete({ where: { id: product.id } });
  });

  it('valida el body: cantidad inválida y producto inexistente', async () => {
    const product = await createProduct(500);
    const sessionKey = `e2e-${randomUUID()}`;
    const server = app.getHttpServer();

    await request(server)
      .post(`/cart/session/${sessionKey}/items`)
      .send({ productId: product.id, quantity: 0 })
      .expect(400);

    await request(server)
      .post(`/cart/session/${sessionKey}/items`)
      .send({ productId: 99999999 })
      .expect(404);

    await request(server)
      .patch(`/cart/session/${sessionKey}/items/${product.id}`)
      .send({ quantity: 'abc' })
      .expect(400);

    await prisma.product.delete({ where: { id: product.id } });
  });
});