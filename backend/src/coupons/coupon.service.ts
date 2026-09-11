import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Order, Promotion } from '../generated/prisma/client.js';
import { DiscountType, OrderStatus, PromotionStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface ActiveCouponCodigo {
  code: string;
  name: string;
  description: string | null;
  discountType: DiscountType;
  discountValue: number;
}

export interface ApplyCouponInput {
  userId: number;
  orderPublicId: string;
  code: string;
}

export interface ApplyCouponResult {
  processed: boolean;
  replay: boolean;
  discountCents: number;
  totalCents: number;
  order: Order & { items: { id: number; productId: number; quantity: number; unitPriceCents: number; lineTotalCents: number }[] };
}

/**
 * Fase 7-8/19 - Cupones de descuento.
 *
 * Adaptado al requerimiento: los codigos funcionales URPxGIT, UTPxGIT y
 * UNABxGIT descuentan S/5 (500 centavos) POR ENTRADA: si la orden es de N
 * entradas, el descuento es S/5 * N (ej. 3 entradas = S/15).
 *
 * Diferencia con APPGITWEEK.md Fase 7: el cupon fisico (code PROMO-2026-XXXXXX
 * + QR a /coupon/{public-id}) se genera recien cuando el pago es CONFIRMADO,
 * no al aplicar el descuento. Aqui solo se aplica el descuento a la orden.
 *
 * Anti doble aplicacion / concurrencia:
 *  - UPDATE atomico con guarda (discountCents = 0) sobre la orden.
 *  - UPDATE atomico con guarda de capacidad sobre la promocion
 *    (maxRedemptions), dentro de la misma transaccion.
 *  - Replay idempotente: mismo codigo + misma orden retorna el estado actual.
 */
@Injectable()
export class CouponService {
  constructor(private readonly prisma: PrismaService) {}

  async listActive(): Promise<ActiveCouponCodigo[]> {
    const now = new Date();
    const rows = await this.prisma.promotion.findMany({
      where: {
        status: PromotionStatus.ACTIVE,
        code: { not: null },
        startsAt: { lte: now },
        endsAt: { gte: now },
      },
      orderBy: { code: 'asc' },
    });
    return rows.map((p) => ({
      code: p.code as string,
      name: p.name,
      description: p.description,
      discountType: p.discountType,
      discountValue: p.discountValue,
    }));
  }

  /** Consulta un codigo sin mutar nada. Lanza si no es aplicable. */
  async checkCode(code: string): Promise<ActiveCouponCodigo> {
    const promotion = await this.findUsable(code);
    return {
      code: promotion.code as string,
      name: promotion.name,
      description: promotion.description,
      discountType: promotion.discountType,
      discountValue: promotion.discountValue,
    };
  }

  async apply(input: ApplyCouponInput): Promise<ApplyCouponResult> {
    const promotion = await this.findUsable(input.code);

    const order = await this.prisma.order.findUnique({
      where: { publicId: input.orderPublicId },
      include: {
        items: {
          select: {
            id: true,
            productId: true,
            quantity: true,
            unitPriceCents: true,
            lineTotalCents: true,
          },
        },
      },
    });
    if (!order) {
      throw new NotFoundException(`Orden ${input.orderPublicId} no encontrada`);
    }
    if (order.userId !== input.userId) {
      throw new ForbiddenException('La orden no pertenece al usuario');
    }
    if (order.status !== OrderStatus.PAYMENT_PENDING) {
      throw new ConflictException(`La orden en estado ${order.status} no admite cupones`);
    }
    if (order.discountCents > 0) {
      if (order.discountCode === promotion.code) {
        return this.toResult(true, order);
      }
      throw new ConflictException('La orden ya tiene un descuento aplicado');
    }

    const discountCents = this.computeDiscount(promotion, order);

    const updated = await this.prisma.$transaction(async (tx) => {
      const capacityGuarded =
        promotion.maxRedemptions !== null
          ? { usedRedemptions: { lt: promotion.maxRedemptions } }
          : {};
      const capacity = await tx.promotion.updateMany({
        where: {
          id: promotion.id,
          ...capacityGuarded,
        },
        data: { usedRedemptions: { increment: 1 } },
      });
      if (capacity.count === 0) {
        throw new ConflictException('Cupón agotado');
      }

      const claimed = await tx.order.updateMany({
        where: {
          id: order.id,
          userId: order.userId,
          status: OrderStatus.PAYMENT_PENDING,
          discountCents: 0,
        },
        data: {
          discountCents,
          discountCode: promotion.code as string,
          totalCents: order.subtotalCents - discountCents,
        },
      });
      if (claimed.count === 0) {
        throw new ConflictException('La orden ya tiene un descuento aplicado');
      }

      return tx.order.findUniqueOrThrow({
        where: { id: order.id },
        include: {
          items: {
            select: {
              id: true,
              productId: true,
              quantity: true,
              unitPriceCents: true,
              lineTotalCents: true,
            },
          },
        },
      });
    });

    return this.toResult(false, updated);
  }

  private async findUsable(code: string): Promise<Promotion> {
    const normalized = code.trim();
    const promotion = await this.prisma.promotion.findUnique({
      where: { code: normalized },
    });
    if (!promotion) {
      throw new NotFoundException(`Cupón "${normalized}" no válido`);
    }
    if (promotion.status !== PromotionStatus.ACTIVE) {
      throw new ConflictException(`Cupón "${normalized}" no está activo`);
    }
    const now = new Date();
    if (now < promotion.startsAt || now > promotion.endsAt) {
      throw new ConflictException('Cupón fuera de vigencia');
    }
    return promotion;
  }

  private computeDiscount(promotion: Promotion, order: { subtotalCents: number; items: { quantity: number }[] }): number {
    const totalQuantity = order.items.reduce((acc, item) => acc + item.quantity, 0);
    if (promotion.discountType === DiscountType.PERCENT) {
      return Math.min(order.subtotalCents, Math.floor((order.subtotalCents * promotion.discountValue) / 100));
    }
    // FIXED_AMOUNT: S/ descuentoValue POR ENTRADA (ej. 500 * 3 = 1500 para 3 entradas).
    return Math.min(order.subtotalCents, promotion.discountValue * totalQuantity);
  }

  private toResult(replay: boolean, order: Order & { items?: unknown[] }): ApplyCouponResult {
    return {
      processed: true,
      replay,
      discountCents: order.discountCents,
      totalCents: order.totalCents,
      order: order as ApplyCouponResult['order'],
    };
  }
}