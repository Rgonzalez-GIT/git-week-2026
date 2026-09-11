import 'dotenv/config';
import { randomUUID } from 'node:crypto';
import { ConfigService } from '@nestjs/config';
import { ConflictException } from '@nestjs/common';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { InventoryService } from '../src/inventory/inventory.service.js';
import { ReservationService } from '../src/reservations/reservation.service.js';

/**
 * Fase 16 - Prueba de concurrencia (10 y 1000 requests simultaneos).
 *
 * Objetivo: demostrar que la barrera de stock (UPDATE con guarda
 * `availableStock >= quantity` en PostgreSQL) impide sobreventa incluso bajo
 * altisima concurrencia. Ninguna corrida debe terminar con mas reservas que
 * el stock inicial, y el inventario siempre debe reconciliar.
 */

const config = new ConfigService(process.env as Record<string, string>);
const prisma = new PrismaService(config);

let dbAvailable = false;
try {
  await prisma.$connect();
  dbAvailable = true;
} catch {
  dbAvailable = false;
}

function buildServices() {
  const inventory = new InventoryService(prisma);
  const reservations = new ReservationService(prisma, inventory, config);
  return { inventory, reservations };
}

async function createProductWithStock(stock: number) {
  const product = await prisma.product.create({
    data: { slug: `conc-${randomUUID()}`, name: 'Producto concurrencia', priceCents: 9900 },
  });
  await prisma.inventory.create({
    data: { productId: product.id, initialStock: stock, availableStock: stock },
  });
  return { productId: product.id };
}

async function createUser() {
  await prisma.role.upsert({
    where: { code: 'CUSTOMER' },
    update: {},
    create: { code: 'CUSTOMER', name: 'Cliente' },
  });
  return prisma.user.create({
    data: {
      email: `conc-${randomUUID()}@test.local`,
      fullName: 'Concurrency Tester',
      passwordHash: 'x',
      role: { connect: { code: 'CUSTOMER' } },
    },
  });
}

async function cleanup(productId: number, userIds: number[]) {
  await prisma.inventoryReservation.deleteMany({
    where: { OR: userIds.map((userId) => ({ userId })) },
  });
  await prisma.inventory.deleteMany({ where: { productId } });
  await prisma.product.deleteMany({ where: { id: productId } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
}

describe.skipIf(!dbAvailable)('Concurrencia de reservas (Fase 16)', () => {
  const { inventory, reservations } = buildServices();

  async function runBurst(stock: number, attempts: number) {
    const { productId } = await createProductWithStock(stock);
    const users = await Promise.all(Array.from({ length: attempts }, () => createUser()));

    const results = await Promise.allSettled(
      users.map((u) => reservations.create({ userId: u.id, productId, quantity: 1 })),
    );

    const ok = results.filter((r) => r.status === 'fulfilled');
    const conflict = results.filter(
      (r) => r.status === 'rejected' && r.reason instanceof ConflictException,
    );

    const inv = await prisma.inventory.findUnique({ where: { productId } });
    return {
      productId,
      userIds: users.map((u) => u.id),
      success: ok.length,
      conflicts: conflict.length,
      otherFailures: results.length - ok.length - conflict.length,
      availableStock: inv?.availableStock,
      reservedStock: inv?.reservedStock,
      soldStock: inv?.soldStock,
    };
  }

  it('burst 10/10: exactamente 10 reservas, ninguna sobreventa', async () => {
    const r = await runBurst(10, 10);
    expect(r.success).toBe(10);
    expect(r.conflicts).toBe(0);
    expect(r.otherFailures).toBe(0);
    expect(r.availableStock).toBe(0);
    expect(r.reservedStock).toBe(10);
    expect(r.soldStock).toBe(0);
    await cleanup(r.productId, r.userIds);
  });

  it('burst 10/50: 10 reservas, 40 conflictos, sin sobreventa', async () => {
    const r = await runBurst(10, 50);
    expect(r.success).toBe(10);
    expect(r.conflicts).toBe(40);
    expect(r.otherFailures).toBe(0);
    expect(r.availableStock).toBe(0);
    expect(r.reservedStock).toBe(10);
    await cleanup(r.productId, r.userIds);
  });

  it('burst 20/200: 20 reservas, 180 conflictos, sin sobreventa', async () => {
    const r = await runBurst(20, 200);
    expect(r.success).toBe(20);
    expect(r.conflicts).toBe(180);
    expect(r.otherFailures).toBe(0);
    expect(r.availableStock).toBe(0);
    expect(r.reservedStock).toBe(20);
    await cleanup(r.productId, r.userIds);
  });

  it('burst 10/1000: 10 reservas, 990 conflictos, sin sobreventa', async () => {
    const r = await runBurst(10, 1000);
    expect(r.success).toBe(10);
    expect(r.conflicts).toBe(990);
    expect(r.otherFailures).toBe(0);
    expect(r.availableStock).toBe(0);
    expect(r.reservedStock).toBe(10);
    await cleanup(r.productId, r.userIds);
  });

  it('tras cancelar todas las reservas, el stock se reconcilia a initial', async () => {
    const stock = 10;
    const attempts = 10;
    const { productId } = await createProductWithStock(stock);
    const users = await Promise.all(Array.from({ length: attempts }, () => createUser()));

    const reservationsDone = await Promise.all(
      users.map((u) => reservations.create({ userId: u.id, productId, quantity: 1 })),
    );
    expect(reservationsDone).toHaveLength(stock);

    await Promise.all(
      reservationsDone.map((r) => reservations.cancel(r.publicId)),
    );

    const inv = await prisma.inventory.findUnique({ where: { productId } });
    expect(inv?.availableStock).toBe(stock);
    expect(inv?.reservedStock).toBe(0);
    expect(inv?.soldStock).toBe(0);

    // Reconcile manual no debe cambiar nada (ya está consistente)
    const reconciled = await inventory.reconcile(productId);
    expect(reconciled).toBe(true);
    const after = await prisma.inventory.findUnique({ where: { productId } });
    expect(after?.availableStock).toBe(stock);

    await cleanup(productId, users.map((u) => u.id));
  });

  afterAll(async () => {
    if (dbAvailable) {
      await prisma.inventoryReservation.deleteMany({
        where: { user: { email: { startsWith: 'conc-' } } },
      });
      await prisma.inventory.deleteMany({
        where: { product: { slug: { startsWith: 'conc-' } } },
      });
      await prisma.product.deleteMany({ where: { slug: { startsWith: 'conc-' } } });
      await prisma.user.deleteMany({ where: { email: { startsWith: 'conc-' } } });
    }
    await prisma.$disconnect();
  });
});