import { fileURLToPath } from 'node:url';
import { PasswordHasher } from '@nestjs/authentication';
import { getDrizzleToken } from '@nestjs/drizzle';
import { NodeAdapter, type NestNodeApplication } from '@nestjs/platform-node';
import { Test } from '@nestjs/testing';
import { eq, sql } from 'drizzle-orm';
import { drizzle } from 'drizzle-orm/node-postgres';
import { migrate } from 'drizzle-orm/node-postgres/migrator';
import { Pool } from 'pg';
import { AppModule } from '../src/app.module.js';
import { products, users } from '../src/database/schema.js';
import type { Role } from '../src/users/user.js';

// A real PostgreSQL with a pool, so concurrent checkouts really race.
const url = process.env.TEST_DATABASE_URL;

describe.skipIf(!url)('Shop API (e2e)', () => {
  const db = drizzle({ client: new Pool({ connectionString: url, max: 20 }) });
  let app: NestNodeApplication;

  beforeAll(async () => {
    await migrate(db, { migrationsFolder: fileURLToPath(new URL('../drizzle', import.meta.url)) });
    await db.execute(sql`TRUNCATE users, products, refresh_tokens CASCADE`);
    const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
      .overrideProvider(getDrizzleToken())
      .useValue(db)
      // scrypt at the default cost takes 128 MiB and a few hundred ms per hash.
      .overrideProvider(PasswordHasher)
      .useValue(new PasswordHasher({ logN: 10 }))
      .compile();
    app = moduleRef.createNestApplication<NestNodeApplication>(new NodeAdapter());
    await app.init();
  });

  afterAll(() => app.close()); // closes the pool too

  let clients = 0;

  /** Signs a user up, and returns the headers that authenticate as them. */
  async function signUp(email: string, role: Role = 'customer') {
    const res = await app.inject({
      method: 'POST',
      url: '/auth/sign-up',
      payload: { email, password: 'correct horse battery' },
      // Each user signs up from an address of their own, as they would in
      // production: sign-up is rate-limited per IP address.
      remoteAddress: `10.0.0.${++clients}`,
    });
    await db.update(users).set({ role }).where(eq(users.email, email));
    return { authorization: `Bearer ${res.json<{ accessToken: string }>().accessToken}` };
  }

  async function createProduct(stock: number) {
    const res = await app.inject({
      method: 'POST',
      url: '/products',
      headers: await signUp(`staff-${crypto.randomUUID()}@example.com`, 'staff'),
      payload: { name: 'Limited edition keycaps', price: 9900, stock },
    });
    expect(res.statusCode).toBe(201);
    return res.json<{ id: string }>().id;
  }

  it('lets only staff edit the catalog', async () => {
    const payload = { name: 'Desk mat', price: 2500, stock: 10 };
    const customer = await signUp('customer@example.com');
    expect((await app.inject({ method: 'POST', url: '/products', payload })).statusCode).toBe(401);
    expect((await app.inject({ method: 'POST', url: '/products', headers: customer, payload })).statusCode).toBe(403);
  });

  it('sells the last unit exactly once', async () => {
    const productId = await createProduct(1);
    const buyers = await Promise.all(Array.from({ length: 10 }, (_, i) => signUp(`buyer${i}@example.com`)));
    for (const headers of buyers) {
      await app.inject({ method: 'PUT', url: `/cart/items/${productId}`, headers, payload: { quantity: 1 } });
    }

    const results = await Promise.all(buyers.map((headers) => app.inject({ method: 'POST', url: '/orders', headers })));

    expect(results.map((res) => res.statusCode).sort()).toEqual([201, ...Array(9).fill(409)]);
    const [{ stock }] = await db.select({ stock: products.stock }).from(products).where(eq(products.id, productId));
    expect(stock).toBe(0);
  });

  it('places one order when the same cart is checked out twice at once', async () => {
    const productId = await createProduct(10);
    const headers = await signUp('double-click@example.com');
    await app.inject({ method: 'PUT', url: `/cart/items/${productId}`, headers, payload: { quantity: 2 } });

    const results = await Promise.all([1, 2].map(() => app.inject({ method: 'POST', url: '/orders', headers })));

    expect(results.map((res) => res.statusCode).sort()).toEqual([201, 409]);
    const orders = await app.inject({ method: 'GET', url: '/orders', headers });
    expect(orders.json()).toHaveLength(1);
  });

  it('puts the stock back when an order is cancelled', async () => {
    const productId = await createProduct(3);
    const headers = await signUp('cancel@example.com');
    await app.inject({ method: 'PUT', url: `/cart/items/${productId}`, headers, payload: { quantity: 3 } });
    const order = (await app.inject({ method: 'POST', url: '/orders', headers })).json<{ id: string }>();

    const cancelled = await app.inject({ method: 'POST', url: `/orders/${order.id}/cancel`, headers });
    expect(cancelled.json()).toMatchObject({ status: 'cancelled' });
    const product = await app.inject({ method: 'GET', url: `/products/${productId}` });
    expect(product.json()).toMatchObject({ stock: 3 });
    expect((await app.inject({ method: 'POST', url: `/orders/${order.id}/cancel`, headers })).statusCode).toBe(409);
  });
});
