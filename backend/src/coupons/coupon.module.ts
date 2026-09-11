import { Module } from '@nestjs/common';
import { CouponService } from './coupon.service.js';
import { CouponRewardService } from './coupon-reward.service.js';
import { CouponController } from './coupon.controller.js';
import { CouponRewardController } from './coupon-reward.controller.js';

@Module({
  providers: [CouponService, CouponRewardService],
  // CouponRewardController primero para que /coupons/mine (literal) tenga
  // prioridad sobre /coupons/:code en Express.
  controllers: [CouponRewardController, CouponController],
  exports: [CouponService, CouponRewardService],
})
export class CouponModule {}