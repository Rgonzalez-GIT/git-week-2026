import { Controller, Get, Param, ParseIntPipe } from '@nestjs/common';
import { InventoryService } from './inventory.service.js';

/**
 * Lectura de stock (pública para catálogo).
 * Las mutaciones NO se exponen por HTTP: ocurren dentro de transacciones
 * del dominio (checkout, reservas, pagos) y por acciones de administración.
 */
@Controller('inventory')
export class InventoryController {
  constructor(private readonly inventoryService: InventoryService) {}

  @Get(':productId')
  async getStock(@Param('productId', ParseIntPipe) productId: number) {
    return this.inventoryService.find(productId);
  }
}