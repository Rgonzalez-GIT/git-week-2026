import { Prisma } from '../../generated/prisma/client.js';
import { PaymentProvider } from '../../generated/prisma/enums.js';

/**
 * Contrato de pasarela de pagos (Fase 6 → cobro automático).
 *
 * `createCharge` crea la transacción en la pasarela y devuelve el contexto
 * para renderizar el checkout (formulario embebido) o url de redirección,
 * además del providerTransactionId con el que la pasarela confirmará el pago.
 */
export interface GatewayOrder {
  orderPublicId: string;
  totalCents: number;
  currency: string;
  buyer: {
    firstName?: string | null;
    lastName?: string | null;
    email?: string | null;
    phone?: string | null;
    docNumber?: string | null;
  };
}

export interface GatewayChargeResult {
  providerTransactionId: string;
  /** URL del JS del checkout de la pasarela (cargar en el navegador). */
  checkoutScriptUrl?: string;
  /** Niubiz: sessionKey para instanciar checkout.js. */
  sessionKey?: string;
  /** Niubiz: merchantId del comercio configurado. */
  merchantId?: string;
  /** Izipay: formToken para renderizar el formulario embebido. */
  formToken?: string;
  /** Izipay: llave pública del comercio. */
  publicKey?: string;
  /** URL a la que se redirige al usuario tras autorizar/simular. */
  redirectUrl?: string;
  metadata: Prisma.InputJsonValue | null;
}

export interface PaymentGateway {
  readonly provider: PaymentProvider;
  createCharge(order: GatewayOrder): Promise<GatewayChargeResult>;
}