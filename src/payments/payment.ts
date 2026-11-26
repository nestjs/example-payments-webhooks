/** A payment, as the provider's API returns it. */
export interface Payment {
  id: string;
  /** In cents. */
  amount: number;
  currency: string;
  /** What the payment is for: the order's id. */
  reference: string;
  status: 'requires_payment' | 'succeeded' | 'failed';
  /** The provider's payment page, where the customer pays. */
  checkoutUrl: string;
}

/** The provider's webhook body: Standard Webhooks' `type`, `timestamp` and `data`. */
export interface PaymentEvent {
  type: 'payment.succeeded' | 'payment.failed';
  timestamp: string;
  data: Payment;
}
