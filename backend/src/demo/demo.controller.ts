import { Body, Controller, Post, UseGuards } from '@nestjs/common';
import { DemoService } from './demo.service.js';
import { DemoEnabledGuard } from './demo.guard.js';
import {
  ApplyCouponDemoDto,
  ConfirmPaymentDemoDto,
  CreateOrderDemoDto,
  CreatePaymentDemoDto,
  CreateReservationDemoDto,
} from './demo.dto.js';

/**
 * Fase demo - Simulación de compra SIN autenticación (solo desarrollo).
 * Usa el cliente `customer@gitweek.local` (seed). Guard deletreado:
 * este controlador solo responde si DEMO_MODE=true.
 */
@Controller('demo')
@UseGuards(DemoEnabledGuard)
export class DemoController {
  constructor(private readonly demoService: DemoService) {}

  @Post('reservations')
  reservar(@Body() dto: CreateReservationDemoDto) {
    return this.demoService.createReservation(dto.productId, dto.quantity ?? 1);
  }

  @Post('orders')
  ordenar(@Body() dto: CreateOrderDemoDto) {
    return this.demoService.createOrder(dto.reservationPublicId);
  }

  @Post('coupons/apply')
  aplicarCupon(@Body() dto: ApplyCouponDemoDto) {
    return this.demoService.applyCoupon(dto.orderPublicId, dto.code);
  }

  @Post('payments')
  pagar(@Body() dto: CreatePaymentDemoDto) {
    return this.demoService.createPayment(dto.orderPublicId, dto.provider);
  }

  @Post('payments/confirm')
  confirmar(@Body() dto: ConfirmPaymentDemoDto) {
    return this.demoService.confirmPayment(dto.orderPublicId, dto.success ?? true);
  }
}