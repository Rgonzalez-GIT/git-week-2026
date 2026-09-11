import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { PaymentProvider } from '../generated/prisma/enums.js';
import { ReservationService } from '../reservations/reservation.service.js';
import { OrderService } from '../orders/order.service.js';
import { CouponService } from '../coupons/coupon.service.js';
import { PaymentService } from '../payments/payment.service.js';
import { PrismaService } from '../prisma/prisma.service.js';

const DEMO_USER_EMAIL = 'customer@gitweek.local';

/**
 * Modo demo SOLO desarrollo (DEMO_MODE=true).
 *
 * Expone las mutaciones de dominio (reserva -> orden -> cupón -> pago ->
 * webhook sandbox) usando el cliente demo sembrado, para poder probar el
 * flujo completo desde el navegador sin autenticación. En producción no se
 * carga este módulo ni existen estas rutas.
 */
@Injectable()
export class DemoService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly reservations: ReservationService,
    private readonly orders: OrderService,
    private readonly coupons: CouponService,
    private readonly payments: PaymentService,
  ) {}

  async demoUser() {
    let user = await this.prisma.user.findUnique({ where: { email: DEMO_USER_EMAIL } });
    if (!user) {
      const role = await this.prisma.role.upsert({
        where: { code: 'CUSTOMER' },
        update: {},
        create: { code: 'CUSTOMER', name: 'Cliente' },
      });
      user = await this.prisma.user.create({
        data: {
          email: DEMO_USER_EMAIL,
          fullName: 'Cliente Demo',
          passwordHash: 'demo-no-login',
          roleId: role.id,
        },
      });
    }
    return user;
  }

  async createReservation(productId: number, quantity: number) {
    const user = await this.demoUser();
    const reservation = await this.reservations.create({
      userId: user.id,
      productId,
      quantity,
    });
    return { reservation, demoUserEmail: DEMO_USER_EMAIL };
  }

  async createOrder(reservationPublicId: string) {
    const user = await this.demoUser();
    const reservation = await this.reservations.findByPublicId(reservationPublicId);
    return this.orders.createOrder({
      userId: user.id,
      reservationId: reservation.id,
      idempotencyKey: `demo-${reservation.publicId}`,
    });
  }

  async applyCoupon(orderPublicId: string, code: string) {
    const user = await this.demoUser();
    return this.coupons.apply({ userId: user.id, orderPublicId, code });
  }

  async createPayment(orderPublicId: string, provider?: string) {
    const user = await this.demoUser();
    const order = await this.prisma.order.findUnique({ where: { publicId: orderPublicId } });
    if (!order) {
      throw new NotFoundException(`Orden ${orderPublicId} no encontrada`);
    }
    if (order.userId !== user.id) {
      throw new ConflictException('La orden no pertenece al cliente demo');
    }
    const validProviders = Object.values(PaymentProvider) as string[];
    const resolved = provider && validProviders.includes(provider)
      ? (provider as PaymentProvider)
      : PaymentProvider.STRIPE;
    return this.payments.createForOrder(orderPublicId, resolved);
  }

  async confirmPayment(orderPublicId: string, success = true) {
    const user = await this.demoUser();
    const order = await this.prisma.order.findUnique({ where: { publicId: orderPublicId } });
    if (!order) {
      throw new NotFoundException(`Orden ${orderPublicId} no encontrada`);
    }
    if (order.userId !== user.id) {
      throw new ConflictException('La orden no pertenece al cliente demo');
    }
    const payment = await this.prisma.payment.findFirst({
      where: { orderId: order.id },
      orderBy: { createdAt: 'desc' },
    });
    if (!payment) {
      throw new NotFoundException(`La orden ${orderPublicId} no tiene pagos`);
    }
    if (!payment.providerTransactionId) {
      throw new ConflictException('El pago no tiene providerTransactionId');
    }
    return this.payments.confirmPayment({
      provider: payment.provider,
      providerTransactionId: payment.providerTransactionId,
      rawEventId: randomUUID(),
      success,
      amountCents: payment.amountCents,
    });
  }
}