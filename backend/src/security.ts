import { INestApplication } from '@nestjs/common';
import helmet from 'helmet';

/**
 * Fase 13 - Configuración de seguridad HTTP reutilizable (bootstrap y tests).
 * Helmet con CSP desactivado (la landing usa fuentes/fetch externos) y
 * middleware de log de request.
 */
export function setupSecurity(app: INestApplication): void {
  app.use(
    helmet({
      contentSecurityPolicy: false,
      crossOriginEmbedderPolicy: false,
    }),
  );
  app.enableCors({
    origin: process.env.CORS_ORIGIN?.split(',') ?? true,
    credentials: true,
  });
}