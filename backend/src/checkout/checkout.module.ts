import { Module } from '@nestjs/common';
import { ReservationModule } from '../reservations/reservation.module.js';
import { OrderModule } from '../orders/order.module.js';
import { CheckoutController } from './checkout.controller.js';

@Module({
  imports: [ReservationModule, OrderModule],
  controllers: [CheckoutController],
})
export class CheckoutModule {}