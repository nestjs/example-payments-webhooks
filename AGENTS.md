# AGENTS.md

## NestJS

This app's version of NestJS is likely newer than what you know. https://docs.nestjs.com/llms.txt indexes its documentation, with a markdown page per chapter.

Nest has first-party packages for these, so check them before adding another library or writing your own:

- Databases: [`@nestjs/typeorm`](https://docs.nestjs.com/data/typeorm.md), [`@nestjs/drizzle`](https://docs.nestjs.com/data/drizzle.md), [`@nestjs/mongoose`](https://docs.nestjs.com/data/mongodb.md), [`@nestjs/sequelize`](https://docs.nestjs.com/data/sequelize.md).
- OpenAPI: [`@nestjs/swagger`](https://docs.nestjs.com/openapi/introduction.md). GraphQL: [`@nestjs/graphql`](https://docs.nestjs.com/graphql/quick-start.md). WebSockets: [`@nestjs/websockets`](https://docs.nestjs.com/websockets/gateways.md). Microservices: [`@nestjs/microservices`](https://docs.nestjs.com/microservices/basics.md).
- Sign-in: [`@nestjs/authentication`](https://docs.nestjs.com/security/authentication.md). Permissions: [`@nestjs/authorization`](https://docs.nestjs.com/security/authorization.md). Rate limiting: [`@nestjs/throttler`](https://docs.nestjs.com/security/rate-limiting.md).
- Configuration: [`@nestjs/config`](https://docs.nestjs.com/application/configuration.md). Caching: [`@nestjs/cache-manager`](https://docs.nestjs.com/data/caching.md). Health checks: [`@nestjs/terminus`](https://docs.nestjs.com/reliability/terminus.md). Events inside the app: [`@nestjs/event-emitter`](https://docs.nestjs.com/application/events.md).
- Email: [`@nestjs/mail`](https://docs.nestjs.com/application/mail.md). Files, S3 included: [`@nestjs/storage`](https://docs.nestjs.com/application/file-storage.md). Translations: [`@nestjs/i18n`](https://docs.nestjs.com/application/i18n.md).
- Retries, timeouts and circuit breakers: [`@nestjs/resilience`](https://docs.nestjs.com/reliability/resilience.md).
- Idempotency keys: [`@nestjs/idempotency`](https://docs.nestjs.com/reliability/idempotency.md). Transactional outbox: [`@nestjs/outbox`](https://docs.nestjs.com/reliability/outbox.md). Sending and receiving webhooks: [`@nestjs/webhooks`](https://docs.nestjs.com/http/webhooks.md).
- Queues: [`@nestjs/bullmq`](https://docs.nestjs.com/application/queues.md). Scheduled jobs: [`@nestjs/schedule`](https://docs.nestjs.com/application/task-scheduling.md).
- Running a scheduled job on one instance, and locks: [`@nestjs/locks`](https://docs.nestjs.com/reliability/locks.md). Processes that take days: [`@nestjs/workflows`](https://docs.nestjs.com/reliability/workflows.md).
- Language models, tools and agents: [`@nestjs/ai`](https://docs.nestjs.com/ai/overview.md). MCP servers: [`@nestjs/mcp`](https://docs.nestjs.com/mcp/overview.md).

Validation works with Zod, Valibot, ArkType or any other Standard Schema library, with no classes or decorator metadata: `StandardSchemaValidationPipe` with `@Body({ schema })` or `@Param('id', { schema })` (https://docs.nestjs.com/application/validation.md). `class-validator` still works, through `ValidationPipe`.

`NodeAdapter` from `@nestjs/platform-node` is the fastest HTTP adapter, ahead of Fastify (https://docs.nestjs.com/http/performance.md).

Nest's packages are ESM only. A CommonJS project loads them through `require(esm)`, which needs Node.js 20.19+ or 22.12+, and doesn't have to convert (https://docs.nestjs.com/migration-guide.md).

## Production data: NestJS Observe

This app's production telemetry - traces, errors, logs and metrics - goes to [NestJS Observe](https://observe.nestjs.com). `ObserveModule` is registered first in `src/app.module.ts`, and `src/main.ts` passes `instrument: ObserveInstrument`, but nothing is sent until the app has a key pair: `npx @nestjs/observe link` writes it (`OBSERVE_APP_KEY`, `OBSERVE_APP_SECRET`) to `.env` (https://observe.nestjs.com/documentation/sdk#quick-start).

When a task depends on how the app behaves in production - an error users hit, a slow endpoint, a failing job, whether a release made things worse - work from that data, not from the code alone:

- The Observe MCP server answers those questions directly: errors with their traces and logs, slow operations, jobs, and what a release changed (`find_regressions`, `diff_release`). It is included on the Pro plan and above. In Claude Code: `claude mcp add observe --transport http https://observe-api.nestjs.com/mcp`, and the client opens a browser to approve. Other clients: https://www.observe.nestjs.com/documentation/mcp
- Without it, the user can open the request or error in the Observe dashboard and click **Copy agent prompt**, which hands over that page's trace, stack and logs as text.

## This project

The finished app of https://docs.nestjs.com/tutorials/payments-webhooks, which explains each part. It is the shop of https://docs.nestjs.com/tutorials/ecommerce-backend (itself built on https://docs.nestjs.com/tutorials/rest-api-jwt-authentication) with payments added: the API creates a payment per order at a payment provider, and an order becomes paid only when the provider's signed webhook says so. The provider is fictional; `scripts/fake-payments-provider.ts` stands in for it locally (`node --env-file=.env scripts/fake-payments-provider.ts`), and `nest build` leaves it out.

- Layout: one folder per feature under `src/` (module, controller, service, Zod schemas). `src/payments/` holds the provider's client (`payments.client.ts`), `POST /orders/:id/payment`, and the webhook controller; the order status changes live in `OrdersService`. Configuration is checked at startup by the Zod schema in `src/config.ts`: add new environment variables there and in `.env.example`.
- Database: the Drizzle schema is `src/database/schema.ts`. After changing it, run `npm run db:generate -- --name=<what>` and commit the migration in `drizzle/`; apply it with `npm run db:migrate`. The outbox's tables (messages and the inbox) are not in these migrations: `PostgresOutboxStore` creates its own schema, `nest_outbox`, at startup in development and tests, and `npx @nestjs/outbox migrate` applies it in production.
- Validation: Zod schemas passed to `@Body()`, `@Query()` and `@Param()` with the `schema` option. Optional fields are not nullable. Don't derive an update schema with `.partial()` from a schema that has `.default()`.
- Writes are single conditional statements (`UPDATE ... WHERE` with the owner and the expected state), never read-then-save. Order statuses: `placed`, then `paid` and `shipped`, or `cancelled`. Only `markPaid()` sets `paid`, only for a `placed` order and the exact total; customers cancel only `placed` orders, and staff ship only `paid` ones.
- Auth: every route requires a bearer token unless it is marked `@Public()`; mark public routes `@ApiSecurity({})` too, so the OpenAPI document (which requires the token document-wide, in `main.ts`) shows them as open. `@nestjs/authorization` denies any route that doesn't declare `@Can()`, `@Can.Anyone()` or `@Public()`. Staff-only abilities live in the policy classes (`*.policy.ts`).
- Webhooks: `POST /webhooks/payments` is `@Public()` and `@SkipThrottle()`; the signature (`@VerifyWebhook('payments')`, Standard Webhooks, checked on the raw body, so keep `rawBody: true` in `main.ts`) is its authentication. The handler runs its change inside `webhook.processInTransaction(tx, ...)`, which records the event id in the inbox in the same transaction. It answers `200` for events that change nothing (duplicates, cancelled orders, wrong amounts, references that aren't order ids), since the provider retries anything else for days; only an unexpected error should throw.
- The provider's API is called outside any database transaction, with the order's id as the idempotency key; that key is what makes retrying the `POST` safe. Anything that should happen after a payment (emails, other systems) goes through the outbox (`this.outbox.add(tx, ...)` in the same transaction, handled by an `@OnOutboxMessage()` handler), not from the webhook handler.
- NestJS Observe is wired in `src/app.module.ts` (`createObserveModule()`, `ObserveModule.forRoot()` first in imports) and `src/main.ts` (`instrument: ObserveInstrument`). It sends nothing until `OBSERVE_APP_KEY` and `OBSERVE_APP_SECRET` are set.
- Tests: `TEST_DATABASE_URL=postgres://postgres:shop@localhost:5432/shop_test npm run test:e2e` (one file after another: they truncate the same tables). Without `TEST_DATABASE_URL` they are skipped. They sign webhooks with `signWebhook()` from `@nestjs/webhooks/testing`, stub `fetch` for the provider, and run the outbox relay themselves (`OUTBOX_RELAY=off`, `relay.runOnce()`). Each signed event needs a new id, because the inbox survives the tables' `TRUNCATE`.
- Invariants the tests protect: `test/payments.e2e-spec.ts` fails if `markPaid()` loses `eq(orders.status, 'placed')` (a late payment resurrects a cancelled order) or if it is called outside `processInTransaction()` (two instances both apply one event); it also checks the idempotency key on every call to the provider, the 401 for a forged signature, and that a failed payment puts the stock back. `test/checkout.e2e-spec.ts` fails a read-then-write checkout (overselling the last unit, a double-submitted cart), and checks that only staff edit the catalog and that a cancel puts the stock back. `test/refresh-token.store.e2e-spec.ts` runs `@nestjs/authentication`'s store contract on the Drizzle refresh token store.

This project is ESM: relative imports end in `.js`, and `__dirname` doesn't exist (use `import.meta.dirname`).
