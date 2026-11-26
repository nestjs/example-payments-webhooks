/**
 * A stand-in for the payment provider, for trying the shop on your machine. It is not a
 * provider: it charges nothing, and it keeps its payments in memory.
 *
 *   POST /v1/payments                          creates a payment, once per Idempotency-Key
 *   POST /checkout/:paymentId?outcome=failed   the customer pays (or the card is declined)
 *   POST /events/:eventId/resend               delivers an event again, with the same id
 *
 * Its webhooks are signed the way Standard Webhooks specifies, with PAYMENTS_WEBHOOK_SECRET,
 * and posted to WEBHOOK_URL (default http://localhost:3000/webhooks/payments).
 */
import { createHmac, randomUUID } from 'node:crypto';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';

const port = Number(process.env.PROVIDER_PORT ?? 4000);
const webhookUrl = process.env.WEBHOOK_URL ?? 'http://localhost:3000/webhooks/payments';
const secret = process.env.PAYMENTS_WEBHOOK_SECRET ?? '';
if (!secret.startsWith('whsec_')) {
  throw new Error('Set PAYMENTS_WEBHOOK_SECRET to the secret the shop was started with');
}
// The key is the base64 after the whsec_ prefix.
const key = Buffer.from(secret.slice('whsec_'.length), 'base64');

const payments = new Map<string, Record<string, unknown>>(); // by idempotency key
const events = new Map<string, string>(); // event id to body

/** Signs and posts an event, as the provider would: HMAC-SHA256 of `id.timestamp.body`. */
async function deliver(id: string, body: string): Promise<number> {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = createHmac('sha256', key).update(`${id}.${timestamp}.${body}`).digest('base64');
  const response = await fetch(webhookUrl, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'webhook-id': id,
      'webhook-timestamp': String(timestamp),
      'webhook-signature': `v1,${signature}`,
    },
    body,
  });
  return response.status;
}

async function handle(req: IncomingMessage, res: ServerResponse): Promise<[number, unknown]> {
  const url = new URL(req.url ?? '/', `http://localhost:${port}`);
  const [, first, id, action] = url.pathname.split('/');

  if (req.method === 'POST' && url.pathname === '/v1/payments') {
    const idempotencyKey = req.headers['idempotency-key'];
    if (typeof idempotencyKey !== 'string' || !req.headers.authorization?.startsWith('Bearer ')) {
      return [400, { error: 'An API key and an Idempotency-Key are required' }];
    }
    let body = '';
    for await (const chunk of req) body += chunk;
    // The same key returns the payment it created the first time.
    if (!payments.has(idempotencyKey)) {
      const paymentId = `pay_${randomUUID().slice(0, 8)}`;
      const checkoutUrl = `http://localhost:${port}/checkout/${paymentId}`;
      payments.set(idempotencyKey, { id: paymentId, ...JSON.parse(body), status: 'requires_payment', checkoutUrl });
    }
    return [200, payments.get(idempotencyKey)];
  }

  if (req.method === 'POST' && first === 'checkout') {
    const payment = [...payments.values()].find((p) => p.id === id);
    if (!payment) {
      return [404, { error: 'No such payment' }];
    }
    payment.status = url.searchParams.get('outcome') === 'failed' ? 'failed' : 'succeeded';
    const eventId = `evt_${randomUUID().replaceAll('-', '').slice(0, 16)}`;
    const body = JSON.stringify({ type: `payment.${payment.status}`, timestamp: new Date().toISOString(), data: payment });
    events.set(eventId, body);
    return [200, { event: eventId, type: `payment.${payment.status}`, delivered: await deliver(eventId, body) }];
  }

  if (req.method === 'POST' && first === 'events' && action === 'resend') {
    const body = events.get(id);
    return body ? [200, { event: id, delivered: await deliver(id, body) }] : [404, { error: 'No such event' }];
  }
  return [404, { error: 'Not found' }];
}

createServer((req, res) => {
  handle(req, res).then(
    ([status, body]) => res.writeHead(status, { 'content-type': 'application/json' }).end(JSON.stringify(body)),
    (error) => res.writeHead(500).end(String(error)),
  );
}).listen(port, () => console.log(`Fake payment provider on http://localhost:${port}`));
