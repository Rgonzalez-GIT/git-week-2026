import {
  BadRequestException,
  Body,
  Controller,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
  ServiceUnavailableException,
  UseGuards,
} from '@nestjs/common';
import type { Request } from 'express';
import { SkipThrottle } from '@nestjs/throttler';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { PaymentService } from './payment.service.js';
import type { PaymentEvent } from './payment.service.js';
import { CreatePaymentDto, WebhookEventDto, isPaymentProvider } from './payment.dto.js';
import { verifyWebhookSignature, WEBHOOK_SIGNATURE_HEADER } from './webhook.util.js';

/**
 * Fase 6 + Fase 11 - Pagos.
 * La creación del pago exige JWT y dueño de la orden. La confirmación llega
 * por webhook firmado con HMAC-SHA256 (WEBHOOK_SECRET) sobre el body crudo.
 */
@Controller('payments')
export class PaymentController {
  constructor(private readonly paymentService: PaymentService) {}

  @UseGuards(JwtAuthGuard)
  @Post('create')
  async create(@CurrentUser('sub') userId: number, @Body() dto: CreatePaymentDto) {
    return this.paymentService.createForUser(dto.orderPublicId, userId);
  }

  @SkipThrottle()
  @Post('webhook')
  @HttpCode(HttpStatus.ACCEPTED)
  async webhook(
    @Req() req: Request & { rawBody?: Buffer },
    @Headers(WEBHOOK_SIGNATURE_HEADER) signature: string | undefined,
    @Body() dto: WebhookEventDto,
  ) {
    const secret = process.env.WEBHOOK_SECRET;
    if (!secret) {
      throw new ServiceUnavailableException('WEBHOOK_SECRET no está configurado');
    }
    if (!isPaymentProvider(dto.provider)) {
      throw new BadRequestException(`Proveedor de pago inválido: ${dto.provider}`);
    }
    verifyWebhookSignature(req.rawBody, signature, secret);

    const result = await this.paymentService.confirmPayment({
      provider: dto.provider,
      providerTransactionId: dto.providerTransactionId,
      rawEventId: dto.rawEventId,
      success: dto.success,
      amountCents: dto.amountCents,
      metadata: (dto.metadata ?? null) as PaymentEvent['metadata'],
    });

    return {
      processed: result.processed,
      payment: {
        publicId: result.payment.publicId,
        status: result.payment.status,
        providerTransactionId: result.payment.providerTransactionId,
      },
      order: result.order
        ? {
            publicId: result.order.publicId,
            status: result.order.status,
          }
        : null,
    };
  }

  @Get(':publicId')
  async get(@Param('publicId') publicId: string) {
    return this.paymentService.findByPublicId(publicId);
  }
}