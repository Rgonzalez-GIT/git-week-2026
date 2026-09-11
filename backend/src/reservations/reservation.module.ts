import { Module } from '@nestjs/common';
import { InventoryModule } from '../inventory/inventory.module.js';
import { ReservationService } from './reservation.service.js';
import { ReservationController } from './reservation.controller.js';

@Module({
  imports: [InventoryModule],
  providers: [ReservationService],
  controllers: [ReservationController],
  exports: [ReservationService],
})
export class ReservationModule {}