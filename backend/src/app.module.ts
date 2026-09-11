import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { APP_GUARD, APP_PIPE } from '@nestjs/core';
import { ValidationPipe } from '@nestjs/common';
import { ThrottlerModule } from '@nestjs/throttler';
import { ThrottlerGuard } from '@nestjs/throttler';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { ReservationModule } from './reservations/reservation.module.js';
import { OrderModule } from './orders/order.module.js';
import { PaymentModule } from './payments/payment.module.js';
import { CartModule } from './cart/cart.module.js';
import { CouponModule } from './coupons/coupon.module.js';
import { ProductsModule } from './products/products.module.js';
import { DemoModule } from './demo/demo.module.js';
import { AuthModule } from './auth/auth.module.js';
import { CheckoutModule } from './checkout/checkout.module.js';
import { HealthModule } from './health/health.module.js';
import { AdminModule } from './admin/admin.module.js';
import { QueueModule } from './queue/queue.module.js';

const isDemoEnabled = process.env.DEMO_MODE === 'true';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true }),
    ThrottlerModule.forRoot([{ ttl: 60_000, limit: 60 }]),
    PrismaModule,
    InventoryModule,
    ReservationModule,
    OrderModule,
    PaymentModule,
    CartModule,
    CouponModule,
    ProductsModule,
    AuthModule,
    CheckoutModule,
    HealthModule,
    AdminModule,
    QueueModule,
    ...(isDemoEnabled ? [DemoModule] : []),
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_PIPE,
      useValue: new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    },
  ],
})
export class AppModule {}