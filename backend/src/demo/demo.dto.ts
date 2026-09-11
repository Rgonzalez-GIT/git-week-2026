import { IsBoolean, IsInt, IsOptional, IsString, Min } from 'class-validator';

export class CreateReservationDemoDto {
  @IsInt()
  @Min(1)
  productId!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;
}

export class CreateOrderDemoDto {
  @IsString()
  reservationPublicId!: string;
}

export class ApplyCouponDemoDto {
  @IsString()
  orderPublicId!: string;

  @IsString()
  code!: string;
}

export class CreatePaymentDemoDto {
  @IsString()
  orderPublicId!: string;

  @IsOptional()
  @IsString()
  provider?: string;
}

export class ConfirmPaymentDemoDto {
  @IsString()
  orderPublicId!: string;

  @IsOptional()
  @IsBoolean()
  success?: boolean;
}