import { Body, Controller, Delete, Get, Param, ParseIntPipe, Post, UseGuards } from '@nestjs/common';
import { JwtAuthGuard } from '../auth/jwt-auth.guard.js';
import { RolesGuard } from '../auth/roles.guard.js';
import { Roles } from '../auth/roles.decorator.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import { QueueService } from './queue.service.js';

/**
 * Fase 9 - Cola virtual.
 * POST /queue/join → entra a la cola (autenticado).
 * GET /queue/:productId → posición del usuario + size.
 * POST /queue/dequeue → siguiente de la cola (admin/cron).
 * DELETE /queue/:productId → abandona la cola.
 * DELETE /queue/:productId/flush → vacía la cola (admin).
 */
@Controller('queue')
@UseGuards(JwtAuthGuard)
export class QueueController {
  constructor(private readonly queue: QueueService) {}

  @Post('join')
  async join(@CurrentUser('sub') userId: number, @Body('productId', ParseIntPipe) productId: number) {
    const position = await this.queue.join(productId, userId);
    const size = await this.queue.size(productId);
    return { position, size, productId, userId };
  }

  @Get(':productId')
  async status(@CurrentUser('sub') userId: number, @Param('productId', ParseIntPipe) productId: number) {
    const position = await this.queue.getPosition(productId, userId);
    const size = await this.queue.size(productId);
    return { productId, userId, position, size };
  }

  @Post('dequeue')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async dequeue(@Body('productId', ParseIntPipe) productId: number) {
    const result = await this.queue.dequeue(productId);
    return result ?? { userId: null, joinedAt: null };
  }

  @Delete(':productId')
  async leave(@CurrentUser('sub') userId: number, @Param('productId', ParseIntPipe) productId: number) {
    const left = await this.queue.leave(productId, userId);
    return { left, productId, userId };
  }

  @Delete(':productId/flush')
  @UseGuards(RolesGuard)
  @Roles('ADMIN')
  async flush(@Param('productId', ParseIntPipe) productId: number) {
    await this.queue.flush(productId);
    return { flushed: true, productId };
  }
}