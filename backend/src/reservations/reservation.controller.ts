import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { ReservationService } from './reservation.service.js';
import { CreateReservationDto } from './reservation.dto.js';

/**
 * Fase 4 + Fase 11 - Reservas temporales.
 * La creación de reservas exige JWT (Fase 11). La consulta por publicId y el
 * sweep de vencidas quedan disponibles para el flujo demo y el cron.
 */
@Controller('reservations')
export class ReservationController {
  constructor(private readonly reservationService: ReservationService) {}

  @UseGuards(JwtAuthGuard)
  @Post()
  async create(@CurrentUser('sub') userId: number, @Body() dto: CreateReservationDto) {
    return this.reservationService.create({
      userId,
      productId: dto.productId,
      quantity: dto.quantity,
    });
  }

  @Get(':publicId')
  async get(@Param('publicId') publicId: string) {
    return this.reservationService.findByPublicId(publicId);
  }

  @Post('sweep')
  async sweep() {
    const expired = await this.reservationService.expireSweep();
    return { expired };
  }
}