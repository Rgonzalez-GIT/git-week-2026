import { Module } from '@nestjs/common';
import { ReservationModule } from '../reservations/reservation.module.js';
import { CouponModule } from '../coupons/coupon.module.js';
import { PaymentService } from './payment.service.js';
import { PaymentController } from './payment.controller.js';

@Module({
  imports: [ReservationModule, CouponModule],
  providers: [PaymentService],
  controllers: [PaymentController],
  exports: [PaymentService],
})
export class PaymentModule {}