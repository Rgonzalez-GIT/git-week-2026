import { IsInt, Min } from 'class-validator';

export class CreateReservationDto {
  @IsInt()
  @Min(1)
  productId!: number;

  @IsInt()
  @Min(1)
  quantity!: number;
}