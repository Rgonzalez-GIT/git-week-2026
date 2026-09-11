import { Module } from '@nestjs/common';
import { ReservationModule } from '../reservations/reservation.module.js';
import { CouponModule } from '../coupons/coupon.module.js';
import { TicketsModule } from '../tickets/ticket-code.module.js';
import { PaymentService } from './payment.service.js';
import { PaymentController } from './payment.controller.js';
import { paymentGatewaysProvider } from './gateway/gateway.factory.js';

@Module({
  imports: [ReservationModule, CouponModule, TicketsModule],
  providers: [PaymentService, paymentGatewaysProvider],
  controllers: [PaymentController],
  exports: [PaymentService],
})
export class PaymentModule {}