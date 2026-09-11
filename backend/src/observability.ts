import { INestApplication, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';

/**
 * Fase 15 - Observabilidad.
 * Request ID (X-Request-Id) y log estructurado por request: método, ruta,
 * status y duración. Ayuda a correlacionar errores en producción.
 */
export function setupRequestLogging(app: INestApplication): void {
  const logger = new Logger('HTTP');

  app.use((req: Request, res: Response, next: NextFunction) => {
    if (!req.headers['x-request-id']) {
      req.headers['x-request-id'] = randomUUID();
    }
    res.setHeader('x-request-id', req.headers['x-request-id'] as string);
    next();
  });

  app.use((req: Request, res: Response, next: NextFunction) => {
    const start = Date.now();
    res.on('finish', () => {
      const duration = Date.now() - start;
      const reqId = req.headers['x-request-id'] as string;
      logger.log(`${req.method} ${req.originalUrl} ${res.statusCode} ${duration}ms id=${reqId}`);
    });
    next();
  });
}