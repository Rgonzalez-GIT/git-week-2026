import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

/** Cliente de base de datos usable dentro de una transacciÃ³n interactiva. */
export type TxClient = Prisma.TransactionClient | PrismaService;

export interface StockMutationResult {
  success: boolean;
  productId: number;
  quantity: number;
}

/**
 * Fase 3 â€” Inventario consistente bajo alta concurrencia.
 *
 * NUNCA se hace: SELECT stock -> validar en app -> UPDATE (race condition).
 * Siempre: UPDATE atÃ³mico con guarda en WHERE + COUNT de filas afectadas.
 * PostgreSQL es la fuente de verdad. Redis no participa del stock.
 */
@Injectable()
export class InventoryService {
  constructor(private readonly prisma: PrismaService) {}

  async find(productId: number) {
    const inventory = await this.prisma.inventory.findUnique({ where: { productId } });
    if (!inventory) {
      throw new NotFoundException(`Producto ${productId} sin registro de inventario`);
    }
    return inventory;
  }

  /** Reserva stock de forma atÃ³mica. Falla (false) si no hay suficiente disponible. */
  async reserve(productId: number, quantity: number, tx?: TxClient): Promise<StockMutationResult> {
    const client = tx ?? this.prisma;
    const affected = await client.$executeRaw`
      UPDATE "inventory"
      SET "reservedStock" = "reservedStock" + ${quantity},
          "availableStock" = "availableStock" - ${quantity},
          "version" = "version" + 1,
          "updatedAt" = NOW()
      WHERE "productId" = ${productId}
        AND "availableStock" >= ${quantity}
    `;
    return { success: affected === 1, productId, quantity };
  }

  /** Libera stock reservado (expiraciÃ³n de reserva / cancelaciÃ³n). Idempotente por guarda. */
  async release(productId: number, quantity: number, tx?: TxClient): Promise<StockMutationResult> {
    const client = tx ?? this.prisma;
    const affected = await client.$executeRaw`
      UPDATE "inventory"
      SET "reservedStock" = "reservedStock" - ${quantity},
          "availableStock" = "availableStock" + ${quantity},
          "version" = "version" + 1,
          "updatedAt" = NOW()
      WHERE "productId" = ${productId}
        AND "reservedStock" >= ${quantity}
    `;
    return { success: affected === 1, productId, quantity };
  }

  /** Convierte reserva en venta: mueve reserved a sold. Guarda contra reservas insuficientes. */
  async sell(productId: number, quantity: number, tx?: TxClient): Promise<StockMutationResult> {
    const client = tx ?? this.prisma;
    const affected = await client.$executeRaw`
      UPDATE "inventory"
      SET "soldStock" = "soldStock" + ${quantity},
          "reservedStock" = "reservedStock" - ${quantity},
          "version" = "version" + 1,
          "updatedAt" = NOW()
      WHERE "productId" = ${productId}
        AND "reservedStock" >= ${quantity}
    `;
    return { success: affected === 1, productId, quantity };
  }

  /** ReposiciÃ³n de stock por administraciÃ³n (solo incrementa; nunca permite sobrepasar capacidad lÃ³gica). */
  async restock(productId: number, additionalStock: number, tx?: TxClient): Promise<StockMutationResult> {
    const client = tx ?? this.prisma;
    const affected = await client.$executeRaw`
      UPDATE "inventory"
      SET "initialStock" = "initialStock" + ${additionalStock},
          "availableStock" = "availableStock" + ${additionalStock},
          "version" = "version" + 1,
          "updatedAt" = NOW()
      WHERE "productId" = ${productId}
    `;
    return { success: affected === 1, productId, quantity: additionalStock };
  }

  /** Recalcula availableStock = initial - reserved - sold (correcciÃ³n/auditorÃ­a manual). */
  async reconcile(productId: number, tx?: TxClient): Promise<boolean> {
    const client = tx ?? this.prisma;
    const affected = await client.$executeRaw`
      UPDATE "inventory"
      SET "availableStock" = "initialStock" - "reservedStock" - "soldStock",
          "version" = "version" + 1,
          "updatedAt" = NOW()
      WHERE "productId" = ${productId}
    `;
    return affected === 1;
  }
}