import 'dotenv/config';
import { BadRequestException, ConflictException, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PrismaService } from '../src/prisma/prisma.service.js';
import { CartService } from '../src/cart/cart.service.js';
import { ProductStatus } from '../src/generated/prisma/enums.js';

/**
 * Fase 7/16 - Test de integracion del carrito.
 * Carrito de invitado (sessionKey) y de usuario (userId); un solo item por
 * producto; subtotal calculado; stock no se toca hasta el checkout.
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
  console.warn('DB no disponible: omitiendo test de carrito.');
}

afterAll(async () => {
  await prisma.$disconnect();
});

async function createProduct(priceCents: number, status: ProductStatus = ProductStatus.ACTIVE) {
  return prisma.product.create({
    data: {
      slug: `cart-${randomUUID()}`,
      name: 'Producto carrito',
      priceCents,
      status,
    },
  });
}

async function createUser() {
  const role = await prisma.role.upsert({
    where: { code: 'CUSTOMER' },
    update: {},
    create: { code: 'CUSTOMER', name: 'Cliente' },
  });
  return prisma.user.create({
    data: {
      email: `cart-${randomUUID()}@test.local`,
      fullName: 'Usuario carrito',
      passwordHash: 'no-usado',
      roleId: role.id,
    },
  });
}

async function cleanup(productIds?: number[], userIds?: number[]) {
  if (userIds?.length) {
    await prisma.cartItem.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  }
  if (productIds?.length) {
    await prisma.cartItem.deleteMany({ where: { productId: { in: productIds } } });
    await prisma.product.deleteMany({ where: { id: { in: productIds } } });
  }
}

describe.skipIf(!dbAvailable)('Carrito (Fase 7)', () => {
  const cart = new CartService(prisma);

  it('agrega, acumula y calcula el subtotal para un carrito de sesion', async () => {
    const product = await createProduct(1000);
    const sessionKey = `s-${randomUUID()}`;

    await cart.add({ sessionKey }, product.id, 2);
    await cart.add({ sessionKey }, product.id, 1);

    const view = await cart.list({ sessionKey });
    expect(view.items).toHaveLength(1);
    expect(view.items[0].quantity).toBe(3);
    expect(view.items[0].lineTotalCents).toBe(3000);
    expect(view.subtotalCents).toBe(3000);

    await cleanup([product.id]);
  });

  it('un mismo producto vive por separado en carritos distintos', async () => {
    const product = await createProduct(500);
    const user = await createUser();
    const sessionKey = `s-${randomUUID()}`;

    await cart.add({ userId: user.id }, product.id, 1);
    await cart.add({ sessionKey }, product.id, 2);

    const userCart = await cart.list({ userId: user.id });
    const sessionCart = await cart.list({ sessionKey });

    expect(userCart.items[0].quantity).toBe(1);
    expect(sessionCart.items[0].quantity).toBe(2);

    await cleanup([product.id], [user.id]);
  });

  it('fija cantidad, elimina un item y vacía el carrito', async () => {
    const product = await createProduct(300);
    const sessionKey = `s-${randomUUID()}`;

    await cart.add({ sessionKey }, product.id, 1);
    await cart.setQuantity({ sessionKey }, product.id, 5);

    let view = await cart.list({ sessionKey });
    expect(view.items[0].quantity).toBe(5);
    expect(view.subtotalCents).toBe(1500);

    await cart.remove({ sessionKey }, product.id);
    view = await cart.list({ sessionKey });
    expect(view.items).toHaveLength(0);
    expect(view.subtotalCents).toBe(0);
    await cart.remove({ sessionKey }, product.id);

    await cart.add({ sessionKey }, product.id, 4);
    await cart.clear({ sessionKey });
    view = await cart.list({ sessionKey });
    expect(view.items).toHaveLength(0);

    await cleanup([product.id]);
  });

  it('setQuantity de un item inexistente lanza NotFound', async () => {
    const product = await createProduct(300);
    const sessionKey = `s-${randomUUID()}`;

    await expect(cart.setQuantity({ sessionKey }, product.id, 2)).rejects.toBeInstanceOf(
      NotFoundException,
    );

    await cleanup([product.id]);
  });

  it('rechaza productos inexistentes o no activos', async () => {
    const product = await createProduct(300, ProductStatus.ARCHIVED);
    const sessionKey = `s-${randomUUID()}`;

    await expect(cart.add({ sessionKey }, 99999999, 1)).rejects.toBeInstanceOf(NotFoundException);
    await expect(cart.add({ sessionKey }, product.id, 1)).rejects.toBeInstanceOf(
      ConflictException,
    );

    await cleanup([product.id]);
  });

  it('exige exactamente una identidad (userId o sessionKey)', async () => {
    const product = await createProduct(300);

    await expect(cart.add({}, product.id, 1)).rejects.toBeInstanceOf(BadRequestException);
    await expect(
      cart.add({ userId: 1, sessionKey: 'x' }, product.id, 1),
    ).rejects.toBeInstanceOf(BadRequestException);

    await cleanup([product.id]);
  });
});