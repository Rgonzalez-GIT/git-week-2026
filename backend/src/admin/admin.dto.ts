import { IsEnum, IsInt, IsOptional, IsString, Min } from 'class-validator';
import { ProductStatus, PromotionStatus } from '../generated/prisma/enums.js';

export class UpdateProductAdminDto {
  @IsOptional()
  @IsString()
  @Min(3)
  name?: string;

  @IsOptional()
  @IsString()
  description?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  priceCents?: number;

  @IsOptional()
  @IsEnum(ProductStatus)
  status?: ProductStatus;
}

export class UpdatePromotionAdminDto {
  @IsOptional()
  @IsEnum(PromotionStatus)
  status?: PromotionStatus;

  @IsOptional()
  @IsInt()
  @Min(1)
  maxRedemptions?: number;

  @IsOptional()
  @IsString()
  endsAt?: string;
}