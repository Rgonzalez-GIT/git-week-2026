import { ConfigService } from '@nestjs/config';
import { PaymentGateway } from './gateway.interface.js';
import { NiubizGateway } from './niubiz.gateway.js';
import { IzipayGateway } from './izipay.gateway.js';

export const PAYMENT_GATEWAYS = Symbol('PAYMENT_GATEWAYS');

export const paymentGatewaysProvider = {
  provide: PAYMENT_GATEWAYS,
  inject: [ConfigService],
  useFactory: (config: ConfigService): PaymentGateway[] => [
    new NiubizGateway(config),
    new IzipayGateway(config),
  ],
};