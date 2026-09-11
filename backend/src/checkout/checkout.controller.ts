import { Body, Controller, Get, Headers, Param, Post, Put, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { OrderService } from '../orders/order.service.js';
import { ReservationService } from '../reservations/reservation.service.js';
import { BuyerCheckoutDto, CheckoutOrderDto } from './checkout.dto.js';

/**
 * Fase 11 - APIs de compra con autenticación.
 *
 * POST /checkout convierte una reserva ACTIVE del propio usuario en una orden
 * (checkout atómico e idempotente). GET /checkout/:publicId devuelve la orden
 * al dueño. La creación de la reserva vive en ReservationController.
 */
@Controller('checkout')
@UseGuards(JwtAuthGuard)
export class CheckoutController {
  constructor(
    private readonly reservations: ReservationService,
    private readonly orders: OrderService,
  ) {}

  @Post()
  async checkout(
    @CurrentUser('sub') userId: number,
    @Headers('idempotency-key') idempotencyKey: string | undefined,
    @Body() dto: CheckoutOrderDto,
  ) {
    const reservation = await this.reservations.findByPublicId(dto.reservationPublicId);
    return this.orders.createOrder({
      userId,
      reservationId: reservation.id,
      idempotencyKey: idempotencyKey?.trim() || `checkout:${reservation.publicId}`,
    });
  }

  @Get(':publicId')
  async get(@CurrentUser('sub') userId: number, @Param('publicId') publicId: string) {
    return this.orders.findOwnedByPublicId(publicId, userId);
  }

  @Put(':publicId/buyer')
  async setBuyer(
    @CurrentUser('sub') userId: number,
    @Param('publicId') publicId: string,
    @Body() dto: BuyerCheckoutDto,
  ) {
    return this.orders.setBuyer(userId, publicId, dto);
  }
}