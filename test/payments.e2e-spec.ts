import { fileURLToPath } from 'node:url';
import { PasswordHasher } from '@nestjs/authentication';
import { getDrizzleToken } from '@nestjs/drizzle';
import { OutboxRelay } from '@nestjs/outbox';
import { NodeAdapter, type NestNodeApplication } from '@nestjs/platform-node';
import { Test } from '@nestjs/testing';
import { signWebhook } from '@nestjs/webhooks/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle, type NodePgDatabase } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module.js';
import { orders, products, users } from '../src/database/schema.js';
import { OrderPaidHandler } from '../src/orders/order-paid.handler.js';
import { OrdersService } from '../src/orders/orders.service.js';
import type { PaymentEvent } from '../src/payments/payment.js';

// A real PostgreSQL with a pool, so a redelivery and a cancel really race.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('Payments (e2e)', () => {
  const db = drizzle({ client: new Pool({ connectionString: url, max: 20 }) });
  // The provider's API: every call the shop makes to it lands here.
  const fetch = vi.fn<typeof globalThis.fetch>();
  let app: NestNodeApplication;
  let other: NestNodeApplication; // a second instance of the API, on a pool of its own
  let relay: OutboxRelay;

  async function createApp(database: NodePgDatabase) {
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getDrizzleToken())
      .useValue(database) // the outbox's store runs on it too
      .overrideProvider(PasswordHasher)
      .useValue(new PasswordHasher({ logN: 10 }))
      .compile();
    return moduleRef.createNestApplication<NestNodeApplication>(new NodeAdapter(), { rawBody: true }).init();
  }

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.execute(sql`TRUNCATE users, products, refresh_tokens CASCADE`);
    vi.stubGlobal('fetch', fetch);
    app = await createApp(db);
    other = await createApp(drizzle({ client: new Pool({ connectionString: url, max: 10 }) }));
    relay = app.get(OutboxRelay);
  });

  afterAll(async () => {
    vi.unstubAllGlobals();
    await other.close();
    await app.close(); // closes the pools too
  });

  let clients = 0;

  async function signUp(email: string) {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/sign-up',
      payload: { email, password: 'correct horse battery' },
      remoteAddress: `10.0.1.${++clients}`,
    });
    return { authorization: `Bearer ${res.json<{ accessToken: string }>().accessToken}` };
  }

  /** A placed order for 2 of a product with 5 in stock. */
  async function placeOrder() {
    const [product] = await db.insert(products).values({ name: 'Keycaps', description: '', price: 9900, stock: 5 }).returning();
    const headers = await signUp(`buyer-${crypto.randomUUID()}@example.com`);
    await app.inject({ method: 'PUT', url: `/cart/items/${product.id}`, headers, payload: { quantity: 2 } });
    const order = (await app.inject({ method: 'POST', url: '/orders', headers })).json<{ id: string; total: number }>();
    return { ...order, productId: product.id, headers };
  }

  /** The request the provider sends: Standard Webhooks, signed with the shared secret. */
  function event(type: PaymentEvent['type'], order: { id: string; total: number }, secret = process.env.PAYMENTS_WEBHOOK_SECRET!) {
    const data = {
      id: `pay_${order.id.slice(0, 8)}`,
      amount: order.total,
      currency: 'usd',
      reference: order.id,
      status: type === 'payment.succeeded' ? 'succeeded' : 'failed',
      checkoutUrl: 'https://payments.invalid/checkout',
    };
    return signWebhook({ scheme: 'standard', secret, payload: { type, timestamp: new Date().toISOString(), data } });
  }

  const deliver = ({ headers, body }: { headers: Record<string, string>; body: string }, to = app) =>
    to.inject({ method: 'POST', url: '/webhooks/payments', headers, payload: body });

  const statusOf = async (id: string) =>
    (await db.select({ status: orders.status }).from(orders).where(eq(orders.id, id)))[0].status;
  const stockOf = async (id: string) =>
    (await db.select({ stock: products.stock }).from(products).where(eq(products.id, id)))[0].stock;

  it('creates the payment with the order id as the idempotency key, retries included', async () => {
    const order = await placeOrder();
    const payment = { id: 'pay_1', checkoutUrl: 'https://payments.invalid/checkout/pay_1' };
    fetch
      .mockReset()
      .mockResolvedValueOnce(new Response(null, { status: 503 })) // the provider hiccups: retried
      .mockResolvedValueOnce(Response.json(payment))
      .mockResolvedValueOnce(Response.json(payment));

    const first = await app.inject({ method: 'POST', url: `/orders/${order.id}/payment`, headers: order.headers });
    const second = await app.inject({ method: 'POST', url: `/orders/${order.id}/payment`, headers: order.headers });

    expect(first.json()).toEqual({ paymentId: 'pay_1', checkoutUrl: payment.checkoutUrl });
    expect(second.json()).toEqual(first.json());
    expect(fetch).toHaveBeenCalledTimes(3);
    for (const [input, init] of fetch.mock.calls) {
      expect(String(input)).toBe('https://payments.invalid/v1/payments');
      expect(new Headers(init?.headers).get('idempotency-key')).toBe(order.id);
      expect(JSON.parse(String(init?.body))).toEqual({ amount: order.total, currency: 'usd', reference: order.id });
    }
  });

  it('answers 502 when the provider is down', async () => {
    const order = await placeOrder();
    fetch.mockReset().mockRejectedValue(new TypeError('fetch failed'));

    const res = await app.inject({ method: 'POST', url: `/orders/${order.id}/payment`, headers: order.headers });

    expect(res.statusCode).toBe(502);
  });

  it('marks the order paid when a signed payment.succeeded arrives', async () => {
    const order = await placeOrder();
    const confirm = vi.spyOn(app.get(OrderPaidHandler), 'confirm');

    const res = await deliver(event('payment.succeeded', order));

    expect(res.statusCode).toBe(200);
    expect(await statusOf(order.id)).toBe('paid');
    await relay.runOnce(); // order.paid goes out after the commit
    expect(confirm).toHaveBeenCalledWith(expect.objectContaining({ orderId: order.id }), expect.anything());
  });

  it('rejects a webhook that the provider did not sign', async () => {
    const order = await placeOrder();

    const res = await deliver(event('payment.succeeded', order, 'whsec_c29tZW9uZS1lbHNlcy1zZWNyZXQtb2YtMzItYnl0ZXM='));

    expect(res.statusCode).toBe(401);
    expect(await statusOf(order.id)).toBe('placed');
  });

  it('processes an event once, even when two instances receive it at the same time', async () => {
    const order = await placeOrder();
    const confirm = vi.spyOn(app.get(OrderPaidHandler), 'confirm').mockClear();
    const markPaid = [app, other].map((instance) => vi.spyOn(instance.get(OrdersService), 'markPaid'));
    const paid = event('payment.succeeded', order);

    const results = await Promise.all([deliver(paid, app), deliver(paid, other)]);

    expect(results.map((res) => res.statusCode)).toEqual([200, 200]);
    expect(await statusOf(order.id)).toBe('paid');
    // The inbox record, in the order's transaction, stopped the other copy.
    expect(markPaid[0].mock.calls.length + markPaid[1].mock.calls.length).toBe(1);
    await relay.runOnce();
    expect(confirm).toHaveBeenCalledTimes(1);
  });

  it('pays nothing for the wrong amount, or for a payment that is not for an order', async () => {
    const order = await placeOrder();

    const wrongAmount = await deliver(event('payment.succeeded', { ...order, total: order.total - 1 }));
    const notAnOrder = await deliver(event('payment.succeeded', { ...order, id: 'invoice-2041' }));

    expect([wrongAmount.statusCode, notAnOrder.statusCode]).toEqual([200, 200]);
    expect(await statusOf(order.id)).toBe('placed');
  });

  it('never brings a cancelled order back', async () => {
    const order = await placeOrder();
    await app.inject({ method: 'POST', url: `/orders/${order.id}/cancel`, headers: order.headers });

    const res = await deliver(event('payment.succeeded', order));

    expect(res.statusCode).toBe(200); // a retry couldn't change anything: no point in one
    expect(await statusOf(order.id)).toBe('cancelled');
    expect(await stockOf(order.productId)).toBe(5);
  });

  it('cancels the order and puts its stock back when the payment fails', async () => {
    const order = await placeOrder();
    expect(await stockOf(order.productId)).toBe(3);

    await deliver(event('payment.failed', order));

    expect(await statusOf(order.id)).toBe('cancelled');
    expect(await stockOf(order.productId)).toBe(5);
  });

  it('lets a payment or a cancel win, never both', async () => {
    const order = await placeOrder();

    await Promise.all([
      deliver(event('payment.succeeded', order)),
      app.inject({ method: 'POST', url: `/orders/${order.id}/cancel`, headers: order.headers }),
    ]);

    const status = await statusOf(order.id);
    expect(['paid', 'cancelled']).toContain(status);
    expect(await stockOf(order.productId)).toBe(status === 'paid' ? 3 : 5);
  });
});
