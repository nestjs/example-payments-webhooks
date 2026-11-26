import { ConflictException, Injectable } from '@nestjs/common';
import { OrdersService } from '../orders/orders.service.js';
import { PaymentsClient } from './payments.client.js';

@Injectable()
export class PaymentsService {
  constructor(
    private readonly ordersService: OrdersService,
    private readonly paymentsClient: PaymentsClient,
  ) {}

  /** Starts paying for the user's order: where to send the customer to pay. */
  async start(userId: string, orderId: string) {
    const order = await this.ordersService.findOne(userId, orderId);
    if (order.status !== 'placed') {
      throw new ConflictException(`Order is ${order.status}`);
    }
    // Outside any transaction: no database connection waits on the provider.
    const payment = await this.paymentsClient.createPayment(order);
    return { paymentId: payment.id, checkoutUrl: payment.checkoutUrl };
  }
}
