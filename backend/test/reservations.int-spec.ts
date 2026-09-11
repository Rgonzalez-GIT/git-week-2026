import 'dotenv/config';
import { ConflictException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { ReservationService } from '../src/reservations/reservation.service.js';

/**
 * Fase 4/16 - Test de integracion de reservas temporales (requiere PostgreSQL activo).
 * Reserva crea registro + congela stock; cancel/convert/sweep son idempotentes
 * y nunca liberan stock de mas. Si la DB no esta disponible, se omite (skip).
 */
const config = new ConfigService(process.env as Record<string, string>);
const prisma = new PrismaService(config);

let dbAvailable = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  console.warn('DB no disponible: omitiendo test de reservas.');
}

afterAll(async () => {
  await prisma.$disconnect();
});

async function createProductWithStock(stock: number, prismaService: PrismaService) {
  const product = await prismaService.product.create({
    data: {
      slug: `res-${randomUUID()}`,
      name: 'Producto reserva',
      priceCents: 1000,
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
      email: `res-${randomUUID()}@test.local`,
      fullName: 'Usuario reserva',
      passwordHash: 'no-usado',
      roleId: role.id,
    },
  });
}

async function cleanup(prismaService: PrismaService, productId: number, userId: number) {
  await prismaService.inventoryReservation.deleteMany({
    where: {
      OR: [{ productId }, { userId }],
    },
  });
  await prismaService.inventory.deleteMany({ where: { productId } });
  await prismaService.product.deleteMany({ where: { id: productId } });
  await prismaService.user.deleteMany({ where: { id: userId } });
}

describe.skipIf(!dbAvailable)('Reservas temporales (Fase 4)', () => {
  const reservationService = new ReservationService(prisma, new InventoryService(prisma), config);

  it('crear reserva congela stock y registra la fila ACTIVA con expiracion futura', async () => {
    const product = await createProductWithStock(5, prisma);
    const user = await createUser(prisma);

    const reservation = await reservationService.create({
      userId: user.id,
      productId: product.id,
      quantity: 2,
    });

    expect(reservation.status).toBe('ACTIVE');
    expect(reservation.quantity).toBe(2);
    expect(reservation.expiresAt.getTime()).toBeGreaterThan(Date.now());

    const inventory = await prisma.inventory.findUniqueOrThrow({ where: { productId: product.id } });
    expect(inventory.availableStock).toBe(3);
    expect(inventory.reservedStock).toBe(2);

    await cleanup(prisma, product.id, user.id);
  });

  it('rechaza reservar por encima del stock sin congelar nada', async () => {
    const product = await createProductWithStock(3, prisma);
    const user = await createUser(prisma);

    await expect(
      reservationService.create({ userId: user.id, productId: product.id, quantity: 4 }),
    ).rejects.toBeInstanceOf(ConflictException);

    const inventory = await prisma.inventory.findUniqueOrThrow({ where: { productId: product.id } });
    expect(inventory.availableStock).toBe(3);
    expect(inventory.reservedStock).toBe(0);

    await cleanup(prisma, product.id, user.id);
  });

  it('cancelar libera el stock y es idempotente (no libera doble)', async () => {
    const product = await createProductWithStock(5, prisma);
    const user = await createUser(prisma);

    const reservation = await reservationService.create({
      userId: user.id,
      productId: product.id,
      quantity: 3,
    });

    const first = await reservationService.cancel(reservation.publicId);
    expect(first.ok).toBe(true);

    const cancelled = await prisma.inventoryReservation.findUniqueOrThrow({
      where: { publicId: reservation.publicId },
    });
    expect(cancelled.status).toBe('CANCELLED');
    expect(cancelled.releasedAt).not.toBeNull();

    let inventory = await prisma.inventory.findUniqueOrThrow({ where: { productId: product.id } });
    expect(inventory.availableStock).toBe(5);
    expect(inventory.reservedStock).toBe(0);

    const second = await reservationService.cancel(reservation.publicId);
    expect(second.ok).toBe(false);

    inventory = await prisma.inventory.findUniqueOrThrow({ where: { productId: product.id } });
    expect(inventory.availableStock).toBe(5);
    expect(inventory.reservedStock).toBe(0);

    await cleanup(prisma, product.id, user.id);
  });

  it('convertir una activa mueve reserved -> sold y es idempotente', async () => {
    const product = await createProductWithStock(5, prisma);
    const user = await createUser(prisma);

    const reservation = await reservationService.create({
      userId: user.id,
      productId: product.id,
      quantity: 2,
    });

    expect(reservation.quantity).toBe(2);
    expect(await reservationService.convert(reservation.publicId)).toBe(true);

    const converted = await prisma.inventoryReservation.findUniqueOrThrow({
      where: { publicId: reservation.publicId },
    });
    expect(converted.status).toBe('CONVERTED');

    let inventory = await prisma.inventory.findUniqueOrThrow({ where: { productId: product.id } });
    expect(inventory.availableStock).toBe(3);
    expect(inventory.reservedStock).toBe(0);
    expect(inventory.soldStock).toBe(2);

    expect(await reservationService.convert(reservation.publicId)).toBe(true);
    inventory = await prisma.inventory.findUniqueOrThrow({ where: { productId: product.id } });
    expect(inventory.soldStock).toBe(2);
    expect(inventory.reservedStock).toBe(0);

    await cleanup(prisma, product.id, user.id);
  });

  it('sweep expira reservas vencidas y libera stock; el segundo sweep no libera de mas', async () => {
    const product = await createProductWithStock(4, prisma);
    const user = await createUser(prisma);

    const reservation = await reservationService.create({
      userId: user.id,
      productId: product.id,
      quantity: 2,
    });

    await prisma.inventoryReservation.update({
      where: { id: reservation.id },
      data: { expiresAt: new Date(reservation.createdAt.getTime() + 1) },
    });

    const expired = await reservationService.expireSweep();
    expect(expired).toBeGreaterThanOrEqual(1);

    const expiredRes = await prisma.inventoryReservation.findUniqueOrThrow({
      where: { id: reservation.id },
    });
    expect(expiredRes.status).toBe('EXPIRED');
    expect(expiredRes.releasedAt).not.toBeNull();

    let inventory = await prisma.inventory.findUniqueOrThrow({ where: { productId: product.id } });
    expect(inventory.availableStock).toBe(4);
    expect(inventory.reservedStock).toBe(0);

    const second = await reservationService.expireSweep();
    expect(second).toBe(0);

    inventory = await prisma.inventory.findUniqueOrThrow({ where: { productId: product.id } });
    expect(inventory.availableStock).toBe(4);
    expect(inventory.reservedStock).toBe(0);

    await cleanup(prisma, product.id, user.id);
  });
});