import { Injectable } from '@nestjs/common';
import { HttpClient, InjectHttpClient, toHttpException } from '@nestjs/http-client';
import type { Order } from '../database/schema.js';
import type { Payment } from './payment.js';

/** The payment provider's API: the one call this shop makes. */
@Injectable()
export class PaymentsClient {
  constructor(@InjectHttpClient('payments') private readonly http: HttpClient) {}

  /** The order's payment. Called again for the same order, it returns the same payment. */
  async createPayment(order: Pick<Order, 'id' | 'total'>): Promise<Payment> {
    try {
      const { data } = await this.http.post<Payment>('/v1/payments', {
        json: { amount: order.total, currency: 'usd', reference: order.id },
        // One key per order: a retry, or a second click, can't create a second payment.
        headers: { 'idempotency-key': order.id },
        // POST isn't retried by default; with the key, retrying is safe.
        retry: { methods: ['POST'] },
      });
      return data;
    } catch (error) {
      // 502 when the provider fails, 504 when it doesn't answer in time.
      throw toHttpException(error);
    }
  }
}
