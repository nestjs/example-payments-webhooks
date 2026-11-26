# Accept payments with webhooks in NestJS

This is the finished application of the tutorial [Accept payments with webhooks in Node.js](https://docs.nestjs.com/tutorials/payments-webhooks) in the NestJS documentation. The tutorial builds it step by step and explains every decision; this repository is the result, ready to clone.

It continues [Build an e-commerce backend](https://docs.nestjs.com/tutorials/ecommerce-backend): the same shop (sign-in, a catalog that staff edit, carts, a checkout that never oversells), with payments added.

## What it does

- Creates one payment per order at the payment provider, through a typed client on `@nestjs/http-client`, with the order's id as the provider's idempotency key, so a retry or a second click never creates a second payment.
- Receives the provider's webhooks with `@nestjs/webhooks`: verified on the raw body (Standard Webhooks signatures), deduplicated by event id, and recorded in the same transaction as the change they make.
- Moves an order from `placed` to `paid` with one conditional update, so a replayed, late or out-of-order event changes nothing, and a payment never brings a cancelled order back. A payment that changed nothing is logged with `refund it`.
- Cancels the order and puts its stock back when a payment fails.
- Announces `order.paid` only after the payment's transaction has committed, through the transactional outbox (`@nestjs/outbox`).

There is no real payment provider here, and nothing charges a card. `scripts/fake-payments-provider.ts` stands in for one on your machine, and the tests sign the provider's webhooks themselves.

## Run it

You need Node.js 22.18 or later, and Docker for PostgreSQL.

```bash
git clone https://github.com/nestjs/example-payments-webhooks.git
cd example-payments-webhooks
npm install
cp .env.example .env
# In .env, set JWT_SECRET (openssl rand -base64 32)
# and PAYMENTS_WEBHOOK_SECRET (echo "whsec_$(openssl rand -base64 32)")
docker compose up -d
npm run db:migrate
```

Start the fake payment provider in one terminal. It reads the webhook secret from `.env` and posts its webhooks to http://localhost:3000/webhooks/payments:

```bash
node --env-file=.env scripts/fake-payments-provider.ts
```

Start the API in another:

```bash
npm run start
```

The API listens on http://localhost:3000, with Swagger UI at http://localhost:3000/docs. At startup, the outbox's store creates its own schema, `nest_outbox`, in the same database (in development and tests only).

To pay for an order: `POST /orders/:id/payment` returns the payment's `checkoutUrl`. On the fake provider, `POST <checkoutUrl>` is the customer paying, `POST <checkoutUrl>?outcome=failed` is a declined card, and `POST /events/:eventId/resend` delivers an event again. The tutorial's [Try it](https://docs.nestjs.com/tutorials/payments-webhooks#try-it) section walks through the whole flow with `curl`, staff included (a user becomes staff with `UPDATE users SET role = 'staff' WHERE email = '...'`).

## A real payment provider

A real provider gives you three things, which go in `.env` (see [Switch to a real provider](https://docs.nestjs.com/tutorials/payments-webhooks#switch-to-a-real-provider)):

- `PAYMENTS_API_URL`: the URL of its API.
- `PAYMENTS_API_KEY`: your API key. Use its test-mode key until everything works.
- `PAYMENTS_WEBHOOK_SECRET`: the webhook signing secret from its dashboard, `whsec_` followed by base64.

Register `https://<your API>/webhooks/payments` as the webhook URL in the provider's dashboard. On your machine, the provider's command-line tool or a tunnel forwards its webhooks to `localhost`. `PaymentsClient.createPayment()` is written against the fictional provider's API (shaped like Stripe's); replace it with your provider's call, and map its event names in `PaymentWebhooksController`.

## Endpoints

| Endpoint | Section |
| --- | --- |
| `POST /auth/sign-up`, `POST /auth/token`, `POST /auth/token/refresh`, `POST /auth/token/revoke` | [Sign users in with JWTs](https://docs.nestjs.com/tutorials/rest-api-jwt-authentication#sign-users-in-with-jwts) |
| `GET /me` | [Sign users in with JWTs](https://docs.nestjs.com/tutorials/rest-api-jwt-authentication#sign-users-in-with-jwts) |
| `GET /health/live`, `GET /health/ready` | [Add health checks](https://docs.nestjs.com/tutorials/rest-api-jwt-authentication#add-health-checks) |
| `GET /products`, `GET /products/:id`, `POST /products` and `PATCH /products/:id` (staff) | [Let staff manage the catalog](https://docs.nestjs.com/tutorials/ecommerce-backend#let-staff-manage-the-catalog) |
| `GET /cart`, `PUT /cart/items/:productId`, `DELETE /cart/items/:productId` | [Keep a cart](https://docs.nestjs.com/tutorials/ecommerce-backend#keep-a-cart) |
| `POST /orders` (checkout), `GET /orders`, `GET /orders/:id` | [Check out without overselling](https://docs.nestjs.com/tutorials/ecommerce-backend#check-out-without-overselling) |
| `POST /orders/:id/cancel` (orders not paid yet), `POST /orders/:id/ship` (staff, paid orders) | [Mark orders paid exactly once](https://docs.nestjs.com/tutorials/payments-webhooks#mark-orders-paid-exactly-once) |
| `POST /orders/:id/payment` | [Create the payment](https://docs.nestjs.com/tutorials/payments-webhooks#create-the-payment) |
| `POST /webhooks/payments` (the provider's signed webhooks) | [Receive the provider's webhooks](https://docs.nestjs.com/tutorials/payments-webhooks#receive-the-providers-webhooks) |
| `GET /docs` (Swagger UI) | [Describe the API with OpenAPI](https://docs.nestjs.com/tutorials/rest-api-jwt-authentication#describe-the-api-with-openapi) |

## Layout

| Path | What it holds |
| --- | --- |
| `src/main.ts` | bootstrap on the Node adapter with `rawBody: true`, security headers, CORS, Swagger UI |
| `src/app.module.ts` | NestJS Observe, config, database, authentication, authorization, throttler, outbox and its PostgreSQL store, the webhook receiver |
| `src/config.ts` | the environment's schema, checked at startup |
| `src/database/` | the Drizzle tables (`schema.ts`) and the `Transaction` type |
| `src/auth/`, `src/users/` | sign-in, from the JWT tutorial |
| `src/products/`, `src/cart/` | the catalog and the cart, from the e-commerce tutorial |
| `src/orders/` | checkout, cancel, ship, `markPaid()` and `cancelUnpaid()`, and the `order.paid` handler |
| `src/payments/` | the provider's client, `POST /orders/:id/payment`, and the webhook controller |
| `src/health/` | liveness and readiness |
| `scripts/fake-payments-provider.ts` | a stand-in for the provider, for trying the API on your machine |
| `test/` | e2e tests on PostgreSQL: payments and webhooks, checkout races, the refresh token store |
| `drizzle/` | migrations |

## Tests

```bash
TEST_DATABASE_URL=postgres://postgres:shop@localhost:5432/shop_test npm run test:e2e
```

`docker compose` creates the `shop_test` database. The tests truncate its tables, so never point them at your development database. They sign webhooks with `signWebhook()` from `@nestjs/webhooks/testing` and stub `fetch` for the provider's API, so they need no provider and no network.

## Stack

[NestJS](https://nestjs.com) 12 on the Node adapter, [Zod](https://zod.dev) validation, [`@nestjs/authentication`](https://docs.nestjs.com/security/authentication), [`@nestjs/authorization`](https://docs.nestjs.com/security/authorization), [Drizzle](https://docs.nestjs.com/data/drizzle) and PostgreSQL, [`@nestjs/webhooks`](https://docs.nestjs.com/http/webhooks), [`@nestjs/outbox`](https://docs.nestjs.com/reliability/outbox), [`@nestjs/http-client`](https://docs.nestjs.com/application/http-client), [`@nestjs/throttler`](https://docs.nestjs.com/security/rate-limiting), [`@nestjs/swagger`](https://docs.nestjs.com/openapi/introduction), [`@nestjs/terminus`](https://docs.nestjs.com/reliability/terminus), [NestJS Observe](https://docs.nestjs.com/observability/overview), and Vitest.

## Production

Read the tutorial's production checklist first: https://docs.nestjs.com/tutorials/payments-webhooks#production-checklist (it builds on the e-commerce tutorial's).

NestJS Observe is wired in `src/app.module.ts` and sends nothing until it has a key pair. `npx @nestjs/observe link` writes the key pair (`OBSERVE_APP_KEY`, `OBSERVE_APP_SECRET`) into `.env`; in production, set them in the platform's environment, since `start:prod` doesn't load `.env`. Observe then records each request with its trace, the call to the provider's API included: https://docs.nestjs.com/observability/overview

## License

MIT
