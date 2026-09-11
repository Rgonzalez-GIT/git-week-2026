import 'dotenv/config';
import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { randomUUID } from 'node:crypto';

/**
 * Flujo de compra completo vía HTTP (modo demo, DEMO_MODE=true):
 * productos -> carrito -> reserva -> orden -> cupón -> pago -> webhook.
 * Requiere PostgreSQL activo (la DB ya tiene los cupones del seed).
 */
describe('Demo checkout (e2e)', () => {
let app: INestApplication;
    let prisma: {
      product: any;
      inventory: any;
      payment: any;
      order: any;
      cartItem: any;
      inventoryReservation: any;
      idempotencyKey: any;
      coupon: any;
      couponRedemption: any;
      qrImage: any;
      user: any;
      promotion: any;
    };

  beforeAll(async () => {
    process.env.DEMO_MODE = 'true';
    const { AppModule } = await import('./../src/app.module.js');
    const { PrismaService } = await import('./../src/prisma/prisma.service.js');

    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    await app.init();
    prisma = app.get(PrismaService);

    // Purga restos de corridas anteriores (FK de coupons/qr) antes de testear.
    const leftover = await prisma.user.findUnique({ where: { email: 'customer@gitweek.local' } });
    if (leftover) {
      await prisma.payment.deleteMany({ where: { order: { userId: leftover.id } } });
      await prisma.qrImage.deleteMany({ where: { coupon: { order: { userId: leftover.id } } } });
      await prisma.couponRedemption.deleteMany({ where: { coupon: { order: { userId: leftover.id } } } });
      await prisma.coupon.deleteMany({ where: { order: { userId: leftover.id } } });
      await prisma.idempotencyKey.deleteMany({ where: { order: { userId: leftover.id } } });
      await prisma.order.deleteMany({ where: { userId: leftover.id } });
      await prisma.inventoryReservation.deleteMany({ where: { userId: leftover.id } });
      await prisma.cartItem.deleteMany({ where: { userId: leftover.id } });
    }
  });

  afterAll(async () => {
    await app.close();
  });

  let productId: number;
  let demoUserId: number;
  let usedSessionKeys: string[] = [];

  async function ensureDemoUser() {
    const role = await prisma.role.upsert({
      where: { code: 'CUSTOMER' },
      update: {},
      create: { code: 'CUSTOMER', name: 'Cliente' },
    });
    const user = await prisma.user.upsert({
      where: { email: 'customer@gitweek.local' },
      update: {},
      create: {
        email: 'customer@gitweek.local',
        fullName: 'Cliente Demo',
        passwordHash: 'demo-no-login',
        roleId: role.id,
      },
    });
    return user;
  }

  beforeEach(async () => {
    const product = await prisma.product.create({
      data: {
        slug: `demo-${randomUUID()}`,
        name: 'Plan Demo',
        description: 'Producto para el flujo de compra',
        priceCents: 2900,
      },
    });
    productId = product.id;
    await prisma.inventory.create({
      data: { productId, initialStock: 50, availableStock: 50 },
    });
    const demoUser = await ensureDemoUser();
    demoUserId = demoUser.id;
    usedSessionKeys = [];
  });

  afterEach(async () => {
    await prisma.payment.deleteMany({ where: { order: { userId: demoUserId } } });
    await prisma.qrImage.deleteMany({ where: { coupon: { order: { userId: demoUserId } } } });
    await prisma.couponRedemption.deleteMany({ where: { coupon: { order: { userId: demoUserId } } } });
    await prisma.coupon.deleteMany({ where: { order: { userId: demoUserId } } });
    await prisma.idempotencyKey.deleteMany({ where: { order: { userId: demoUserId } } });
    await prisma.order.deleteMany({ where: { userId: demoUserId } });
    await prisma.inventoryReservation.deleteMany({ where: { userId: demoUserId } });
    await prisma.cartItem.deleteMany({
      where: { OR: [{ userId: demoUserId }, { sessionKey: { in: usedSessionKeys } }] },
    });
    await prisma.inventory.deleteMany({ where: { productId } });
    await prisma.product.deleteMany({ where: { id: productId } });
  });

  it('productos -> carrito -> reserva -> orden -> cupón -> pago -> confirmación', async () => {
    const server = app.getHttpServer();

    const catalog = await request(server).get('/products').expect(200);
    const slugs = catalog.body.map((p: any) => p.slug);
    expect(slugs.sort()).toEqual(['executive', 'general', 'professional']);
    expect(typeof catalog.body[0].initialStock).toBe('number');
    expect(catalog.body[0]).not.toHaveProperty('code');

    const sessionKey = `demo-${randomUUID()}`;
    usedSessionKeys.push(sessionKey);
    await request(server)
      .post(`/cart/session/${sessionKey}/items`)
      .send({ productId, quantity: 2 })
      .expect(201);

    const cart = await request(server).get(`/cart/session/${sessionKey}`).expect(200);
    expect(cart.body.items[0].quantity).toBe(2);
    expect(cart.body.subtotalCents).toBe(5800);

    const reservation = await request(server)
      .post('/demo/reservations')
      .send({ productId, quantity: 2 })
      .expect(201);
    const reservationPublicId = reservation.body.reservation.publicId;

    const order = await request(server)
      .post('/demo/orders')
      .send({ reservationPublicId })
      .expect(201);
    expect(order.body.status).toBe('PAYMENT_PENDING');
    expect(order.body.subtotalCents).toBe(5800);
    expect(order.body.totalCents).toBe(5800);
    const orderPublicId = order.body.publicId;

    const coupon = await request(server)
      .post('/demo/coupons/apply')
      .send({ orderPublicId, code: 'URPxGIT' })
      .expect(201);
    expect(coupon.body.discountCents).toBe(500);
    expect(coupon.body.totalCents).toBe(5300);

    const payment = await request(server)
      .post('/demo/payments')
      .send({ orderPublicId })
      .expect(201);
    expect(payment.body.status).toBe('PENDING');
    expect(payment.body.amountCents).toBe(5300);

    const confirmed = await request(server)
      .post('/demo/payments/confirm')
      .send({ orderPublicId, success: true })
      .expect(201);
    expect(confirmed.body.processed).toBe(true);
    expect(confirmed.body.payment.status).toBe('PAID');
    expect(confirmed.body.order.status).toBe('PAID');

    const stock = await request(server).get(`/products/${productId}/stock`).expect(200);
    expect(stock.body.soldStock).toBe(2);
    expect(stock.body.reservedStock).toBe(0);
    expect(stock.body.availableStock).toBe(48);

    const reservationDb = await prisma.inventoryReservation.findFirst({
      where: { publicId: reservationPublicId },
    });
    expect(reservationDb.status).toBe('CONVERTED');
  });

  it('el replay idempotente no crea otra orden', async () => {
    const server = app.getHttpServer();

    const reservation = await request(server)
      .post('/demo/reservations')
      .send({ productId, quantity: 1 })
      .expect(201);
    const reservationPublicId = reservation.body.reservation.publicId;

    const first = await request(server)
      .post('/demo/orders')
      .send({ reservationPublicId })
      .expect(201);
    const second = await request(server)
      .post('/demo/orders')
      .send({ reservationPublicId })
      .expect(201);

    expect(second.body.publicId).toBe(first.body.publicId);
    const count = await prisma.order.count({ where: { userId: demoUserId } });
    expect(count).toBe(1);
  });

  it('sin stock disponible la reserva es rechazada', async () => {
    const prismaLocal = prisma;
    await prismaLocal.inventory.update({
      where: { productId },
      data: { availableStock: 0 },
    });

    const server = app.getHttpServer();
    const res = await request(server)
      .post('/demo/reservations')
      .send({ productId, quantity: 1 });
    expect(res.status).toBe(409);
  });
});