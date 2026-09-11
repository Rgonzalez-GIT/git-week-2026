import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes, randomUUID } from 'node:crypto';
import { Order, Prisma, TicketCode } from '../generated/prisma/client.js';
import { TicketStatus } from '../generated/prisma/enums.js';
import { PrismaService } from '../prisma/prisma.service.js';

export type OrderForTickets = Order & {
  items: { productId: number; quantity: number }[];
};

/**
 * Código único POR ENTRADA (persona).
 *
 * Al CONFIRMARSE el pago de una orden se emite un TicketCode por cada entrada
 * (suma de cantidades de sus items). El primer código queda asociado al
 * comprador / líder del grupo (sus datos se copian del order.buyer*); el resto
 * queda AVAILABLE y se asigna después por el panel de administración
 * (contacto del líder se encarga el staff).
 *
 * Idempotente: si la orden ya tiene códigos emitidos, se devuelven.
 */
@Injectable()
export class TicketCodeService {
  constructor(private readonly prisma: PrismaService) {}

  async issueForPaidOrder(orderId: number, tx: Prisma.TransactionClient = this.prisma): Promise<TicketCode[]> {
    const existing = await tx.ticketCode.findMany({ where: { orderId } });
    if (existing.length > 0) return existing;

    const order = await tx.order.findUniqueOrThrow({
      where: { id: orderId },
      include: { items: { select: { productId: true, quantity: true } } },
    });

    const total = order.items.reduce((acc, item) => acc + item.quantity, 0);
    const tickets: TicketCode[] = [];
    const isLeaderByIndex = (i: number) => i === 0;

    const productAt = (index: number): number => {
      let cursor = 0;
      for (const item of order.items) {
        if (cursor + item.quantity > index) return item.productId;
        cursor += item.quantity;
      }
      return order.items[0]?.productId ?? 0;
    };

    for (let i = 0; i < total; i += 1) {
      const isLeader = isLeaderByIndex(i);
      const code = await tx.ticketCode.create({
        data: {
          publicId: randomUUID(),
          orderId: order.id,
          productId: productAt(i) || null,
          code: TicketCodeService.generateCode(),
          status: isLeader ? TicketStatus.ASSIGNED : TicketStatus.AVAILABLE,
          buyerFullName: isLeader
            ? `${order.buyerFirstName ?? ''} ${order.buyerLastName ?? ''}`.trim() || null
            : null,
          buyerDocNumber: isLeader ? (order.buyerDocNumber ?? null) : null,
          buyerEmail: isLeader ? (order.buyerEmail ?? null) : null,
          buyerPhone: isLeader ? (order.buyerPhone ?? null) : null,
          assignedAt: isLeader ? new Date() : null,
        },
      });
      tickets.push(code);
    }

    return tickets;
  }

  async listByOrder(orderId: number): Promise<TicketCode[]> {
    return this.prisma.ticketCode.findMany({
      where: { orderId },
      orderBy: { id: 'asc' },
    });
  }

  async findByCode(code: string): Promise<TicketCode | null> {
    return this.prisma.ticketCode.findUnique({ where: { code: code.trim().toUpperCase() } });
  }

  /** Asignación (staff/individuo) del titular a un código de entrada. */
  async assign(
    code: string,
    data: { fullName: string; docNumber?: string; email?: string; phone?: string },
  ): Promise<TicketCode> {
    const ticket = await this.findByCode(code);
    if (!ticket) {
      throw new NotFoundException(`Código ${code} no encontrado`);
    }
    if (ticket.status !== TicketStatus.AVAILABLE) {
      throw new ConflictException(`El código ${code} ya está asignado (${ticket.status})`);
    }
    return this.prisma.ticketCode.update({
      where: { id: ticket.id },
      data: {
        status: TicketStatus.ASSIGNED,
        buyerFullName: data.fullName.trim(),
        buyerDocNumber: data.docNumber?.trim() ?? null,
        buyerEmail: data.email?.trim() ?? null,
        buyerPhone: data.phone?.trim() ?? null,
        assignedAt: new Date(),
      },
    });
  }

  static generateCode(): string {
    return `GIT2026-${randomBytes(4).toString('hex').toUpperCase().slice(0, 7)}`;
  }
}