import 'dotenv/config';
import { ConflictException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { ReservationService } from '../src/reservations/reservation.service.js';
import { OrderService } from '../src/orders/order.service.js';
import { PaymentService } from '../src/payments/payment.service.js';
import { CouponService } from '../src/coupons/coupon.service.js';
import { CouponRewardService } from '../src/coupons/coupon-reward.service.js';
import { OrderStatus, PaymentProvider, PromotionStatus } from '../src/generated/prisma/enums.js';

/**
 * Fase 7-8/19 - Test de integracion de cupones de descuento.
 * Codigos funcionales: URPxGIT, UTPxGIT, UNABxGIT (S/5 = 500 centavos).
 * El descuento se aplica sobre una orden PAYMENT_PENDING; el replay del mismo
 * codigo es idempotente y un segundo codigo distinto es rechazado. La capacidad
 * (maxRedemptions) se consume con UPDATE atomico.
 */
const config = new ConfigService(process.env as Record<string, string>);
const prisma = new PrismaService(config);

let dbAvailable = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  console.warn('DB no disponible: omitiendo test de cupones.');
}

afterAll(async () => {
  await prisma.$disconnect();
});

function buildServices() {
  const inventory = new InventoryService(prisma);
  const reservations = new ReservationService(prisma, inventory, config);
  const orders = new OrderService(prisma);
  const couponRewards = new CouponRewardService(prisma);
  const payments = new PaymentService(prisma, reservations, couponRewards, config);
  const coupons = new CouponService(prisma);
  return { reservations, orders, payments, coupons };
}

const COUPONS_SEED = [
  { code: 'URPxGIT', name: 'Descuento URP' },
  { code: 'UTPxGIT', name: 'Descuento UTP' },
  { code: 'UNABxGIT', name: 'Descuento UNAB' },
];
const DISCOUNT_CENTS = 500;

async function ensureCoupons() {
  const now = new Date();
  const endsAt = new Date(now.getTime() + 365 * 2 * 24 * 3600 * 1000);
  for (const c of COUPONS_SEED) {
    await prisma.promotion.upsert({
      where: { code: c.code },
      update: {},
      create: {
        publicId: `prm-${c.code.toLowerCase()}`,
        code: c.code,
        name: c.name,
        description: 'Cupón de prueba',
        discountType: 'FIXED_AMOUNT',
        discountValue: DISCOUNT_CENTS,
        maxRedemptions: null,
        startsAt: now,
        endsAt,
        status: 'ACTIVE',
        issuesCouponOnPaid: true,
        couponValidityHours: 720,
      },
    });
  }
}

async function createProductWithStock(stock: number, priceCents: number) {
  const product = await prisma.product.create({
    data: { slug: `cup-${randomUUID()}`, name: 'Producto cupón', priceCents },
  });
  await prisma.inventory.create({
    data: { productId: product.id, initialStock: stock, availableStock: stock },
  });
  return product;
}

async function createUser() {
  const role = await prisma.role.upsert({
    where: { code: 'CUSTOMER' },
    update: {},
    create: { code: 'CUSTOMER', name: 'Cliente' },
  });
  return prisma.user.create({
    data: {
      email: `cup-${randomUUID()}@test.local`,
      fullName: 'Usuario cupón',
      passwordHash: 'no-usado',
      roleId: role.id,
    },
  });
}

async function createPendingOrder(reservations: ReservationService, orders: OrderService, userId: number, productId: number, quantity = 1) {
  const reservation = await reservations.create({ userId, productId, quantity });
  return orders.createOrder({
    userId,
    reservationId: reservation.id,
    idempotencyKey: `idem-${randomUUID()}`,
  });
}

