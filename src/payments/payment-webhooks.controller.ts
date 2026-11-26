import { Controller, HttpCode, Logger, Post } from '@nestjs/common';
import { Public } from '@nestjs/authentication';
import { InjectDrizzle } from '@nestjs/drizzle';
import { ApiSecurity } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { IncomingWebhook, VerifyWebhook } from '@nestjs/webhooks';
import type { NodePgDatabase } from 'drizzle-orm/node-postgres';
import { z } from 'zod';
import { OrdersService } from '../orders/orders.service.js';
import type { PaymentEvent } from './payment.js';

const orderId = z.uuid();

// The signature authenticates the provider, not a token. And a provider
// delivers in bursts, from a few addresses: the per-IP limit would refuse them.
@Public()
@ApiSecurity({})
@SkipThrottle()
@Controller('webhooks/payments')
export class PaymentWebhooksController {
  private readonly logger = new Logger(PaymentWebhooksController.name);

  constructor(
    @InjectDrizzle() private readonly db: NodePgDatabase,
    private readonly ordersService: OrdersService,
  ) {}

  @Post()
  @HttpCode(200)
  @VerifyWebhook('payments')
  async receive(@IncomingWebhook() webhook: IncomingWebhook<PaymentEvent>) {
    const { type, data: payment } = webhook.payload;
    if (!orderId.safeParse(payment.reference).success) {
      // Not a payment this shop created: answered 200, so the provider doesn't retry it.
      this.logger.warn(`Ignoring ${type} for ${payment.id}: its reference isn't an order id`);
      return;
    }
    // The event's id is recorded in the inbox in the same transaction as the order's
    // new status: a redelivery, even one racing this request, changes nothing.
    await this.db.transaction(async (tx) =>
      webhook.processInTransaction(tx, () => {
        switch (type) {
          case 'payment.succeeded':
            return this.ordersService.markPaid(tx, payment);
          case 'payment.failed':
            return this.ordersService.cancelUnpaid(tx, payment.reference);
          default:
            // Other types are recorded, and change nothing.
            return undefined;
        }
      }),
    );
  }
}
