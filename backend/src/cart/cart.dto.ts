import { IsInt, IsOptional, Min } from 'class-validator';

export class AddCartItemDto {
  @IsInt({ message: 'productId debe ser un entero' })
  @Min(1)
  productId!: number;

  @IsOptional()
  @IsInt()
  @Min(1)
  quantity?: number;
}

export class UpdateCartQuantityDto {
  @IsInt()
  @Min(1)
  quantity!: number;
}