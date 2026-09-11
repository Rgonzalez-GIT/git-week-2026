import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { IsString } from 'class-validator';
import { OrderService } from './order.service.js';
import { CouponService } from '../coupons/coupon.service.js';

class ApplyCouponDto {
  @IsString()
  code!: string;
}

/**
 * Fase 5 + Fase 11 - Órdenes.
 * La consulta pública por publicId es segura (UUID no enumerable); las
 * mutaciones (aplicar cupón) y el listado propio exigen JWT.
 */
@Controller('orders')
export class OrderController {
  constructor(
    private readonly orderService: OrderService,
    private readonly couponService: CouponService,
  ) {}

  @UseGuards(JwtAuthGuard)
  @Get('mine')
  async mine(@CurrentUser('sub') userId: number) {
    return this.orderService.listByUser(userId);
  }

  @UseGuards(JwtAuthGuard)
  @Post(':publicId/coupon')
  async applyCoupon(
    @CurrentUser('sub') userId: number,
    @Param('publicId') publicId: string,
    @Body() dto: ApplyCouponDto,
  ) {
    return this.couponService.apply({ userId, orderPublicId: publicId, code: dto.code });
  }

  @Get(':publicId')
  async get(@Param('publicId') publicId: string) {
    return this.orderService.findByPublicId(publicId);
  }
}