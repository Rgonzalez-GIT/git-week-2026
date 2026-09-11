import { createHmac, timingSafeEqual } from 'node:crypto';
import { UnauthorizedException } from '@nestjs/common';

export const WEBHOOK_SIGNATURE_HEADER = 'x-webhook-signature';

/**
 * Fase 11 - Verificación de firmas de webhook.
 * HMAC-SHA256 del body raw con WEBHOOK_SECRET. Comparación en tiempo
 * constante para evitar timing attacks.
 */
export function verifyWebhookSignature(
  rawBody: Buffer | undefined,
  signature: string | undefined,
  secret: string,
): void {
  if (!rawBody?.length || !signature) {
    throw new UnauthorizedException('Firma del webhook requerida');
  }
  const expected = createHmac('sha256', secret).update(rawBody).digest('hex');
  const received = Buffer.from(signature, 'hex');
  const wanted = Buffer.from(expected, 'hex');
  if (received.length !== wanted.length || !timingSafeEqual(received, wanted)) {
    throw new UnauthorizedException('Firma del webhook inválida');
  }
}