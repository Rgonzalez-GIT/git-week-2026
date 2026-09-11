import { IsEmail, IsNotEmpty, IsOptional, IsString } from 'class-validator';

export class CheckoutOrderDto {
  @IsString()
  reservationPublicId!: string;
}

/** Datos del comprador (individual) o del líder del grupo en checkout autenticado. */
export class BuyerCheckoutDto {
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