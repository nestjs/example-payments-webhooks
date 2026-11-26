import { Injectable, Logger } from '@nestjs/common';
import { OnOutboxMessage } from '@nestjs/outbox';

export interface OrderPaid {
  orderId: string;
  userId: string;
  total: number;
  paymentId: string;
}

/** Runs after the payment's transaction commits: a stand-in for the confirmation email. */
@Injectable()
export class OrderPaidHandler {
  private readonly logger = new Logger(OrderPaidHandler.name);

  // The consumer's inbox skips a message it has already handled.
  @OnOutboxMessage('order.paid', { consumer: 'order-paid-confirmation' })
  confirm({ orderId, total }: OrderPaid) {
    this.logger.log(`Order ${orderId} paid (${total} cents): sending the confirmation`);
  }
}
