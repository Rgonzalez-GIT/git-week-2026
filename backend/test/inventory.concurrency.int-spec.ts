import 'dotenv/config';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { InventoryService } from '../src/inventory/inventory.service.js';

/**
 * Fase 3/16 — Test de concurrencia de inventario (requiere PostgreSQL activo).
 * Stock = 10, 100 reservas simultáneas => éxito <= 10, NUNCA más de 10.
 * Si la DB no está disponible, el archivo completo se omite (skip).
 */
const config = new ConfigService(process.env as Record<string, string>);
const prisma = new PrismaService(config);

let dbAvailable = false;
try {
  await prisma.$connect();
  await prisma.$queryRaw`SELECT 1`;
  dbAvailable = true;
} catch {
  console.warn('DB no disponible: omitiendo test de concurrencia de inventario.');
}

afterAll(async () => {
  await prisma.$disconnect();
});

describe.skipIf(!dbAvailable)('Concurrencia de inventario (atomic UPDATE)', () => {
  const inventoryService = new InventoryService(prisma);

  it('100 reservas concurrentes sobre stock=10 => exactamente 10 éxito, nunca más', async () => {
    const slug = `test-stock-${randomUUID()}`;
    const product = await prisma.product.create({
      data: {
        slug,
        name: 'Producto concurrencia',
        priceCents: 1000,
      },
    });
    await prisma.inventory.create({
      data: { productId: product.id, initialStock: 10, availableStock: 10 },
    });

    const requests = Array.from({ length: 100 }, () =>
      inventoryService.reserve(product.id, 1),
    );
    const results = await Promise.all(requests);

    const successes = results.filter((r) => r.success).length;
    expect(successes).toBeLessThanOrEqual(10);
    expect(successes).toBe(10);

    const inventory = await prisma.inventory.findUniqueOrThrow({
      where: { productId: product.id },
    });
    expect(inventory.availableStock).toBe(0);
    expect(inventory.reservedStock).toBe(10);

    await prisma.inventory.delete({ where: { productId: product.id } });
    await prisma.product.delete({ where: { id: product.id } });
  });

  it('una sola transacción agrega reservas por encima del stock: falla la que excede', async () => {
    const slug = `test-partial-${randomUUID()}`;
    const product = await prisma.product.create({
      data: { slug, name: 'Producto parcial', priceCents: 500 },
    });
    await prisma.inventory.create({
      data: { productId: product.id, initialStock: 5, availableStock: 5 },
    });

    const a = await inventoryService.reserve(product.id, 4);
    const b = await inventoryService.reserve(product.id, 2);

    expect(a.success).toBe(true);
    expect(b.success).toBe(false);

    const inventory = await prisma.inventory.findUniqueOrThrow({
      where: { productId: product.id },
    });
    expect(inventory.availableStock).toBe(1);
    expect(inventory.reservedStock).toBe(4);

    await prisma.inventory.delete({ where: { productId: product.id } });
    await prisma.product.delete({ where: { id: product.id } });
  });

  it('release es idempotente: liberar dos veces no libera stock de más', async () => {
    const slug = `test-release-${randomUUID()}`;
    const product = await prisma.product.create({
      data: { slug, name: 'Producto release', priceCents: 300 },
    });
    await prisma.inventory.create({
      data: { productId: product.id, initialStock: 3, availableStock: 3 },
    });

    await inventoryService.reserve(product.id, 2);
    const first = await inventoryService.release(product.id, 2);
    const second = await inventoryService.release(product.id, 2);

    expect(first.success).toBe(true);
    expect(second.success).toBe(false);

    const inventory = await prisma.inventory.findUniqueOrThrow({
      where: { productId: product.id },
    });
    expect(inventory.availableStock).toBe(3);
    expect(inventory.reservedStock).toBe(0);

    await prisma.inventory.delete({ where: { productId: product.id } });
    await prisma.product.delete({ where: { id: product.id } });
  });
});