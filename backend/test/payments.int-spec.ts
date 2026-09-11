import 'dotenv/config';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { ReservationService } from '../src/reservations/reservation.service.js';
import { OrderService } from '../src/orders/order.service.js';
import { PaymentService } from '../src/payments/payment.service.js';
import { PaymentProvider, PaymentStatus } from '../src/generated/prisma/enums.js';
import { CouponRewardService } from '../src/coupons/coupon-reward.service.js';

/**
 * Fase 6/16 - Test de integracion de pagos.
 * El pago nace PENDING por el total de la orden; el evento de confirmacion
 * (idempotente por rawEventId) marca el pago PAID, la orden PAID y convierte
 * la reserva (reserved -> sold). Si la DB no esta disponible, se omite (skip).
 */
const config = new ConfigService(process.env as Record<string, string>);
const prisma = new PrismaService(config);

let dbAvailable = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  console.warn('DB no disponible: omitiendo test de pagos.');
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
  return { inventory, reservations, orders, payments, couponRewards };
}

async function createProductWithStock(stock: number, priceCents: number, prismaService: PrismaService) {
  const product = await prismaService.product.create({
    data: {
      slug: `pay-${randomUUID()}`,
      name: 'Producto pago',
      priceCents,
    },
  });
  await prismaService.inventory.create({
    data: { productId: product.id, initialStock: stock, availableStock: stock },
  });
  return product;
}

async function createUser(prismaService: PrismaService) {
  const role = await prismaService.role.upsert({
    where: { code: 'CUSTOMER' },
    update: {},
    create: { code: 'CUSTOMER', name: 'Cliente' },
  });
  return prismaService.user.create({
    data: {
      email: `pay-${randomUUID()}@test.local`,
      fullName: 'Usuario pago',
      passwordHash: 'no-usado',
      roleId: role.id,
    },
  });
}

