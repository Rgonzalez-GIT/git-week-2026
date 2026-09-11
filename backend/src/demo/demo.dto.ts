import { IsBoolean, IsEmail, IsInt, IsNotEmpty, IsOptional, IsString, Min } from 'class-validator';

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

/** Datos del comprador (individual) o del líder del grupo. */
export class BuyerDemoDto {
  @IsString()
  @IsNotEmpty()
  firstName!: string;

  @IsString()
  @IsNotEmpty()
  lastName!: string;

  @IsEmail()
  email!: string;

  @IsString()
  @IsNotEmpty()
  phone!: string;

  @IsOptional()
  @IsString()
  docType?: string;

  @IsOptional()
  @IsString()
  docNumber?: string;
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