import { Controller, Get, Res } from '@nestjs/common';
import type { Response } from 'express';
import { PrismaService } from '../prisma/prisma.service.js';

/**
 * Fase 15 - Observabilidad.
 * GET /health (liveness) y GET /health/ready (readiness con chequeo de base
 * de datos; 503 si la DB no responde). Se usan en el healthcheck de Docker/K8s.
 */
@Controller('health')
export class HealthController {
  constructor(private readonly prisma: PrismaService) {}

  @Get()
  health() {
    return { status: 'ok', uptime: process.uptime(), timestamp: new Date().toISOString() };
  }

  @Get('ready')
  async ready(@Res({ passthrough: true }) res: Response) {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', checks: { database: 'up' }, timestamp: new Date().toISOString() };
    } catch {
      res.status(503);
      return { status: 'error', checks: { database: 'down' }, timestamp: new Date().toISOString() };
    }
  }
}