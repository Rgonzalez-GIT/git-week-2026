import { IsString } from 'class-validator';

export class CheckoutOrderDto {
  @IsString()
  reservationPublicId!: string;
}