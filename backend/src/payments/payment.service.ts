import { ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { InventoryReservation, Order, Payment, Prisma } from '../generated/prisma/client.js';
import { PaymentProvider, PaymentStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { ReservationService } from '../reservations/reservation.service.js';
import { CouponRewardService } from '../coupons/coupon-reward.service.js';

export type PaymentEvent = {
  provider: PaymentProvider;
  providerTransactionId: string;
  rawEventId: string;
  success: boolean;
  amountCents?: number;
  metadata?: Prisma.InputJsonValue | null;
};

export type OrderWithReservation = Order & { reservation: InventoryReservation | null };

export interface ConfirmPaymentResult {
  processed: boolean;
  payment: Payment;
  order?: OrderWithReservation;
}

/**
 * Fase 6 - Pagos.
 *
 * - `createForOrder`: crea un pago PENDING por el total de la orden y ancla el
 *   provider (PAYMENT_PROVIDER del .env). Una sola transaccion pendiente por orden.
 * - `confirmPayment`: entrada de webhook/proveedor. Idempotente por rawEventId:
 *   el primer evento que pasa la guarda (PENDING/FAILED -> terminal) convierte a
 *   la reserva y marca la orden PAID; los eventos duplicados son replays y no
 *   tocan stock ni orden.
 *
 * El provider real se integra via adaptadores; el sandbox de esta fase confirma
 * con un evento simulado.
 */
@Injectable()
export class PaymentService {
  private readonly defaultProvider: PaymentProvider;

  constructor(
    private readonly prisma: PrismaService,
    private readonly reservations: ReservationService,
    private readonly couponRewards: CouponRewardService,
    config: ConfigService,
  ) {
    const provider = config.get<string>('PAYMENT_PROVIDER', 'sandbox') as string;
    this.defaultProvider = (Object.values(PaymentProvider) as string[]).includes(provider)
      ? (provider as PaymentProvider)
      : PaymentProvider.STRIPE;
  }

  async findByPublicId(publicId: string): Promise<Payment> {
    const payment = await this.prisma.payment.findUnique({ where: { publicId } });
    if (!payment) {
      throw new NotFoundException(`Pago ${publicId} no encontrado`);
    }
    return payment;
  }

  /** Crea un pago PENDING solo si la orden pertenece al usuario. */
  async createForUser(
    orderPublicId: string,
    ownerUserId: number,
    provider: PaymentProvider = this.defaultProvider,
  ): Promise<Payment> {
    const order = await this.prisma.order.findUnique({
      where: { publicId: orderPublicId },
      select: { userId: true },
    });
    if (!order) {
      throw new NotFoundException(`Orden ${orderPublicId} no encontrada`);
    }
    if (order.userId !== ownerUserId) {
      throw new ForbiddenException('La orden no pertenece al usuario');
    }
    return this.createForOrder(orderPublicId, provider);
  }

  /** Crea (o reutiliza) el pago PENDING de una orden en PAYMENT_PENDING. */
  async createForOrder(orderPublicId: string, provider: PaymentProvider = this.defaultProvider): Promise<Payment> {
    const order = await this.prisma.order.findUnique({
      where: { publicId: orderPublicId },
      include: { reservation: true },
    });
    if (!order) {
      throw new NotFoundException(`Orden ${orderPublicId} no encontrada`);
    }
    if (order.status === 'PAID') {
      throw new ConflictException('La orden ya está pagada');
    }
    if (order.status !== 'PAYMENT_PENDING') {
      throw new ConflictException(`La orden no admite pago en estado ${order.status}`);
    }
    if (!order.reservation) {
      throw new ConflictException('La orden no tiene una reserva asociada');
    }

    const pending = await this.prisma.payment.findFirst({
      where: { orderId: order.id, status: PaymentStatus.PENDING },
    });
    if (pending) return pending;

    return this.prisma.payment.create({
      data: {
        publicId: randomUUID(),
        orderId: order.id,
        provider,
        providerTransactionId: randomUUID(),
        status: PaymentStatus.PENDING,
        amountCents: order.totalCents,
        currency: order.currency,
      },
    });
  }

  /** Confirma un pago desde el proveedor. Idempotente por rawEventId. */
  async confirmPayment(event: PaymentEvent): Promise<ConfirmPaymentResult> {
    const payment = await this.prisma.payment.findFirst({
      where: {
        provider: event.provider,
        providerTransactionId: event.providerTransactionId,
      },
    });
    if (!payment) {
      throw new NotFoundException(
        `No hay pago ${event.provider}/${event.providerTransactionId} pendiente`,
      );
    }
    if (payment.status === PaymentStatus.PAID || payment.status === PaymentStatus.CANCELLED) {
      return { processed: false, payment };
    }
    if (event.success && event.amountCents !== undefined && event.amountCents !== payment.amountCents) {
      throw new ConflictException(
        `El monto del evento (${event.amountCents}) no coincide con el esperado (${payment.amountCents})`,
      );
    }

    return this.prisma.$transaction(async (tx) => {
      const claimed = await tx.payment.updateMany({
        where: { id: payment.id, status: { in: [PaymentStatus.PENDING, PaymentStatus.FAILED] } },
        data: {
          status: event.success ? PaymentStatus.PAID : PaymentStatus.FAILED,
          rawEventId: event.rawEventId,
          metadata: event.metadata ?? undefined,
        },
      });
      if (claimed.count === 0) {
        return {
          processed: false,
          payment: await tx.payment.findUniqueOrThrow({ where: { id: payment.id } }),
        };
      }

      const freshPayment = await tx.payment.findUniqueOrThrow({ where: { id: payment.id } });
      const order = await tx.order.findUniqueOrThrow({ where: { id: payment.orderId } });

      if (event.success) {
        if (order.reservationId) {
          const reservation = await tx.inventoryReservation.findUnique({
            where: { id: order.reservationId },
          });
          if (reservation && reservation.status === 'ACTIVE') {
            await this.reservations.convert(reservation.publicId, tx);
          }
        }
        await tx.order.update({
          where: { id: order.id },
          data: { status: 'PAID', paidAt: new Date() },
        });

        // Fase 7: si la orden pagada usó una promoción, emitir el cupón físico + QR.
        await this.couponRewards.issueForPaidOrder(order.id, tx);
      }

      const updatedOrder = await tx.order.findUniqueOrThrow({
        where: { id: order.id },
        include: { reservation: true },
      });

      return { processed: true, payment: freshPayment, order: updatedOrder };
    });
  }
}