async function cleanup(productId: number, userId: number) {
  await prisma.payment.deleteMany({ where: { order: { userId } } });
  await prisma.idempotencyKey.deleteMany({ where: { order: { userId } } });
  await prisma.order.deleteMany({ where: { userId } });
  await prisma.inventoryReservation.deleteMany({ where: { userId } });
  await prisma.inventory.deleteMany({ where: { productId } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.user.deleteMany({ where: { id: userId } });
}

describe.skipIf(!dbAvailable)('Cupones de descuento (Fase 7-8)', () => {
  const { reservations, orders, payments, coupons } = buildServices();

  beforeAll(async () => {
    await prisma.promotion.deleteMany({ where: { code: { startsWith: 'TEST-' } } });
    await ensureCoupons();
  });

  it('aplica URPxGIT: descuento fijo de S/5 sobre el total de la orden', async () => {
    const product = await createProductWithStock(5, 1000);
    const user = await createUser();
    const order = await createPendingOrder(reservations, orders, user.id, product.id, 2);

    expect(order.totalCents).toBe(2000);
    const usedBefore = await prisma.promotion.findUniqueOrThrow({
      where: { code: 'URPxGIT' },
    }).then((p) => p.usedRedemptions);

    const result = await coupons.apply({ userId: user.id, orderPublicId: order.publicId, code: 'URPxGIT' });

    expect(result.processed).toBe(true);
    expect(result.replay).toBe(false);
    expect(result.discountCents).toBe(DISCOUNT_CENTS);
    expect(result.totalCents).toBe(2000 - DISCOUNT_CENTS);
    expect(result.order.discountCode).toBe('URPxGIT');

    const usedAfter = await prisma.promotion.findUniqueOrThrow({
      where: { code: 'URPxGIT' },
    }).then((p) => p.usedRedemptions);
    expect(usedAfter).toBe(usedBefore + 1);

    await cleanup(product.id, user.id);
  });

  it('replay idempotente: el mismo codigo no vuelve a descontar ni consume capacidad', async () => {
    const product = await createProductWithStock(5, 1000);
    const user = await createUser();
    const order = await createPendingOrder(reservations, orders, user.id, product.id, 1);

    await coupons.apply({ userId: user.id, orderPublicId: order.publicId, code: 'UTPxGIT' });
    const usedBefore = await prisma.promotion.findUniqueOrThrow({
      where: { code: 'UTPxGIT' },
    }).then((p) => p.usedRedemptions);

    const replay = await coupons.apply({ userId: user.id, orderPublicId: order.publicId, code: 'UTPxGIT' });

    expect(replay.replay).toBe(true);
    expect(replay.discountCents).toBe(DISCOUNT_CENTS);
    expect(replay.totalCents).toBe(1000 - DISCOUNT_CENTS);

    const usedAfter = await prisma.promotion.findUniqueOrThrow({
      where: { code: 'UTPxGIT' },
    }).then((p) => p.usedRedemptions);
    expect(usedAfter).toBe(usedBefore);

    await cleanup(product.id, user.id);
  });

  it('un segundo codigo distinto sobre la misma orden es rechazado', async () => {
    const product = await createProductWithStock(5, 1000);
    const user = await createUser();
    const order = await createPendingOrder(reservations, orders, user.id, product.id, 1);

    await coupons.apply({ userId: user.id, orderPublicId: order.publicId, code: 'UNABxGIT' });
    await expect(
      coupons.apply({ userId: user.id, orderPublicId: order.publicId, code: 'URPxGIT' }),
    ).rejects.toBeInstanceOf(ConflictException);

    await cleanup(product.id, user.id);
  });

  it('rechaza codigos inexistentes (NotFound)', async () => {
    const product = await createProductWithStock(5, 1000);
    const user = await createUser();
    const order = await createPendingOrder(reservations, orders, user.id, product.id, 1);

    await expect(
      coupons.apply({ userId: user.id, orderPublicId: order.publicId, code: 'NO-EXISTE' }),
    ).rejects.toBeInstanceOf(NotFoundException);

    await cleanup(product.id, user.id);
  });

  it('rechaza aplicar cupones de una orden que no es de PAYMENT_PENDING', async () => {
    const product = await createProductWithStock(5, 1000);
    const user = await createUser();
    const order = await createPendingOrder(reservations, orders, user.id, product.id, 1);

    await prisma.order.update({
      where: { id: order.id },
      data: { status: OrderStatus.PAID },
    });
    await expect(
      coupons.apply({ userId: user.id, orderPublicId: order.publicId, code: 'URPxGIT' }),
    ).rejects.toBeInstanceOf(ConflictException);

    await cleanup(product.id, user.id);
  });

  it('rechaza aplicarlo a una orden de otro usuario (Forbidden)', async () => {
    const product = await createProductWithStock(5, 1000);
    const owner = await createUser();
    const other = await createUser();
    const order = await createPendingOrder(reservations, orders, owner.id, product.id, 1);

    await expect(
      coupons.apply({ userId: other.id, orderPublicId: order.publicId, code: 'URPxGIT' }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await cleanup(product.id, owner.id);
    await prisma.user.deleteMany({ where: { id: other.id } });
  });

  it('el descuento nunca baja de 0: subtotal menor que el descuento queda en 0', async () => {
    const product = await createProductWithStock(5, 300);
    const user = await createUser();
    const order = await createPendingOrder(reservations, orders, user.id, product.id, 1);

    const result = await coupons.apply({ userId: user.id, orderPublicId: order.publicId, code: 'URPxGIT' });
    expect(result.discountCents).toBe(300);
    expect(result.totalCents).toBe(0);

    await cleanup(product.id, user.id);
  });

  it('listActive/checkCode exponen los codigos funcionales', async () => {
    const codes = (await coupons.listActive()).map((c) => c.code);
    for (const expected of ['UNABxGIT', 'URPxGIT', 'UTPxGIT']) {
      expect(codes).toContain(expected);
    }

    const urp = await coupons.checkCode('URPxGIT');
    expect(urp.code).toBe('URPxGIT');
    expect(urp.discountType).toBe('FIXED_AMOUNT');
    expect(urp.discountValue).toBe(DISCOUNT_CENTS);

    await expect(coupons.checkCode('FALSO')).rejects.toBeInstanceOf(NotFoundException);
    await expect(coupons.checkCode('urpxgit')).rejects.toBeInstanceOf(NotFoundException);
  });

  it('el pago posterior a un descuento usa el total descontado', async () => {
    const product = await createProductWithStock(5, 1000);
    const user = await createUser();
    const order = await createPendingOrder(reservations, orders, user.id, product.id, 2);

    await coupons.apply({ userId: user.id, orderPublicId: order.publicId, code: 'URPxGIT' });

    const payment = await payments.createForOrder(order.publicId, PaymentProvider.CULQI);
    expect(payment.amountCents).toBe(2000 - DISCOUNT_CENTS);

    await cleanup(product.id, user.id);
  });

  it('una promocion con capacidad agotada rechaza nuevos descuentos', async () => {
    const codePaused = `TEST-${randomUUID().slice(0, 4)}`;
    const now = new Date();
    await prisma.promotion.create({
      data: {
        publicId: `prm-${codePaused.toLowerCase()}`,
        code: codePaused,
        name: 'Cupón agotado',
        discountType: 'FIXED_AMOUNT',
        discountValue: DISCOUNT_CENTS,
        maxRedemptions: 2,
        usedRedemptions: 2,
        startsAt: now,
        endsAt: new Date(now.getTime() + 86400000),
        status: PromotionStatus.ACTIVE,
      },
    });

    const product = await createProductWithStock(5, 1000);
    const user = await createUser();
    const order = await createPendingOrder(reservations, orders, user.id, product.id, 1);

    await expect(
      coupons.apply({ userId: user.id, orderPublicId: order.publicId, code: codePaused }),
    ).rejects.toBeInstanceOf(ConflictException);

    await prisma.promotion.delete({ where: { code: codePaused } });
    await cleanup(product.id, user.id);
  });
});