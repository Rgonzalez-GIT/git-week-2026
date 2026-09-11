import { Body, Controller, Get, Header, HttpCode, HttpStatus, NotFoundException, Param, Post, Req, Res, UseGuards } from '@nestjs/common';
import type { Request, Response } from 'express';
import QRCode from 'qrcode';
import { IsString } from 'class-validator';
import { CouponRewardService } from './coupon-reward.service.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';

export class RedeemDto {
  @IsString()
  publicId!: string;
}

/**
 * Fase 7 - Cupón físico de recompensa.
 * GET /coupon/:publicId  -> datos públicos (sin información sensible).
 * GET /coupon/:publicId/qr -> imagen PNG del QR apuntando a /coupon/{id}.
 * GET /coupons/mine (auth) -> cupones emitidos al usuario.
 */
@Controller()
export class CouponRewardController {
  constructor(private readonly rewards: CouponRewardService) {}

  @Get('coupon/:publicId')
  async publicCoupon(@Param('publicId') publicId: string) {
    const coupon = await this.rewards.findByPublicId(publicId);
    if (!coupon) {
      throw new NotFoundException(`Cupón ${publicId} no encontrado`);
    }
    return {
      publicId: coupon.publicId,
      code: coupon.code,
      status: coupon.status,
      issuedAt: coupon.issuedAt,
      expiresAt: coupon.expiresAt,
      redeemedAt: coupon.redeemedAt,
      qrUrl: `/coupon/${coupon.publicId}/qr`,
    };
  }

  @Get('coupon/:publicId/qr')
  @Header('Content-Type', 'image/png')
  @Header('Cache-Control', 'public, max-age=3600')
  async qr(@Param('publicId') publicId: string, @Req() req: Request, @Res() res: Response) {
    const qr = await this.rewards.findQr(publicId);
    if (!qr) {
      throw new NotFoundException(`Cupón ${publicId} no encontrado`);
    }
    const base = `${req.protocol}://${req.get('host')}`;
    const buffer = await QRCode.toBuffer(`${base}${qr.url}`, { width: 256, margin: 1 });
    res.send(buffer);
  }

  @UseGuards(JwtAuthGuard)
  @Get('coupons/mine')
  async mine(@CurrentUser('sub') userId: number) {
    const coupons = await this.rewards.listMine(userId);
    return coupons;
  }

  @UseGuards(JwtAuthGuard)
  @HttpCode(HttpStatus.OK)
  @Post('coupons/redeem')
  async redeem(@CurrentUser('sub') userId: number, @Body() dto: RedeemDto) {
    return this.rewards.redeem(userId, dto.publicId);
  }
}