import { Injectable, ServiceUnavailableException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import { PaymentProvider } from '../../generated/prisma/enums.js';
import { GatewayChargeResult, GatewayOrder, PaymentGateway } from './gateway.interface.js';

const IZIPAY_QA_BASE = 'https://test-api.micuentaweb.pe';

/**
 * Pasarela Izipay (PayZen de MercadoDirectivo, Perú) — REST V4.
 *
 * Flujo:
 *  1. POST /api-payment/V4/Charge/CreatePayment (Basic) -> answer.formToken
 *  2. checkout.js de izipay renderiza el formulario embebido/redirige usando
 *     formToken + publicKey; al finalizar envía kr-answer (firmado HMAC-SHA256)
 *     al endpoint de confirmación/IPN del comercio.
 *
 * Montos en centavos de PEN. Requiere credenciales del panel (env).
 * Sin credenciales -> ServiceUnavailableException (no usar en demo local).
 */
@Injectable()
export class IzipayGateway implements PaymentGateway {
  readonly provider = PaymentProvider.IZIPAY;

  private readonly username: string;
  private readonly password: string;
  private readonly publicKey: string;
  private readonly baseUrl: string;

  constructor(config: ConfigService) {
    this.username = config.get<string>('IZIPAY_API_USERNAME') ?? '';
    this.password = config.get<string>('IZIPAY_API_PASSWORD') ?? '';
    this.publicKey = config.get<string>('IZIPAY_PUBLIC_KEY') ?? '';
    this.baseUrl = config.get<string>('IZIPAY_BASE_URL') ?? IZIPAY_QA_BASE;
  }

  private assertConfigured(): void {
    if (!this.username || !this.password || !this.publicKey) {
      throw new ServiceUnavailableException(
        'Izipay no está configurado. Define IZIPAY_API_USERNAME, IZIPAY_API_PASSWORD y IZIPAY_PUBLIC_KEY en .env',
      );
    }
  }

  async createCharge(order: GatewayOrder): Promise<GatewayChargeResult> {
    this.assertConfigured();
    const basic = Buffer.from(`${this.username}:${this.password}`).toString('base64');

    const res = await fetch(
      `${this.baseUrl}/api-payment/V4/Charge/CreatePayment`,
      {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Basic ${basic}`,
        },
        body: JSON.stringify({
          amount: order.totalCents,
          currency: order.currency,
          orderId: order.orderPublicId,
          customer: {
            email: order.buyer.email ?? '',
            billingDetails: {
              firstName: order.buyer.firstName ?? '',
              lastName: order.buyer.lastName ?? '',
              phoneNumber: order.buyer.phone ?? '',
              identityType: 'DNI',
              identityCode: order.buyer.docNumber ?? '',
              country: 'PE',
            },
          },
        }),
      },
    );
    const body = (await res.json().catch(() => null)) as
      | { status?: string; answer?: { formToken?: string; formPublicKey?: string } }
      | null;

    if (!res.ok || body?.status !== 'SUCCESS' || !body.answer?.formToken) {
      throw new ServiceUnavailableException(
        `Izipay no generó el formToken (HTTP ${res.status}). Revisa credenciales en el panel de izipay.`,
      );
    }

    return {
      providerTransactionId: order.orderPublicId,
      formToken: body.answer.formToken,
      publicKey: this.publicKey || body.answer.formPublicKey || '',
      checkoutScriptUrl: this.baseUrl.includes('test')
        ? 'https://sandbox-checkout.izipay.pe/payments/v1/js/index.js'
        : 'https://checkout.izipay.pe/payments/v1/js/index.js',
      metadata: {
        gateway: 'izipay',
        orderId: order.orderPublicId,
        amountCents: order.totalCents,
        transactionUuid: randomUUID(),
      },
    };
  }
}