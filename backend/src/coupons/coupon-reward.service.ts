import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { Prisma } from '../generated/prisma/client.js';
import { CouponStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { Coupon } from '../generated/prisma/client.js';

/**
 * Fase 7 - Cupón físico emitido al CONFIRMARSE el pago.
 *
 * Cuando una orden pagada usó una promoción (order.discountCode), se emite un
 * cupón de recompensa único (PROMO-2026-XXXX) con estado AVAILABLE, asociado a
 * la orden y al usuario, más su QrImage apuntando a /coupon/{public-id}.
 *
 * El QR NO contiene datos sensibles: solo codifica la URL pública del cupón.
 *
 * Idempotencia: si ya existe un cupón para la orden, se devuelve el existente.
 */
@Injectable()
export class CouponRewardService {
  constructor(private readonly prisma: PrismaService) {}

  async issueForPaidOrder(orderId: number, tx: Prisma.TransactionClient = this.prisma): Promise<Coupon | null> {
    const existing = await tx.coupon.findFirst({ where: { orderId } });
    if (existing) return existing;

    const order = await tx.order.findUniqueOrThrow({ where: { id: orderId } });
    if (!order.discountCode) {
      return null;
    }
    const promotion = await tx.promotion.findFirst({
      where: { code: order.discountCode, issuesCouponOnPaid: true },
    });
    if (!promotion) {
      return null;
    }

    const publicId = randomUUID();
    const code = this.generateCode();

    const coupon = await tx.coupon.create({
      data: {
        publicId,
        code,
        userId: order.userId,
        promotionId: promotion.id,
        orderId: order.id,
        issuedAt: new Date(),
        expiresAt: new Date(Date.now() + promotion.couponValidityHours * 3_600_000),
        status: CouponStatus.AVAILABLE,
        qrImages: {
          create: { url: `/coupon/${publicId}` },
        },
      },
    });
    return coupon;
  }

  async findByPublicId(publicId: string): Promise<Coupon | null> {
    return this.prisma.coupon.findUnique({
      where: { publicId },
      include: { qrImages: true },
    });
  }

  async listMine(userId: number) {
    const rows = await this.prisma.coupon.findMany({
      where: { userId },
      include: { promotion: { select: { name: true } } },
      orderBy: { createdAt: 'desc' },
    });
    return rows.map((c) => ({
      publicId: c.publicId,
      code: c.code,
      status: c.status,
      expiresAt: c.expiresAt,
      redeemedAt: c.redeemedAt,
      promotionName: c.promotion.name,
      qrUrl: `/coupon/${c.publicId}/qr`,
    }));
  }

  /**
   * Fase 8 - Redemption transaccional anti doble canje.
   *
   * El claim es un UPDATE atómico con guarda (status AVAILABLE) dentro de una
   * transacción en PostgreSQL: si dos usuarios canjean el mismo cupón a la vez,
   * SOLO uno pone la fila en REDEEMED. Ambas intenciones quedan en el historial
   * CouponRedemption (acción REDEEMED / CONFLICT) para auditoría.
   */
  async redeem(userId: number, publicId: string): Promise<Coupon> {
    const coupon = await this.prisma.coupon.findUnique({ where: { publicId } });
    if (!coupon) {
      throw new NotFoundException(`Cupón ${publicId} no encontrado`);
    }
    if (coupon.expiresAt < new Date()) {
      await this.recordRedemption(coupon.id, userId, 'EXPIRED');
      throw new ConflictException('El cupón expiró');
    }

    const claimed = await this.prisma.$transaction(async (tx) => {
      const result = await tx.coupon.updateMany({
        where: { id: coupon.id, status: CouponStatus.AVAILABLE },
        data: { status: CouponStatus.REDEEMED, redeemedAt: new Date() },
      });
      if (result.count > 0) {
        await tx.couponRedemption.create({
          data: { couponId: coupon.id, userId, action: 'REDEEMED' },
        });
      }
      return result.count;
    });

    if (claimed === 0) {
      await this.recordRedemption(coupon.id, userId, 'CONFLICT');
      throw new ConflictException('El cupón ya fue canjeado');
    }
    return this.prisma.coupon.findUniqueOrThrow({ where: { id: coupon.id } });
  }

  private async recordRedemption(couponId: number, userId: number, action: string): Promise<void> {
    await this.prisma.couponRedemption
      .create({ data: { couponId, userId, action } })
      .catch(() => undefined);
  }

  async findQr(publicId: string): Promise<{ url: string } | null> {
    const qrImage = await this.prisma.qrImage.findFirst({
      where: { coupon: { publicId } },
    });
    return qrImage ? { url: qrImage.url } : null;
  }

  private generateCode(): string {
    return `PROMO-2026-${randomBytes(4).toString('hex').toUpperCase()}`;
  }
}