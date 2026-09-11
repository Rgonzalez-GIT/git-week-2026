import { Module } from '@nestjs/common';
import { ReservationModule } from '../reservations/reservation.module.js';
import { OrderModule } from '../orders/order.module.js';
import { CouponModule } from '../coupons/coupon.module.js';
import { PaymentModule } from '../payments/payment.module.js';
import { DemoService } from './demo.service.js';
import { DemoController } from './demo.controller.js';
import { DemoEnabledGuard } from './demo.guard.js';

@Module({
  imports: [ReservationModule, OrderModule, CouponModule, PaymentModule],
  providers: [DemoService, DemoEnabledGuard],
  controllers: [DemoController],
})
export class DemoModule {}