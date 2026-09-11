import {
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Order, OrderItem, Prisma } from '../generated/prisma/client.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface CreateOrderInput {
  userId: number;
  reservationId: number;
  idempotencyKey: string;
  currency?: string;
}

export type OrderWithItems = Order & { items: OrderItem[] };

const ORDER_INCLUDE = { items: true } as const;

/**
 * Fase 5 - Ordenes con checkout atomico e idempotencia.
 *
 * Una orden se crea a partir de una reserva temporal ACTIVE (Fase 4) del
 * mismo usuario. Todo el flujo corre en una transaccion:
 * - lock de la reserva (FOR UPDATE) para impedir doble consumo concurrente,
 * - snapshot de precios del producto al momento del checkout,
 * - creacion de la orden + items + clave de idempotencia.
 *
 * La reserva permanece ACTIVE hasta que el pago confirme (Fase 6), cuando se
 * convierte en CONVERTED y el stock pasa de reservado a vendido.
 */
@Injectable()
export class OrderService {
  constructor(private readonly prisma: PrismaService) {}

  async findByPublicId(publicId: string): Promise<OrderWithItems> {
    const order = await this.prisma.order.findUnique({
      where: { publicId },
      include: ORDER_INCLUDE,
    });
    if (!order) {
      throw new NotFoundException(`Orden ${publicId} no encontrada`);
    }
    return order;
  }

  /** Crea la orden a partir de una reserva ACTIVE. Idempotente por idempotencyKey. */
  async createOrder(input: CreateOrderInput): Promise<OrderWithItems> {
    const replay = await this.findByKey(input.idempotencyKey);
    if (replay) return replay;

    try {
      return await this.prisma.$transaction(async (tx) => {
        const locked = await tx.$queryRaw<Array<{ id: number }>>`
          SELECT "id" FROM "inventory_reservations" WHERE "id" = ${input.reservationId} FOR UPDATE
        `;
        if (locked.length === 0) {
          throw new NotFoundException(`Reserva ${input.reservationId} no encontrada`);
        }

        const reservation = await tx.inventoryReservation.findUniqueOrThrow({
          where: { id: input.reservationId },
        });

        if (reservation.userId !== input.userId) {
          throw new ForbiddenException('La reserva no pertenece al usuario');
        }
        if (reservation.status !== 'ACTIVE') {
          throw new ConflictException('La reserva no está activa');
        }

        const linked = await tx.order.findUnique({ where: { reservationId: reservation.id } });
        if (linked) {
          throw new ConflictException('La reserva ya fue consumida por otra orden');
        }

        const product = await tx.product.findUniqueOrThrow({ where: { id: reservation.productId } });

        const unitPriceCents = product.priceCents;
        const lineTotalCents = unitPriceCents * reservation.quantity;

        const order = await tx.order.create({
          data: {
            publicId: randomUUID(),
            userId: input.userId,
            idempotencyKey: input.idempotencyKey,
            reservationId: reservation.id,
            status: 'PAYMENT_PENDING',
            subtotalCents: lineTotalCents,
            discountCents: 0,
            totalCents: lineTotalCents,
            currency: input.currency ?? 'PEN',
            items: {
              create: {
                productId: reservation.productId,
                quantity: reservation.quantity,
                unitPriceCents,
                lineTotalCents,
              },
            },
          },
          include: ORDER_INCLUDE,
        });

        await tx.idempotencyKey.create({
          data: {
            key: input.idempotencyKey,
            orderId: order.id,
            status: 'USED',
            payload: input as unknown as Prisma.InputJsonValue,
          },
        });

        return order;
      });
    } catch (error) {
      if (this.isUniqueViolation(error)) {
        const winner = await this.findByKey(input.idempotencyKey);
        if (winner) return winner;
      }
      throw error;
    }
  }

  async getOrderById(id: number): Promise<OrderWithItems> {
    return this.prisma.order.findUniqueOrThrow({
      where: { id },
      include: ORDER_INCLUDE,
    });
  }

  async listByUser(userId: number): Promise<OrderWithItems[]> {
    return this.prisma.order.findMany({
      where: { userId },
      include: ORDER_INCLUDE,
      orderBy: { createdAt: 'desc' },
    });
  }

  async findOwnedByPublicId(publicId: string, userId: number): Promise<OrderWithItems> {
    const order = await this.findByPublicId(publicId);
    if (order.userId !== userId) {
      throw new ForbiddenException('La orden no pertenece al usuario');
    }
    return order;
  }

  private async findByKey(key: string): Promise<OrderWithItems | null> {
    const idem = await this.prisma.idempotencyKey.findUnique({
      where: { key },
      select: { orderId: true },
    });
    if (!idem?.orderId) return null;
    return this.getOrderById(idem.orderId);
  }

  private isUniqueViolation(error: unknown): boolean {
    return error instanceof Prisma.PrismaClientKnownRequestError && error.code === 'P2002';
  }
}