import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { CartItem } from '../generated/prisma/client.js';
import { ProductStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface CartIdentity {
  userId?: number;
  sessionKey?: string;
}

export type CartWhere = { userId: number } | { sessionKey: string };

export interface CartLine {
  id: number;
  productId: number;
  slug: string;
  name: string;
  priceCents: number;
  quantity: number;
  lineTotalCents: number;
}

export interface CartView {
  identity: CartWhere;
  items: CartLine[];
  subtotalCents: number;
}

/**
 * Fase 7 - Carrito.
 *
 * Soporta dos identidades: `userId` (sesion autenticada, llega en la fase IAM)
 * y `sessionKey` (carrito de invitado, usable sin auth). El modelo CartItem
 * garantiza un solo item por (userId, productId) o (sessionKey, productId).
 *
 * El stock NO se valida aqui: se congela en el checkout vía reservas (Fase 4).
 * El precio se toma del producto en este momento y se reconfirma en Fase 5.
 */
@Injectable()
export class CartService {
  constructor(private readonly prisma: PrismaService) {}

  async list(identity: CartIdentity): Promise<CartView> {
    const where = this.resolveWhere(identity);
    const rows = await this.prisma.cartItem.findMany({
      where,
      include: { product: true },
      orderBy: { createdAt: 'asc' },
    });

    const items: CartLine[] = rows.map((row) => ({
      id: row.id,
      productId: row.productId,
      slug: row.product.slug,
      name: row.product.name,
      priceCents: row.product.priceCents,
      quantity: row.quantity,
      lineTotalCents: row.quantity * row.product.priceCents,
    }));

    return {
      identity: where,
      items,
      subtotalCents: items.reduce((acc, it) => acc + it.lineTotalCents, 0),
    };
  }

  /** Agrega un producto al carrito; si ya existe, acumula la cantidad. */
  async add(identity: CartIdentity, productId: number, quantity = 1): Promise<CartItem> {
    if (quantity < 1) {
      throw new BadRequestException('La cantidad debe ser al menos 1');
    }
    await this.assertProductAddable(productId);
    const where = this.resolveWhere(identity);

    if ('userId' in where) {
      return this.prisma.cartItem.upsert({
        where: { userId_productId: { userId: where.userId, productId } },
        update: { quantity: { increment: quantity } },
        create: { userId: where.userId, productId, quantity },
      });
    }
    return this.prisma.cartItem.upsert({
      where: { sessionKey_productId: { sessionKey: where.sessionKey, productId } },
      update: { quantity: { increment: quantity } },
      create: { sessionKey: where.sessionKey, productId, quantity },
    });
  }

  /** Fija la cantidad de un item existente (>= 1). */
  async setQuantity(identity: CartIdentity, productId: number, quantity: number): Promise<void> {
    if (quantity < 1) {
      throw new BadRequestException('La cantidad debe ser al menos 1');
    }
    const where = this.resolveWhere(identity);
    const result = await this.prisma.cartItem.updateMany({
      where: { ...where, productId },
      data: { quantity },
    });
    if (result.count === 0) {
      throw new NotFoundException(`El producto ${productId} no está en el carrito`);
    }
  }

  /** Elimina un item del carrito. Idempotente. */
  async remove(identity: CartIdentity, productId: number): Promise<{ ok: true }> {
    const where = this.resolveWhere(identity);
    await this.prisma.cartItem.deleteMany({ where: { ...where, productId } });
    return { ok: true };
  }

  /** Vacía el carrito. Idempotente. */
  async clear(identity: CartIdentity): Promise<{ ok: true }> {
    const where = this.resolveWhere(identity);
    await this.prisma.cartItem.deleteMany({ where });
    return { ok: true };
  }

  private async assertProductAddable(productId: number): Promise<void> {
    const product = await this.prisma.product.findUnique({ where: { id: productId } });
    if (!product) {
      throw new NotFoundException(`Producto ${productId} no encontrado`);
    }
    if (product.status !== ProductStatus.ACTIVE) {
      throw new ConflictException(`El producto ${productId} no está disponible (${product.status})`);
    }
  }

  private resolveWhere(identity: CartIdentity): CartWhere {
    const hasUser = identity.userId !== undefined && identity.userId !== null;
    const hasSession =
      typeof identity.sessionKey === 'string' && identity.sessionKey.trim().length > 0;

    if (hasUser === hasSession) {
      throw new BadRequestException('Indica exactamente uno: userId o sessionKey');
    }
    return hasUser
      ? { userId: identity.userId as number }
      : { sessionKey: (identity.sessionKey as string).trim() };
  }
}