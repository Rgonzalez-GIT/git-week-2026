import { IsBoolean, IsInt, IsOptional, IsString } from 'class-validator';
import { PaymentProvider } from '../generated/prisma/enums.js';

export class CreatePaymentDto {
  @IsString()
  orderPublicId!: string;
}

export class WebhookEventDto {
  @IsString()
  provider!: string;

  @IsString()
  providerTransactionId!: string;

  @IsString()
  rawEventId!: string;

  @IsBoolean()
  success!: boolean;

  @IsOptional()
  @IsInt()
  amountCents?: number;

  @IsOptional()
  metadata?: unknown;
}

export function isPaymentProvider(value: string): value is PaymentProvider {
  return (Object.values(PaymentProvider) as string[]).includes(value);
}