async function createCheckedOutOrder(stock: number, priceCents: number, qty: number) {
  const product = await createProductWithStock(stock, priceCents, prisma);
  const user = await createUser(prisma);
  const { reservations, orders } = buildServices();

  const reservation = await reservations.create({
    userId: user.id,
    productId: product.id,
    quantity: qty,
  });
  const order = await orders.createOrder({
    userId: user.id,
    reservationId: reservation.id,
    idempotencyKey: `idem-${randomUUID()}`,
  });

  return { product, user, order, reservation };
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

describe.skipIf(!dbAvailable)('Pagos (Fase 6)', () => {
  const { payments } = buildServices();
  const provider = PaymentProvider.CULQI;

  it('crea un pago PENDING por el total de la orden y lo reutiliza', async () => {
    const { product, user, order } = await createCheckedOutOrder(5, 1000, 2);

    const payment = await payments.createForOrder(order.publicId, provider);
    expect(payment.status).toBe(PaymentStatus.PENDING);
    expect(payment.amountCents).toBe(2000);
    expect(payment.currency).toBe('PEN');
    expect(payment.provider).toBe(provider);
    expect(payment.providerTransactionId).not.toBeNull();

    const again = await payments.createForOrder(order.publicId, provider);
    expect(again.id).toBe(payment.id);

    const count = await prisma.payment.count({ where: { orderId: payment.orderId } });
    expect(count).toBe(1);

    await cleanup(product.id, user.id);
  });

  it('confirma el pago: pago PAID, orden PAID, reserva CONVERTED, stock vendido', async () => {
    const { product, user, order } = await createCheckedOutOrder(5, 1000, 2);
    const payment = await payments.createForOrder(order.publicId, provider);

    const result = await payments.confirmPayment({
      provider,
      providerTransactionId: payment.providerTransactionId!,
      rawEventId: `ev-${randomUUID()}`,
      success: true,
      amountCents: payment.amountCents,
    });

    expect(result.processed).toBe(true);
    expect(result.payment.status).toBe(PaymentStatus.PAID);
    expect(result.order?.status).toBe('PAID');
    expect(result.order?.paidAt).not.toBeNull();

    const res = await prisma.inventoryReservation.findUniqueOrThrow({
      where: { id: result.order!.reservationId! },
    });
    expect(res.status).toBe('CONVERTED');

    const inventory = await prisma.inventory.findUniqueOrThrow({ where: { productId: product.id } });
    expect(inventory.availableStock).toBe(3);
    expect(inventory.reservedStock).toBe(0);
    expect(inventory.soldStock).toBe(2);

    await cleanup(product.id, user.id);
  });

  it('el webhook es idempotente: el mismo rawEventId no mueve stock dos veces', async () => {
    const { product, user, order } = await createCheckedOutOrder(5, 1000, 2);
    const payment = await payments.createForOrder(order.publicId, provider);
    const rawEventId = `ev-${randomUUID()}`;

    const first = await payments.confirmPayment({
      provider,
      providerTransactionId: payment.providerTransactionId!,
      rawEventId,
      success: true,
      amountCents: payment.amountCents,
    });
    const second = await payments.confirmPayment({
      provider,
      providerTransactionId: payment.providerTransactionId!,
      rawEventId,
      success: true,
      amountCents: payment.amountCents,
    });

    expect(first.processed).toBe(true);
    expect(second.processed).toBe(false);

    const inventory = await prisma.inventory.findUniqueOrThrow({ where: { productId: product.id } });
    expect(inventory.soldStock).toBe(2);

    await cleanup(product.id, user.id);
  });

  it('un pago fallido mantiene la orden PAYMENT_PENDING y permite reintentar', async () => {
    const { product, user, order } = await createCheckedOutOrder(5, 1000, 1);
    const payment = await payments.createForOrder(order.publicId, provider);

    const failed = await payments.confirmPayment({
      provider,
      providerTransactionId: payment.providerTransactionId!,
      rawEventId: `ev-${randomUUID()}`,
      success: false,
    });

    expect(failed.processed).toBe(true);
    expect(failed.payment.status).toBe(PaymentStatus.FAILED);
    expect(failed.order?.status).toBe('PAYMENT_PENDING');

    const res = await prisma.inventoryReservation.findUniqueOrThrow({
      where: { id: failed.order!.reservationId! },
    });
    expect(res.status).toBe('ACTIVE');

    const retry = await payments.confirmPayment({
      provider,
      providerTransactionId: payment.providerTransactionId!,
      rawEventId: `ev-${randomUUID()}`,
      success: true,
      amountCents: payment.amountCents,
    });

    expect(retry.processed).toBe(true);
    expect(retry.payment.status).toBe(PaymentStatus.PAID);
    expect(retry.order?.status).toBe('PAID');

    const inventory = await prisma.inventory.findUniqueOrThrow({ where: { productId: product.id } });
    expect(inventory.soldStock).toBe(1);
    expect(inventory.reservedStock).toBe(0);

    await cleanup(product.id, user.id);
  });

  it('rechaza pagar una orden ya pagada', async () => {
    const { product, user, order } = await createCheckedOutOrder(5, 1000, 1);
    const payment = await payments.createForOrder(order.publicId, provider);

    await payments.confirmPayment({
      provider,
      providerTransactionId: payment.providerTransactionId!,
      rawEventId: `ev-${randomUUID()}`,
      success: true,
      amountCents: payment.amountCents,
    });

    await expect(payments.createForOrder(order.publicId, provider)).rejects.toBeInstanceOf(
      ConflictException,
    );

    await cleanup(product.id, user.id);
  });

  it('confirma un monto distinto al de la orden (rechazado)', async () => {
    const { product, user, order } = await createCheckedOutOrder(5, 1000, 1);
    const payment = await payments.createForOrder(order.publicId, provider);

    await expect(
      payments.confirmPayment({
        provider,
        providerTransactionId: payment.providerTransactionId!,
        rawEventId: `ev-${randomUUID()}`,
        success: true,
        amountCents: payment.amountCents! - 1,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    await cleanup(product.id, user.id);
  });

  it('confirmar con una transaccion desconocida lanza NotFound', async () => {
    await expect(
      payments.confirmPayment({
        provider,
        providerTransactionId: `no-existe-${randomUUID()}`,
        rawEventId: `ev-${randomUUID()}`,
        success: true,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});