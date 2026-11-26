import { Module } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { HttpClientModule } from '@nestjs/http-client';
import type { Env } from '../config.js';
import { OrdersModule } from '../orders/orders.module.js';
import { PaymentWebhooksController } from './payment-webhooks.controller.js';
import { PaymentsClient } from './payments.client.js';
import { PaymentsController } from './payments.controller.js';
import { PaymentsService } from './payments.service.js';

@Module({
  imports: [
    OrdersModule,
    HttpClientModule.registerAsync({
      name: 'payments',
      inject: [ConfigService],
      useFactory: (config: ConfigService<Env, true>) => ({
        baseUrl: config.get('PAYMENTS_API_URL', { infer: true }),
        headers: { authorization: `Bearer ${config.get('PAYMENTS_API_KEY', { infer: true })}` },
        timeout: '10s',
      }),
    }),
  ],
  controllers: [PaymentsController, PaymentWebhooksController],
  providers: [PaymentsClient, PaymentsService],
})
export class PaymentsModule {}
