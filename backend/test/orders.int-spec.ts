import 'dotenv/config';
import { ConflictException, ForbiddenException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { ReservationService } from '../src/reservations/reservation.service.js';
import { OrderService } from '../src/orders/order.service.js';

/**
 * Fase 5/16 - Test de integracion de ordenes (checkout atomico + idempotencia).
 * La orden se crea desde una reserva ACTIVE del mismo usuario; la misma clave
 * idempotente replica la misma orden, y una reserva solo se consume una vez.
 * Si la DB no esta disponible, se omite (skip).
 */
const config = new ConfigService(process.env as Record<string, string>);
const prisma = new PrismaService(config);

let dbAvailable = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  console.warn('DB no disponible: omitiendo test de ordenes.');
}

afterAll(async () => {
  await prisma.$disconnect();
});

function buildServices() {
  const inventory = new InventoryService(prisma);
  const reservations = new ReservationService(prisma, inventory, config);
  const orders = new OrderService(prisma);
  return { inventory, reservations, orders };
}

async function createProductWithStock(stock: number, priceCents: number, prismaService: PrismaService) {
  const product = await prismaService.product.create({
    data: {
      slug: `ord-${randomUUID()}`,
      name: 'Producto orden',
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
      email: `ord-${randomUUID()}@test.local`,
      fullName: 'Usuario orden',
      passwordHash: 'no-usado',
      roleId: role.id,
    },
  });
}

async function cleanup(prismaService: PrismaService, productId: number, userId: number) {
  await prismaService.idempotencyKey.deleteMany({ where: { order: { userId } } });
  await prismaService.order.deleteMany({ where: { userId } });
  await prismaService.inventoryReservation.deleteMany({ where: { userId } });
  await prismaService.inventory.deleteMany({ where: { productId } });
  await prismaService.product.deleteMany({ where: { id: productId } });
  await prismaService.user.deleteMany({ where: { id: userId } });
}

describe.skipIf(!dbAvailable)('Ordenes (Fase 5)', () => {
  const { reservations, orders } = buildServices();

  it('crea una orden desde una reserva ACTIVE con snapshot de precios', async () => {
    const product = await createProductWithStock(5, 1000, prisma);
    const user = await createUser(prisma);

    const reservation = await reservations.create({
      userId: user.id,
      productId: product.id,
      quantity: 2,
    });

    const order = await orders.createOrder({
      userId: user.id,
      reservationId: reservation.id,
      idempotencyKey: `idem-${randomUUID()}`,
    });

    expect(order.status).toBe('PAYMENT_PENDING');
    expect(order.subtotalCents).toBe(2000);
    expect(order.discountCents).toBe(0);
    expect(order.totalCents).toBe(2000);
    expect(order.reservationId).toBe(reservation.id);
    expect(order.items).toHaveLength(1);
    expect(order.items[0].productId).toBe(product.id);
    expect(order.items[0].unitPriceCents).toBe(1000);
    expect(order.items[0].lineTotalCents).toBe(2000);

    const res = await prisma.inventoryReservation.findUniqueOrThrow({
      where: { id: reservation.id },
    });
    expect(res.status).toBe('ACTIVE');

    const idem = await prisma.idempotencyKey.findUniqueOrThrow({
      where: { orderId: order.id },
    });
    expect(idem.status).toBe('USED');

    await cleanup(prisma, product.id, user.id);
  });

  it('el snapshot mantiene el precio del checkout aunque el producto cambie despues', async () => {
    const product = await createProductWithStock(5, 1000, prisma);
    const user = await createUser(prisma);

    const reservation = await reservations.create({
      userId: user.id,
      productId: product.id,
      quantity: 1,
    });

    const order = await orders.createOrder({
      userId: user.id,
      reservationId: reservation.id,
      idempotencyKey: `idem-${randomUUID()}`,
    });

    await prisma.product.update({ where: { id: product.id }, data: { priceCents: 9999 } });

    expect(order.totalCents).toBe(1000);

    await cleanup(prisma, product.id, user.id);
  });

  it('replay idempotente devuelve la misma orden con la misma clave', async () => {
    const product = await createProductWithStock(5, 500, prisma);
    const user = await createUser(prisma);
    const key = `idem-${randomUUID()}`;

    const reservation = await reservations.create({
      userId: user.id,
      productId: product.id,
      quantity: 1,
    });

    const first = await orders.createOrder({
      userId: user.id,
      reservationId: reservation.id,
      idempotencyKey: key,
    });
    const second = await orders.createOrder({
      userId: user.id,
      reservationId: reservation.id,
      idempotencyKey: key,
    });

    expect(second.id).toBe(first.id);
    const count = await prisma.order.count({ where: { userId: user.id } });
    expect(count).toBe(1);

    await cleanup(prisma, product.id, user.id);
  });

  it('rechaza la reserva de otro usuario (Forbidden)', async () => {
    const product = await createProductWithStock(5, 500, prisma);
    const owner = await createUser(prisma);
    const other = await createUser(prisma);

    const reservation = await reservations.create({
      userId: owner.id,
      productId: product.id,
      quantity: 1,
    });

    await expect(
      orders.createOrder({
        userId: other.id,
        reservationId: reservation.id,
        idempotencyKey: `idem-${randomUUID()}`,
      }),
    ).rejects.toBeInstanceOf(ForbiddenException);

    await cleanup(prisma, product.id, owner.id);
    await prisma.user.deleteMany({ where: { id: other.id } });
  });

  it('rechaza una reserva ya cancelada (Conflict)', async () => {
    const product = await createProductWithStock(5, 500, prisma);
    const user = await createUser(prisma);

    const reservation = await reservations.create({
      userId: user.id,
      productId: product.id,
      quantity: 1,
    });
    await reservations.cancel(reservation.publicId);

    await expect(
      orders.createOrder({
        userId: user.id,
        reservationId: reservation.id,
        idempotencyKey: `idem-${randomUUID()}`,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    await cleanup(prisma, product.id, user.id);
  });

  it('una reserva solo se consume una vez (segunda orden rechazada)', async () => {
    const product = await createProductWithStock(5, 500, prisma);
    const user = await createUser(prisma);

    const reservation = await reservations.create({
      userId: user.id,
      productId: product.id,
      quantity: 1,
    });

    await orders.createOrder({
      userId: user.id,
      reservationId: reservation.id,
      idempotencyKey: `idem-${randomUUID()}`,
    });

    await expect(
      orders.createOrder({
        userId: user.id,
        reservationId: reservation.id,
        idempotencyKey: `idem-${randomUUID()}`,
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    await cleanup(prisma, product.id, user.id);
  });
});