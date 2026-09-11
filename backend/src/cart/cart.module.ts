import { Module } from '@nestjs/common';
import { CartService } from './cart.service.js';
import { CartController } from './cart.controller.js';

@Module({
  providers: [CartService],
  controllers: [CartController],
  exports: [CartService],
})
export class CartModule {}