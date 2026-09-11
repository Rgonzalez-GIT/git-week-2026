import { Body, Controller, Delete, Get, Param, ParseIntPipe, Patch, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { AddCartItemDto, UpdateCartQuantityDto } from './cart.dto.js';
import { CartService } from './cart.service.js';

/**
 * Fase 7 + Fase 11 - Carrito.
 * El carrito de invitado (sessionKey) se expone completo sin auth: es una
 * identidad efémera que genera el cliente. Los endpoints sin path (usuario
 * autenticado por JWT) sirven a la landing y a clientes registrados.
 */
@Controller('cart')
export class CartController {
  constructor(private readonly cartService: CartService) {}

  @UseGuards(JwtAuthGuard)
  @Get()
  getMyCart(@CurrentUser('sub') userId: number) {
    return this.cartService.list({ userId });
  }

  @UseGuards(JwtAuthGuard)
  @Post('items')
  addMine(@CurrentUser('sub') userId: number, @Body() dto: AddCartItemDto) {
    return this.cartService.add({ userId }, dto.productId, dto.quantity ?? 1);
  }

  @UseGuards(JwtAuthGuard)
  @Patch('items/:productId')
  setMyQuantity(
    @CurrentUser('sub') userId: number,
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: UpdateCartQuantityDto,
  ) {
    return this.cartService.setQuantity({ userId }, productId, dto.quantity);
  }

  @UseGuards(JwtAuthGuard)
  @Delete('items/:productId')
  removeMine(
    @CurrentUser('sub') userId: number,
    @Param('productId', ParseIntPipe) productId: number,
  ) {
    return this.cartService.remove({ userId }, productId);
  }

  @UseGuards(JwtAuthGuard)
  @Delete()
  clearMine(@CurrentUser('sub') userId: number) {
    return this.cartService.clear({ userId });
  }

  @Get('session/:sessionKey')
  getSessionCart(@Param('sessionKey') sessionKey: string) {
    return this.cartService.list({ sessionKey });
  }

  @Post('session/:sessionKey/items')
  add(
    @Param('sessionKey') sessionKey: string,
    @Body() dto: AddCartItemDto,
  ) {
    return this.cartService.add({ sessionKey }, dto.productId, dto.quantity ?? 1);
  }

  @Patch('session/:sessionKey/items/:productId')
  setQuantity(
    @Param('sessionKey') sessionKey: string,
    @Param('productId', ParseIntPipe) productId: number,
    @Body() dto: UpdateCartQuantityDto,
  ) {
    return this.cartService.setQuantity({ sessionKey }, productId, dto.quantity);
  }

  @Delete('session/:sessionKey/items/:productId')
  remove(
    @Param('sessionKey') sessionKey: string,
    @Param('productId', ParseIntPipe) productId: number,
  ) {
    return this.cartService.remove({ sessionKey }, productId);
  }

  @Delete('session/:sessionKey')
  clear(@Param('sessionKey') sessionKey: string) {
    return this.cartService.clear({ sessionKey });
  }
}