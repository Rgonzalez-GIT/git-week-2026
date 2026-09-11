import { Controller, Get, Param } from '@nestjs/common';
import { CouponService } from './coupon.service.js';

/**
 * Fase 7 - Cupones (lecturas públicas pre-auth).
 * La aplicación del descuento (mutación) queda a nivel de servicio hasta la
 * fase IAM; aquí se exponen la lista de códigos funcionales y la consulta de
 * un código. (APPGITWEEK.md Fase 11 listaba POST /coupons/validate; se expone
 * como GET /coupons/:code por ser read-only.)
 */
@Controller('coupons')
export class CouponController {
  constructor(private readonly couponService: CouponService) {}

  @Get()
  list() {
    return this.couponService.listActive();
  }

  @Get(':code')
  check(@Param('code') code: string) {
    return this.couponService.checkCode(code);
  }
}