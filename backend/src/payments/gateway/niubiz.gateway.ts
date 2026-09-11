import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PaymentProvider } from '../../generated/prisma/enums.js';
import { GatewayChargeResult, GatewayOrder, PaymentGateway } from './gateway.interface.js';

const NIUBIZ_QA_BASE = 'https://apisandbox.vnforappstest.com';

/**
 * Pasarela Niubiz (ex VisaNet, BBVA Perú) — e-commerce v3.
 *
 * Flujo:
 *  1. GET  /api.security/v1/security            -> securityToken (Basic user:password)
 *  2. POST /api.ecommerce/v2/ecommerce/token/session/{merchantId} -> sessionKey
 *  3. checkout.js renderiza el formulario (tarjeta); Niubiz redirige a
 *     responseUrl con los datos de la transacción; el webhook confirma.
 *
 * Montos en centavos de PEN. Requiere credenciales del comercio (env).
 * Sin credenciales -> ServiceUnavailableException (no usar en demo local).
 */
@Injectable()
export class NiubizGateway implements PaymentGateway {
  readonly provider = PaymentProvider.NIUBIZ;

  private readonly merchantId: string;
  private readonly user: string;
  private readonly password: string;
  private readonly baseUrl: string;
  private readonly responseUrl: string;

  constructor(config: ConfigService) {
    this.merchantId = config.get<string>('NIUBIZ_MERCHANT_ID') ?? '';
    this.user = config.get<string>('NIUBIZ_USER') ?? '';
    this.password = config.get<string>('NIUBIZ_PASSWORD') ?? '';
    this.baseUrl = config.get<string>('NIUBIZ_BASE_URL') ?? NIUBIZ_QA_BASE;
    this.responseUrl = config.get<string>('PAYMENT_RESPONSE_URL') ?? '/api/payments/niubiz/return';
  }

  private assertConfigured(): void {
    if (!this.merchantId || !this.user || !this.password) {
      throw new ServiceUnavailableException(
        'Niubiz no está configurado. Define NIUBIZ_MERCHANT_ID, NIUBIZ_USER y NIUBIZ_PASSWORD en .env',
      );
    }
  }

  private async securityToken(): Promise<string> {
    const basic = Buffer.from(`${this.user}:${this.password}`).toString('base64');
    const res = await fetch(`${this.baseUrl}/api.security/v1/security`, {
      headers: { Authorization: `Basic ${basic}` },
    });
    if (res.status !== 200) {
      throw new ServiceUnavailableException(
        `Niubiz rechazó credenciales (HTTP ${res.status}). Solicita las credenciales del sandbox en desarrolladores.niubiz.com.pe`,
      );
    }
    return res.text();
  }

  async createCharge(order: GatewayOrder): Promise<GatewayChargeResult> {
    this.assertConfigured();
    const token = await this.securityToken();

    const sessionRes = await fetch(
      `${this.baseUrl}/api.ecommerce/v2/ecommerce/token/session/${this.merchantId}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Authorization: token },
        body: JSON.stringify({
          amount: order.totalCents,
          channel: 'web',
          antifraud: {
            merchantDefineData: {
              MDD4: order.buyer.email ?? '',
              MDD32: order.orderPublicId,
            },
          },
        }),
      },
    );
    const sessionBody = (await sessionRes.json().catch(() => null)) as { sessionKey?: string } | null;
    if (!sessionRes.ok || !sessionBody?.sessionKey) {
      throw new ServiceUnavailableException(
        `Niubiz no creó la sesión (HTTP ${sessionRes.status}). Revisa merchantId y credenciales.`,
      );
    }

    const query = new URLSearchParams({
      action: 'preauth',
      merchantId: this.merchantId,
      sessionKey: sessionBody.sessionKey,
      responseUrl: this.responseUrl,
      responseMode: 'POST',
    });

    return {
      providerTransactionId: sessionBody.sessionKey,
      sessionKey: sessionBody.sessionKey,
      merchantId: this.merchantId,
      checkoutScriptUrl: this.baseUrl.includes('sandbox')
        ? 'https://static-content-qas.vnforapps.com/v2/js/checkout.js?qa=true'
        : 'https://static-content.vnforapps.com/v2/js/checkout.js',
      redirectUrl: `https://${this.baseUrl.includes('sandbox') ? 'sandbox' : 'www'}.niubiz.com.pe/checkout?${query}`,
      metadata: {
        gateway: 'niubiz',
        orderId: order.orderPublicId,
        amountCents: order.totalCents,
        merchantId: this.merchantId,
        transactionKey: randomUUID(),
      },
    };
  }
}