import 'dotenv/config';
import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { ReservationService } from '../src/reservations/reservation.service.js';
import { OrderService } from '../src/orders/order.service.js';
import { PaymentService } from '../src/payments/payment.service.js';
import { CouponService } from '../src/coupons/coupon.service.js';
import { CouponRewardService } from '../src/coupons/coupon-reward.service.js';
import { PaymentProvider, CouponStatus } from '../src/generated/prisma/enums.js';

/**
 * Fase 7 (completa) /16 - El cupón físico se emite únicamente cuando el pago se
 * confirma. El QR apunta a /coupon/{public-id} y NO contiene datos sensibles.
 */
const config = new ConfigService(process.env as Record<string, string>);
const prisma = new PrismaService(config);

let dbAvailable = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  console.warn('DB no disponible: omitiendo test de cupón físico.');
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!dbAvailable)('Cupón físico (Fase 7 completa)', () => {
  const rewards = new CouponRewardService(prisma);

  async function createPromoWithCode() {
    const code = `TESTCODE-${randomUUID().slice(0, 8)}`;
    const promotion = await prisma.promotion.create({
      data: {
        publicId: `prm-${randomUUID()}`,
        code,
        name: 'Promo test físico',
        discountType: 'FIXED_AMOUNT',
        discountValue: 500,
        maxRedemptions: null,
        startsAt: new Date(Date.now() - 1000),
        endsAt: new Date(Date.now() + 86400_000),
        status: 'ACTIVE',
        issuesCouponOnPaid: true,
        couponValidityHours: 720,
      },
    });
    return promotion;
  }

  async function runPaidFlow(applyDiscount = true) {
    const inventory = new InventoryService(prisma);
    const reservations = new ReservationService(prisma, inventory, config);
    const orders = new OrderService(prisma);
    const couponService = new CouponService(prisma);
    const payments = new PaymentService(prisma, reservations, rewards, config);

    const role = await prisma.role.upsert({
      where: { code: 'CUSTOMER' },
      update: {},
      create: { code: 'CUSTOMER', name: 'Cliente' },
    });
    const user = await prisma.user.create({
      data: {
        email: `reward-${randomUUID()}@test.local`,
        fullName: 'Cupón físico',
        passwordHash: 'no-usado',
        roleId: role.id,
      },
    });
    const product = await prisma.product.create({
      data: { slug: `reward-${randomUUID()}`, name: 'Plan Físico', priceCents: 3900 },
    });
    await prisma.inventory.create({
      data: { productId: product.id, initialStock: 50, availableStock: 50 },
    });

    const reservation = await reservations.create({ userId: user.id, productId: product.id, quantity: 1 });
    const order = await orders.createOrder({
      userId: user.id,
      reservationId: reservation.id,
      idempotencyKey: `idem-${randomUUID()}`,
    });

    let promotion: Awaited<ReturnType<typeof createPromoWithCode>> | null = null;
    if (applyDiscount) {
      promotion = await createPromoWithCode();
      await couponService.apply({ userId: user.id, orderPublicId: order.publicId, code: promotion.code });
    }

    const payment = await payments.createForOrder(order.publicId, PaymentProvider.CULQI);
    const result = await payments.confirmPayment({
      provider: payment.provider,
      providerTransactionId: payment.providerTransactionId!,
      rawEventId: `ev-${randomUUID()}`,
      success: true,
      amountCents: payment.amountCents,
    });

    return { user, product, order, result, promotion };
  }

  async function cleanup(userId: number, productId: number, promotionId?: number) {
    await prisma.payment.deleteMany({ where: { order: { userId } } });
    await prisma.qrImage.deleteMany({ where: { coupon: { order: { userId } } } });
    await prisma.couponRedemption.deleteMany({ where: { coupon: { order: { userId } } } });
    await prisma.coupon.deleteMany({ where: { order: { userId } } });
    await prisma.idempotencyKey.deleteMany({ where: { order: { userId } } });
    await prisma.order.deleteMany({ where: { userId } });
    await prisma.inventoryReservation.deleteMany({ where: { userId } });
    if (promotionId) {
      await prisma.promotion.deleteMany({ where: { id: promotionId } });
    }
    await prisma.inventory.deleteMany({ where: { productId } });
    await prisma.product.deleteMany({ where: { id: productId } });
    await prisma.user.deleteMany({ where: { id: userId } });
  }

  it('emite un cupón único PROMO-2026 con QR al confirmarse el pago', async () => {
    const { user, product, result } = await runPaidFlow(true);
    expect(result.order?.status).toBe('PAID');

    const coupons = await prisma.coupon.findMany({ where: { orderId: result.order!.id } });
    expect(coupons).toHaveLength(1);
    expect(coupons[0].code).toMatch(/^PROMO-2026-[A-F0-9]{8}$/);
    expect(coupons[0].status).toBe('AVAILABLE');
    expect(coupons[0].userId).toBe(user.id);
    expect(coupons[0].expiresAt > new Date()).toBe(true);

    const qr = await prisma.qrImage.findFirst({ where: { couponId: coupons[0].id } });
    expect(qr?.url).toBe(`/coupon/${coupons[0].publicId}`);

    const publicCoupon = await rewards.findByPublicId(coupons[0].publicId);
    expect(publicCoupon?.code).toBe(coupons[0].code);

    await cleanup(user.id, product.id);
  });

  it('es idempotente: emitir dos veces sobre la misma orden devuelve el mismo cupón', async () => {
    const { user, product, order } = await runPaidFlow(true);
    const first = await rewards.issueForPaidOrder(order.id);
    const second = await rewards.issueForPaidOrder(order.id);
    expect(second?.id).toBe(first?.id);
    const count = await prisma.coupon.count({ where: { orderId: order.id } });
    expect(count).toBe(1);
    await cleanup(user.id, product.id);
  });

  it('no emite cupón físico si la orden no usó código de descuento', async () => {
    const { user, product, order } = await runPaidFlow(false);
    const count = await prisma.coupon.count({ where: { orderId: order.id } });
    expect(count).toBe(0);
    await cleanup(user.id, product.id);
  });

  it('lista los cupones del usuario (mine)', async () => {
    const { user, product } = await runPaidFlow(true);
    const mine = await rewards.listMine(user.id);
    expect(mine.length).toBeGreaterThanOrEqual(1);
    expect(mine[0].qrUrl).toMatch(/^\/coupon\//);
    expect(mine[0].code).toMatch(/^PROMO-2026-/);
    await cleanup(user.id, product.id);
  });

  it('canjea un cupón una sola vez y queda el historial', async () => {
    const { user, product } = await runPaidFlow(true);
    const coupon = await prisma.coupon.findFirstOrThrow({ where: { order: { userId: user.id } } });

    const redeemed = await rewards.redeem(user.id, coupon.publicId);
    expect(redeemed.status).toBe(CouponStatus.REDEEMED);
    expect(redeemed.redeemedAt).not.toBeNull();

    const history = await prisma.couponRedemption.findMany({
      where: { couponId: coupon.id },
      orderBy: { createdAt: 'asc' },
    });
    expect(history.some((h) => h.action === 'REDEEMED')).toBe(true);

    await cleanup(user.id, product.id);
  });

  it('el segundo intento de canje es rechazado (Conflict) y se audita', async () => {
    const { user, product } = await runPaidFlow(true);
    const coupon = await prisma.coupon.findFirstOrThrow({ where: { order: { userId: user.id } } });

    await rewards.redeem(user.id, coupon.publicId);
    await expect(rewards.redeem(user.id, coupon.publicId)).rejects.toBeInstanceOf(ConflictException);

    const conflicts = await prisma.couponRedemption.count({ where: { couponId: coupon.id, action: 'CONFLICT' } });
    expect(conflicts).toBeGreaterThanOrEqual(1);

    await cleanup(user.id, product.id);
  });

  it('concurrencia: 10 intentos simultáneos → exactamente 1 canje exitoso', async () => {
    const { user, product } = await runPaidFlow(true);
    const coupon = await prisma.coupon.findFirstOrThrow({ where: { order: { userId: user.id } } });

    const attempts = await Promise.allSettled(
      Array.from({ length: 10 }, () => rewards.redeem(user.id, coupon.publicId)),
    );
    const successes = attempts.filter((a) => a.status === 'fulfilled');
    const rejected = attempts.filter((a) => a.status === 'rejected');
    expect(successes).toHaveLength(1);
    expect(rejected.length).toBe(9);
    expect(rejected[0].status === 'rejected' && rejected[0].reason instanceof ConflictException).toBe(true);

    const finalStatus = await prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } });
    expect(finalStatus.status).toBe(CouponStatus.REDEEMED);

    await cleanup(user.id, product.id);
  });
});