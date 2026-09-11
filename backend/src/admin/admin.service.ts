import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { TicketCodeService } from '../tickets/ticket-code.service.js';
import {
  AssignTicketAdminDto,
  UpdateProductAdminDto,
  UpdatePromotionAdminDto,
} from './admin.dto.js';

/**
 * Fase 14 - Panel de administración.
 * Operaciones de gestión que solo ejecutan usuarios con rol ADMIN.
 */
@Injectable()
export class AdminService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tickets: TicketCodeService,
  ) {}

  async stats() {
    const [users, orders, products, promotions, revenue] = await Promise.all([
      this.prisma.user.count(),
      this.prisma.order.count(),
      this.prisma.product.count(),
      this.prisma.promotion.count(),
      this.prisma.order.aggregate({ _sum: { totalCents: true }, where: { status: 'PAID' } }),
    ]);
    return {
      users,
      orders,
      products,
      promotions,
      paidRevenueCents: revenue._sum.totalCents ?? 0,
    };
  }

  async listUsers() {
    return this.prisma.user.findMany({
      select: {
        id: true,
        email: true,
        fullName: true,
        role: { select: { code: true, name: true } },
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listOrders() {
    return this.prisma.order.findMany({
      include: {
        items: true,
        user: { select: { email: true, fullName: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async listPromotions() {
    return this.prisma.promotion.findMany({
      orderBy: { createdAt: 'desc' },
    });
  }

  async updateProduct(id: number, dto: UpdateProductAdminDto) {
    const exists = await this.prisma.product.findUnique({ where: { id } });
    if (!exists) {
      throw new NotFoundException(`Producto ${id} no encontrado`);
    }
    return this.prisma.product.update({
      where: { id },
      data: {
        name: dto.name,
        description: dto.description,
        priceCents: dto.priceCents,
        status: dto.status,
      },
    });
  }

  async updatePromotion(id: number, dto: UpdatePromotionAdminDto) {
    const exists = await this.prisma.promotion.findUnique({ where: { id } });
    if (!exists) {
      throw new NotFoundException(`Promoción ${id} no encontrada`);
    }
    return this.prisma.promotion.update({
      where: { id },
      data: {
        status: dto.status,
        maxRedemptions: dto.maxRedemptions,
        endsAt: dto.endsAt ? new Date(dto.endsAt) : undefined,
      },
    });
  }

  async listTickets() {
    return this.prisma.ticketCode.findMany({
      include: {
        order: {
          select: {
            publicId: true,
            status: true,
            buyerFirstName: true,
            buyerLastName: true,
            items: { select: { product: { select: { name: true } }, quantity: true } },
          },
        },
        product: { select: { name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
  }

  async assignTicket(code: string, dto: AssignTicketAdminDto) {
    return this.tickets.assign(code, {
      fullName: dto.fullName,
      docNumber: dto.docNumber,
      email: dto.email,
      phone: dto.phone,
    });
  }
}