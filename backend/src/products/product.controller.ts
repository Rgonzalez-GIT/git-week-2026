import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { ProductService } from './product.service.js';

/**
 * Fase 11 (parcial) - Catalogo público.
 * GET /products (lista activos con stock) y GET /products/:id/stock.
 */
@Controller('products')
export class ProductController {
  constructor(private readonly productService: ProductService) {}

  @Get()
  list() {
    return this.productService.listAvailable();
  }

  @Get(':productId/stock')
  stock(@Param('productId', ParseIntPipe) productId: number) {
    return this.productService.stock(productId);
  }
}